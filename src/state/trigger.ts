import { config } from "../config.js";
import { isOnCooldown, setPaused, markReplied, isPaused } from "./state.js";

function log(roomName: string, msg: string): void {
  console.log(`[trigger] ${roomName} ${msg}`);
}

export interface TriggerResult {
  shouldRespond: boolean;
  reason: "mention" | "dm" | "name" | "keyword" | "random" | "follow-up" | "clear" | "stop" | "start" | null;
  botName: string;
}

const hasWordCache = new Map<string, RegExp>();

function hasWord(text: string, word: string): boolean {
  let re = hasWordCache.get(word);
  if (!re) {
    re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    hasWordCache.set(word, re);
  }
  return re.test(text);
}

export function evaluateMessage(
  body: string,
  sender: string,
  roomId: string,
  roomName: string,
  botId: string,
  botName: string,
  isDM: boolean,
  isFollowUp = false
): TriggerResult {
  if (body === "-stop") {
    log(roomName, "commande -stop → stop");
    return { shouldRespond: true, reason: "stop", botName: "" };
  }
  if (body === "-start") {
    log(roomName, "commande -start → start");
    return { shouldRespond: true, reason: "start", botName: "" };
  }
  if (body === "-clear") {
    log(roomName, "commande -clear → clear");
    return { shouldRespond: true, reason: "clear", botName: "" };
  }

  if (sender === botId) {
    return { shouldRespond: false, reason: null, botName: "" };
  }

  const contentLower = body.toLowerCase();
  const botMention = `<${botId.toLowerCase()}>`;  // fallback
  const isMentioned = hasWord(contentLower, botId.split(":")[0].replace(/^@/, ""));

  if (isMentioned) {
    log(roomName, `${sender}: "${body.slice(0, 60)}" → mention`);
    setPaused(false);
    return { shouldRespond: true, reason: "mention", botName };
  }

  if (isDM) {
    log(roomName, `${sender}: "${body.slice(0, 60)}" → dm`);
    setPaused(false);
    return { shouldRespond: true, reason: "dm", botName };
  }

  if (isPaused()) {
    log(roomName, `${sender}: "${body.slice(0, 60)}" → paused`);
    return { shouldRespond: false, reason: null, botName: "" };
  }

  if (isOnCooldown(roomId) && !isMentioned && !isFollowUp) {
    log(roomName, `${sender}: "${body.slice(0, 60)}" → cooldown`);
    return { shouldRespond: false, reason: null, botName };
  }

  if (hasWord(contentLower, botName.toLowerCase())) {
    log(roomName, `${sender}: "${body.slice(0, 60)}" → name (bot:${botName})`);
    markReplied(roomId);
    return { shouldRespond: true, reason: "name", botName };
  }

  for (const name of config.names) {
    if (hasWord(contentLower, name.toLowerCase())) {
      log(roomName, `${sender}: "${body.slice(0, 60)}" → name (custom:${name})`);
      markReplied(roomId);
      return { shouldRespond: true, reason: "name", botName };
    }
  }

  for (const keyword of config.keywords) {
    if (hasWord(contentLower, keyword.toLowerCase())) {
      log(roomName, `${sender}: "${body.slice(0, 60)}" → keyword (${keyword})`);
      markReplied(roomId);
      return { shouldRespond: true, reason: "keyword", botName };
    }
  }

  if (isFollowUp) {
    log(roomName, `${sender}: "${body.slice(0, 60)}" → follow-up`);
    return { shouldRespond: true, reason: "follow-up", botName };
  }

  if (config.randomChance > 0 && Math.random() < config.randomChance) {
    log(roomName, `${sender}: "${body.slice(0, 60)}" → random`);
    markReplied(roomId);
    return { shouldRespond: true, reason: "random", botName };
  }

  log(roomName, `${sender}: "${body.slice(0, 60)}" → rien`);
  return { shouldRespond: false, reason: null, botName };
}
