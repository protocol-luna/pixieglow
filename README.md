# pixieglow

A conversational Matrix bot powered by an LLM, part of the [Protocol Luna](https://github.com/protocol-luna/.github) project.

Built for [tuwunel](https://github.com/tuwunel/tuwunel) — a Matrix homeserver written in Rust.

## Features

- **Mention replies** — responds when pinged with `@pixieglow:server`
- **Name detection** — replies when someone says its name
- **Keywords** — reacts to specific words in conversation
- **Spontaneous messages** — occasionally chimes in unprompted
- **Conversation tracking** — naturally follows up on recent messages
- **Typos** — makes typing mistakes and self-corrects (AZERTY/QWERTY)
- **Burst** — sometimes sends a second message after the first
- **Hesitations** — starts with "uh...", "um..." now and then
- **Reactions** — adds emoji to messages
- **Time schedules** — behaves differently depending on time of day (active, slow, sleep, short)
- **Topic fatigue** — loses interest in repeated topics
- **Sessions** — message limit per session with pause
- **Warm-up** — slower responses after inactivity
- **TTS** — voice messages via Piper
- **Hot-reload** — config reloads without restart

## Requirements

- [Bun](https://bun.sh) >= 1.3
- A Matrix homeserver (tested with [tuwunel](https://github.com/tuwunel/tuwunel))
- An LLM backend:
  - **Direct mode**: [krystal](https://github.com/protocol-luna/krystal) (llama-server)
  - **Online mode**: any OpenAI-compatible API

## Setup

```bash
git clone https://github.com/protocol-luna/pixieglow
cd pixieglow
bun install
```

## Configuration

Create `config.yml` in the project root (see `config.example.yml` for all options):

```yaml
matrix_homeserver: "https://your-server"
matrix_token: "your_matrix_token"
matrix_username: "pixieglow"
bot_server: "your-server.example.com"

# Direct mode (krystal)
llm_host: "localhost"
llm_port: 3124
llm_mode: "direct"

# Or online mode (OpenAI API)
# llm_mode: "online"
# llm_api_endpoint: "https://api.openai.com/v1"
# llm_api_token: "sk-..."
# llm_model: "gpt-4o-mini"
```

### Environment variables

Every `config.yml` field can be overridden with environment variables:

- `MATRIX_HOMESERVER`, `MATRIX_TOKEN`, `MATRIX_USERNAME`, `BOT_SERVER`
- `LLM_HOST`, `LLM_PORT`, `LLM_MODE`, `LLM_API_ENDPOINT`, `LLM_API_TOKEN`, `LLM_MODEL`
- `LLM_SESSION_TTL`, `LLM_N_SLOTS`
- `TTS_MODEL_PATH`, `TTS_BINARY_PATH`, `FFMPEG_PATH`, `FFPROBE_PATH`

## Usage

```bash
# Start the bot
bun start

# Development mode (hot-reload)
bun dev

# Compile a standalone binary
bun run build
```

The bot connects to the homeserver, auto-joins rooms it's invited to, and starts responding.

## Project structure

```
src/
├── behavior/       # Personality features (typos, burst, hesitations, sleep)
├── bot/            # Bot orchestration, sync loop
├── core/           # LLM client, event bus, few-shot priming
├── matrix/         # Matrix HTTP client (sync, send, upload, reactions)
├── state/          # State management (cooldowns, triggers, persistence)
├── tts/            # Text-to-speech (Piper)
├── cli.ts          # CLI entry point
├── config.ts       # Hot-reloadable configuration
└── index.ts        # Entry point
```

## Related

- [krystal](https://github.com/protocol-luna/krystal) — LLM inference server
- [jade](https://github.com/protocol-luna/jade) — Discord bot client
- [protocol-luna](https://github.com/protocol-luna/.github) — Documentation & state-machine diagrams

## License

MIT
