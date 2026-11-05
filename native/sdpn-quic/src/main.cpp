#include "msquic.h"

#include <arpa/inet.h>
#include <fcntl.h>
#include <signal.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <map>
#include <mutex>
#include <new>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

constexpr char kAlpnText[] = "sdpn/1";
constexpr std::uint8_t kWireVersion = 1;
constexpr std::uint8_t kProbeType = 0x30;
constexpr std::uint8_t kEchoType = 0x31;
constexpr std::size_t kHeaderBytes = 12;
constexpr std::size_t kMaxBodyBytes = 32U * 1024U * 1024U;
constexpr std::uint64_t kHandshakeTimeoutMs = 45'000;
constexpr std::uint64_t kIdleTimeoutMs = 120'000;
constexpr std::uint32_t kDefaultPort = 47901;
constexpr std::uint32_t kDefaultTrials = 12;
constexpr std::uint32_t kDefaultPayloadBytes = 64U * 1024U;
constexpr std::uint32_t kMinClientTimeoutMs = 30'000;
constexpr std::uint32_t kMaxClientTimeoutMs = 120'000;

std::atomic<bool> gRunning{true};

void onSignal(int) { gRunning.store(false); }

struct Options {
  std::string mode;
  std::string bindAddress;
  std::string serverAddress;
  std::string certificate;
  std::string privateKey;
  std::string caCertificate;
  std::string outputPath;
  std::uint32_t port{kDefaultPort};
  std::uint32_t trials{kDefaultTrials};
  std::uint32_t payloadBytes{kDefaultPayloadBytes};
  std::uint32_t timeoutMs{kMaxClientTimeoutMs};
  bool allowLoopback{false};
};

std::uint32_t parsePositive(const std::string& value, const std::string& name,
                            std::uint32_t minimum, std::uint32_t maximum) {
  std::size_t consumed = 0;
  unsigned long parsed = 0;
  try {
    parsed = std::stoul(value, &consumed, 10);
  } catch (...) {
    throw std::invalid_argument(name + " must be a decimal integer");
  }
  if (consumed != value.size() || parsed < minimum || parsed > maximum) {
    throw std::invalid_argument(name + " must be between " +
                                std::to_string(minimum) + " and " +
                                std::to_string(maximum));
  }
  return static_cast<std::uint32_t>(parsed);
}

Options parseOptions(int argc, char** argv) {
  if (argc < 2) throw std::invalid_argument("mode must be server or client");
  Options options;
  options.mode = argv[1];
  if (options.mode != "server" && options.mode != "client") {
    throw std::invalid_argument("mode must be server or client");
  }

  const std::map<std::string, std::string*> values{
      {"--bind-address", &options.bindAddress},
      {"--server-address", &options.serverAddress},
      {"--cert", &options.certificate},
      {"--key", &options.privateKey},
      {"--ca", &options.caCertificate},
      {"--output", &options.outputPath},
  };
  const std::map<std::string, std::uint32_t*> numbers{
      {"--port", &options.port},
      {"--trials", &options.trials},
      {"--payload-bytes", &options.payloadBytes},
      {"--timeout-ms", &options.timeoutMs},
  };
  std::map<std::string, bool> seen;
  for (int i = 2; i < argc; ++i) {
    const std::string name = argv[i];
    if (name == "--allow-loopback") {
      if (seen[name]) throw std::invalid_argument("duplicate argument: " + name);
      seen[name] = true;
      options.allowLoopback = true;
      continue;
    }
    if (seen[name]) throw std::invalid_argument("duplicate argument: " + name);
    seen[name] = true;
    if (i + 1 >= argc || std::string(argv[i + 1]).starts_with("--")) {
      throw std::invalid_argument("missing value for " + name);
    }
    const std::string value = argv[++i];
    if (const auto found = values.find(name); found != values.end()) {
      *found->second = value;
    } else if (const auto number = numbers.find(name); number != numbers.end()) {
      const auto minimum = name == "--port" ? 1U :
                           name == "--trials" ? 1U :
                           name == "--payload-bytes" ? 1U : kMinClientTimeoutMs;
      const auto maximum = name == "--port" ? 65535U :
                           name == "--trials" ? 1000U :
                           name == "--payload-bytes"
                               ? static_cast<std::uint32_t>(kMaxBodyBytes - 8U)
                               : kMaxClientTimeoutMs;
      *number->second = parsePositive(value, name, minimum, maximum);
    } else {
      throw std::invalid_argument("unknown argument: " + name);
    }
  }

  if (options.certificate.empty() || options.privateKey.empty() ||
      options.caCertificate.empty()) {
    throw std::invalid_argument("--cert, --key, and --ca are required");
  }
  if (options.mode == "server" && options.bindAddress.empty()) {
    throw std::invalid_argument("server requires --bind-address RFC1918_IPV4");
  }
  if (options.mode == "client" && options.serverAddress.empty()) {
    throw std::invalid_argument("client requires --server-address RFC1918_IPV4");
  }
  if (options.mode == "client" && options.timeoutMs < kMinClientTimeoutMs) {
    throw std::invalid_argument("--timeout-ms must be between 30000 and 120000");
  }
  return options;
}

