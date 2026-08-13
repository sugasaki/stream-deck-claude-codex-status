import { writeFile } from "node:fs/promises";

import { renderStatus } from "../src/render";
import type { StatusSnapshot } from "../src/status";

const now = Date.now();
const base = {
  scope: "all" as const,
  activeSessions: 5,
  startedAt: now - 92_000,
  updatedAt: now,
  elapsedMs: 92_000
};
const snapshots: StatusSnapshot[] = [
  {
    ...base,
    sessionId: "summary:claude",
    agent: "claude",
    kind: "attention",
    project: "Claude Code",
    task: "作業中 2",
    detail: "2件を監視中",
    scope: "claude",
    label: "確認待ち 1",
    activeSessions: 3,
    elapsedMs: 0
  },
  {
    ...base,
    sessionId: "summary:codex",
    agent: "codex",
    kind: "attention",
    project: "Codex",
    task: "作業中 2",
    detail: "3件を監視中",
    scope: "codex",
    label: "確認待ち 1",
    activeSessions: 3,
    elapsedMs: 0
  },
  {
    ...base,
    sessionId: "codex:latest",
    agent: "codex",
    kind: "working",
    project: "stream-deck",
    task: "更新日時順へ変更",
    detail: "ファイル編集",
    updatedAt: now - 8_000
  },
  {
    ...base,
    sessionId: "claude:previous-1",
    agent: "claude",
    kind: "attention",
    project: "api-server",
    task: "本番デプロイの許可",
    detail: "許可: コマンド実行",
    updatedAt: now - 2 * 60_000
  },
  {
    ...base,
    sessionId: "codex:previous-2",
    agent: "codex",
    kind: "working",
    project: "mobile-app",
    task: "ログイン画面を修正",
    detail: "ファイル編集",
    updatedAt: now - 5 * 60_000
  },
  {
    ...base,
    sessionId: "claude:previous-3",
    agent: "claude",
    kind: "working",
    project: "design-system",
    task: "ボタンの見た目を調整",
    detail: "コード検索",
    updatedAt: now - 12 * 60_000
  },
  {
    ...base,
    sessionId: "codex:previous-4",
    agent: "codex",
    kind: "error",
    project: "docs",
    task: "README更新エラー",
    detail: "ファイル編集でエラー",
    updatedAt: now - 30 * 60_000
  },
  {
    ...base,
    sessionId: "claude:previous-5",
    agent: "claude",
    kind: "working",
    project: "backend",
    task: "APIテストを追加",
    detail: "テスト実行",
    updatedAt: now - 60 * 60_000
  }
];

const width = 690;
const height = 382;
const key = 144;
const gap = 18;
const left = 24;
const top = 58;
const images = snapshots
  .map((snapshot, index) => {
    const x = left + (index % 4) * (key + gap);
    const y = top + Math.floor(index / 4) * (key + gap);
    return `<image x="${x}" y="${y}" width="${key}" height="${key}" href="${renderStatus({ ...snapshot, slot: index }, now)}"/>`;
  })
  .join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" rx="28" fill="#090B0F"/>
  <text x="24" y="34" fill="#FFFFFF" font-size="18" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,Helvetica Neue,Hiragino Sans,Arial,sans-serif">Stream Deck Neo · 最終更新日時順</text>
  <text x="666" y="34" text-anchor="end" fill="#FFFFFF" opacity="0.5" font-size="11" font-family="-apple-system,BlinkMacSystemFont,Helvetica Neue,Hiragino Sans,Arial,sans-serif">最新から5つ前まで表示</text>
  ${images}
</svg>`;

const output = process.argv[2] || "dist/session-preview.svg";
await writeFile(output, svg, "utf8");
console.log(output);
