<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="images/logo.png">
    <img src="images/logo.png" alt="Pixieglow" width="200" style="border-radius: 20px;">
  </picture>
  <h1 align="center">Pixieglow</h1>
  <p align="center">Matrix adapter for the Luna Protocol ecosystem</p>
  <p align="center">
    <a href="https://github.com/protocol-luna/pixieglow/blob/main/LICENSE">
      <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
    </a>
    <a href="https://www.typescriptlang.org/">
      <img src="https://img.shields.io/badge/language-TypeScript-3178C6?style=flat-square" alt="Language">
    </a>
    <a href="https://matrix.org/">
      <img src="https://img.shields.io/badge/platform-Matrix-000000?style=flat-square" alt="Matrix">
    </a>
    <a href="https://bun.sh/">
      <img src="https://img.shields.io/badge/runtime-Bun-F9F9F9?style=flat-square" alt="Bun">
    </a>
    <a href="https://github.com/protocol-luna">
      <img src="https://img.shields.io/badge/part%20of-Luna%20Protocol-9370DB?style=flat-square" alt="Luna Protocol">
    </a>
  </p>
</p>

Pixieglow acts as a thin WebSocket client of **Emerald** (the brain service), forwarding Matrix messages and executing response commands.

```mermaid
graph LR
    Matrix["Matrix"] --> Pixieglow["Pixieglow<br/><strong>Matrix Adapter</strong>"]
    Pixieglow -- "WebSocket :3126" --> Emerald["Emerald<br/>Brain"]
    Emerald --> Sapphire["Sapphire<br/>LLM Gateway"]
    Sapphire --> Krystal["Krystal<br/>llama.cpp"]
```

## How It Works

1. Pixieglow connects to Emerald via WebSocket on port 3126
2. Pixieglow listens to Matrix room messages via the Matrix client-server API (sync loop) and forwards them to Emerald as `MessageEvent`s
3. Emerald processes the message, calls Sapphire, and sends a `RespondCommand` back
4. Pixieglow extracts `responseText` from the command and sends it to the Matrix room
5. Pixieglow handles typing indicators via `TypingCommand`

## Features

- **Emerald WebSocket client** — Thin adapter, all LLM logic delegated to Emerald
- **Matrix sync loop** — Polls the Matrix API for new messages
- **Multi-room** — Responds to all rooms the bot is in

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
bun install

# Development
bun run dev

# Production (PM2)
bun run start
```
