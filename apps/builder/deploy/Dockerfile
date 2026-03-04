FROM node:22-alpine

RUN apk add --no-cache docker-cli docker-cli-buildx

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/builder/package.json ./apps/builder/package.json
COPY apps/runtime-agent/package.json ./apps/runtime-agent/package.json

RUN npm ci

COPY apps/builder ./apps/builder
COPY apps/runtime-agent ./apps/runtime-agent

EXPOSE 8788

CMD ["node", "--import", "tsx/esm", "apps/builder/src/server.ts"]
