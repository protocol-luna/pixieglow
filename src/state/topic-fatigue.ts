import { config } from "../config.js";

const roomWordLogs = new Map<string, string[]>();
const roomLastActivity = new Map<string, number>();
const FATIGUE_TTL = 24 * 60 * 60 * 1000;

function extractSignificant(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/);
  return words.filter((w) => /^[a-z]{4,}$/.test(w));
}

export function recordMessage(roomId: string, text: string): void {
  if (!config.topicFatigueEnabled) return;
  const words = extractSignificant(text);
  if (words.length === 0) return;
  const log = roomWordLogs.get(roomId) ?? [];
  log.push(...words);
  if (log.length > config.topicFatigueWindow * 10) log.splice(0, log.length - config.topicFatigueWindow * 10);
  roomWordLogs.set(roomId, log);
  roomLastActivity.set(roomId, Date.now());
}

function countFrequency(roomId: string): { topWord: string; count: number } | null {
  const lastActive = roomLastActivity.get(roomId);
  if (!lastActive || Date.now() - lastActive > FATIGUE_TTL) { roomWordLogs.delete(roomId); roomLastActivity.delete(roomId); return null; }
  const log = roomWordLogs.get(roomId);
  if (!log || log.length === 0) return null;
  const freq = new Map<string, number>();
  for (const w of log) freq.set(w, (freq.get(w) ?? 0) + 1);
  let topWord = "";
  let topCount = 0;
  for (const [w, c] of freq) { if (c > topCount) { topWord = w; topCount = c; } }
  return { topWord, count: topCount };
}

export function pruneTopicFatigue(): void {
  const now = Date.now();
  for (const [id, lastActive] of roomLastActivity) { if (now - lastActive > FATIGUE_TTL) { roomWordLogs.delete(id); roomLastActivity.delete(id); } }
}

export function getFatigueMultiplier(roomId: string): number {
  if (!config.topicFatigueEnabled) return 1;
  const freq = countFrequency(roomId);
  if (!freq || freq.count < config.topicFatigueThreshold) return 1;
  const excess = freq.count - config.topicFatigueThreshold + 1;
  return Math.min(config.topicFatigueDelayMultiplier * excess, 5);
}

export function getFatigueIgnoreBonus(roomId: string): number {
  if (!config.topicFatigueEnabled) return 0;
  const freq = countFrequency(roomId);
  if (!freq || freq.count < config.topicFatigueThreshold) return 0;
  return config.topicFatigueIgnoreBonus;
}
