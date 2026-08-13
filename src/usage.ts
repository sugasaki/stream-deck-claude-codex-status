import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60;

export type UsageReadingState = "ok" | "unavailable" | "auth_required" | "error";

export interface UsageReading {
  usedPercent: number | null;
  resetAt: number | null;
  state: UsageReadingState;
}

export interface CombinedUsageSnapshot {
  claude: UsageReading;
  codex: UsageReading;
  updatedAt: number;
}

export interface ClaudeUsageResponse {
  five_hour?: {
    utilization?: unknown;
    resets_at?: unknown;
  };
}

interface CodexUsageWindow {
  used_percent?: unknown;
  reset_at?: unknown;
  limit_window_seconds?: unknown;
  window_minutes?: unknown;
}

interface CodexRateLimit {
  primary_window?: CodexUsageWindow | null;
  secondary_window?: CodexUsageWindow | null;
}

export interface CodexUsageResponse {
  rate_limit?: CodexRateLimit;
  additional_rate_limits?: Array<{ rate_limit?: CodexRateLimit }>;
}

interface CodexCredentials {
  accessToken: string;
  accountId?: string;
}

export interface CombinedUsageProviderOptions {
  cacheMs?: number;
  now?: () => number;
  readClaudeAccessToken?: () => Promise<string | undefined>;
  requestClaudeUsage?: (accessToken: string) => Promise<ClaudeUsageResponse>;
  readCodexCredentials?: () => Promise<CodexCredentials | undefined>;
  requestCodexUsage?: (credentials: CodexCredentials) => Promise<CodexUsageResponse>;
}

class UsageAuthenticationError extends Error {}

const emptyReading = (state: UsageReadingState): UsageReading => ({
  usedPercent: null,
  resetAt: null,
  state
});

function percent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function resetAtFromIso(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resetAtFromSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value * 1_000 : null;
}

export function claudeFiveHourUsage(response: ClaudeUsageResponse): UsageReading {
  const usedPercent = percent(response.five_hour?.utilization);
  if (usedPercent === null) return emptyReading("unavailable");
  return {
    usedPercent,
    resetAt: resetAtFromIso(response.five_hour?.resets_at),
    state: "ok"
  };
}

function isWeeklyWindow(window: CodexUsageWindow): boolean {
  if (typeof window.limit_window_seconds === "number") {
    return Math.abs(window.limit_window_seconds - ONE_WEEK_SECONDS) <= 60;
  }
  return typeof window.window_minutes === "number" && Math.abs(window.window_minutes - 10_080) <= 1;
}

export function codexWeeklyUsage(response: CodexUsageResponse): UsageReading {
  const rateLimits = [response.rate_limit, ...(response.additional_rate_limits ?? []).map((item) => item.rate_limit)];
  const windows = rateLimits.flatMap((rateLimit) =>
    rateLimit ? [rateLimit.primary_window, rateLimit.secondary_window] : []
  );
  const weeklyWindow = windows.find(
    (window): window is CodexUsageWindow => Boolean(window && isWeeklyWindow(window))
  );
  if (!weeklyWindow) return emptyReading("unavailable");
  const usedPercent = percent(weeklyWindow.used_percent);
  if (usedPercent === null) return emptyReading("unavailable");
  return {
    usedPercent,
    resetAt: resetAtFromSeconds(weeklyWindow.reset_at),
    state: "ok"
  };
}

async function defaultReadClaudeAccessToken(): Promise<string | undefined> {
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
    try {
      const credentialsPath = path.join(
        process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"),
        ".credentials.json"
      );
      const credentials = JSON.parse(await readFile(credentialsPath, "utf8")) as {
        claudeAiOauth?: { accessToken?: unknown };
      };
      return typeof credentials.claudeAiOauth?.accessToken === "string"
        ? credentials.claudeAiOauth.accessToken
        : undefined;
    } catch {
      return undefined;
    }
  }
}

async function defaultRequestClaudeUsage(accessToken: string): Promise<ClaudeUsageResponse> {
  const response = await fetch(CLAUDE_USAGE_URL, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20"
    },
    signal: AbortSignal.timeout(8_000)
  });
  if (response.status === 401 || response.status === 403) throw new UsageAuthenticationError();
  if (!response.ok) throw new Error(`Claude usage returned HTTP ${response.status}`);
  return await response.json() as ClaudeUsageResponse;
}

