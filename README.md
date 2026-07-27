# Pixieglow

Pixieglow is the Matrix adapter for the Luna Protocol ecosystem. It acts as a thin WebSocket client of **Emerald** (the brain service), forwarding Matrix messages and executing response commands.

> **Architecture**: `Matrix → Pixieglow → WebSocket → Emerald`

## How It Works

1. Pixieglow connects to Emerald via WebSocket on port 3126
2. Pixieglow listens to Matrix room messages via the Matrix client-server API (sync loop) and forwards them to Emerald as `MessageEvent`s
3. Emerald processes the message, calls Sapphire, and sends a `RespondCommand` back
4. Pixieglow extracts `responseText` from the command and sends it to the Matrix room
5. Pixieglow handles typing indicators via `TypingCommand`

## Features

- **Emerald WebSocket client** -- Thin adapter, all LLM logic delegated to Emerald
- **Matrix sync loop** -- Polls the Matrix API for new messages
- **Multi-room** -- Responds to all rooms the bot is in

## Configuration

Copy `config.example.yml` to `config.yml`:

```yaml
matrix:
  homeserver_url: "https://matrix.fox3000foxy.com"
  access_token: "your_matrix_access_token"
emerald_host: "localhost"
emerald_port: 3126
```

## Running

```bash
# Install
npm install

# Development
npm run dev

# Production (PM2)
npm run start
```
