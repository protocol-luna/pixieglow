import {
	computeDelay,
	pickReaction,
	shouldIgnore,
	shouldReact,
} from "../behavior/mannerisms.js";
import { getSleepBehavior, type SleepBehavior } from "../behavior/sleep.js";
import { applyTypo, type TypoResult } from "../behavior/typo.js";
import {
	BOT_SERVER,
	config,
	MATRIX_USERNAME,
	pickReplyStyle,
	watchConfig,
} from "../config.js";
import { llmBus } from "../core/llm-bus.js";
import { askLLM, resetLLM } from "../core/llm-core.js";
import { MatrixClient } from "../matrix/client.js";
import { trySpawn } from "../spontaneous.js";
import { loadState } from "../state/persistence.js";
import {
	canFollowUp,
	clearCooldown,
	getGlobalInactivityMs,
	isRecentBotActivity,
	markBotActivity,
	markReplied,
	restoreState,
	setPaused,
	startPruning,
	trackSpeaker,
} from "../state/state.js";
import {
	getFatigueIgnoreBonus,
	getFatigueMultiplier,
	pruneTopicFatigue,
	recordMessage,
} from "../state/topic-fatigue.js";
import { evaluateMessage, type TriggerResult } from "../state/trigger.js";

const botId = `@${MATRIX_USERNAME}:${BOT_SERVER}`;

const client = new MatrixClient();

const sessionCounts = new Map<string, number>();
const sessionPaused = new Set<string>();
const sessionLastMessage = new Map<string, number>();
const typingTimers = new Map<string, ReturnType<typeof setInterval>>();

function clearTypingTimer(roomId: string): void {
	const existing = typingTimers.get(roomId);
	if (existing) {
		clearInterval(existing);
		typingTimers.delete(roomId);
	}
}

function drainSessionQueue(
	roomId: string,
	queued: { body: string; sender: string; reason: string; eventId: string }[],
): void {
	if (queued.length === 0) return;
	const next = queued.shift() as { body: string; sender: string; reason: string; eventId: string };
	console.log(
		`[bot] session queue: resuming queued message in ${roomId.slice(0, 8)}`,
	);
	void triggerLunaReply(
		next.body,
		next.sender,
		roomId,
		next.eventId,
		false,
		next.reason,
	).then(() => {
		if (!sessionPaused.has(roomId)) drainSessionQueue(roomId, queued);
	});
}

const roomPending = new Map<
	string,
	{ body: string; sender: string; reason: string; eventId: string }[]
>();
function queuePending(
	roomId: string,
	body: string,
	sender: string,
	reason: string,
	eventId: string,
): void {
	const q = roomPending.get(roomId) ?? [];
	q.push({ body, sender, reason, eventId });
	roomPending.set(roomId, q);
}

function drainPendingForRoom(
	roomId: string,
): { body: string; sender: string; reason: string; eventId: string } | null {
	const q = roomPending.get(roomId);
	if (q && q.length > 0) {
		const next = q.shift() as { body: string; sender: string; reason: string; eventId: string };
		if (q.length === 0) roomPending.delete(roomId);
		return next;
	}
	roomPending.delete(roomId);
	return null;
}

const isProcessing = new Set<string>();

function processingKey(roomId: string, sender: string): string {
	return `${roomId}:${sender}`;
}

// --- Session limit ---
function checkSessionLimit(
	roomId: string,
	callback: (roomId: string) => void,
): void {
	const count = (sessionCounts.get(roomId) ?? 0) + 1;
	sessionCounts.set(roomId, count);
	if (count >= config.sessionMessageLimit) {
		sessionPaused.add(roomId);
		console.log(
			`[bot] session limit (${count}), pause ${config.sessionPauseSeconds}s`,
		);
		setTimeout(() => {
			sessionPaused.delete(roomId);
			sessionCounts.delete(roomId);
			callback(roomId);
			console.log("[bot] session resumed, context cleared");
			void drainSessionQueue(roomId, roomPending.get(roomId) ?? []);
		}, config.sessionPauseSeconds * 1000);
	}
}

function stripMention(text: string): string {
	return text
		.replace(new RegExp(`<${botId}>`, "g"), "")
		.replace(new RegExp(botId.split(":")[0].replace("@", ""), "gi"), "")
		.trim();
}

