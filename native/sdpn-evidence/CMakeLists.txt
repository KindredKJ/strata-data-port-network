cmake_minimum_required(VERSION 3.20)
project(sdpn_evidence_verifier VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(OpenSSL 3.0 REQUIRED COMPONENTS Crypto)
find_package(nlohmann_json 3.11 REQUIRED)

add_library(sdpn_evidence_verifier STATIC src/evidence.cpp)
target_include_directories(sdpn_evidence_verifier PUBLIC include)
target_link_libraries(sdpn_evidence_verifier PUBLIC OpenSSL::Crypto nlohmann_json::nlohmann_json)
target_compile_options(sdpn_evidence_verifier PRIVATE -Wall -Wextra -Wpedantic -Werror)

add_executable(sdpn-evidence-verify src/main.cpp)
target_link_libraries(sdpn-evidence-verify PRIVATE sdpn_evidence_verifier)
target_compile_options(sdpn-evidence-verify PRIVATE -Wall -Wextra -Wpedantic -Werror)

include(CTest)
if(BUILD_TESTING)
  add_executable(sdpn-evidence-verifier-test tests/evidence_test.cpp)
  target_link_libraries(sdpn-evidence-verifier-test PRIVATE sdpn_evidence_verifier)
  target_compile_options(sdpn-evidence-verifier-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
  add_test(NAME sdpn-evidence-verifier-test COMMAND sdpn-evidence-verifier-test)
endif()