bool isRfc1918(std::uint32_t hostOrder) {
  const auto first = (hostOrder >> 24U) & 0xffU;
  const auto second = (hostOrder >> 16U) & 0xffU;
  return first == 10U || (first == 172U && second >= 16U && second <= 31U) ||
         (first == 192U && second == 168U);
}

bool isLoopback(std::uint32_t hostOrder) {
  return ((hostOrder >> 24U) & 0xffU) == 127U;
}

in_addr validateIpv4(const std::string& value, bool allowLoopback) {
  in_addr address{};
  if (inet_pton(AF_INET, value.c_str(), &address) != 1) {
    throw std::invalid_argument("endpoint must be a literal IPv4 address");
  }
  char canonical[INET_ADDRSTRLEN]{};
  if (inet_ntop(AF_INET, &address, canonical, sizeof(canonical)) == nullptr ||
      value != canonical) {
    throw std::invalid_argument("endpoint IPv4 address must be canonical");
  }
  const auto hostOrder = ntohl(address.s_addr);
  if (isLoopback(hostOrder) && allowLoopback) return address;
  if (!isRfc1918(hostOrder)) {
    throw std::invalid_argument(
        "endpoint must be RFC1918 IPv4; use --allow-loopback for local tests");
  }
  return address;
}

std::uint32_t readBigEndian32(const std::uint8_t* bytes) {
  return (static_cast<std::uint32_t>(bytes[0]) << 24U) |
         (static_cast<std::uint32_t>(bytes[1]) << 16U) |
         (static_cast<std::uint32_t>(bytes[2]) << 8U) |
         static_cast<std::uint32_t>(bytes[3]);
}

void writeBigEndian32(std::uint8_t* bytes, std::uint32_t value) {
  bytes[0] = static_cast<std::uint8_t>(value >> 24U);
  bytes[1] = static_cast<std::uint8_t>(value >> 16U);
  bytes[2] = static_cast<std::uint8_t>(value >> 8U);
  bytes[3] = static_cast<std::uint8_t>(value);
}

std::vector<std::uint8_t> makeRecord(std::uint8_t type, std::uint64_t sequence,
                                    std::uint32_t payloadBytes,
                                    std::uint32_t trialIndex) {
  const auto bodyBytes = static_cast<std::size_t>(payloadBytes) + 8U;
  std::vector<std::uint8_t> record(kHeaderBytes + bodyBytes);
  record[0] = 'S';
  record[1] = 'D';
  record[2] = 'P';
  record[3] = 'N';
  record[4] = kWireVersion;
  record[5] = type;
  record[6] = 0;
  record[7] = 0;
  writeBigEndian32(record.data() + 8, static_cast<std::uint32_t>(bodyBytes));
  for (std::size_t i = 0; i < 8; ++i) {
    record[kHeaderBytes + i] = static_cast<std::uint8_t>(sequence >> (56U - 8U * i));
  }
  for (std::size_t i = 0; i < payloadBytes; ++i) {
    record[kHeaderBytes + 8U + i] = static_cast<std::uint8_t>(
        (i * 31U + static_cast<std::size_t>(trialIndex) * 17U) & 0xffU);
  }
  return record;
}

