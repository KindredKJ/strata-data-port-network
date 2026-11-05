// Kindred Jermaine Cox / Kindred Labs. SDPN signed physical evidence verifier v1.
#include "sdpn_evidence.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include <optional>
#include <regex>
#include <set>
#include <stdexcept>
#include <string_view>
#include <vector>

#include <openssl/evp.h>
#include <openssl/x509.h>

namespace kindred::sdpn {
namespace {

using Json = nlohmann::json;
constexpr std::string_view kProfileId = "kindred.sdpn.quic-wire.v1";
constexpr std::string_view kPerformanceSchema = "kindred.sdpn.teleport-performance-window.v1";
constexpr std::string_view kEvidenceSchema = "kindred.sdpn.signed-performance-evidence.v1";
constexpr std::string_view kQualificationSchema = "kindred.sdpn.physical-host-qualification.v1";
constexpr std::uint64_t kWindowDurationMs = 300'000;
constexpr std::uint64_t kFutureSkewMs = 30'000;
constexpr std::uint64_t kMaximumQualificationTtlMs = 43'200'000;
constexpr std::uint64_t kMaximumAttempts = 300;
constexpr std::uint64_t kMinimumPairs = 60;
constexpr std::uint64_t kMaximumPayloadBytes = 32ULL * 1024ULL * 1024ULL;
constexpr std::uint64_t kMaximumLatencyUs = 60'000'000;

template <typename T, void (*Free)(T*)>
using OpenSslPtr = std::unique_ptr<T, decltype(Free)>;

void exact_fields(const Json& value, std::initializer_list<std::string_view> expected,
                  std::string_view label) {
  if (!value.is_object()) throw std::runtime_error(std::string(label) + " must be an object");
  std::set<std::string> actual;
  for (auto it = value.begin(); it != value.end(); ++it) actual.insert(it.key());
  std::set<std::string> wanted;
  for (const auto field : expected) wanted.emplace(field);
  if (actual != wanted) throw std::runtime_error(std::string(label) + " fields rejected");
}

std::string canonical_json(const Json& value) {
  if (value.is_number_float()) throw std::runtime_error("canonical evidence rejects floating point values");
  if (value.is_structured()) {
    for (auto it = value.begin(); it != value.end(); ++it) {
      if (value.is_array()) {
        for (const auto& child : value) (void)canonical_json(child);
        break;
      }
      (void)canonical_json(it.value());
    }
  }
  return value.dump(-1, ' ', false, Json::error_handler_t::strict);
}

std::uint64_t unsigned_integer(const Json& value, std::string_view label) {
  if (!value.is_number_integer()) throw std::runtime_error(std::string(label) + " must be an integer");
  std::uint64_t result;
  if (value.is_number_unsigned()) {
    result = value.get<std::uint64_t>();
  } else {
    const auto signed_value = value.get<std::int64_t>();
    if (signed_value < 0) throw std::runtime_error(std::string(label) + " must be non-negative");
    result = static_cast<std::uint64_t>(signed_value);
  }
  constexpr std::uint64_t kMaxSafeInteger = 9'007'199'254'740'991ULL;
  if (result > kMaxSafeInteger) throw std::runtime_error(std::string(label) + " exceeds safe integer bounds");
  return result;
}

std::string required_text(const Json& value, std::string_view label, std::size_t max_length) {
  if (!value.is_string()) throw std::runtime_error(std::string(label) + " must be text");
  const auto result = value.get<std::string>();
  if (result.empty() || result.size() > max_length ||
      std::any_of(result.begin(), result.end(), [](unsigned char c) { return c < 0x20 || c == 0x7f; })) {
    throw std::runtime_error(std::string(label) + " bounds rejected");
  }
  return result;
}

bool matches(const std::string& value, const std::regex& pattern) {
  return std::regex_match(value, pattern);
}

std::vector<unsigned char> base64_decode(const std::string& encoded, std::string_view label) {
  if (encoded.empty() || encoded.size() % 4 != 0 || encoded.size() > 2'000'000) {
    throw std::runtime_error(std::string(label) + " base64 bounds rejected");
  }
  std::vector<unsigned char> decoded((encoded.size() / 4) * 3);
  const int size = EVP_DecodeBlock(decoded.data(),
      reinterpret_cast<const unsigned char*>(encoded.data()), static_cast<int>(encoded.size()));
  if (size < 0) throw std::runtime_error(std::string(label) + " base64 rejected");
  std::size_t actual = static_cast<std::size_t>(size);
  if (!encoded.empty() && encoded.back() == '=') --actual;
  if (encoded.size() > 1 && encoded[encoded.size() - 2] == '=') --actual;
  decoded.resize(actual);
  std::string recoded(4 * ((decoded.size() + 2) / 3), '\0');
  const int recoded_size = EVP_EncodeBlock(reinterpret_cast<unsigned char*>(recoded.data()),
      decoded.data(), static_cast<int>(decoded.size()));
  if (recoded_size < 0 || recoded != encoded) {
    throw std::runtime_error(std::string(label) + " noncanonical base64 rejected");
  }
  return decoded;
}

Json verify_signed_body(const Json& envelope, const Json& trust, std::string_view label) {
  exact_fields(envelope, {"body", "keyId", "signature"}, std::string(label) + " envelope");
  if (!trust.is_object()) throw std::runtime_error(std::string(label) + " trust map required");
  const auto key_id = required_text(envelope.at("keyId"), "keyId", 64);
  static const std::regex kHex256("^[0-9a-f]{64}$");
  if (!matches(key_id, kHex256)) throw std::runtime_error(std::string(label) + " keyId rejected");
  if (!trust.contains(key_id) || !trust.at(key_id).is_string()) {
    throw std::runtime_error(std::string(label) + " signer is not trusted");
  }
  const auto encoded_key = trust.at(key_id).get<std::string>();
  const auto public_key_der = base64_decode(encoded_key, "trusted key");
  if (sha256_hex(std::string(reinterpret_cast<const char*>(public_key_der.data()), public_key_der.size())) != key_id) {
    throw std::runtime_error(std::string(label) + " trust anchor fingerprint rejected");
  }
  const unsigned char* der_cursor = public_key_der.data();
  OpenSslPtr<EVP_PKEY, EVP_PKEY_free> public_key(
      d2i_PUBKEY(nullptr, &der_cursor, static_cast<long>(public_key_der.size())), EVP_PKEY_free);
  if (!public_key || der_cursor != public_key_der.data() + public_key_der.size() ||
      EVP_PKEY_id(public_key.get()) != EVP_PKEY_ED25519) {
    throw std::runtime_error(std::string(label) + " Ed25519 public key rejected");
  }
  const auto signature_text = required_text(envelope.at("signature"), "signature", 88);
  if (signature_text.size() != 88) throw std::runtime_error(std::string(label) + " signature length rejected");
  const auto signature = base64_decode(signature_text, "signature");
  if (signature.size() != 64) throw std::runtime_error(std::string(label) + " signature size rejected");
  const auto message = canonical_json(envelope.at("body"));
  OpenSslPtr<EVP_MD_CTX, EVP_MD_CTX_free> context(EVP_MD_CTX_new(), EVP_MD_CTX_free);
  if (!context || EVP_DigestVerifyInit(context.get(), nullptr, nullptr, nullptr, public_key.get()) != 1 ||
      EVP_DigestVerify(context.get(), signature.data(), signature.size(),
                       reinterpret_cast<const unsigned char*>(message.data()), message.size()) != 1) {
    throw std::runtime_error(std::string(label) + " Ed25519 signature rejected");
  }
  return envelope.at("body");
}

struct Metrics {
  bool eligible{};
};

Metrics validate_window(const Json& window, std::uint64_t now_ms, std::uint64_t max_age_ms) {
  exact_fields(window, {"schema", "profileId", "operatorNetworkId", "sequence", "sessionId", "peerPortId",
      "workloadId", "payloadBytes", "windowStartMs", "windowEndMs", "baselineTransport", "candidateTransport",
      "operatorVerifiedPhysicalHosts", "qualificationReceiptSha256", "samples"}, "performance window");
  if (!window.at("schema").is_string() || window.at("schema").get<std::string>() != kPerformanceSchema ||
      !window.at("profileId").is_string() || window.at("profileId").get<std::string>() != kProfileId) {
    throw std::runtime_error("performance window schema/profile rejected");
  }
  (void)required_text(window.at("operatorNetworkId"), "operatorNetworkId", 128);
  if (unsigned_integer(window.at("sequence"), "sequence") < 1) throw std::runtime_error("window sequence rejected");
  static const std::regex kUuid("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
      std::regex::icase);
  static const std::regex kPortId("^strata:port:ed25519:[0-9a-f]{64}$");
  static const std::regex kHex256("^[0-9a-f]{64}$");
  const auto session_id = required_text(window.at("sessionId"), "sessionId", 36);
  const auto peer_port_id = required_text(window.at("peerPortId"), "peerPortId", 87);
  if (!matches(session_id, kUuid) || !matches(peer_port_id, kPortId)) {
    throw std::runtime_error("performance window peer/session identity rejected");
  }
  (void)required_text(window.at("workloadId"), "workloadId", 128);
  const auto payload_bytes = unsigned_integer(window.at("payloadBytes"), "payloadBytes");
  if (payload_bytes < 1 || payload_bytes > kMaximumPayloadBytes) throw std::runtime_error("payload size rejected");
  const auto start_ms = unsigned_integer(window.at("windowStartMs"), "windowStartMs");
  const auto end_ms = unsigned_integer(window.at("windowEndMs"), "windowEndMs");
  if (end_ms < start_ms || end_ms - start_ms != kWindowDurationMs) {
    throw std::runtime_error("window must span exactly five minutes");
  }
  if (end_ms > now_ms + kFutureSkewMs || now_ms - std::min(now_ms, end_ms) > max_age_ms) {
    throw std::runtime_error("performance window freshness rejected");
  }
  if (window.at("baselineTransport") != "HTTP_TCP_AES_256_GCM_BUFFERED" ||
      window.at("candidateTransport") != "SDPN_QUIC_STREAM_V1" ||
      window.at("operatorVerifiedPhysicalHosts") != true) {
    throw std::runtime_error("performance transports or physical qualification rejected");
  }
  const auto qualification_hash = required_text(window.at("qualificationReceiptSha256"), "qualificationReceiptSha256", 64);
  if (!matches(qualification_hash, kHex256)) throw std::runtime_error("qualification receipt hash rejected");
  const auto& samples = window.at("samples");
  if (!samples.is_array() || samples.size() < kMinimumPairs || samples.size() > kMaximumAttempts) {
    throw std::runtime_error("paired sample count rejected");
  }
  std::size_t baseline_success = 0;
  std::size_t candidate_success = 0;
  for (const auto& sample : samples) {
    exact_fields(sample, {"baselineLatencyUs", "candidateLatencyUs"}, "paired sample");
    const auto parse_latency = [](const Json& value, std::string_view field) -> std::optional<std::uint64_t> {
      if (value.is_null()) return std::nullopt;
      const auto latency = unsigned_integer(value, field);
      if (latency < 1 || latency > kMaximumLatencyUs) throw std::runtime_error("latency sample rejected");
      return latency;
    };
    const auto base = parse_latency(sample.at("baselineLatencyUs"), "baselineLatencyUs");
    const auto cand = parse_latency(sample.at("candidateLatencyUs"), "candidateLatencyUs");
    if (base) ++baseline_success;
    if (cand) ++candidate_success;
  }
  std::vector<std::uint64_t> paired_baseline;
  std::vector<std::uint64_t> paired_candidate;
  for (const auto& sample : samples) {
    if (!sample.at("baselineLatencyUs").is_null() && !sample.at("candidateLatencyUs").is_null()) {
      paired_baseline.push_back(unsigned_integer(sample.at("baselineLatencyUs"), "baselineLatencyUs"));
      paired_candidate.push_back(unsigned_integer(sample.at("candidateLatencyUs"), "candidateLatencyUs"));
    }
  }
  if (paired_baseline.size() < kMinimumPairs) throw std::runtime_error("at least 60 successful paired samples are required");
  const auto percentile = [](std::vector<std::uint64_t> values, double fraction) {
    std::sort(values.begin(), values.end());
    const auto index = static_cast<std::size_t>(std::ceil(values.size() * fraction)) - 1;
    return values.at(index);
  };
  const auto base_p95 = percentile(paired_baseline, 0.95);
  const auto candidate_p95 = percentile(paired_candidate, 0.95);
  const auto base_p99 = percentile(paired_baseline, 0.99);
  const auto candidate_p99 = percentile(paired_candidate, 0.99);
  const auto base_losses = samples.size() - baseline_success;
  const auto candidate_losses = samples.size() - candidate_success;
  if (candidate_p95 * 100 > base_p95 * 60 || candidate_p99 > base_p99 || candidate_losses > base_losses) {
    return {false};
  }
  return {true};
}

}  // namespace

std::string sha256_hex(const std::string& bytes) {
  std::array<unsigned char, EVP_MAX_MD_SIZE> digest{};
  unsigned int length = 0;
  if (EVP_Digest(bytes.data(), bytes.size(), digest.data(), &length, EVP_sha256(), nullptr) != 1 || length != 32) {
    throw std::runtime_error("SHA-256 digest failed");
  }
  static constexpr char kHex[] = "0123456789abcdef";
  std::string output;
  output.reserve(64);
  for (unsigned int i = 0; i < length; ++i) {
    output.push_back(kHex[digest[i] >> 4]);
    output.push_back(kHex[digest[i] & 0x0f]);
  }
  return output;
}

EvidenceVerificationResult verify_signed_performance_evidence_v1(
    const nlohmann::json& evidence,
    const nlohmann::json& trusted_operator_keys,
    const nlohmann::json& trusted_physical_witness_keys,
    std::uint64_t now_ms,
    std::uint64_t max_window_age_ms) {
  exact_fields(evidence, {"schema", "performance", "physicalQualification"}, "signed evidence");
  if (!evidence.at("schema").is_string() || evidence.at("schema").get<std::string>() != kEvidenceSchema) {
    throw std::runtime_error("signed evidence schema rejected");
  }
  if (!trusted_operator_keys.is_object() || !trusted_physical_witness_keys.is_object()) {
    throw std::runtime_error("operator and physical witness trust maps are required");
  }
  const auto& performance_envelope = evidence.at("performance");
  const auto& qualification_envelope = evidence.at("physicalQualification");
  const auto window = verify_signed_body(performance_envelope, trusted_operator_keys, "performance");
  const auto metrics = validate_window(window, now_ms, max_window_age_ms);
  if (!metrics.eligible) throw std::runtime_error("performance target or p99/loss guardrail missed");
  const auto qualification = verify_signed_body(qualification_envelope, trusted_physical_witness_keys, "physical qualification");
  exact_fields(qualification, {"schema", "profileId", "operatorNetworkId", "sessionId", "peerPortId", "workloadId",
      "payloadBytes", "issuedAtMs", "expiresAtMs", "baselineHostId", "candidateHostId", "independentPhysicalHosts",
      "virtualized", "witnessMethod", "networkPathSha256", "routeTableChanges", "publicExposure"},
      "physical qualification body");
  if (qualification_envelope.at("keyId") == performance_envelope.at("keyId")) {
    throw std::runtime_error("performance signer and physical witness must be distinct");
  }
  if (!qualification.at("schema").is_string() || qualification.at("schema").get<std::string>() != kQualificationSchema ||
      !qualification.at("profileId").is_string() || qualification.at("profileId").get<std::string>() != kProfileId ||
      qualification.at("operatorNetworkId") != window.at("operatorNetworkId") ||
      qualification.at("sessionId") != window.at("sessionId") ||
      qualification.at("peerPortId") != window.at("peerPortId") ||
      qualification.at("workloadId") != window.at("workloadId") ||
      unsigned_integer(qualification.at("payloadBytes"), "qualification payloadBytes") !=
          unsigned_integer(window.at("payloadBytes"), "window payloadBytes")) {
    throw std::runtime_error("physical qualification binding rejected");
  }
  const auto issued = unsigned_integer(qualification.at("issuedAtMs"), "qualification issuedAtMs");
  const auto expires = unsigned_integer(qualification.at("expiresAtMs"), "qualification expiresAtMs");
  const auto window_start = unsigned_integer(window.at("windowStartMs"), "windowStartMs");
  const auto window_end = unsigned_integer(window.at("windowEndMs"), "windowEndMs");
  if (expires <= issued || expires - issued > kMaximumQualificationTtlMs || issued > window_start ||
      expires < window_end || issued > now_ms + kFutureSkewMs || expires <= now_ms) {
    throw std::runtime_error("physical qualification freshness rejected");
  }
  static const std::regex kHostFingerprint("^sha256:[0-9a-f]{64}$");
  static const std::regex kHash("^[0-9a-f]{64}$");
  const auto baseline_host = required_text(qualification.at("baselineHostId"), "baselineHostId", 71);
  const auto candidate_host = required_text(qualification.at("candidateHostId"), "candidateHostId", 71);
  const auto network_path = required_text(qualification.at("networkPathSha256"), "networkPathSha256", 64);
  if (!matches(baseline_host, kHostFingerprint) || !matches(candidate_host, kHostFingerprint) ||
      baseline_host == candidate_host || !matches(network_path, kHash) ||
      qualification.at("independentPhysicalHosts") != true || qualification.at("virtualized") != false ||
      qualification.at("witnessMethod") != "INDEPENDENT_PHYSICAL_WITNESS" ||
      qualification.at("routeTableChanges") != false || qualification.at("publicExposure") != false) {
    throw std::runtime_error("physical qualification claims rejected");
  }
  const auto qualification_hash = sha256_hex(canonical_json(qualification_envelope));
  const auto& expected_qualification_hash = window.at("qualificationReceiptSha256");
  if (!expected_qualification_hash.is_string() ||
      qualification_hash != expected_qualification_hash.get<std::string>() ||
      window.at("operatorVerifiedPhysicalHosts") != true) {
    throw std::runtime_error("qualification receipt digest binding rejected");
  }
  return {
      performance_envelope.at("keyId").get<std::string>(),
      qualification_envelope.at("keyId").get<std::string>(),
      sha256_hex(canonical_json(window)),
      qualification_hash
  };
}

}  // namespace kindred::sdpn
