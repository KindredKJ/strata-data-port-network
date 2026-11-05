#include "sdpn_evidence.hpp"

#include <cstdint>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include <openssl/evp.h>
#include <openssl/x509.h>

namespace {

using Json = nlohmann::json;
template <typename T, void (*Free)(T*)>
using OpenSslPtr = std::unique_ptr<T, decltype(Free)>;

std::string base64(const unsigned char* data, std::size_t size) {
  std::string encoded(4 * ((size + 2) / 3), '\0');
  const int length = EVP_EncodeBlock(reinterpret_cast<unsigned char*>(encoded.data()), data, static_cast<int>(size));
  if (length < 0) throw std::runtime_error("base64 encode failed");
  encoded.resize(static_cast<std::size_t>(length));
  return encoded;
}

struct Signer {
  OpenSslPtr<EVP_PKEY, EVP_PKEY_free> private_key{nullptr, EVP_PKEY_free};
  std::vector<unsigned char> public_der;
  std::string key_id;
  Json trust{Json::object()};

  Signer() {
    OpenSslPtr<EVP_PKEY_CTX, EVP_PKEY_CTX_free> context(EVP_PKEY_CTX_new_id(EVP_PKEY_ED25519, nullptr), EVP_PKEY_CTX_free);
    EVP_PKEY* generated = nullptr;
    if (!context || EVP_PKEY_keygen_init(context.get()) != 1 || EVP_PKEY_keygen(context.get(), &generated) != 1) {
      throw std::runtime_error("Ed25519 key generation failed");
    }
    private_key.reset(generated);
    const int size = i2d_PUBKEY(private_key.get(), nullptr);
    if (size <= 0) throw std::runtime_error("public DER size failed");
    public_der.resize(static_cast<std::size_t>(size));
    auto* cursor = public_der.data();
    if (i2d_PUBKEY(private_key.get(), &cursor) != size) throw std::runtime_error("public DER encoding failed");
    key_id = kindred::sdpn::sha256_hex(std::string(reinterpret_cast<const char*>(public_der.data()), public_der.size()));
    trust[key_id] = base64(public_der.data(), public_der.size());
  }

