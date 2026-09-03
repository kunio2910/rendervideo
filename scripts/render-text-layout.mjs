import sharp from "sharp";

const measuredTextWidths = new Map();

const escapeXml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const measurementOptions = (options = {}) => ({
  fontCss: String(options.fontCss ?? ""),
  fontKey: String(options.fontKey ?? options.fontFamily ?? "Arial"),
  fontFamily: String(options.fontFamily ?? "Arial"),
  fontSize: Math.max(1, Number(options.fontSize) || 16),
  fontWeight: Number(options.fontWeight) >= 600 ? 700 : 400,
  fontStyle: options.fontStyle === "italic" ? "italic" : "normal",
  letterSpacing: Number(options.letterSpacing) || 0,
});

export const measureSvgTextWidth = async (value, options = {}) => {
  const text = String(value ?? "");
  if (!text) return 0;
  const normalized = measurementOptions(options);
  const cacheKey = JSON.stringify([
    normalized.fontKey,
    normalized.fontSize,
    normalized.fontWeight,
    normalized.fontStyle,
    normalized.letterSpacing,
    text,
  ]);
  const cached = measuredTextWidths.get(cacheKey);
  if (cached !== undefined) return cached;

  const margin = Math.max(8, Math.ceil(normalized.fontSize * 1.5));
  const estimatedWidth = Math.ceil(
    text.length * (normalized.fontSize + Math.abs(normalized.letterSpacing)) + margin * 2,
  );
  const canvasWidth = Math.min(32768, Math.max(128, estimatedWidth));
  const canvasHeight = Math.max(64, Math.ceil(normalized.fontSize * 4 + margin * 2));
  const baseline = margin + normalized.fontSize * 1.4;
  const svg = Buffer.from(`
    <svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
      <style>${normalized.fontCss}</style>
      <text x="${margin}" y="${baseline}" font-family="${escapeXml(normalized.fontFamily)}" font-size="${normalized.fontSize}" font-weight="${normalized.fontWeight}" font-style="${normalized.fontStyle}" letter-spacing="${normalized.letterSpacing}">${escapeXml(text)}</text>
    </svg>
  `);
  const { info } = await sharp(svg).trim().png().toBuffer({ resolveWithObject: true });
  const width = Math.max(0, Number(info.width) || 0);
  measuredTextWidths.set(cacheKey, width);
  return width;
};

const splitOversizedWord = async (word, maxWidth, options) => {
  const graphemes = Array.from(word);
  const parts = [];
  let part = "";
  for (const grapheme of graphemes) {
    const candidate = `${part}${grapheme}`;
    if (part && await measureSvgTextWidth(candidate, options) > maxWidth) {
      parts.push(part);
      part = grapheme;
    } else {
      part = candidate;
    }
  }
  if (part) parts.push(part);
  return parts;
};

export const wrapTextByPixelWidth = async (value, maxWidth, options = {}) => {
  const safeWidth = Math.max(1, Number(maxWidth) || 1);
  const paragraphs = String(value ?? "").split(/\r?\n/);
  const lines = [];
  for (const paragraphValue of paragraphs) {
    const words = paragraphValue.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const originalWord of words) {
      const wordParts = await measureSvgTextWidth(originalWord, options) > safeWidth
        ? await splitOversizedWord(originalWord, safeWidth, options)
        : [originalWord];
      for (const word of wordParts) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && await measureSvgTextWidth(candidate, options) > safeWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
};
