import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { processSpriteSheetBuffer } from "./sprite-sheet.mjs";

const [jsonPath, outputPath] = process.argv.slice(2);
if (!jsonPath || !outputPath) {
  throw new Error("Usage: node scripts/render-video.mjs <project.json> <output.mp4>");
}

const root = process.cwd();
const defaultSourceDir = path.join(root, "source");
const sourceDir = process.env.RENDER_SOURCE_DIR
  ? path.resolve(process.env.RENDER_SOURCE_DIR)
  : defaultSourceDir;
const renderDir = process.env.RENDER_WORK_DIR
  ? path.resolve(process.env.RENDER_WORK_DIR)
  : path.join(root, "work", "render-current");
const bundledFfmpeg = path.join(root, ".local-renderer", "ffmpeg", "bin", "ffmpeg.exe");
const ffmpeg = process.env.FFMPEG_PATH || bundledFfmpeg;
const project = JSON.parse(await fs.readFile(jsonPath, "utf8"));
const sourceScenes = Array.isArray(project.scenes) ? project.scenes : [];
let renderCursor = 0;
const scenes = sourceScenes
  .filter((scene) => scene?.sceneVisible !== false)
  .map((scene) => {
    const sourceDuration = Number(scene.end ?? 0) - Number(scene.start ?? 0);
    const duration = Math.max(0.1, Number.isFinite(sourceDuration) ? sourceDuration : 0.1);
    const renderedScene = {
      ...scene,
      start: Number(renderCursor.toFixed(2)),
      end: Number((renderCursor + duration).toFixed(2)),
    };
    renderCursor += duration;
    return renderedScene;
  });
if (!scenes.length) {
  throw new Error("Không có cảnh đang hiện để render.");
}
const timelineDuration = Math.max(
  0.1,
  ...scenes.map((scene) => Number(scene.end ?? 0) || 0),
);
const aspectRatio = project.aspectRatio === "16:9" ? "16:9" : "9:16";
const defaultResolution = aspectRatio === "16:9" ? "1920x1080" : "1080x1920";
const requestedResolution = String(project.resolution ?? defaultResolution).split("x");
let outputWidth = Math.max(1, Number.parseInt(requestedResolution[0], 10) || 1);
let outputHeight = Math.max(1, Number.parseInt(requestedResolution[1], 10) || 1);
const resolutionMatchesAspect = aspectRatio === "16:9"
  ? outputWidth >= outputHeight
  : outputWidth <= outputHeight;
if (!resolutionMatchesAspect) {
  [outputWidth, outputHeight] = defaultResolution
    .split("x")
    .map((value) => Math.max(1, Number.parseInt(value, 10) || 1));
}
const fps = Math.max(1, Number(project.fps ?? 30) || 30);
const PREVIEW_REFERENCE_WIDTH = 472;
const PREVIEW_REFERENCE_HEIGHT = PREVIEW_REFERENCE_WIDTH * 16 / 9;
const PREVIEW_CANVAS_WIDTH = aspectRatio === "16:9" ? 528 : 360;
const PREVIEW_CANVAS_HEIGHT = aspectRatio === "16:9" ? 297 : 640;
const previewScale = Math.min(
  outputWidth / PREVIEW_CANVAS_WIDTH,
  outputHeight / PREVIEW_CANVAS_HEIGHT,
);
const previewPx = (value) => value * previewScale;
const animatedStickerSize = Math.max(1, Math.round(previewPx(220)));
const ffmpegMediaFit = (width, height, fit = "cover") => fit === "contain"
  ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0`
  : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const normalizeSceneEffects = (value) => {
  const raw = value && typeof value === "object" ? value : {};
  return {
    snowEnabled: raw.snowEnabled === true,
    snowIntensity: clamp(Number(raw.snowIntensity ?? 55) || 55, 0, 100),
    snowSpeed: clamp(Number(raw.snowSpeed ?? 1) || 1, 0.2, 3),
    lightFlickerEnabled: raw.lightFlickerEnabled === true,
    lightFlickerIntensity: clamp(Number(raw.lightFlickerIntensity ?? 45) || 45, 0, 100),
    lightFlickerSpeed: clamp(Number(raw.lightFlickerSpeed ?? 1) || 1, 0.2, 3),
    rainEnabled: raw.rainEnabled === true,
    rainIntensity: clamp(Number(raw.rainIntensity ?? 55) || 55, 0, 100),
    rainSpeed: clamp(Number(raw.rainSpeed ?? 1) || 1, 0.2, 3),
    thunderEnabled: raw.thunderEnabled === true,
    thunderIntensity: clamp(Number(raw.thunderIntensity ?? 55) || 55, 0, 100),
    thunderSpeed: clamp(Number(raw.thunderSpeed ?? 1) || 1, 0.2, 3),
    cloudEnabled: raw.cloudEnabled === true,
    cloudIntensity: clamp(Number(raw.cloudIntensity ?? 50) || 50, 0, 100),
    cloudSpeed: clamp(Number(raw.cloudSpeed ?? 1) || 1, 0.2, 3),
  };
};
const popupPixelHeight = (scene) => Math.min(
  Math.round(previewPx(clamp(Number(scene.popupHeight ?? 255), 170, 440))),
  Math.round(outputHeight * 0.88),
);
const popupEntriesForScene = (scene) => {
  if (Array.isArray(scene.popups)) {
    return scene.popups.map((popup, index) => ({
      ...scene,
      ...popup,
      title: String(popup.title ?? ""),
      body: String(popup.body ?? popup.content ?? popup.popup ?? ""),
      narration: String(popup.narration ?? popup.voiceover ?? ""),
      image: String(popup.image ?? ""),
      popupVideo: String(popup.video ?? popup.popupVideo ?? ""),
      popupStart: Number(popup.start ?? popup.popupStart ?? 0),
      popupDuration: Number(popup.duration ?? popup.popupDuration ?? 3),
      popupIn: popup.in ?? popup.popupIn ?? "fade-slide-up",
      popupOut: popup.out ?? popup.popupOut ?? "fade-slide-down",
      popupWidth: popup.width ?? popup.popupWidth ?? 90,
      popupHeight: popup.height ?? popup.popupHeight ?? 255,
      popupBorderWidth: popup.borderWidth ?? popup.popupBorderWidth ?? scene.popupBorderWidth ?? 1,
      popupLayout: popup.layout ?? popup.popupLayout ?? "image-top",
      popupTheme: popup.theme ?? popup.popupTheme ?? "travel",
      popupTextEffect: popup.textEffect ?? popup.popupTextEffect ?? "none",
      popupX: popup.x ?? popup.popupX ?? 5,
      popupY: popup.y ?? popup.popupY ?? 55,
      popupVisible: popup.visible !== false,
      imageVisible: popup.imageVisible !== false,
      popupTransparentMedia: popup.transparentMedia === true || popup.popupTransparentMedia === true || scene.popupTransparentMedia === true,
      popupIndex: index,
    }));
  }
  return [{
    ...scene,
    title: String(scene.title ?? ""),
    body: String(scene.body ?? scene.popup ?? ""),
    narration: String(scene.narration ?? ""),
    popupBorderWidth: Number(scene.popupBorderWidth ?? 1),
    popupIndex: 0,
  }];
};
const isVideoMedia = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /\.(mp4|webm|mov|m4v|ogv|avi|mkv)(?:[?#].*)?$/.test(normalized)
    || /\/video\/upload\//.test(normalized)
    || /[?&](?:format|fm)=(?:mp4|webm|mov|m4v)/.test(normalized);
};

const isAnimatedImageMedia = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /\.(gif|apng)(?:[?#].*)?$/.test(normalized)
    || /[?&](?:format|fm)=(?:gif|apng)/.test(normalized);
};

const animatedAssetType = (value, fallback = "gif") => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (/\.webm(?:[?#].*)?$/.test(normalized) || /[?&](?:format|fm)=webm/.test(normalized)) return "webm";
  if (/\.apng(?:[?#].*)?$/.test(normalized) || /[?&](?:format|fm)=apng/.test(normalized)) return "apng";
  return fallback;
};
// Legacy scene fields remain supported: scene.popupLayout, scene.popupX, scene.popupY.
const audioVolume = (value, fallback) => {
  const numeric = Number(value);
  return clamp(Number.isFinite(numeric) ? numeric : fallback, 0, 100) / 100;
};

await fs.rm(renderDir, { recursive: true, force: true });
await fs.mkdir(renderDir, { recursive: true });
await fs.mkdir(path.dirname(outputPath), { recursive: true });

const escapeXml = (value = "") =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const escapeDrawtext = (value = "") => String(value)
  .replaceAll("\\", "\\\\")
  .replaceAll("'", "\\'")
  .replaceAll(":", "\\:")
  .replaceAll("%", "\\%")
  .replace(/\r?\n/g, "\\n");

const wrap = (value = "", max = 42) => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines;
};

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}`)),
    );
  });

const concatFileEntry = (filePath) => `file '${String(filePath).replaceAll("'", "'\\''")}'`;

