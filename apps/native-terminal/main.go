// SDPN Native Terminal: portable first-party command environment.
// Copyright (c) Kindred Labs. Standard-library only; no hosted services.
package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

const version = "0.1.0"

type Terminal struct {
	Cwd         string
	In          io.Reader
	Out, Err    io.Writer
	History     []string
	HistoryPath string
}

func NewTerminal(in io.Reader, out, stderr io.Writer) (*Terminal, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	home, _ := os.UserHomeDir()
	historyPath := ""
	if home != "" {
		historyPath = filepath.Join(home, ".sdpn", "terminal_history")
	}
	t := &Terminal{Cwd: cwd, In: in, Out: out, Err: stderr, HistoryPath: historyPath}
	if historyPath != "" {
		b, e := os.ReadFile(historyPath)
		if e == nil {
			for _, s := range strings.Split(string(b), "\n") {
				if s != "" {
					t.History = append(t.History, s)
				}
			}
		}
	}
	return t, nil
}

func (t *Terminal) saveHistory(line string) {
	if line == "" || strings.Contains(strings.ToLower(line), "secret") || strings.Contains(strings.ToLower(line), "token") {
		return
	}
	t.History = append(t.History, line)
	if len(t.History) > 1000 {
		t.History = t.History[len(t.History)-1000:]
	}
	if t.HistoryPath == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(t.HistoryPath), 0700); err != nil {
		return
	}
	_ = os.WriteFile(t.HistoryPath, []byte(strings.Join(t.History, "\n")+"\n"), 0600)
}

// lex respects POSIX-like single/double quotes and escaped spaces. The
// host-shell escape ("!") is explicit, so native commands cannot be
// silently interpreted as privileged shell pipelines.
func lex(s string) ([]string, error) {
	var out []string
	var b strings.Builder
	quote := rune(0)
	escaped := false
	active := false
	flush := func() {
		if active {
			out = append(out, b.String())
			b.Reset()
			active = false
		}
	}
	for _, r := range s {
		if escaped {
			b.WriteRune(r)
			active = true
			escaped = false
			continue
		}
		if r == '\\' && quote != '\'' {
			escaped = true
			active = true
			continue
		}
		if quote != 0 {
			if r == quote {
				quote = 0
			} else {
				b.WriteRune(r)
			}
			continue
		}
		if r == '\'' || r == '"' {
			quote = r
			active = true
			continue
		}
		if r == ' ' || r == '\t' || r == '\n' {
			flush()
			continue
		}
		b.WriteRune(r)
		active = true
	}
	if escaped {
		b.WriteRune('\\')
	}
	if quote != 0 {
		return nil, fmt.Errorf("unterminated quote")
	}
	flush()
	return out, nil
}

func (t *Terminal) Repl() error {
	scanner := bufio.NewScanner(t.In)
	scanner.Buffer(make([]byte, 4096), 2*1024*1024)
	fmt.Fprintln(t.Out, "SDPN Native Terminal", version, "· Windows / Linux · offline-first")
	fmt.Fprintln(t.Out, "Type 'help' for commands, 'ai diagnose ...' for local analysis, or '!...' for your OS shell.")
	for {
		fmt.Fprintf(t.Out, "sdpn %s > ", filepath.Base(t.Cwd))
		if !scanner.Scan() {
			if err := scanner.Err(); err != nil {
				return err
			}
			fmt.Fprintln(t.Out)
			return nil
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "exit" || line == "quit" {
			return nil
		}
		if line == "" {
			continue
		}
		t.saveHistory(line)
		if err := t.Run(line); err != nil {
			fmt.Fprintln(t.Err, "error:", err)
		}
	}
}

func (t *Terminal) Run(line string) error {
	line = strings.TrimSpace(line)
	if line == "" {
		return nil
	}
	if strings.HasPrefix(line, "!") {
		return t.hostShell(strings.TrimSpace(line[1:]))
	}
	args, err := lex(line)
	if err != nil {
		return err
	}
	if len(args) == 0 {
		return nil
	}
	return t.Execute(args)
}

func (t *Terminal) hostShell(script string) error {
	if script == "" {
		return errors.New("host-shell command required")
	}
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd.exe", "/D", "/C", script)
	} else {
		cmd = exec.Command("/bin/sh", "-c", script)
	}
	return t.start(cmd)
}

