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
