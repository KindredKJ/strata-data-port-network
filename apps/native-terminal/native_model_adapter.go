package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// NTSA-X's first-party native model server already exposes a local
// /v1/chat/completions SSE contract. This adapter does not load an outside AI
// provider, copy model weights into SDPN, or imply any model-quality result.
// It only becomes generative when an actual native Kindred model is running.
type NativeModelCognition struct {
	Endpoint  string
	ModelID   string
	MaxTokens int
}

func requireLocalModelURL(endpoint string) (string, error) {
	u, e := url.Parse(endpoint)
	if e != nil {
		return "", e
	}
	if u.Scheme != "http" || u.Path != "/v1/chat/completions" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return "", errors.New("native NTSA-X model must use literal loopback /v1/chat/completions")
	}
	ip := net.ParseIP(u.Hostname())
	if ip == nil || !ip.IsLoopback() {
		return "", errors.New("native NTSA-X model must use literal loopback address")
	}
	if u.Port() == "" {
		return "", errors.New("native model URL needs explicit local port")
	}
	port, e := strconv.Atoi(u.Port())
	if e != nil || port < 1024 || port > 65535 {
		return "", errors.New("invalid model endpoint port")
	}
	return u.String(), nil
}

func (m NativeModelCognition) Respond(input string) (string, error) {
	endpoint, e := requireLocalModelURL(m.Endpoint)
	if e != nil {
		return "", e
	}
	if input == "" || len(input) > 4000 {
		return "", errors.New("model input must be 1-4000 characters")
	}
	if m.ModelID == "" || len(m.ModelID) > 128 {
		return "", errors.New("model ID missing or too long")
	}
	if m.MaxTokens < 1 || m.MaxTokens > 2048 {
		return "", errors.New("model token budget out of range")
	}
	payload, _ := json.Marshal(map[string]any{"model": m.ModelID, "messages": []map[string]string{{"role": "user", "content": input}}, "stream": true, "max_tokens": m.MaxTokens, "temperature": 0})
	request, e := http.NewRequest("POST", endpoint, bytes.NewReader(payload))
	if e != nil {
		return "", e
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	client := &http.Client{Timeout: 60 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return errors.New("native NTSA-X model redirects disabled")
	}}
	response, e := client.Do(request)
	if e != nil {
		return "", e
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return "", fmt.Errorf("native NTSA-X model returned HTTP %d", response.StatusCode)
	}
	if !strings.HasPrefix(strings.ToLower(response.Header.Get("Content-Type")), "text/event-stream") {
		return "", errors.New("native NTSA-X endpoint did not stream SSE")
	}
	reader := bufio.NewReader(io.LimitReader(response.Body, 1024*1024))
	var output strings.Builder
	sawDone := false
	for {
		line, e := reader.ReadString('\n')
		if len(line) > 64*1024 {
			return "", errors.New("oversized native SSE frame")
		}
		if e != nil && e != io.EOF {
			return "", e
		}
		line = strings.TrimRight(line, "\r\n")
		if strings.HasPrefix(line, "data: ") {
			raw := strings.TrimSpace(strings.TrimPrefix(line, "data: "))
			if raw == "[DONE]" {
				sawDone = true
				break
			}
			var frame struct {
				Choices []struct {
					Delta struct {
						Content string `json:"content"`
					} `json:"delta"`
				} `json:"choices"`
			}
			if json.Unmarshal([]byte(raw), &frame) != nil || len(frame.Choices) < 1 {
				return "", errors.New("invalid native model SSE frame")
			}
			if output.Len()+len(frame.Choices[0].Delta.Content) > 16384 {
				return "", errors.New("native model answer exceeds bound")
			}
			output.WriteString(frame.Choices[0].Delta.Content)
		}
		if e == io.EOF {
			break
		}
	}
	if !sawDone {
		return "", errors.New("native model stream ended without DONE")
	}
	if output.Len() == 0 {
		return "", errors.New("native model returned empty response")
	}
	return output.String(), nil
}

func configuredNativeModel() (NativeModelCognition, bool, error) {
	endpoint := os.Getenv("SDPN_NATIVE_MODEL_ENDPOINT")
	if endpoint == "" {
		return NativeModelCognition{}, false, nil
	}
	modelID := os.Getenv("SDPN_NATIVE_MODEL_ID")
	if modelID == "" {
		modelID = "ntsa-cog-fu-v1"
	}
	tokens := 64
	if s := os.Getenv("SDPN_NATIVE_MODEL_MAX_TOKENS"); s != "" {
		n, e := strconv.Atoi(s)
		if e != nil {
			return NativeModelCognition{}, true, e
		}
		tokens = n
	}
	native := NativeModelCognition{endpoint, modelID, tokens}
	if _, e := requireLocalModelURL(endpoint); e != nil {
		return NativeModelCognition{}, true, e
	}
	return native, true, nil
}
