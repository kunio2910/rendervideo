import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { cacheRemoteResource, isRemoteResourceUrl, resourceKey } from "./render-resource-cache.mjs";
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
const renderCacheDir = process.env.RENDER_CACHE_DIR
  ? path.resolve(process.env.RENDER_CACHE_DIR)
  : path.join(root, "work", "render-cache");
const assetCacheDir = path.join(renderCacheDir, "assets");
const frameSequenceCacheDir = path.join(renderCacheDir, "frame-sequences");
const bundledFfmpeg = path.join(root, ".local-renderer", "ffmpeg", "bin", "ffmpeg.exe");
const ffmpeg = process.env.FFMPEG_PATH || bundledFfmpeg;
// A scene can contain many looped PNG/video inputs (for example, dozens of
// subtitle cues). FFmpeg's automatic filter threading and input queues can
// then retain a frame per input until the graph drains, which may exhaust
// memory near the end of a long scene. Keep the graph bounded by default,
// while allowing advanced local setups to opt into larger values.
const ffmpegFilterThreads = Math.max(1, Number(process.env.FFMPEG_FILTER_THREADS ?? 1) || 1);
const ffmpegInputQueueSize = Math.max(1, Number(process.env.FFMPEG_INPUT_QUEUE_SIZE ?? 2) || 2);
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
const renderProfile = project.renderProfile === "fast" ? "fast" : "quality";
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
if (renderProfile === "fast") {
  const [fastWidth, fastHeight] = (aspectRatio === "16:9" ? "1280x720" : "720x1280")
    .split("x")
    .map((value) => Math.max(1, Number.parseInt(value, 10) || 1));
  if (outputWidth > fastWidth || outputHeight > fastHeight) {
    outputWidth = fastWidth;
    outputHeight = fastHeight;
  }
}
const requestedFps = Math.max(1, Number(project.fps ?? 30) || 30);
const fps = renderProfile === "fast" ? Math.min(requestedFps, 24) : requestedFps;
const videoPreset = renderProfile === "fast" ? "veryfast" : "medium";
const videoCrf = renderProfile === "fast" ? "24" : "20";
const audioBitrate = renderProfile === "fast" ? "128k" : "192k";
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
// FFmpeg's geq parser treats a stray quote as the beginning of a new option.
// All expressions assembled here are generated from numeric values, but old
// saved projects may still carry a copied quote from a failed filter graph.
// Normalize it at the boundary so one malformed legacy value cannot abort the
// complete render with the unhelpful exit code 1.
const normalizeGeqExpression = (value) => String(value ?? "")
  .replaceAll("'", "")
  .replace(/[\r\n]+/g, " ")
  .trim();
const geqRgb = (expression) => {
  const safe = normalizeGeqExpression(expression);
  return `geq=r='${safe}':g='${safe}':b='${safe}'`;
};
const geqRgba = ({ red = "r(X,Y)", green = "g(X,Y)", blue = "b(X,Y)", alpha = "alpha(X,Y)" } = {}) =>
  `geq=r='${normalizeGeqExpression(red)}':g='${normalizeGeqExpression(green)}':b='${normalizeGeqExpression(blue)}':a='${normalizeGeqExpression(alpha)}'`;
const textOverlayEffectValues = [
  "none", "fade", "slide-up", "slide-down", "slide-left", "slide-right",
  "typewriter", "zoom", "pop", "glow", "letter-spacing", "blur",
  "highlight-sweep", "stroke-draw", "shake", "glitch", "shadow-lift",
  "word-by-word", "kinetic",
];
const normalizeTextOverlayEffect = (value) => textOverlayEffectValues.includes(String(value))
  ? String(value)
  : "none";
const sceneImageTransitionValues = ["cut", "crossfade", "fade-black", "slide-left", "slide-right", "zoom", "blur"];
const normalizeSceneImageTransition = (value) => sceneImageTransitionValues.includes(String(value)) ? String(value) : "cut";
const sceneImageTransitionEnd = (image) => {
  const start = Math.max(0, Number(image?.start ?? 0) || 0);
  const legacyDuration = Math.max(0.1, Number(image?.transitionDuration ?? 0.5) || 0.5);
  const end = Number.isFinite(Number(image?.transitionEnd))
    ? Number(image.transitionEnd)
    : start + legacyDuration;
  return Math.max(start + 0.1, end);
};
const sceneImageTransitionDuration = (image) => normalizeSceneImageTransition(image?.transition) === "cut"
  ? 0
  : Math.max(0.1, sceneImageTransitionEnd(image) - Math.max(0, Number(image?.start ?? 0) || 0));
const sceneImageTransitionNeedsOverlap = (transition) =>
  transition === "crossfade" || transition === "slide-left" || transition === "slide-right";
const popupDimensionLayout = (value) => ["image-top", "split", "quote", "stats", "image-only", "content-only"].includes(String(value))
  ? String(value)
  : "image-top";