async function triggerLunaReply(
	body: string,
	sender: string,
	roomId: string,
	eventId: string,
	isDM: boolean,
	reason: string | null,
): Promise<void> {
	const key = processingKey(roomId, sender);
	if (isProcessing.has(key)) {
		queuePending(roomId, body, sender, reason ?? "mention", eventId);
		return;
	}
	isProcessing.add(key);

	const startTyping = () => {
		clearTypingTimer(roomId);
		client.setTyping(roomId, 15000);
		typingTimers.set(
			roomId,
			setInterval(() => {
				client.setTyping(roomId, 15000);
			}, 12000),
		);
	};

	const style = pickReplyStyle(isRecentBotActivity(roomId));
	const refStyle = isDM
		? { messageReference: false, mentionRepliedUser: false }
		: style;

	let onToken: ((word: string) => void) | null = null;
	let hesitationWord = "";

	try {
		const content = stripMention(body);
		const displayName = client.getDisplayName(sender);
		const chunks: string[] = [];
		let messageBuffer = "";
		let _isFirstChunk = true;

		const willBurst = Math.random() < config.burstChance;

		function stripLlmPrefix(text: string): string {
			return text.replace(/^[^:]+:\s*/, "");
		}

		async function sendFragments(
			parts: string[],
			replyTo: string | undefined,
		): Promise<string | null> {
			let accDelay = 0;
			let firstPromise: Promise<string | null> | null = null;
			for (let i = 0; i < parts.length; i++) {
				const frag = stripLlmPrefix(parts[i]);
				if (!frag) continue;
				if (i === 0) {
					const finalContent = hesitationWord
						? `${hesitationWord} ${frag}`
						: frag;
					hesitationWord = "";
					firstPromise = client
						.sendText(roomId, finalContent, replyTo)
						.then((id) => {
							_isFirstChunk = false;
							markBotActivity(roomId);
							return id;
						})
						.catch(() => null);
				} else {
					const delay =
						config.burstDelayMin +
						Math.random() * (config.burstDelayMax - config.burstDelayMin);
					accDelay += delay;
					const fragContent = hesitationWord
						? `${hesitationWord} ${frag}`
						: frag;
					hesitationWord = "";
					setTimeout(() => {
						client
							.sendText(roomId, fragContent)
							.then(() => markBotActivity(roomId))
							.catch(() => {});
					}, accDelay);
				}
			}
			return firstPromise ?? Promise.resolve(null);
		}

		function splitBurst(text: string): string[] {
			if (!willBurst) return [text];
			const words = text.split(/\s+/);
			if (words.length < 4) return [text];
			const nFrags = Math.random() < 0.6 ? 2 : 3;
			if (nFrags === 2) {
				const splitAt = Math.floor(words.length * (0.3 + Math.random() * 0.25));
				return [
					words.slice(0, splitAt).join(" "),
					words.slice(splitAt).join(" "),
				];
			}
			const split1 = Math.floor(words.length * (0.2 + Math.random() * 0.15));
			const split2 = Math.floor(words.length * (0.55 + Math.random() * 0.15));
			return [
				words.slice(0, split1).join(" "),
				words.slice(split1, split2).join(" "),
				words.slice(split2).join(" "),
			];
		}

		onToken = (word: string) => {
			chunks.push(word);
			if (messageBuffer) messageBuffer += " ";
			messageBuffer += word;
		};
		llmBus.on("token", onToken);

		const hasHesitation = Math.random() < config.hesitationChance;
		if (hasHesitation)
			hesitationWord =
				config.hesitationWords[
					Math.floor(Math.random() * config.hesitationWords.length)
				];

		startTyping();

		const fullText = await askLLM({
			username: displayName,
			text: content,
			sessionId: roomId,
		});

		const text = stripLlmPrefix(fullText);
		let textToSend = text;
		let typoResult: TypoResult | null = null;

		if (chunks.length > 0 && Math.random() < config.typoChance) {
			const idx = Math.floor(Math.random() * chunks.length);
			const result = applyTypo(chunks[idx], config.typoLayout);
			if (result && text.includes(result.originalWord)) {
				typoResult = result;
				textToSend = text.replace(result.originalWord, result.correctedWord);
				console.log(
					`[bot] typo: "${result.originalWord}" → "${result.correctedWord}"`,
				);
			}
		}

		const willEdit =
			typoResult &&
			(config.typoCorrectionStyle === "edit" ||
				(config.typoCorrectionStyle === "mixed" && Math.random() < 0.5));

		let firstMessageId: string | null = null;
		const parts = splitBurst(textToSend);
		firstMessageId = await sendFragments(
			parts,
			refStyle.messageReference ? eventId : undefined,
		);

		if (typoResult && firstMessageId) {
			const delay =
				config.typoCorrectionDelay +
				Math.random() *
					(config.typoCorrectionDelayMax - config.typoCorrectionDelay);
			await new Promise((r) => setTimeout(r, delay));
			if (willEdit) {
				// Matrix doesn't support editing via client API easily, so just send correction
				await client.sendText(roomId, text).catch(() => {});
				console.log(
					`[bot] typo corrected (sent clean): "${typoResult.correctedWord}" → "${typoResult.originalWord}"`,
				);
			} else {
				await client
					.sendText(roomId, `${typoResult.originalWord}*`)
					.catch(() => {});
				console.log(`[bot] typo corrected: "${typoResult.originalWord}*"`);
			}
		}

		trackSpeaker(roomId, botId);
		markReplied(roomId);
	} catch (err) {
		console.error(err);
		try {
			await client.sendReaction(roomId, eventId, "❌");
		} catch {
			/* ignore */
		}
	} finally {
		isProcessing.delete(key);
		clearTypingTimer(roomId);
		if (onToken) llmBus.off("token", onToken);

		const queued = drainPendingForRoom(roomId);
		if (queued) {
			console.log(
				`[bot] room ${roomId.slice(0, 8)}: responding to queued message (${queued.reason})`,
			);
			await triggerLunaReply(
				queued.body,
				queued.sender,
				roomId,
				queued.eventId,
				false,
				queued.reason,
			);
		}
	}
}

