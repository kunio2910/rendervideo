export type ImportedSubtitleCue = {
  text: string;
  start: number;
  end: number;
};

export type SubtitleSplitOptions = {
  maxCharsPerLine?: number;
  maxLines?: number;
  minCueDuration?: number;
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

const splitWordsByLength = (text: string, maxChars: number) => {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxChars) {
      chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
};

const mergeSubtitleChunks = (chunks: string[], maximum: number) => {
  if (chunks.length <= maximum) return chunks;
  const merged: string[] = [];
  const groupSize = Math.ceil(chunks.length / maximum);
  for (let index = 0; index < chunks.length; index += groupSize) {
    merged.push(chunks.slice(index, index + groupSize).join(" "));
  }
  return merged.slice(0, maximum);
};

/**
 * Split long imported cues while keeping every generated cue inside the
 * original SRT time range. This lets the small Video-tab review avoid
 * clipping a long sentence and makes the next text change with audio time.
 */
export const splitSubtitleCues = (
  cues: ImportedSubtitleCue[],
  options: SubtitleSplitOptions = {},
): ImportedSubtitleCue[] => {
  const maxCharsPerLine = Math.max(8, Math.round(options.maxCharsPerLine ?? 32));
  const maxLines = Math.max(1, Math.round(options.maxLines ?? 2));
  const maxCharsPerCue = Math.max(maxCharsPerLine, maxCharsPerLine * maxLines);
  const minCueDuration = Math.max(0.1, options.minCueDuration ?? 0.55);

  return cues.flatMap((cue) => {
    const text = cue.text.replace(/\s+/g, " ").trim();
    const duration = Math.max(0.05, cue.end - cue.start);
    if (!text) return [];

    const chunks = splitWordsByLength(text, maxCharsPerCue);
    const maximumChunks = Math.max(1, Math.floor(duration / minCueDuration));
    const safeChunks = mergeSubtitleChunks(chunks.length ? chunks : [text], maximumChunks);
    if (safeChunks.length === 1) {
      return [{ ...cue, text: safeChunks[0] }];
    }

    const totalWeight = safeChunks.reduce((total, chunk) => total + Math.max(1, chunk.length), 0);
    let elapsed = 0;
    return safeChunks.map((chunk, index) => {
      const start = index === 0 ? cue.start : cue.start + elapsed;
      elapsed += duration * (Math.max(1, chunk.length) / totalWeight);
      const end = index === safeChunks.length - 1
        ? cue.end
        : Math.min(cue.end, cue.start + elapsed);
      return { text: chunk, start, end };
    });
  });
};