bool validRecord(const std::vector<std::uint8_t>& bytes, std::uint8_t type) {
  if (bytes.size() < kHeaderBytes + 8U || bytes.size() > kHeaderBytes + kMaxBodyBytes) {
    return false;
  }
  return bytes[0] == 'S' && bytes[1] == 'D' && bytes[2] == 'P' && bytes[3] == 'N' &&
         bytes[4] == kWireVersion && bytes[5] == type && bytes[6] == 0 && bytes[7] == 0 &&
         readBigEndian32(bytes.data() + 8) == bytes.size() - kHeaderBytes;
}

bool matchesEcho(const std::vector<std::uint8_t>& request,
                 const std::vector<std::uint8_t>& response) {
  if (!validRecord(request, kProbeType) || !validRecord(response, kEchoType) ||
      request.size() != response.size()) {
    return false;
  }
  return std::equal(request.begin(), request.begin() + 5, response.begin()) &&
         std::equal(request.begin() + 6, request.end(), response.begin() + 6);
}

struct ServerState {
  const QUIC_API_TABLE* api{};
  HQUIC configuration{};
  std::atomic<std::uint32_t> activeConnections{0};
  std::mutex mutex;
  std::condition_variable changed;
};

struct ServerStreamState {
  const QUIC_API_TABLE* api{};
  std::vector<std::uint8_t> received;
  std::vector<std::uint8_t> response;
};

QUIC_STATUS QUIC_API serverStreamCallback(HQUIC stream, void* context,
                                          QUIC_STREAM_EVENT* event) {
  auto* state = static_cast<ServerStreamState*>(context);
  switch (event->Type) {
    case QUIC_STREAM_EVENT_RECEIVE: {
      const auto limit = kHeaderBytes + kMaxBodyBytes;
      if (state->received.size() + event->RECEIVE.TotalBufferLength > limit) {
        state->api->StreamShutdown(stream, QUIC_STREAM_SHUTDOWN_FLAG_ABORT, 0x10U);
        state->api->StreamReceiveComplete(stream, event->RECEIVE.TotalBufferLength);
        return QUIC_STATUS_SUCCESS;
      }
      try {
        for (std::uint32_t i = 0; i < event->RECEIVE.BufferCount; ++i) {
          const auto& buffer = event->RECEIVE.Buffers[i];
          state->received.insert(state->received.end(), buffer.Buffer,
                                 buffer.Buffer + buffer.Length);
        }
      } catch (...) {
        state->api->StreamReceiveComplete(stream, event->RECEIVE.TotalBufferLength);
        state->api->StreamShutdown(stream, QUIC_STREAM_SHUTDOWN_FLAG_ABORT, 0x14U);
        return QUIC_STATUS_SUCCESS;
      }
      state->api->StreamReceiveComplete(stream, event->RECEIVE.TotalBufferLength);
      break;
    }
    case QUIC_STREAM_EVENT_PEER_SEND_SHUTDOWN: {
      if (!validRecord(state->received, kProbeType)) {
        state->api->StreamShutdown(stream, QUIC_STREAM_SHUTDOWN_FLAG_ABORT, 0x11U);
        break;
      }
      state->response = state->received;
      state->response[5] = kEchoType;
      QUIC_BUFFER sendBuffer{};
      sendBuffer.Length = static_cast<std::uint32_t>(state->response.size());
      sendBuffer.Buffer = state->response.data();
      const auto status = state->api->StreamSend(
          stream, &sendBuffer, 1, QUIC_SEND_FLAG_FIN, state);
      if (QUIC_FAILED(status)) {
        state->api->StreamShutdown(stream, QUIC_STREAM_SHUTDOWN_FLAG_ABORT, 0x12U);
      }
      break;
    }
    case QUIC_STREAM_EVENT_PEER_SEND_ABORTED:
      state->api->StreamShutdown(stream, QUIC_STREAM_SHUTDOWN_FLAG_ABORT, 0x13U);
      break;
    case QUIC_STREAM_EVENT_SHUTDOWN_COMPLETE:
      state->api->StreamClose(stream);
      delete state;
      break;
    default:
      break;
  }
  return QUIC_STATUS_SUCCESS;
}

