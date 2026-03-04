FROM golang:1.24-alpine AS burstflare-runtime-build

ARG TARGETOS=linux
ARG TARGETARCH=amd64

WORKDIR /src

COPY runtime-agent/ /src/

RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /out/burstflare-runtime .

FROM alpine:3.20

RUN apk add --no-cache openssh-server openssh-sftp-server \
  && adduser -D flare \
  && echo "flare:burstflare-runtime" | chpasswd \
  && mkdir -p /run/sshd /var/run/sshd /home/flare/.ssh \
  && chown -R flare:flare /home/flare

COPY --from=burstflare-runtime-build /out/burstflare-runtime /usr/local/bin/burstflare-runtime

ENV PORT=8080

EXPOSE 8080

CMD ["/usr/local/bin/burstflare-runtime"]
