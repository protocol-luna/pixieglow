import { MATRIX_HOMESERVER, MATRIX_TOKEN } from "../config.js";

export interface MatrixEvent {
	event_id: string;
	type: string;
	sender: string;
	content: Record<string, unknown>;
	origin_server_ts: number;
	unsigned?: Record<string, unknown>;
}

export interface RoomEvent extends MatrixEvent {
	room_id: string;
}

export interface Timeline {
	events: RoomEvent[];
	prev_batch: string;
	limited?: boolean;
}

export interface RoomData {
	timeline?: Timeline;
	state?: { events: MatrixEvent[] };
	account_data?: { events: MatrixEvent[] };
}

export interface RoomsData {
	join?: Record<string, RoomData>;
	invite?: Record<string, { invite_state: { events: MatrixEvent[] } }>;
	leave?: Record<string, RoomData>;
}

export interface SyncResponse {
	next_batch: string;
	rooms?: RoomsData;
	account_data?: { events: MatrixEvent[] };
	presence?: { events: MatrixEvent[] };
	device_one_time_keys_count?: Record<string, number>;
	device_lists?: { changed: string[]; left: string[] };
	to_device?: { events: MatrixEvent[] };
}

export interface MatrixMember {
	user_id: string;
	displayname?: string;
	avatar_url?: string;
}

export interface JoinedRoom {
	room_id: string;
	name: string;
	members: string[];
	membersMap: Map<string, MatrixMember>;
}

// --- Event types ---
export const MSG_TEXT = "m.text";
export const MSG_NOTICE = "m.notice";
export const MSG_EMOTE = "m.emote";
export const MSG_IMAGE = "m.image";
export const MSG_FILE = "m.file";
export const MSG_AUDIO = "m.audio";
export const MSG_VIDEO = "m.video";
export const REACTION = "m.reaction";
export const MEMBER = "m.room.member";
export const TYPING = "m.typing";
export const READ_RECEIPT = "m.receipt";
export const ROLE = "m.room.power_levels";
export const NAME = "m.room.name";
export const TOPIC = "m.room.topic";

const BASE = MATRIX_HOMESERVER.replace(/\/$/, "");
const headers = {
	"Content-Type": "application/json",
	Authorization: `Bearer ${MATRIX_TOKEN}`,
};

export class MatrixClient {
	userId: string = "";
	deviceId: string = "";
	joinedRooms: Map<string, JoinedRoom> = new Map();
	ownMembership: Map<string, MatrixMember> = new Map();
	txnCounter = 0;

	async whoami(): Promise<{ user_id: string; device_id: string }> {
		const res = await fetch(`${BASE}/_matrix/client/v3/account/whoami`, {
			headers,
		});
		if (!res.ok) throw new Error(`whoami: ${res.status}`);
		return (await res.json()) as { user_id: string; device_id: string };
	}

	async sync(since?: string, timeout = 30000): Promise<SyncResponse> {
		const params = new URLSearchParams({ timeout: String(timeout) });
		if (since) params.set("since", since);
		const res = await fetch(`${BASE}/_matrix/client/v3/sync?${params}`, {
			headers,
		});
		if (!res.ok) {
			const txt = await res.text().catch(() => "");
			throw new Error(`sync ${res.status}: ${txt.slice(0, 200)}`);
		}
		return (await res.json()) as SyncResponse;
	}

