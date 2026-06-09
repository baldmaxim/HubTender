// Package cbr fetches official Central Bank of Russia (cbr.ru) daily currency
// exchange rates. It is the BFF's only third-party HTTP integration besides
// SMTP — kept deliberately small: one endpoint, no retry, per-date caching.
package cbr

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/html/charset"

	"github.com/su10/hubtender/backend/internal/cache"
)

const (
	// defaultBaseURL is the official CBR daily-rates XML endpoint. It accepts an
	// optional date_req=DD/MM/YYYY query parameter; for weekends/holidays it
	// returns the last published set effective on that date.
	defaultBaseURL = "https://www.cbr.ru/scripts/XML_daily.asp"
	defaultTTL     = 6 * time.Hour
	httpTimeout    = 8 * time.Second

	charUSD = "USD"
	charEUR = "EUR"
	charCNY = "CNY"
)

// Rates holds the three currency rates the tender form needs, expressed in
// RUB per single unit of the currency (CBR Value already divided by Nominal),
// rounded to 2 decimals to match the form's input precision.
type Rates struct {
	Date string  `json:"date"` // effective date reported by CBR, YYYY-MM-DD
	USD  float64 `json:"usd"`
	EUR  float64 `json:"eur"`
	CNY  float64 `json:"cny"`
}

// Client fetches CBR daily rates and caches them per requested date.
type Client struct {
	http    *http.Client
	baseURL string
	cache   *cache.InMem
	ttl     time.Duration
}

// NewClient constructs a CBR client. An empty baseURL falls back to the
// official cbr.ru endpoint. The cache may be nil (caching becomes a no-op).
func NewClient(c *cache.InMem, baseURL string) *Client {
	if strings.TrimSpace(baseURL) == "" {
		baseURL = defaultBaseURL
	}
	return &Client{
		http:    &http.Client{Timeout: httpTimeout},
		baseURL: baseURL,
		cache:   c,
		ttl:     defaultTTL,
	}
}

// valCurs / valute mirror the subset of the CBR XML we read. The <Name> field
// (windows-1251 Cyrillic) is intentionally not mapped — we only need ASCII
// CharCode / Nominal / Value.
type valCurs struct {
	XMLName xml.Name `xml:"ValCurs"`
	Date    string   `xml:"Date,attr"`
	Valutes []valute `xml:"Valute"`
}

type valute struct {
	CharCode string `xml:"CharCode"`
	Nominal  string `xml:"Nominal"`
	Value    string `xml:"Value"`
}

// RatesForDate returns USD/EUR/CNY rates effective on day. Results are cached
// per requested date so repeatedly opening the tender form does not hammer CBR.
func (c *Client) RatesForDate(ctx context.Context, day time.Time) (*Rates, error) {
	reqDate := day.Format("02/01/2006") // CBR expects DD/MM/YYYY
	cacheKey := "cbr:rates:" + reqDate

	if c.cache != nil {
		if v, ok := c.cache.Get(cacheKey); ok {
			if r, ok := v.(*Rates); ok {
				return r, nil
			}
		}
	}

	rates, err := c.fetch(ctx, reqDate)
	if err != nil {
		return nil, err
	}

	if c.cache != nil {
		c.cache.Set(cacheKey, rates, c.ttl)
	}
	return rates, nil
}

// fetch performs the HTTP GET and delegates parsing. reqDate is a controlled
// DD/MM/YYYY string (digits + slashes), so it is embedded literally — CBR's
// documented examples use unescaped slashes.
func (c *Client) fetch(ctx context.Context, reqDate string) (*Rates, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"?date_req="+reqDate, nil)
	if err != nil {
		return nil, fmt.Errorf("cbr: build request: %w", err)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cbr: request: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("cbr: unexpected status %d", resp.StatusCode)
	}
	return parseValCurs(resp.Body)
}

// parseValCurs decodes the CBR XML (windows-1251) and extracts the three
// currencies. Returns an error if any of USD/EUR/CNY is missing.
func parseValCurs(body io.Reader) (*Rates, error) {
	dec := xml.NewDecoder(body)
	// CBR serves windows-1251; charset.NewReaderLabel transparently transcodes
	// it to UTF-8. ASCII numeric fields pass through unchanged.
	dec.CharsetReader = charset.NewReaderLabel

	var doc valCurs
	if err := dec.Decode(&doc); err != nil {
		return nil, fmt.Errorf("cbr: decode xml: %w", err)
	}

	out := &Rates{Date: normalizeDate(doc.Date)}
	var foundUSD, foundEUR, foundCNY bool
	for _, v := range doc.Valutes {
		rate, err := parseRate(v.Value, v.Nominal)
		if err != nil {
			continue
		}
		switch strings.ToUpper(strings.TrimSpace(v.CharCode)) {
		case charUSD:
			out.USD, foundUSD = rate, true
		case charEUR:
			out.EUR, foundEUR = rate, true
		case charCNY:
			out.CNY, foundCNY = rate, true
		}
	}
	if !foundUSD || !foundEUR || !foundCNY {
		return nil, fmt.Errorf("cbr: response missing one of USD/EUR/CNY")
	}
	return out, nil
}

// parseRate converts a CBR "73,2644" value and "10" nominal into a RUB-per-unit
// rate rounded to 2 decimals. CBR uses a comma decimal separator; the nominal
// is the number of currency units the value is quoted for (e.g. CNY was 10).
func parseRate(value, nominal string) (float64, error) {
	val, err := strconv.ParseFloat(toDot(value), 64)
	if err != nil {
		return 0, err
	}
	nom, err := strconv.ParseFloat(toDot(nominal), 64)
	if err != nil || nom == 0 {
		nom = 1
	}
	return round2(val / nom), nil
}

func toDot(s string) string {
	return strings.ReplaceAll(strings.TrimSpace(s), ",", ".")
}

func round2(x float64) float64 {
	return math.Round(x*100) / 100
}

// normalizeDate converts CBR "09.06.2026" to ISO "2026-06-09". On parse failure
// it returns the input unchanged — the field is informational only.
func normalizeDate(d string) string {
	t, err := time.Parse("02.01.2006", strings.TrimSpace(d))
	if err != nil {
		return d
	}
	return t.Format("2006-01-02")
}