async function handleCommand(
	_body: string,
	roomId: string,
	result: TriggerResult,
): Promise<boolean> {
	if (result.reason === "stop") {
		await resetLLM(roomId);
		clearCooldown(roomId);
		trackSpeaker(roomId, botId);
		setPaused(true);
		await client.sendReaction(roomId, "", "✅").catch(() => {});
		return true;
	}
	if (result.reason === "start") {
		setPaused(false);
		await client.sendReaction(roomId, "", "✅").catch(() => {});
		return true;
	}
	if (result.reason === "clear") {
		await resetLLM(roomId);
		clearCooldown(roomId);
		trackSpeaker(roomId, botId);
		await client.sendReaction(roomId, "", "✅").catch(() => {});
		return true;
	}
	return false;
}

function handleSleep(
	result: TriggerResult,
	sleepBehavior: SleepBehavior,
	roomName: string,
): boolean {
	if (
		sleepBehavior === "sleep" &&
		result.reason !== "mention" &&
		result.reason !== "dm"
	) {
		console.log(`[bot] ${roomName}: ignored (sleep)`);
		return true;
	}
	return false;
}

function getRoomDisplayName(roomId: string): string {
	const room = client.joinedRooms.get(roomId);
	return room?.name ?? roomId.slice(0, 8);
}

async function handleRoomEvent(
	roomId: string,
	event: {
		event_id: string;
		type: string;
		sender: string;
		content: Record<string, unknown>;
	},
): Promise<void> {
	if (event.type !== "m.room.message") return;
	if (event.sender === botId) return;

	const body = (event.content.body as string) ?? "";
	const msgtype = (event.content.msgtype as string) ?? "m.text";

	// Only handle text messages
	if (msgtype !== "m.text" && msgtype !== "m.notice" && msgtype !== "m.emote")
		return;

	clearTypingTimer(roomId);

	const roomName = getRoomDisplayName(roomId);
	const isDM = client.joinedRooms.get(roomId)?.members.length === 2;

	recordMessage(roomId, body);

	const result: TriggerResult = evaluateMessage(
		body,
		event.sender,
		roomId,
		roomName,
		botId,
		MATRIX_USERNAME,
		isDM,
	);

	if (await handleCommand(body, roomId, result)) return;

	const sleepBehavior = getSleepBehavior();
	if (handleSleep(result, sleepBehavior, roomName)) return;

	if (sessionPaused.has(roomId)) {
		queuePending(
			roomId,
			body,
			event.sender,
			result.reason ?? "mention",
			event.event_id,
		);
		console.log(`[bot] ${roomName}: queued (session pause)`);
		return;
	}

	const lastMsg = sessionLastMessage.get(roomId);
	if (lastMsg && Date.now() - lastMsg > config.sessionResetMinutes * 60000)
		sessionCounts.delete(roomId);
	sessionLastMessage.set(roomId, Date.now());

	if (result.shouldRespond) {
		trackSpeaker(roomId, event.sender);
		const fatigueIgnoreBonus = getFatigueIgnoreBonus(roomId);
		if (
			!isDM &&
			(shouldIgnore(result.reason, sleepBehavior) ||
				Math.random() < fatigueIgnoreBonus)
		) {
			console.log(
				`[bot] ${roomName}: ignored (${result.reason})${fatigueIgnoreBonus > 0 ? ` fatigue=${fatigueIgnoreBonus.toFixed(2)}` : ""}`,
			);
			return;
		}
		if (!isDM && Math.random() < config.forgetChance) {
			console.log(`[bot] ${roomName}: forgot (${result.reason})`);
			return;
		}

		const delay = computeDelay(
			result.reason,
			sleepBehavior,
			body.length,
			getGlobalInactivityMs(),
		);

		setTimeout(async () => {
			if (shouldReact(result.reason, sleepBehavior)) {
				const reaction = pickReaction();
				await client
					.sendReaction(roomId, event.event_id, reaction)
					.catch(() => {});
			}
		}, delay);

		const fatigueMul = getFatigueMultiplier(roomId);
		const totalDelay = delay * fatigueMul;
		await new Promise((r) => setTimeout(r, totalDelay));
		await triggerLunaReply(
			body,
			event.sender,
			roomId,
			event.event_id,
			isDM,
			result.reason,
		);
		checkSessionLimit(roomId, (sid: string) => {
			void resetLLM(sid);
		});
		return;
	}

	if (canFollowUp(roomId, botId) && sleepBehavior !== "sleep") {
		trackSpeaker(roomId, event.sender);
		markReplied(roomId);
		console.log(`[bot] ${roomName}: follow-up immediate`);

		const fatigueMul = getFatigueMultiplier(roomId);
		const delay =
			computeDelay(
				"follow-up",
				sleepBehavior,
				body.length,
				getGlobalInactivityMs(),
			) * fatigueMul;
		await new Promise((r) => setTimeout(r, delay));

		if (shouldReact("follow-up", sleepBehavior)) {
			const reaction = pickReaction();
			await client
				.sendReaction(roomId, event.event_id, reaction)
				.catch(() => {});
		}

		await triggerLunaReply(
			body,
			event.sender,
			roomId,
			event.event_id,
			isDM,
			"follow-up",
		);
		checkSessionLimit(roomId, (sid: string) => {
			void resetLLM(sid);
		});
	}

	trackSpeaker(roomId, event.sender);
}

