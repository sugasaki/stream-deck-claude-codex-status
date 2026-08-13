import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60;
const CLAUDE_LOCAL_USAGE_MAX_AGE_MS = 30 * 60 * 1_000;
const CLAUDE_API_MIN_REFRESH_MS = 5 * 60 * 1_000;
const CLAUDE_RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1_000;
const CLAUDE_CODE_VERSION_FALLBACK = "2.1.0";

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
  claudeApiMinRefreshMs?: number;
  now?: () => number;
  readClaudeLocalUsage?: () => Promise<UsageReading | undefined>;
  readClaudeAccessToken?: () => Promise<string | undefined>;
  readClaudeCodeVersion?: () => Promise<string | undefined>;
  requestClaudeUsage?: (accessToken: string, userAgent: string) => Promise<ClaudeUsageResponse>;
  readCodexCredentials?: () => Promise<CodexCredentials | undefined>;
  requestCodexUsage?: (credentials: CodexCredentials) => Promise<CodexUsageResponse>;
  onError?: (provider: "claude" | "codex", error: unknown) => void;
}

class UsageAuthenticationError extends Error {}

export class UsageRateLimitError extends Error {
  constructor(readonly retryAfterAt?: number) {
    super("Usage request was rate limited");
  }
}

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

export function claudeFiveHourUsageFromHistory(
  content: string,
  now = Date.now(),
  maxAgeMs = CLAUDE_LOCAL_USAGE_MAX_AGE_MS
): UsageReading | undefined {
  let history: { samples?: Array<{ t?: unknown; u?: { fh?: unknown } }> };
  try {
    history = JSON.parse(content) as typeof history;
  } catch {
    return undefined;
  }
  const sample = (history.samples ?? [])
    .filter((item) =>
      typeof item.t === "number" &&
      Number.isFinite(item.t) &&
      item.t <= now + 60_000 &&
      now - item.t <= maxAgeMs
    )
    .sort((left, right) => Number(right.t) - Number(left.t))[0];
  if (!sample) return undefined;
  const usedPercent = percent(sample.u?.fh);
  return usedPercent === null
    ? undefined
    : { usedPercent, resetAt: null, state: "ok" };
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

async function defaultReadClaudeLocalUsage(): Promise<UsageReading | undefined> {
  try {
    const historyPath = path.join(
      homedir(),
      "Library",
      "Application Support",
      "Claude",
      "plan-usage-history.json"
    );
    return claudeFiveHourUsageFromHistory(await readFile(historyPath, "utf8"));
  } catch {
    return undefined;
  }
}

async function defaultReadClaudeCodeVersion(): Promise<string | undefined> {
  const candidates = [
    path.join(homedir(), ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "claude"
  ];
  for (const executable of candidates) {
    try {
      const { stdout } = await execFileAsync(executable, ["--version"], {
        encoding: "utf8",
        maxBuffer: 256 * 1024,
        timeout: 3_000
      });
      const version = stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0];
      if (version) return version;
    } catch {
      continue;
    }
  }
  return undefined;
}

export function claudeCodeUserAgent(version?: string): string {
  const normalized = version?.trim().match(/^\d+\.\d+\.\d+$/)?.[0] ?? CLAUDE_CODE_VERSION_FALLBACK;
  return `claude-code/${normalized}`;
}

function retryAfterAt(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1_000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function defaultRequestClaudeUsage(
  accessToken: string,
  userAgent: string
): Promise<ClaudeUsageResponse> {
  const response = await fetch(CLAUDE_USAGE_URL, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "content-type": "application/json",
      "anthropic-beta": "oauth-2025-04-20",
      "user-agent": userAgent
    },
    signal: AbortSignal.timeout(8_000)
  });
  if (response.status === 401 || response.status === 403) throw new UsageAuthenticationError();
  if (response.status === 429) {
    throw new UsageRateLimitError(retryAfterAt(response.headers.get("retry-after")));
  }
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
  readonly #claudeApiMinRefreshMs: number;
  readonly #now: () => number;
  readonly #readClaudeLocalUsage: () => Promise<UsageReading | undefined>;
  readonly #readClaudeAccessToken: () => Promise<string | undefined>;
  readonly #readClaudeCodeVersion: () => Promise<string | undefined>;
  readonly #requestClaudeUsage: (accessToken: string, userAgent: string) => Promise<ClaudeUsageResponse>;
  readonly #readCodexCredentials: () => Promise<CodexCredentials | undefined>;
  readonly #requestCodexUsage: (credentials: CodexCredentials) => Promise<CodexUsageResponse>;
  readonly #onError?: (provider: "claude" | "codex", error: unknown) => void;
  #cached?: CombinedUsageSnapshot;
  #cachedAt = 0;
  #pending?: Promise<CombinedUsageSnapshot>;
  #claudeUserAgent?: string;
  #lastClaudeSuccess?: UsageReading;
  #lastClaudeSuccessAt = 0;
  #claudeBlockedUntil = 0;

  constructor(options: CombinedUsageProviderOptions = {}) {
    this.#cacheMs = options.cacheMs ?? 60_000;
    this.#claudeApiMinRefreshMs = options.claudeApiMinRefreshMs ?? CLAUDE_API_MIN_REFRESH_MS;
    this.#now = options.now ?? Date.now;
    this.#readClaudeLocalUsage = options.readClaudeLocalUsage ?? defaultReadClaudeLocalUsage;
    this.#readClaudeAccessToken = options.readClaudeAccessToken ?? defaultReadClaudeAccessToken;
    this.#readClaudeCodeVersion = options.readClaudeCodeVersion ?? defaultReadClaudeCodeVersion;
    this.#requestClaudeUsage = options.requestClaudeUsage ?? defaultRequestClaudeUsage;
    this.#readCodexCredentials = options.readCodexCredentials ?? defaultReadCodexCredentials;
    this.#requestCodexUsage = options.requestCodexUsage ?? defaultRequestCodexUsage;
    this.#onError = options.onError;
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
    const now = this.#now();
    if (this.#lastClaudeSuccess && now - this.#lastClaudeSuccessAt < this.#claudeApiMinRefreshMs) {
      return this.#lastClaudeSuccess;
    }
    const localUsage = await this.#readClaudeLocalUsage();
    if (now < this.#claudeBlockedUntil) {
      return this.#lastClaudeSuccess ?? localUsage ?? emptyReading("error");
    }
    try {
      const accessToken = await this.#readClaudeAccessToken();
      if (!accessToken) return localUsage ?? emptyReading("auth_required");
      this.#claudeUserAgent ??= claudeCodeUserAgent(await this.#readClaudeCodeVersion());
      const reading = claudeFiveHourUsage(
        await this.#requestClaudeUsage(accessToken, this.#claudeUserAgent)
      );
      if (reading.state !== "ok") return localUsage ?? reading;
      this.#lastClaudeSuccess = reading;
      this.#lastClaudeSuccessAt = now;
      this.#claudeBlockedUntil = 0;
      return reading;
    } catch (error) {
      this.#onError?.("claude", error);
      if (error instanceof UsageRateLimitError) {
        this.#claudeBlockedUntil = Math.max(
          this.#claudeBlockedUntil,
          error.retryAfterAt && error.retryAfterAt > now
            ? error.retryAfterAt
            : now + CLAUDE_RATE_LIMIT_COOLDOWN_MS
        );
      }
      if (error instanceof UsageAuthenticationError) return emptyReading("auth_required");
      return this.#lastClaudeSuccess ?? localUsage ?? emptyReading("error");
    }
  }

  async #codexUsage(): Promise<UsageReading> {
    try {
      const credentials = await this.#readCodexCredentials();
      if (!credentials) return emptyReading("auth_required");
      return codexWeeklyUsage(await this.#requestCodexUsage(credentials));
    } catch (error) {
      this.#onError?.("codex", error);
      return emptyReading(error instanceof UsageAuthenticationError ? "auth_required" : "error");
    }
  }
}
