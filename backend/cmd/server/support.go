package main

import (
	"encoding/base64"
	"net/http"
	"os"
	"time"

	"github.com/su10/hubtender/backend/internal/auth"
	"github.com/su10/hubtender/backend/internal/config"
)

// runHealthcheck performs a single GET against /health on the local server
// and exits 0 on 2xx / 1 otherwise. Used by the Docker HEALTHCHECK because
// distroless lacks wget/curl.
func runHealthcheck() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3005"
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/health")
	if err != nil {
		os.Exit(1)
	}
	defer resp.Body.Close() //nolint:errcheck
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		os.Exit(1)
	}
	os.Exit(0)
}

// loadAppSigningKey reads the RSA PEM private key for the app JWT issuer
// from either APP_JWT_PRIVATE_KEY_PATH (filesystem) or APP_JWT_PRIVATE_KEY_B64
// (base64-encoded PEM env var). Path takes precedence when both are set —
// makes Docker / k8s mounts the obvious choice.
func loadAppSigningKey(cfg *config.Config) (*auth.SigningKey, error) {
	var pemBytes []byte
	switch {
	case cfg.AppJWTPrivateKeyPath != "":
		b, err := os.ReadFile(cfg.AppJWTPrivateKeyPath)
		if err != nil {
			return nil, err
		}
		pemBytes = b
	case cfg.AppJWTPrivateKeyB64 != "":
		b, err := base64.StdEncoding.DecodeString(cfg.AppJWTPrivateKeyB64)
		if err != nil {
			return nil, err
		}
		pemBytes = b
	default:
		// Should never happen: config.Load already validated this; defensive.
		return nil, errMissingAppKey
	}
	return auth.LoadSigningKey(pemBytes)
}

// errMissingAppKey is exposed as a package-level sentinel so the failure
// shows up cleanly in logs (rather than a fresh fmt.Errorf each load).
var errMissingAppKey = newSentinel("config: neither APP_JWT_PRIVATE_KEY_PATH nor APP_JWT_PRIVATE_KEY_B64 set")

func newSentinel(msg string) error { return &sentinelErr{msg: msg} }

type sentinelErr struct{ msg string }

func (e *sentinelErr) Error() string { return e.msg }
