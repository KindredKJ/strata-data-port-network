#pragma once

#include <cstdint>
#include <string>

#include <nlohmann/json.hpp>

namespace kindred::sdpn {

struct EvidenceVerificationResult {
  std::string performance_key_id;
  std::string witness_key_id;
  std::string performance_window_sha256;
  std::string qualification_receipt_sha256;
};

EvidenceVerificationResult verify_signed_performance_evidence_v1(
    const nlohmann::json& evidence,
    const nlohmann::json& trusted_operator_keys,
    const nlohmann::json& trusted_physical_witness_keys,
    std::uint64_t now_ms,
    std::uint64_t max_window_age_ms = 600'000);

std::string sha256_hex(const std::string& bytes);

}  // namespace kindred::sdpn
