import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";

import type { SessionStatus } from "./status";

interface CodexThreadRow {
  id: string;
  rollout_path: string;
  display_name: string;
  cwd: string;
  recency_at_ms: number;
}

export interface RolloutLifecycle {
  kind: "working" | "attention" | "error";
  timestamp: number;
  detail: string;
}

export interface RolloutCursor {
  offset: number;
  originator?: string;
  lifecycle?: RolloutLifecycle;
}

export interface CodexTaskMonitorOptions {
  codexHome?: string;
  sessionIndexPath?: string;
  intervalMs?: number;
  maxAgeMs?: number;
  limit?: number;
}

function oneLine(value: string, fallback: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return [...(normalized || fallback)].slice(0, 80).join("");
}

export function codexThreadNamesFromSessionIndex(content: string): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry: { id?: unknown; thread_name?: unknown };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (typeof entry.id !== "string" || typeof entry.thread_name !== "string") continue;
    const id = entry.id.trim();
    const name = oneLine(entry.thread_name, "");
    if (id && name) names.set(id, name);
  }
  return names;
}

export function applyCodexRolloutLine(cursor: RolloutCursor, line: string): void {
  if (line.includes('"type":"session_meta"')) {
    try {
      const entry = JSON.parse(line) as { type?: unknown; payload?: { originator?: unknown } };
      if (entry.type === "session_meta" && typeof entry.payload?.originator === "string") {
        cursor.originator = oneLine(entry.payload.originator, "");
      }
    } catch {
      // Ignore malformed metadata and continue scanning lifecycle events.
    }
  }
  if (!line.includes('"type":"event_msg"')) return;
  if (
    !line.includes('"type":"task_started"') &&
    !line.includes('"type":"task_complete"') &&
    !line.includes('"type":"turn_aborted"') &&
    !line.includes('"type":"user_message"')
  ) {
    return;
  }

  let entry: { timestamp?: unknown; payload?: { type?: unknown } };
  try {
    entry = JSON.parse(line) as typeof entry;
  } catch {
    return;
  }
  const event = typeof entry.payload?.type === "string" ? entry.payload.type : "";
  const timestamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
  if (!Number.isFinite(timestamp)) return;

  if (event === "task_started" || event === "user_message") {
    cursor.lifecycle = { kind: "working", timestamp, detail: "応答を作成中" };
  } else if (event === "task_complete") {
    cursor.lifecycle = { kind: "attention", timestamp, detail: "返信を確認してください" };
  } else if (event === "turn_aborted") {
    cursor.lifecycle = { kind: "error", timestamp, detail: "応答が中断しました" };
  }
}

export function codexSessionFromThread(
  thread: CodexThreadRow,
  lifecycle: RolloutLifecycle | undefined,
  originator?: string
): SessionStatus | undefined {
  if (!lifecycle) return undefined;
  return {
    sessionId: `codex:${thread.id}`,
    agent: "codex",
    originator,
    kind: lifecycle.kind,
    project: path.basename(thread.cwd) || "Codex",
    task: oneLine(thread.display_name, path.basename(thread.cwd) || "Codexタスク"),
    detail: lifecycle.detail,
    startedAt: lifecycle.timestamp,
    updatedAt: lifecycle.timestamp
  };
}

export class CodexTaskMonitor {
  readonly #codexHome: string;
  readonly #sessionIndexPath: string;
  readonly #intervalMs: number;
  readonly #maxAgeMs: number;
  readonly #limit: number;
  readonly #cursors = new Map<string, RolloutCursor>();
  #sessionIndexSignature?: string;
  #threadNames: ReadonlyMap<string, string> = new Map();
  #timer?: NodeJS.Timeout;
  #polling = false;

