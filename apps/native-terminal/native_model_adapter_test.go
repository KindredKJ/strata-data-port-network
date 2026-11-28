package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNativeModelRejectsRemoteAndRedirect(t *testing.T) {
	for _, endpoint := range []string{"https://example.com/v1/chat/completions", "http://localhost:8081/v1/chat/completions", "http://8.8.8.8:8081/v1/chat/completions", "http://127.0.0.1:8081/not-chat", "http://127.0.0.1:8081/v1/chat/completions?redirect=1"} {
		if _, e := requireLocalModelURL(endpoint); e == nil {
			t.Fatalf("remote/malformed native endpoint accepted: %q", endpoint)
		}
	}
}

func localSSETestServer(t *testing.T, handler http.HandlerFunc) (*httptest.Server, string) {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(handler)
	_ = server.Listener.Close()
	server.Listener = listener
	server.Start()
	return server, server.URL + "/v1/chat/completions"
}
func TestExistingNTSAXStreamingContract(t *testing.T) {
	server, endpoint := localSSETestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/v1/chat/completions" || r.Header.Get("Origin") != "" {
			t.Errorf("wrong request scope")
			return
		}
		data, err := io.ReadAll(io.LimitReader(r.Body, 32769))
		if err != nil {
			t.Error(err)
			return
		}
		var q struct {
			Model    string `json:"model"`
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
			Stream    bool `json:"stream"`
			MaxTokens int  `json:"max_tokens"`
		}
		if json.Unmarshal(data, &q) != nil || q.Model != "ntsa-cog-fu-v1" || len(q.Messages) != 1 || q.Messages[0].Role != "user" || q.Messages[0].Content != "test local model" || !q.Stream || q.MaxTokens != 64 {
			t.Errorf("incorrect first-party NTSA-X request: %s", string(data))
			return
		}
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Kindred \"}}]}\n\n")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"native\"}}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	})
	defer server.Close()
	r, e := (NativeModelCognition{Endpoint: endpoint, ModelID: "ntsa-cog-fu-v1", MaxTokens: 64}).Respond("test local model")
	if e != nil {
		t.Fatal(e)
	}
	if r != "Kindred native" {
		t.Fatalf("incorrect assembled answer %q", r)
	}
}
func TestNativeStreamRequiresDone(t *testing.T) {
	server, endpoint := localSSETestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"incomplete\"}}]}\n\n")
	})
	defer server.Close()
	_, e := (NativeModelCognition{Endpoint: endpoint, ModelID: "ntsa-cog-fu-v1", MaxTokens: 64}).Respond("incomplete")
	if e == nil || !strings.Contains(e.Error(), "DONE") {
		t.Fatalf("uncompleted model stream accepted: %v", e)
	}
}
func TestCognitionAPIUsesExistingNativeModel(t *testing.T) {
	model, endpoint := localSSETestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"native completion\"}}]}\n\ndata: [DONE]\n\n")
	})
	defer model.Close()
	t.Setenv("SDPN_NATIVE_MODEL_ENDPOINT", endpoint)
	t.Setenv("SDPN_NATIVE_MODEL_ID", "ntsa-cog-fu-v1")
	server := httptest.NewServer(cognitionHandler())
	defer server.Close()
	res, e := http.Post(server.URL+"/v1/cognition", "application/json", strings.NewReader(`{"input":"hello","source":"test","mode":"local"}`))
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("status: %d", res.StatusCode)
	}
	var result cognitionResponse
	if e = json.NewDecoder(res.Body).Decode(&result); e != nil {
		t.Fatal(e)
	}
	if !result.Generative || result.Engine != "ntsa-x-native" || result.Output != "native completion" {
		t.Fatalf("false native integration claim: %+v", result)
	}
}