QUIC_STATUS QUIC_API serverConnectionCallback(HQUIC connection, void* context,
                                              QUIC_CONNECTION_EVENT* event) {
  auto* state = static_cast<ServerState*>(context);
  switch (event->Type) {
    case QUIC_CONNECTION_EVENT_PEER_STREAM_STARTED: {
      auto* streamState = new (std::nothrow) ServerStreamState{state->api, {}, {}};
      if (streamState == nullptr) return QUIC_STATUS_OUT_OF_MEMORY;
      state->api->SetCallbackHandler(
          event->PEER_STREAM_STARTED.Stream,
          reinterpret_cast<void*>(serverStreamCallback), streamState);
      break;
    }
    case QUIC_CONNECTION_EVENT_SHUTDOWN_COMPLETE:
      state->api->ConnectionClose(connection);
      state->activeConnections.fetch_sub(1);
      state->changed.notify_all();
      break;
    default:
      break;
  }
  return QUIC_STATUS_SUCCESS;
}

QUIC_STATUS QUIC_API serverListenerCallback(HQUIC, void* context,
                                            QUIC_LISTENER_EVENT* event) {
  auto* state = static_cast<ServerState*>(context);
  if (event->Type != QUIC_LISTENER_EVENT_NEW_CONNECTION) return QUIC_STATUS_SUCCESS;
  state->api->SetCallbackHandler(event->NEW_CONNECTION.Connection,
                                 reinterpret_cast<void*>(serverConnectionCallback), state);
  state->activeConnections.fetch_add(1);
  const auto status = state->api->ConnectionSetConfiguration(
      event->NEW_CONNECTION.Connection, state->configuration);
  return status;
}

struct ClientTrial {
  const QUIC_API_TABLE* api{};
  HQUIC connection{};
  HQUIC stream{};
  std::mutex mutex;
  std::condition_variable changed;
  std::vector<std::uint8_t> request;
  std::vector<std::uint8_t> response;
  std::chrono::steady_clock::time_point startedAt;
  double exchangeMs{};
  bool echoValid{false};
  bool connectionClosed{false};
  std::string error;
};

void failClientTrial(ClientTrial* trial, const std::string& reason) {
  bool shouldShutdown = false;
  {
    std::lock_guard lock(trial->mutex);
    if (!trial->echoValid && trial->error.empty()) trial->error = reason;
    shouldShutdown = trial->connection != nullptr && !trial->connectionClosed;
  }
  trial->changed.notify_all();
  if (shouldShutdown) {
    trial->api->ConnectionShutdown(trial->connection,
                                   QUIC_CONNECTION_SHUTDOWN_FLAG_NONE, 0x20U);
  }
}

QUIC_STATUS QUIC_API clientStreamCallback(HQUIC stream, void* context,
                                          QUIC_STREAM_EVENT* event) {
  auto* trial = static_cast<ClientTrial*>(context);
  switch (event->Type) {
    case QUIC_STREAM_EVENT_RECEIVE: {
      const auto limit = kHeaderBytes + kMaxBodyBytes;
      bool oversize = false;
      {
        std::lock_guard lock(trial->mutex);
        oversize = trial->response.size() + event->RECEIVE.TotalBufferLength > limit;
        if (!oversize) {
          try {
            for (std::uint32_t i = 0; i < event->RECEIVE.BufferCount; ++i) {
              const auto& buffer = event->RECEIVE.Buffers[i];
              trial->response.insert(trial->response.end(), buffer.Buffer,
                                     buffer.Buffer + buffer.Length);
            }
          } catch (...) {
            oversize = true;
          }
        }
      }
      trial->api->StreamReceiveComplete(stream, event->RECEIVE.TotalBufferLength);
      if (oversize) failClientTrial(trial, "QUIC echo exceeded the record limit");
      break;
    }
    case QUIC_STREAM_EVENT_PEER_SEND_SHUTDOWN: {
      std::lock_guard lock(trial->mutex);
      trial->echoValid = matchesEcho(trial->request, trial->response);
      if (!trial->echoValid && trial->error.empty()) {
        trial->error = "QUIC echo framing or payload verification failed";
      }
      if (trial->echoValid) {
        trial->exchangeMs = std::chrono::duration<double, std::milli>(
                               std::chrono::steady_clock::now() - trial->startedAt)
                               .count();
      }
      trial->changed.notify_all();
      break;
    }
    case QUIC_STREAM_EVENT_PEER_SEND_ABORTED:
      failClientTrial(trial, "QUIC peer aborted the probe stream");
      break;
    case QUIC_STREAM_EVENT_SHUTDOWN_COMPLETE:
      trial->api->StreamClose(stream);
      trial->api->ConnectionShutdown(trial->connection,
                                     QUIC_CONNECTION_SHUTDOWN_FLAG_NONE, 0);
      break;
    default:
      break;
  }
  return QUIC_STATUS_SUCCESS;
}

