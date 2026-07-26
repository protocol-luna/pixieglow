# Pixieglow

Matrix bot adapter for Protocol Luna.

Thin client that connects Matrix (tuwunel) to the **Emerald** brain service. Send events, execute commands, no behavior logic.

```
Matrix API ←→ Pixieglow (custom MatrixClient)
                  │ WebSocket
                  ▼
              Emerald (brain)
                  │
                  ▼
              Sapphire (LLM gateway) → Krystal (llama.cpp)
```

## Features

- **Matrix client** — custom HTTP client for sync, send, reactions, upload
- **Auto-join** — accepts invites, tracks rooms and members
- **Emerald client** — WebSocket connection to the brain (auto-reconnect)
- **Sapphire client** — SSE streaming LLM calls

All behavior decisions (triggers, delays, reactions, burst, hesitation, sleep, fatigue, sessions) are handled by [Emerald](https://github.com/protocol-luna/emerald).

## Setup

```bash
git clone https://github.com/protocol-luna/pixieglow
cd pixieglow
bun install
cp config.example.yml config.yml
# edit config.yml with your Matrix token
bun run build && bun start
```

## Configuration

See `config.example.yml`. Only platform connectivity:

- `matrix_homeserver` — Matrix homeserver URL
- `matrix_token` — Matrix access token
- `matrix_username` / `bot_server` — Bot identity
- `sapphire_host` / `sapphire_port` — Sapphire gateway
- `emerald_host` / `emerald_port` — Emerald brain (WebSocket)

All behavior configuration is in [Emerald's `config.yml`](https://github.com/protocol-luna/emerald).

## Architecture

```
src/
├── bot/
│   └── matrix-bot.ts     # Sync loop + command executor (thin)
├── core/
│   ├── llm-core.ts       # Sapphire HTTP client (SSE streaming)
│   ├── llm-bus.ts        # Token event bus
│   └── emerald-client.ts # WebSocket client to Emerald
├── matrix/
│   └── client.ts         # Matrix HTTP client
├── behavior/             # (legacy, unused — logic moved to Emerald)
├── state/                # (legacy, unused — logic moved to Emerald)
├── config.ts             # Platform config only
├── cli.ts                # CLI entry point
└── index.ts              # Entry point
```

## Related

- [emerald](https://github.com/protocol-luna/emerald) — Brain service (this bot is a client of it)
- [sapphire](https://github.com/protocol-luna/sapphire) — LLM gateway
- [krystal](https://github.com/protocol-luna/krystal) — LLM inference server
- [jade](https://github.com/protocol-luna/jade) — Discord adapter (sibling bot)

## License

MIT
