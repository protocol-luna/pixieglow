import type { MatrixClient, JoinedRoom } from "./matrix/client.js";
import { isLLMBusy } from "./core/llm-client.js";
import { askLLM, resetLLM } from "./core/llm-core.js";
import { markBotActivity } from "./state/state.js";
import { config } from "./config.js";

const CACHE_TTL = 60_000;
const activeRoomCache = new Map<string, { room: JoinedRoom; timestamp: number }>();

function getRankedRooms(client: MatrixClient): JoinedRoom[] {
  const whitelist = config.spontaneousWhitelist === "*" ? null : new Set(config.spontaneousWhitelist.split(",").map((id) => id.trim()));
  const now = Date.now();
  const rooms: JoinedRoom[] = [];
  for (const room of client.joinedRooms.values()) {
    if (whitelist && !whitelist.has(room.room_id)) continue;
    rooms.push(room);
  }
  rooms.sort((a, b) => b.members.length - a.members.length);
  return rooms;
}

function pickWeightedRoom(client: MatrixClient): JoinedRoom | null {
  const rooms = getRankedRooms(client);
  if (rooms.length === 0) return null;
  const total = (rooms.length * (rooms.length + 1)) / 2;
  let roll = Math.random() * total;
  for (let i = 0; i < rooms.length; i++) {
    roll -= rooms.length - i;
    if (roll <= 0) return rooms[i];
  }
  return rooms[rooms.length - 1];
}

export async function trySpawn(client: MatrixClient): Promise<void> {
  if (await isLLMBusy()) return;

  const room = pickWeightedRoom(client);
  if (!room) return;

  resetLLM(room.room_id);
  let reply = "";

  await askLLM(
    {
      username: "system",
      sessionId: room.room_id,
      text: `You are in "${room.name}". The room is quiet. Say something engaging to spark conversation. Keep it short.`,
    },
    {
      onFirstToken: () => {},
      onChunk: (chunk: string) => { reply += chunk; },
    }
  );

  if (reply.trim()) {
    try {
      await client.sendText(room.room_id, reply.trim());
      markBotActivity(room.room_id);
      console.log(`[spontaneous] ${room.name}: "${reply.slice(0, 100).replace(/\n/g, " ")}"`);
    } catch {
      console.log(`[spontaneous] ${room.name}: send failed (permissions?)`);
    }
  } else {
    console.log(`[spontaneous] ${room.name}: empty reply`);
  }

  resetLLM(room.room_id);
}