const writeRawFrameSequence = async (frames, frameWidth, frameHeight, delays, sequenceName) => {
  if (!frames.length) throw new Error("Sprite không có frame để render");
  const framesRoot = path.join(renderDir, sequenceName);
  await fs.mkdir(framesRoot, { recursive: true });
  const framePaths = [];
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const framePath = path.join(framesRoot, `frame-${String(frameIndex + 1).padStart(3, "0")}.png`);
    await sharp(frames[frameIndex], {
      raw: { width: frameWidth, height: frameHeight, channels: 4 },
    }).png().toFile(framePath);
    framePaths.push(framePath);
  }
  const concatPath = path.join(renderDir, `${sequenceName}.txt`);
  const entries = framePaths.flatMap((framePath, frameIndex) => [
    concatFileEntry(framePath),
    `duration ${(Math.max(60, Number(delays[frameIndex]) || 180) / 1000).toFixed(3)}`,
  ]);
  // The concat demuxer uses the next file to determine the duration of the
  // previous one, so repeat the last frame to preserve its duration.
  entries.push(concatFileEntry(framePaths[framePaths.length - 1]));
  await fs.writeFile(concatPath, `${entries.join("\n")}\n`, "utf8");
  return concatPath;
};

const writeSpriteFrameSequence = async (frames, frameSize, delay, index) =>
  writeRawFrameSequence(
    frames,
    frameSize,
    frameSize,
    frames.map(() => delay),
    `scene-image-${index + 1}-frames`,
  );