  constructor(
    private readonly onSessions: (sessions: SessionStatus[]) => void,
    private readonly onError: (error: unknown) => void,
    options: CodexTaskMonitorOptions = {}
  ) {
    this.#codexHome = options.codexHome ?? process.env.CODEX_HOME ?? path.join(homedir(), ".codex");
    this.#sessionIndexPath = options.sessionIndexPath ?? path.join(this.#codexHome, "session_index.jsonl");
    this.#intervalMs = options.intervalMs ?? 1_000;
    this.#maxAgeMs = options.maxAgeMs ?? 8 * 60 * 60 * 1_000;
    this.#limit = options.limit ?? 8;
  }

  start(): void {
    void this.poll();
    this.#timer = setInterval(() => void this.poll(), this.#intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async poll(now = Date.now()): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    try {
      const databasePath = await this.#findStateDatabase();
      if (!databasePath) return;
      const threads = this.#readRecentThreads(databasePath, now);
      const threadNames = await this.#readSessionIndexNames();
      const sessions: SessionStatus[] = [];
      for (const thread of threads) {
        const cursor = await this.#scanRollout(thread.rollout_path);
        const renamedThread = threadNames.has(thread.id)
          ? { ...thread, display_name: threadNames.get(thread.id) ?? thread.display_name }
          : thread;
        const session = codexSessionFromThread(renamedThread, cursor.lifecycle, cursor.originator);
        if (session) sessions.push(session);
      }
      this.onSessions(sessions);
    } catch (error: unknown) {
      this.onError(error);
    } finally {
      this.#polling = false;
    }
  }

  async #findStateDatabase(): Promise<string | undefined> {
    const entries = await readdir(this.#codexHome, { withFileTypes: true });
    const candidates = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /^state_\d+\.sqlite$/.test(entry.name))
        .map(async (entry) => {
          const filePath = path.join(this.#codexHome, entry.name);
          return { filePath, mtimeMs: (await stat(filePath)).mtimeMs };
        })
    );
    return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath;
  }

  #readRecentThreads(databasePath: string, now: number): CodexThreadRow[] {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      return database
        .prepare(
          `SELECT
             id,
             rollout_path,
             COALESCE(NULLIF(name, ''), NULLIF(title, ''), NULLIF(preview, ''), NULLIF(first_user_message, '')) AS display_name,
             cwd,
             recency_at_ms
           FROM threads
           WHERE archived = 0
             AND preview <> ''
             AND recency_at_ms >= ?
             AND (thread_source = 'user' OR source IN ('vscode', 'cli', 'appServer', 'unknown'))
           ORDER BY recency_at_ms DESC
           LIMIT ?`
        )
        .all(now - this.#maxAgeMs, this.#limit) as unknown as CodexThreadRow[];
    } finally {
      database.close();
    }
  }

  async #readSessionIndexNames(): Promise<ReadonlyMap<string, string>> {
    try {
      const file = await stat(this.#sessionIndexPath);
      const signature = `${file.mtimeMs}:${file.size}`;
      if (signature === this.#sessionIndexSignature) return this.#threadNames;
      this.#threadNames = codexThreadNamesFromSessionIndex(await readFile(this.#sessionIndexPath, "utf8"));
      this.#sessionIndexSignature = signature;
      return this.#threadNames;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.#sessionIndexSignature = undefined;
        this.#threadNames = new Map();
        return this.#threadNames;
      }
      throw error;
    }
  }

  async #scanRollout(rolloutPath: string): Promise<RolloutCursor> {
    const file = await stat(rolloutPath);
    let cursor = this.#cursors.get(rolloutPath);
    if (!cursor || file.size < cursor.offset) {
      cursor = { offset: 0 };
      this.#cursors.set(rolloutPath, cursor);
    }
    if (file.size === cursor.offset) return cursor;

    const start = cursor.offset;
    const input = createReadStream(rolloutPath, { encoding: "utf8", start });
    const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of lines) applyCodexRolloutLine(cursor, line);
    cursor.offset = start + input.bytesRead;
    return cursor;
  }
}