  Json sign(const Json& body) const {
    const auto message = body.dump();
    OpenSslPtr<EVP_MD_CTX, EVP_MD_CTX_free> context(EVP_MD_CTX_new(), EVP_MD_CTX_free);
    if (!context || EVP_DigestSignInit(context.get(), nullptr, nullptr, nullptr, private_key.get()) != 1) {
      throw std::runtime_error("Ed25519 sign init failed");
    }
    std::size_t size = 0;
    if (EVP_DigestSign(context.get(), nullptr, &size,
        reinterpret_cast<const unsigned char*>(message.data()), message.size()) != 1) {
      throw std::runtime_error("Ed25519 signature size failed");
    }
    std::vector<unsigned char> signature(size);
    if (EVP_DigestSign(context.get(), signature.data(), &size,
        reinterpret_cast<const unsigned char*>(message.data()), message.size()) != 1) {
      throw std::runtime_error("Ed25519 signing failed");
    }
    signature.resize(size);
    return Json::object({{"body", body}, {"keyId", key_id}, {"signature", base64(signature.data(), signature.size())}});
  }
};

Json make_window(std::uint64_t start_ms) {
  Json samples = Json::array();
  for (int i = 0; i < 60; ++i) {
    samples.push_back(Json::object({{"baselineLatencyUs", 100'000}, {"candidateLatencyUs", 60'000}}));
  }
  return Json::object({
    {"schema", "kindred.sdpn.teleport-performance-window.v1"},
    {"profileId", "kindred.sdpn.quic-wire.v1"},
    {"operatorNetworkId", "lab-network-01"},
    {"sequence", 1},
    {"sessionId", "8f3f2a48-4831-43ea-9ff8-b8ac173976c1"},
    {"peerPortId", "strata:port:ed25519:" + std::string(64, 'a')},
    {"workloadId", "native-state-transfer-1mib"},
    {"payloadBytes", 1'048'576},
    {"windowStartMs", start_ms},
    {"windowEndMs", start_ms + 300'000},
    {"baselineTransport", "HTTP_TCP_AES_256_GCM_BUFFERED"},
    {"candidateTransport", "SDPN_QUIC_STREAM_V1"},
    {"operatorVerifiedPhysicalHosts", true},
    {"qualificationReceiptSha256", std::string(64, '0')},
    {"samples", samples}
  });
}

Json make_qualification(const Json& window, std::uint64_t issued_ms, std::uint64_t expires_ms) {
  return Json::object({
    {"schema", "kindred.sdpn.physical-host-qualification.v1"},
    {"profileId", "kindred.sdpn.quic-wire.v1"},
    {"operatorNetworkId", window.at("operatorNetworkId")},
    {"sessionId", window.at("sessionId")},
    {"peerPortId", window.at("peerPortId")},
    {"workloadId", window.at("workloadId")},
    {"payloadBytes", window.at("payloadBytes")},
    {"issuedAtMs", issued_ms},
    {"expiresAtMs", expires_ms},
    {"baselineHostId", "sha256:" + std::string(64, '1')},
    {"candidateHostId", "sha256:" + std::string(64, '2')},
    {"independentPhysicalHosts", true},
    {"virtualized", false},
    {"witnessMethod", "INDEPENDENT_PHYSICAL_WITNESS"},
    {"networkPathSha256", std::string(64, '3')},
    {"routeTableChanges", false},
    {"publicExposure", false}
  });
}

Json make_evidence(Json& window, const Signer& operator_signer, const Signer& witness_signer) {
  const auto receipt = witness_signer.sign(make_qualification(window,
      window.at("windowStartMs").get<std::uint64_t>() - 1'000,
      window.at("windowEndMs").get<std::uint64_t>() + 3'600'000));
  window["qualificationReceiptSha256"] = kindred::sdpn::sha256_hex(receipt.dump());
  return Json::object({
    {"schema", "kindred.sdpn.signed-performance-evidence.v1"},
    {"performance", operator_signer.sign(window)},
    {"physicalQualification", receipt}
  });
}

template <typename F>
void expect_rejection(F&& function, const char* label) {
  try {
    function();
  } catch (const std::exception&) {
    return;
  }
  throw std::runtime_error(std::string("expected rejection: ") + label);
}

void require(bool condition, const char* label) {
  if (!condition) throw std::runtime_error(std::string("assertion failed: ") + label);
}

}  // namespace

int main() {
  std::cerr << "fixture\n";
  Signer operator_signer;
  Signer witness_signer;
  auto window = make_window(1'000'000);
  const auto evidence = make_evidence(window, operator_signer, witness_signer);
  std::cerr << "valid evidence\n";
  const auto result = kindred::sdpn::verify_signed_performance_evidence_v1(
      evidence, operator_signer.trust, witness_signer.trust, 1'301'000);
  require(result.performance_key_id == operator_signer.key_id, "operator signer fingerprint");
  require(result.witness_key_id == witness_signer.key_id, "witness signer fingerprint");
  require(result.qualification_receipt_sha256 == window.at("qualificationReceiptSha256").get<std::string>(),
      "qualification receipt digest");

  auto tampered = evidence;
  std::cerr << "tamper\n";
  tampered["performance"]["body"]["samples"][0]["candidateLatencyUs"] = 1;
  expect_rejection([&] {
    kindred::sdpn::verify_signed_performance_evidence_v1(
        tampered, operator_signer.trust, witness_signer.trust, 1'301'000);
  }, "tampered measurement");

  auto virtualized_window = make_window(1'000'000);
  std::cerr << "virtualized fixture\n";
  auto virtualized_evidence = evidence;
  auto virtualized_body = make_qualification(virtualized_window, 999'000, 4'901'000);
  virtualized_body["virtualized"] = true;
  const auto virtualized_receipt = witness_signer.sign(virtualized_body);
  virtualized_window["qualificationReceiptSha256"] = kindred::sdpn::sha256_hex(virtualized_receipt.dump());
  virtualized_evidence["physicalQualification"] = virtualized_receipt;
  virtualized_evidence["performance"] = operator_signer.sign(virtualized_window);
  expect_rejection([&] {
    kindred::sdpn::verify_signed_performance_evidence_v1(
        virtualized_evidence, operator_signer.trust, witness_signer.trust, 1'301'000);
  }, "virtualized qualification");

  auto shared_key_window = make_window(1'000'000);
  auto shared_key_evidence = make_evidence(shared_key_window, operator_signer, operator_signer);
  expect_rejection([&] {
    kindred::sdpn::verify_signed_performance_evidence_v1(
        shared_key_evidence, operator_signer.trust, operator_signer.trust, 1'301'000);
  }, "shared operator/witness key");

  expect_rejection([&] {
    kindred::sdpn::verify_signed_performance_evidence_v1(
        evidence, operator_signer.trust, witness_signer.trust, 1'901'001);
  }, "stale measurement");

  std::cout << "C++ SDPN signed evidence verifier: 5 checks passed\n";
  return 0;
}