QUIC_STATUS QUIC_API clientConnectionCallback(HQUIC connection, void* context,
                                              QUIC_CONNECTION_EVENT* event) {
  auto* trial = static_cast<ClientTrial*>(context);
  switch (event->Type) {
    case QUIC_CONNECTION_EVENT_CONNECTED: {
      HQUIC stream{};
      auto status = trial->api->StreamOpen(connection, QUIC_STREAM_OPEN_FLAG_NONE,
                                            clientStreamCallback, trial, &stream);
      if (QUIC_FAILED(status)) {
        failClientTrial(trial, "MsQuic StreamOpen failed");
        return QUIC_STATUS_SUCCESS;
      }
      {
        std::lock_guard lock(trial->mutex);
        trial->stream = stream;
      }
      status = trial->api->StreamStart(stream, QUIC_STREAM_START_FLAG_NONE);
      if (QUIC_FAILED(status)) {
        failClientTrial(trial, "MsQuic StreamStart failed");
        return QUIC_STATUS_SUCCESS;
      }
      QUIC_BUFFER sendBuffer{};
      sendBuffer.Length = static_cast<std::uint32_t>(trial->request.size());
      sendBuffer.Buffer = trial->request.data();
      status = trial->api->StreamSend(stream, &sendBuffer, 1, QUIC_SEND_FLAG_FIN, trial);
      if (QUIC_FAILED(status)) failClientTrial(trial, "MsQuic StreamSend failed");
      break;
    }
    case QUIC_CONNECTION_EVENT_SHUTDOWN_INITIATED_BY_TRANSPORT:
      {
        std::lock_guard lock(trial->mutex);
        if (!trial->echoValid && trial->error.empty()) {
          trial->error = "QUIC transport closed before the exchange completed";
        }
      }
      trial->changed.notify_all();
      break;
    case QUIC_CONNECTION_EVENT_SHUTDOWN_INITIATED_BY_PEER:
      {
        std::lock_guard lock(trial->mutex);
        if (!trial->echoValid && trial->error.empty()) {
          trial->error = "QUIC peer closed before the exchange completed";
        }
      }
      trial->changed.notify_all();
      break;
    case QUIC_CONNECTION_EVENT_SHUTDOWN_COMPLETE:
      trial->api->ConnectionClose(connection);
      {
        std::lock_guard lock(trial->mutex);
        trial->connectionClosed = true;
      }
      trial->changed.notify_all();
      break;
    default:
      break;
  }
  return QUIC_STATUS_SUCCESS;
}

QUIC_SETTINGS makeSettings(bool server) {
  QUIC_SETTINGS settings{};
  settings.HandshakeIdleTimeoutMs = kHandshakeTimeoutMs;
  settings.IsSet.HandshakeIdleTimeoutMs = TRUE;
  settings.IdleTimeoutMs = kIdleTimeoutMs;
  settings.IsSet.IdleTimeoutMs = TRUE;
  if (server) {
    settings.PeerBidiStreamCount = 1;
    settings.IsSet.PeerBidiStreamCount = TRUE;
  }
  return settings;
}

