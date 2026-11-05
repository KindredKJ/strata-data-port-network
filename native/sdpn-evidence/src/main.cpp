#include "sdpn_evidence.hpp"

#include <chrono>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

nlohmann::json read_json(const std::string& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) throw std::runtime_error("cannot open input file: " + path);
  nlohmann::json value;
  input >> value;
  return value;
}

std::uint64_t current_epoch_ms() {
  return static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::system_clock::now().time_since_epoch()).count());
}

void usage() {
  std::cerr << "usage: sdpn-evidence-verify --evidence FILE --operator-trust FILE --witness-trust FILE [--now-ms EPOCH_MS]\n";
}

}  // namespace

int main(int argc, char** argv) {
  try {
    std::string evidence_path;
    std::string operator_trust_path;
    std::string witness_trust_path;
    std::uint64_t now_ms = current_epoch_ms();
    for (int i = 1; i < argc; ++i) {
      const std::string arg = argv[i];
      if (arg == "--evidence" && i + 1 < argc) evidence_path = argv[++i];
      else if (arg == "--operator-trust" && i + 1 < argc) operator_trust_path = argv[++i];
      else if (arg == "--witness-trust" && i + 1 < argc) witness_trust_path = argv[++i];
      else if (arg == "--now-ms" && i + 1 < argc) now_ms = std::stoull(argv[++i]);
      else { usage(); return 2; }
    }
    if (evidence_path.empty() || operator_trust_path.empty() || witness_trust_path.empty()) {
      usage();
      return 2;
    }
    const auto result = kindred::sdpn::verify_signed_performance_evidence_v1(
        read_json(evidence_path), read_json(operator_trust_path), read_json(witness_trust_path), now_ms);
    std::cout << nlohmann::json{
      {"schema", "kindred.sdpn.evidence-verification-result.v1"},
      {"valid", true},
      {"performanceKeyId", result.performance_key_id},
      {"witnessKeyId", result.witness_key_id},
      {"performanceWindowSha256", result.performance_window_sha256},
      {"qualificationReceiptSha256", result.qualification_receipt_sha256},
      {"routeTableChanges", false}
    }.dump() << '\n';
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "evidence rejected: " << error.what() << '\n';
    return 1;
  }
}
