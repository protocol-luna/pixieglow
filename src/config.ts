import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const configPath = join(ROOT, "config.yml");

const rawCfg: Record<string, unknown> = existsSync(configPath)
	? (yaml.load(readFileSync(configPath, "utf-8")) as Record<string, unknown>)
	: {};

function v<T>(key: string, fallback: T): T {
	return (rawCfg[key] as T) ?? fallback;
}

export const MATRIX_HOMESERVER: string =
	v<string | null>("matrix_homeserver", null) ??
	process.env.MATRIX_HOMESERVER ??
	(() => {
		console.error("MATRIX_HOMESERVER required");
		process.exit(1);
	})();

export const MATRIX_TOKEN: string =
	v<string | null>("matrix_token", null) ??
	process.env.MATRIX_TOKEN ??
	(() => {
		console.error("MATRIX_TOKEN required");
		process.exit(1);
	})();

export const MATRIX_USERNAME: string =
	v<string | null>("matrix_username", null) ??
	process.env.MATRIX_USERNAME ??
	"pixieglow";

export const BOT_SERVER: string =
	v<string | null>("bot_server", null) ??
	process.env.BOT_SERVER ??
	"protocol-luna.github.io";

export const EMERALD_HOST: string =
	v<string | null>("emerald_host", null) ??
	process.env.EMERALD_HOST ??
	"127.0.0.1";

export const EMERALD_PORT: number =
	v<number | null>("emerald_port", null) ??
	Number.parseInt(process.env.EMERALD_PORT ?? "3126", 10);
