import { config } from "../config.js";
import { stateBus } from "./state-bus.js";

const roomCooldowns = new Map<string, number>();
const botActivity = new Map<string, number>();
const lastSpeaker = new Map<string, { userId: string; timestamp: number }>();
const responseCount = new Map<string, number>();

let globalLastActivity = Date.now();

export const MAX_FOLLOWUPS = 3;
export const FOLLOWUP_WINDOW = 60_000;
const PRUNE_INTERVAL = 5 * 60_000;
const PRUNE_CUTOFF = 3_600_000;

let paused = false;

export function isPaused(): boolean {
	return paused;
}

export function setPaused(v: boolean): void {
	paused = v;
	stateBus.emit("state:changed");
}

export function isOnCooldown(roomId: string): boolean {
	const last = roomCooldowns.get(roomId);
	if (!last) return false;
	return Date.now() - last < config.cooldownSeconds * 1000;
}

export function markReplied(roomId: string): void {
	const now = Date.now();
	roomCooldowns.set(roomId, now);
	botActivity.set(roomId, now);
	globalLastActivity = now;
	const count = responseCount.get(roomId) ?? 0;
	responseCount.set(roomId, count + 1);
	setTimeout(() => {
		const c = responseCount.get(roomId) ?? 1;
		responseCount.set(roomId, Math.max(0, c - 1));
	}, FOLLOWUP_WINDOW);
	stateBus.emit("state:changed");
}

export function markBotActivity(roomId: string): void {
	botActivity.set(roomId, Date.now());
	globalLastActivity = Date.now();
	stateBus.emit("state:changed");
}

export function isRecentBotActivity(roomId: string, windowMs = 15000): boolean {
	const last = botActivity.get(roomId);
	if (!last) return false;
	return Date.now() - last < windowMs;
}

export function getGlobalInactivityMs(): number {
	return Date.now() - globalLastActivity;
}

export function trackSpeaker(
	roomId: string,
	authorId: string,
): string | undefined {
	const previous = lastSpeaker.get(roomId);
	lastSpeaker.set(roomId, { userId: authorId, timestamp: Date.now() });
	stateBus.emit("state:changed");
	return previous?.userId;
}

export function canFollowUp(roomId: string, botId: string): boolean {
	const recent = isRecentBotActivity(roomId);
	const speaker = lastSpeaker.get(roomId);
	const count = responseCount.get(roomId) ?? 0;
	const ok = recent && speaker?.userId === botId && count < MAX_FOLLOWUPS;
	if (ok)
		console.log(
			`[state] canFollowUp=true (room=${roomId.slice(0, 8)} followCount=${count})`,
		);
	return ok;
}

export function isInConversation(roomId: string, botId: string): boolean {
	return (
		isRecentBotActivity(roomId) && lastSpeaker.get(roomId)?.userId === botId
	);
}

export function clearCooldown(roomId: string): void {
	roomCooldowns.delete(roomId);
	botActivity.delete(roomId);
	responseCount.delete(roomId);
	lastSpeaker.delete(roomId);
	stateBus.emit("state:changed");
}

export function dumpState() {
	return {
		roomCooldowns: [...roomCooldowns.entries()],
		botActivity: [...botActivity.entries()],
		lastSpeaker: [...lastSpeaker.entries()],
		responseCount: [...responseCount.entries()],
		paused,
	};
}

export function restoreState(data: ReturnType<typeof dumpState>): void {
	for (const [k, v] of data.roomCooldowns) roomCooldowns.set(k, v);
	for (const [k, v] of data.botActivity) botActivity.set(k, v);
	for (const [k, v] of data.lastSpeaker) lastSpeaker.set(k, v);
	for (const [k, v] of data.responseCount) responseCount.set(k, v);
	paused = data.paused;
}

export function startPruning(): void {
	setInterval(() => {
		const now = Date.now();
		const cutoff = now - PRUNE_CUTOFF;
		for (const [key, ts] of roomCooldowns) {
			if (ts < cutoff) roomCooldowns.delete(key);
		}
		for (const [key, ts] of botActivity) {
			if (ts < cutoff) botActivity.delete(key);
		}
		for (const [key, entry] of lastSpeaker) {
			if (entry.timestamp < cutoff) lastSpeaker.delete(key);
		}
		for (const [key, count] of responseCount) {
			if (count <= 0) responseCount.delete(key);
		}
	}, PRUNE_INTERVAL);
}
