import { TypedBus } from "../core/bus.js";

export type StateEvents = {
	"state:changed": [];
};

export const stateBus = new TypedBus<StateEvents>();
