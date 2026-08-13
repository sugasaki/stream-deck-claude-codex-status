import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

export interface ClaudeTranscriptCursor {
  offset: number;
  customTitle?: string;
  aiTitle?: string;
  agentName?: string;
  firstPrompt?: string;
  latestPrompt?: string;
}

export interface ClaudeTaskNameResolverOptions {
  projectsRoot?: string;
}

function oneLine(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return [...normalized].slice(0, 80).join("");
}

function userText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((part): part is { type?: unknown; text?: unknown } => Boolean(part) && typeof part === "object")
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join(" ");
  return text || undefined;
}

function meaningfulPrompt(content: unknown): string | undefined {
  const raw = userText(content)?.trim();
  if (!raw) return undefined;
  if (
    /^<(?:local-command|command-|task-notification|system-reminder)/i.test(raw) ||
    /^\[Image:/i.test(raw)
  ) {
    return undefined;
  }
  return oneLine(raw) || undefined;
}

function isGenericFollowUp(prompt: string): boolean {
  return /^(?:ok|okay|はい|了解|続けて|進めて|再開|お願い|お願いします|もう一度(?:試す|やって)|一旦ストップ|ストップ|止めて)[。.!！]*$/i.test(prompt);
}

export function applyClaudeTranscriptLine(cursor: ClaudeTranscriptCursor, line: string): void {
  let entry: {
    type?: unknown;
    customTitle?: unknown;
    aiTitle?: unknown;
    agentName?: unknown;
    message?: { content?: unknown };
  };
  try {
    entry = JSON.parse(line) as typeof entry;
  } catch {
    return;
  }

  if (entry.type === "custom-title" && typeof entry.customTitle === "string") {
    cursor.customTitle = oneLine(entry.customTitle) || undefined;
  } else if (entry.type === "ai-title" && typeof entry.aiTitle === "string") {
    cursor.aiTitle = oneLine(entry.aiTitle) || undefined;
  } else if (entry.type === "agent-name" && typeof entry.agentName === "string") {
    cursor.agentName = oneLine(entry.agentName) || undefined;
  } else if (entry.type === "user") {
    const prompt = meaningfulPrompt(entry.message?.content);
    if (!prompt) return;
    cursor.firstPrompt ??= prompt;
    if (!isGenericFollowUp(prompt)) cursor.latestPrompt = prompt;
  }
}

export function claudeTaskName(cursor: ClaudeTranscriptCursor): string | undefined {
  return cursor.customTitle ?? cursor.aiTitle ?? cursor.agentName ?? cursor.latestPrompt ?? cursor.firstPrompt;
}

export class ClaudeTaskNameResolver {
  readonly #projectsRoot: string;
  readonly #cursors = new Map<string, ClaudeTranscriptCursor>();
  readonly #transcriptPaths = new Map<string, string>();
  readonly #pending = new Map<string, Promise<string | undefined>>();

  constructor(options: ClaudeTaskNameResolverOptions = {}) {
    this.#projectsRoot = path.resolve(
      options.projectsRoot ?? path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"), "projects")
    );
  }

  async resolve(sessionId: string, transcriptPath?: string): Promise<string | undefined> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(sessionId)) return undefined;
    const resolvedPath = await this.#findTranscript(sessionId, transcriptPath);
    if (!resolvedPath) return undefined;
    const existing = this.#pending.get(resolvedPath);
    if (existing) return existing;

    const pending = this.#scan(resolvedPath);
    this.#pending.set(resolvedPath, pending);
    try {
      return await pending;
    } finally {
      if (this.#pending.get(resolvedPath) === pending) this.#pending.delete(resolvedPath);
    }
  }

  async #findTranscript(sessionId: string, transcriptPath?: string): Promise<string | undefined> {
    const cached = this.#transcriptPaths.get(sessionId);
    if (cached) return cached;

    if (transcriptPath) {
      const candidate = path.resolve(transcriptPath);
      if (this.#isAllowedTranscript(candidate, sessionId)) {
        this.#transcriptPaths.set(sessionId, candidate);
        return candidate;
      }
    }

    const entries = await readdir(this.#projectsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(this.#projectsRoot, entry.name, `${sessionId}.jsonl`);
      try {
        if ((await stat(candidate)).isFile()) {
          this.#transcriptPaths.set(sessionId, candidate);
          return candidate;
        }
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return undefined;
  }

  #isAllowedTranscript(candidate: string, sessionId: string): boolean {
    return candidate.startsWith(`${this.#projectsRoot}${path.sep}`) && path.basename(candidate) === `${sessionId}.jsonl`;
  }

  async #scan(transcriptPath: string): Promise<string | undefined> {
    const file = await stat(transcriptPath);
    let cursor = this.#cursors.get(transcriptPath);
    if (!cursor || file.size < cursor.offset) {
      cursor = { offset: 0 };
      this.#cursors.set(transcriptPath, cursor);
    }
    if (file.size === cursor.offset) return claudeTaskName(cursor);

    const start = cursor.offset;
    const input = createReadStream(transcriptPath, { encoding: "utf8", start });
    const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of lines) applyClaudeTranscriptLine(cursor, line);
    cursor.offset = start + input.bytesRead;
    return claudeTaskName(cursor);
  }
}
