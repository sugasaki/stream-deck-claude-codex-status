import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLAUDE_SESSIONS_URL = "https://api.anthropic.com/v1/code/sessions";

interface ClaudeProcessRecord {
  pid?: unknown;
  sessionId?: unknown;
}

export interface ClaudeRemoteSessionPage {
  data?: Array<{ id?: unknown; title?: unknown }>;
  next_cursor?: unknown;
}

export interface ClaudeRemoteTitleResolverOptions {
  sessionsRoot?: string;
  cacheMs?: number;
  now?: () => number;
  commandForPid?: (pid: number) => Promise<string | undefined>;
  readAccessToken?: () => Promise<string | undefined>;
  requestPage?: (accessToken: string, cursor?: string) => Promise<ClaudeRemoteSessionPage>;
}

function oneLine(value: string): string | undefined {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? [...normalized].slice(0, 80).join("") : undefined;
}

export function cloudSessionIdFromCommand(command: string): string | undefined {
  const sdkUrl = command.match(/\/v1\/code\/sessions\/(cse_[A-Za-z0-9]+)/)?.[1];
  if (sdkUrl) return sdkUrl;
  return command.match(/(?:^|\s)--session-id(?:=|\s+)(cse_[A-Za-z0-9]+)(?:\s|$)/)?.[1];
}

async function defaultCommandForPid(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("/bin/ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      maxBuffer: 256 * 1024,
      timeout: 2_000
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function defaultReadAccessToken(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 5_000 }
    );
    const credentials = JSON.parse(stdout) as { claudeAiOauth?: { accessToken?: unknown } };
    return typeof credentials.claudeAiOauth?.accessToken === "string"
      ? credentials.claudeAiOauth.accessToken
      : undefined;
  } catch {
    return undefined;
  }
}

async function defaultRequestPage(accessToken: string, cursor?: string): Promise<ClaudeRemoteSessionPage> {
  const url = new URL(CLAUDE_SESSIONS_URL);
  if (cursor) url.searchParams.set("cursor", cursor);
  const response = await fetch(url, {
    headers: {
      "anthropic-version": "2023-06-01",
      authorization: `Bearer ${accessToken}`
    },
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) throw new Error(`Claude session list returned HTTP ${response.status}`);
  return await response.json() as ClaudeRemoteSessionPage;
}

export class ClaudeRemoteTitleResolver {
  readonly #sessionsRoot: string;
  readonly #cacheMs: number;
  readonly #now: () => number;
  readonly #commandForPid: (pid: number) => Promise<string | undefined>;
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #requestPage: (accessToken: string, cursor?: string) => Promise<ClaudeRemoteSessionPage>;
  #cachedAt = 0;
  #cachedTitles = new Map<string, string>();
  #pendingTitles?: Promise<Map<string, string>>;

  constructor(options: ClaudeRemoteTitleResolverOptions = {}) {
    this.#sessionsRoot = path.resolve(
      options.sessionsRoot ?? path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"), "sessions")
    );
    this.#cacheMs = options.cacheMs ?? 15_000;
    this.#now = options.now ?? Date.now;
    this.#commandForPid = options.commandForPid ?? defaultCommandForPid;
    this.#readAccessToken = options.readAccessToken ?? defaultReadAccessToken;
    this.#requestPage = options.requestPage ?? defaultRequestPage;
  }

  async resolve(localSessionId: string): Promise<string | undefined> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(localSessionId)) return undefined;
    const cloudSessionId = await this.#findCloudSessionId(localSessionId);
    if (!cloudSessionId) return undefined;
    return (await this.#titles()).get(cloudSessionId);
  }

  async #findCloudSessionId(localSessionId: string): Promise<string | undefined> {
    let entries;
    try {
      entries = await readdir(this.#sessionsRoot, { withFileTypes: true });
    } catch {
      return undefined;
    }

    for (const entry of entries) {
      const pidFromName = entry.isFile() ? entry.name.match(/^(\d+)\.json$/)?.[1] : undefined;
      if (!pidFromName) continue;
      try {
        const record = JSON.parse(await readFile(path.join(this.#sessionsRoot, entry.name), "utf8")) as ClaudeProcessRecord;
        if (record.sessionId !== localSessionId) continue;
        const pid = typeof record.pid === "number" && Number.isSafeInteger(record.pid)
          ? record.pid
          : Number(pidFromName);
        if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
        const command = await this.#commandForPid(pid);
        return command ? cloudSessionIdFromCommand(command) : undefined;
      } catch {
        continue;
      }
    }
    return undefined;
  }

  async #titles(): Promise<Map<string, string>> {
    if (this.#cachedAt > 0 && this.#now() - this.#cachedAt < this.#cacheMs) return this.#cachedTitles;
    if (this.#pendingTitles) return this.#pendingTitles;

    const pending = this.#fetchTitles();
    this.#pendingTitles = pending;
    try {
      return await pending;
    } finally {
      if (this.#pendingTitles === pending) this.#pendingTitles = undefined;
    }
  }

  async #fetchTitles(): Promise<Map<string, string>> {
    const accessToken = await this.#readAccessToken();
    if (!accessToken) return this.#cachedTitles;

    const titles = new Map<string, string>();
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
      const page = await this.#requestPage(accessToken, cursor);
      for (const session of page.data ?? []) {
        if (typeof session.id !== "string" || !/^cse_[A-Za-z0-9]+$/.test(session.id)) continue;
        if (typeof session.title !== "string") continue;
        const title = oneLine(session.title);
        if (title) titles.set(session.id, title);
      }
      const nextCursor = typeof page.next_cursor === "string" ? page.next_cursor : undefined;
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    this.#cachedTitles = titles;
    this.#cachedAt = this.#now();
    return titles;
  }
}
