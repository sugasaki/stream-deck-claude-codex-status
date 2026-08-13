import type { CombinedUsageSnapshot, UsageReading } from "./usage";

const BACKGROUND = "#080808";
const FRAME = "#4A4A4D";
const TRACK = "#3A3A3C";
const TEXT = "#FFFFFF";
const CLAUDE = "#FF7548";
const CODEX = "#159DFF";

function displayValue(reading: UsageReading): string {
  if (reading.usedPercent !== null) return `${reading.usedPercent}%`;
  if (reading.state === "auth_required") return "LOGIN";
  if (reading.state === "error") return "ERR";
  return "—";
}

function usageBar(reading: UsageReading, y: number, color: string): string {
  const width = reading.usedPercent === null ? 0 : Math.max(0, Math.min(120, 1.2 * reading.usedPercent));
  const fill = width > 0
    ? `<rect x="12" y="${y}" width="${width}" height="13" rx="6.5" fill="${color}"/>`
    : "";
  return `<rect x="12" y="${y}" width="120" height="13" rx="6.5" fill="${TRACK}"/>
  ${fill}`;
}

export function combinedUsageSvg(snapshot: CombinedUsageSnapshot): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect x="3" y="3" width="138" height="138" rx="21" fill="${BACKGROUND}" stroke="${FRAME}" stroke-width="6"/>
  <text x="12" y="22" fill="${TEXT}" opacity="0.82" font-size="12" font-weight="700" font-family="Arial,sans-serif">5H</text>
  <text x="132" y="22" text-anchor="end" fill="${TEXT}" opacity="0.62" font-size="9" font-weight="700" letter-spacing="0.7" font-family="Arial,sans-serif">USAGE</text>
  <text x="12" y="43" fill="${CLAUDE}" font-size="13" font-weight="700" font-family="Arial,sans-serif">CLAUDE</text>
  <text x="132" y="44" text-anchor="end" fill="${TEXT}" font-size="19" font-weight="700" font-family="Arial,sans-serif">${displayValue(snapshot.claude)}</text>
  ${usageBar(snapshot.claude, 51, CLAUDE)}
  <line x1="12" y1="76" x2="132" y2="76" stroke="${FRAME}" stroke-width="1" opacity="0.65"/>
  <text x="12" y="99" fill="${CODEX}" font-size="13" font-weight="700" font-family="Arial,sans-serif">CODEX</text>
  <text x="132" y="100" text-anchor="end" fill="${TEXT}" font-size="19" font-weight="700" font-family="Arial,sans-serif">${displayValue(snapshot.codex)}</text>
  ${usageBar(snapshot.codex, 108, CODEX)}
</svg>`;
}

export function renderCombinedUsage(snapshot: CombinedUsageSnapshot): string {
  return `data:image/svg+xml,${encodeURIComponent(combinedUsageSvg(snapshot))}`;
}
