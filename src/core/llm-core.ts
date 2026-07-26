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

const MIN_WORD_DELAY = 20;
const MAX_WORD_DELAY = 80;

let isProcessingWords = false;
const wordEmitQueue: Array<() => void> = [];
let wordQueueSize = 0;
let pendingDoneText: string | null = null;

let currentDoneHandler: ((text: string) => void) | null = null;

const SAPPHIRE_BASE = `http://${SAPPHIRE_HOST}:${SAPPHIRE_PORT}`;

function processWordEmitQueue(): void {
	if (isProcessingWords || wordEmitQueue.length === 0) return;
	isProcessingWords = true;
	wordEmitQueue.shift()?.();
}

function signalDone(text: string): void {
	if (wordQueueSize === 0) llmBus.emit("done", text);
	else pendingDoneText = text;
}

function emitWordTokens(chunk: string): void {
	const words = chunk.match(/\S+/g) ?? [];
	if (words.length === 0) return;
	wordQueueSize++;
	wordEmitQueue.push(() => {
		let i = 0;
		const emitNext = () => {
			const word = words[i];
			if (i === 0 && !hasSentFirstToken) {
				hasSentFirstToken = true;
				currentItem?.onFirstToken?.();
			}
			llmBus.emit("token", word);
			i++;
			if (i < words.length) {
				const delay =
					MIN_WORD_DELAY + Math.random() * (MAX_WORD_DELAY - MIN_WORD_DELAY);
				setTimeout(emitNext, delay);
			} else {
				wordQueueSize--;
				llmBus.emit("flush");
				if (wordQueueSize === 0 && pendingDoneText !== null) {
					llmBus.emit("done", pendingDoneText);
					pendingDoneText = null;
				}
				isProcessingWords = false;
				processWordEmitQueue();
			}
		};
		emitNext();
	});
	processWordEmitQueue();
}

async function sapphireRequest(item: QueueItem): Promise<void> {
	const resp = await fetch(`${SAPPHIRE_BASE}/v1/respond`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			username: item.userMessage.username,
			text: item.userMessage.text,
			session_id: item.userMessage.sessionId ?? "default",
		}),
	});
	if (!resp.ok) {
		const errText = await resp.text().catch(() => "");
		throw new Error(`sapphire error ${resp.status}: ${errText.slice(0, 200)}`);
	}
	const data = (await resp.json()) as { text: string };
	const text = data.text;
	emitWordTokens(text);
	currentItem?.onChunk?.(text);
	signalDone(text);
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
	wordEmitQueue.length = 0;
	isProcessingWords = false;
	wordQueueSize = 0;
	pendingDoneText = null;

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

	void sapphireRequest(item).catch((err) => {
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
