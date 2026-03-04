# BurstFlare Builder

This service is the remote build endpoint consumed by `REMOTE_BUILD_URL`.

It accepts `POST /build`, builds a managed runtime image from the requested
`baseImage`, injects the BurstFlare startup bootstrap, pushes the final image,
and returns the pushed image reference plus digest.

Environment:

- `PORT` default `8788`
- `BUILDER_HOST` default `0.0.0.0`
- `BUILDER_IMAGE_REPOSITORY` required destination repository, for example `registry.example.com/burstflare/runtime`
- `BUILDER_AUTH_TOKEN` optional bearer token required for `POST /build`
- `BUILDER_DOCKER_BIN` default `docker`
- `BUILDER_PLATFORM` default `linux/amd64`
- `BUILDER_PUSH` default `1` (`0` switches to `--load`)
- `BUILDER_KEEP_TEMP` default `0`

Runtime requirements:

- Docker with `buildx` available to the process
- registry credentials already configured on the host
- the selected `baseImage` must already include Node.js
- the selected `baseImage` must support one of: `apk`, `apt-get`, `microdnf`, `dnf`, or `yum`

Local run:

```bash
npm run dev --workspace @burstflare/builder
```

Production deploy bundle:

- `deploy/Dockerfile`
- `deploy/builder.env.example`
- `deploy/burstflare-builder.service`
- `deploy/builder.burstflare.dev.nginx.conf`

Suggested host rollout for `builder.burstflare.dev`:

1. Build the service image from repo root:
   `docker build -f apps/builder/deploy/Dockerfile -t burstflare-builder:latest .`
2. Copy `apps/builder/deploy/builder.env.example` to `/etc/burstflare-builder.env` and fill in the real values.
3. Put registry auth in `/etc/burstflare-builder/docker/config.json` so the containerized builder can push images.
4. Install `apps/builder/deploy/burstflare-builder.service` to `/etc/systemd/system/burstflare-builder.service`, then run:
   `sudo systemctl daemon-reload && sudo systemctl enable --now burstflare-builder`
5. Install `apps/builder/deploy/builder.burstflare.dev.nginx.conf` as an nginx site, point TLS at the real certificate paths, and reload nginx.
6. In the main BurstFlare app, set:
   `REMOTE_BUILD_URL=https://builder.burstflare.dev/build`
   `REMOTE_BUILD_TOKEN=<same value as BUILDER_AUTH_TOKEN>`