HQUIC openConfiguration(const QUIC_API_TABLE* api, HQUIC registration,
                        const Options& options, bool server) {
  QUIC_BUFFER alpn{static_cast<std::uint32_t>(sizeof(kAlpnText) - 1U),
                   reinterpret_cast<std::uint8_t*>(const_cast<char*>(kAlpnText))};
  auto settings = makeSettings(server);
  HQUIC configuration{};
  auto status = api->ConfigurationOpen(registration, &alpn, 1, &settings,
                                       sizeof(settings), nullptr, &configuration);
  if (QUIC_FAILED(status)) throw std::runtime_error("MsQuic ConfigurationOpen failed");

  QUIC_CERTIFICATE_FILE certificateFile{};
  certificateFile.PrivateKeyFile = options.privateKey.c_str();
  certificateFile.CertificateFile = options.certificate.c_str();
  QUIC_CREDENTIAL_CONFIG credential{};
  credential.Type = QUIC_CREDENTIAL_TYPE_CERTIFICATE_FILE;
  credential.CertificateFile = &certificateFile;
  credential.CaCertificateFile = options.caCertificate.c_str();
  credential.Flags = server
                         ? static_cast<QUIC_CREDENTIAL_FLAGS>(
                               QUIC_CREDENTIAL_FLAG_REQUIRE_CLIENT_AUTHENTICATION |
                               QUIC_CREDENTIAL_FLAG_SET_CA_CERTIFICATE_FILE)
                         : static_cast<QUIC_CREDENTIAL_FLAGS>(
                               QUIC_CREDENTIAL_FLAG_CLIENT |
                               QUIC_CREDENTIAL_FLAG_SET_CA_CERTIFICATE_FILE);
  status = api->ConfigurationLoadCredential(configuration, &credential);
  if (QUIC_FAILED(status)) {
    api->ConfigurationClose(configuration);
    throw std::runtime_error("MsQuic credential load failed; verify certificate, key, and CA");
  }
  return configuration;
}

void runServer(const Options& options) {
  const auto bindAddress = validateIpv4(options.bindAddress, options.allowLoopback);
  const QUIC_API_TABLE* api{};
  auto status = MsQuicOpen2(&api);
  if (QUIC_FAILED(status)) throw std::runtime_error("MsQuicOpen2 failed");
  const QUIC_REGISTRATION_CONFIG registrationConfig{
      "kindred-sdpn-quic-pilot", QUIC_EXECUTION_PROFILE_LOW_LATENCY};
  HQUIC registration{};
  status = api->RegistrationOpen(&registrationConfig, &registration);
  if (QUIC_FAILED(status)) {
    MsQuicClose(api);
    throw std::runtime_error("MsQuic RegistrationOpen failed");
  }

  HQUIC configuration{};
  HQUIC listener{};
  try {
    configuration = openConfiguration(api, registration, options, true);
    ServerState state{};
    state.api = api;
    state.configuration = configuration;
    status = api->ListenerOpen(registration, serverListenerCallback, &state, &listener);
    if (QUIC_FAILED(status)) throw std::runtime_error("MsQuic ListenerOpen failed");

    QUIC_ADDR address{};
    address.Ipv4.sin_family = AF_INET;
    address.Ipv4.sin_port = htons(static_cast<std::uint16_t>(options.port));
    address.Ipv4.sin_addr = bindAddress;
    QUIC_BUFFER alpn{static_cast<std::uint32_t>(sizeof(kAlpnText) - 1U),
                     reinterpret_cast<std::uint8_t*>(const_cast<char*>(kAlpnText))};
    status = api->ListenerStart(listener, &alpn, 1, &address);
    if (QUIC_FAILED(status)) throw std::runtime_error("MsQuic ListenerStart failed");

    signal(SIGINT, onSignal);
    signal(SIGTERM, onSignal);
    std::cout << "SDPN_QUIC_PILOT_READY bind=" << options.bindAddress
              << " port=" << options.port << " alpn=" << kAlpnText
              << " tls=1.3 mTLS=required routeTableChanges=false"
              << " trafficRedirected=false" << std::endl;
    while (gRunning.load()) std::this_thread::sleep_for(std::chrono::milliseconds(100));
    api->ListenerStop(listener);
    api->RegistrationShutdown(registration, QUIC_CONNECTION_SHUTDOWN_FLAG_NONE, 0x30U);
    {
      std::unique_lock lock(state.mutex);
      state.changed.wait_for(lock, std::chrono::seconds(5), [&state] {
        return state.activeConnections.load() == 0;
      });
    }
    api->ListenerClose(listener);
    listener = nullptr;
    api->ConfigurationClose(configuration);
    configuration = nullptr;
    api->RegistrationClose(registration);
    registration = nullptr;
    MsQuicClose(api);
    return;
  } catch (...) {
    if (listener != nullptr) api->ListenerClose(listener);
    if (configuration != nullptr) api->ConfigurationClose(configuration);
    api->RegistrationClose(registration);
    MsQuicClose(api);
    throw;
  }
}

