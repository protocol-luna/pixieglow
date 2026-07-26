import {
	BOT_SERVER,
	EMERALD_HOST,
	EMERALD_PORT,
	MATRIX_USERNAME,
} from "../config.js";
import {
	EmeraldClient,
	type OutCommand,
	type RespondCommand,
	type SetPresenceCommand,
} from "../core/emerald-client.js";
import { MatrixClient } from "../matrix/client.js";

const botId = `@${MATRIX_USERNAME}:${BOT_SERVER}`;
const client = new MatrixClient();
const emerald = new EmeraldClient("pixieglow", {
	host: EMERALD_HOST,
	port: EMERALD_PORT,
});

const typingTimers = new Map<string, ReturnType<typeof setInterval>>();

function clearTypingTimer(roomId: string) {
	const t = typingTimers.get(roomId);
	if (t) clearInterval(t);
	typingTimers.delete(roomId);
}

function startTyping(roomId: string) {
	clearTypingTimer(roomId);
	client.setTyping(roomId, 15000);
	typingTimers.set(
		roomId,
		setInterval(() => {
			client.setTyping(roomId, 15000);
		}, 12000),
	);
}

function _stripMention(text: string): string {
	const localpart = botId.split(":")[0];
	const name = localpart.replace("@", "");
	return text
		.replace(new RegExp(`<${botId}>`, "g"), "")
		.replace(new RegExp(localpart.replace("@", "\\@"), "g"), "")
		.replace(new RegExp(name, "gi"), "")
		.trim();
}

async function executeRespond(cmd: RespondCommand): Promise<void> {
	const {
		channel: roomId,
		delay,
		replyTo,
		replyStyle,
		responseText,
		hesitationWord,
		burstPlan,
		react,
	} = cmd;

	await new Promise((r) => setTimeout(r, delay));

	if (react) {
		setTimeout(async () => {
			await client
				.sendReaction(roomId, replyTo ?? "", react.emoji)
				.catch(() => {});
		}, react.delay);
	}

	startTyping(roomId);

	const text = responseText;
	if (!text) return;

	const parts = burstPlan ? splitBurst(text, burstPlan.fragmentCount) : [text];

	let currentHesitation = hesitationWord ?? "";
	let _firstMsgId: string | null = null;
	let accDelay = 0;

	for (let i = 0; i < parts.length; i++) {
		const frag = parts[i];
		if (!frag) continue;

		let content = frag;
		if (i === 0 && currentHesitation) {
			content = `${currentHesitation} ${frag}`;
			currentHesitation = "";
		}

		if (i === 0) {
			_firstMsgId = await client
				.sendText(
					roomId,
					content,
					replyStyle.messageReference ? replyTo : undefined,
				)
				.catch(() => null);
			emerald.sendEvent({
				type: "bot_message",
				client: "pixieglow",
				channel: roomId,
				text: content,
				timestamp: Date.now(),
			});
		} else {
			accDelay += burstPlan?.fragmentDelays[i - 1] ?? 2000;
			setTimeout(async () => {
				const sent = await client.sendText(roomId, content).catch(() => null);
				if (sent) {
					emerald.sendEvent({
						type: "bot_message",
						client: "pixieglow",
						channel: roomId,
						text: content,
						timestamp: Date.now(),
					});
				}
			}, accDelay);
		}
	}

	clearTypingTimer(roomId);
}

function splitBurst(text: string, nFrags: number): string[] {
	const words = text.split(/\s+/);
	if (words.length < 4) return [text];

	if (nFrags === 2) {
		const splitAt = Math.floor(words.length * (0.3 + Math.random() * 0.25));
		return [words.slice(0, splitAt).join(" "), words.slice(splitAt).join(" ")];
	}
	const split1 = Math.floor(words.length * (0.2 + Math.random() * 0.15));
	const split2 = Math.floor(words.length * (0.55 + Math.random() * 0.15));
	return [
		words.slice(0, split1).join(" "),
		words.slice(split1, split2).join(" "),
		words.slice(split2).join(" "),
	];
}

function handleSetPresence(cmd: SetPresenceCommand) {
	const map: Record<string, "online" | "offline" | "unavailable"> = {
		online: "online",
		idle: "unavailable",
		dnd: "online",
		invisible: "offline",
	};
	void client.updatePresence(map[cmd.status] ?? "online");
}

