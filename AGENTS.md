# Repo Workflow

- Do not push changes directly to `main`.
- Create a feature branch, push that branch, and open a pull request.
- Wait for the GitHub CI checks on the pull request to pass before merging.
- Merge the pull request only after CI is green.

# Deploy Credentials

- Cloudflare and other secrets are stored in `.env` at the repo root.
- Load them before running any deploy or Cloudflare command: `source .env` or `set -a && source .env && set +a`.
- Never commit `.env` or paste token values into code, configs, or docs.
