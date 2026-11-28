package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const schema = "kindred.sdpn.two-host-proof.v2"
const maxPayload = 32 << 20

// The first-party Go implementation uses the same SW06-F v2 wire fields,
// HKDF, AES-GCM, HMAC and receipt transcript as src/two-machine-proof.mjs.
// A proof receipt is NOT a hardware attestation or production authorization.
type proofReceipt struct {
	SchemaVersion                    string `json:"schemaVersion"`
	SessionID                        string `json:"sessionId"`
	StateID                          string `json:"stateId"`
	StateHash                        string `json:"stateHash"`
	Generation                       int    `json:"generation"`
	PayloadSHA256                    string `json:"payloadSha256"`
	ReceivedSHA256                   string `json:"receivedSha256"`
	PayloadBytes                     int    `json:"payloadBytes"`
	CiphertextBytes                  int    `json:"ciphertextBytes"`
	SourceHostFingerprint            string `json:"sourceHostFingerprint"`
	DestinationHostFingerprint       string `json:"destinationHostFingerprint"`
	DistinctHostFingerprints         bool   `json:"distinctHostFingerprints"`
	LoopbackObserved                 bool   `json:"loopbackObserved"`
	AuthenticationVerified           bool   `json:"authenticationVerified"`
	IntegrityVerified                bool   `json:"integrityVerified"`
	EncryptedOnWire                  bool   `json:"encryptedOnWire"`
	Cipher                           string `json:"cipher"`
	TransportClass                   string `json:"transportClass"`
	TwoHostNetworkProofSatisfied     bool   `json:"twoHostNetworkProofSatisfied"`
	PhysicalMachineAttestationProven bool   `json:"physicalMachineAttestationProven"`
	ProductionReadyClaim             bool   `json:"productionReadyClaim"`
	ObservedAt                       string `json:"observedAt"`
	ReceiptMAC                       string `json:"receiptMac"`
}

type hello struct {
	SchemaVersion         string `json:"schemaVersion"`
	SourceHostFingerprint string `json:"sourceHostFingerprint"`
	StateID               string `json:"stateId"`
	StateHash             string `json:"stateHash"`
	Generation            int    `json:"generation"`
	PayloadSHA256         string `json:"payloadSha256"`
	PayloadBytes          int    `json:"payloadBytes"`
}
type challenge struct {
	SchemaVersion              string `json:"schemaVersion"`
	SessionID                  string `json:"sessionId"`
	Challenge                  string `json:"challenge"`
	DestinationHostFingerprint string `json:"destinationHostFingerprint"`
	Cipher                     string `json:"cipher"`
	ExpiresInMS                int    `json:"expiresInMs"`
}

type proofSession struct {
	Hello     hello
	Challenge string
	Created   time.Time
}

type ProofServer struct {
	Port     int
	Done     chan struct{}
	HTTP     *http.Server
	Listener net.Listener
	once     sync.Once
}

func (p *ProofServer) Close() error {
	var err error
	p.once.Do(func() { err = p.HTTP.Close(); close(p.Done) })
	return err
}

