import { existsSync, readFileSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const configPath = join(ROOT, "config.yml");

let rawCfg: Record<string, unknown> = existsSync(configPath)
	? (yaml.load(readFileSync(configPath, "utf-8")) as Record<string, unknown>)
	: {};

function v<T>(key: string, fallback: T): T {
	return (rawCfg[key] as T) ?? fallback;
}

export function watchConfig(): void {
	if (!existsSync(configPath)) return;
	watch(configPath, (event) => {
		if (event !== "change") return;
		try {
			rawCfg = yaml.load(readFileSync(configPath, "utf-8")) as Record<
				string,
				unknown
			>;
			rebuildCache();
			console.log("[config] hot-reloaded config.yml");
		} catch (err) {
			console.error("[config] failed to reload config.yml:", err);
		}
	});
}

let cachedNames: string[] | null = null;
let cachedKeywords: string[] | null = null;
let cachedConcentration: ConcentrationThresholds | null = null;
let cachedReactions: string[] | null = null;
let cachedHesitationWords: string[] | null = null;
let cachedTimeSchedules: TimeScheduleEntry[] | null = null;
let cachedReplyStyles: { style: ReplyStyle; weight: number }[] | null = null;

function rebuildCache(): void {
	cachedNames = null;
	cachedKeywords = null;
	cachedConcentration = null;
	cachedReactions = null;
	cachedHesitationWords = null;
	cachedTimeSchedules = null;
	cachedReplyStyles = null;
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

export const SAPPHIRE_HOST: string =
	v<string | null>("sapphire_host", null) ??
	process.env.SAPPHIRE_HOST ??
	"localhost";

export const SAPPHIRE_PORT: number =
	v<number | null>("sapphire_port", null) ??
	Number.parseInt(process.env.SAPPHIRE_PORT ?? "3123", 10);

export interface ConcentrationEntry {
	delay_min: number;
	delay_max: number;
	ignore_chance: number;
	reaction_chance: number;
}

export interface ConcentrationThresholds {
	mention: ConcentrationEntry;
	dm: ConcentrationEntry;
	name: ConcentrationEntry;
	keyword: ConcentrationEntry;
	"follow-up": ConcentrationEntry;
	random: ConcentrationEntry;
	default: ConcentrationEntry;
}

export interface TimeScheduleEntry {
	start: string;
	end: string;
	behavior?: "sleep" | "slow" | "short";
}

export type SelfStatus = "online" | "idle" | "dnd" | "invisible";

export interface ReplyStyle {
	messageReference: boolean;
	mentionRepliedUser: boolean;
}

interface ReplyStyleEntry {
	message_reference: boolean;
	mention_replied_user: boolean;
	weight: number;
}

const DEFAULT_CONCENTRATION: ConcentrationThresholds = {
	mention: {
		delay_min: 300,
		delay_max: 1500,
		ignore_chance: 0.02,
		reaction_chance: 0.08,
	},
	dm: {
		delay_min: 400,
		delay_max: 1800,
		ignore_chance: 0,
		reaction_chance: 0.05,
	},
	name: {
		delay_min: 800,
		delay_max: 4000,
		ignore_chance: 0.02,
		reaction_chance: 0.06,
	},
	keyword: {
		delay_min: 1000,
		delay_max: 3500,
		ignore_chance: 0.02,
		reaction_chance: 0.04,
	},
	"follow-up": {
		delay_min: 500,
		delay_max: 2000,
		ignore_chance: 0.02,
		reaction_chance: 0.03,
	},
	random: {
		delay_min: 1500,
		delay_max: 5000,
		ignore_chance: 0.02,
		reaction_chance: 0.02,
	},
	default: {
		delay_min: 800,
		delay_max: 4000,
		ignore_chance: 0.02,
		reaction_chance: 0.06,
	},
};

function mergeConcentration(
	raw: Record<string, unknown>,
	defaults: ConcentrationThresholds,
): ConcentrationThresholds {
	const merged = { ...defaults };
	for (const key of Object.keys(
		defaults,
	) as (keyof ConcentrationThresholds)[]) {
		const entry = raw[key] as Record<string, unknown> | undefined;
		if (entry) {
			merged[key] = {
				delay_min: (entry.delay_min as number) ?? defaults[key].delay_min,
				delay_max: (entry.delay_max as number) ?? defaults[key].delay_max,
				ignore_chance:
					(entry.ignore_chance as number) ?? defaults[key].ignore_chance,
				reaction_chance:
					(entry.reaction_chance as number) ?? defaults[key].reaction_chance,
			};
		}
	}
	return merged;
}

export const config = {
	get names(): string[] {
		if (!cachedNames)
			cachedNames = v<string[]>("names", ["Pixieglow", "Pixie"]);
		return cachedNames;
	},
	get keywords(): string[] {
		if (!cachedKeywords)
			cachedKeywords = v<string[]>("keywords", [
				"hello",
				"hi",
				"hey",
				"yo",
				"help",
				"question",
				"ai",
				"llm",
				"bot",
			]);
		return cachedKeywords;
	},
	get randomChance(): number {
		return v<number>("random_chance", 0.015);
	},
	get cooldownSeconds(): number {
		return v<number>("cooldown_seconds", 8);
	},
	get replyInDM(): boolean {
		return v<boolean>("reply_in_dm", true);
	},
	get concentration(): ConcentrationThresholds {
		if (!cachedConcentration)
			cachedConcentration = mergeConcentration(
				v<Record<string, unknown>>("concentration", {}),
				DEFAULT_CONCENTRATION,
			);
		return cachedConcentration;
	},
	get reactions(): string[] {
		if (!cachedReactions)
			cachedReactions = v<string[]>("reactions", [
				"👀",
				"😄",
				"🤔",
				"👋",
				"🔥",
				"💀",
				"✨",
				"😭",
				"🤨",
				"👌",
				"🙏",
				"💅",
				"🗿",
				"🌚",
			]);
		return cachedReactions;
	},
	get spontaneousIntervalMs(): number {
		return v<number>("spontaneous_interval_ms", 300_000);
	},
	get spontaneousChance(): number {
		return v<number>("spontaneous_chance", 0.12);
	},
	get spontaneousContextMessages(): number {
		return v<number>("spontaneous_context_messages", 5);
	},
	get spontaneousWhitelist(): string {
		return v<string>("spontaneous_whitelist", "*");
	},
	get typoChance(): number {
		return v<number>("typo_chance", 0.06);
	},
	get typoLayout(): "azerty" | "qwerty" {
		return v<"azerty" | "qwerty">("typo_layout", "azerty");
	},
	get typoCorrectionDelay(): number {
		return v<number>("typo_correction_delay_min", 2000);
	},
	get typoCorrectionDelayMax(): number {
		return v<number>("typo_correction_delay_max", 4000);
	},
	get typoCorrectionStyle(): "edit" | "message" | "mixed" {
		return v<"edit" | "message" | "mixed">("typo_correction_style", "mixed");
	},
	get burstChance(): number {
		return v<number>("burst_chance", 0.15);
	},
	get burstDelayMin(): number {
		return v<number>("burst_delay_min", 1500);
	},
	get burstDelayMax(): number {
		return v<number>("burst_delay_max", 4000);
	},
	get topicFatigueEnabled(): boolean {
		return v<boolean>("topic_fatigue_enabled", true);
	},
	get topicFatigueWindow(): number {
		return v<number>("topic_fatigue_window", 10);
	},
	get topicFatigueThreshold(): number {
		return v<number>("topic_fatigue_threshold", 3);
	},
	get topicFatigueDelayMultiplier(): number {
		return v<number>("topic_fatigue_delay_multiplier", 2);
	},
	get topicFatigueIgnoreBonus(): number {
		return v<number>("topic_fatigue_ignore_bonus", 0.15);
	},
	get hesitationChance(): number {
		return v<number>("hesitation_chance", 0.15);
	},
	get hesitationWords(): string[] {
		if (!cachedHesitationWords)
			cachedHesitationWords = v<string[]>("hesitation_words", [
				"uh...",
				"um...",
				"well...",
				"i mean...",
				"hmm...",
				"so...",
			]);
		return cachedHesitationWords;
	},
	get forgetChance(): number {
		return v<number>("forget_chance", 0.03);
	},
	get inactivityWarmupMinutes(): number {
		return v<number>("inactivity_warmup_minutes", 10);
	},
	get inactivityWarmupMultiplier(): number {
		return v<number>("inactivity_warmup_multiplier", 2);
	},
	get voiceMessageChance(): number {
		return v<number>("voice_message_chance", 0.08);
	},
	get timezone(): string {
		return v<string>("timezone", "Europe/Paris");
	},
	get timeSchedules(): TimeScheduleEntry[] {
		if (cachedTimeSchedules) return cachedTimeSchedules;
		const raw = v<unknown[]>("time_schedules", []);
		if (!Array.isArray(raw)) return [];
		cachedTimeSchedules = raw.map((entry) => {
			const e = entry as Record<string, unknown>;
			return {
				start: String(e?.start ?? "00:00"),
				end: String(e?.end ?? "00:00"),
				behavior: ["sleep", "slow", "short"].includes(e?.behavior as string)
					? (e.behavior as "sleep" | "slow" | "short")
					: undefined,
			};
		});
		return cachedTimeSchedules;
	},
	get sessionMessageLimit(): number {
		return v<number>("session_message_limit", 8);
	},
	get sessionPauseSeconds(): number {
		return v<number>("session_pause_seconds", 30);
	},
	get sessionResetMinutes(): number {
		return v<number>("session_reset_minutes", 3);
	},
	get replyStyles(): { style: ReplyStyle; weight: number }[] {
		if (cachedReplyStyles) return cachedReplyStyles;
		const raw = v<ReplyStyleEntry[]>("reply_styles", [
			{ message_reference: true, mention_replied_user: false, weight: 50 },
			{ message_reference: true, mention_replied_user: true, weight: 15 },
			{ message_reference: false, mention_replied_user: false, weight: 30 },
			{ message_reference: false, mention_replied_user: true, weight: 5 },
		]);
		cachedReplyStyles = raw.map((s) => ({
			style: {
				messageReference: s.message_reference,
				mentionRepliedUser: s.mention_replied_user,
			},
			weight: s.weight,
		}));
		return cachedReplyStyles;
	},
};

export function pickReplyStyle(isActiveConversation: boolean): ReplyStyle {
	const styles = config.replyStyles;
	if (!isActiveConversation) {
		const roll = Math.random();
		if (roll < 0.7)
			return { messageReference: true, mentionRepliedUser: false };
		if (roll < 0.9) return { messageReference: true, mentionRepliedUser: true };
		return { messageReference: false, mentionRepliedUser: false };
	}
	const total = styles.reduce((s, e) => s + e.weight, 0);
	let roll = Math.random() * total;
	for (const entry of styles) {
		roll -= entry.weight;
		if (roll <= 0) return entry.style;
	}
	return styles[0].style;
}
