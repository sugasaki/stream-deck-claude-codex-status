import {
  action,
  type KeyDownEvent,
  SingletonAction,
  type WillAppearEvent
} from "@elgato/streamdeck";

import { renderStatus } from "./render";
import type { SessionAppActivator } from "./session-app";
import { type AgentKind, StatusStore } from "./status";

abstract class BaseStatusAction extends SingletonAction {
  constructor(
    private readonly store: StatusStore,
    private readonly agent?: AgentKind,
    private readonly slot?: number,
    private readonly activator?: SessionAppActivator,
    private readonly summary = false
  ) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent): Promise<void> {
    return ev.action.setImage(renderStatus(this.#snapshot(Date.now())));
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (this.summary) return;
    const snapshot = this.#snapshot(Date.now());
    if (snapshot.sessionId === "none" || snapshot.sessionId.startsWith("empty:") || !this.activator) {
      await ev.action.showAlert();
      return;
    }
    if (await this.activator.activate(snapshot)) await ev.action.showOk();
    else await ev.action.showAlert();
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
  constructor(store: StatusStore) {
    super(store, undefined, undefined, undefined, true);
  }
}

@action({ UUID: "com.atsu.claude-code-status.claude" })
export class ClaudeStatusAction extends BaseStatusAction {
  constructor(store: StatusStore) {
    super(store, "claude", undefined, undefined, true);
  }
}

@action({ UUID: "com.atsu.claude-code-status.codex" })
export class CodexStatusAction extends BaseStatusAction {
  constructor(store: StatusStore) {
    super(store, "codex", undefined, undefined, true);
  }
}

abstract class SessionSlotAction extends BaseStatusAction {
  constructor(store: StatusStore, slot: number, activator: SessionAppActivator) {
    super(store, undefined, slot, activator);
  }
}

@action({ UUID: "com.atsu.claude-code-status.session-1" })
export class Session1Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator) { super(store, 0, activator); }
}

@action({ UUID: "com.atsu.claude-code-status.session-2" })
export class Session2Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator) { super(store, 1, activator); }
}

@action({ UUID: "com.atsu.claude-code-status.session-3" })
export class Session3Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator) { super(store, 2, activator); }
}

@action({ UUID: "com.atsu.claude-code-status.session-4" })
export class Session4Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator) { super(store, 3, activator); }
}

@action({ UUID: "com.atsu.claude-code-status.session-5" })
export class Session5Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator) { super(store, 4, activator); }
}

@action({ UUID: "com.atsu.claude-code-status.session-6" })
export class Session6Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator) { super(store, 5, activator); }
}

@action({ UUID: "com.atsu.claude-code-status.session-7" })
export class Session7Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator) { super(store, 6, activator); }
}

@action({ UUID: "com.atsu.claude-code-status.session-8" })
export class Session8Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator) { super(store, 7, activator); }
}

@action({ UUID: "com.atsu.claude-code-status.session-9" })
export class Session9Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator) { super(store, 8, activator); }
}

@action({ UUID: "com.atsu.claude-code-status.session-10" })
export class Session10Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator) { super(store, 9, activator); }
}

@action({ UUID: "com.atsu.claude-code-status.session-11" })
export class Session11Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator) { super(store, 10, activator); }
}

@action({ UUID: "com.atsu.claude-code-status.session-12" })
export class Session12Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator) { super(store, 11, activator); }
}

@action({ UUID: "com.atsu.claude-code-status.session-13" })
export class Session13Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator) { super(store, 12, activator); }
}