func digest(data []byte) string { h := sha256.Sum256(data); return hex.EncodeToString(h[:]) }
func isSHA(s string) bool {
	if len(s) != 64 {
		return false
	}
	_, e := hex.DecodeString(s)
	return e == nil
}
func mac(secret, txt string) string {
	h := hmac.New(sha256.New, []byte(secret))
	_, _ = io.WriteString(h, txt)
	return hex.EncodeToString(h.Sum(nil))
}
func secureEqualHex(a, b string) bool {
	if !isSHA(a) || !isSHA(b) {
		return false
	}
	x, _ := hex.DecodeString(a)
	y, _ := hex.DecodeString(b)
	return hmac.Equal(x, y)
}
func boolStr(v bool) string {
	if v {
		return "true"
	}
	return "false"
}
func proofTranscript(h hello, sessionID, challengeHex, dest string) string {
	return strings.Join([]string{schema, sessionID, challengeHex, h.SourceHostFingerprint, dest, h.StateID, h.StateHash, strconv.Itoa(h.Generation), h.PayloadSHA256, strconv.Itoa(h.PayloadBytes)}, "|")
}
func receiptTranscript(r proofReceipt) string {
	return strings.Join([]string{
		r.SchemaVersion, r.SessionID, r.StateID, r.StateHash, strconv.Itoa(r.Generation), r.PayloadSHA256, r.ReceivedSHA256, strconv.Itoa(r.PayloadBytes), strconv.Itoa(r.CiphertextBytes), r.SourceHostFingerprint, r.DestinationHostFingerprint, boolStr(r.DistinctHostFingerprints), boolStr(r.LoopbackObserved), boolStr(r.AuthenticationVerified), boolStr(r.IntegrityVerified), boolStr(r.EncryptedOnWire), r.Cipher, r.TransportClass, boolStr(r.TwoHostNetworkProofSatisfied), boolStr(r.PhysicalMachineAttestationProven), boolStr(r.ProductionReadyClaim), r.ObservedAt,
	}, "|")
}
func sessionKey(secret, challengeHex, sessionID string) ([]byte, error) {
	salt, err := hex.DecodeString(challengeHex)
	if err != nil || len(salt) != 32 {
		return nil, errors.New("invalid challenge")
	}
	// RFC 5869 HKDF-SHA256, with Node hkdfSync-compatible info.
	extract := hmac.New(sha256.New, salt)
	extract.Write([]byte(secret))
	prk := extract.Sum(nil)
	expand := hmac.New(sha256.New, prk)
	expand.Write([]byte("kindred-sdpn-sw06f|" + sessionID))
	expand.Write([]byte{1})
	key := expand.Sum(nil)
	return key[:32], nil
}
func freshHex(n int) string { b := make([]byte, n); _, _ = rand.Read(b); return hex.EncodeToString(b) }
func uuid() string {
	s := freshHex(16)
	return s[0:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:32]
}
func hostFingerprint() string {
	hostname, _ := os.Hostname()
	platform := runtime.GOOS
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x64"
	}
	if arch == "386" {
		arch = "ia32"
	}
	interfaces, _ := net.Interfaces()
	macs := []string{}
	for _, x := range interfaces {
		if x.Flags&net.FlagLoopback != 0 || len(x.HardwareAddr) == 0 {
			continue
		}
		m := strings.ToLower(x.HardwareAddr.String())
		if m != "00:00:00:00:00:00" {
			macs = append(macs, m)
		}
	}
	sort.Strings(macs)
	b, _ := json.Marshal(struct {
		Hostname string   `json:"hostname"`
		Platform string   `json:"platform"`
		Arch     string   `json:"arch"`
		Macs     []string `json:"macs"`
	}{hostname, platform, arch, macs})
	return digest(b)
}
func validSecret(secret string) error {
	if len(secret) < 32 {
		return errors.New("KINDRED_SDPN_PROOF_SECRET must contain at least 32 characters")
	}
	return nil
}
func validateIPv4(host string, allowLoopback bool) error {
	ip := net.ParseIP(host)
	if ip == nil || ip.To4() == nil || ip.String() != host {
		return errors.New("host must be a canonical IPv4 literal")
	}
	v := ip.To4()
	private := v[0] == 10 || (v[0] == 172 && v[1] >= 16 && v[1] <= 31) || (v[0] == 192 && v[1] == 168)
	if allowLoopback && v[0] == 127 {
		return nil
	}
	if !private {
		return errors.New("only RFC1918 private addresses permitted; do not expose SW06-F to the public Internet")
	}
	return nil
}

func VerifyReceiptJSON(data []byte, secret string) error {
	if err := validSecret(secret); err != nil {
		return err
	}
	var r proofReceipt
	if err := json.Unmarshal(data, &r); err != nil {
		return err
	}
	if r.SchemaVersion != schema || r.Cipher != "AES-256-GCM" || r.TransportClass != "HTTP_TCP_AES_256_GCM_BUFFERED" {
		return errors.New("unexpected SW06-F protocol/cipher/transport")
	}
	if !r.AuthenticationVerified || !r.IntegrityVerified || !r.EncryptedOnWire || r.PhysicalMachineAttestationProven || r.ProductionReadyClaim {
		return errors.New("invalid receipt security or attestation flags")
	}
	if !isSHA(r.StateHash) || r.StateHash != r.PayloadSHA256 || r.PayloadSHA256 != r.ReceivedSHA256 || r.PayloadBytes <= 0 || r.CiphertextBytes != r.PayloadBytes {
		return errors.New("receipt payload integrity mismatch")
	}
	if !isSHA(r.SourceHostFingerprint) || !isSHA(r.DestinationHostFingerprint) {
		return errors.New("invalid host fingerprints")
	}
	if r.DistinctHostFingerprints != (r.SourceHostFingerprint != r.DestinationHostFingerprint) || r.TwoHostNetworkProofSatisfied != (r.DistinctHostFingerprints && !r.LoopbackObserved) {
		return errors.New("false software two-host claim")
	}
	if !secureEqualHex(r.ReceiptMAC, mac(secret, receiptTranscript(r))) {
		return errors.New("SW06-F receipt MAC invalid")
	}
	return nil
}

