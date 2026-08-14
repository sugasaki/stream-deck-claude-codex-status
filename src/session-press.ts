import type { StatusSnapshot } from "./status";

export const SESSION_LONG_PRESS_MS = 800;

export type SessionPressResult =
  | { type: "activate"; snapshot: StatusSnapshot }
  | { type: "complete"; snapshot: StatusSnapshot };

interface PendingPress {
  snapshot: StatusSnapshot;
  startedAt: number;
}

export class SessionPressTracker {
  readonly #presses = new Map<string, PendingPress>();

  begin(actionId: string, snapshot: StatusSnapshot, now = Date.now()): void {
    this.#presses.set(actionId, { snapshot, startedAt: now });
  }

  finish(actionId: string, now = Date.now()): SessionPressResult | undefined {
    const press = this.#presses.get(actionId);
    this.#presses.delete(actionId);
    if (!press) return undefined;

    const heldMs = Math.max(0, now - press.startedAt);
    return heldMs >= SESSION_LONG_PRESS_MS && press.snapshot.kind === "attention"
      ? { type: "complete", snapshot: press.snapshot }
      : { type: "activate", snapshot: press.snapshot };
  }

  cancel(actionId: string): void {
    this.#presses.delete(actionId);
  }
}
