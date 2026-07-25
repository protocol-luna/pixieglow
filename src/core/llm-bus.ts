import { TypedBus } from "./bus.js";

export type LLMEvents = {
  token: [chunk: string];
  done: [fullText: string];
  error: [err: Error];
  crash: [code: number | null];
  ready: [];
  reset: [];
  flush: [];
};

export const llmBus = new TypedBus<LLMEvents>();