double percentile(const std::vector<double>& values, double fraction) {
  auto sorted = values;
  std::sort(sorted.begin(), sorted.end());
  const auto rank = static_cast<std::size_t>(
      std::max(1.0, std::ceil(static_cast<double>(sorted.size()) * fraction)));
  return sorted.at(rank - 1U);
}

double runClientTrial(const QUIC_API_TABLE* api, const Options& options, HQUIC registration,
                      HQUIC configuration, std::uint32_t trialIndex) {
  ClientTrial trial{};
  trial.api = api;
  const auto sequence = static_cast<std::uint64_t>(trialIndex) + 1U;
  trial.request = makeRecord(kProbeType, sequence, options.payloadBytes, trialIndex);
  trial.startedAt = std::chrono::steady_clock::now();
  auto status = api->ConnectionOpen(registration, clientConnectionCallback, &trial,
                                    &trial.connection);
  if (QUIC_FAILED(status)) {
    throw std::runtime_error("MsQuic ConnectionOpen failed");
  }
  status = api->ConnectionStart(trial.connection, configuration,
                                QUIC_ADDRESS_FAMILY_INET,
                                options.serverAddress.c_str(),
                                static_cast<std::uint16_t>(options.port));
  if (QUIC_FAILED(status)) {
    api->ConnectionClose(trial.connection);
    throw std::runtime_error("MsQuic ConnectionStart failed");
  }

  bool completed = false;
  {
    std::unique_lock lock(trial.mutex);
    completed = trial.changed.wait_for(
        lock, std::chrono::milliseconds(options.timeoutMs),
        [&trial] { return trial.connectionClosed; });
  }
  if (!completed) {
    api->ConnectionShutdown(trial.connection, QUIC_CONNECTION_SHUTDOWN_FLAG_NONE, 0x21U);
    std::unique_lock lock(trial.mutex);
    completed = trial.changed.wait_for(lock, std::chrono::seconds(5),
                                       [&trial] { return trial.connectionClosed; });
    lock.unlock();
    if (!completed) api->ConnectionClose(trial.connection);
  }
  std::string error;
  double elapsed = 0;
  {
    std::lock_guard lock(trial.mutex);
    error = trial.error;
    if (trial.echoValid) elapsed = trial.exchangeMs;
  }
  if (!completed) throw std::runtime_error("QUIC exchange timed out");
  if (!error.empty()) throw std::runtime_error(error);
  if (elapsed <= 0) throw std::runtime_error("QUIC exchange produced no valid echo");
  return elapsed;
}

std::string makeClientReport(const Options& options,
                             const std::vector<double>& values,
                             std::uint32_t failures) {
  const auto loopback = isLoopback(ntohl(inet_addr(options.serverAddress.c_str())));
  std::ostringstream out;
  out << std::fixed << std::setprecision(6)
      << "{\n"
      << "  \"schema\": \"kindred.sdpn.quic-pilot.measurement.v1\",\n"
      << "  \"creator\": \"Kindred Jermaine Cox\",\n"
      << "  \"organization\": \"Kindred Labs\",\n"
      << "  \"profile\": \"kindred.sdpn.quic-wire.v1\",\n"
      << "  \"alpn\": \"sdpn/1\",\n"
      << "  \"transport\": \"QUIC_v1_over_UDP_IP\",\n"
      << "  \"classification\": \"DIAGNOSTIC_NOT_GATE_EVIDENCE\",\n"
      << "  \"endpoint\": \"" << options.serverAddress << ':' << options.port << "\",\n"
      << "  \"loopback\": " << (loopback ? "true" : "false") << ",\n"
      << "  \"trials\": " << options.trials << ",\n"
      << "  \"successfulExchanges\": " << values.size() << ",\n"
      << "  \"failedExchanges\": " << failures << ",\n"
      << "  \"payloadBytes\": " << options.payloadBytes << ",\n"
      << "  \"timeoutMs\": " << options.timeoutMs << ",\n"
      << "  \"sampleScope\": \"fresh_connection_handshake_plus_reliable_stream_echo\",\n"
      << "  \"p50Ms\": " << percentile(values, 0.50) << ",\n"
      << "  \"p95Ms\": " << percentile(values, 0.95) << ",\n"
      << "  \"p99Ms\": " << percentile(values, 0.99) << ",\n"
      << "  \"baselineCompared\": false,\n"
      << "  \"fortyPercentGatePassed\": false,\n"
      << "  \"physicalHostAttestationProven\": false,\n"
      << "  \"packetLossMeasured\": false,\n"
      << "  \"routeTableChanges\": false,\n"
      << "  \"trafficRedirected\": false\n"
      << "}\n";
  return out.str();
}