function handleCommand(command: OutCommand) {
	switch (command.type) {
		case "respond":
			void executeRespond(command);
			break;
		case "typing":
			startTyping(command.channel);
			setTimeout(() => clearTypingTimer(command.channel), command.duration);
			break;
		case "set_presence":
			handleSetPresence(command);
			break;
		case "spontaneous":
			void handleSpontaneous(command.channel, command.sessionId);
			break;
	}
}

async function handleSpontaneous(_roomId: string, _sessionId: string) {
	console.log("[bot] spontaneous not yet wired through Emerald");
}

function getRoomDisplayName(roomId: string): string {
	const room = client.joinedRooms.get(roomId);
	return room?.name ?? roomId.slice(0, 8);
}

emerald.onCommand(handleCommand);

// --- Matrix event handling ---

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

	if (msgtype !== "m.text" && msgtype !== "m.notice" && msgtype !== "m.emote")
		return;

	clearTypingTimer(roomId);

	const _roomName = getRoomDisplayName(roomId);
	const isDM = client.joinedRooms.get(roomId)?.members.length === 2;

	emerald.sendEvent({
		type: "message",
		id: event.event_id,
		client: "pixieglow",
		channel: roomId,
		user: event.sender,
		username: client.getDisplayName(event.sender),
		text: body,
		timestamp: Date.now(),
		isDM,
	});
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

async function runSyncLoop(initialSince?: string): Promise<void> {
	let since = initialSince;
	console.log("[sync] starting sync loop...");

	while (true) {
		try {
			const sync = await client.sync(since);
			since = sync.next_batch;

			if (sync.rooms?.join) {
				for (const [roomId, room] of Object.entries(sync.rooms.join)) {
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
						await processTimeline(roomId, room.timeline);
					}
				}
			}

			if (sync.rooms?.invite) {
				for (const roomId of Object.keys(sync.rooms.invite)) {
					if (!client.joinedRooms.has(roomId)) {
						console.log(
							`[sync] auto-joining invited room ${roomId.slice(0, 8)}`,
						);
						await client.joinRoom(roomId).catch((err) => {
							console.error(
								`[sync] failed to join ${roomId.slice(0, 8)}:`,
								err,
							);
						});
						const members = await client.getRoomMembers(roomId).catch(() => []);
						client.joinedRooms.set(roomId, {
							room_id: roomId,
							name: roomId.slice(0, 8),
							members: members.map((m) => m.user_id),
							membersMap: new Map(members.map((m) => [m.user_id, m])),
						});
					}
				}
			}
		} catch (err) {
			console.error("[sync] error:", err);
			await new Promise((r) => setTimeout(r, 5000));
		}
	}
}

// --- Init ---

export async function startBot(): Promise<void> {
	const whoami = await client.whoami();
	client.userId = whoami.user_id;
	client.deviceId = whoami.device_id;
	console.log(`Connected as ${client.userId}`);

	const initialSync = await client.sync(undefined, 10000);

	const joinRoomAndTrack = async (roomId: string) => {
		const members = await client.getRoomMembers(roomId);
		client.joinedRooms.set(roomId, {
			room_id: roomId,
			name: roomId.slice(0, 8),
			members: members.map((m) => m.user_id),
			membersMap: new Map(members.map((m) => [m.user_id, m])),
		});
	};

	if (initialSync.rooms?.join) {
		for (const roomId of Object.keys(initialSync.rooms.join)) {
			await joinRoomAndTrack(roomId);
		}
	}

	if (initialSync.rooms?.invite) {
		for (const roomId of Object.keys(initialSync.rooms.invite)) {
			console.log(`[bot] auto-joining invited room ${roomId.slice(0, 8)}`);
			await client
				.joinRoom(roomId)
				.catch((err) =>
					console.error(`[bot] failed to join ${roomId.slice(0, 8)}:`, err),
				);
			await joinRoomAndTrack(roomId);
		}
	}

	console.log(`[bot] joined ${client.joinedRooms.size} rooms`);

	await client.updatePresence("online");

	emerald.setUserId(botId, MATRIX_USERNAME);
	emerald.connect();

	void runSyncLoop(initialSync.next_batch);

	console.log("[bot] pixieglow is ready!");
}
