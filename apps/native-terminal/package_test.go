package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func preparePackage(t *testing.T) (*Terminal, string, string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	var output bytes.Buffer
	term, err := NewTerminal(strings.NewReader(""), &output, &output)
	if err != nil {
		t.Fatal(err)
	}
	term.HistoryPath = ""
	keys := filepath.Join(home, "keys")
	if err := term.Execute([]string{"pkg", "keygen", keys}); err != nil {
		t.Fatal(err)
	}
	bundle := filepath.Join(home, "bundle")
	if err := os.Mkdir(bundle, 0700); err != nil {
		t.Fatal(err)
	}
	name := "hello.sh"
	if runtime.GOOS == "windows" {
		name = "hello.ps1"
	}
	if err := os.WriteFile(filepath.Join(bundle, name), []byte("echo hello\n"), 0700); err != nil {
		t.Fatal(err)
	}
	m := packageManifest{Schema: packageSchema, Name: "hello-tool", Version: "1.0.0", Entry: name}
	data, _ := json.Marshal(m)
	if err := os.WriteFile(filepath.Join(bundle, "sdpn-package.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := term.Execute([]string{"pkg", "sign", bundle, filepath.Join(keys, "publisher.key")}); err != nil {
		t.Fatal(err)
	}
	return term, bundle, keys
}

func TestSignedPackageTrustAndInstall(t *testing.T) {
	term, bundle, keys := preparePackage(t)
	if err := term.Execute([]string{"pkg", "verify", bundle}); err == nil {
		t.Fatal("untrusted publisher accepted")
	}
	if err := term.Execute([]string{"pkg", "trust", filepath.Join(keys, "publisher.pub")}); err != nil {
		t.Fatal(err)
	}
	if err := term.Execute([]string{"pkg", "verify", bundle}); err != nil {
		t.Fatal(err)
	}
	if err := term.Execute([]string{"pkg", "install", bundle}); err != nil {
		t.Fatal(err)
	}
	if err := term.Execute([]string{"pkg", "install", bundle}); err == nil {
		t.Fatal("duplicate version overwritten")
	}
	if err := term.Execute([]string{"pkg", "list"}); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if err := term.Execute([]string{"pkg", "exec", "hello-tool", "1.0.0"}); err != nil {
			t.Fatal(err)
		}
	}
}
func TestRejectPackageTamperingAndTraversal(t *testing.T) {
	term, bundle, keys := preparePackage(t)
	if err := term.Execute([]string{"pkg", "trust", filepath.Join(keys, "publisher.pub")}); err != nil {
		t.Fatal(err)
	}
	name := "hello.sh"
	if runtime.GOOS == "windows" {
		name = "hello.ps1"
	}
	if err := os.WriteFile(filepath.Join(bundle, name), []byte("echo malicious\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := term.Execute([]string{"pkg", "verify", bundle}); err == nil {
		t.Fatal("tampered bundle accepted")
	}
	if safePackagePath("../escape") || safePackagePath("/absolute") || safePackagePath("a/../../b") || safePackagePath("a\\b") {
		t.Fatal("path traversal accepted")
	}
}
func TestPublisherKeyNeverInSignedBundle(t *testing.T) {
	term, bundle, keys := preparePackage(t)
	b, err := os.ReadFile(filepath.Join(keys, "publisher.key"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bundle, "publisher.key"), b, 0600); err != nil {
		t.Fatal(err)
	}
	if err := term.Execute([]string{"pkg", "sign", bundle, filepath.Join(keys, "publisher.key")}); err == nil {
		t.Fatal("private key included in signed bundle")
	}
}
