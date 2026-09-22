package mcpauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

type cimdDocument struct {
	ClientID        string   `json:"client_id"`
	ClientName      string   `json:"client_name"`
	RedirectURIs    []string `json:"redirect_uris"`
	Scope           string   `json:"scope"`
	ApplicationType string   `json:"application_type"`
}

// resolveCIMD loads a Client ID Metadata Document only from an explicitly
// allowlisted public HTTPS host. A pinned-IP transport closes the DNS-rebinding
// window between validation and the actual request.
func resolveCIMD(ctx context.Context, clientID string, allowedHosts []string) (*Client, error) {
	u, err := url.Parse(clientID)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return nil, errors.New("client_id is not an allowed HTTPS metadata URL")
	}
	if !slices.Contains(allowedHosts, u.Hostname()) {
		return nil, errors.New("client metadata host is not allowlisted")
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, u.Hostname())
	if err != nil || len(addresses) == 0 {
		return nil, errors.New("client metadata host could not be resolved")
	}
	var pinned net.IP
	for _, addr := range addresses {
		if isPublicIP(addr.IP) {
			pinned = addr.IP
			break
		}
	}
	if pinned == nil {
		return nil, errors.New("client metadata host resolves to a private address")
	}
	port := u.Port()
	if port == "" {
		port = "443"
	}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, network, net.JoinHostPort(pinned.String(), port))
		},
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   4 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("client metadata redirects are not allowed")
		},
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch client metadata: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("client metadata returned HTTP %d", resp.StatusCode)
	}
	var doc cimdDocument
	dec := json.NewDecoder(io.LimitReader(resp.Body, 64*1024))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&doc); err != nil {
		return nil, fmt.Errorf("decode client metadata: %w", err)
	}
	if doc.ClientID != clientID || strings.TrimSpace(doc.ClientName) == "" {
		return nil, errors.New("client metadata identity mismatch")
	}
	return &Client{
		ID:               doc.ClientID,
		Name:             doc.ClientName,
		RedirectURIs:     doc.RedirectURIs,
		AllowedScopes:    strings.Fields(doc.Scope),
		ApplicationType:  defaultString(doc.ApplicationType, "native"),
		RegistrationKind: "cimd",
	}, nil
}

func isPublicIP(ip net.IP) bool {
	return ip != nil && !ip.IsLoopback() && !ip.IsPrivate() && !ip.IsLinkLocalUnicast() &&
		!ip.IsLinkLocalMulticast() && !ip.IsUnspecified() && !ip.IsMulticast()
}

func defaultString(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}
