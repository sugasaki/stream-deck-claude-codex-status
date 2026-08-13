import {
  action,
  type KeyDownEvent,
  SingletonAction,
  type WillAppearEvent
} from "@elgato/streamdeck";

import { renderStatus } from "./render";
import { type AgentKind, StatusStore } from "./status";

abstract class BaseStatusAction extends SingletonAction {
  constructor(
    private readonly store: StatusStore,
    private readonly agent?: AgentKind,
    private readonly slot?: number,
    private readonly onMutation?: () => void,
    private readonly summary = false
  ) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent): Promise<void> {
    return ev.action.setImage(renderStatus(this.#snapshot(Date.now())));
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (this.summary) return;
    const now = Date.now();
    const snapshot = this.#snapshot(now);
    if (this.slot === undefined) this.store.acknowledge(now, this.agent);
    else this.store.acknowledgeSession(snapshot.sessionId, now);
    this.onMutation?.();
    await Promise.all([ev.action.setImage(renderStatus(this.#snapshot(Date.now()))), ev.action.showOk()]);
  }

  async refresh(now = Date.now()): Promise<void> {
    const image = renderStatus(this.#snapshot(now), now);
    await Promise.all([...this.actions].map((visibleAction) => visibleAction.setImage(image)));
  }

  #snapshot(now: number) {
    return this.summary
      ? this.store.summarySnapshot(now, this.agent)
      : this.slot === undefined
      ? this.store.snapshot(now, this.agent)
      : this.store.sessionSnapshot(this.slot, now, this.agent);
  }
}

@action({ UUID: "com.atsu.claude-code-status.status" })
export class UnifiedStatusAction extends BaseStatusAction {
  constructor(store: StatusStore, onMutation?: () => void) {
    super(store, undefined, undefined, onMutation, true);
  }
}

@action({ UUID: "com.atsu.claude-code-status.claude" })
export class ClaudeStatusAction extends BaseStatusAction {
  constructor(store: StatusStore, onMutation?: () => void) {
    super(store, "claude", undefined, onMutation, true);
  }
}

@action({ UUID: "com.atsu.claude-code-status.codex" })
export class CodexStatusAction extends BaseStatusAction {
  constructor(store: StatusStore, onMutation?: () => void) {
    super(store, "codex", undefined, onMutation, true);
  }
}

abstract class SessionSlotAction extends BaseStatusAction {
  constructor(store: StatusStore, slot: number, onMutation?: () => void) {
    super(store, undefined, slot, onMutation);
  }
}

@action({ UUID: "com.atsu.claude-code-status.session-1" })
export class Session1Action extends SessionSlotAction {
  constructor(store: StatusStore, onMutation?: () => void) { super(store, 0, onMutation); }
}

@action({ UUID: "com.atsu.claude-code-status.session-2" })
export class Session2Action extends SessionSlotAction {
  constructor(store: StatusStore, onMutation?: () => void) { super(store, 1, onMutation); }
}

@action({ UUID: "com.atsu.claude-code-status.session-3" })
export class Session3Action extends SessionSlotAction {
  constructor(store: StatusStore, onMutation?: () => void) { super(store, 2, onMutation); }
}

@action({ UUID: "com.atsu.claude-code-status.session-4" })
export class Session4Action extends SessionSlotAction {
  constructor(store: StatusStore, onMutation?: () => void) { super(store, 3, onMutation); }
}

@action({ UUID: "com.atsu.claude-code-status.session-5" })
export class Session5Action extends SessionSlotAction {
  constructor(store: StatusStore, onMutation?: () => void) { super(store, 4, onMutation); }
}

@action({ UUID: "com.atsu.claude-code-status.session-6" })
export class Session6Action extends SessionSlotAction {
  constructor(store: StatusStore, onMutation?: () => void) { super(store, 5, onMutation); }
}

@action({ UUID: "com.atsu.claude-code-status.session-7" })
export class Session7Action extends SessionSlotAction {
  constructor(store: StatusStore, onMutation?: () => void) { super(store, 6, onMutation); }
}

@action({ UUID: "com.atsu.claude-code-status.session-8" })
export class Session8Action extends SessionSlotAction {
  constructor(store: StatusStore, onMutation?: () => void) { super(store, 7, onMutation); }
}
