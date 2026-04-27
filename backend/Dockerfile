# ---------------------------------------------------------------------------
# Stage 1 — build
# ---------------------------------------------------------------------------
FROM golang:1.23-alpine AS builder

WORKDIR /app

# Copy module manifest first so Docker can cache the download layer.
COPY go.mod ./

# go mod tidy requires the full source tree, so we copy sources first and then
# run download + tidy together. go.sum is intentionally absent from the repo —
# the Dockerfile generates it.
COPY . .

RUN go mod download && go mod tidy

RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w" \
    -o server \
    ./cmd/server

# ---------------------------------------------------------------------------
# Stage 2 — minimal runtime image
# ---------------------------------------------------------------------------
FROM gcr.io/distroless/static-debian12

WORKDIR /app

COPY --from=builder /app/server .

EXPOSE 3005

ENTRYPOINT ["/app/server"]
