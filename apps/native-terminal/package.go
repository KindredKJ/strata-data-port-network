package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const packageSchema = "kindred.sdpn.package.v1"
const packageMaxFile = 16 << 20
const packageMaxTotal = 96 << 20

type packageFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
}
type packageManifest struct {
	Schema       string        `json:"schema"`
	Name         string        `json:"name"`
	Version      string        `json:"version"`
	Entry        string        `json:"entry"`
	PublisherKey string        `json:"publisherKey"`
	Files        []packageFile `json:"files"`
	Signature    string        `json:"signature,omitempty"`
}

func (p packageManifest) signingBytes() []byte { p.Signature = ""; b, _ := json.Marshal(p); return b }
func safePackageName(s string) bool {
	return regexp.MustCompile(`^[a-z][a-z0-9-]{0,62}$`).MatchString(s)
}
func safePackageVersion(s string) bool {
	return regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`).MatchString(s)
}
func safePackagePath(s string) bool {
	if s == "" || strings.Contains(s, "\\") || strings.HasPrefix(s, "/") || strings.HasPrefix(s, ".") || strings.Contains(s, "//") || strings.Contains(s, "\x00") {
		return false
	}
	cleaned := filepath.ToSlash(filepath.Clean(filepath.FromSlash(s)))
	return cleaned == s && cleaned != "." && !strings.HasPrefix(cleaned, "../") && !strings.Contains(s, "/../") && s != ".."
}
func packageRoot() (string, error) {
	home, e := os.UserHomeDir()
	if e != nil {
		return "", e
	}
	return filepath.Join(home, ".sdpn"), nil
}
func packageBundlePath(t *Terminal, s string) string {
	if filepath.IsAbs(s) {
		return s
	}
	return filepath.Join(t.Cwd, s)
}
func keyFingerprint(pub ed25519.PublicKey) string {
	hash := sha256.Sum256(pub)
	return hex.EncodeToString(hash[:])
}
func loadPublicKey(s string) (ed25519.PublicKey, error) {
	b, e := base64.RawURLEncoding.DecodeString(strings.TrimSpace(s))
	if e != nil || len(b) != ed25519.PublicKeySize {
		return nil, errors.New("invalid Ed25519 public key")
	}
	return ed25519.PublicKey(b), nil
}
func readKeyFile(path string) ([]byte, error) {
	b, e := os.ReadFile(path)
	if e != nil {
		return nil, e
	}
	key, e := base64.RawURLEncoding.DecodeString(strings.TrimSpace(string(b)))
	if e != nil {
		return nil, e
	}
	if len(key) != ed25519.PrivateKeySize {
		return nil, errors.New("incorrect Ed25519 private key length")
	}
	return key, nil
}
func saveExclusive(path string, data []byte, mode os.FileMode) error {
	f, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if e != nil {
		return e
	}
	_, writeErr := f.Write(data)
	closeErr := f.Close()
	if writeErr != nil {
		return writeErr
	}
	return closeErr
}

func signBundle(bundle, keyfile string) (string, error) {
	absoluteBundle, err := filepath.Abs(bundle)
	if err != nil {
		return "", err
	}
	absoluteKey, err := filepath.Abs(keyfile)
	if err != nil {
		return "", err
	}
	relativeKey, err := filepath.Rel(absoluteBundle, absoluteKey)
	if err != nil {
		return "", err
	}
	if relativeKey == "." || (relativeKey != ".." && !strings.HasPrefix(relativeKey, ".."+string(filepath.Separator))) {
		return "", errors.New("publisher private key must be stored outside the package bundle")
	}
	private, err := readKeyFile(keyfile)
	if err != nil {
		return "", err
	}
	path := filepath.Join(bundle, "sdpn-package.json")
	manifestBytes, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var m packageManifest
	if err = json.Unmarshal(manifestBytes, &m); err != nil {
		return "", err
	}
	if m.Schema != packageSchema || !safePackageName(m.Name) || !safePackageVersion(m.Version) || !safePackagePath(m.Entry) {
		return "", errors.New("invalid package identity/entry")
	}
	var total int64
	found := false
	m.Files = nil
	err = filepath.WalkDir(bundle, func(p string, d os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if p == bundle {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlinks prohibited: %s", p)
		}
		if d.IsDir() {
			return nil
		}
		relative, e := filepath.Rel(bundle, p)
		if e != nil {
			return e
		}
		name := filepath.ToSlash(relative)
		if name == "sdpn-package.json" {
			return nil
		}
		if strings.HasSuffix(strings.ToLower(name), ".key") {
			return fmt.Errorf("private key file prohibited inside package: %s", name)
		}
		if !safePackagePath(name) {
			return fmt.Errorf("unsafe package path %q", name)
		}
		info, e := d.Info()
		if e != nil {
			return e
		}
		if !info.Mode().IsRegular() || info.Size() > packageMaxFile {
			return fmt.Errorf("unsupported or oversized package file: %s", name)
		}
		total += info.Size()
		if total > packageMaxTotal {
			return errors.New("package too large")
		}
		data, e := os.ReadFile(p)
		if e != nil {
			return e
		}
		if name == m.Entry {
			found = true
		}
		m.Files = append(m.Files, packageFile{name, digest(data), info.Size()})
		return nil
	})
	if err != nil {
		return "", err
	}
	if len(m.Files) == 0 || !found {
		return "", errors.New("package entry file missing")
	}
	sort.Slice(m.Files, func(i, j int) bool { return m.Files[i].Path < m.Files[j].Path })
	pub := ed25519.PrivateKey(private).Public().(ed25519.PublicKey)
	m.PublisherKey = base64.RawURLEncoding.EncodeToString(pub)
	m.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(ed25519.PrivateKey(private), m.signingBytes()))
	signed, e := json.MarshalIndent(m, "", "  ")
	if e != nil {
		return "", e
	}
	// Atomic replace only the manifest. Never modify package payloads.
	temp, e := os.CreateTemp(bundle, ".sdpn-manifest-*")
	if e != nil {
		return "", e
	}
	defer os.Remove(temp.Name())
	if _, e = temp.Write(append(signed, '\n')); e != nil {
		temp.Close()
		return "", e
	}
	if e = temp.Close(); e != nil {
		return "", e
	}
	if e = os.Rename(temp.Name(), path); e != nil {
		return "", e
	}
	return keyFingerprint(pub), nil
}

func verifyBundle(bundle string, requireTrust bool) (packageManifest, error) {
	var m packageManifest
	path := filepath.Join(bundle, "sdpn-package.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return m, err
	}
	if err = json.Unmarshal(data, &m); err != nil {
		return m, err
	}
	if m.Schema != packageSchema || !safePackageName(m.Name) || !safePackageVersion(m.Version) || !safePackagePath(m.Entry) {
		return m, errors.New("invalid package identity/entry")
	}
	pub, err := loadPublicKey(m.PublisherKey)
	if err != nil {
		return m, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(m.Signature)
	if err != nil || !ed25519.Verify(pub, m.signingBytes(), sig) {
		return m, errors.New("package Ed25519 signature invalid")
	}
	if requireTrust {
		root, e := packageRoot()
		if e != nil {
			return m, e
		}
		trusted, e := os.ReadFile(filepath.Join(root, "trust", keyFingerprint(pub)+".pub"))
		if e != nil {
			return m, errors.New("publisher not trusted; run pkg trust <public-key-file> explicitly")
		}
		if strings.TrimSpace(string(trusted)) != m.PublisherKey {
			return m, errors.New("publisher trust pin mismatch")
		}
	}
	if len(m.Files) < 1 || len(m.Files) > 1000 {
		return m, errors.New("invalid package file count")
	}
	var total int64
	seen := map[string]bool{}
	entryFound := false
	last := ""
	for _, f := range m.Files {
		if !safePackagePath(f.Path) || seen[f.Path] || f.Path <= last || !isSHA(f.SHA256) || f.Bytes < 0 || f.Bytes > packageMaxFile {
			return m, fmt.Errorf("invalid signed file entry %q", f.Path)
		}
		seen[f.Path] = true
		last = f.Path
		if f.Path == m.Entry {
			entryFound = true
		}
		total += f.Bytes
		if total > packageMaxTotal {
			return m, errors.New("package too large")
		}
		p := filepath.Join(bundle, filepath.FromSlash(f.Path))
		info, e := os.Lstat(p)
		if e != nil || !info.Mode().IsRegular() || info.Size() != f.Bytes {
			return m, fmt.Errorf("package file missing, altered or symlinked: %s", f.Path)
		}
		file, e := os.Open(p)
		if e != nil {
			return m, e
		}
		h := sha256.New()
		_, copyErr := io.Copy(h, io.LimitReader(file, packageMaxFile+1))
		closeErr := file.Close()
		if copyErr != nil {
			return m, copyErr
		}
		if closeErr != nil {
			return m, closeErr
		}
		if hex.EncodeToString(h.Sum(nil)) != f.SHA256 {
			return m, fmt.Errorf("file SHA-256 mismatch: %s", f.Path)
		}
	}
	if !entryFound {
		return m, errors.New("signed entry file missing")
	}
	return m, nil
}

func installBundle(bundle string) (packageManifest, error) {
	m, err := verifyBundle(bundle, true)
	if err != nil {
		return m, err
	}
	root, err := packageRoot()
	if err != nil {
		return m, err
	}
	parent := filepath.Join(root, "packages", m.Name)
	if err = os.MkdirAll(parent, 0700); err != nil {
		return m, err
	}
	target := filepath.Join(parent, m.Version)
	if _, err := os.Lstat(target); err == nil {
		return m, errors.New("version already installed; delete nothing automatically")
	} else if !os.IsNotExist(err) {
		return m, err
	}
	staged, err := os.MkdirTemp(parent, ".staging-")
	if err != nil {
		return m, err
	}
	defer os.RemoveAll(staged)
	for _, f := range m.Files {
		src := filepath.Join(bundle, filepath.FromSlash(f.Path))
		dst := filepath.Join(staged, filepath.FromSlash(f.Path))
		if err = os.MkdirAll(filepath.Dir(dst), 0700); err != nil {
			return m, err
		}
		// Recheck the payload immediately before copying, then verify the staged file.
		info, e := os.Lstat(src)
		if e != nil || !info.Mode().IsRegular() {
			return m, fmt.Errorf("source replaced during install: %s", f.Path)
		}
		in, e := os.Open(src)
		if e != nil {
			return m, e
		}
		out, e := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			in.Close()
			return m, e
		}
		h := sha256.New()
		_, copyErr := io.Copy(io.MultiWriter(out, h), io.LimitReader(in, f.Bytes+1))
		closeOut := out.Close()
		closeIn := in.Close()
		if copyErr != nil {
			return m, copyErr
		}
		if closeOut != nil {
			return m, closeOut
		}
		if closeIn != nil {
			return m, closeIn
		}
		if hex.EncodeToString(h.Sum(nil)) != f.SHA256 {
			return m, fmt.Errorf("source file changed while installing: %s", f.Path)
		}
		if f.Path == m.Entry {
			_ = os.Chmod(dst, 0700)
		}
	}
	signed, _ := json.MarshalIndent(m, "", "  ")
	if err = saveExclusive(filepath.Join(staged, "sdpn-package.json"), append(signed, '\n'), 0600); err != nil {
		return m, err
	}
	if err = os.Rename(staged, target); err != nil {
		return m, err
	}
	return m, nil
}

func (t *Terminal) runPackage(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: pkg keygen <dir> | trust <pubfile> | sign <bundle> <keyfile> | verify <bundle> | install <bundle> | list | exec <name> <version> [args]")
	}
	switch args[0] {
	case "keygen":
		if len(args) != 2 {
			return errors.New("usage: pkg keygen <directory>")
		}
		dir := packageBundlePath(t, args[1])
		if err := os.MkdirAll(dir, 0700); err != nil {
			return err
		}
		pub, private, e := ed25519.GenerateKey(rand.Reader)
		if e != nil {
			return e
		}
		if e = saveExclusive(filepath.Join(dir, "publisher.key"), []byte(base64.RawURLEncoding.EncodeToString(private)+"\n"), 0600); e != nil {
			return e
		}
		if e = saveExclusive(filepath.Join(dir, "publisher.pub"), []byte(base64.RawURLEncoding.EncodeToString(pub)+"\n"), 0644); e != nil {
			return e
		}
		fmt.Fprintf(t.Out, "Created private publisher key and public key; fingerprint %s. Keep .key private.\n", keyFingerprint(pub))
		return nil
	case "trust":
		if len(args) != 2 {
			return errors.New("usage: pkg trust <publisher.pub>")
		}
		b, e := os.ReadFile(packageBundlePath(t, args[1]))
		if e != nil {
			return e
		}
		pub, e := loadPublicKey(string(b))
		if e != nil {
			return e
		}
		root, e := packageRoot()
		if e != nil {
			return e
		}
		dir := filepath.Join(root, "trust")
		if e = os.MkdirAll(dir, 0700); e != nil {
			return e
		}
		path := filepath.Join(dir, keyFingerprint(pub)+".pub")
		if e = saveExclusive(path, []byte(strings.TrimSpace(string(b))+"\n"), 0600); e != nil {
			return e
		}
		fmt.Fprintf(t.Out, "Trusted publisher %s (explicit local trust).\n", keyFingerprint(pub))
		return nil
	case "sign":
		if len(args) != 3 {
			return errors.New("usage: pkg sign <bundle> <publisher.key>")
		}
		finger, e := signBundle(packageBundlePath(t, args[1]), packageBundlePath(t, args[2]))
		if e != nil {
			return e
		}
		fmt.Fprintln(t.Out, "Signed offline SDPN package with publisher", finger)
		return nil
	case "verify":
		if len(args) != 2 {
			return errors.New("usage: pkg verify <bundle>")
		}
		m, e := verifyBundle(packageBundlePath(t, args[1]), true)
		if e != nil {
			return e
		}
		fmt.Fprintf(t.Out, "Verified trusted offline package %s@%s (%d files)\n", m.Name, m.Version, len(m.Files))
		return nil
	case "install":
		if len(args) != 2 {
			return errors.New("usage: pkg install <bundle>")
		}
		m, e := installBundle(packageBundlePath(t, args[1]))
		if e != nil {
			return e
		}
		fmt.Fprintf(t.Out, "Installed trusted offline package %s@%s\n", m.Name, m.Version)
		return nil
	case "list":
		root, e := packageRoot()
		if e != nil {
			return e
		}
		parent := filepath.Join(root, "packages")
		packages, e := os.ReadDir(parent)
		if os.IsNotExist(e) {
			fmt.Fprintln(t.Out, "No packages installed")
			return nil
		}
		if e != nil {
			return e
		}
		for _, p := range packages {
			if !p.IsDir() || !safePackageName(p.Name()) {
				continue
			}
			versions, _ := os.ReadDir(filepath.Join(parent, p.Name()))
			for _, v := range versions {
				if v.IsDir() && safePackageVersion(v.Name()) {
					fmt.Fprintf(t.Out, "%s@%s\n", p.Name(), v.Name())
				}
			}
		}
		return nil
	case "exec":
		if len(args) < 3 {
			return errors.New("usage: pkg exec <name> <version> [args]")
		}
		if !safePackageName(args[1]) || !safePackageVersion(args[2]) {
			return errors.New("invalid package identity")
		}
		root, e := packageRoot()
		if e != nil {
			return e
		}
		bundle := filepath.Join(root, "packages", args[1], args[2])
		m, e := verifyBundle(bundle, true)
		if e != nil {
			return e
		}
		if m.Name != args[1] || m.Version != args[2] {
			return errors.New("package identity mismatch")
		}
		file := filepath.Join(bundle, filepath.FromSlash(m.Entry))
		ext := strings.ToLower(filepath.Ext(file))
		switch ext {
		case ".py", ".js", ".mjs", ".cjs", ".ts", ".mts", ".go", ".rb", ".php", ".sh", ".ps1", ".java", ".swift", ".lua", ".r", ".pl":
			return t.runPolyglot(append([]string{file}, args[3:]...))
		}
		return t.start(exec.Command(file, args[3:]...))
	default:
		return fmt.Errorf("unknown pkg subcommand %q", args[0])
	}
}
