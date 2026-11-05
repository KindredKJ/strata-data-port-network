cmake_minimum_required(VERSION 3.24)
project(sdpn_quic_pilot VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

include(FetchContent)

# MsQuic v2.6.3 is pinned to Microsoft's signed release commit. Its recursive
# QuicTLS submodule is fetched at the gitlink revision recorded by that commit.
set(QUIC_TLS_LIB "quictls" CACHE STRING "MsQuic TLS provider" FORCE)
set(QUIC_BUILD_SHARED ON CACHE BOOL "Build MsQuic shared library" FORCE)
set(QUIC_BUILD_TOOLS OFF CACHE BOOL "Disable MsQuic tools" FORCE)
set(QUIC_BUILD_TEST OFF CACHE BOOL "Disable upstream test targets" FORCE)
set(QUIC_BUILD_PERF OFF CACHE BOOL "Disable upstream perf targets" FORCE)
set(QUIC_ENABLE_LOGGING OFF CACHE BOOL "Disable verbose upstream logging" FORCE)
set(QUIC_USE_SYSTEM_LIBCRYPTO ON CACHE BOOL "Use system libcrypto with bundled QuicTLS" FORCE)
set(QUIC_SOURCE_LINK OFF CACHE BOOL "Disable source-link generation" FORCE)
set(QUIC_EMBED_GIT_HASH OFF CACHE BOOL "Disable upstream git metadata" FORCE)

FetchContent_Declare(
  msquic
  GIT_REPOSITORY https://github.com/microsoft/msquic.git
  GIT_TAG 16ca4d8d785d34fb22285e7c652e477ac16475a5
  GIT_SUBMODULES_RECURSE TRUE
  GIT_SHALLOW FALSE
)
FetchContent_MakeAvailable(msquic)

add_executable(sdpn-quic-pilot src/main.cpp)
target_include_directories(sdpn-quic-pilot PRIVATE "${msquic_SOURCE_DIR}/src/inc")
target_link_libraries(sdpn-quic-pilot PRIVATE msquic::msquic)
target_compile_options(sdpn-quic-pilot PRIVATE -Wall -Wextra -Werror)
set_target_properties(sdpn-quic-pilot PROPERTIES BUILD_RPATH "$<TARGET_FILE_DIR:msquic>")

include(CTest)
if(BUILD_TESTING)
  add_test(
    NAME sdpn-quic-pilot-loopback
    COMMAND bash "${CMAKE_CURRENT_SOURCE_DIR}/tests/loopback-mtls.sh" "$<TARGET_FILE:sdpn-quic-pilot>"
  )
  set_tests_properties(sdpn-quic-pilot-loopback PROPERTIES TIMEOUT 180)
endif()