	async sendMessage(
		roomId: string,
		content: Record<string, unknown>,
	): Promise<string> {
		this.txnCounter++;
		const txnId = `pixie_${Date.now()}_${this.txnCounter}`;
		const res = await fetch(
			`${BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
			{
				method: "PUT",
				headers,
				body: JSON.stringify(content),
			},
		);
		if (!res.ok) {
			const txt = await res.text().catch(() => "");
			throw new Error(`sendMessage ${res.status}: ${txt.slice(0, 200)}`);
		}
		const data = (await res.json()) as { event_id: string };
		return data.event_id;
	}

	async sendText(
		roomId: string,
		text: string,
		replyTo?: string,
	): Promise<string> {
		const content: Record<string, unknown> = {
			msgtype: "m.text",
			body: text,
		};
		if (replyTo) {
			content["m.relates_to"] = { "m.in_reply_to": { event_id: replyTo } };
		}
		return this.sendMessage(roomId, content);
	}

	async sendEmote(
		roomId: string,
		text: string,
		replyTo?: string,
	): Promise<string> {
		const content: Record<string, unknown> = {
			msgtype: "m.emote",
			body: text,
		};
		if (replyTo) {
			content["m.relates_to"] = { "m.in_reply_to": { event_id: replyTo } };
		}
		return this.sendMessage(roomId, content);
	}

	async sendReaction(
		roomId: string,
		eventId: string,
		emoji: string,
	): Promise<void> {
		this.txnCounter++;
		const txnId = `pixie_${Date.now()}_${this.txnCounter}`;
		await fetch(
			`${BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.reaction/${txnId}`,
			{
				method: "PUT",
				headers,
				body: JSON.stringify({
					"m.relates_to": {
						event_id: eventId,
						key: emoji,
						rel_type: "m.annotation",
					},
				}),
			},
		).catch(() => {});
	}

	async editMessage(
		roomId: string,
		eventId: string,
		newBody: string,
	): Promise<void> {
		this.txnCounter++;
		const txnId = `pixie_${Date.now()}_${this.txnCounter}`;
		await fetch(
			`${BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
			{
				method: "PUT",
				headers,
				body: JSON.stringify({
					body: ` * ${newBody}`,
					msgtype: "m.text",
					"m.new_content": {
						body: newBody,
						msgtype: "m.text",
					},
					"m.relates_to": {
						rel_type: "m.replace",
						event_id: eventId,
					},
				}),
			},
		).catch(() => {});
	}

	async setTyping(roomId: string, timeout = 15000): Promise<void> {
		await fetch(
			`${BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(this.userId)}`,
			{
				method: "PUT",
				headers,
				body: JSON.stringify({ typing: true, timeout }),
			},
		).catch(() => {});
	}

	async stopTyping(roomId: string): Promise<void> {
		await fetch(
			`${BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(this.userId)}`,
			{
				method: "PUT",
				headers,
				body: JSON.stringify({ typing: false }),
			},
		).catch(() => {});
	}

	async markRead(roomId: string, eventId: string): Promise<void> {
		await fetch(
			`${BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/read_markers`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({
					"m.fully_read": eventId,
					"m.read": eventId,
				}),
			},
		).catch(() => {});
	}

	async getRoomMembers(roomId: string): Promise<MatrixMember[]> {
		const res = await fetch(
			`${BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/members`,
			{ headers },
		);
		if (!res.ok) return [];
		const data = (await res.json()) as { chunk: MatrixEvent[] };
		const members: MatrixMember[] = [];
		for (const ev of data.chunk) {
			if (ev.type === MEMBER && ev.content.membership === "join") {
				members.push({
					user_id: ev.sender,
					displayname: (ev.content.displayname as string) ?? ev.sender,
					avatar_url: ev.content.avatar_url as string | undefined,
				});
			}
		}
		return members;
	}

	async joinRoom(roomIdOrAlias: string): Promise<void> {
		await fetch(
			`${BASE}/_matrix/client/v3/join/${encodeURIComponent(roomIdOrAlias)}`,
			{
				method: "POST",
				headers,
			},
		).catch(() => {});
	}

	async leaveRoom(roomId: string): Promise<void> {
		await fetch(
			`${BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/leave`,
			{
				method: "POST",
				headers,
			},
		).catch(() => {});
	}

	async uploadMedia(
		data: Buffer | Uint8Array,
		mimeType: string,
		filename?: string,
	): Promise<string> {
		const body = new Blob([data as unknown as BlobPart]);
		const res = await fetch(`${BASE}/_matrix/media/v3/upload`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${MATRIX_TOKEN}`,
				"Content-Type": mimeType,
				...(filename
					? { "Content-Disposition": `attachment; filename="${filename}"` }
					: {}),
			},
			body,
		});
		if (!res.ok) {
			const txt = await res.text().catch(() => "");
			throw new Error(`uploadMedia ${res.status}: ${txt.slice(0, 200)}`);
		}
		const data2 = (await res.json()) as { content_uri: string };
		return data2.content_uri;
	}

	async updatePresence(
		presence: "online" | "offline" | "unavailable",
	): Promise<void> {
		await fetch(
			`${BASE}/_matrix/client/v3/presence/${encodeURIComponent(this.userId)}/status`,
			{
				method: "PUT",
				headers,
				body: JSON.stringify({ presence }),
			},
		).catch(() => {});
	}

	getDisplayName(userId: string): string {
		for (const room of this.joinedRooms.values()) {
			const m = room.membersMap.get(userId);
			if (m?.displayname) return m.displayname;
		}
		return userId;
	}
}
