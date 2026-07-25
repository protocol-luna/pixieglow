# pixieglow

Bot Matrix conversationnel alimenté par LLM, adapté du [Luna Protocol](https://github.com/fox3000foxy/Luna-Protocol) Discord.

Fabriqué pour [tuwunel](https://github.com/tuwunel/tuwunel) — un homeserver Matrix écrit en Rust.

## Fonctionnalités

- **Réponse aux mentions** — réagit quand on ping `@pixieglow:server`
- **Détection de nom/prénom** — répond quand on dit son nom
- **Mots-clés** — réagit à certains mots dans la conversation
- **Messages spontanés** — parle toute seule de temps en temps
- **Suivi de conversation** — enchaîne naturellement sur les messages récents
- **Typos** — fait des fautes de frappe et les corrige (clavier AZERTY/QWERTY)
- **Burst** — envoie parfois un second message spontané après le premier
- **Hésitations** — commence par "uh...", "um..." de temps en temps
- **Réactions** — ajoute des emoji aux messages
- **Planning horaire** — comportement différent selon l'heure (actif, lent, sleep, court)
- **Fatigue thématique** — se désintéresse des sujets répétés
- **Sessions** — limite de messages par session avec pause
- **Réveil progressif** — réponses plus lentes après inactivité
- **TTS** — messages vocaux via Piper
- **Hot-reload** — la config se recharge sans redémarrer le bot

## Prérequis

- [Bun](https://bun.sh) >= 1.3
- Un homeserver Matrix (testé avec [tuwunel](https://github.com/tuwunel/tuwunel))
- Un modèle LLM :
  - **Mode direct** : [llama-server](https://github.com/ggml-org/llama.cpp) avec un GGUF
  - **Mode online** : n'importe quelle API OpenAI-compatible

## Installation

```bash
git clone https://github.com/protocol-luna/pixieglow
cd pixieglow
bun install
```

## Configuration

Crée `config.yml` à la racine du projet (voir `config.example.yml` pour toutes les options) :

```yaml
matrix_homeserver: "https://votre-serveur"
matrix_token: "votre_token_matrix"
matrix_username: "pixieglow"
bot_server: "votre-serveur.example.com"

# Mode direct (llama-server)
llama_model_path: "./models/mon-modele.gguf"
llm_host: "localhost"
llm_port: 3124
llm_mode: "direct"

# Ou mode online (API OpenAI)
# llm_mode: "online"
# llm_api_endpoint: "https://api.openai.com/v1"
# llm_api_token: "sk-..."
# llm_model: "gpt-4o-mini"
```

### Variables d'environnement

Tous les champs de `config.yml` peuvent être surchargés par des variables d'environnement :

- `MATRIX_HOMESERVER`, `MATRIX_TOKEN`, `MATRIX_USERNAME`, `BOT_SERVER`
- `LLAMA_MODEL_PATH`, `LLM_HOST`, `LLM_PORT`, `LLM_MODE`, `LLM_API_ENDPOINT`, `LLM_API_TOKEN`, `LLM_MODEL`
- `LLM_SESSION_TTL`, `LLM_N_THREADS`, `LLM_N_SLOTS`, `LLM_N_CTX`
- `TTS_MODEL_PATH`, `TTS_BINARY_PATH`, `FFMPEG_PATH`, `FFPROBE_PATH`

## Utilisation

```bash
# Lancer le bot
bun start

# Mode développement (hot-reload)
bun dev

# Compiler un binaire
bun run build
```

Le bot se connecte au homeserver, rejoint automatiquement les salons où il est invité, et commence à répondre.

## Structure du projet

```
src/
├── behavior/       # Comportement (typos, burst, hésitations, sommeil)
├── bot/            # Orchestration du bot, boucle sync
├── core/           # LLM client, bus d'événements, few-shot
├── matrix/         # Client HTTP Matrix (sync, envoi, upload, réactions)
├── state/          # Gestion d'état (cooldowns, triggers, persistance)
├── tts/            # Synthèse vocale (Piper)
├── cli.ts          # Point d'entrée CLI
├── config.ts       # Configuration hot-reloadable
└── index.ts        # Point d'entrée
```

## Licence

MIT
