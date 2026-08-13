import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { SessionStatus } from "./status";

const execFileAsync = promisify(execFile);
const CHATGPT_BUNDLE_ID = "com.openai.codex";
const CLAUDE_BUNDLE_ID = "com.anthropic.claudefordesktop";

export type SessionLaunchTarget =
  | { kind: "url"; value: string }
  | { kind: "bundle"; value: string }
  | { kind: "app"; value: string };

export interface ProcessInfo {
  parentPid: number;
  command: string;
}

export interface ClaudeSessionRecord {
  pid: number;
  sessionId: string;
}

export interface SessionAppActivatorOptions {
  claudeSessionsRoot?: string;
  readProcess?: (pid: number) => Promise<ProcessInfo | undefined>;
  readClaudeSessionRecords?: () => Promise<ClaudeSessionRecord[]>;
  openTarget?: (target: SessionLaunchTarget) => Promise<void>;
  onError?: (error: unknown) => void;
}

function validSessionId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,120}$/.test(value);
}

function fallbackTarget(agent: SessionStatus["agent"], sessionId: string): SessionLaunchTarget {
  if (agent === "codex" && validSessionId(sessionId)) {
    return { kind: "url", value: `codex://threads/${sessionId}` };
  }
  return {
    kind: "bundle",
    value: agent === "codex" ? CHATGPT_BUNDLE_ID : CLAUDE_BUNDLE_ID
  };
}

function finalAppFallback(agent: SessionStatus["agent"]): SessionLaunchTarget {
  return {
    kind: "bundle",
    value: agent === "codex" ? CHATGPT_BUNDLE_ID : CLAUDE_BUNDLE_ID
  };
}

export function codexLaunchTarget(sessionId: string, originator?: string): SessionLaunchTarget {
  const threadId = sessionId.replace(/^codex:/, "");
  const source = originator?.trim().toLowerCase() ?? "";
  if (source === "zed") return { kind: "bundle", value: "dev.zed.Zed" };
  if (source === "vscode" || source.includes("visual studio code")) {
    return { kind: "bundle", value: "com.microsoft.VSCode" };
  }
  if (source.includes("chrome-extension")) {
    return { kind: "bundle", value: "com.google.Chrome" };
  }
  return fallbackTarget("codex", threadId);
}

export function appPathFromCommand(command: string): string | undefined {
  const match = command.match(/^(.+?\.app)(?:\/Contents\/|$)/);
  if (!match?.[1] || !path.isAbsolute(match[1])) return undefined;
  const normalized = path.normalize(match[1]);
  return normalized.includes(`${path.sep}Applications${path.sep}`) ? normalized : undefined;
}

async function defaultReadProcess(pid: number): Promise<ProcessInfo | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "/bin/ps",
      ["-p", String(pid), "-o", "ppid=,comm="],
      { encoding: "utf8", maxBuffer: 256 * 1024, timeout: 2_000 }
    );
    const match = stdout.trim().match(/^(\d+)\s+(.+)$/s);
    if (!match) return undefined;
    return { parentPid: Number(match[1]), command: match[2] };
  } catch {
    return undefined;
  }
}

async function defaultReadClaudeSessionRecords(root: string): Promise<ClaudeSessionRecord[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const records: ClaudeSessionRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^\d+\.json$/.test(entry.name)) continue;
    try {
      const value = JSON.parse(await readFile(path.join(root, entry.name), "utf8")) as {
        pid?: unknown;
        sessionId?: unknown;
      };
      if (
        typeof value.pid === "number" &&
        Number.isSafeInteger(value.pid) &&
        value.pid > 0 &&
        typeof value.sessionId === "string" &&
        validSessionId(value.sessionId)
      ) {
        records.push({ pid: value.pid, sessionId: value.sessionId });
      }
    } catch {
      continue;
    }
  }
  return records;
}

export async function appPathForProcess(
  pid: number,
  readProcess: (pid: number) => Promise<ProcessInfo | undefined>
): Promise<string | undefined> {
  const visited = new Set<number>();
  let currentPid = pid;
  let detectedApp: string | undefined;
  for (let depth = 0; depth < 12 && currentPid > 0 && !visited.has(currentPid); depth++) {
    visited.add(currentPid);
    const process = await readProcess(currentPid);
    if (!process) return detectedApp;
    detectedApp = appPathFromCommand(process.command) ?? detectedApp;
    if (process.parentPid <= 0 || process.parentPid === currentPid) break;
    currentPid = process.parentPid;
  }
  return detectedApp;
}

async function defaultOpenTarget(target: SessionLaunchTarget): Promise<void> {
  const args = target.kind === "bundle"
    ? ["-b", target.value]
    : target.kind === "app"
      ? ["-a", target.value]
      : [target.value];
  await execFileAsync("/usr/bin/open", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024,
    timeout: 5_000
  });
}

export class SessionAppActivator {
  readonly #readProcess: (pid: number) => Promise<ProcessInfo | undefined>;
  readonly #readClaudeSessionRecords: () => Promise<ClaudeSessionRecord[]>;
  readonly #openTarget: (target: SessionLaunchTarget) => Promise<void>;
  readonly #onError?: (error: unknown) => void;

  constructor(options: SessionAppActivatorOptions = {}) {
    const sessionsRoot = path.resolve(
      options.claudeSessionsRoot ??
      path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"), "sessions")
    );
    this.#readProcess = options.readProcess ?? defaultReadProcess;
    this.#readClaudeSessionRecords = options.readClaudeSessionRecords ??
      (() => defaultReadClaudeSessionRecords(sessionsRoot));
    this.#openTarget = options.openTarget ?? defaultOpenTarget;
    this.#onError = options.onError;
  }

  async activate(session: SessionStatus): Promise<boolean> {
    const rawSessionId = session.sessionId.replace(/^(?:claude|codex):/, "");
    if (!validSessionId(rawSessionId)) return false;
    const fallback = fallbackTarget(session.agent, rawSessionId);
    const primary = session.agent === "codex"
      ? codexLaunchTarget(rawSessionId, session.originator)
      : await this.#claudeTarget(rawSessionId) ?? fallback;
    const targets = [primary, fallback, finalAppFallback(session.agent)].filter(
      (target, index, values) =>
        values.findIndex((candidate) => candidate.kind === target.kind && candidate.value === target.value) === index
    );

    for (const target of targets) {
      try {
        await this.#openTarget(target);
        return true;
      } catch (error: unknown) {
        this.#onError?.(error);
      }
    }
    return false;
  }

  async #claudeTarget(sessionId: string): Promise<SessionLaunchTarget | undefined> {
    const record = (await this.#readClaudeSessionRecords()).find((item) => item.sessionId === sessionId);
    if (!record) return undefined;
    const firstProcess = await this.#readProcess(record.pid);
    if (!firstProcess || !/claude/i.test(firstProcess.command)) return undefined;
    const appPath = await appPathForProcess(record.pid, this.#readProcess);
    return appPath ? { kind: "app", value: appPath } : undefined;
  }
}
