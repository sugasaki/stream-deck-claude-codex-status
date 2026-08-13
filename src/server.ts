import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { DISPLAY_SESSION_COUNT, type AgentKind, StatusStore, type HookPayload } from "./status";

const MAX_BODY_BYTES = 256 * 1024;

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(body);
}

export class HookServer {
  readonly #server: Server;

  constructor(
    private readonly store: StatusStore,
    private readonly port: number,
    private readonly onChange: () => void,
    private readonly onHook?: (payload: HookPayload, source: AgentKind | undefined) => void
  ) {
    this.#server = createServer((request, response) => this.#handle(request, response));
  }

  async start(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      this.#server.once("error", onError);
      this.#server.listen(this.port, "127.0.0.1", () => {
        this.#server.off("error", onError);
        resolve();
      });
    });
    this.#server.unref();
    return (this.#server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    if (!this.#server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  #handle(request: IncomingMessage, response: ServerResponse): void {
    if (request.method === "GET" && request.url === "/health") {
      const sessions = Array.from(
        { length: DISPLAY_SESSION_COUNT },
        (_, slot) => this.store.sessionSnapshot(slot)
      ).filter(
        (session) => !session.sessionId.startsWith("empty:")
      );
      writeJson(response, 200, { ok: true, status: this.store.snapshot(), sessions });
      return;
    }
    const source: AgentKind | undefined =
      request.url === "/hook/claude" ? "claude" : request.url === "/hook/codex" ? "codex" : undefined;
    if (request.method !== "POST" || (request.url !== "/hook" && !source)) {
      writeJson(response, 404, { error: "not_found" });
      return;
    }

    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        writeJson(response, 413, { error: "payload_too_large" });
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (response.writableEnded) return;
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as HookPayload;
        const changed = this.store.applyHook(payload, Date.now(), source);
        writeJson(response, 200, {});
        if (changed) this.onChange();
        this.onHook?.(payload, source);
      } catch {
        writeJson(response, 400, { error: "invalid_json" });
      }
    });
    request.on("error", () => {
      if (!response.writableEnded) writeJson(response, 400, { error: "request_error" });
    });
  }
}