func (t *Terminal) start(cmd *exec.Cmd) error {
	cmd.Dir = t.Cwd
	cmd.Stdin = t.In
	cmd.Stdout = t.Out
	cmd.Stderr = t.Err
	return cmd.Run()
}

func (t *Terminal) Execute(args []string) error {
	if len(args) == 0 {
		return nil
	}
	switch args[0] {
	case "help", "?":
		fmt.Fprint(t.Out, helpText)
		return nil
	case "version", "--version", "-v":
		fmt.Fprintln(t.Out, "SDPN Native Terminal", version)
		return nil
	case "exit", "quit":
		return nil
	case "pwd":
		fmt.Fprintln(t.Out, t.Cwd)
		return nil
	case "cd":
		target := ""
		if len(args) > 1 {
			target = args[1]
		} else {
			target, _ = os.UserHomeDir()
		}
		if strings.HasPrefix(target, "~"+string(filepath.Separator)) {
			home, _ := os.UserHomeDir()
			target = filepath.Join(home, target[2:])
		}
		if !filepath.IsAbs(target) {
			target = filepath.Join(t.Cwd, target)
		}
		target, err := filepath.Abs(target)
		if err != nil {
			return err
		}
		st, err := os.Stat(target)
		if err != nil {
			return err
		}
		if !st.IsDir() {
			return fmt.Errorf("%s: not a directory", target)
		}
		t.Cwd = target
		return nil
	case "ls":
		target := "."
		if len(args) > 1 {
			target = args[1]
		}
		if !filepath.IsAbs(target) {
			target = filepath.Join(t.Cwd, target)
		}
		entries, err := os.ReadDir(target)
		if err != nil {
			return err
		}
		sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
		for _, e := range entries {
			name := e.Name()
			if e.IsDir() {
				name += "/"
			}
			fmt.Fprintln(t.Out, name)
		}
		return nil
	case "cat":
		if len(args) < 2 {
			return errors.New("usage: cat <file>")
		}
		for _, path := range args[1:] {
			if !filepath.IsAbs(path) {
				path = filepath.Join(t.Cwd, path)
			}
			f, e := os.Open(path)
			if e != nil {
				return e
			}
			_, e = io.Copy(t.Out, f)
			closeErr := f.Close()
			if e != nil {
				return e
			}
			if closeErr != nil {
				return closeErr
			}
		}
		return nil
	case "echo":
		fmt.Fprintln(t.Out, strings.Join(args[1:], " "))
		return nil
	case "clear":
		fmt.Fprint(t.Out, "\033[2J\033[H")
		return nil
	case "history":
		for i, h := range t.History {
			fmt.Fprintf(t.Out, "%d  %s\n", i+1, h)
		}
		return nil
	case "hash":
		if len(args) != 2 {
			return errors.New("usage: hash <file>")
		}
		path := args[1]
		if !filepath.IsAbs(path) {
			path = filepath.Join(t.Cwd, path)
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		h := sha256.New()
		if _, err = io.Copy(h, f); err != nil {
			return err
		}
		fmt.Fprintf(t.Out, "%s  %s\n", hex.EncodeToString(h.Sum(nil)), path)
		return nil
	case "which":
		if len(args) != 2 {
			return errors.New("usage: which <command>")
		}
		p, e := exec.LookPath(args[1])
		if e != nil {
			return e
		}
		fmt.Fprintln(t.Out, p)
		return nil
	case "doctor":
		return t.doctor()
	case "run":
		return t.runPolyglot(args[1:])
	case "ai":
		return t.runAI(args[1:])
	case "cognition":
		return t.runCognition(args[1:])
	case "pkg":
		return t.runPackage(args[1:])
	case "sdpn":
		return t.runSDPN(args[1:])
	case "proof":
		return t.runProof(args[1:])
	case "status":
		return t.runSDPN([]string{"status"})
	default:
		// Direct native process invocation preserves argument boundaries. For
		// pipelines/redirection use explicit ! to invoke the host system shell.
		cmd := exec.Command(args[0], args[1:]...)
		return t.start(cmd)
	}
}

var helpText = `SDPN NATIVE TERMINAL
  help, version, pwd, cd, ls, cat, echo, hash, which, clear, history
  doctor                      Check supported local language toolchains
  run <file> [arguments]       Run a file using its local language runtime
  ai diagnose <error text>     Offline local diagnostic guidance
  ai explain <command>        Inspect a command without executing it
  ai ask <question>           Consult approved local Auxiliary endpoint (if configured)
  cognition serve             Start first-party local cognition API (offline-rules now)
  pkg keygen|trust|sign|verify|install|list|exec    Offline signed tool packages
  sdpn status                  Machine-readable native SDPN capabilities
  sdpn verify <receipt.json>   Check a local SW06-F HMAC receipt with the session secret
  proof send <IP> <file>       Encrypted SW06-F transport to a paired local receiver
  proof receive [host] [port]  Native SW06-F receiver (localhost by default)
  !<shell command>             Explicit host-shell pipelines, redirects, globbing
  <program> [arguments]       Execute any program available on this OS
  exit                         Leave the SDPN terminal

The terminal itself requires no hosted API or third-party runtime. Language
execution uses installed compilers/interpreters; code execution always occurs
with the current OS user's privileges. Interactive full-screen PTY/ConPTY,
remote SDPN shell, and native neural inference are future integration gates.
`

func (t *Terminal) doctor() error {
	fmt.Fprintln(t.Out, "SDPN native diagnostics:")
	fmt.Fprintln(t.Out, " OS:", runtime.GOOS, "CPU:", runtime.GOARCH, "Go compiler used to build terminal:", runtime.Version())
	languages := []struct {
		name string
		cmds []string
	}{{"Python", []string{"python3", "python"}}, {"JavaScript", []string{"node"}}, {"TypeScript", []string{"node", "deno", "bun"}}, {"Go", []string{"go"}}, {"Rust", []string{"rustc"}}, {"C", []string{"cc", "gcc", "clang"}}, {"C++", []string{"c++", "g++", "clang++"}}, {"Java", []string{"java"}}, {"Kotlin", []string{"kotlin"}}, {"Ruby", []string{"ruby"}}, {"PHP", []string{"php"}}, {"Shell", []string{"bash", "sh"}}, {"PowerShell", []string{"pwsh", "powershell"}}, {"Swift", []string{"swift"}}}
	for _, lang := range languages {
		found := "not installed"
		for _, c := range lang.cmds {
			if p, e := exec.LookPath(c); e == nil {
				found = p
				break
			}
		}
		fmt.Fprintln(t.Out, " ", lang.name, ":", found)
	}
	return nil
}

func (t *Terminal) runPolyglot(args []string) error {
	if len(args) < 1 {
		return errors.New("usage: run <file> [arguments]")
	}
	file := args[0]
	if !filepath.IsAbs(file) {
		file = filepath.Join(t.Cwd, file)
	}
	if st, e := os.Stat(file); e != nil {
		return e
	} else if st.IsDir() {
		return errors.New("cannot run a directory")
	}
	ext := strings.ToLower(filepath.Ext(file))
	rest := args[1:]
	var candidates []string
	var options []string
	switch ext {
	case ".py":
		candidates = []string{"python3", "python"}
	case ".js", ".mjs", ".cjs":
		candidates = []string{"node", "bun", "deno"}
	case ".ts", ".mts":
		candidates = []string{"node", "deno", "bun"}
		options = []string{"--experimental-strip-types"}
	case ".go":
		candidates = []string{"go"}
		options = []string{"run"}
	case ".rb":
		candidates = []string{"ruby"}
	case ".php":
		candidates = []string{"php"}
	case ".sh":
		candidates = []string{"bash", "sh"}
	case ".ps1":
		candidates = []string{"pwsh", "powershell"}
		options = []string{"-NoProfile", "-File"}
	case ".java":
		candidates = []string{"java"}
	case ".swift":
		candidates = []string{"swift"}
	case ".lua":
		candidates = []string{"lua"}
	case ".r":
		candidates = []string{"Rscript"}
	case ".pl":
		candidates = []string{"perl"}
	default:
		return fmt.Errorf("unknown extension %q: invoke an installed compiler or interpreter directly", ext)
	}
	for _, candidate := range candidates {
		if _, err := exec.LookPath(candidate); err == nil {
			return t.start(exec.Command(candidate, append(append(options, file), rest...)...))
		}
	}
	return fmt.Errorf("no installed runtime for %s; install one of: %s", ext, strings.Join(candidates, ", "))
}

func (t *Terminal) runSDPN(args []string) error {
	if len(args) == 0 {
		fmt.Fprint(t.Out, "SDPN native commands: status, verify <receipt.json>\n")
		return nil
	}
	switch args[0] {
	case "status":
		return json.NewEncoder(t.Out).Encode(map[string]any{"application": "sdpn-native-terminal", "version": version, "platform": runtime.GOOS, "architecture": runtime.GOARCH, "nativeBinary": true, "externalAIProviderRequired": false, "nativeSW06F": true, "polyglotHostRuntimes": true, "fullPTY": false, "nativeNeuralInference": false, "productionSDPNNetworkQualified": false, "timestamp": time.Now().UTC().Format(time.RFC3339)})
	case "verify":
		if len(args) != 2 {
			return errors.New("usage: sdpn verify <receipt.json>")
		}
		path := args[1]
		if !filepath.IsAbs(path) {
			path = filepath.Join(t.Cwd, path)
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := VerifyReceiptJSON(b, os.Getenv("KINDRED_SDPN_PROOF_SECRET")); err != nil {
			return err
		}
		fmt.Fprintln(t.Out, "SW06-F receipt MAC and required identity/integrity flags verified")
		return nil
	default:
		return fmt.Errorf("unknown sdpn subcommand %q", args[0])
	}
}

func (t *Terminal) runProof(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: proof send <host> <file> [port] | proof receive [host] [port]")
	}
	switch args[0] {
	case "send":
		if len(args) < 3 || len(args) > 4 {
			return errors.New("usage: proof send <private-host> <file> [port]")
		}
		port := 47900
		if len(args) == 4 {
			if _, e := fmt.Sscan(args[3], &port); e != nil {
				return e
			}
		}
		path := args[2]
		if !filepath.IsAbs(path) {
			path = filepath.Join(t.Cwd, path)
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		receipt, err := SendProof(context.Background(), args[1], port, b, os.Getenv("KINDRED_SDPN_PROOF_SECRET"))
		if err != nil {
			return err
		}
		return json.NewEncoder(t.Out).Encode(receipt)
	case "receive":
		host := "127.0.0.1"
		port := 47900
		if len(args) > 1 {
			host = args[1]
		}
		if len(args) > 2 {
			if _, e := fmt.Sscan(args[2], &port); e != nil {
				return e
			}
		}
		if len(args) > 3 {
			return errors.New("usage: proof receive [host] [port]")
		}
		server, err := StartProofReceiver(host, port, os.Getenv("KINDRED_SDPN_PROOF_SECRET"))
		if err != nil {
			return err
		}
		fmt.Fprintf(t.Out, "SDPN SW06-F receiver on %s:%d (Ctrl+C to stop); keep session secrets private\n", host, server.Port)
		<-server.Done
		return nil
	default:
		return fmt.Errorf("unknown proof subcommand %q", args[0])
	}
}

func main() {
	t, err := NewTerminal(os.Stdin, os.Stdout, os.Stderr)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if len(os.Args) == 1 {
		err = t.Repl()
	} else if os.Args[1] == "repl" {
		err = t.Repl()
	} else if os.Args[1] == "--version" {
		err = t.Execute([]string{"version"})
	} else {
		err = t.Execute(os.Args[1:])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "sdpn:", err)
		os.Exit(1)
	}
}

// used in tests to check native command outputs without starting a subprocess
func runCaptured(command string) (string, string, error) {
	var out, stderr bytes.Buffer
	t, e := NewTerminal(strings.NewReader(""), &out, &stderr)
	if e != nil {
		return "", "", e
	}
	e = t.Run(command)
	return out.String(), stderr.String(), e
}
