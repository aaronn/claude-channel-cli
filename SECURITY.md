# Security Policy

## Supported Versions

`claude-cli-channel` is an early-preview project. Security fixes target the current `main` branch until versioned releases exist.

## Threat Model

The channel server is designed for same-machine local development:

- The HTTP listener binds to `127.0.0.1` by default.
- Requests to `/tell` and `/ask` require a bearer token.
- The token is stored at `~/.claude-channel/token` with mode `0600`.
- Request bodies are size-limited.

Changing `CLAUDE_CHANNEL_HOST` away from `127.0.0.1` can expose the channel to other machines. Treat that as advanced testing only unless you have added and reviewed an explicit access-control model.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately before opening a public issue.

Contact Aaron through the repository owner's GitHub profile. If a private contact path is not available, open a minimal issue asking for a private security contact without including exploit details.
