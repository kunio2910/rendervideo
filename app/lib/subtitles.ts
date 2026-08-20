export type ImportedSubtitleCue = {
  text: string;
  start: number;
  end: number;
};

const decodeSubtitleEntities = (value: string) => value
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/&#x27;/gi, "'");

const cleanSubtitleText = (lines: string[]) => decodeSubtitleEntities(
  lines
    .join("\n")
    .replace(/\r/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\{\\[^}]+\}/g, "")
    .trim(),
);

const parseSubtitleTimestamp = (value: string) => {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const seconds = Number(parts.at(-1));
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  if (hours < 0 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
};

const isMetadataBlock = (block: string[]) => {
  const firstLine = block.find((line) => line.trim())?.trim().toUpperCase() ?? "";
  return firstLine === "NOTE"
    || firstLine.startsWith("NOTE ")
    || firstLine === "STYLE"
    || firstLine.startsWith("STYLE ")
    || firstLine === "REGION"
    || firstLine.startsWith("REGION ");
};

/** Parse the common SRT and WebVTT cue formats into scene-relative seconds. */
export const parseSubtitleFileText = (source: string): ImportedSubtitleCue[] => {
  const normalizedSource = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const blocks = normalizedSource
    .split(/\n\s*\n/)
    .map((block) => block.split("\n"))
    .filter((block) => block.some((line) => line.trim()));
  const cues: ImportedSubtitleCue[] = [];

  for (const block of blocks) {
    if (isMetadataBlock(block)) continue;
    const timingIndex = block.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const timing = block[timingIndex]?.split("-->") ?? [];
    if (timing.length !== 2) continue;
    const start = parseSubtitleTimestamp(timing[0] ?? "");
    const end = parseSubtitleTimestamp((timing[1] ?? "").trim().split(/\s+/)[0] ?? "");
    if (start === null || end === null || end <= start) continue;
    const text = cleanSubtitleText(block.slice(timingIndex + 1));
    if (!text) continue;
    cues.push({ text, start, end });
  }

  return cues.sort((left, right) => left.start - right.start);
};
