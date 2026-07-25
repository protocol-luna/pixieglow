import {
	FEW_SHOT_ENABLED,
	FEW_SHOT_EXAMPLES,
	LLM_API_ENDPOINT,
	LLM_API_TOKEN,
	LLM_MODEL,
	SYSTEM_PROMPT,
} from "../config.js";
import {
	formatFewShotExamples,
	injectFewShotIntoConversation,
} from "./few-shot.js";

interface Message {
	role: "system" | "user" | "assistant";
	content: string;
}

const conversations = new Map<string, Message[]>();

export async function askOnline(
	userMessage: { username: string; text: string; sessionId?: string },
	callbacks: { onFirstToken?: () => void; onChunk: (chunk: string) => void },
): Promise<string> {
	const sid = userMessage.sessionId ?? "default";
	let messages = conversations.get(sid);
	if (!messages) {
		messages = [{ role: "system", content: SYSTEM_PROMPT }];
		conversations.set(sid, messages);
	}
	const userMsg = userMessage.username
		? `${userMessage.username}: ${userMessage.text}`
		: userMessage.text;
	messages.push({ role: "user", content: userMsg });

	let finalMessages = [...messages];
	if (FEW_SHOT_ENABLED && FEW_SHOT_EXAMPLES.length > 0) {
		const fewShotMessages = formatFewShotExamples(FEW_SHOT_EXAMPLES);
		finalMessages = injectFewShotIntoConversation(messages, fewShotMessages);
	}

	const res = await fetch(LLM_API_ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${LLM_API_TOKEN}`,
		},
		body: JSON.stringify({
			model: LLM_MODEL,
			messages: finalMessages,
			stream: false,
		}),
	});

	if (!res.ok) {
		const errText = await res.text().catch(() => "");
		throw new Error(`API error ${res.status}: ${errText.slice(0, 200)}`);
	}

	const data = (await res.json()) as {
		choices: { message: { content: string } }[];
	};
	const response = data.choices?.[0]?.message?.content ?? "";
	messages.push({ role: "assistant", content: response });
	callbacks.onFirstToken?.();
	callbacks.onChunk(response);
	return response;
}

export function clearConversations(sessionId?: string): void {
	if (sessionId) conversations.delete(sessionId);
	else conversations.clear();
}
