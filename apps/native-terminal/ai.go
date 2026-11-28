package main

import (
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

// This interface is available to all SDPN native entrypoints, not just the REPL.
// A future native Auxiliary adapter can implement it without any hosted provider.
type Cognition interface {
	Respond(input string) (string, error)
}

type LocalCognition struct{ Endpoint string }

func (l LocalCognition) Respond(input string) (string, error) {
	u, err := url.Parse(l.Endpoint)
	if err != nil {
		return "", err
	}
	if u.Scheme != "http" || u.Path != "/v1/cognition" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return "", errors.New("SDPN AI requires the local /v1/cognition endpoint; redirects/providers are not allowed")
	}
	ip := net.ParseIP(u.Hostname())
	if ip == nil || !ip.IsLoopback() {
		return "", errors.New("SDPN AI endpoint must be 127.0.0.1 or ::1")
	}
	port, e := strconv.Atoi(u.Port())
	if e != nil || port < 1024 || port > 65535 {
		return "", errors.New("local cognition endpoint requires a valid explicit port")
	}
	reqBytes, _ := json.Marshal(map[string]any{"input": input, "source": "sdpn-native-terminal", "mode": "local"})
	client := &http.Client{Timeout: 75 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return errors.New("SDPN cognition redirects are disabled")
	}}
	req, err := http.NewRequest("POST", l.Endpoint, bytes.NewReader(reqBytes))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if token := os.Getenv("SDPN_AI_LOCAL_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rsp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer rsp.Body.Close()
	if rsp.StatusCode != 200 {
		return "", fmt.Errorf("local cognition endpoint responded HTTP %d", rsp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(rsp.Body, 1024*1024))
	if err != nil {
		return "", err
	}
	var result struct {
		Output string `json:"output"`
	}
	if err = json.Unmarshal(b, &result); err != nil {
		return "", err
	}
	if result.Output == "" {
		return "", errors.New("local cognition response lacks output")
	}
	return result.Output, nil
}

func offlineDiagnosis(message string) string {
	q := strings.ToLower(message)
	switch {
	case strings.Contains(q, "permission denied") || strings.Contains(q, "access is denied"):
		return "Local diagnosis: file or process permission denied. Check ownership and ACLs; keep least privilege. On Linux inspect `ls -l`, on Windows `icacls` or file properties."
	case strings.Contains(q, "command not found") || strings.Contains(q, "not recognized") || strings.Contains(q, "executable file not found"):
		return "Local diagnosis: executable is absent from PATH or not installed. Use `doctor` and `which <command>`; install the language/toolchain only if the project needs it."
	case strings.Contains(q, "eaddrinuse") || strings.Contains(q, "address already in use"):
		return "Local diagnosis: listener port is occupied. Locate its owning process with OS networking tools; choose another test port if appropriate."
	case strings.Contains(q, "no such file") || strings.Contains(q, "cannot find the path"):
		return "Local diagnosis: missing or misaddressed file. Run `pwd`, `ls`, or use an absolute path; verify the checked-out repository and branch."
	case strings.Contains(q, "connection refused") || strings.Contains(q, "econnrefused"):
		return "Local diagnosis: no listener is accepting on the target address/port. Check receiver startup, interface binding and private-LAN firewall scope."
	case strings.Contains(q, "timeout") || strings.Contains(q, "timed out"):
		return "Local diagnosis: operation exceeded timeout. Check peer reachability, DNS, firewall/NAT, load and application logs before increasing limits."
	case strings.Contains(q, "certificate") || strings.Contains(q, "tls"):
		return "Local diagnosis: transport trust or certificate mismatch. Verify pinned peer identity, clock and certificate chain; do not turn off verification."
	case strings.Contains(q, "sdpn") || strings.Contains(q, "transport"):
		return "Local guidance: use `sdpn status` for capabilities, `proof receive`/`proof send` for SW06-F, and `sdpn verify` for cryptographic receipts. Physical attestation and production launch gates remain separate."
	default:
		return "Offline diagnostic patterns did not match. Inspect the exact error and run `doctor`. For generative inference, connect an approved on-device Auxiliary runtime via SDPN_AI_ENDPOINT (loopback only)."
	}
}

func (t *Terminal) runAI(args []string) error {
	if len(args) < 2 {
		return errors.New("usage: ai diagnose|explain|ask <text>")
	}
	mode := args[0]
	input := strings.Join(args[1:], " ")
	switch mode {
	case "diagnose":
		fmt.Fprintln(t.Out, offlineDiagnosis(input))
		return nil
	case "explain":
		words, e := lex(input)
		if e != nil {
			return e
		}
		if len(words) == 0 {
			return errors.New("no command")
		}
		fmt.Fprintf(t.Out, "Local command inspection: program=%q, arguments=%d; current OS permissions apply.\n", words[0], len(words)-1)
		fmt.Fprintln(t.Out, "No command was executed. Scripts and external programs run with the user's OS privileges.")
		fmt.Fprintln(t.Out, offlineDiagnosis(input))
		return nil
	case "ask":
		endpoint := os.Getenv("SDPN_AI_ENDPOINT")
		if endpoint == "" {
			native, configured, err := configuredNativeModel()
			if err != nil {
				return err
			}
			if configured {
				output, err := native.Respond(input)
				if err != nil {
					return err
				}
				fmt.Fprintln(t.Out, output)
				return nil
			}

			fmt.Fprintln(t.Out, offlineDiagnosis(input))
			return errors.New("native neural model not yet connected; only deterministic offline assistance is available")
		}
		output, e := (LocalCognition{Endpoint: endpoint}).Respond(input)
		if e != nil {
			return e
		}
		fmt.Fprintln(t.Out, output)
		return nil
	default:
		return fmt.Errorf("unknown AI subcommand %q", mode)
	}
}
