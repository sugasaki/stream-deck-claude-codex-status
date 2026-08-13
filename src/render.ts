import { renderAgentIcon } from "./agent-icons";
import type { StatusKind, StatusSnapshot } from "./status";

const STATUS_LABELS: Record<StatusKind, string> = {
  offline: "終了",
  ready: "待機中",
  working: "作業中",
  attention: "確認待ち",
  done: "完了",
  error: "エラー"
};

const AGENT_THEMES = {
  claude: { border: "#E36B3A" },
  codex: { border: "#1E96FF" },
  neutral: { border: "#4A4F58" }
} as const;

const BACKGROUND_COLOR = "#050608";
const TEXT_COLOR = "#FFFFFF";
const ATTENTION_COLOR = "#FF3355";
const ATTENTION_TEXT_COLOR = "#00E5FF";
const WORKING_TEXT_COLOR = "#69E6A6";

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;"
    };
    return entities[character];
  });
}

function characterWidth(character: string): number {
  if (/\s/.test(character)) return 0.35;
  return /^[\u0020-\u007e]$/.test(character) ? 0.55 : 1;
}

function sessionNameLines(value: string): [string, string, string] {
  const characters = [...value];
  const lines: string[] = [];
  const maxWidth = 6.8;
  let start = 0;

  while (start < characters.length && lines.length < 3) {
    while (characters[start] === " ") start++;
    if (start >= characters.length) break;
    let width = 0;
    let end = start;
    let lastSpace = -1;
    while (end < characters.length) {
      const nextWidth = width + characterWidth(characters[end]);
      if (nextWidth > maxWidth) break;
      width = nextWidth;
      if (characters[end] === " ") lastSpace = end;
      end++;
    }
    if (end < characters.length && lastSpace > start) end = lastSpace;
    if (end === start) end++;
    lines.push(characters.slice(start, end).join("").trim());
    start = end;
  }

  if (start < characters.length) {
    const last = [...(lines[2] ?? "")];
    while (last.length > 0 && last.reduce((sum, character) => sum + characterWidth(character), 1) > maxWidth) {
      last.pop();
    }
    lines[2] = `${last.join("")}…`;
  }
  return [lines[0] ?? "", lines[1] ?? "", lines[2] ?? ""];
}

