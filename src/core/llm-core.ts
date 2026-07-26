import { SAPPHIRE_HOST, SAPPHIRE_PORT } from "../config.js";
import { llmBus } from "./llm-bus.js";

export interface UserMessage {
	username: string;
	text: string;
	sessionId?: string;
}

interface QueueItem {
	userMessage: UserMessage;
	resolve: (value: string) => void;
	reject: (reason: unknown) => void;
	onFirstToken?: () => void;
	onChunk?: (chunk: string) => void;
}

const requestQueue: QueueItem[] = [];
let queueHead = 0;
let isProcessing = false;
let currentItem: QueueItem | null = null;
let hasSentFirstToken = false;

let currentDoneHandler: ((text: string) => void) | null = null;

const SAPPHIRE_BASE = `http://${SAPPHIRE_HOST}:${SAPPHIRE_PORT}`;

async function sapphireStream(item: QueueItem): Promise<string> {
	const resp = await fetch(`${SAPPHIRE_BASE}/v1/respond`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			username: item.userMessage.username,
			text: item.userMessage.text,
			session_id: item.userMessage.sessionId ?? "default",
			stream: true,
		}),
	});
	if (!resp.ok) {
		const errText = await resp.text().catch(() => "");
		throw new Error(`sapphire error ${resp.status}: ${errText.slice(0, 200)}`);
	}

	const reader = resp.body?.getReader();
	if (!reader) throw new Error("no response body");

	const decoder = new TextDecoder();
	let buffer = "";
	let fullText = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("data: ")) continue;
			const payload = trimmed.slice(6);
			if (payload === "[DONE]") return fullText;
			if (payload.startsWith("{")) {
				try {
					const meta = JSON.parse(payload) as { text: string };
					return meta.text;
				} catch {
					// not metadata
				}
			}
			if (!hasSentFirstToken) {
				hasSentFirstToken = true;
				currentItem?.onFirstToken?.();
			}
			fullText += payload;
			llmBus.emit("token", payload);
			currentItem?.onChunk?.(payload);
		}
	}
	return fullText;
}

function processQueue(): void {
	if (isProcessing || queueHead >= requestQueue.length) return;
	isProcessing = true;
	const item = requestQueue[queueHead];
	queueHead++;
	if (queueHead > 100 && queueHead >= requestQueue.length / 2) {
		requestQueue.splice(0, queueHead);
		queueHead = 0;
	}
	currentItem = item;
	hasSentFirstToken = false;

	const finish = (text: string) => {
		currentItem = null;
		isProcessing = false;
		item.resolve(text);
		setTimeout(() => processQueue(), 100);
	};
	const fail = (err: unknown) => {
		currentItem = null;
		isProcessing = false;
		item.reject(err);
		setTimeout(() => processQueue(), 100);
	};

	const doneHandler = (text: string) => {
		llmBus.off("done", doneHandler);
		currentDoneHandler = null;
		finish(text);
	};
	currentDoneHandler = doneHandler;
	llmBus.on("done", doneHandler);

	void sapphireStream(item)
		.then((text) => {
			llmBus.emit("done", text);
		})
		.catch((err) => {
			if (currentDoneHandler) {
				llmBus.off("done", currentDoneHandler);
				currentDoneHandler = null;
			}
			fail(err);
		});
}

export function askLLM(
	userMessage: UserMessage,
	callbacks?: { onFirstToken?: () => void; onChunk?: (chunk: string) => void },
): Promise<string> {
	return new Promise((resolve, reject) => {
		requestQueue.push({
			userMessage,
			resolve,
			reject,
			onFirstToken: callbacks?.onFirstToken,
			onChunk: callbacks?.onChunk,
		});
		void processQueue();
	});
}

export function isLLMBusy(): boolean {
	return isProcessing || queueHead < requestQueue.length;
}

export async function resetLLM(sessionId?: string): Promise<void> {
	requestQueue.length = 0;
	queueHead = 0;
	isProcessing = false;
	currentItem = null;
	if (currentDoneHandler) {
		llmBus.off("done", currentDoneHandler);
		currentDoneHandler = null;
	}
	llmBus.emit("reset");
	try {
		await fetch(`${SAPPHIRE_BASE}/v1/reset`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ session_id: sessionId ?? null }),
		});
	} catch {
		/* best effort */
	}
}
