export interface FewShotExample { user: string; assistant: string; }

export function formatFewShotExamples(
  examples: FewShotExample[],
  username = "user"
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const example of examples) {
    messages.push({ role: "user", content: `${username}: ${example.user}` });
    messages.push({ role: "assistant", content: example.assistant });
  }
  return messages;
}

export function injectFewShotIntoConversation(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  fewShotMessages: Array<{ role: "user" | "assistant"; content: string }>
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  if (messages.length === 0) return [...fewShotMessages] as Array<{ role: "system" | "user" | "assistant"; content: string }>;
  const systemMessage = messages[0];
  const userMessages = messages.slice(1);
  return [systemMessage, ...fewShotMessages, ...userMessages] as Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

export function limitMessageHistory(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  maxMessages: number
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  if (messages.length <= maxMessages) return messages;
  const systemMessage = messages[0];
  const recentMessages = messages.slice(-(maxMessages - 1));
  return [systemMessage, ...recentMessages];
}