void writeExclusive(const std::string& path, const std::string& contents) {
  const int fd = open(path.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (fd < 0) throw std::runtime_error("cannot create evidence file exclusively: " + path);
  std::size_t offset = 0;
  while (offset < contents.size()) {
    const auto written = write(fd, contents.data() + offset, contents.size() - offset);
    if (written <= 0) {
      close(fd);
      throw std::runtime_error("failed to write evidence file: " + path);
    }
    offset += static_cast<std::size_t>(written);
  }
  const auto syncStatus = fsync(fd);
  const auto closeStatus = close(fd);
  if (syncStatus != 0 || closeStatus != 0) {
    throw std::runtime_error("failed to persist evidence file: " + path);
  }
}

void runClient(const Options& options) {
  (void)validateIpv4(options.serverAddress, options.allowLoopback);
  if (options.payloadBytes + 8U > kMaxBodyBytes) {
    throw std::invalid_argument("payload exceeds SDPN diagnostic record maximum");
  }
  const QUIC_API_TABLE* api{};
  auto status = MsQuicOpen2(&api);
  if (QUIC_FAILED(status)) throw std::runtime_error("MsQuicOpen2 failed");
  const QUIC_REGISTRATION_CONFIG registrationConfig{
      "kindred-sdpn-quic-pilot", QUIC_EXECUTION_PROFILE_LOW_LATENCY};
  HQUIC registration{};
  status = api->RegistrationOpen(&registrationConfig, &registration);
  if (QUIC_FAILED(status)) {
    MsQuicClose(api);
    throw std::runtime_error("MsQuic RegistrationOpen failed");
  }
  HQUIC configuration{};
  try {
    configuration = openConfiguration(api, registration, options, false);
    std::vector<double> samples;
    std::uint32_t failures = 0;
    for (std::uint32_t i = 0; i < options.trials; ++i) {
      try {
        samples.push_back(runClientTrial(api, options, registration, configuration, i));
      } catch (const std::exception& error) {
        ++failures;
        std::cerr << "trial " << (i + 1U) << " failed: " << error.what() << '\n';
      }
    }
    if (samples.empty()) throw std::runtime_error("no QUIC exchange succeeded");
    const auto report = makeClientReport(options, samples, failures);
    if (options.outputPath.empty()) {
      std::cout << report;
    } else {
      writeExclusive(options.outputPath, report);
      std::cout << "evidencePath=" << options.outputPath << '\n' << report;
    }
    if (failures != 0) {
      throw std::runtime_error("one or more exchanges failed; report remains diagnostic only");
    }
    api->ConfigurationClose(configuration);
    api->RegistrationClose(registration);
    MsQuicClose(api);
  } catch (...) {
    if (configuration != nullptr) api->ConfigurationClose(configuration);
    api->RegistrationClose(registration);
    MsQuicClose(api);
    throw;
  }
}

void printUsage() {
  std::cerr
      << "Usage:\n"
      << "  sdpn-quic-pilot server --bind-address RFC1918_IPV4 --port 47901 "
         "--cert CERT --key KEY --ca CA [--allow-loopback]\n"
      << "  sdpn-quic-pilot client --server-address RFC1918_IPV4 --port 47901 "
         "--cert CERT --key KEY --ca CA [--trials N] [--payload-bytes N] "
         "[--timeout-ms 30000..120000] [--output NEW_FILE] [--allow-loopback]\n";
}

}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc < 2 || std::string(argv[1]) == "--help") {
      printUsage();
      return argc < 2 ? 2 : 0;
    }
    const auto options = parseOptions(argc, argv);
    if (options.mode == "server") runServer(options);
    else runClient(options);
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "sdpn-quic-pilot: " << error.what() << '\n';
    printUsage();
    return 1;
  }
}