func SendProof(ctx context.Context, host string, port int, payload []byte, secret string) (proofReceipt, error) {
	var empty proofReceipt
	if err := validSecret(secret); err != nil {
		return empty, err
	}
	if err := validateIPv4(host, true); err != nil {
		return empty, err
	}
	if port < 1 || port > 65535 {
		return empty, errors.New("invalid TCP port")
	}
	if len(payload) < 1 || len(payload) > maxPayload {
		return empty, errors.New("payload must be between 1 byte and 32 MiB")
	}
	stateHash := digest(payload)
	h := hello{schema, hostFingerprint(), "sdpn-native:" + uuid(), stateHash, 1, stateHash, len(payload)}
	client := &http.Client{Timeout: 30 * time.Second}
	endpoint := fmt.Sprintf("http://%s:%d", host, port)
	call := func(path string, body []byte, headers map[string]string) ([]byte, error) {
		req, err := http.NewRequestWithContext(ctx, "POST", endpoint+path, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		res, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer res.Body.Close()
		data, err := io.ReadAll(io.LimitReader(res.Body, maxPayload+8192))
		if err != nil {
			return nil, err
		}
		if res.StatusCode != 200 {
			return nil, fmt.Errorf("SW06-F %s returned HTTP %d: %s", path, res.StatusCode, string(data))
		}
		return data, nil
	}
	b, _ := json.Marshal(h)
	raw, err := call("/proof/challenge", b, map[string]string{"content-type": "application/json"})
	if err != nil {
		return empty, err
	}
	var c challenge
	if err = json.Unmarshal(raw, &c); err != nil {
		return empty, err
	}
	if c.SchemaVersion != schema || c.Cipher != "AES-256-GCM" || len(c.SessionID) != 36 || !isSHA(c.Challenge) || !isSHA(c.DestinationHostFingerprint) {
		return empty, errors.New("invalid SW06-F challenge")
	}
	transcript := proofTranscript(h, c.SessionID, c.Challenge, c.DestinationHostFingerprint)
	key, err := sessionKey(secret, c.Challenge, c.SessionID)
	if err != nil {
		return empty, err
	}
	aesBlock, err := aes.NewCipher(key)
	if err != nil {
		return empty, err
	}
	gcm, err := cipher.NewGCM(aesBlock)
	if err != nil {
		return empty, err
	}
	iv := make([]byte, 12)
	if _, err = rand.Read(iv); err != nil {
		return empty, err
	}
	sealed := gcm.Seal(nil, iv, payload, []byte(transcript))
	ciphertext, tag := sealed[:len(payload)], sealed[len(payload):]
	headers := map[string]string{"content-type": "application/octet-stream", "x-kindred-session": c.SessionID, "x-kindred-proof-auth": mac(secret, transcript), "x-kindred-proof-iv": base64.RawURLEncoding.EncodeToString(iv), "x-kindred-proof-tag": base64.RawURLEncoding.EncodeToString(tag)}
	raw, err = call("/proof/transfer", ciphertext, headers)
	if err != nil {
		return empty, err
	}
	var receipt proofReceipt
	if err = json.Unmarshal(raw, &receipt); err != nil {
		return empty, err
	}
	if err := VerifyReceiptJSON(raw, secret); err != nil {
		return empty, err
	}
	if receipt.SessionID != c.SessionID || receipt.StateHash != stateHash || receipt.StateID != h.StateID || receipt.Generation != 1 || receipt.SourceHostFingerprint != h.SourceHostFingerprint || receipt.DestinationHostFingerprint != c.DestinationHostFingerprint || receipt.PayloadBytes != len(payload) {
		return empty, errors.New("receipt does not bind requested session or payload")
	}
	return receipt, nil
}

func StartProofReceiver(host string, port int, secret string) (*ProofServer, error) {
	if err := validSecret(secret); err != nil {
		return nil, err
	}
	if err := validateIPv4(host, true); err != nil {
		return nil, err
	}
	if port < 0 || port > 65535 {
		return nil, errors.New("invalid port")
	}
	listener, err := net.Listen("tcp4", fmt.Sprintf("%s:%d", host, port))
	if err != nil {
		return nil, err
	}
	var mu sync.Mutex
	sessions := make(map[string]proofSession)
	destination := hostFingerprint()
	reply := func(w http.ResponseWriter, status int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(v)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /proof/challenge", func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, 65537))
		if err != nil || len(body) > 65536 {
			reply(w, 413, map[string]string{"error": "hello_oversize"})
			return
		}
		var h hello
		if json.Unmarshal(body, &h) != nil || h.SchemaVersion != schema || !isSHA(h.SourceHostFingerprint) || len(h.StateID) < 1 || len(h.StateID) > 512 || strings.ContainsAny(h.StateID, "|\r\n") || !isSHA(h.StateHash) || h.StateHash != h.PayloadSHA256 || h.Generation < 0 || h.PayloadBytes < 1 || h.PayloadBytes > maxPayload {
			reply(w, 400, map[string]string{"error": "invalid_hello"})
			return
		}
		mu.Lock()
		defer mu.Unlock()
		now := time.Now()
		for id, s := range sessions {
			if now.Sub(s.Created) > 30*time.Second {
				delete(sessions, id)
			}
		}
		if len(sessions) >= 128 {
			reply(w, 429, map[string]string{"error": "proof_session_capacity"})
			return
		}
		id := uuid()
		challengeHex := freshHex(32)
		sessions[id] = proofSession{h, challengeHex, now}
		reply(w, 200, challenge{schema, id, challengeHex, destination, "AES-256-GCM", 30000})
	})
	mux.HandleFunc("POST /proof/transfer", func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("x-kindred-session")
		mu.Lock()
		s, ok := sessions[id]
		if ok {
			delete(sessions, id)
		}
		mu.Unlock()
		if !ok || time.Since(s.Created) > 30*time.Second {
			reply(w, 401, map[string]string{"error": "proof_session_invalid"})
			return
		}
		transcript := proofTranscript(s.Hello, id, s.Challenge, destination)
		if !secureEqualHex(r.Header.Get("x-kindred-proof-auth"), mac(secret, transcript)) {
			reply(w, 403, map[string]string{"error": "proof_auth_rejected"})
			return
		}
		ciphertext, err := io.ReadAll(io.LimitReader(r.Body, maxPayload+1))
		if err != nil || len(ciphertext) > maxPayload {
			reply(w, 413, map[string]string{"error": "payload_size_rejected"})
			return
		}
		iv, ivErr := base64.RawURLEncoding.DecodeString(r.Header.Get("x-kindred-proof-iv"))
		tag, tagErr := base64.RawURLEncoding.DecodeString(r.Header.Get("x-kindred-proof-tag"))
		if ivErr != nil || tagErr != nil || len(iv) != 12 || len(tag) != 16 {
			reply(w, 422, map[string]string{"error": "payload_decryption_failed"})
			return
		}
		key, err := sessionKey(secret, s.Challenge, id)
		if err != nil {
			reply(w, 422, map[string]string{"error": "payload_decryption_failed"})
			return
		}
		block, _ := aes.NewCipher(key)
		gcm, _ := cipher.NewGCM(block)
		plaintext, err := gcm.Open(nil, iv, append(ciphertext, tag...), []byte(transcript))
		if err != nil {
			reply(w, 422, map[string]string{"error": "payload_decryption_failed"})
			return
		}
		actualHash := digest(plaintext)
		okHash := len(plaintext) == s.Hello.PayloadBytes && actualHash == s.Hello.PayloadSHA256
		remote, _, _ := net.SplitHostPort(r.RemoteAddr)
		loopback := net.ParseIP(remote) != nil && net.ParseIP(remote).IsLoopback()
		distinct := s.Hello.SourceHostFingerprint != destination
		receipt := proofReceipt{SchemaVersion: schema, SessionID: id, StateID: s.Hello.StateID, StateHash: s.Hello.StateHash, Generation: s.Hello.Generation, PayloadSHA256: s.Hello.PayloadSHA256, ReceivedSHA256: actualHash, PayloadBytes: len(plaintext), CiphertextBytes: len(ciphertext), SourceHostFingerprint: s.Hello.SourceHostFingerprint, DestinationHostFingerprint: destination, DistinctHostFingerprints: distinct, LoopbackObserved: loopback, AuthenticationVerified: true, IntegrityVerified: okHash, EncryptedOnWire: true, Cipher: "AES-256-GCM", TransportClass: "HTTP_TCP_AES_256_GCM_BUFFERED", TwoHostNetworkProofSatisfied: distinct && !loopback && okHash, PhysicalMachineAttestationProven: false, ProductionReadyClaim: false, ObservedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z")}
		receipt.ReceiptMAC = mac(secret, receiptTranscript(receipt))
		if !okHash {
			reply(w, 422, receipt)
			return
		}
		reply(w, 200, receipt)
	})
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 35 * time.Second}
	proof := &ProofServer{Port: listener.Addr().(*net.TCPAddr).Port, HTTP: server, Listener: listener, Done: make(chan struct{})}
	go func() {
		err := server.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			fmt.Fprintln(os.Stderr, "sdpn receiver:", err)
		}
		_ = proof.Close()
	}()
	// One-shot host signals are handled by the terminal's built-in receiver.
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		select {
		case <-signals:
			_ = proof.Close()
		case <-proof.Done:
		}
		signal.Stop(signals)
	}()
	return proof, nil
}