async function processTimeline(
	roomId: string,
	timeline: {
		events: {
			event_id: string;
			type: string;
			sender: string;
			content: Record<string, unknown>;
		}[];
	},
): Promise<void> {
	for (const event of timeline.events) {
		await handleRoomEvent(roomId, event);
	}
}

async function runSyncLoop(): Promise<void> {
	let since: string | undefined;
	console.log("[sync] starting sync loop...");

	while (true) {
		try {
			const sync = await client.sync(since);
			since = sync.next_batch;

			if (sync.rooms?.join) {
				for (const [roomId, room] of Object.entries(sync.rooms.join)) {
					// Build room info from state events
					if (room.state?.events) {
						for (const ev of room.state.events) {
							if (ev.type === "m.room.name") {
								const r = client.joinedRooms.get(roomId);
								if (r) r.name = (ev.content.name as string) ?? roomId;
							}
							if (
								ev.type === "m.room.member" &&
								ev.content.membership === "join"
							) {
								const r = client.joinedRooms.get(roomId);
								if (r) {
									r.membersMap.set(ev.sender, {
										user_id: ev.sender,
										displayname:
											(ev.content.displayname as string) ?? ev.sender,
										avatar_url: ev.content.avatar_url as string | undefined,
									});
								}
							}
						}
					}

					if (room.timeline?.events) {
						// Only process new events (not the ones from prev_batch on first sync)
						await processTimeline(roomId, room.timeline);
					}
				}
			}
		} catch (err) {
			console.error("[sync] error:", err);
			await new Promise((r) => setTimeout(r, 5000));
		}
	}
}

export async function startBot(): Promise<void> {
	watchConfig();

	// Init connection
	const whoami = await client.whoami();
	client.userId = whoami.user_id;
	client.deviceId = whoami.device_id;
	console.log(`Connected as ${client.userId}`);

	// Get initial sync to discover rooms
	const initialSync = await client.sync(undefined, 10000);
	if (initialSync.rooms?.join) {
		for (const roomId of Object.keys(initialSync.rooms.join)) {
			const members = await client.getRoomMembers(roomId);
			const roomName =
				(initialSync.rooms.join[roomId].state?.events?.find(
					(e) => e.type === "m.room.name",
				)?.content.name as string) ?? roomId;
			client.joinedRooms.set(roomId, {
				room_id: roomId,
				name: roomName,
				members: members.map((m) => m.user_id),
				membersMap: new Map(members.map((m) => [m.user_id, m])),
			});
		}
	}
	console.log(`[bot] joined ${client.joinedRooms.size} rooms`);

	// Load persisted state
	const saved = await loadState();
	restoreState({
		roomCooldowns: saved.roomCooldowns,
		botActivity: saved.botActivity,
		lastSpeaker: saved.lastSpeaker,
		responseCount: saved.responseCount,
		paused: saved.paused,
	});

	startPruning();
	setInterval(pruneTopicFatigue, 300_000);

	// Update presence
	await client.updatePresence("online");

	// Start sync loop for real-time events
	void runSyncLoop();

	// Spontaneous messages
	setInterval(() => {
		if (Math.random() < config.spontaneousChance) {
			void trySpawn(client);
		}
	}, config.spontaneousIntervalMs);

	console.log("[bot] pixieglow is ready!");
}
