# ---------------------------------------------------------------------------
# Stage 1 — build
# ---------------------------------------------------------------------------
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Модули — отдельным слоем до исходников: Docker кэширует его, пока не меняются
# go.mod/go.sum (на сервере proxy.golang.org отдаёт ~20 КБ/с, полная загрузка ~10 мин).
COPY go.mod go.sum ./
RUN go mod download

# tidy нужен весь код; модули уже в кэше слоя, докачивается только недостающее.
COPY . .
RUN go mod tidy

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