const writeAnimatedWebpFrameSequence = async (source, metadata, index) => {
  const frameWidth = Math.max(1, Number(metadata.width) || 1);
  const frameHeight = Math.max(1, Number(metadata.pageHeight) || Number(metadata.height) || 1);
  const pageCount = Math.max(1, Number(metadata.pages) || Math.floor(Number(metadata.height) / frameHeight) || 1);
  const rawResult = await sharp(source, { animated: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const frameBytes = frameWidth * frameHeight * rawResult.info.channels;
  if (rawResult.data.length < frameBytes * pageCount) {
    throw new Error("Không thể đọc đủ frame của WebP động");
  }
  const frames = Array.from({ length: pageCount }, (_, frameIndex) => (
    rawResult.data.subarray(frameIndex * frameBytes, (frameIndex + 1) * frameBytes)
  ));
  const sourceDelays = Array.isArray(metadata.delay) ? metadata.delay : [];
  const delays = frames.map((_, frameIndex) => Number(sourceDelays[frameIndex] ?? sourceDelays[0] ?? 180));
  return writeRawFrameSequence(
    frames,
    frameWidth,
    frameHeight,
    delays,
    `scene-image-${index + 1}-webp-frames`,
  );
};

const errorDetail = (error) => {
  if (!(error instanceof Error)) return "unknown error";
  const cause = error.cause instanceof Error ? error.cause.message : "";
  return cause ? `${error.message}: ${cause}` : error.message;
};

const resourceCache = new Map();

const isRemote = (value) => /^https?:\/\//i.test(String(value ?? "").trim());

const referenceName = (value, fallbackName) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return fallbackName;
  if (isRemote(trimmed)) {
    try {
      const name = path.basename(decodeURIComponent(new URL(trimmed).pathname));
      if (name && name !== ".") return name;
    } catch {}
  }
  return path.basename(trimmed.replaceAll("\\", "/")) || fallbackName;
};

const resourceKey = (kind, value, fallbackName) => {
  const trimmed = String(value ?? "").trim();
  const name = referenceName(trimmed, fallbackName).toLowerCase();
  // Reuse a resource when scenes refer to the same filename.
  if (name && name !== fallbackName.toLowerCase()) return `${kind}:name:${name}`;
  return `${kind}:url:${trimmed}`;
};

const download = async (url, filename) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Cannot download ${url}: ${response.status}`);
    await fs.writeFile(filename, Buffer.from(await response.arrayBuffer()));
    return filename;
  } finally {
    clearTimeout(timeout);
  }
};

const downloadResource = async (kind, value, fallbackName) => {
  const trimmed = String(value ?? "").trim();
  const key = resourceKey(kind, trimmed, fallbackName);
  const cached = resourceCache.get(key);
  if (cached) return cached;
  const promise = (async () => {
    const sourceName = referenceName(trimmed, fallbackName);
    const safeName = sourceName.replace(/[^a-z0-9._-]+/gi, "-");
    const hash = createHash("sha1").update(key).digest("hex").slice(0, 10);
    return download(trimmed, path.join(renderDir, `${kind}-${hash}-${safeName}`));
  })();
  resourceCache.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    resourceCache.delete(key);
    throw error;
  }
};

const findLocalResource = async (kind, value, candidates) => {
  const trimmed = String(value ?? "").trim();
  const key = resourceKey(kind, trimmed, path.basename(trimmed) || kind);
  const cached = resourceCache.get(key);
  if (cached) return cached;
  const promise = (async () => {
    for (const candidate of candidates.filter(Boolean)) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {}
    }
    return null;
  })();
  resourceCache.set(key, promise);
  return promise;
};

const localCandidates = (value) => [
  path.resolve(root, value),
  path.join(sourceDir, path.basename(value)),
  path.join(defaultSourceDir, path.basename(value)),
];

const resolveImage = async (value, fallbackName, required = false) => {
  if (!value) return null;
  if (isRemote(value)) {
    try {
      return await downloadResource("image", value, fallbackName);
    } catch (error) {
      if (required) {
        throw new Error(`Không thể tải ảnh background từ URL: ${errorDetail(error)}`);
      }
      return null;
    }
  }
  const local = await findLocalResource("image", value, localCandidates(value));
  if (!local && required) throw new Error(`Không tìm thấy ảnh background: ${value}`);
  return local;
};

const resolveVoice = async (scene, index) => {
  const value = String(scene.voiceFile ?? "").trim();
  if (!value) return null;
  if (value && isRemote(value)) {
    try {
      return await downloadResource("audio", value, `scene-${index + 1}-voice.mp3`);
    } catch (error) {
      throw new Error(`Không thể tải âm thanh cảnh ${index + 1} từ URL: ${errorDetail(error)}`);
    }
  }
  const candidates = [
    path.resolve(root, value),
    path.join(sourceDir, path.basename(value)),
    path.join(defaultSourceDir, path.basename(value)),
  ].filter(Boolean);
  return findLocalResource("audio", value, candidates);
};

const resolveAudio = async (value, required = false) => {
  if (!value) return null;
  if (isRemote(value)) {
    try {
      return await downloadResource("audio", value, "track.mp3");
    } catch (error) {
      if (required) {
        throw new Error(`Không thể tải nhạc nền từ URL: ${errorDetail(error)}`);
      }
      return null;
    }
  }
  return findLocalResource("audio", value, localCandidates(value));
};

const resolveVideo = async (value, fallbackName, required = false) => {
  if (!value) return null;
  if (isRemote(value)) {
    try {
      return await downloadResource("video", value, fallbackName);
    } catch (error) {
      if (required) throw new Error(`KhÃ´ng thá»ƒ táº£i video popup tá»« URL: ${errorDetail(error)}`);
      return null;
    }
  }
  const local = await findLocalResource("video", value, localCandidates(value));
  if (!local && required) throw new Error(`KhÃ´ng tÃ¬m tháº¥y video popup: ${value}`);
  return local;
};

const resolveBackground = async (value, fallbackName, required = false) =>
  isVideoMedia(value)
    ? resolveVideo(value, `${fallbackName}.mp4`, required)
    : resolveImage(value, fallbackName, required);

const createPopup = async (scene, index) => {
  const titleValue = String(scene.title ?? "").trim();
  const bodyValue = String(scene.body ?? scene.popup ?? "").trim();
  const imageValue = String(scene.image ?? "").trim();
  const imageVisible = scene.imageVisible !== false && Boolean(imageValue);
  const videoValue = String(scene.popupVideo ?? "").trim();
  const hasVisualInput = Boolean((imageVisible && imageValue) || videoValue);
  const requestedLayout = scene.popupLayout ?? "image-top";
  const imageOnly = requestedLayout === "image-only";
  const contentOnly = requestedLayout === "content-only";
  const hasText = Boolean(titleValue || bodyValue);
  const showVisual = !contentOnly && hasVisualInput;
  const showText = !imageOnly && hasText;
  const transparentMedia = scene.popupTransparentMedia === true && showVisual;
  const transparentMediaOnly = transparentMedia && !showText;
  if (!showText && !showVisual) return null;
  const width = Math.round(outputWidth * clamp((scene.popupWidth ?? 90) / 100, 0.45, 1));
  const height = popupPixelHeight(scene);
  const radius = Math.max(10, Math.round(previewPx(14)));
  const borderWidth = Math.max(0, Math.round(previewPx(clamp(Number(scene.popupBorderWidth ?? 1), 0, 12))));
  const paddingX = Math.round(previewPx(15));
  const titleFontSize = Math.round(previewPx(15));
  const bodyFontSize = Math.round(previewPx(11));
  const bodyLineHeight = Math.round(previewPx(18.15));
  const layout = imageOnly
    ? "image-top"
    : contentOnly
      ? "content-only"
      : !hasText && hasVisualInput ? "image-top" : requestedLayout;
  const colors = {
    travel: { background: "#262118", title: "#fff3d6", body: "#e9ddc7", border: "#aa772c", accent: "#dda13e" },
    sunset: { background: "#3d1d2b", title: "#fff2e5", body: "#ffd1bd", border: "#ef8354", accent: "#ffb26b" },
    ocean: { background: "#122b3b", title: "#e8fbff", body: "#b9e9f4", border: "#39c5d8", accent: "#65d7e8" },
    minimal: { background: "#fbfaf7", title: "#2d2a26", body: "#5b554d", border: "#9b7d5d", accent: "#9b7d5d" },
  }[scene.popupTheme ?? "travel"] ?? { background: "#262118", title: "#fff3d6", body: "#e9ddc7", border: "#aa772c", accent: "#dda13e" };
  const image = showVisual && imageVisible ? await resolveImage(imageValue, `scene-${index + 1}-image`) : null;
  const video = showVisual && layout !== "quote" && videoValue
    ? await resolveVideo(videoValue, `scene-${index + 1}-popup.mp4`)
    : null;
  const hasVisual = showVisual && Boolean((imageVisible && imageValue) || videoValue);
  const split = layout === "split";
  const imageWidth = split ? Math.round(width * 0.42) : width;
  const imageHeight = layout === "quote"
    ? 0
    : split
      ? height
      : hasVisual
        ? imageOnly
          ? height
          : Math.round(previewPx(115))
        : 0;
  const contentX = split ? imageWidth + paddingX : paddingX;
  const contentWidth = split ? width - imageWidth - paddingX * 2 : width - paddingX * 2;
  const titleY = layout === "quote"
    ? Math.round(previewPx(56))
    : imageHeight + Math.round(previewPx(layout === "stats" ? 33 : 33));
  const bodyY = titleY + Math.round(previewPx(layout === "quote" ? 33 : 24));
  const maxCharacters = Math.max(24, Math.floor(contentWidth / Math.max(1, bodyFontSize * 0.54)));
  const maxBodyLines = Math.max(1, Math.floor((height - bodyY - previewPx(15)) / bodyLineHeight) + 1);
  const bodyLines = wrap(showText ? scene.body ?? scene.popup ?? "" : "", maxCharacters).slice(0, maxBodyLines);
  const bodyText = bodyLines.map((line, lineIndex) =>
    `<text x="${contentX}" y="${bodyY + lineIndex * bodyLineHeight}" font-size="${bodyFontSize}" fill="${colors.body}">${escapeXml(line)}</text>`,
  ).join("");
  const imageClipPath = split
    ? `M ${radius} 0 H ${imageWidth} V ${height} H ${radius} Q 0 ${height} 0 ${height - radius} V ${radius} Q 0 0 ${radius} 0 Z`
    : `M ${radius} 0 H ${width - radius} Q ${width} 0 ${width} ${radius} V ${imageHeight} H 0 V ${radius} Q 0 0 ${radius} 0 Z`;
  const placeholder = split
    ? `<rect width="${imageWidth}" height="${height}" fill="url(#placeholderSky)"/>`
    : `<rect width="${width}" height="${imageHeight}" fill="url(#placeholderSky)"/>`;
  const cardBackground = transparentMediaOnly
    ? ""
    : `<rect x="${borderWidth / 2}" y="${borderWidth / 2}" width="${width - borderWidth}" height="${height - borderWidth}" rx="${radius}" fill="${colors.background}" fill-opacity=".96"/>`;
  const quoteMark = showText && layout === "quote"
    ? `<text x="${contentX}" y="${Math.round(previewPx(38))}" font-family="Georgia" font-weight="700" font-size="${Math.round(previewPx(40))}" fill="${colors.accent}">“</text>`
    : "";
  const statRow = showText && layout === "stats"
    ? `<text x="${contentX}" y="${Math.round(previewPx(19))}" font-family="Arial" font-weight="700" font-size="${Math.round(previewPx(8))}" letter-spacing="2" fill="${colors.accent}">${escapeXml(String(scene.location || "HÀNH TRÌNH").toUpperCase())}</text><text x="${width - paddingX}" y="${Math.round(previewPx(25))}" text-anchor="end" font-family="Arial" font-weight="700" font-size="${Math.round(previewPx(17))}" fill="${colors.accent}">${escapeXml(String(scene.milestone ?? index + 1).padStart(2, "0"))}</text>`
    : "";
  const svg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="placeholderSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#c9e4f5"/><stop offset="100%" stop-color="#f6d8af"/></linearGradient>
        <clipPath id="imageClip"><path d="${imageClipPath}"/></clipPath>
      </defs>
      ${cardBackground}
      ${hasVisual && !image && !video && layout !== "quote" ? `<g clip-path="url(#imageClip)">${placeholder}<circle cx="${width * 0.78}" cy="${previewPx(30)}" r="${previewPx(14)}" fill="#ffe1a3"/><ellipse cx="${width * 0.25}" cy="${imageHeight + previewPx(22)}" rx="${width * 0.48}" ry="${previewPx(48)}" fill="#769b79"/><ellipse cx="${width * 0.82}" cy="${imageHeight + previewPx(28)}" rx="${width * 0.44}" ry="${previewPx(52)}" fill="#557c64"/></g>` : ""}
      ${quoteMark}${statRow}
      <text x="${contentX}" y="${titleY}" font-family="Arial, sans-serif" font-weight="700" font-size="${titleFontSize}" fill="${colors.title}">${escapeXml(showText ? titleValue.toUpperCase() : "")}</text>
      <g font-family="Arial">${bodyText}</g>
    </svg>
  `);
  const base = sharp(svg);
  const composites = [];
  if (image && imageHeight > 0) {
    const mask = Buffer.from(`<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg"><path d="${imageClipPath}" fill="#fff"/></svg>`);
    const resized = await sharp(image).resize(imageWidth, imageHeight, { fit: "cover" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
    composites.push({ input: resized, top: 0, left: 0 });
  }
  const border = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="${borderWidth / 2}" y="${borderWidth / 2}" width="${width - borderWidth}" height="${height - borderWidth}" rx="${radius}" fill="none" stroke="${colors.border}" stroke-width="${borderWidth}"/></svg>`);
  composites.push({ input: border, top: 0, left: 0 });
  const filename = path.join(renderDir, `popup-${index + 1}.png`);
  await base.composite(composites).png().toFile(filename);
  const borderFilename = path.join(renderDir, `popup-${index + 1}-border.png`);
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: border, top: 0, left: 0 }]).png().toFile(borderFilename);
  return {
    path: filename,
    borderPath: borderFilename,
    video,
    videoWidth: imageWidth,
    videoHeight: imageHeight,
  };
};

const decorationColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value ?? ""))
  ? String(value)
  : fallback;

const decorationGlyph = (decoration) => {
  if (decoration.type === "effect") {
    return {
      sparkles: "✦",
      ring: "◉",
      confetti: "✺",
      glow: "✧",
    }[decoration.effect] ?? "✦";
  }
  return String(decoration.symbol ?? "✦").trim() || "✦";
};

const createMapDecoration = async (decoration, index) => {
  const type = ["text-3d", "sticker", "icon", "effect", "animated-sticker"].includes(String(decoration?.type))
    ? String(decoration.type)
    : "text-3d";
  const asset = String(decoration?.asset ?? "").trim();
  if (type === "animated-sticker") {
    const kind = animatedAssetType(asset, String(decoration?.assetType ?? "gif"));
    const media = kind === "webm"
      ? await resolveVideo(asset, `decoration-${index + 1}.webm`)
      : await resolveImage(asset, `decoration-${index + 1}.${kind}`);
    if (!media) return null;
    return { path: media, animated: true, mediaType: kind };
  }
  if (type === "sticker") {
    const image = await resolveImage(asset, `decoration-${index + 1}-sticker`);
    if (!image) return null;
    const filename = path.join(renderDir, `decoration-${index + 1}.png`);
    await sharp(image)
      .resize({ width: Math.round(previewPx(180)), height: Math.round(previewPx(180)), fit: "inside" })
      .png()
      .toFile(filename);
    return { path: filename };
  }
  const size = Math.round(previewPx(clamp(Number(decoration?.size ?? (type === "text-3d" ? 48 : 64)), 14, 120)));
  const depth = Math.round(previewPx(clamp(Number(decoration?.depth ?? 5), 0, 16)));
  const color = decorationColor(decoration?.color, "#ffd166");
  const accentColor = decorationColor(decoration?.accentColor, "#7c3aed");
  const text = type === "text-3d" ? String(decoration?.text ?? "").trim() : decorationGlyph({
    ...decoration,
    type,
  });
  if (!text) return null;
  const fontSize = type === "text-3d" ? size : Math.round(size * 1.05);
  const width = type === "text-3d"
    ? Math.max(Math.round(previewPx(50)), Math.ceil(text.length * fontSize * 0.62 + depth + previewPx(18)))
    : Math.max(Math.round(previewPx(44)), Math.ceil(fontSize + depth * 2));
  const height = Math.max(Math.round(previewPx(44)), fontSize + depth + Math.round(previewPx(18)));
  const layers = Array.from({ length: depth }, (_, layerIndex) => {
    const offset = depth - layerIndex;
    return `<text x="${width / 2 + offset}" y="${height / 2 + fontSize * 0.35 + offset}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="${fontSize}" fill="${accentColor}">${escapeXml(text)}</text>`;
  }).join("");
  const svg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${layers}
      <text x="${width / 2}" y="${height / 2 + fontSize * 0.35}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="${fontSize}" fill="${color}">${escapeXml(text)}</text>
    </svg>
  `);
  const filename = path.join(renderDir, `decoration-${index + 1}.png`);
  await sharp(svg).png().toFile(filename);
  return { path: filename };
};

const sceneImageGeometry = (shape, width, height) => {
  const normalized = ["rectangle", "square", "circle", "triangle", "diamond"].includes(String(shape))
    ? String(shape)
    : "rectangle";
  if (normalized === "circle") {
    return { clip: `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${Math.max(1, width / 2 - 1)}" ry="${Math.max(1, height / 2 - 1)}"/>`, kind: "ellipse" };
  }
  if (normalized === "triangle") {
    return { clip: `<polygon points="${width / 2},1 ${Math.max(1, width - 1)},${Math.max(1, height - 1)} 1,${Math.max(1, height - 1)}"/>`, kind: "polygon" };
  }
  if (normalized === "diamond") {
    return { clip: `<polygon points="${width / 2},1 ${Math.max(1, width - 1)},${height / 2} ${width / 2},${Math.max(1, height - 1)} 1,${height / 2}"/>`, kind: "polygon" };
  }
  return { clip: `<rect x="1" y="1" width="${Math.max(1, width - 2)}" height="${Math.max(1, height - 2)}"/>`, kind: "rect" };
};