async function defaultReadCodexCredentials(): Promise<CodexCredentials | undefined> {
  try {
    const authPath = path.join(process.env.CODEX_HOME ?? path.join(homedir(), ".codex"), "auth.json");
    const auth = JSON.parse(await readFile(authPath, "utf8")) as {
      tokens?: { access_token?: unknown; account_id?: unknown };
    };
    const accessToken = auth.tokens?.access_token;
    if (typeof accessToken !== "string" || !accessToken) return undefined;
    const accountId = auth.tokens?.account_id;
    return {
      accessToken,
      accountId: typeof accountId === "string" && accountId ? accountId : undefined
    };
  } catch {
    return undefined;
  }
}

async function defaultRequestCodexUsage(credentials: CodexCredentials): Promise<CodexUsageResponse> {
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${credentials.accessToken}`,
    "user-agent": "codex_cli_rs"
  });
  if (credentials.accountId) headers.set("chatgpt-account-id", credentials.accountId);
  const response = await fetch(CODEX_USAGE_URL, {
    headers,
    signal: AbortSignal.timeout(8_000)
  });
  if (response.status === 401 || response.status === 403) throw new UsageAuthenticationError();
  if (!response.ok) throw new Error(`Codex usage returned HTTP ${response.status}`);
  return await response.json() as CodexUsageResponse;
}

export class CombinedUsageProvider {
  readonly #cacheMs: number;
  readonly #now: () => number;
  readonly #readClaudeAccessToken: () => Promise<string | undefined>;
  readonly #requestClaudeUsage: (accessToken: string) => Promise<ClaudeUsageResponse>;
  readonly #readCodexCredentials: () => Promise<CodexCredentials | undefined>;
  readonly #requestCodexUsage: (credentials: CodexCredentials) => Promise<CodexUsageResponse>;
  #cached?: CombinedUsageSnapshot;
  #cachedAt = 0;
  #pending?: Promise<CombinedUsageSnapshot>;

  constructor(options: CombinedUsageProviderOptions = {}) {
    this.#cacheMs = options.cacheMs ?? 60_000;
    this.#now = options.now ?? Date.now;
    this.#readClaudeAccessToken = options.readClaudeAccessToken ?? defaultReadClaudeAccessToken;
    this.#requestClaudeUsage = options.requestClaudeUsage ?? defaultRequestClaudeUsage;
    this.#readCodexCredentials = options.readCodexCredentials ?? defaultReadCodexCredentials;
    this.#requestCodexUsage = options.requestCodexUsage ?? defaultRequestCodexUsage;
  }

  async getUsage(force = false): Promise<CombinedUsageSnapshot> {
    if (!force && this.#cached && this.#now() - this.#cachedAt < this.#cacheMs) return this.#cached;
    if (this.#pending) return this.#pending;
    const pending = this.#refresh();
    this.#pending = pending;
    try {
      return await pending;
    } finally {
      if (this.#pending === pending) this.#pending = undefined;
    }
  }

  async #refresh(): Promise<CombinedUsageSnapshot> {
    const [claude, codex] = await Promise.all([this.#claudeUsage(), this.#codexUsage()]);
    const snapshot = { claude, codex, updatedAt: this.#now() };
    this.#cached = snapshot;
    this.#cachedAt = snapshot.updatedAt;
    return snapshot;
  }

  async #claudeUsage(): Promise<UsageReading> {
    try {
      const accessToken = await this.#readClaudeAccessToken();
      if (!accessToken) return emptyReading("auth_required");
      return claudeFiveHourUsage(await this.#requestClaudeUsage(accessToken));
    } catch (error) {
      return emptyReading(error instanceof UsageAuthenticationError ? "auth_required" : "error");
    }
  }

  async #codexUsage(): Promise<UsageReading> {
    try {
      const credentials = await this.#readCodexCredentials();
      if (!credentials) return emptyReading("auth_required");
      return codexWeeklyUsage(await this.#requestCodexUsage(credentials));
    } catch (error) {
      return emptyReading(error instanceof UsageAuthenticationError ? "auth_required" : "error");
    }
  }
}
