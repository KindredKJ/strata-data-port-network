package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLexerQuotesEscapes(t *testing.T) {
	got, err := lex(`echo "hello world" 'two words' a\ b ""`)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"echo", "hello world", "two words", "a b", ""}
	if len(got) != len(want) {
		t.Fatalf("lex result %#v", got)
	}
	for i, v := range want {
		if got[i] != v {
			t.Fatalf("at %d: %q != %q", i, got[i], v)
		}
	}
	if _, err = lex(`echo "unfinished`); err == nil {
		t.Fatal("unmatched quote accepted")
	}
}
func TestBuiltinsAndCwd(t *testing.T) {
	dir := t.TempDir()
	var out, stderr bytes.Buffer
	terminal, err := NewTerminal(strings.NewReader(""), &out, &stderr)
	if err != nil {
		t.Fatal(err)
	}
	terminal.HistoryPath = ""
	if err = terminal.Execute([]string{"cd", dir}); err != nil {
		t.Fatal(err)
	}
	if err = terminal.Execute([]string{"pwd"}); err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(out.String()) != dir {
		t.Fatalf("cwd mismatch: %q", out.String())
	}
	out.Reset()
	f := filepath.Join(dir, "hello.txt")
	if err = os.WriteFile(f, []byte("kindred\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = terminal.Run(`cat hello.txt`); err != nil {
		t.Fatal(err)
	}
	if out.String() != "kindred\n" {
		t.Fatalf("read mismatch %q", out.String())
	}
	out.Reset()
	if err = terminal.Run("hash hello.txt"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "hello.txt") {
		t.Fatal("missing file hash output")
	}
}
func TestOfflineAI(t *testing.T) {
	got := offlineDiagnosis("No such file or directory")
	if !strings.Contains(got, "missing") {
		t.Fatalf("unexpected response %q", got)
	}
	got = offlineDiagnosis("EADDRINUSE 127.0.0.1:47900")
	if !strings.Contains(got, "port is occupied") {
		t.Fatalf("unexpected response %q", got)
	}
}
func TestLocalModelRestrictsRemoteProviders(t *testing.T) {
	for _, endpoint := range []string{"https://example.com/ai", "http://8.8.8.8:9000/v1/cognition", "http://localhost:9000/v1/cognition"} {
		_, err := (LocalCognition{Endpoint: endpoint}).Respond("hello")
		if err == nil {
			t.Fatalf("unexpected remote/local DNS endpoint accepted: %s", endpoint)
		}
	}
}
func TestStatusMakesNoFalseProductionClaim(t *testing.T) {
	out, _, err := runCaptured("sdpn status")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"productionSDPNNetworkQualified":false`) || !strings.Contains(out, `"nativeNeuralInference":false`) {
		t.Fatalf("incorrect readiness claim: %s", out)
	}
}