const createSceneImage = async (image, index) => {
  const url = String(image?.url ?? image?.asset ?? "").trim();
  if (!url || image?.visible === false) return null;
  const shape = String(image?.shape ?? "rectangle");
  const requestedWidth = clamp(Number(image?.width ?? 42) / 100, 0.01, 2);
  const requestedHeight = clamp(Number(image?.height ?? 28) / 100, 0.01, 2);
  const widthRatio = shape === "square" ? Math.min(requestedWidth, requestedHeight) : requestedWidth;
  const heightRatio = shape === "square" ? Math.min(requestedWidth, requestedHeight) : requestedHeight;
  const width = Math.max(16, Math.round(outputWidth * widthRatio));
  const height = Math.max(16, Math.round(outputHeight * heightRatio));
  const geometry = sceneImageGeometry(shape, width, height);
  const maskSvg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" fill="black"/><g fill="white">${geometry.clip}</g></svg>`);
  const alphaMaskSvg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><g fill="white">${geometry.clip}</g></svg>`);
  const borderWidth = Math.max(0, Math.round(previewPx(Number(image?.borderWidth ?? 0))));
  const borderColor = decorationColor(image?.borderColor, "#ffffff");
  const borderSvg = borderWidth > 0
    ? Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="${borderColor}" stroke-width="${borderWidth}">${geometry.clip}</g></svg>`)
    : null;
  const mediaType = image?.mediaType === "video" || isVideoMedia(url) ? "video" : "image";
  const animatedImage = mediaType === "image" && isAnimatedImageMedia(url);
  if (mediaType === "video" || animatedImage) {
    // GIF/APNG must stay as animated inputs. Sharp would otherwise decode only
    // the first frame, which made the render differ from the browser preview.
    const animatedMedia = mediaType === "video"
      ? await resolveVideo(url, `scene-image-${index + 1}.webm`)
      : await resolveImage(url, `scene-image-${index + 1}.${animatedAssetType(url)}`);
    if (!animatedMedia) return null;
    const maskPath = path.join(renderDir, `scene-image-${index + 1}-mask.png`);
    const borderPath = borderSvg ? path.join(renderDir, `scene-image-${index + 1}-border.png`) : null;
    await sharp(maskSvg).greyscale().png().toFile(maskPath);
    if (borderSvg && borderPath) {
      await sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).composite([{ input: borderSvg }]).png().toFile(borderPath);
    }
    return { path: animatedMedia, animated: true, video: mediaType === "video", maskPath, borderPath, width, height };
  }
  const source = await resolveImage(url, `scene-image-${index + 1}`);
  if (!source) return null;
  let sourceMetadata = null;
  try {
    sourceMetadata = await sharp(source, { animated: true }).metadata();
  } catch {
    sourceMetadata = null;
  }
  const animatedWebp = mediaType === "image"
    && sourceMetadata?.format === "webp"
    && Number(sourceMetadata.pages) > 1;
  if (animatedWebp) {
    const frameSequencePath = await writeAnimatedWebpFrameSequence(source, sourceMetadata, index);
    const maskPath = path.join(renderDir, `scene-image-${index + 1}-mask.png`);
    const borderPath = borderSvg ? path.join(renderDir, `scene-image-${index + 1}-border.png`) : null;
    await sharp(maskSvg).greyscale().png().toFile(maskPath);
    if (borderSvg && borderPath) {
      await sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).composite([{ input: borderSvg }]).png().toFile(borderPath);
    }
    return {
      path: frameSequencePath,
      animated: true,
      frameSequence: true,
      webpAnimation: true,
      maskPath,
      borderPath,
      width,
      height,
    };
  }
  let spriteSheet = { detected: false };
  if (image?.spriteSheet === true) {
    try {
      spriteSheet = await processSpriteSheetBuffer(await fs.readFile(source), {
        delay: image?.spriteDelay,
        returnFrames: true,
      });
    } catch {
      // Unsupported or malformed images continue through the existing static
      // image path instead of changing the behaviour of regular media.
    }
  }
  if (spriteSheet.detected) {
    const frameSequencePath = await writeSpriteFrameSequence(
      spriteSheet.frames,
      spriteSheet.frameSize,
      spriteSheet.delay,
      index,
    );
    const maskPath = path.join(renderDir, `scene-image-${index + 1}-mask.png`);
    const borderPath = borderSvg ? path.join(renderDir, `scene-image-${index + 1}-border.png`) : null;
    await sharp(maskSvg).greyscale().png().toFile(maskPath);
    if (borderSvg && borderPath) {
      await sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).composite([{ input: borderSvg }]).png().toFile(borderPath);
    }
    return {
      path: frameSequencePath,
      animated: true,
      spriteSheet: true,
      frameSequence: true,
      maskPath,
      borderPath,
      width,
      height,
    };
  }
  const imageFit = image.transparent === true ? "contain" : "cover";
  const resized = await sharp(source)
    .resize(width, height, { fit: imageFit, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .composite([{ input: alphaMaskSvg, blend: "dest-in" }])
    .png()
    .toBuffer();
  const filename = path.join(renderDir, `scene-image-${index + 1}.png`);
  const border = borderWidth > 0 ? borderSvg : null;
  const composites = [{ input: resized, top: 0, left: 0 }];
  if (border) composites.push({ input: border, top: 0, left: 0 });
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png().toFile(filename);
  return { path: filename, width, height };
};

const createTextOverlay = async (overlay, index) => {
  const text = String(overlay?.text ?? "").trim();
  if (!text || overlay?.visible === false) return null;
  const fontOptions = ["Arial", "Verdana", "Georgia", "Tahoma", "Times New Roman", "Courier New"];
  const font = fontOptions.includes(String(overlay?.font)) ? String(overlay.font) : "Arial";
  const size = Math.round(previewPx(clamp(Number(overlay?.size ?? 24), 8, 120)));
  const strokeWidth = Math.round(previewPx(clamp(Number(overlay?.strokeWidth ?? 0), 0, 12)));
  const borderWidth = Math.round(previewPx(clamp(Number(overlay?.borderWidth ?? 0), 0, 12)));
  const textOpacity = clamp(Number(overlay?.opacity ?? 100) / 100, 0, 1);
  const borderOpacity = clamp(Number(overlay?.borderOpacity ?? 100) / 100, 0, 1);
  const color = decorationColor(overlay?.color, "#ffffff");
  const strokeColor = decorationColor(overlay?.strokeColor, "#000000");
  const borderColor = decorationColor(overlay?.borderColor, "#ffffff");
  const borderFill = decorationColor(overlay?.borderFill, "#14202e");
  const paddingX = Math.round(previewPx(9));
  const paddingY = Math.round(previewPx(5));
  const lineHeight = Math.max(Math.round(size * 1.15), Math.round(previewPx(14)));
  const requestedBoxWidth = Number(overlay?.boxWidth);
  const boxWidth = Number.isFinite(requestedBoxWidth)
    ? Math.round(outputWidth * clamp(requestedBoxWidth / 100, 0.4, 1))
    : null;
  const maxChars = boxWidth
    ? Math.max(1, Math.floor((boxWidth - paddingX * 2 - strokeWidth * 2 - borderWidth) / Math.max(1, size * 0.58)))
    : null;
  const lines = text
    .split(/\r?\n/)
    .flatMap((line) => maxChars ? (line ? wrap(line, maxChars) : [""]) : [line]);
  const longestLine = Math.max(1, ...lines.map((line) => line.length));
  const intrinsicWidth = Math.max(
    Math.round(previewPx(32)),
    Math.ceil(longestLine * size * 0.58 + paddingX * 2 + strokeWidth * 2 + borderWidth),
  );
  const width = boxWidth ?? intrinsicWidth;
  const height = Math.max(
    Math.round(previewPx(24)),
    Math.ceil(lines.length * lineHeight + paddingY * 2 + strokeWidth * 2 + borderWidth),
  );
  const radius = Math.min(
    Math.round(previewPx(clamp(Number(overlay?.borderRadius ?? 6), 0, 24))),
    Math.floor(Math.min(width, height) / 2),
  );
  const fontWeight = String(overlay?.style ?? "normal").includes("bold") ? 700 : 400;
  const fontStyle = String(overlay?.style ?? "normal").includes("italic") ? "italic" : "normal";
  const textNodes = lines.map((line, lineIndex) => {
    const y = paddingY + size * 0.86 + lineIndex * lineHeight;
    return `<text x="${width / 2}" y="${y}" text-anchor="middle" font-family="${escapeXml(font)}" font-weight="${fontWeight}" font-style="${fontStyle}" font-size="${size}" fill="${color}" fill-opacity="${textOpacity}" ${strokeWidth > 0 ? `stroke="${strokeColor}" stroke-opacity="${textOpacity}" stroke-width="${strokeWidth}" paint-order="stroke fill" stroke-linejoin="round"` : ""}>${escapeXml(line)}</text>`;
  }).join("");
  const svg = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${borderWidth / 2}" y="${borderWidth / 2}" width="${Math.max(1, width - borderWidth)}" height="${Math.max(1, height - borderWidth)}" rx="${radius}" fill="${borderFill}" fill-opacity="${borderOpacity}" stroke="${borderColor}" stroke-opacity="${borderOpacity}" stroke-width="${borderWidth}" />
      ${textNodes}
    </svg>
  `);
  const filename = path.join(renderDir, `text-overlay-${index + 1}.png`);
  await sharp(svg).png().toFile(filename);
  return { path: filename, width, height };
};

const createSubtitleOverlay = async (cue, index, subtitleStyle = {}) => {
  const text = String(cue?.text ?? "").trim();
  if (!text || cue?.visible === false) return null;
  const styleSize = clamp(Number(subtitleStyle.size ?? 22), 8, 120);
  return createTextOverlay({
    text,
    visible: true,
    size: styleSize,
    style: subtitleStyle.style ?? "bold",
    color: subtitleStyle.color ?? "#ffffff",
    opacity: subtitleStyle.opacity ?? 100,
    font: subtitleStyle.font ?? "Arial",
    strokeWidth: subtitleStyle.strokeWidth ?? 1,
    strokeColor: subtitleStyle.strokeColor ?? "#000000",
    borderWidth: subtitleStyle.borderWidth ?? 1,
  borderColor: subtitleStyle.borderColor ?? "#ffffff",
  borderOpacity: subtitleStyle.borderOpacity ?? 88,
  borderFill: subtitleStyle.borderFill ?? "#0b1220",
  borderRadius: subtitleStyle.borderRadius ?? 8,
  x: subtitleStyle.x ?? 50,
  y: subtitleStyle.y ?? 83,
  boxWidth: subtitleStyle.boxWidth ?? 84,
  }, index);
};

const hiddenBackgroundPath = path.join(renderDir, "hidden-background.png");
await sharp({
  create: {
    width: 2,
    height: 2,
    channels: 3,
    background: "#e8deca",
  },
}).png().toFile(hiddenBackgroundPath);

const needsDefaultBackground = scenes.some(
  (scene) => scene.backgroundVisible !== false && !String(scene.background ?? "").trim(),
);
const background = needsDefaultBackground && project.background
  ? await resolveBackground(project.background, "background", true)
  : null;
const backgroundPath = background ?? hiddenBackgroundPath;

const clipPaths = [];
for (let index = 0; index < scenes.length; index += 1) {
  const scene = scenes[index];
  const sceneBackground = scene.backgroundVisible === false
    ? hiddenBackgroundPath
    : String(scene.background ?? "").trim()
      ? await resolveBackground(scene.background, `scene-${index + 1}-background`, true)
      : backgroundPath;
  if (!sceneBackground) {
    throw new Error(`Không tìm thấy background cho cảnh ${index + 1}: ${scene.background || "map.png"}`);
  }
  const end = scenes[index + 1]?.start ?? timelineDuration;
  const duration = Math.max(0.1, end - scene.start);
  const popupScenes = popupEntriesForScene(scene)
    .filter((popupScene) => popupScene.popupVisible !== false)
    .filter((popupScene) => {
      const title = String(popupScene.title ?? "").trim();
      const body = String(popupScene.body ?? "").trim();
      const image = popupScene.imageVisible !== false && String(popupScene.image ?? "").trim();
      const video = String(popupScene.popupVideo ?? "").trim();
      const layout = popupScene.popupLayout ?? "image-top";
      const hasText = Boolean(title || body);
      const hasMedia = Boolean(image || video);
      return layout === "image-only"
        ? hasMedia
        : layout === "content-only"
          ? hasText
          : hasText || hasMedia;
    });
  const popupRenders = [];
  for (let popupIndex = 0; popupIndex < popupScenes.length; popupIndex += 1) {
    const popupScene = popupScenes[popupIndex];
    const rendered = await createPopup(popupScene, index * 100 + popupIndex);
    if (rendered) popupRenders.push({ scene: popupScene, rendered });
  }
  const decorationScenes = Array.isArray(scene.mapDecorations)
    ? scene.mapDecorations.filter((decoration) => {
        if (!decoration || decoration.visible === false) return false;
        const type = String(decoration.type ?? "text-3d");
        return type === "sticker"
          ? Boolean(String(decoration.asset ?? "").trim())
          : type === "animated-sticker"
            ? Boolean(String(decoration.asset ?? "").trim())
          : type === "text-3d"
            ? Boolean(String(decoration.text ?? "").trim())
            : Boolean(String(decoration.symbol ?? "").trim() || String(decoration.effect ?? "").trim());
      })
    : [];
  const decorationRenders = [];
  for (let decorationIndex = 0; decorationIndex < decorationScenes.length; decorationIndex += 1) {
    const decoration = decorationScenes[decorationIndex];
    const rendered = await createMapDecoration(decoration, index * 100 + decorationIndex);
    if (rendered) decorationRenders.push({ scene: decoration, rendered });
  }
  const sceneImageScenes = Array.isArray(scene.sceneImages)
    ? scene.sceneImages.filter((image) => image && image.visible !== false && String(image.url ?? image.asset ?? "").trim())
    : [];
  const sceneImageRenders = [];
  for (let imageIndex = 0; imageIndex < sceneImageScenes.length; imageIndex += 1) {
    const image = sceneImageScenes[imageIndex];
    const rendered = await createSceneImage(image, index * 100 + imageIndex);
    if (rendered) sceneImageRenders.push({ scene: image, rendered });
  }
  const voice = await resolveVoice(scene, index);
  const voiceVolume = audioVolume(scene.voiceVolume, 95);
  const clip = path.join(renderDir, `scene-${index + 1}.mp4`);
  const frames = Math.max(1, Math.round(duration * fps));
  const zoomStartFrames = Math.min(
    frames,
    Math.max(0, Math.round(Number(scene.zoomStart ?? 0) * fps)),
  );
  const zoomInFrames = Math.max(1, Math.round((scene.zoomInDuration ?? 0) * fps));
  const zoomOutFrames = Math.max(1, Math.round((scene.zoomOutDuration ?? 0) * fps));
  const zoomInEnd = Math.min(frames, zoomStartFrames + zoomInFrames);
  const zoomEndSeconds = Number(scene.zoomEnd);
  const zoomEndFrames = Math.min(
    frames,
    Math.max(
      zoomInEnd,
      Math.round((Number.isFinite(zoomEndSeconds) ? zoomEndSeconds : duration) * fps),
    ),
  );
  const zoomOutStart = Math.max(zoomInEnd, zoomEndFrames - zoomOutFrames);
  const zoomOutSpan = Math.max(1, zoomEndFrames - zoomOutStart);
  const targetZoom = scene.zoomEnabled === false
    ? 1
    : Math.min(5, Math.max(1, Number(scene.zoom ?? 1)));
  const centerX = Math.min(100, Math.max(0, Number(scene.centerX ?? 50))) / 100;
  const centerY = Math.min(100, Math.max(0, Number(scene.centerY ?? 50))) / 100;
  const zoomExpression =
    `if(lt(on,${zoomStartFrames}),1,` +
    `if(lt(on,${zoomInEnd}),1+(${targetZoom}-1)*(on-${zoomStartFrames})/${zoomInFrames},` +
    `if(lt(on,${zoomOutStart}),${targetZoom},` +
    `if(lt(on,${zoomEndFrames}),${targetZoom}-(${targetZoom}-1)*(on-${zoomOutStart})/${zoomOutSpan},1))))`;
  const legacyText = String(scene.overlayText ?? "").trim();
  const textOverlays = Array.isArray(scene.textOverlays) && scene.textOverlays.length > 0
    ? scene.textOverlays
    : legacyText
      ? [{
          text: legacyText,
          size: scene.overlayTextSize,
          style: scene.overlayTextStyle,
          color: scene.overlayTextColor,
          opacity: 100,
          font: scene.overlayTextFont,
          strokeWidth: scene.overlayTextStrokeWidth,
          strokeColor: scene.overlayTextStrokeColor,
          borderWidth: scene.overlayTextBorderWidth,
          borderColor: scene.overlayTextBorderColor,
          borderOpacity: 100,
          borderFill: "#14202e",
          x: scene.overlayTextX,
          y: scene.overlayTextY,
        }]
      : [];
  const textOverlayRenders = [];
  for (let textIndex = 0; textIndex < textOverlays.length; textIndex += 1) {
    const overlay = textOverlays[textIndex];
    const rendered = await createTextOverlay(overlay, index * 100 + textIndex);
    if (rendered) textOverlayRenders.push({ scene: overlay, rendered });
  }
  const subtitleCues = scene.subtitleEnabled !== false && Array.isArray(scene.subtitles)
    ? scene.subtitles.filter((cue) => {
        const text = String(cue?.text ?? "").trim();
        const start = Number(cue?.start);
        const end = Number(cue?.end);
        return cue?.visible !== false
          && text
          && Number.isFinite(start)
          && Number.isFinite(end)
          && end > start;
      })
    : [];
  const subtitleRenders = [];
  for (let subtitleIndex = 0; subtitleIndex < subtitleCues.length; subtitleIndex += 1) {
    const subtitle = subtitleCues[subtitleIndex];
    const rendered = await createSubtitleOverlay(
      subtitle,
      index * 100 + 50 + subtitleIndex,
      scene.subtitleStyle ?? {},
    );
    if (rendered) subtitleRenders.push({ scene: subtitle, rendered, style: scene.subtitleStyle ?? {} });
  }
  const backgroundIsVideo = isVideoMedia(sceneBackground);
  // Legacy render check: d=1,trim=duration marks the old still-frame workaround; video backgrounds now use fps + trim below.
  const backgroundFilter = backgroundIsVideo
    ? `[0:v]scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase,crop=${outputWidth}:${outputHeight},fps=${fps},trim=duration=${duration},setpts=PTS-STARTPTS,setsar=1[bg];`
    : `[0:v]scale=${outputWidth * 2}:${outputHeight * 2}:force_original_aspect_ratio=increase,crop=${outputWidth * 2}:${outputHeight * 2},` +
      `zoompan=z='${zoomExpression}':` +
      `x='iw*${centerX}*(1-1/zoom)':` +
      `y='ih*${centerY}*(1-1/zoom)':` +
      `s=${outputWidth}x${outputHeight}:fps=${fps}:d=${frames},setsar=1[bg];`;
  const popupInputCount = popupRenders.reduce(
    (total, { rendered: popup }) => total + (popup.video ? (popup.borderPath ? 3 : 2) : 1),
    0,
  );
  const weatherInputIndex = 1
    + textOverlayRenders.length
    + decorationRenders.length
    + popupInputCount
    + subtitleRenders.length;
  const weatherInputSpecs = [];
  let filter = backgroundFilter;
  let composedLabel = "[bg]";
  const sceneEffects = normalizeSceneEffects(scene.effects);
  const addWeatherOverlay = ({ source, x, y, label }) => {
    const inputIndex = weatherInputIndex + weatherInputSpecs.length;
    weatherInputSpecs.push(source);
    filter += `${composedLabel}[${inputIndex}:v]overlay=` +
      `x='${x}':y='${y}':shortest=1[${label}];`;
    composedLabel = `[${label}]`;
  };
  if (sceneEffects.lightFlickerEnabled && sceneEffects.lightFlickerIntensity > 0) {
    const lightAmplitude = (0.025 + (sceneEffects.lightFlickerIntensity / 100) * 0.17).toFixed(4);
    const lightFrequency = (2 * Math.PI * (0.55 + sceneEffects.lightFlickerSpeed * 0.8)).toFixed(5);
    filter += `${composedLabel}eq=brightness='${lightAmplitude}*sin(t*${lightFrequency})':eval=frame[lightened];`;
    composedLabel = "[lightened]";
  }
  if (sceneEffects.thunderEnabled && sceneEffects.thunderIntensity > 0) {
    const flashAmplitude = (0.08 + (sceneEffects.thunderIntensity / 100) * 0.28).toFixed(4);
    const flashFrequency = (0.75 + sceneEffects.thunderSpeed * 0.65).toFixed(4);
    filter += `${composedLabel}eq=brightness='${flashAmplitude}*if(lt(mod(t*${flashFrequency},1),0.08),1,if(lt(mod(t*${flashFrequency},1),0.16),0.24,0))':eval=frame[thundered];`;
    composedLabel = "[thundered]";
  }
  if (sceneEffects.cloudEnabled && sceneEffects.cloudIntensity > 0) {
    const cloudCount = Math.round(3 + sceneEffects.cloudIntensity / 25);
    const cloudOpacity = (0.08 + (sceneEffects.cloudIntensity / 100) * 0.32).toFixed(3);
    for (let cloudIndex = 0; cloudIndex < cloudCount; cloudIndex += 1) {
      const cloudWidth = Math.max(12, Math.round(outputWidth * (0.22 + ((cloudIndex * 19) % 28) / 100)));
      const cloudHeight = Math.max(10, Math.round(outputHeight * (0.018 + (cloudIndex % 3) * 0.006)));
      const xSeed = Math.round(outputWidth * (-0.25 + ((cloudIndex * 23) % 110) / 100));
      const ySeed = Math.round(outputHeight * (0.12 + ((cloudIndex * 17) % 45) / 100));
      const cloudSpeed = Math.max(1, Math.round(previewPx(16 + ((cloudIndex * 11) % 14)) * sceneEffects.cloudSpeed));
      addWeatherOverlay({
        source: `color=c=white@${cloudOpacity}:s=${cloudWidth}x${cloudHeight}:r=${fps}:d=${duration},format=rgba,boxblur=2:1`,
        x: `mod(${xSeed}+t*${cloudSpeed}+main_w*2,main_w+overlay_w)-overlay_w`,
        y: String(ySeed),
        label: `cloud${cloudIndex}`,
      });
    }
  }
  if (sceneEffects.rainEnabled && sceneEffects.rainIntensity > 0) {
    const rainCount = Math.round(10 + sceneEffects.rainIntensity * 0.16);
    const rainOpacity = (0.22 + (sceneEffects.rainIntensity / 100) * 0.62).toFixed(3);
    for (let rainIndex = 0; rainIndex < rainCount; rainIndex += 1) {
      const dropWidth = Math.max(1, Math.round(previewPx(1 + (rainIndex % 2))));
      const dropHeight = Math.max(6, Math.round(previewPx(14 + ((rainIndex * 11) % 18))));
      const xSeed = Math.round(outputWidth * ((rainIndex * 29) % 100) / 100);
      const ySeed = Math.round(outputHeight * (((rainIndex * 17) % 100) / 100) - dropHeight);
      const drift = -Math.round(previewPx(18 + ((rainIndex * 7) % 37)));
      const fallSpeed = Math.max(1, Math.round(previewPx(250 + ((rainIndex * 13) % 140)) * sceneEffects.rainSpeed));
      addWeatherOverlay({
        source: `color=c=white@${rainOpacity}:s=${dropWidth}x${dropHeight}:r=${fps}:d=${duration},format=rgba`,
        x: `mod(${xSeed}+t*${drift}+main_w*10,main_w-overlay_w)`,
        y: `mod(${ySeed}+t*${fallSpeed}+main_h*10,main_h-overlay_h)`,
        label: `rain${rainIndex}`,
      });
    }
  }
  if (sceneEffects.snowEnabled && sceneEffects.snowIntensity > 0) {
    const snowCount = Math.round(8 + sceneEffects.snowIntensity * 0.2);
    const snowOpacity = (0.12 + (sceneEffects.snowIntensity / 100) * 0.68).toFixed(3);
    for (let snowIndex = 0; snowIndex < snowCount; snowIndex += 1) {
      const snowSize = Math.max(1, Math.round(previewPx(1.4 + (snowIndex % 4) * 0.65)));
      const xSeed = Math.round(outputWidth * ((snowIndex * 37) % 100) / 100);
      const ySeed = Math.round(outputHeight * ((snowIndex * 23) % 100) / 100);
      const drift = ((snowIndex * 19) % 31) - 15;
      const fallSpeed = Math.round(previewPx(34 + ((snowIndex * 17) % 48)) * sceneEffects.snowSpeed);
      const snowLabel = `snow${snowIndex}`;
      addWeatherOverlay({
        source: `color=c=white@${snowOpacity}:s=${snowSize}x${snowSize}:r=${fps}:d=${duration},format=rgba`,
        x: `mod(${xSeed}+t*${drift}+main_w*10,main_w-overlay_w)`,
        y: `mod(${ySeed}+t*${fallSpeed}+main_h*10,main_h-overlay_h)`,
        label: snowLabel,
      });
    }
  }
  textOverlayRenders.forEach(({ scene: overlay }, textIndex) => {
    const x = clamp(Number(overlay.x ?? 50) / 100, 0, 1);
    const y = clamp(Number(overlay.y ?? 18) / 100, 0, 1);
    const outputLabel = `texted${textIndex}`;
    filter += `${composedLabel}[${textIndex + 1}:v]overlay=x='main_w*${x}-overlay_w/2':y='main_h*${y}-overlay_h/2'[${outputLabel}];`;
    composedLabel = `[${outputLabel}]`;
  });
  let sceneImageInputIndex = 1 + textOverlayRenders.length + decorationRenders.length;
  sceneImageRenders.forEach(({ scene: image, rendered: imageRender }, imageIndex) => {
    const imageStart = Math.min(duration, Math.max(0, Number(image.start ?? 0) || 0));
    const imageEnd = Math.min(duration, imageStart + Math.max(0.1, Number(image.duration ?? duration) || 0.1));
    const imageX = clamp(Number(image.x ?? 50) / 100, 0, 1);
    const imageY = clamp(Number(image.y ?? 50) / 100, 0, 1);
    const imageOpacity = clamp(Number(image.opacity ?? 100) / 100, 0, 1);
    const imageAssetLabel = `sceneImageAsset${imageIndex}`;
    const imageVideoLabel = `sceneImageVideo${imageIndex}`;
    const imageAlphaSourceLabel = `sceneImageAlphaSource${imageIndex}`;
    const imageAlphaLabel = `sceneImageAlpha${imageIndex}`;
    const imageMaskLabel = `sceneImageMask${imageIndex}`;
    const imageBorderLabel = `sceneImageBorder${imageIndex}`;
    const imageColorFilter = imageOpacity < 0.999 ? `colorchannelmixer=aa=${imageOpacity.toFixed(3)},` : "";
    if (imageRender.animated) {
      const hasImageBorder = Boolean(imageRender.borderPath);
      const imageFit = image.transparent === true
        || imageRender.spriteSheet === true
        || imageRender.webpAnimation === true
        ? "contain"
        : "cover";
      // Preview mounts the media when its start time is reached, so the
      // animation begins at frame 0 there. Offset the input timestamps to
      // reproduce that same behaviour in the final video.
      filter += `[${sceneImageInputIndex}:v]format=rgba,${ffmpegMediaFit(imageRender.width, imageRender.height, imageFit)},setpts=PTS-STARTPTS+${imageStart}/TB,split=2[${imageVideoLabel}][${imageAlphaSourceLabel}];`;
      filter += `[${imageAlphaSourceLabel}]alphaextract[${imageAlphaLabel}];[${sceneImageInputIndex + 1}:v]format=gray[${imageMaskLabel}];[${imageAlphaLabel}][${imageMaskLabel}]blend=all_mode=multiply[${imageAlphaLabel}masked];[${imageVideoLabel}][${imageAlphaLabel}masked]alphamerge,${imageColorFilter}format=rgba[${imageAssetLabel}];`;
      const imageLayerLabel = hasImageBorder ? `${imageAssetLabel}bordered` : imageAssetLabel;
      if (hasImageBorder) {
        filter += `[${sceneImageInputIndex + 2}:v]format=rgba[${imageBorderLabel}];[${imageAssetLabel}][${imageBorderLabel}]overlay=0:0:shortest=1[${imageLayerLabel}];`;
      }
      filter += `${composedLabel}[${imageLayerLabel}]overlay=x='main_w*${imageX}-overlay_w/2':y='main_h*${imageY}-overlay_h/2':enable='between(t,${imageStart},${imageEnd})'[sceneImageComposed${imageIndex}];`;
      sceneImageInputIndex += hasImageBorder ? 3 : 2;
    } else {
      filter += `[${sceneImageInputIndex}:v]format=rgba,${imageColorFilter}format=rgba[${imageAssetLabel}];`;
      filter += `${composedLabel}[${imageAssetLabel}]overlay=x='main_w*${imageX}-overlay_w/2':y='main_h*${imageY}-overlay_h/2':enable='between(t,${imageStart},${imageEnd})'[sceneImageComposed${imageIndex}];`;
      sceneImageInputIndex += 1;
    }
    composedLabel = `[sceneImageComposed${imageIndex}]`;
  });
  let popupInputIndex = sceneImageInputIndex;
  decorationRenders.forEach(({ scene: decoration }, decorationIndex) => {
    const decorationStart = Math.min(duration, Math.max(0, Number(decoration.start ?? 0) || 0));
    const decorationDuration = Math.max(0.1, Number(decoration.duration ?? duration) || 0.1);
    const decorationEnd = Math.min(duration, decorationStart + decorationDuration);
    const animation = String(decoration.animation ?? "none");
    const popDuration = Math.min(0.45, Math.max(0.1, decorationEnd - decorationStart));
    const popScale = animation === "pop"
      ? `if(lt(t,${decorationStart}),0.72,if(lt(t,${decorationStart + popDuration}),0.72+0.28*(t-${decorationStart})/${popDuration},1))`
      : animation === "pulse"
        ? `1+0.08*sin((t-${decorationStart})*5)`
        : "1";
    const baseScale = clamp(Number(decoration.scale ?? 1), 0.1, 3);
    const floatDistance = animation === "float" ? Math.round(previewPx(10)) : 0;
    const baseRotation = clamp(Number(decoration.rotate ?? 0), -180, 180) * Math.PI / 180;
    const rotation = animation === "spin"
      ? `${baseRotation}+(t-${decorationStart})*0.9`
      : String(baseRotation);
    const fadeIn = animation === "fade"
      ? `fade=t=in:st=${decorationStart}:d=${popDuration}:alpha=1,fade=t=out:st=${Math.max(decorationStart, decorationEnd - popDuration)}:d=${popDuration}:alpha=1,`
      : "";
    const inputLabel = `decorationInput${decorationIndex}`;
    const outputLabel = `decorated${decorationIndex}`;
    const x = clamp(Number(decoration.x ?? 50) / 100, 0, 1);
    const y = clamp(Number(decoration.y ?? 50) / 100, 0, 1);
    const decorationInputIndex = 1 + textOverlayRenders.length + decorationIndex;
    const animatedFilter = decoration.animated ? `format=rgba,fps=${fps},setpts=PTS-STARTPTS,` : "format=rgba,";
    const animatedStickerFit = decoration.animated
      ? `${ffmpegMediaFit(animatedStickerSize, animatedStickerSize, "contain")},`
      : "";
    filter += `[${decorationInputIndex}:v]${animatedFilter}${animatedStickerFit}${fadeIn}scale=w='iw*(${baseScale}*(${popScale}))':h='ih*(${baseScale}*(${popScale}))':eval=frame,rotate=angle='${rotation}':fillcolor=none:ow=rotw(iw):oh=roth(ih)[${inputLabel}];`;
    filter += `${composedLabel}[${inputLabel}]overlay=x='main_w*${x}-overlay_w/2':y='main_h*${y}+${floatDistance}*sin((t-${decorationStart})*2)-overlay_h/2':enable='between(t,${decorationStart},${decorationEnd})'[${outputLabel}];`;
    composedLabel = `[${outputLabel}]`;
  });
  popupRenders.forEach(({ scene: popupScene, rendered: popup }, popupIndex) => {
    const popupStart = Math.min(duration, Math.max(0, Number(popupScene.popupStart ?? 0)));
    const popupEnd = Math.min(duration, popupStart + Number(popupScene.popupDuration ?? duration));
    const transition = Math.min(0.65, Math.max(0.25, (popupEnd - popupStart) / 3));
    const popupIn = popupScene.popupIn ?? "fade-slide-up";
    const popupOut = popupScene.popupOut ?? "fade-slide-down";
    const popupTextEffect = popupScene.popupTextEffect ?? "none";
    const popupInProgress = `(t-${popupStart})/${transition}`;
    const popupOutProgress = `(t-${popupEnd - transition})/${transition}`;
    const popupScaleStart = (effect) => ({
      "fade-slide-up": "0.92", "fade-slide-down": "0.92", "zoom-soft": "0.68", bounce: "0.82", flip: "0.86",
    }[effect] ?? "1");
    const popupScaleIn = (effect) => ({
      "fade-slide-up": `0.92+0.08*(${popupInProgress})`,
      "zoom-soft": `0.68+0.32*(${popupInProgress})`,
      bounce: `if(lt(${popupInProgress},0.65),0.82+0.22*(${popupInProgress})/0.65,1.04-0.04*((${popupInProgress})-0.65)/0.35)`,
      flip: `0.86+0.14*(${popupInProgress})`,
    }[effect] ?? "1");
    const popupScaleOut = (effect) => ({
      "fade-slide-down": `1-0.08*(${popupOutProgress})`,
      "zoom-soft": `1-0.32*(${popupOutProgress})`,
      bounce: `if(lt(${popupOutProgress},0.35),1+0.03*(${popupOutProgress})/0.35,1.03-0.23*((${popupOutProgress})-0.35)/0.65)`,
      flip: `1-0.14*(${popupOutProgress})`,
    }[effect] ?? "1");
    const popupScaleBase = `if(lt(t,${popupStart}),${popupScaleStart(popupIn)},if(lt(t,${popupStart + transition}),${popupScaleIn(popupIn)},if(gt(t,${popupEnd - transition}),${popupScaleOut(popupOut)},1)))`;
    const popupTextScale = popupTextEffect === "pop"
      ? `if(lt(t,${popupStart}),0.88,if(lt(t,${popupStart + transition}),0.88+0.12*(${popupInProgress}),if(gt(t,${popupEnd - transition}),1-0.12*(${popupOutProgress}),1)))`
      : "1";
    const popupScale = `(${popupScaleBase})*(${popupTextScale})`;
    const popupAngle = `if(lt(t,${popupStart}),${popupIn === "flip" ? `-PI/2*(1-(${popupInProgress}))` : "0"},if(lt(t,${popupStart + transition}),${popupIn === "flip" ? `-PI/2*(1-(${popupInProgress}))` : "0"},if(gt(t,${popupEnd - transition}),${popupOut === "flip" ? `PI/2*(${popupOutProgress})` : "0"},0)))`;
    const popupWidthRatio = clamp(Number(popupScene.popupWidth ?? 90) / 100, 0.45, 1);
    const popupHeightRatio = clamp(popupPixelHeight(popupScene) / outputHeight, 0.2, 0.88);
    const popupXRatio = clamp(Number(popupScene.popupX ?? 5) / 100, 0, 1 - popupWidthRatio);
    const popupYRatio = clamp(Number(popupScene.popupY ?? 55) / 100, 0, 1 - popupHeightRatio);
    const popupCenterX = `main_w*${popupXRatio}`;
    const openingX = popupIn === "slide-left"
      ? `if(lt(t,${popupStart + transition}),-overlay_w+(${popupCenterX}+overlay_w)*(t-${popupStart})/${transition},${popupCenterX})`
      : popupIn === "slide-right"
        ? `if(lt(t,${popupStart + transition}),main_w-(main_w-${popupCenterX})*(t-${popupStart})/${transition},${popupCenterX})`
        : popupCenterX;
    const closingX = popupOut === "slide-left"
      ? `if(gt(t,${popupEnd - transition}),${popupCenterX}-(${popupCenterX}+overlay_w)*(t-${popupEnd - transition})/${transition},${openingX})`
      : popupOut === "slide-right"
        ? `if(gt(t,${popupEnd - transition}),${popupCenterX}+(main_w-${popupCenterX})*(t-${popupEnd - transition})/${transition},${openingX})`
        : openingX;
    const popupSlideDistance = Math.round(previewPx(52));
    const bounceInDistance = Math.round(previewPx(70));
    const bouncePeak = Math.round(previewPx(12));
    const bounceOutPeak = Math.round(previewPx(13));
    const bounceOutDistance = Math.round(previewPx(75));
    const centerYExpression = `main_h*${popupYRatio}`;
    const popupY = popupIn === "bounce"
      ? `if(lt(t,${popupStart + transition}),${centerYExpression}+if(lt(${popupInProgress},0.65),${bounceInDistance}-${bounceInDistance + bouncePeak}*(${popupInProgress})/0.65,-${bouncePeak}*(1-(${popupInProgress}-0.65)/0.35)),${centerYExpression})`
      : popupOut === "bounce"
        ? `if(gt(t,${popupEnd - transition}),${centerYExpression}+if(lt(${popupOutProgress},0.35),-${bounceOutPeak}*(${popupOutProgress})/0.35,-${bounceOutPeak}+${bounceOutPeak + bounceOutDistance}*((${popupOutProgress})-0.35)/0.65),${centerYExpression})`
        : popupIn === "fade-slide-up" || popupOut === "fade-slide-down"
          ? `if(lt(t,${popupStart + transition}),${centerYExpression}+${popupSlideDistance}*(1-(t-${popupStart})/${transition}),if(gt(t,${popupEnd - transition}),${centerYExpression}+${popupSlideDistance}*(t-${popupEnd - transition})/${transition},${centerYExpression}))`
          : centerYExpression;
    const videoInputIndex = popup.video ? popupInputIndex + 1 : null;
    const borderInputIndex = popup.video && popup.borderPath ? popupInputIndex + 2 : null;
    const videoLabel = `popupVideo${popupIndex}`;
    const baseLabel = `popupBase${popupIndex}`;
    const borderLabel = `popupBorder${popupIndex}`;
    const borderedLabel = `popupBordered${popupIndex}`;
    const popLabel = `pop${popupIndex}`;
    const composedOutput = `[composed${popupIndex}]`;
    if (popup.video) {
      filter += `[${videoInputIndex}:v]format=rgba,scale=${popup.videoWidth}:${popup.videoHeight}:force_original_aspect_ratio=increase,crop=${popup.videoWidth}:${popup.videoHeight},setpts=PTS-STARTPTS[${videoLabel}];[${popupInputIndex}:v]format=rgba[${baseLabel}input];[${baseLabel}input][${videoLabel}]overlay=0:0:shortest=1[${baseLabel}];`;
      if (borderInputIndex !== null) {
        filter += `[${borderInputIndex}:v]format=rgba[${borderLabel}];[${baseLabel}][${borderLabel}]overlay=0:0:shortest=1[${borderedLabel}];`;
      }
    }
    filter += `${popup.video ? `[${borderInputIndex !== null ? borderedLabel : baseLabel}]` : `[${popupInputIndex}:v]`}format=rgba,scale=w='iw*(${popupScale})':h='ih*(${popupScale})':eval=frame,`;
    if (popupIn === "flip" || popupOut === "flip") filter += `rotate=angle='${popupAngle}':fillcolor=none:ow=rotw(iw):oh=roth(ih),`;
    filter += `fade=t=in:st=${popupStart}:d=${transition}:alpha=1,fade=t=out:st=${Math.max(popupStart, popupEnd - transition)}:d=${transition}:alpha=1[${popLabel}];`;
    filter += `${composedLabel}[${popLabel}]overlay=x='${closingX}':y='${popupY}':enable='between(t,${popupStart},${popupEnd})'${composedOutput};`;
    composedLabel = composedOutput;
    popupInputIndex += popup.video ? (popup.borderPath ? 3 : 2) : 1;
  });
  const subtitleInputIndex = popupInputIndex;
  subtitleRenders.forEach(({ scene: subtitle, style, rendered: renderedOverlay }, subtitleIndex) => {
    const subtitleStart = Math.min(duration, Math.max(0, Number(subtitle.start) || 0));
    const subtitleEnd = Math.min(
      duration,
      Math.max(subtitleStart + 0.1, Number(subtitle.end) || subtitleStart + 0.1),
    );
    const subtitleOutput = `[subtitled${subtitleIndex}]`;
    const inputIndex = subtitleInputIndex + subtitleIndex;
    const subtitleX = clamp(Number(style?.x ?? 50) / 100, 0, 1);
    const subtitleY = clamp(Number(style?.y ?? 83) / 100, 0, 1);
    const animation = ["none", "fade", "pop", "slide-up", "typewriter"].includes(String(style?.animation))
      ? String(style.animation)
      : "fade";
    const animationDuration = clamp(Number(style?.animationDuration ?? 0.25), 0.05, 1);
    const subtitleInputLabel = `subtitleInput${subtitleIndex}`;
    if (animation === "fade") {
      filter += `[${inputIndex}:v]format=rgba,fade=t=in:st=${subtitleStart}:d=${animationDuration}:alpha=1[${subtitleInputLabel}];`;
    } else if (animation === "pop") {
      const progress = `min(1,max(0,(t-${subtitleStart})/${animationDuration}))`;
      filter += `[${inputIndex}:v]scale=w='iw*(0.92+0.08*${progress})':h='ih*(0.92+0.08*${progress})':eval=frame[${subtitleInputLabel}];`;
    } else if (animation === "typewriter") {
      const progress = `min(1,max(0,(T-${subtitleStart})/${animationDuration}))`;
      filter += `[${inputIndex}:v]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X/W,${progress}),alpha(X,Y),0)'[${subtitleInputLabel}];`;
    } else {
      filter += `[${inputIndex}:v]format=rgba[${subtitleInputLabel}];`;
    }
    const slideOffset = animation === "slide-up"
      ? `+main_h*0.03*(1-min(1,max(0,(t-${subtitleStart})/${animationDuration})))`
      : "";
    const renderedWidth = Number(renderedOverlay?.width);
    const fixedSubtitleLeft = animation === "typewriter" && Number.isFinite(renderedWidth)
      ? `main_w*${subtitleX}-${renderedWidth / 2}`
      : `main_w*${subtitleX}-overlay_w/2`;
    filter += `${composedLabel}[${subtitleInputLabel}]overlay=x='${fixedSubtitleLeft}':y='main_h*${subtitleY}-overlay_h/2${slideOffset}':enable='between(t,${subtitleStart},${subtitleEnd})'${subtitleOutput};`;
    composedLabel = subtitleOutput;
  });
  popupInputIndex += subtitleRenders.length;
  filter += `${composedLabel}copy[composed]`;
  const args = [
    "-y",
    ...(backgroundIsVideo ? ["-stream_loop", "-1", "-i", sceneBackground] : ["-loop", "1", "-i", sceneBackground]),
  ];
  textOverlayRenders.forEach(({ rendered: overlay }) => {
    args.push("-loop", "1", "-i", overlay.path);
  });
  decorationRenders.forEach(({ rendered: decoration }) => {
    if (decoration.animated) {
      args.push("-stream_loop", "-1", "-i", decoration.path);
    } else {
      args.push("-loop", "1", "-i", decoration.path);
    }
  });
  sceneImageRenders.forEach(({ rendered: image }) => {
    if (image.animated) {
      if (image.frameSequence) {
        args.push("-stream_loop", "-1", "-f", "concat", "-safe", "0", "-i", image.path);
      } else {
        args.push("-stream_loop", "-1", "-i", image.path);
      }
      args.push("-loop", "1", "-i", image.maskPath);
      if (image.borderPath) args.push("-loop", "1", "-i", image.borderPath);
    } else {
      args.push("-loop", "1", "-i", image.path);
    }
  });
  popupRenders.forEach(({ rendered: popup }) => {
    args.push("-loop", "1", "-i", popup.path);
    if (popup.video) {
      args.push("-stream_loop", "-1", "-i", popup.video);
      args.push("-loop", "1", "-i", popup.borderPath);
    }
  });
  subtitleRenders.forEach(({ rendered: subtitle }) => {
    args.push("-loop", "1", "-i", subtitle.path);
  });
  weatherInputSpecs.forEach((source) => {
    args.push("-f", "lavfi", "-i", source);
  });
  const audioInputIndex = popupInputIndex + weatherInputSpecs.length;
  if (voice) {
    args.push("-i", voice);
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  }
  args.push(
    "-filter_complex", filter,
    "-map", "[composed]",
  );
  const audioFilter = voice
    ? `aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo,volume=${voiceVolume.toFixed(3)},apad`
    : "aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo,apad";
  args.push("-map", `${audioInputIndex}:a:0`, "-af", audioFilter);
  args.push(
    "-t", String(duration),
    "-r", String(fps),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    clip,
  );
  console.log(`Rendering scene ${index + 1}/${scenes.length}: ${scene.sceneName ?? scene.title ?? `Cảnh ${index + 1}`}`);
  await run(ffmpeg, args);
  clipPaths.push(clip);
}

