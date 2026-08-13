import path from "node:path";

export type StatusKind = "offline" | "ready" | "working" | "attention" | "done" | "error";
export type AgentKind = "claude" | "codex";

export type HookPayload = Record<string, unknown> & {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  notification_type?: string;
  agent_id?: string;
  last_assistant_message?: string;
  transcript_path?: string;
};

export interface SessionStatus {
  sessionId: string;
  agent: AgentKind;
  kind: StatusKind;
  project: string;
  task: string;
  detail: string;
  startedAt: number;
  updatedAt: number;
}

export interface StatusSnapshot extends SessionStatus {
  scope: AgentKind | "all";
  slot?: number;
  label?: string;
  activeSessions: number;
  elapsedMs: number;
}

const PRIORITY: Record<StatusKind, number> = {
  attention: 60,
  error: 50,
  working: 40,
  done: 30,
  ready: 20,
  offline: 10
};

const TOOL_LABELS: Record<string, string> = {
  Agent: "サブタスク実行",
  AskUserQuestion: "回答待ち",
  Bash: "コマンド実行",
  Edit: "ファイル編集",
  EnterPlanMode: "計画を作成",
  ExitPlanMode: "計画の確認待ち",
  Glob: "ファイル検索",
  Grep: "コード検索",
  NotebookEdit: "Notebook編集",
  Read: "ファイル確認",
  Skill: "スキル実行",
  Task: "サブタスク実行",
  TodoWrite: "タスク整理",
  WebFetch: "Web確認",
  WebSearch: "Web検索",
  Write: "ファイル作成"
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function projectName(cwd: unknown): string {
  const value = asString(cwd);
  if (!value) return "Claude Code";
  return path.basename(value) || "Claude Code";
}

function toolLabel(toolName: unknown): string {
  const value = asString(toolName);
  if (!value) return "処理中";
  if (TOOL_LABELS[value]) return TOOL_LABELS[value];
  if (value.startsWith("mcp__")) {
    const parts = value.split("__");
    return parts.at(-1)?.replaceAll("_", " ") || "MCPツール";
  }
  return value.replaceAll("_", " ");
}

function taskTitle(prompt: unknown, fallback: string): string {
  const value = asString(prompt);
  if (!value) return fallback;
  const oneLine = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[/#>*_`\-\s]+/, "")
    .trim();
  if (!oneLine) return fallback;
  return [...oneLine].slice(0, 80).join("");
}

function isInputTool(toolName: unknown): boolean {
  const value = asString(toolName);
  return value === "AskUserQuestion" || value === "request_user_input" || value === "RequestUserInput";
}

function asksForAnswer(message: unknown): boolean {
  const value = asString(message)?.trim();
  if (!value) return false;
  return /[?？](?:[\s）)」』】]*)$/.test(value) || /(教えて|選んで|回答して|確認してください|どちらにしますか)/.test(value);
}

function detectedAgent(payload: HookPayload): AgentKind {
  return asString(payload.model) ? "codex" : "claude";
}

function sessionKey(payload: HookPayload, agent: AgentKind): string {
  return `${agent}:${asString(payload.session_id) ?? "default"}`;
}

export class StatusStore {
  readonly #sessions = new Map<string, SessionStatus>();

  syncAgentSessions(agent: AgentKind, sessions: SessionStatus[]): boolean {
    const incoming = new Set(sessions.map((session) => session.sessionId));
    let changed = false;

    for (const [id, session] of this.#sessions) {
      if (session.agent === agent && !incoming.has(id)) {
        this.#sessions.delete(id);
        changed = true;
      }
    }

    for (const session of sessions) {
      const previous = this.#sessions.get(session.sessionId);
      const acknowledged =
        previous?.agent === agent &&
        previous.kind === "ready" &&
        session.kind === "attention" &&
        previous.updatedAt >= session.updatedAt;
      const next = acknowledged
        ? { ...session, kind: "ready" as const, detail: "確認済み", startedAt: previous.startedAt, updatedAt: previous.updatedAt }
        : session;
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        this.#sessions.set(session.sessionId, next);
        changed = true;
      }
    }
    return changed;
  }

  restore(sessions: SessionStatus[], now = Date.now()): void {
    for (const session of sessions) {
      if (
        !session ||
        typeof session.sessionId !== "string" ||
        (session.agent !== "claude" && session.agent !== "codex") ||
        !Object.hasOwn(PRIORITY, session.kind) ||
        typeof session.project !== "string" ||
        typeof session.task !== "string" ||
        typeof session.detail !== "string" ||
        typeof session.startedAt !== "number" ||
        typeof session.updatedAt !== "number"
      ) {
        continue;
      }
      this.#sessions.set(session.sessionId, session);
    }
    this.#expire(now);
  }

  export(): SessionStatus[] {
    return [...this.#sessions.values()];
  }

  updateSessionTask(sessionId: string, task: string): boolean {
    const previous = this.#sessions.get(sessionId);
    if (!previous) return false;
    const nextTask = taskTitle(task, previous.task);
    if (nextTask === previous.task) return false;
    this.#sessions.set(sessionId, { ...previous, task: nextTask });
    return true;
  }

  applyHook(payload: HookPayload, now = Date.now(), agent = detectedAgent(payload)): boolean {
    const event = asString(payload.hook_event_name);
    if (!event || asString(payload.agent_id)) return false;

    const id = sessionKey(payload, agent);
    const previous = this.#sessions.get(id);
    const project = projectName(payload.cwd ?? previous?.project);
    const startedAt = previous?.startedAt ?? now;
    const current: SessionStatus = {
      sessionId: id,
      agent,
      kind: previous?.kind ?? "ready",
      project,
      task: previous?.task ?? project,
      detail: previous?.detail ?? "待機中",
      startedAt,
      updatedAt: now
    };

    switch (event) {
      case "SessionStart":
        current.kind = "ready";
        current.detail = "セッション開始";
        current.startedAt = now;
        break;
      case "UserPromptSubmit":
        current.kind = "working";
        current.detail = "考えています";
        current.task = taskTitle(payload.prompt, project);
        current.startedAt = now;
        break;
      case "PreToolUse":
        current.kind = isInputTool(payload.tool_name) ? "attention" : "working";
        current.detail = isInputTool(payload.tool_name) ? "回答待ち" : toolLabel(payload.tool_name);
        break;
      case "PermissionRequest":
        current.kind = "attention";
        current.detail = `許可: ${toolLabel(payload.tool_name)}`;
        break;
      case "PostToolUse":
        current.kind = "working";
        current.detail = "処理を継続中";
        break;
      case "PostToolUseFailure":
        current.kind = "error";
        current.detail = `${toolLabel(payload.tool_name)}でエラー`;
        break;
      case "Notification": {
        const type = asString(payload.notification_type);
        if (type === "auth_success") {
          current.kind = "ready";
          current.detail = "認証完了";
        } else {
          current.kind = "attention";
          current.detail = type === "permission_prompt" ? "許可待ち" : "入力待ち";
        }
        break;
      }
      case "Stop":
        current.kind = "attention";
        current.detail = asksForAnswer(payload.last_assistant_message) ? "回答してください" : "返信を確認してください";
        break;
      case "StopFailure":
        current.kind = "error";
        current.detail = "応答を完了できませんでした";
        break;
      case "SessionEnd":
        current.kind = "offline";
        current.detail = "セッション終了";
        break;
      default:
        return false;
    }

    this.#sessions.set(id, current);
    return true;
  }

  acknowledge(now = Date.now(), agent?: AgentKind): void {
    const selected = this.#select(now, agent);
    if (!selected) return;
    this.acknowledgeSession(selected.sessionId, now);
  }

  acknowledgeSession(sessionId: string, _now = Date.now()): void {
    const selected = this.#sessions.get(sessionId);
    if (!selected || selected.kind === "working") return;
    this.#sessions.set(selected.sessionId, {
      ...selected,
      kind: "ready",
      detail: "確認済み"
    });
  }

  snapshot(now = Date.now(), agent?: AgentKind): StatusSnapshot {
    this.#expire(now);
    const selected = this.#select(now, agent);
    if (!selected) {
      return {
        sessionId: "none",
        agent: agent ?? "claude",
        kind: "ready",
        project: agent === "codex" ? "Codex" : agent === "claude" ? "Claude Code" : "AI Agents",
        task: "確認待ちはありません",
        detail: "新しい返信なし",
        startedAt: now,
        updatedAt: now,
        scope: agent ?? "all",
        label: "待ちなし",
        activeSessions: 0,
        elapsedMs: 0
      };
    }

    const activeSessions = [...this.#sessions.values()].filter(
      (session) =>
        (!agent || session.agent === agent) && ["working", "attention", "error"].includes(session.kind)
    ).length;
    const end = ["done", "error", "offline"].includes(selected.kind) ? selected.updatedAt : now;
    return {
      ...selected,
      scope: agent ?? "all",
      activeSessions,
      elapsedMs: Math.max(0, end - selected.startedAt)
    };
  }

  summarySnapshot(now = Date.now(), agent?: AgentKind): StatusSnapshot {
    this.#expire(now);
    const active = [...this.#sessions.values()].filter(
      (session) =>
        (!agent || session.agent === agent) && ["working", "attention", "error"].includes(session.kind)
    );
    const counts = {
      attention: active.filter((session) => session.kind === "attention").length,
      error: active.filter((session) => session.kind === "error").length,
      working: active.filter((session) => session.kind === "working").length
    };
    const kind: StatusKind = counts.attention > 0
      ? "attention"
      : counts.error > 0
        ? "error"
        : counts.working > 0
          ? "working"
          : "ready";
    const latestAttentionAt = active
      .filter((session) => session.kind === "attention")
      .reduce((latest, session) => Math.max(latest, session.updatedAt), 0);

    return {
      sessionId: `summary:${agent ?? "all"}`,
      agent: agent ?? "claude",
      kind,
      project: agent === "codex" ? "Codex" : agent === "claude" ? "Claude Code" : "AI Agents",
      task: `作業中 ${counts.working}`,
      detail: `${active.length}件を監視中`,
      startedAt: now,
      updatedAt: latestAttentionAt || now,
      scope: agent ?? "all",
      label: `確認待ち ${counts.attention}`,
      activeSessions: active.length,
      elapsedMs: 0
    };
  }

  sessionSnapshot(slot: number, now = Date.now(), agent?: AgentKind): StatusSnapshot {
    this.#expire(now);
    const sessions = this.#ordered(agent);
    const selected = sessions[slot];
    if (!selected) {
      return {
        sessionId: `empty:${slot}`,
        agent: agent ?? "claude",
        kind: "offline",
        project: agent === "codex" ? "Codex" : agent === "claude" ? "Claude Code" : "タスク",
        task: "表示なし",
        detail: "実行中セッションなし",
        startedAt: now,
        updatedAt: now,
        scope: agent ?? "all",
        slot,
        label: "空き",
        activeSessions: sessions.filter((session) => ["working", "attention", "error"].includes(session.kind)).length,
        elapsedMs: 0
      };
    }

    const end = ["done", "error", "offline"].includes(selected.kind) ? selected.updatedAt : now;
    return {
      ...selected,
      scope: agent ?? "all",
      slot,
      activeSessions: sessions.filter((session) => ["working", "attention", "error"].includes(session.kind)).length,
      elapsedMs: Math.max(0, end - selected.startedAt)
    };
  }

  #select(now: number, agent?: AgentKind): SessionStatus | undefined {
    this.#expire(now);
    return this.#ordered(agent)[0];
  }

  #ordered(agent?: AgentKind): SessionStatus[] {
    return [...this.#sessions.values()]
      .filter(
        (session) =>
          (!agent || session.agent === agent) && ["working", "attention", "error"].includes(session.kind)
      )
      .sort(
        (left, right) => right.updatedAt - left.updatedAt || right.sessionId.localeCompare(left.sessionId)
      );
  }

  #expire(now: number): void {
    for (const [id, session] of this.#sessions) {
      const age = now - session.updatedAt;
      if (age > 8 * 60 * 60 * 1000) {
        this.#sessions.delete(id);
      } else if (session.kind === "done" && age > 10 * 60 * 1000) {
        this.#sessions.set(id, { ...session, kind: "ready", detail: "待機中", updatedAt: now });
      } else if (session.kind === "offline" && age > 60 * 1000) {
        this.#sessions.delete(id);
      }
    }
  }
}