const popupDimensionHeight = (value, fallback = 255) => clamp(
  Number.isFinite(Number(value)) ? Number(value) : fallback,
  170,
  440,
);
const popupSectionDefaults = (layoutValue, heightValue = 255) => {
  const layout = popupDimensionLayout(layoutValue);
  const height = popupDimensionHeight(heightValue);
  if (layout === "split") return { imageHeight: height, contentHeight: height, height };
  if (layout === "image-only") return { imageHeight: height, contentHeight: 0, height };
  if (layout === "content-only" || layout === "quote") return { imageHeight: 0, contentHeight: height, height };
  const imageHeight = Math.min(115, Math.max(48, height - 48));
  return { imageHeight, contentHeight: Math.max(48, height - imageHeight), height };
};
const popupSectionGeometry = (popup, showVisual = true, showText = true) => {
  const layout = popupDimensionLayout(popup.popupLayout ?? popup.layout);
  const defaults = popupSectionDefaults(layout, popup.popupHeight ?? popup.height);
  let imageHeight = Number.isFinite(Number(popup.popupImageHeight ?? popup.imageHeight))
    ? Math.max(0, Number(popup.popupImageHeight ?? popup.imageHeight))
    : defaults.imageHeight;
  let contentHeight = Number.isFinite(Number(popup.popupContentHeight ?? popup.contentHeight))
    ? Math.max(0, Number(popup.popupContentHeight ?? popup.contentHeight))
    : defaults.contentHeight;
  if (!showVisual) imageHeight = 0;
  if (!showText) contentHeight = 0;
  if (showVisual && !showText) imageHeight = Math.max(imageHeight, defaults.height);
  if (!showVisual && showText) contentHeight = Math.max(contentHeight, defaults.height);
  const height = layout === "split" ? Math.max(imageHeight, contentHeight) : imageHeight + contentHeight;
  return {
    layout,
    imageHeight: Math.round(imageHeight),
    contentHeight: Math.round(contentHeight),
    height: Math.round(Math.max(0, height)),
  };
};
const normalizeSceneEffects = (value) => {
  const raw = value && typeof value === "object" ? value : {};
  const legacyDarkEffect = {
    id: "scene-dark-1",
    enabled: raw.sceneStartDarkEnabled === true,
    start: 0,
    end: Math.max(0.1, Number(raw.sceneStartDarkDuration ?? 1.2) || 1.2),
    holdDuration: 0,
    intensity: clamp(Number(raw.sceneStartDarkIntensity ?? 0) || 0, 0, 100),
  };
  const darkEffects = Array.isArray(raw.sceneStartDarkEffects)
    ? raw.sceneStartDarkEffects.map((item, index) => {
        const dark = item && typeof item === "object" ? item : {};
        const start = Math.min(3599.9, Math.max(0, Number(dark.start ?? 0) || 0));
        const end = Math.min(3600, Math.max(start + 0.1, Number(dark.end ?? start + 1.2) || start + 1.2));
        const holdDuration = Math.min(
          Math.max(0, end - start - 0.1),
          Math.max(0, Number(dark.holdDuration ?? 0) || 0),
        );
        return {
          id: String(dark.id ?? `scene-dark-${index + 1}`),
          enabled: dark.enabled !== false,
          start,
          end,
          holdDuration,
          intensity: clamp(Number(dark.intensity ?? 0) || 0, 0, 100),
        };
      })
    : [legacyDarkEffect];
  const firstDarkEffect = darkEffects[0] ?? legacyDarkEffect;
  return {
    sceneStartDarkEnabled: darkEffects.some((effect) => effect.enabled),
    sceneStartDarkDuration: Math.max(0.1, firstDarkEffect.end - firstDarkEffect.start),
    sceneStartDarkIntensity: firstDarkEffect.intensity,
    sceneStartDarkEffects: darkEffects,
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

// These seeds intentionally mirror the preview component. Keeping one fixed
// set makes the preview stable and lets the FFmpeg path reproduce the same
// density, stagger and travel time instead of inventing a second weather look.
const snowflakeSeeds = Array.from({ length: 36 }, (_, index) => ({
  x: (index * 37) % 100,
  size: 2 + ((index * 5) % 5),
  duration: 5.5 + ((index * 17) % 45) / 10,
  delay: -((index * 23) % 80) / 10,
  drift: -24 + ((index * 19) % 49),
}));
const rainDropSeeds = Array.from({ length: 32 }, (_, index) => ({
  x: (index * 29) % 100,
  length: 14 + ((index * 11) % 18),
  width: 1 + (index % 2),
  duration: 1.2 + ((index * 13) % 14) / 10,
  delay: -((index * 17) % 35) / 10,
  drift: -18 + ((index * 7) % 37),
}));
const cloudSeeds = Array.from({ length: 7 }, (_, index) => ({
  x: -18 + ((index * 23) % 112),
  y: 12 + ((index * 17) % 43),
  width: 24 + ((index * 19) % 28),
  height: 8 + ((index * 7) % 8),
  duration: 18 + ((index * 11) % 14),
  delay: -((index * 13) % 28),
  drift: 118 + ((index * 17) % 45),
}));

const writeWeatherGradientLayer = async (filename, kind) => {
  const isThunder = kind === "thunder";
  const svg = isThunder
    ? `<svg width="${outputWidth}" height="${outputHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="flash" cx="58%" cy="18%" r="48%">
            <stop offset="0" stop-color="#e1f2ff" stop-opacity=".92" />
            <stop offset="1" stop-color="#e1f2ff" stop-opacity="0" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="#d6e9ff" fill-opacity=".35" />
        <rect width="100%" height="100%" fill="url(#flash)" />
      </svg>`
    : `<svg width="${outputWidth}" height="${outputHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="warm" cx="24%" cy="21%" r="32%">
            <stop offset="0" stop-color="#fff2ae" stop-opacity=".9" />
            <stop offset="1" stop-color="#fff2ae" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="amber" cx="78%" cy="68%" r="42%">
            <stop offset="0" stop-color="#ffbe5b" stop-opacity=".5" />
            <stop offset="1" stop-color="#ffbe5b" stop-opacity="0" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#warm)" />
        <rect width="100%" height="100%" fill="url(#amber)" />
      </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filename);
  return filename;
};

const weatherPhaseExpression = (cycle, delay, timeVariable = "T") => {
  const safeCycle = Math.max(0.05, Number(cycle) || 1);
  // Make the modulo numerator positive so a negative CSS animation-delay
  // starts at the same deterministic phase in FFmpeg.
  const offset = safeCycle * 12 + Number(delay || 0);
  return `mod(${timeVariable}+${offset.toFixed(4)},${safeCycle.toFixed(4)})/${safeCycle.toFixed(4)}`;
};

const weatherFadeExpression = (phase, plateau = 0.9) =>
  `if(lt(${phase},0.1),${plateau.toFixed(4)}*${phase}/0.1,if(gt(${phase},0.9),${plateau.toFixed(4)}*(1-${phase})/0.1,${plateau.toFixed(4)}))`;

const popupPixelHeight = (scene) => Math.min(
  Math.round(previewPx(popupSectionGeometry(scene).height)),
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
      popupImageHeight: popup.imageHeight ?? popup.popupImageHeight,
      popupContentHeight: popup.contentHeight ?? popup.popupContentHeight,
      popupBorderWidth: popup.borderWidth ?? popup.popupBorderWidth ?? scene.popupBorderWidth ?? 1,
      popupLayout: popup.layout ?? popup.popupLayout ?? "image-top",
      popupTheme: popup.theme ?? popup.popupTheme ?? "travel",
      popupTextEffect: popup.textEffect ?? popup.popupTextEffect ?? "none",
      popupX: popup.x ?? popup.popupX ?? 5,
      popupY: popup.y ?? popup.popupY ?? 55,
      popupVisible: popup.visible !== false,
      imageVisible: popup.imageVisible !== false,
      popupTransparentMedia: typeof popup.transparentMedia === "boolean"
        ? popup.transparentMedia
        : typeof popup.popupTransparentMedia === "boolean"
          ? popup.popupTransparentMedia
          : scene.popupTransparentMedia === true,
      popupIndex: index,
    }));
  }
  return [{
    ...scene,
    title: String(scene.title ?? ""),
    body: String(scene.body ?? scene.popup ?? ""),
    narration: String(scene.narration ?? ""),
    popupImageHeight: scene.popupImageHeight,
    popupContentHeight: scene.popupContentHeight,
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
await fs.mkdir(assetCacheDir, { recursive: true });
await fs.mkdir(frameSequenceCacheDir, { recursive: true });
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

const sequenceCacheKey = (...parts) => createHash("sha1")
  .update(parts.map((part) => String(part)).join("\0"))
  .digest("hex");

const sequenceCachePaths = (cacheKey) => {
  const sequenceRoot = path.join(frameSequenceCacheDir, cacheKey);
  return {
    sequenceRoot,
    concatPath: path.join(sequenceRoot, "frames.txt"),
    metadataPath: path.join(sequenceRoot, "metadata.json"),
  };
};

const readCachedFrameSequence = async (cacheKey) => {
  const paths = sequenceCachePaths(cacheKey);
  try {
    const metadata = JSON.parse(await fs.readFile(paths.metadataPath, "utf8"));
    await fs.access(paths.concatPath);
    return { ...metadata, path: paths.concatPath };
  } catch {
    return null;
  }
};

const writeRawFrameSequence = async (frames, frameWidth, frameHeight, delays, cacheKey) => {
  if (!frames.length) throw new Error("Sprite không có frame để render");
  const cached = await readCachedFrameSequence(cacheKey);
  if (cached) return cached.path;
  const { sequenceRoot, concatPath, metadataPath } = sequenceCachePaths(cacheKey);
  const framesRoot = path.join(sequenceRoot, "frames");
  await fs.mkdir(framesRoot, { recursive: true });
  const framePaths = [];
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const framePath = path.join(framesRoot, `frame-${String(frameIndex + 1).padStart(3, "0")}.png`);
    await sharp(frames[frameIndex], {
      raw: { width: frameWidth, height: frameHeight, channels: 4 },
    }).png().toFile(framePath);
    framePaths.push(framePath);
  }
  const entries = framePaths.flatMap((framePath, frameIndex) => [
    concatFileEntry(framePath),
    `duration ${(Math.max(60, Number(delays[frameIndex]) || 180) / 1000).toFixed(3)}`,
  ]);
  // The concat demuxer uses the next file to determine the duration of the
  // previous one, so repeat the last frame to preserve its duration.
  entries.push(concatFileEntry(framePaths[framePaths.length - 1]));
  await fs.writeFile(concatPath, `${entries.join("\n")}\n`, "utf8");
  await fs.writeFile(metadataPath, JSON.stringify({
    frameWidth,
    frameHeight,
    frameCount: frames.length,
    delay: Number(delays[0]) || 180,
  }), "utf8");
  return concatPath;
};

const writeSpriteFrameSequence = async (frames, frameSize, delay, sourceKey) =>
  writeRawFrameSequence(
    frames,
    frameSize,
    frameSize,
    frames.map(() => delay),
    sequenceCacheKey("sprite", sourceKey, frameSize, delay),
  );

const fileHashCache = new Map();
const hashFile = async (filename) => {
  const cached = fileHashCache.get(filename);
  if (cached) return cached;
  const promise = fs.readFile(filename).then((buffer) => createHash("sha1").update(buffer).digest("hex"));
  fileHashCache.set(filename, promise);
  return promise;
};

const writeAnimatedImageFrameSequence = async (
  source,
  metadata,
) => {
  const frameWidth = Math.max(1, Number(metadata.width) || 1);
  const frameHeight = Math.max(1, Number(metadata.pageHeight) || Number(metadata.height) || 1);
  const pageCount = Math.max(1, Number(metadata.pages) || Math.floor(Number(metadata.height) / frameHeight) || 1);
  const sourceKey = await hashFile(source);
  const sourceDelays = Array.isArray(metadata.delay) ? metadata.delay : [];
  const delays = Array.from(
    { length: pageCount },
    (_, frameIndex) => Number(sourceDelays[frameIndex] ?? sourceDelays[0] ?? 180),
  );
  const cacheKey = sequenceCacheKey("animated", sourceKey, frameWidth, frameHeight, pageCount, delays.join(","));
  const cached = await readCachedFrameSequence(cacheKey);
  if (cached) return cached.path;
  const rawResult = await sharp(source, { animated: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const frameBytes = frameWidth * frameHeight * rawResult.info.channels;
  if (rawResult.data.length < frameBytes * pageCount) {
    throw new Error("Không thể đọc đủ frame của hình động");
  }
  const frames = Array.from({ length: pageCount }, (_, frameIndex) => (
    rawResult.data.subarray(frameIndex * frameBytes, (frameIndex + 1) * frameBytes)
  ));
  return writeRawFrameSequence(
    frames,
    frameWidth,
    frameHeight,
    delays,
    cacheKey,
  );
};

const writeAnimatedWebpFrameSequence = async (source, metadata) =>
  writeAnimatedImageFrameSequence(source, metadata);

const errorDetail = (error) => {
  if (!(error instanceof Error)) return "unknown error";
  const cause = error.cause instanceof Error ? error.cause.message : "";
  return cause ? `${error.message}: ${cause}` : error.message;
};

const resourceCache = new Map();

const isRemote = isRemoteResourceUrl;

const downloadResource = async (kind, value, fallbackName) => {
  const trimmed = String(value ?? "").trim();
  const key = resourceKey(kind, trimmed, fallbackName);
  const cached = resourceCache.get(key);
  if (cached) return cached;
  const promise = (async () => {
    const resource = await cacheRemoteResource({
      cacheRoot: renderCacheDir,
      kind,
      value: trimmed,
      fallbackName,
    });
    console.log(`${resource.cached ? "Cache hit" : "Cached URL"}: ${trimmed}`);
    return resource.path;
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

const sceneAudioTracksForRender = (scene, duration) => {
  const rawTracks = Array.isArray(scene.audioTracks)
    ? scene.audioTracks
    : String(scene.voiceFile ?? "").trim()
      ? [{
          id: "legacy-voice",
          name: "Thuyết minh",
          source: scene.voiceFile,
          volume: scene.voiceVolume,
          start: scene.voiceStart,
          end: duration,
          visible: true,
        }]
      : [];
  return rawTracks
    .filter((track) => track && track.visible !== false && String(track.source ?? track.url ?? track.file ?? "").trim())
    .map((track, trackIndex) => {
      const start = clamp(Number(track.start ?? 0) || 0, 0, Math.max(0, duration - 0.1));
      const end = clamp(Number(track.end ?? duration) || duration, start + 0.1, duration);
      return {
        id: String(track.id ?? `audio-${trackIndex + 1}`),
        name: String(track.name ?? `Âm thanh ${trackIndex + 1}`),
        source: String(track.source ?? track.url ?? track.file ?? "").trim(),
        volume: audioVolume(track.volume, trackIndex === 0 ? 95 : 100),
        start,
        end,
      };
    });
};

const resolveSceneAudioTrack = async (track, sceneIndex, trackIndex) => {
  try {
    const resolved = await resolveAudio(track.source, true);
    if (!resolved) throw new Error(`Không tìm thấy ${track.source}`);
    return { ...track, path: resolved };
  } catch (error) {
    throw new Error(
      `Không thể tải âm thanh “${track.name}” của cảnh ${sceneIndex + 1}: ${errorDetail(error)}`,
    );
  }
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
  const resolvedImage = showVisual && imageVisible
    ? await resolveImage(imageValue, `scene-${index + 1}-image`)
    : null;
  let animatedImage = null;
  let animatedImageFrameSequence = false;
  if (resolvedImage && showVisual && imageVisible && layout !== "quote") {
    let imageMetadata = null;
    try {
      imageMetadata = await sharp(resolvedImage, { animated: true }).metadata();
    } catch {
      imageMetadata = null;
    }
    const animatedImageDetected = isAnimatedImageMedia(imageValue)
      || Number(imageMetadata?.pages) > 1;
    if (animatedImageDetected) {
      if (imageMetadata) {
        animatedImage = await writeAnimatedImageFrameSequence(
          resolvedImage,
          imageMetadata,
        );
        animatedImageFrameSequence = true;
      } else {
        animatedImage = resolvedImage;
      }
    }
  }
  const resolvedVideo = showVisual && layout !== "quote" && videoValue
    ? await resolveVideo(videoValue, `scene-${index + 1}-popup.mp4`)
    : null;
  const image = animatedImage && !resolvedVideo ? null : resolvedImage;
  const video = resolvedVideo ?? animatedImage;
  const videoFrameSequence = Boolean(!resolvedVideo && animatedImageFrameSequence);
  const hasVisual = showVisual && Boolean((imageVisible && imageValue) || videoValue);
  const split = layout === "split";
  const geometry = popupSectionGeometry({
    ...scene,
    popupLayout: layout,
  }, showVisual, showText);
  const height = Math.min(
    popupPixelHeight({ ...scene, popupLayout: layout, popupImageHeight: geometry.imageHeight, popupContentHeight: geometry.contentHeight }),
    Math.round(outputHeight * 0.88),
  );
  const imageWidth = split ? Math.round(width * 0.42) : width;
  const imageHeight = Math.min(
    Math.round(previewPx(geometry.imageHeight)),
    height,
  );
  const contentHeight = Math.min(
    Math.round(previewPx(geometry.contentHeight)),
    height,
  );
  const contentX = split ? imageWidth + paddingX : paddingX;
  const contentWidth = split ? width - imageWidth - paddingX * 2 : width - paddingX * 2;
  const contentTop = split ? 0 : imageHeight;
  const titleY = layout === "quote"
    ? Math.round(previewPx(56))
    : contentTop + Math.round(previewPx(layout === "stats" ? 33 : 33));
  const bodyY = titleY + Math.round(previewPx(layout === "quote" ? 33 : 24));
  const maxCharacters = Math.max(24, Math.floor(contentWidth / Math.max(1, bodyFontSize * 0.54)));
  const maxBodyLines = Math.max(1, Math.floor((contentTop + contentHeight - bodyY - previewPx(15)) / bodyLineHeight) + 1);
  const bodyLines = wrap(showText ? scene.body ?? scene.popup ?? "" : "", maxCharacters).slice(0, maxBodyLines);
  const bodyText = bodyLines.map((line, lineIndex) =>
    `<text x="${contentX}" y="${bodyY + lineIndex * bodyLineHeight}" font-size="${bodyFontSize}" fill="${colors.body}">${escapeXml(line)}</text>`,
  ).join("");
  const imageClipPath = split
    ? `M ${radius} 0 H ${imageWidth} V ${imageHeight} H ${radius} Q 0 ${imageHeight} 0 ${Math.max(0, imageHeight - radius)} V ${radius} Q 0 0 ${radius} 0 Z`
    : `M ${radius} 0 H ${width - radius} Q ${width} 0 ${width} ${radius} V ${imageHeight} H 0 V ${radius} Q 0 0 ${radius} 0 Z`;
  const placeholder = split
    ? `<rect width="${imageWidth}" height="${imageHeight}" fill="url(#placeholderSky)"/>`
    : `<rect width="${width}" height="${imageHeight}" fill="url(#placeholderSky)"/>`;
  const cardBackground = transparentMediaOnly
    ? ""
    : `<rect x="${borderWidth / 2}" y="${borderWidth / 2}" width="${width - borderWidth}" height="${height - borderWidth}" rx="${radius}" fill="${colors.background}" fill-opacity=".96"/>`;
  // Keep the render in sync with the editor preview. The preview's media
  // area always has this light sky/sand background when transparent media is
  // disabled. Without it, transparent pixels in a PNG/WebP reveal the dark
  // popup card background during export.
  const mediaBackground = showVisual && !transparentMedia
    ? `<g clip-path="url(#imageClip)"><rect width="${imageWidth}" height="${imageHeight}" fill="url(#popupMediaBackground)"/></g>`
    : "";
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
        <linearGradient id="popupMediaBackground" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#c9e4f5"/><stop offset="100%" stop-color="#f6d8af"/></linearGradient>
        <clipPath id="imageClip"><path d="${imageClipPath}"/></clipPath>
      </defs>
      ${cardBackground}
      ${mediaBackground}
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
    videoFrameSequence,
    videoWidth: imageWidth,
    videoHeight: imageHeight,
    // Keep the dimensions used to build the popup image. The composition
    // pass must use these exact values after a section resize instead of
    // deriving the height a second time from the scene fields.
    width,
    height,
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
  const borderFill = String(image?.borderFill ?? "transparent").trim().toLowerCase() === "transparent"
    ? null
    : decorationColor(image?.borderFill, null);
  const fillPath = borderFill ? path.join(renderDir, `scene-image-${index + 1}-fill.png`) : null;
  if (fillPath && borderFill) {
    await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: borderFill,
      },
    })
      .composite([{ input: alphaMaskSvg, blend: "dest-in" }])
      .png()
      .toFile(fillPath);
  }
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
    return { path: animatedMedia, animated: true, video: mediaType === "video", maskPath, fillPath, borderPath, width, height };
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
    const frameSequencePath = await writeAnimatedWebpFrameSequence(source, sourceMetadata);
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
      fillPath,
      borderPath,
      width,
      height,
    };
  }
  let spriteSheet = { detected: false };
  let spriteSourceKey = "";
  if (image?.spriteSheet === true) {
    try {
      const sourceBuffer = await fs.readFile(source);
      spriteSourceKey = createHash("sha1").update(sourceBuffer).digest("hex");
      const spriteLookupPath = path.join(
        frameSequenceCacheDir,
        `sprite-${sequenceCacheKey("lookup", spriteSourceKey, image?.spriteDelay ?? "auto")}.json`,
      );
      try {
        const cachedLookup = JSON.parse(await fs.readFile(spriteLookupPath, "utf8"));
        const cachedSequence = await readCachedFrameSequence(cachedLookup.cacheKey);
        if (cachedSequence) {
          spriteSheet = {
            detected: true,
            frameSize: cachedSequence.frameWidth,
            delay: cachedSequence.delay,
            cachedPath: cachedSequence.path,
          };
        }
      } catch {
        // Cache miss: detect the sprite grid below.
      }
      if (!spriteSheet.detected) {
        spriteSheet = await processSpriteSheetBuffer(sourceBuffer, {
          delay: image?.spriteDelay,
          returnFrames: true,
        });
        if (spriteSheet.detected) {
          const cacheKey = sequenceCacheKey(
            "sprite",
            spriteSourceKey,
            spriteSheet.frameSize,
            spriteSheet.delay,
          );
          spriteSheet.cacheKey = cacheKey;
          await fs.writeFile(spriteLookupPath, JSON.stringify({ cacheKey }), "utf8");
        }
      }
    } catch {
      // Unsupported or malformed images continue through the existing static
      // image path instead of changing the behaviour of regular media.
    }
  }
  if (spriteSheet.detected) {
    const frameSequencePath = spriteSheet.cachedPath || await writeSpriteFrameSequence(
        spriteSheet.frames,
        spriteSheet.frameSize,
        spriteSheet.delay,
        spriteSourceKey,
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
      fillPath,
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
  const composites = [];
  if (fillPath) composites.push({ input: fillPath, top: 0, left: 0 });
  composites.push({ input: resized, top: 0, left: 0 });
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
  const textEffect = normalizeTextOverlayEffect(overlay?.textEffect ?? overlay?.overlayTextEffect);
  const color = decorationColor(overlay?.color, "#ffffff");
  const strokeColor = decorationColor(overlay?.strokeColor, "#000000");
  const borderColor = decorationColor(overlay?.borderColor, "#ffffff");
  const borderFill = decorationColor(overlay?.borderFill, "#14202e");
  const paddingX = Math.round(previewPx(9));
  const paddingY = Math.round(previewPx(5));
  const lineHeight = Math.max(Math.round(size * 1.15), Math.round(previewPx(14)));
  const requestedBoxWidth = Number(overlay?.boxWidth ?? overlay?.width);
  const minimumBoxWidth = overlay?.boxWidth !== undefined ? 0.4 : 0.04;
  const boxWidth = Number.isFinite(requestedBoxWidth)
    ? Math.round(outputWidth * clamp(requestedBoxWidth / 100, minimumBoxWidth, 1))
    : null;
  const requestedBoxHeight = Number(overlay?.boxHeight ?? overlay?.height);
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
  const intrinsicHeight = Math.max(
    Math.round(previewPx(24)),
    Math.ceil(lines.length * lineHeight + paddingY * 2 + strokeWidth * 2 + borderWidth),
  );
  const height = Number.isFinite(requestedBoxHeight)
    ? Math.max(Math.round(previewPx(24)), Math.round(outputHeight * clamp(requestedBoxHeight / 100, 0.03, 0.4)))
    : intrinsicHeight;
  const radius = Math.min(
    Math.round(previewPx(clamp(Number(overlay?.borderRadius ?? 6), 0, 24))),
    Math.floor(Math.min(width, height) / 2),
  );
  const fontWeight = String(overlay?.style ?? "normal").includes("bold") ? 700 : 400;
  const fontStyle = String(overlay?.style ?? "normal").includes("italic") ? "italic" : "normal";
  const letterSpacing = textEffect === "letter-spacing" ? Math.round(previewPx(5)) : 0;
  const textNodes = lines.map((line, lineIndex) => {
    const y = paddingY + size * 0.86 + lineIndex * lineHeight;
    return `<text x="${width / 2}" y="${y}" text-anchor="middle" font-family="${escapeXml(font)}" font-weight="${fontWeight}" font-style="${fontStyle}" font-size="${size}" letter-spacing="${letterSpacing}" fill="${color}" fill-opacity="${textOpacity}" ${strokeWidth > 0 ? `stroke="${strokeColor}" stroke-opacity="${textOpacity}" stroke-width="${strokeWidth}" paint-order="stroke fill" stroke-linejoin="round"` : ""}>${escapeXml(line)}</text>`;
  }).join("");
  const shadowNodes = textEffect === "shadow-lift"
    ? lines.map((line, lineIndex) => {
        const y = paddingY + size * 0.86 + lineIndex * lineHeight + Math.max(2, Math.round(previewPx(7)));
        return `<text x="${width / 2}" y="${y}" text-anchor="middle" font-family="${escapeXml(font)}" font-weight="${fontWeight}" font-style="${fontStyle}" font-size="${size}" letter-spacing="${letterSpacing}" fill="#000000" fill-opacity="0.38">${escapeXml(line)}</text>`;
      }).join("")
    : "";
  const svg = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${borderWidth / 2}" y="${borderWidth / 2}" width="${Math.max(1, width - borderWidth)}" height="${Math.max(1, height - borderWidth)}" rx="${radius}" fill="${borderFill}" fill-opacity="${borderOpacity}" stroke="${borderColor}" stroke-opacity="${borderOpacity}" stroke-width="${borderWidth}" />
      ${shadowNodes}${textNodes}
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
  boxHeight: subtitleStyle.boxHeight,
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
  const sceneImagePlaybackEnd = (imageIndex) => {
    const image = sceneImageScenes[imageIndex];
    if (!image) return 0;
    const imageStart = Math.min(duration, Math.max(0, Number(image.start ?? 0) || 0));
    const baseEnd = imageStart + Math.max(0.1, Number(image.duration ?? duration) || 0.1);
    const imageTransition = normalizeSceneImageTransition(image.transition);
    const ownTransitionEnd = imageTransition === "cut"
      ? imageStart
      : sceneImageTransitionEnd(image);
    const imageEnd = Math.min(duration, Math.max(baseEnd, ownTransitionEnd));
    const nextImage = sceneImageScenes[imageIndex + 1];
    if (!nextImage) return imageEnd;
    const nextStart = Math.min(duration, Math.max(0, Number(nextImage.start ?? 0) || 0));
    const nextTransition = normalizeSceneImageTransition(nextImage.transition);
    if (!sceneImageTransitionNeedsOverlap(nextTransition)) return imageEnd;
    const overlapEnd = nextStart + sceneImageTransitionDuration(nextImage);
    return Math.min(duration, Math.max(imageEnd, overlapEnd));
  };
  const sceneImageRenders = [];
  for (let imageIndex = 0; imageIndex < sceneImageScenes.length; imageIndex += 1) {
    const image = sceneImageScenes[imageIndex];
    const rendered = await createSceneImage(image, index * 100 + imageIndex);
    if (rendered) sceneImageRenders.push({ scene: image, rendered });
  }
  const sceneAudioTracks = sceneAudioTracksForRender(scene, duration);
  const resolvedSceneAudioTracks = [];
  for (let audioTrackIndex = 0; audioTrackIndex < sceneAudioTracks.length; audioTrackIndex += 1) {
    resolvedSceneAudioTracks.push(await resolveSceneAudioTrack(sceneAudioTracks[audioTrackIndex], index, audioTrackIndex));
  }
  // Legacy names remain available for diagnostics and source-level compatibility checks.
  const voice = resolvedSceneAudioTracks[0]?.path ?? null;
  const voiceVolume = resolvedSceneAudioTracks[0]?.volume ?? audioVolume(scene.voiceVolume, 95);
  const voiceStart = resolvedSceneAudioTracks[0]?.start ?? clamp(Number(scene.voiceStart ?? 0) || 0, 0, duration);
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
          textEffect: scene.overlayTextEffect,
          textEffectDuration: scene.overlayTextEffectDuration,
          start: scene.overlayTextStart,
          end: scene.overlayTextEnd,
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
  const subtitleOffset = clamp(Number(scene.subtitleStart ?? 0) || 0, 0, duration);
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
  const layerToken = (kind, id) => `${kind}:${id}`;
  const layerItemId = (item, index, prefix) => String(item?.id ?? `${prefix}-${index + 1}`);
  const textLayerIds = textOverlayRenders.map(({ scene: overlay }, index) => layerItemId(overlay, index, "text"));
  const decorationLayerIds = decorationRenders.map(({ scene: decoration }, index) => layerItemId(decoration, index, "decoration"));
  const sceneImageLayerIds = sceneImageRenders.map(({ scene: image }, index) => layerItemId(image, index, "image"));
  const popupLayerIds = popupRenders.map(({ scene: popup }, index) => layerItemId(popup, index, "popup"));
  const layerCandidates = [
    ...textLayerIds.map((id) => layerToken("text", id)),
    ...popupLayerIds.map((id) => layerToken("popup", id)),
    ...decorationLayerIds.map((id) => layerToken("decoration", id)),
    ...sceneImageLayerIds.map((id) => layerToken("image", id)),
    ...(subtitleRenders.length ? [layerToken("subtitle", "subtitle")] : []),
  ];
  const knownLayerTokens = new Set(layerCandidates);
  const storedLayerOrder = Array.isArray(scene.layerOrder)
    ? scene.layerOrder.filter((token) => typeof token === "string")
    : [];
  const orderedLayerTokens = Array.from(new Set([
    ...storedLayerOrder.filter((token) => knownLayerTokens.has(token)),
    ...layerCandidates.filter((token) => !storedLayerOrder.includes(token)),
  ]));
  const textInputIndices = textOverlayRenders.map((_, index) => 1 + index);
  const decorationInputStartIndex = 1 + textOverlayRenders.length;
  const decorationInputIndices = decorationRenders.map((_, index) => decorationInputStartIndex + index);
  const sceneImageInputIndices = [];
  let nextInputIndex = decorationInputStartIndex + decorationRenders.length;
  for (const { rendered: image } of sceneImageRenders) {
    sceneImageInputIndices.push(nextInputIndex);
    nextInputIndex += image.animated
      ? 2 + (image.fillPath ? 1 : 0) + (image.borderPath ? 1 : 0)
      : 1;
  }
  const popupInputIndices = [];
  for (const { rendered: popup } of popupRenders) {
    popupInputIndices.push(nextInputIndex);
    nextInputIndex += popup.video ? (popup.borderPath ? 3 : 2) : 1;
  }
  const subtitleInputStartIndex = nextInputIndex;
  const weatherInputIndex = subtitleInputStartIndex + subtitleRenders.length;
  const weatherInputSpecs = [];
  let filter = backgroundFilter;
  let composedLabel = "[bg]";
  const sceneEffects = normalizeSceneEffects(scene.effects);
  const addWeatherOverlay = ({ source, input, x, y, label, inputFilter = "" }) => {
    const inputLabel = `${label}Input`;
    if (input) {
      const inputIndex = weatherInputIndex + weatherInputSpecs.length;
      weatherInputSpecs.push(input);
      filter += `[${inputIndex}:v]${inputFilter}[${inputLabel}];`;
    } else {
      filter += `${source}${inputFilter ? `,${inputFilter}` : ""}[${inputLabel}];`;
    }
    filter += `${composedLabel}[${inputLabel}]overlay=` +
      `x='${x}':y='${y}':shortest=1:eval=frame[${label}];`;
    composedLabel = `[${label}]`;
  };
  if (sceneEffects.lightFlickerEnabled && sceneEffects.lightFlickerIntensity > 0) {
    const cycle = Math.max(0.2, 2.8 / sceneEffects.lightFlickerSpeed);
    const phase = weatherPhaseExpression(cycle, 0);
    const pulse = `if(lt(${phase},0.24),1-0.38*${phase}/0.24,if(lt(${phase},0.45),0.62+0.38*(${phase}-0.24)/0.21,if(lt(${phase},0.68),1-0.3*(${phase}-0.45)/0.23,0.7+0.3*(${phase}-0.68)/0.32)))`;
    const alpha = ((sceneEffects.lightFlickerIntensity / 100) * 0.68).toFixed(4);
    const lightPath = await writeWeatherGradientLayer(path.join(renderDir, `weather-light-${index + 1}.png`), "light");
    addWeatherOverlay({
      input: { type: "file", path: lightPath },
      x: "0",
      y: "0",
      label: "lightFlicker",
      inputFilter: `format=rgba,${geqRgba({ alpha: `alpha(X,Y)*${alpha}*(${pulse})` })}`,
    });
  }
  if (sceneEffects.thunderEnabled && sceneEffects.thunderIntensity > 0) {
    const cycle = Math.max(0.4, 3.6 / sceneEffects.thunderSpeed);
    const phase = weatherPhaseExpression(cycle, 0);
    const pulse = `if(lt(${phase},0.31),0,if(lt(${phase},0.33),0.72*(${phase}-0.31)/0.02,if(lt(${phase},0.35),0.72-0.57*(${phase}-0.33)/0.02,if(lt(${phase},0.37),0.15+0.75*(${phase}-0.35)/0.02,if(lt(${phase},0.4),0.9*(0.4-${phase})/0.03,if(lt(${phase},0.68),0,if(lt(${phase},0.7),0.48*(${phase}-0.68)/0.02,if(lt(${phase},0.72),0.48*(0.72-${phase})/0.02,0))))))))`;
    const alpha = ((sceneEffects.thunderIntensity / 100) * 0.78).toFixed(4);
    const thunderPath = await writeWeatherGradientLayer(path.join(renderDir, `weather-thunder-${index + 1}.png`), "thunder");
    addWeatherOverlay({
      input: { type: "file", path: thunderPath },
      x: "0",
      y: "0",
      label: "thunder",
      inputFilter: `format=rgba,${geqRgba({ alpha: `alpha(X,Y)*${alpha}*(${pulse})` })}`,
    });
  }
  if (sceneEffects.cloudEnabled && sceneEffects.cloudIntensity > 0) {
    for (let cloudIndex = 0; cloudIndex < cloudSeeds.length; cloudIndex += 1) {
      const cloud = cloudSeeds[cloudIndex];
      const cloudWidth = Math.max(12, Math.round(outputWidth * cloud.width / 100));
      const cloudHeight = Math.max(10, Math.round(outputHeight * cloud.height / 100));
      const cycle = cloud.duration / sceneEffects.cloudSpeed;
      const phase = weatherPhaseExpression(cycle, cloud.delay);
      const overlayPhase = weatherPhaseExpression(cycle, cloud.delay, "t");
      const opacity = weatherFadeExpression(phase, 0.9);
      const travel = `(-0.45+(${overlayPhase})*(${cloud.drift / 100 + 0.45}))`;
      const cloudMask = "if(gt(lte((X-W*0.5)^2/(W*0.5)^2+(Y-H*0.52)^2/(H*0.45)^2,1)+lte((X-W*0.7)^2/(W*0.28)^2+(Y-H*0.42)^2/(H*0.37)^2,1)+lte((X-W*0.3)^2/(W*0.25)^2+(Y-H*0.56)^2/(H*0.32)^2,1),0),alpha(X,Y),0)";
      addWeatherOverlay({
        source: `color=c=0xE0ECF8@0.48:s=${cloudWidth}x${cloudHeight}:r=${fps}:d=${duration},format=rgba,${geqRgba({ alpha: cloudMask })},boxblur=${Math.max(1, Math.round(previewPx(5)))}:1`,
        x: `main_w*${(cloud.x / 100).toFixed(4)}+overlay_w*${travel}`,
        y: `main_h*${(cloud.y / 100).toFixed(4)}`,
        label: `cloud${cloudIndex}`,
        inputFilter: `format=rgba,${geqRgba({ alpha: `alpha(X,Y)*${(sceneEffects.cloudIntensity / 100).toFixed(4)}*(${opacity})` })}`,
      });
    }
  }
  if (sceneEffects.rainEnabled && sceneEffects.rainIntensity > 0) {
    for (let rainIndex = 0; rainIndex < rainDropSeeds.length; rainIndex += 1) {
      const drop = rainDropSeeds[rainIndex];
      const dropWidth = Math.max(1, Math.round(previewPx(drop.width)));
      const dropHeight = Math.max(6, Math.round(previewPx(drop.length)));
      const cycle = drop.duration / sceneEffects.rainSpeed;
      const phase = weatherPhaseExpression(cycle, drop.delay);
      const overlayPhase = weatherPhaseExpression(cycle, drop.delay, "t");
      const opacity = weatherFadeExpression(phase, 0.9);
      addWeatherOverlay({
        source: `color=c=0xCAE5FF@0.95:s=${dropWidth}x${dropHeight}:r=${fps}:d=${duration},format=rgba,${geqRgba({ alpha: "alpha(X,Y)*Y/H" })},rotate=0.244346:c=none:ow=rotw(iw):oh=roth(ih)`,
        x: `main_w*${(drop.x / 100).toFixed(4)}+${Math.round(previewPx(drop.drift))}*(${overlayPhase})`,
        y: `main_h*(-0.12+1.22*(${overlayPhase}))`,
        label: `rain${rainIndex}`,
        inputFilter: `format=rgba,${geqRgba({ alpha: `alpha(X,Y)*${(sceneEffects.rainIntensity / 100).toFixed(4)}*(${opacity})` })}`,
      });
    }
  }
  if (sceneEffects.snowEnabled && sceneEffects.snowIntensity > 0) {
    for (let snowIndex = 0; snowIndex < snowflakeSeeds.length; snowIndex += 1) {
      const flake = snowflakeSeeds[snowIndex];
      const snowSize = Math.max(1, Math.round(previewPx(flake.size)));
      const cycle = flake.duration / sceneEffects.snowSpeed;
      const phase = weatherPhaseExpression(cycle, flake.delay);
      const overlayPhase = weatherPhaseExpression(cycle, flake.delay, "t");
      const opacity = weatherFadeExpression(phase, 0.92);
      const snowLabel = `snow${snowIndex}`;
      addWeatherOverlay({
        source: `color=c=white@0.92:s=${snowSize}x${snowSize}:r=${fps}:d=${duration},format=rgba,${geqRgba({ alpha: "if(lte((X-W/2)^2+(Y-H/2)^2,(min(W,H)/2)^2),alpha(X,Y),0)" })}`,
        x: `main_w*${(flake.x / 100).toFixed(4)}+${Math.round(previewPx(flake.drift))}*(${overlayPhase})`,
        y: `main_h*(-0.08+1.16*(${overlayPhase}))`,
        label: snowLabel,
        inputFilter: `format=rgba,${geqRgba({ alpha: `alpha(X,Y)*${(sceneEffects.snowIntensity / 100).toFixed(4)}*(${opacity})` })}`,
      });
    }
  }
  const appendTextLayer = (textIndex) => {
    const { scene: overlay } = textOverlayRenders[textIndex];
    const x = clamp(Number(overlay.x ?? 50) / 100, 0, 1);
    const y = clamp(Number(overlay.y ?? 18) / 100, 0, 1);
    const textStart = Math.min(duration, Math.max(0, Number(overlay.start) || 0));
    const textEnd = Math.min(
      duration,
      Math.max(textStart + 0.1, Number(overlay.end) || duration),
    );
    const textSpan = Math.max(0.1, textEnd - textStart);
    const effect = normalizeTextOverlayEffect(overlay.textEffect ?? overlay.overlayTextEffect);
    const effectDuration = clamp(
      Number(overlay.textEffectDuration ?? overlay.overlayTextEffectDuration ?? 0.6) || 0.6,
      0.05,
      textSpan,
    );
    const progress = `min(1,max(0,(t-${textStart})/${effectDuration}))`;
    const geqProgress = `min(1,max(0,(T-${textStart})/${effectDuration}))`;
    const inputIndex = textInputIndices[textIndex];
    const inputLabel = `textInput${textIndex}`;
    const outputLabel = `texted${textIndex}`;
    let overlayInputLabel = inputLabel;
    const textValue = String(overlay.text ?? "");
    const wordCount = Math.max(1, textValue.trim().split(/\s+/).filter(Boolean).length);
    if (effect === "glow") {
      const sharpLabel = `textSharp${textIndex}`;
      const glowSourceLabel = `textGlowSource${textIndex}`;
      const glowLabel = `textGlow${textIndex}`;
      filter += `[${inputIndex}:v]format=rgba,split=2[${sharpLabel}][${glowSourceLabel}];`;
      filter += `[${glowSourceLabel}]gblur=sigma=6,eq=brightness='0.08+0.08*sin(2*PI*(t-${textStart})/${effectDuration})',colorchannelmixer=aa=0.65[${glowLabel}];`;
      filter += `[${sharpLabel}][${glowLabel}]blend=all_mode=screen:all_opacity=0.85[${inputLabel}];`;
    } else if (effect === "blur") {
      const sharpSourceLabel = `textBlurSharpSource${textIndex}`;
      const sharpLabel = `textBlurSharp${textIndex}`;
      const blurSourceLabel = `textBlurSource${textIndex}`;
      const blurLabel = `textBlurred${textIndex}`;
      const blurProgress = `min(1,max(0,(T-${textStart})/${effectDuration}))`;
      filter += `[${inputIndex}:v]format=rgba,split=2[${sharpSourceLabel}][${blurSourceLabel}];`;
      filter += `[${blurSourceLabel}]gblur=sigma=10,${geqRgba({ alpha: `alpha(X,Y)*(1-(${blurProgress}))` })}[${blurLabel}];`;
      filter += `[${sharpSourceLabel}]${geqRgba({ alpha: `alpha(X,Y)*(${blurProgress})` })}[${sharpLabel}];`;
      filter += `[${blurLabel}][${sharpLabel}]overlay=0:0:format=auto[${inputLabel}];`;
    } else {
      let inputFilter = `[${inputIndex}:v]format=rgba`;
      if (effect === "fade") {
        const fadeOutStart = Math.max(textStart, textEnd - effectDuration);
        inputFilter += `,fade=t=in:st=${textStart}:d=${effectDuration}:alpha=1,fade=t=out:st=${fadeOutStart}:d=${effectDuration}:alpha=1`;
      } else if (effect === "typewriter" || effect === "stroke-draw") {
        inputFilter += `,${geqRgba({ alpha: `if(lt(X/W,${geqProgress}),alpha(X,Y),0)` })}`;
      } else if (effect === "word-by-word") {
        const wordProgress = `floor(${geqProgress}*${wordCount})/${wordCount}`;
        inputFilter += `,${geqRgba({ alpha: `if(lt(X/W,${wordProgress}),alpha(X,Y),0)` })}`;
      } else if (effect === "highlight-sweep") {
        inputFilter += `,eq=brightness='0.08*sin(2*PI*(t-${textStart})/${effectDuration})'`;
      } else if (effect === "glitch") {
        inputFilter += ",noise=alls=4:allf=t+u";
      }
      if (effect === "zoom") {
        inputFilter += `,scale=w='iw*(0.78+0.22*${progress})':h='ih*(0.78+0.22*${progress})':eval=frame`;
      } else if (effect === "pop") {
        inputFilter += `,scale=w='iw*(0.82+0.18*${progress})':h='ih*(0.82+0.18*${progress})':eval=frame`;
      }
      filter += `${inputFilter}[${inputLabel}];`;
    }
    const baseX = `main_w*${x}-overlay_w/2`;
    const baseY = `main_h*${y}-overlay_h/2`;
    const slideDistance = "main_w*0.12";
    let overlayX = baseX;
    let overlayY = baseY;
    if (effect === "slide-left") overlayX = `${baseX}-${slideDistance}*(1-${progress})`;
    if (effect === "slide-right") overlayX = `${baseX}+${slideDistance}*(1-${progress})`;
    if (effect === "slide-up") overlayY = `${baseY}+main_h*0.08*(1-${progress})`;
    if (effect === "slide-down") overlayY = `${baseY}-main_h*0.08*(1-${progress})`;
    if (effect === "shake") {
      overlayX = `${baseX}+sin((t-${textStart})*48)*${Math.max(1, Math.round(previewPx(2)))}`;
      overlayY = `${baseY}+cos((t-${textStart})*55)*${Math.max(1, Math.round(previewPx(1.5)))}`;
    }
    if (effect === "glitch") {
      overlayX = `${baseX}+if(lt(mod((t-${textStart})*12,2),1),${Math.max(1, Math.round(previewPx(2)))},-${Math.max(1, Math.round(previewPx(2)))})`;
    }
    if (effect === "kinetic") {
      overlayY = `${baseY}+sin((t-${textStart})*2.8)*main_h*0.012`;
    }
    filter += `${composedLabel}[${overlayInputLabel}]overlay=x='${overlayX}':y='${overlayY}':enable='between(t,${textStart},${textEnd})'[${outputLabel}];`;
    composedLabel = `[${outputLabel}]`;
  };
  const appendSceneImageLayer = (imageIndex) => {
    const { scene: image, rendered: imageRender } = sceneImageRenders[imageIndex];
    const sceneImageInputIndex = sceneImageInputIndices[imageIndex];
    const imageStart = Math.min(duration, Math.max(0, Number(image.start ?? 0) || 0));
    const imageEnd = sceneImagePlaybackEnd(imageIndex);
    const imageTransition = normalizeSceneImageTransition(image.transition);
    const imageTransitionDuration = sceneImageTransitionDuration(image);
    const imageTransitionProgress = imageTransitionDuration > 0
      ? `min(1,max(0,(t-${imageStart})/${imageTransitionDuration}))`
      : "1";
    const imageX = clamp(Number(image.x ?? 50) / 100, 0, 1);
    const imageY = clamp(Number(image.y ?? 50) / 100, 0, 1);
    const imageOpacity = clamp(Number(image.opacity ?? 100) / 100, 0, 1);
    const imageAssetLabel = `sceneImageAsset${imageIndex}`;
    const imageVideoLabel = `sceneImageVideo${imageIndex}`;
    const imageAlphaSourceLabel = `sceneImageAlphaSource${imageIndex}`;
    const imageAlphaLabel = `sceneImageAlpha${imageIndex}`;
    const imageMaskLabel = `sceneImageMask${imageIndex}`;
    const imageFillLabel = `sceneImageFill${imageIndex}`;
    const imageFilledLabel = `sceneImageFilled${imageIndex}`;
    const imageBorderLabel = `sceneImageBorder${imageIndex}`;
    const imageColorFilter = imageOpacity < 0.999 ? `colorchannelmixer=aa=${imageOpacity.toFixed(3)},` : "";
    const imageTransitionFilter = imageTransition === "crossfade"
      ? `fade=t=in:st=${imageStart}:d=${imageTransitionDuration}:alpha=1,`
      : imageTransition === "zoom"
        ? `scale=w='iw*(1.14-0.14*${imageTransitionProgress})':h='ih*(1.14-0.14*${imageTransitionProgress})':eval=frame,`
        : imageTransition === "blur"
          ? `boxblur=luma_radius='min(12,max(0,12*(1-${imageTransitionProgress})))':luma_power=1,`
          : "";
    const imageBaseX = "main_w*" + imageX + "-overlay_w/2";
    const imageOverlayX = imageTransition === "slide-left"
      ? `${imageBaseX}-(main_w+overlay_w)*(1-${imageTransitionProgress})`
      : imageTransition === "slide-right"
        ? `${imageBaseX}+(main_w+overlay_w)*(1-${imageTransitionProgress})`
      : imageBaseX;
    let imageLayerLabel = imageAssetLabel;
    if (imageRender.animated) {
      const hasImageFill = Boolean(imageRender.fillPath);
      const hasImageBorder = Boolean(imageRender.borderPath);
      const imageMaskInputIndex = sceneImageInputIndex + 1;
      const imageFillInputIndex = hasImageFill ? sceneImageInputIndex + 2 : null;
      const imageBorderInputIndex = sceneImageInputIndex + 2 + (hasImageFill ? 1 : 0);
      const imageFit = image.transparent === true
        || imageRender.spriteSheet === true
        || imageRender.webpAnimation === true
        ? "contain"
        : "cover";
      // Preview mounts the media when its start time is reached, so the
      // animation begins at frame 0 there. Offset the input timestamps to
      // reproduce that same behaviour in the final video.
      filter += `[${sceneImageInputIndex}:v]format=rgba,${ffmpegMediaFit(imageRender.width, imageRender.height, imageFit)},setpts=PTS-STARTPTS+${imageStart}/TB,split=2[${imageVideoLabel}][${imageAlphaSourceLabel}];`;
      filter += `[${imageAlphaSourceLabel}]alphaextract[${imageAlphaLabel}];[${imageMaskInputIndex}:v]format=gray[${imageMaskLabel}];[${imageAlphaLabel}][${imageMaskLabel}]blend=all_mode=multiply[${imageAlphaLabel}masked];[${imageVideoLabel}][${imageAlphaLabel}masked]alphamerge,${imageColorFilter}format=rgba[${imageAssetLabel}];`;
      if (hasImageFill && imageFillInputIndex !== null) {
        filter += `[${imageFillInputIndex}:v]format=rgba[${imageFillLabel}];[${imageFillLabel}][${imageAssetLabel}]overlay=0:0:shortest=1[${imageFilledLabel}];`;
        imageLayerLabel = imageFilledLabel;
      }
      if (hasImageBorder) {
        filter += `[${imageBorderInputIndex}:v]format=rgba[${imageBorderLabel}];[${imageLayerLabel}][${imageBorderLabel}]overlay=0:0:shortest=1[${imageLayerLabel}bordered];`;
        imageLayerLabel = `${imageLayerLabel}bordered`;
      }
    } else {
      filter += `[${sceneImageInputIndex}:v]format=rgba,${imageColorFilter}format=rgba[${imageAssetLabel}];`;
    }
    if (imageTransitionFilter) {
      const transitionedLabel = `sceneImageTransition${imageIndex}`;
      filter += `[${imageLayerLabel}]${imageTransitionFilter}format=rgba[${transitionedLabel}];`;
      imageLayerLabel = transitionedLabel;
    }
    filter += `${composedLabel}[${imageLayerLabel}]overlay=x='${imageOverlayX}':y='main_h*${imageY}-overlay_h/2':enable='gte(t,${imageStart})*lt(t,${imageEnd})'[sceneImageComposed${imageIndex}];`;
    composedLabel = `[sceneImageComposed${imageIndex}]`;
  };
  const appendDecorationLayer = (decorationIndex) => {
    const { scene: decoration } = decorationRenders[decorationIndex];
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
    const decorationInputIndex = decorationInputIndices[decorationIndex];
    const animatedFilter = decoration.animated ? `format=rgba,fps=${fps},setpts=PTS-STARTPTS,` : "format=rgba,";
    const animatedStickerFit = decoration.animated
      ? `${ffmpegMediaFit(animatedStickerSize, animatedStickerSize, "contain")},`
      : "";
    filter += `[${decorationInputIndex}:v]${animatedFilter}${animatedStickerFit}${fadeIn}scale=w='iw*(${baseScale}*(${popScale}))':h='ih*(${baseScale}*(${popScale}))':eval=frame,rotate=angle='${rotation}':fillcolor=none:ow=rotw(iw):oh=roth(ih)[${inputLabel}];`;
    filter += `${composedLabel}[${inputLabel}]overlay=x='main_w*${x}-overlay_w/2':y='main_h*${y}+${floatDistance}*sin((t-${decorationStart})*2)-overlay_h/2':enable='between(t,${decorationStart},${decorationEnd})'[${outputLabel}];`;
    composedLabel = `[${outputLabel}]`;
  };
  const appendPopupLayer = (popupIndex) => {
    const { scene: popupScene, rendered: popup } = popupRenders[popupIndex];
    const popupInputIndex = popupInputIndices[popupIndex];
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
    const popupWidthRatio = clamp(
      (Number(popup.width) || outputWidth * clamp(Number(popupScene.popupWidth ?? 90) / 100, 0.45, 1)) / outputWidth,
      0.45,
      1,
    );
    const popupHeightRatio = clamp(
      (Number(popup.height) || popupPixelHeight(popupScene)) / outputHeight,
      0.2,
      0.88,
    );
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
  };
  const appendSubtitleLayer = (subtitleIndex) => {
    const { scene: subtitle, style, rendered: renderedOverlay } = subtitleRenders[subtitleIndex];
    const cueStart = Math.max(0, Number(subtitle.start) || 0);
    const subtitleStart = Math.min(duration, subtitleOffset + cueStart);
    const subtitleEnd = Math.min(
      duration,
      Math.max(subtitleStart + 0.1, subtitleOffset + (Number(subtitle.end) || cueStart + 0.1)),
    );
    const subtitleOutput = `[subtitled${subtitleIndex}]`;
    const inputIndex = subtitleInputStartIndex + subtitleIndex;
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
      filter += `[${inputIndex}:v]format=rgba,${geqRgba({ alpha: `if(lt(X/W,${progress}),alpha(X,Y),0)` })}[${subtitleInputLabel}];`;
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
  };
  const appendOrderedLayerToken = (token) => {
    const separatorIndex = token.indexOf(":");
    const kind = separatorIndex >= 0 ? token.slice(0, separatorIndex) : "";
    const id = separatorIndex >= 0 ? token.slice(separatorIndex + 1) : "";
    if (kind === "text") {
      const index = textLayerIds.indexOf(id);
      if (index >= 0) appendTextLayer(index);
    } else if (kind === "image") {
      const index = sceneImageLayerIds.indexOf(id);
      if (index >= 0) appendSceneImageLayer(index);
    } else if (kind === "decoration") {
      const index = decorationLayerIds.indexOf(id);
      if (index >= 0) appendDecorationLayer(index);
    } else if (kind === "popup") {
      const index = popupLayerIds.indexOf(id);
      if (index >= 0) appendPopupLayer(index);
    } else if (kind === "subtitle") {
      subtitleRenders.forEach((_, index) => appendSubtitleLayer(index));
    }
  };
  const appendSceneStartDarkEffects = () => {
    sceneEffects.sceneStartDarkEffects
      .filter((darkEffect) => darkEffect.enabled)
      .forEach((darkEffect, darkIndex) => {
        const darkStart = Math.min(duration, Math.max(0, Number(darkEffect.start) || 0));
        if (darkStart >= duration) return;
        const darkEnd = Math.min(
          duration,
          Math.max(darkStart + 0.1, Number(darkEffect.end) || darkStart + 1.2),
        );
        const darkDuration = Math.max(0.1, darkEnd - darkStart);
        const darkHoldDuration = Math.min(
          Math.max(0, darkDuration - 0.1),
          Math.max(0, Number(darkEffect.holdDuration ?? 0) || 0),
        );
        const darkTransitionDuration = Math.max(0.1, darkDuration - darkHoldDuration);
        const darkHalfDuration = Math.max(0.05, darkTransitionDuration / 2);
        const darkHoldStart = darkStart + darkHalfDuration;
        const darkHoldEnd = darkHoldStart + darkHoldDuration;
        const darkProgressRaw = `if(lt(T,${darkStart}),0,if(lt(T,${darkHoldStart}),(T-${darkStart})/${darkHalfDuration},if(lt(T,${darkHoldEnd}),1,if(lt(T,${darkEnd}),(${darkEnd}-T)/${darkHalfDuration},0))))`;
        const darkProgress = `(${darkProgressRaw})*(${darkProgressRaw})*(3-2*(${darkProgressRaw}))`;
        const darkSharpLabel = `sceneStartDarkSharp${darkIndex}`;
        const darkBlurSourceLabel = `sceneStartDarkBlurSource${darkIndex}`;
        const darkBlurredLabel = `sceneStartDarkBlurred${darkIndex}`;
        const darkMixedLabel = `sceneStartDarkMixed${darkIndex}`;
        const darkMaskLabel = `sceneStartDarkMask${darkIndex}`;
        const darkMaskInputIndex = weatherInputIndex + weatherInputSpecs.length;
        const darkStrength = 1 - clamp(Number(darkEffect.intensity ?? 0) || 0, 0, 100) / 100;
        const darkCoverageExpression = `if(lt(T,${darkStart}),0,if(lt(T,${darkEnd}),max(max(0,(${darkProgress}-0.7)/0.3),clip((hypot(X-W/2,Y-H/2)-hypot(W/2,H/2)*(1-${darkProgress}))/max(1,min(W,H)*0.12),0,1)),0))`;
        const darkMaskExpression = `255*${darkCoverageExpression}`;
        const darkAlphaExpression = `255*${darkStrength}*0.78*${darkCoverageExpression}`;
        weatherInputSpecs.push(
          `color=c=black:s=${outputWidth}x${outputHeight}:r=${fps}:d=${duration},` +
          geqRgb(darkMaskExpression),
        );
        filter += `${composedLabel}split=2[${darkSharpLabel}][${darkBlurSourceLabel}];`;
        filter += `[${darkBlurSourceLabel}]gblur=sigma=12[${darkBlurredLabel}];`;
        filter += `[${darkMaskInputIndex}:v]format=gray[${darkMaskLabel}];`;
        filter += `[${darkSharpLabel}][${darkBlurredLabel}][${darkMaskLabel}]maskedmerge[${darkMixedLabel}];`;
        composedLabel = `[${darkMixedLabel}]`;
        const darkInputIndex = weatherInputIndex + weatherInputSpecs.length;
        const darkLabel = `sceneStartDarkened${darkIndex}`;
        weatherInputSpecs.push(
          `color=c=black:s=${outputWidth}x${outputHeight}:r=${fps}:d=${duration},format=rgba,` +
          geqRgba({ red: "0", green: "0", blue: "0", alpha: darkAlphaExpression }),
        );
        filter += `${composedLabel}[${darkInputIndex}:v]overlay=0:0:shortest=1[${darkLabel}];`;
        composedLabel = `[${darkLabel}]`;
      });
  };
  // Match the preview stacking context: base layers first, dark effect next,
  // then text/subtitles, with fade-black transitions applied last.
  orderedLayerTokens
    .filter((token) => !token.startsWith("text:") && !token.startsWith("subtitle:"))
    .forEach(appendOrderedLayerToken);
  appendSceneStartDarkEffects();
  orderedLayerTokens
    .filter((token) => token.startsWith("text:"))
    .forEach(appendOrderedLayerToken);
  orderedLayerTokens
    .filter((token) => token.startsWith("subtitle:"))
    .forEach(appendOrderedLayerToken);

  sceneImageRenders.forEach(({ scene: image }, imageIndex) => {
    if (normalizeSceneImageTransition(image.transition) !== "fade-black") return;
    const fadeStart = Math.min(duration, Math.max(0, Number(image.start ?? 0) || 0));
    const fadeDuration = sceneImageTransitionDuration(image);
    if (fadeDuration <= 0 || fadeStart >= duration) return;
    const halfDuration = Math.max(0.05, fadeDuration / 2);
    const fadeInputIndex = weatherInputIndex + weatherInputSpecs.length;
    const fadeLabel = `sceneImageFadeBlack${imageIndex}`;
    weatherInputSpecs.push(
      `color=c=black:s=${outputWidth}x${outputHeight}:r=${fps}:d=${duration},format=rgba,` +
      `fade=t=in:st=${fadeStart}:d=${halfDuration}:alpha=1,` +
      `fade=t=out:st=${fadeStart + halfDuration}:d=${halfDuration}:alpha=1`,
    );
    filter += `${composedLabel}[${fadeInputIndex}:v]overlay=0:0:shortest=1[${fadeLabel}];`;
    composedLabel = `[${fadeLabel}]`;
  });
  filter += `${composedLabel}copy[composed]`;
  // Weather, subtitles and layered media can make a filter graph much longer
  // than Windows' process command-line limit. Keep the graph in a file so a
  // scene with all environmental effects can still be rendered reliably.
  const args = ["-y"];
  const addInput = (...inputArgs) => {
    const inputIndex = inputArgs.indexOf("-i");
    const boundedInputArgs = inputIndex < 0
      ? inputArgs
      : [
          ...inputArgs.slice(0, inputIndex),
          "-t", String(duration),
          ...inputArgs.slice(inputIndex),
        ];
    args.push(
      "-thread_queue_size", String(ffmpegInputQueueSize),
      ...boundedInputArgs,
    );
  };
  addInput(
    ...(backgroundIsVideo
      ? ["-stream_loop", "-1", "-i", sceneBackground]
      : ["-loop", "1", "-i", sceneBackground]),
  );
  textOverlayRenders.forEach(({ rendered: overlay }) => {
    addInput("-loop", "1", "-i", overlay.path);
  });
  decorationRenders.forEach(({ rendered: decoration }) => {
    if (decoration.animated) {
      addInput("-stream_loop", "-1", "-i", decoration.path);
    } else {
      addInput("-loop", "1", "-i", decoration.path);
    }
  });
  sceneImageRenders.forEach(({ rendered: image }) => {
    if (image.animated) {
      if (image.frameSequence) {
        addInput("-stream_loop", "-1", "-f", "concat", "-safe", "0", "-i", image.path);
      } else {
        addInput("-stream_loop", "-1", "-i", image.path);
      }
      addInput("-loop", "1", "-i", image.maskPath);
      if (image.fillPath) addInput("-loop", "1", "-i", image.fillPath);
      if (image.borderPath) addInput("-loop", "1", "-i", image.borderPath);
    } else {
      addInput("-loop", "1", "-i", image.path);
    }
  });
  popupRenders.forEach(({ rendered: popup }) => {
    addInput("-loop", "1", "-i", popup.path);
    if (popup.video) {
      if (popup.videoFrameSequence) {
        addInput("-stream_loop", "-1", "-f", "concat", "-safe", "0", "-i", popup.video);
      } else {
        addInput("-stream_loop", "-1", "-i", popup.video);
      }
      addInput("-loop", "1", "-i", popup.borderPath);
    }
  });
  subtitleRenders.forEach(({ rendered: subtitle }) => {
    addInput("-loop", "1", "-i", subtitle.path);
  });
  weatherInputSpecs.forEach((specification) => {
    if (typeof specification === "object" && specification?.type === "file") {
      addInput("-loop", "1", "-i", specification.path);
    } else {
      addInput("-f", "lavfi", "-i", specification);
    }
  });
  const audioInputIndex = subtitleInputStartIndex + subtitleRenders.length + weatherInputSpecs.length;
  if (resolvedSceneAudioTracks.length) {
    resolvedSceneAudioTracks.forEach((track) => addInput("-i", track.path));
  } else {
    addInput("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  }
  const voiceDelayFilter = voice && voiceStart > 0
    ? `adelay=${Math.round(voiceStart * 1000)}:all=1,`
    : "";
  let audioMapArgs;
  if (resolvedSceneAudioTracks.length) {
    const audioLabels = [];
    const audioChains = resolvedSceneAudioTracks.map((track, trackIndex) => {
      const inputIndex = audioInputIndex + trackIndex;
      const label = `sceneAudio${trackIndex}`;
      const clipDuration = Math.max(0.1, track.end - track.start);
      const delayFilter = trackIndex === 0
        ? voiceDelayFilter
        : track.start > 0
          ? `adelay=${Math.round(track.start * 1000)}:all=1,`
          : "";
      const volumeFilter = trackIndex === 0
        ? `volume=${voiceVolume.toFixed(3)}`
        : `volume=${track.volume.toFixed(3)}`;
      audioLabels.push(`[${label}]`);
      return `[${inputIndex}:a:0]atrim=start=0:end=${clipDuration.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `${delayFilter}aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo,${volumeFilter}[${label}]`;
    });
    filter += `;${audioChains.join(";")};${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0,apad,atrim=duration=${duration}[sceneAudioMixed]`;
    audioMapArgs = ["-map", "[sceneAudioMixed]"];
  } else {
    audioMapArgs = [
      "-map", `${audioInputIndex}:a:0`,
      "-af", "aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo,apad",
    ];
  }
  // Audio chains are appended to the same filter graph as the video chain.
  // Write the script only after this block; writing it earlier silently drops
  // [sceneAudioMixed] and makes FFmpeg fail with exit code -22 on scenes that
  // contain narration/audio tracks.
  const filterScriptPath = path.join(renderDir, `scene-${index + 1}-filtergraph.txt`);
  await fs.writeFile(filterScriptPath, filter, "utf8");
  args.push(
    "-filter_threads", String(ffmpegFilterThreads),
    "-filter_complex_threads", String(ffmpegFilterThreads),
    "-filter_complex_script", filterScriptPath,
    "-map", "[composed]",
  );
  args.push(...audioMapArgs);
  args.push(
    "-t", String(duration),
    "-r", String(fps),
    "-c:v", "libx264", "-preset", videoPreset, "-crf", videoCrf,
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", audioBitrate, "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    clip,
  );
  console.log(`Rendering scene ${index + 1}/${scenes.length}: ${scene.sceneName ?? scene.title ?? `Cảnh ${index + 1}`}`);
  await run(ffmpeg, args);
  clipPaths.push(clip);
  console.log(`Scene complete ${index + 1}/${scenes.length}`);
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
console.log(`Render stage: joining ${clipPaths.length} rendered scenes`);
await run(ffmpeg, [
  "-y",
  "-f", "concat",
  "-safe", "0",
  "-i", concatFile,
  "-c:v", "copy",
  "-c:a", "aac",
  "-b:a", audioBitrate,
  "-ar", "48000",
  "-ac", "2",
  "-af", "aresample=async=1:first_pts=0",
  "-movflags", "+faststart",
  narrationVideo,
]);

if (music) {
  console.log("Render stage: mixing background music");
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
    "-b:a", audioBitrate,
    "-t", String(timelineDuration),
    "-movflags", "+faststart",
    outputPath,
  ]);
} else if (narrationVideo !== outputPath) {
  console.log("Render stage: finalizing output");
  await fs.copyFile(narrationVideo, outputPath);
} else {
  console.log("Render stage: finalizing output");
}
console.log(`Rendered: ${outputPath}`);