const concatFile = path.join(renderDir, "concat.txt");
await fs.writeFile(
  concatFile,
  clipPaths.map((item) => `file '${item.replaceAll("'", "'\\''")}'`).join("\n"),
);
const music = project.backgroundMusic
  ? await resolveAudio(project.backgroundMusic, true)
  : null;
const narrationVideo = music
  ? path.join(renderDir, "narration-video.mp4")
  : outputPath;
await run(ffmpeg, [
  "-y",
  "-f", "concat",
  "-safe", "0",
  "-i", concatFile,
  "-c:v", "copy",
  "-c:a", "aac",
  "-b:a", "192k",
  "-ar", "48000",
  "-ac", "2",
  "-af", "aresample=async=1:first_pts=0",
  "-movflags", "+faststart",
  narrationVideo,
]);

if (music) {
  const musicVolume = audioVolume(project.backgroundMusicVolume, 18);
  await run(ffmpeg, [
    "-y",
    "-i", narrationVideo,
    "-stream_loop", "-1",
    "-i", music,
    "-filter_complex", `[0:a]volume=1[a0];[1:a]volume=${musicVolume.toFixed(3)}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]`,
    "-map", "0:v:0",
    "-map", "[a]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-t", String(timelineDuration),
    "-movflags", "+faststart",
    outputPath,
  ]);
} else if (narrationVideo !== outputPath) {
  await fs.copyFile(narrationVideo, outputPath);
}
console.log(`Rendered: ${outputPath}`);
