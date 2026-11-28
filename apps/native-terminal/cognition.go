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
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ready", "engine": "offline-rules", "generative": false, "localOnly": true})
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
		fmt.Fprintln(t.Out, `{"engine":"offline-rules","generative":false,"providerRequired":false}`)
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
		srv := &http.Server{Handler: cognitionHandler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second}
		done := make(chan os.Signal, 1)
		signal.Notify(done, syscall.SIGINT, syscall.SIGTERM)
		defer signal.Stop(done)
		fmt.Fprintf(t.Out, "SDPN local cognition API: http://%s/v1/cognition (offline-rules engine; generative=false)\n", net.JoinHostPort(host, fmt.Sprint(port)))
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
