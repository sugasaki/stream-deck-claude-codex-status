import {
  action,
  type KeyDownEvent,
  type KeyUpEvent,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent
} from "@elgato/streamdeck";

import { renderStatus } from "./render";
import { SessionPressTracker } from "./session-press";
import type { SessionAppActivator } from "./session-app";
import { type AgentKind, StatusStore } from "./status";

abstract class BaseStatusAction extends SingletonAction {
  readonly #presses = new SessionPressTracker();

  constructor(
    private readonly store: StatusStore,
    private readonly agent?: AgentKind,
    private readonly slot?: number,
    private readonly activator?: SessionAppActivator,
    private readonly summary = false,
    private readonly onChange?: () => void
  ) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent): Promise<void> {
    return ev.action.setImage(renderStatus(this.#snapshot(Date.now())));
  }

  override onKeyDown(ev: KeyDownEvent): void {
    this.#presses.begin(ev.action.id, this.#snapshot(Date.now()));
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    const result = this.#presses.finish(ev.action.id);
    if (!result) return;

    if (this.summary) {
      if (!this.store.dismissCompletionAlerts(this.agent)) return;
      this.onChange?.();
      await this.refresh();
      await ev.action.showOk();
      return;
    }

    const { snapshot } = result;
    if (snapshot.sessionId === "none" || snapshot.sessionId.startsWith("empty:")) {
      await ev.action.showAlert();
      return;
    }

    if (result.type === "complete") {
      if (!this.store.acknowledgeSession(snapshot.sessionId)) {
        await ev.action.showAlert();
        return;
      }
      this.onChange?.();
      await this.refresh();
      await ev.action.showOk();
      return;
    }

    if (!this.activator) {
      await ev.action.showAlert();
      return;
    }
    if (this.store.dismissCompletionAlert(snapshot.sessionId)) {
      this.onChange?.();
      await this.refresh();
    }
    if (await this.activator.activate(snapshot)) await ev.action.showOk();
    else await ev.action.showAlert();
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    this.#presses.cancel(ev.action.id);
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
  constructor(store: StatusStore, onChange?: () => void) {
    super(store, undefined, undefined, undefined, true, onChange);
  }
}

@action({ UUID: "com.atsu.claude-code-status.claude" })
export class ClaudeStatusAction extends BaseStatusAction {
  constructor(store: StatusStore, onChange?: () => void) {
    super(store, "claude", undefined, undefined, true, onChange);
  }
}

@action({ UUID: "com.atsu.claude-code-status.codex" })
export class CodexStatusAction extends BaseStatusAction {
  constructor(store: StatusStore, onChange?: () => void) {
    super(store, "codex", undefined, undefined, true, onChange);
  }
}

abstract class SessionSlotAction extends BaseStatusAction {
  constructor(store: StatusStore, slot: number, activator: SessionAppActivator, onChange?: () => void) {
    super(store, undefined, slot, activator, false, onChange);
  }
}

@action({ UUID: "com.atsu.claude-code-status.session-1" })
export class Session1Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator, onChange?: () => void) { super(store, 0, activator, onChange); }
}

@action({ UUID: "com.atsu.claude-code-status.session-2" })
export class Session2Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator, onChange?: () => void) { super(store, 1, activator, onChange); }
}

@action({ UUID: "com.atsu.claude-code-status.session-3" })
export class Session3Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator, onChange?: () => void) { super(store, 2, activator, onChange); }
}

@action({ UUID: "com.atsu.claude-code-status.session-4" })
export class Session4Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator, onChange?: () => void) { super(store, 3, activator, onChange); }
}

@action({ UUID: "com.atsu.claude-code-status.session-5" })
export class Session5Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator, onChange?: () => void) { super(store, 4, activator, onChange); }
}

@action({ UUID: "com.atsu.claude-code-status.session-6" })
export class Session6Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator, onChange?: () => void) { super(store, 5, activator, onChange); }
}

@action({ UUID: "com.atsu.claude-code-status.session-7" })
export class Session7Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator, onChange?: () => void) { super(store, 6, activator, onChange); }
}

@action({ UUID: "com.atsu.claude-code-status.session-8" })
export class Session8Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator, onChange?: () => void) { super(store, 7, activator, onChange); }
}

@action({ UUID: "com.atsu.claude-code-status.session-9" })
export class Session9Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator, onChange?: () => void) { super(store, 8, activator, onChange); }
}

@action({ UUID: "com.atsu.claude-code-status.session-10" })
export class Session10Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator, onChange?: () => void) { super(store, 9, activator, onChange); }
}

@action({ UUID: "com.atsu.claude-code-status.session-11" })
export class Session11Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator, onChange?: () => void) { super(store, 10, activator, onChange); }
}

@action({ UUID: "com.atsu.claude-code-status.session-12" })
export class Session12Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator, onChange?: () => void) { super(store, 11, activator, onChange); }
}

@action({ UUID: "com.atsu.claude-code-status.session-13" })
export class Session13Action extends SessionSlotAction {
  constructor(store: StatusStore, activator: SessionAppActivator, onChange?: () => void) { super(store, 12, activator, onChange); }
}
