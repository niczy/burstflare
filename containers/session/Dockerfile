FROM golang:1.24-alpine AS burstflare-runtime-build

ARG TARGETOS=linux
ARG TARGETARCH=amd64

WORKDIR /src

COPY apps/runtime-agent/go.mod ./go.mod
COPY apps/runtime-agent/go.sum ./go.sum
COPY apps/runtime-agent/main.go ./main.go
COPY apps/runtime-agent/agent ./agent

RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /out/burstflare-runtime .

FROM node:20-alpine

RUN apk add --no-cache openssh-server openssh-sftp-server \
  && adduser -D flare \
  && echo "flare:burstflare-runtime" | chpasswd \
  && mkdir -p /run/sshd /var/run/sshd /home/flare/.ssh \
  && chown -R flare:flare /home/flare

WORKDIR /app

COPY --from=burstflare-runtime-build /out/burstflare-runtime /usr/local/bin/burstflare-runtime
COPY containers/session/server.mjs /app/server.mjs
COPY containers/session/runtime-contract.mjs /app/runtime-contract.mjs

ENV PORT=8080

EXPOSE 8080

CMD ["/usr/local/bin/burstflare-runtime"]