function updatedAgo(value: number): string {
  const seconds = Math.floor(value / 1000);
  if (seconds < 10) return "更新 たった今";
  if (seconds < 60) return `更新 ${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `更新 ${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `更新 ${hours}時間前`;
  return `更新 ${Math.floor(hours / 24)}日前`;
}

function workingIndicator(color: string, now: number, x: number, y: number): string {
  const frame = Math.floor(now / 200) % 12;
  const spokes = Array.from({ length: 12 }, (_, index) => {
    const angle = index * Math.PI / 6 - Math.PI / 2;
    const difference = (frame - index + 12) % 12;
    const opacity = difference === 0 ? 1 : difference === 1 ? 0.72 : difference === 2 ? 0.46 : 0.18;
    const x1 = x + Math.cos(angle) * 6;
    const y1 = y + Math.sin(angle) * 6;
    const x2 = x + Math.cos(angle) * 13;
    const y2 = y + Math.sin(angle) * 13;
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${color}" stroke-width="4" stroke-linecap="round" opacity="${opacity}"/>`;
  }).join("");
  return `<g data-indicator="working" data-frame="${frame}">${spokes}</g>`;
}

function attentionIndicator(now: number, updatedAt: number, x: number, y: number): string {
  const recentlyChanged = now >= updatedAt && now - updatedAt < 10_000;
  const pulse = recentlyChanged && Math.floor(now / 500) % 2 === 0;
  const halo = pulse
    ? `<circle cx="${x}" cy="${y}" r="10" fill="${ATTENTION_COLOR}" opacity="0.28"/>`
    : "";
  const dotOpacity = recentlyChanged && !pulse ? 0.12 : 1;
  return `<g data-indicator="attention" data-recent="${recentlyChanged}" data-pulse="${pulse}">${halo}<circle cx="${x}" cy="${y}" r="6.3" fill="${ATTENTION_COLOR}" opacity="${dotOpacity}"/></g>`;
}

function errorIndicator(x: number, y: number): string {
  return `<path data-indicator="error" d="M${x} ${y - 7}L${x + 7} ${y}L${x} ${y + 7}L${x - 7} ${y}Z" fill="${ATTENTION_COLOR}"/>`;
}

function statusIndicator(snapshot: StatusSnapshot, now: number, color: string, x: number, y: number): string {
  if (snapshot.kind === "working") return workingIndicator(color, now, x, y);
  if (snapshot.kind === "attention") return attentionIndicator(now, snapshot.updatedAt, x, y);
  if (snapshot.kind === "error") return errorIndicator(x, y);
  return "";
}

function countAtEnd(value: string): number {
  const count = value.match(/(\d+)$/)?.[1];
  return count ? Number(count) : 0;
}

export function renderStatus(snapshot: StatusSnapshot, now = Date.now()): string {
  const isSummary = snapshot.sessionId.startsWith("summary:");
  const isUnifiedSummary = snapshot.sessionId === "summary:all";
  const isEmpty = snapshot.sessionId.startsWith("empty:");
  const hasSession = snapshot.sessionId !== "none" && !snapshot.sessionId.startsWith("empty:");
  const showAgent = snapshot.scope !== "all" || hasSession;
  const brand = isUnifiedSummary
    ? "AI AGENTS"
    : showAgent
      ? snapshot.agent === "codex" ? "CODEX" : isSummary ? "CLAUDE" : "CLAUDE CODE"
      : "TASK";
  const theme = showAgent && !isUnifiedSummary ? AGENT_THEMES[snapshot.agent] : AGENT_THEMES.neutral;
  const backgroundLogoOpacity = snapshot.agent === "codex" ? 0.72 : 0.7;
  const backgroundLogo = showAgent && !isUnifiedSummary
    ? `<g data-background-logo="${snapshot.agent}" opacity="${backgroundLogoOpacity}">${renderAgentIcon(snapshot.agent, theme.border, 64, 66, 76)}</g>`
    : "";
  const statusLabel = escapeXml(snapshot.label ?? STATUS_LABELS[snapshot.kind]);
  const statusTextColor = snapshot.kind === "attention"
    ? ATTENTION_TEXT_COLOR
    : snapshot.kind === "working"
      ? WORKING_TEXT_COLOR
      : TEXT_COLOR;
  const [nameLine1, nameLine2, nameLine3] = sessionNameLines(snapshot.task).map(escapeXml) as [string, string, string];
  const time = isSummary || isEmpty
    ? ""
    : updatedAgo(Math.max(0, now - snapshot.updatedAt));

  const header = showAgent && !isUnifiedSummary && isSummary
    ? `${renderAgentIcon(snapshot.agent, theme.border, 10, 6, 21)}
  <text x="39" y="23" fill="${TEXT_COLOR}" font-size="15.5" font-weight="700" letter-spacing="0.8" font-family="Arial,sans-serif">${brand}</text>`
    : showAgent && !isUnifiedSummary
      ? `${renderAgentIcon(snapshot.agent, theme.border, 10, 7, 16)}
  <text x="31" y="19" fill="${TEXT_COLOR}" font-size="9" font-weight="700" letter-spacing="0.8" font-family="Arial,sans-serif">${brand}</text>`
      : `<text x="11" y="19" fill="${TEXT_COLOR}" opacity="0.78" font-size="9" font-weight="700" letter-spacing="0.8" font-family="Arial,sans-serif">${brand}</text>`;

  const attentionCount = countAtEnd(snapshot.label ?? "");
  const workingCount = countAtEnd(snapshot.task);
  const summaryAttentionIndicator = attentionCount > 0
    ? attentionIndicator(now, snapshot.updatedAt, 28, 61)
    : `<circle cx="28" cy="61" r="5.8" fill="${ATTENTION_COLOR}" opacity="0.3"/>`;
  const summaryWorkingIndicator = workingCount > 0
    ? workingIndicator(theme.border, now, 28, 101)
    : `<circle cx="28" cy="101" r="6.5" fill="none" stroke="${theme.border}" stroke-width="2.5" opacity="0.35"/>`;

  const indicator = statusIndicator(snapshot, now, theme.border, 30, 39);
  const statusX = indicator ? 84 : 72;
  const content = isSummary
    ? `${header}
  ${summaryAttentionIndicator}
  <text x="82" y="68" text-anchor="middle" fill="${ATTENTION_TEXT_COLOR}" font-size="20" font-weight="700" font-family="Arial,sans-serif">${statusLabel}</text>
  ${summaryWorkingIndicator}
  <text x="82" y="108" text-anchor="middle" fill="${WORKING_TEXT_COLOR}" font-size="20" font-weight="700" font-family="Arial,sans-serif">${nameLine1}</text>`
    : `${header}
  ${indicator}
  <text x="${statusX}" y="42" text-anchor="middle" fill="${statusTextColor}" font-size="16" font-weight="700" font-family="Arial,sans-serif">${statusLabel}</text>
  <text x="72" y="66" text-anchor="middle" fill="${TEXT_COLOR}" font-size="16" font-weight="700" font-family="Arial,sans-serif">${nameLine1}</text>
  <text x="72" y="87" text-anchor="middle" fill="${TEXT_COLOR}" font-size="16" font-weight="700" font-family="Arial,sans-serif">${nameLine2}</text>
  <text x="72" y="108" text-anchor="middle" fill="${TEXT_COLOR}" font-size="16" font-weight="700" font-family="Arial,sans-serif">${nameLine3}</text>
  <rect x="24" y="117" width="96" height="22" rx="11" fill="${BACKGROUND_COLOR}" opacity="0.86"/>
  <text x="72" y="134" text-anchor="middle" fill="${TEXT_COLOR}" font-size="14" font-weight="700" font-family="Arial,sans-serif">${escapeXml(time)}</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect x="2" y="2" width="140" height="140" rx="20" fill="${BACKGROUND_COLOR}" stroke="${theme.border}" stroke-width="3.5"/>
  <rect x="6" y="6" width="132" height="132" rx="16" fill="none" stroke="${theme.border}" stroke-width="1" opacity="0.24"/>
  ${backgroundLogo}
  ${content}
</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
