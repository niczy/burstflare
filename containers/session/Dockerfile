FROM node:20-alpine

RUN apk add --no-cache openssh-server openssh-sftp-server \
  && adduser -D dev \
  && echo "dev:burstflare-runtime" | chpasswd \
  && mkdir -p /run/sshd /var/run/sshd /home/dev/.ssh \
  && chown -R dev:dev /home/dev

WORKDIR /app

COPY server.mjs /app/server.mjs

ENV PORT=8080

EXPOSE 8080

CMD ["node", "/app/server.mjs"]
