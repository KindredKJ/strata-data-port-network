package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testSecret = "sdpx-test-ephemeral-32-plus-characters-abcdef"

func TestCompatibleNativeProofAndTamper(t *testing.T) {
	srv, err := StartProofReceiver("127.0.0.1", 0, testSecret)
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	payload := []byte("SDPN native cross-platform encrypted proof")
	receipt, err := SendProof(context.Background(), "127.0.0.1", srv.Port, payload, testSecret)
	if err != nil {
		t.Fatal(err)
	}
	if !receipt.AuthenticationVerified || !receipt.IntegrityVerified || !receipt.EncryptedOnWire || !receipt.LoopbackObserved || receipt.TwoHostNetworkProofSatisfied || receipt.PhysicalMachineAttestationProven {
		t.Fatalf("invalid claim: %+v", receipt)
	}
	if receipt.ReceivedSHA256 != digest(payload) {
		t.Fatal("receipt hash mismatch")
	}
	b, _ := json.Marshal(receipt)
	if err = VerifyReceiptJSON(b, testSecret); err != nil {
		t.Fatal(err)
	}
	var tampered map[string]any
	if err = json.Unmarshal(b, &tampered); err != nil {
		t.Fatal(err)
	}
	tampered["payloadBytes"] = 1
	altered, _ := json.Marshal(tampered)
	if err = VerifyReceiptJSON(altered, testSecret); err == nil {
		t.Fatal("tampered payload accepted")
	}
	if err = VerifyReceiptJSON(b, "wrong"+testSecret); err == nil {
		t.Fatal("wrong-secret MAC accepted")
	}
}
func TestRejectExternalNetworkAndEmptyInput(t *testing.T) {
	for _, h := range []string{"8.8.8.8", "localhost", "0.0.0.0", "example.com"} {
		if _, err := SendProof(context.Background(), h, 47900, []byte("x"), testSecret); err == nil {
			t.Fatalf("unsafe address accepted %s", h)
		}
	}
	if _, err := SendProof(context.Background(), "127.0.0.1", 47900, nil, testSecret); err == nil {
		t.Fatal("empty payload accepted")
	}
}
func TestReceiptVerificationCLI(t *testing.T) {
	srv, err := StartProofReceiver("127.0.0.1", 0, testSecret)
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	r, err := SendProof(context.Background(), "127.0.0.1", srv.Port, []byte("signature verified"), testSecret)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(r)
	dir := t.TempDir()
	path := filepath.Join(dir, "receipt.json")
	if err = os.WriteFile(path, b, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KINDRED_SDPN_PROOF_SECRET", testSecret)
	term, err := NewTerminal(strings.NewReader(""), os.Stdout, os.Stderr)
	if err != nil {
		t.Fatal(err)
	}
	if err := term.Execute([]string{"sdpn", "verify", path}); err != nil {
		t.Fatal(err)
	}
}
func TestHKDFDeterminism(t *testing.T) {
	k1, err := sessionKey(testSecret, strings.Repeat("a", 64), "test-session")
	if err != nil {
		t.Fatal(err)
	}
	k2, err := sessionKey(testSecret, strings.Repeat("a", 64), "test-session")
	if err != nil {
		t.Fatal(err)
	}
	if len(k1) != 32 || string(k1) != string(k2) {
		t.Fatal("invalid HKDF")
	}
}
