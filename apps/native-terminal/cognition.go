package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

// SDPN's first-party local cognition API. The initial engine is a bounded
// offline diagnostic classifier, NOT a neural model; the contract is designed
// for attaching the proprietary Auxiliary runtime without SaaS dependencies.
type cognitionRequest struct {
	Input  string `json:"input"`
	Source string `json:"source"`
	Mode   string `json:"mode"`
}
type cognitionResponse struct {
	Schema     string `json:"schema"`
	Output     string `json:"output"`
	Engine     string `json:"engine"`
	Generative bool   `json:"generative"`
}

func cognitionHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, configured, configErr := configuredNativeModel()
		status := "offline-ready"
		engine := "offline-rules"
		if configured {
			status = "native-model-configured-not-probed"
			engine = "ntsa-x-native-adapter"
		}
		if configErr != nil {
			status = "configuration-error"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "engine": engine, "generativeVerified": false, "modelConfigured": configured, "localOnly": true})
	})
	mux.HandleFunc("POST /v1/cognition", func(w http.ResponseWriter, r *http.Request) {
		if token := os.Getenv("SDPN_AI_LOCAL_TOKEN"); token != "" && r.Header.Get("Authorization") != "Bearer "+token {
			http.Error(w, "local authorization required", http.StatusUnauthorized)
			return
		}
		b, err := io.ReadAll(io.LimitReader(r.Body, 65537))
		if err != nil || len(b) > 65536 {
			http.Error(w, "input too large", http.StatusRequestEntityTooLarge)
			return
		}
		var input cognitionRequest
		if json.Unmarshal(b, &input) != nil || input.Input == "" || len(input.Input) > 16384 {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		native, configured, err := configuredNativeModel()
		if err != nil {
			http.Error(w, "native model configuration invalid", http.StatusServiceUnavailable)
			return
		}
		if configured {
			output, modelErr := native.Respond(input.Input)
			if modelErr != nil {
				http.Error(w, "first-party native model unavailable", http.StatusServiceUnavailable)
				return
			}
			_ = json.NewEncoder(w).Encode(cognitionResponse{Schema: "kindred.sdpn.cognition.v1", Output: output, Engine: "ntsa-x-native", Generative: true})
			return
		}
		_ = json.NewEncoder(w).Encode(cognitionResponse{Schema: "kindred.sdpn.cognition.v1", Output: offlineDiagnosis(input.Input), Engine: "offline-rules", Generative: false})
	})
	return mux
}
func (t *Terminal) runCognition(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: cognition serve [127.0.0.1] [port] | cognition health")
	}
	switch args[0] {
	case "health":
		_, configured, e := configuredNativeModel()
		if e != nil {
			return e
		}
		status := "offline-rules"
		if configured {
			status = "ntsa-x-native-adapter-configured-not-probed"
		}
		_ = json.NewEncoder(t.Out).Encode(map[string]any{"engine": status, "generativeVerified": false, "providerRequired": false})
		return nil
	case "serve":
		host := "127.0.0.1"
		port := 18281
		if len(args) > 1 {
			host = args[1]
		}
		if len(args) > 2 {
			if _, err := fmt.Sscan(args[2], &port); err != nil {
				return err
			}
		}
		if len(args) > 3 {
			return errors.New("usage: cognition serve [127.0.0.1] [port]")
		}
		if host != "127.0.0.1" && host != "::1" {
			return errors.New("native cognition API must bind to loopback only")
		}
		if port < 1 || port > 65535 {
			return errors.New("invalid cognition port")
		}
		listener, err := net.Listen("tcp", net.JoinHostPort(host, fmt.Sprint(port)))
		if err != nil {
			return err
		}
		defer listener.Close()
		srv := &http.Server{Handler: cognitionHandler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 75 * time.Second}
		done := make(chan os.Signal, 1)
		signal.Notify(done, syscall.SIGINT, syscall.SIGTERM)
		defer signal.Stop(done)
		_, configured, _ := configuredNativeModel()
		status := "offline-rules"
		if configured {
			status = "NTSA-X adapter configured (model not yet probed)"
		}
		fmt.Fprintf(t.Out, "SDPN local cognition API: http://%s/v1/cognition (%s)\n", net.JoinHostPort(host, fmt.Sprint(port)), status)
		go func() {
			if e := srv.Serve(listener); e != nil && !errors.Is(e, http.ErrServerClosed) {
				fmt.Fprintln(t.Err, strings.TrimSpace(e.Error()))
			}
			done <- syscall.SIGTERM
		}()
		<-done
		return srv.Close()
	default:
		return fmt.Errorf("unknown cognition subcommand %q", args[0])
	}
}
