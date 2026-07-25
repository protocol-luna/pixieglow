import * as fs from "node:fs/promises";
import * as path from "node:path";
import { dumpState } from "./state.js";
import { stateBus } from "./state-bus.js";

const STATE_FILE = path.resolve("state.json");

export interface PersistedState {
	paused: boolean;
	roomCooldowns: [string, number][];
	botActivity: [string, number][];
	lastSpeaker: [string, { userId: string; timestamp: number }][];
	responseCount: [string, number][];
}

function defaultState(): PersistedState {
	return {
		paused: false,
		roomCooldowns: [],
		botActivity: [],
		lastSpeaker: [],
		responseCount: [],
	};
}

export async function loadState(): Promise<PersistedState> {
	try {
		const raw = await fs.readFile(STATE_FILE, "utf-8");
		const parsed = JSON.parse(raw) as PersistedState;
		if (typeof parsed.paused !== "boolean") throw new Error("invalid paused");
		console.log(`[persist] loaded state: paused=${parsed.paused}`);
		return parsed;
	} catch {
		return defaultState();
	}
}

export async function persistState(state: PersistedState): Promise<void> {
	await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
	console.log(`[persist] saved state: paused=${state.paused}`);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingState: PersistedState | null = null;
let pendingDumpTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSave(state: PersistedState): void {
	pendingState = state;
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		if (pendingState)
			persistState(pendingState).catch((err) =>
				console.error("[persist] async write failed:", err),
			);
		saveTimer = null;
	}, 500);
}

stateBus.on("state:changed", () => {
	if (pendingDumpTimer) return;
	pendingDumpTimer = setTimeout(() => {
		pendingDumpTimer = null;
		const raw = dumpState();
		scheduleSave({
			paused: raw.paused,
			roomCooldowns: raw.roomCooldowns,
			botActivity: raw.botActivity,
			lastSpeaker: raw.lastSpeaker,
			responseCount: raw.responseCount,
		});
	}, 100);
});
