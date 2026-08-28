import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { cacheRemoteResource, isRemoteResourceUrl, resourceKey } from "./render-resource-cache.mjs";
import { processSpriteSheetBuffer } from "./sprite-sheet.mjs";
import { measureSvgTextWidth, wrapTextByPixelWidth } from "./render-text-layout.mjs";

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

const renderEncoderModes = ["auto", "cpu", "intel-qsv", "amd-amf", "nvidia-nvenc"];
const encoderCandidates = {
  "intel-qsv": ["h264_qsv"],
  "amd-amf": ["h264_amf"],
  "nvidia-nvenc": ["h264_nvenc"],
};
const encoderLabels = {
  "libx264": "CPU · libx264",
  h264_qsv: "Intel Quick Sync",
  h264_amf: "AMD AMF",
  h264_nvenc: "NVIDIA NVENC",
};

const normalizeRenderEncoder = (value) =>
  renderEncoderModes.includes(String(value)) ? String(value) : "auto";

const captureProcess = (command, args) => new Promise((resolve) => {
  let output = "";
  let settled = false;
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const append = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-12000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const finish = (code) => {
    if (settled) return;
    settled = true;
    resolve({ code: Number(code) || 0, output });
  };
  child.once("error", () => finish(-1));
  child.once("exit", finish);
});

const readAvailableEncoders = async () => {
  const result = await captureProcess(ffmpeg, ["-hide_banner", "-encoders"]);
  if (result.code !== 0) return new Set();
  return new Set(
    [...result.output.matchAll(/\b(h264_(?:qsv|amf|nvenc))\b/g)].map((match) => match[1]),
  );
};

const probeEncoder = async (encoder) => {
  const result = await captureProcess(ffmpeg, [
    "-hide_banner",
    "-loglevel", "error",
    "-f", "lavfi",
    "-i", "color=c=black:s=16x16:r=1",
    "-frames:v", "1",
    "-an",
    "-c:v", encoder,
    "-f", "null",
    "-",
  ]);
  return result.code === 0;
};

const resolveVideoEncoder = async (requested) => {
  const normalized = normalizeRenderEncoder(requested);
  if (normalized === "cpu") {
    return { requested: normalized, codec: "libx264", fallback: false };
  }
  const available = await readAvailableEncoders();
  const candidates = normalized === "auto"
    ? ["h264_qsv", "h264_amf", "h264_nvenc"]
    : encoderCandidates[normalized] ?? [];
  for (const candidate of candidates) {
    if (!available.has(candidate)) continue;
    if (await probeEncoder(candidate)) {
      return { requested: normalized, codec: candidate, fallback: false };
    }
  }
  return {
    requested: normalized,
    codec: "libx264",
    fallback: normalized !== "auto",
  };
};

// A scene can contain many looped PNG/video inputs (for example, dozens of
// subtitle cues). FFmpeg's automatic filter threading and input queues can
// then retain a frame per input until the graph drains, which may exhaust
// memory near the end of a long scene. Keep the graph bounded by default,
// while allowing advanced local setups to opt into larger values.
const ffmpegFilterThreads = Math.max(1, Number(process.env.FFMPEG_FILTER_THREADS ?? 1) || 1);
const ffmpegInputQueueSize = Math.max(1, Number(process.env.FFMPEG_INPUT_QUEUE_SIZE ?? 2) || 2);
const project = JSON.parse(await fs.readFile(jsonPath, "utf8"));
const requestedVideoEncoder = normalizeRenderEncoder(
  process.env.RENDER_VIDEO_ENCODER ?? project.renderEncoder,
);
const resolvedVideoEncoder = await resolveVideoEncoder(requestedVideoEncoder);
console.log(`Video encoder: ${encoderLabels[resolvedVideoEncoder.codec] ?? resolvedVideoEncoder.codec}`);
if (resolvedVideoEncoder.fallback) {
  console.warn(`Encoder ${requestedVideoEncoder} không khả dụng trên máy này; chuyển về CPU · libx264.`);
}
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
const hardwareQuality = renderProfile === "fast" ? "26" : "23";
const videoEncoderArgs = resolvedVideoEncoder.codec === "libx264"
  ? ["-c:v", "libx264", "-preset", videoPreset, "-crf", videoCrf]
  : resolvedVideoEncoder.codec === "h264_qsv"
    ? ["-c:v", "h264_qsv", "-preset", videoPreset, "-global_quality", hardwareQuality]
    : resolvedVideoEncoder.codec === "h264_amf"
      ? [
          "-c:v", "h264_amf",
          "-usage", "transcoding",
          "-quality", renderProfile === "fast" ? "speed" : "quality",
          "-rc", "cqp",
          "-qp_i", hardwareQuality,
          "-qp_p", hardwareQuality,
          "-qp_b", hardwareQuality,
        ]
      : [
          "-c:v", "h264_nvenc",
          "-preset", renderProfile === "fast" ? "p1" : "p4",
          "-rc", "vbr",
          "-cq", hardwareQuality,
        ];
const audioBitrate = renderProfile === "fast" ? "128k" : "192k";
const PREVIEW_REFERENCE_WIDTH = 472;
const PREVIEW_REFERENCE_HEIGHT = PREVIEW_REFERENCE_WIDTH * 16 / 9;
// The browser preview frame has a 4 px border on every side. Percent-based
// layers use its inner containing block, and CSS pixel sizes are relative to
// that same area. Scale renderer typography from those inner dimensions so
// text, padding and popup sections keep the same visual proportions.
const PREVIEW_CANVAS_WIDTH = aspectRatio === "16:9" ? 520 : 352;
const PREVIEW_CANVAS_HEIGHT = aspectRatio === "16:9" ? 289 : 632;
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
const normalizeHexColor = (value, fallback) => {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
};
const normalizeWeatherAngle = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return ((numeric % 360) + 360) % 360;
};
const numberOr = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
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
const nonNegativeDarkEffectNumber = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
};
const normalizeSceneDarkEffectTiming = (value, fallback, limit = 3600) => {
  const raw = value && typeof value === "object" ? value : {};
  const safeLimit = Math.max(0.1, Number(limit) || 3600);
  const start = Math.min(
    Math.max(0, safeLimit - 0.1),
    nonNegativeDarkEffectNumber(raw.start, fallback.start),
  );
  const hasSplitDurations = raw.fadeInDuration !== undefined
    || raw.fadeOutDuration !== undefined;
  const legacyEnd = Math.min(
    safeLimit,
    Math.max(
      start + 0.1,
      nonNegativeDarkEffectNumber(
        raw.end,
        start + fallback.fadeInDuration + fallback.holdDuration + fallback.fadeOutDuration,
      ),
    ),
  );
  const legacyHoldDuration = Math.min(
    Math.max(0, legacyEnd - start - 0.1),
    nonNegativeDarkEffectNumber(raw.holdDuration, fallback.holdDuration),
  );
  let fadeInDuration = hasSplitDurations
    ? nonNegativeDarkEffectNumber(raw.fadeInDuration, fallback.fadeInDuration)
    : Math.max(0, (legacyEnd - start - legacyHoldDuration) / 2);
  let holdDuration = hasSplitDurations
    ? nonNegativeDarkEffectNumber(raw.holdDuration, fallback.holdDuration)
    : legacyHoldDuration;
  let fadeOutDuration = hasSplitDurations
    ? nonNegativeDarkEffectNumber(raw.fadeOutDuration, fallback.fadeOutDuration)
    : Math.max(0, legacyEnd - start - legacyHoldDuration - fadeInDuration);
  const availableDuration = Math.max(0.1, safeLimit - start);
  fadeInDuration = Math.min(fadeInDuration, availableDuration);
  holdDuration = Math.min(holdDuration, Math.max(0, availableDuration - fadeInDuration));
  fadeOutDuration = Math.min(
    fadeOutDuration,
    Math.max(0, availableDuration - fadeInDuration - holdDuration),
  );
  if (fadeInDuration + holdDuration + fadeOutDuration < 0.1) {
    fadeOutDuration = Math.min(availableDuration, 0.1);
  }
  return {
    start,
    fadeInDuration,
    holdDuration,
    fadeOutDuration,
    end: start + fadeInDuration + holdDuration + fadeOutDuration,
  };
};
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
const weatherEffectDefinitions = [
  { type: "snow", enabledKey: "snowEnabled", intensityKey: "snowIntensity", speedKey: "snowSpeed", intensity: 55, speed: 1, color: "#ffffff", size: 100, density: 100, movementMode: "angle", movementAngle: 90 },
  { type: "light-flicker", enabledKey: "lightFlickerEnabled", intensityKey: "lightFlickerIntensity", speedKey: "lightFlickerSpeed", intensity: 45, speed: 1, color: "#fff2ae", size: 100, density: 100, movementMode: "angle", movementAngle: 0 },
  { type: "rain", enabledKey: "rainEnabled", intensityKey: "rainIntensity", speedKey: "rainSpeed", intensity: 55, speed: 1, color: "#cae5ff", size: 100, density: 100, movementMode: "angle", movementAngle: 90 },
  { type: "thunder", enabledKey: "thunderEnabled", intensityKey: "thunderIntensity", speedKey: "thunderSpeed", intensity: 55, speed: 1, color: "#e1f2ff", size: 100, density: 100, movementMode: "angle", movementAngle: 0 },
  { type: "cloud", enabledKey: "cloudEnabled", intensityKey: "cloudIntensity", speedKey: "cloudSpeed", intensity: 50, speed: 1, color: "#e0ecf8", size: 100, density: 100, movementMode: "angle", movementAngle: 0 },
  { type: "sandstorm", enabledKey: "sandstormEnabled", intensityKey: "sandstormIntensity", speedKey: "sandstormSpeed", intensity: 45, speed: 1, color: "#f2c26b", size: 100, density: 100, movementMode: "angle", movementAngle: 0 },
  { type: "star-twinkle", enabledKey: "starTwinkleEnabled", intensityKey: "starTwinkleIntensity", speedKey: "starTwinkleSpeed", intensity: 60, speed: 1, color: "#fff6c9", size: 100, density: 100, movementMode: "angle", movementAngle: 0 },
];

const normalizeSceneWeatherEffects = (value, duration = 3600) => {
  const raw = value && typeof value === "object" ? value : {};
  const safeDuration = Math.max(0.1, Number(duration) || 3600);
  const storedEffects = Array.isArray(raw.weatherEffects) ? raw.weatherEffects : [];
  const hasLegacyWeatherEffects = weatherEffectDefinitions.some(
    (definition) => raw[definition.enabledKey] === true,
  );
  // Keep old projects renderable when they contain legacy enabled flags but
  // an empty weatherEffects array from a newer save format.
  const source = storedEffects.length > 0
    ? storedEffects
    : hasLegacyWeatherEffects
      ? weatherEffectDefinitions.flatMap((definition) => raw[definition.enabledKey] === true
        ? [{
            id: `weather-${definition.type}-1`,
            type: definition.type,
            enabled: true,
            start: 0,
            end: safeDuration,
            intensity: raw[definition.intensityKey] ?? definition.intensity,
            speed: raw[definition.speedKey] ?? definition.speed,
          }]
        : [])
      : storedEffects;
  return Array.isArray(source) ? source.map((item, index) => {
    const candidate = item && typeof item === "object" ? item : {};
    const definition = weatherEffectDefinitions.find((entry) => entry.type === candidate.type)
      ?? weatherEffectDefinitions[index % weatherEffectDefinitions.length];
    const start = Math.min(Math.max(0, safeDuration - 0.1), Math.max(0, Number(candidate.start) || 0));
    const end = Math.min(safeDuration, Math.max(start + 0.1, Number(candidate.end) || safeDuration));
    return {
      id: String(candidate.id ?? `weather-${definition.type}-${index + 1}`),
      type: definition.type,
      enabled: candidate.enabled !== false,
      start,
      end,
      intensity: clamp(Number(candidate.intensity ?? definition.intensity) || definition.intensity, 0, 100),
      speed: clamp(numberOr(candidate.speed, definition.speed), 0, 3),
      flickerSpeed: clamp(
        numberOr(candidate.flickerSpeed, numberOr(candidate.speed, definition.speed)),
        0,
        10,
      ),
      customImage: String(candidate.customImage ?? "").trim(),
      color: normalizeHexColor(candidate.color, definition.color),
      opacity: clamp(numberOr(candidate.opacity, 100), 0, 100),
      size: clamp(numberOr(candidate.size, definition.size), 25, 300),
      width: clamp(numberOr(candidate.width, 100), 5, 200),
      height: clamp(numberOr(candidate.height, 100), 5, 200),
      density: clamp(numberOr(candidate.density, definition.density), 10, 1000),
      movementMode: candidate.movementMode === "random" ? "random" : definition.movementMode,
      movementAngle: normalizeWeatherAngle(candidate.movementAngle, definition.movementAngle),
      randomness: clamp(numberOr(candidate.randomness, 45), 0, 100),
      blur: clamp(numberOr(candidate.blur, 0), 0, 12),
      glow: clamp(numberOr(candidate.glow, 55), 0, 100),
      trail: clamp(numberOr(candidate.trail, 0), 0, 200),
      spread: clamp(numberOr(candidate.spread, 100), 20, 180),
      offsetX: clamp(numberOr(candidate.offsetX, 0), -100, 100),
      offsetY: clamp(numberOr(candidate.offsetY, 0), -100, 100),
    };
  }) : [];
};

const sceneWeatherEffectsOfType = (effects, type) =>
  effects.weatherEffects.filter((effect) => effect.type === type && effect.enabled && effect.intensity > 0);

const normalizeSceneEffects = (value, duration = 3600) => {
  const raw = value && typeof value === "object" ? value : {};
  const legacyDuration = Math.max(0.1, Number(raw.sceneStartDarkDuration ?? 1.2) || 1.2);
  const legacyTiming = normalizeSceneDarkEffectTiming(
    { start: 0, end: legacyDuration },
    { start: 0, fadeInDuration: legacyDuration / 2, holdDuration: 0, fadeOutDuration: legacyDuration / 2 },
  );
  const legacyDarkEffect = {
    id: "scene-dark-1",
    enabled: raw.sceneStartDarkEnabled === true,
    ...legacyTiming,
    intensity: clamp(Number(raw.sceneStartDarkIntensity ?? 0) || 0, 0, 100),
  };
  const darkEffects = Array.isArray(raw.sceneStartDarkEffects)
    ? raw.sceneStartDarkEffects.map((item, index) => {
        const dark = item && typeof item === "object" ? item : {};
        const fallback = {
          start: 0,
          fadeInDuration: 0.6,
          holdDuration: 0,
          fadeOutDuration: 0.6,
        };
        const timing = normalizeSceneDarkEffectTiming(dark, fallback);
        return {
          id: String(dark.id ?? `scene-dark-${index + 1}`),
          enabled: dark.enabled !== false,
          ...timing,
          intensity: clamp(Number(dark.intensity ?? 0) || 0, 0, 100),
        };
      })
    : [legacyDarkEffect];
  const firstDarkEffect = darkEffects[0] ?? legacyDarkEffect;
  const normalized = {
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
    sandstormEnabled: raw.sandstormEnabled === true,
    sandstormIntensity: clamp(Number(raw.sandstormIntensity ?? 45) || 45, 0, 100),
    sandstormSpeed: clamp(Number(raw.sandstormSpeed ?? 1) || 1, 0.2, 3),
    starTwinkleEnabled: raw.starTwinkleEnabled === true,
    starTwinkleIntensity: clamp(Number(raw.starTwinkleIntensity ?? 60) || 60, 0, 100),
    starTwinkleSpeed: clamp(Number(raw.starTwinkleSpeed ?? 1) || 1, 0.2, 3),
    weatherEffects: normalizeSceneWeatherEffects(raw, duration),
  };
  weatherEffectDefinitions.forEach((definition) => {
    const matching = normalized.weatherEffects.filter((effect) => effect.type === definition.type);
    const first = matching[0];
    normalized[definition.enabledKey] = matching.some((effect) => effect.enabled);
    normalized[definition.intensityKey] = first?.intensity ?? normalized[definition.intensityKey];
    normalized[definition.speedKey] = first?.speed ?? normalized[definition.speedKey];
  });
  return normalized;
};

// These seeds intentionally mirror the preview component. Keeping one fixed
// set makes the preview stable and lets the FFmpeg path reproduce the same
// density, stagger and travel time instead of inventing a second weather look.
const snowflakeSeeds = Array.from({ length: 36 }, (_, index) => ({
  x: (index * 37) % 100,
  y: 8 + ((index * 53) % 84),
  size: 2 + ((index * 5) % 5),
  duration: 5.5 + ((index * 17) % 45) / 10,
  delay: -((index * 23) % 80) / 10,
  drift: -24 + ((index * 19) % 49),
}));
const rainDropSeeds = Array.from({ length: 32 }, (_, index) => ({
  x: (index * 29) % 100,
  y: 8 + ((index * 41) % 84),
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
const sandstormSeeds = Array.from({ length: 44 }, (_, index) => ({
  x: -8 + ((index * 29) % 116),
  y: 8 + ((index * 47) % 84),
  size: 1 + ((index * 7) % 4),
  duration: 2.8 + ((index * 13) % 22) / 10,
  delay: -((index * 19) % 38) / 10,
  drift: 34 + ((index * 23) % 52),
  tilt: -10 + ((index * 17) % 24),
}));

const radicalInverse = (index, base) => {
  let value = 0;
  let fraction = 1 / base;
  let current = index + 1;
  while (current > 0) {
    value += (current % base) * fraction;
    current = Math.floor(current / base);
    fraction /= base;
  }
  return value;
};

const starTwinkleSeeds = Array.from({ length: 34 }, (_, index) => ({
  // Keep render output aligned with the preview while avoiding diagonal bands.
  x: 8 + radicalInverse(index, 2) * 84,
  y: 8 + radicalInverse(index, 3) * 84,
  size: 1 + ((index * 7) % 3),
  duration: 1.8 + ((index * 17) % 24) / 10,
  delay: -((index * 29) % 30) / 10,
  glow: 3 + ((index * 11) % 6),
}));

const weatherParticleCount = (seeds, effect) =>
  Math.max(1, Math.round(seeds.length * effect.density / 100));
const weatherParticlePosition = (seed, effect) => {
  const spread = effect.spread / 100;
  return {
    x: 50 + (seed.x - 50) * spread,
    y: 50 + ((seed.y ?? 50) - 50) * spread,
  };
};
const weatherParticleMotion = (effect, index, fallbackAngle, distance = 115) => {
  const angle = effect.movementMode === "random"
    ? normalizeWeatherAngle(effect.movementAngle + ((index * 137) % 360), fallbackAngle)
    : normalizeWeatherAngle(effect.movementAngle, fallbackAngle);
  const variation = 1 + ((((index * 29) % 101) - 50) / 50) * (effect.randomness / 100) * 0.35;
  const radians = angle * Math.PI / 180;
  return {
    angle,
    x: Math.cos(radians) * distance * variation,
    y: Math.sin(radians) * distance * variation,
  };
};

const weatherColorValue = (value, fallback) =>
  normalizeHexColor(value, fallback).slice(1).toUpperCase();

const weatherBlurFilter = (effect) => effect.blur > 0
  ? `,gblur=sigma=${Number(effect.blur).toFixed(2)}`
  : "";

const writeWeatherGradientLayer = async (filename, kind, color) => {
  const isThunder = kind === "thunder";
  const fallbackColor = isThunder ? "#e1f2ff" : "#fff2ae";
  const safeColor = normalizeHexColor(color, fallbackColor);
  const svg = isThunder
    ? `<svg width="${outputWidth}" height="${outputHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="flash" cx="58%" cy="18%" r="48%">
            <stop offset="0" stop-color="${safeColor}" stop-opacity=".92" />
            <stop offset="1" stop-color="${safeColor}" stop-opacity="0" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="${safeColor}" fill-opacity=".35" />
        <rect width="100%" height="100%" fill="url(#flash)" />
      </svg>`
    : `<svg width="${outputWidth}" height="${outputHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="warm" cx="24%" cy="21%" r="32%">
            <stop offset="0" stop-color="${safeColor}" stop-opacity=".9" />
            <stop offset="1" stop-color="${safeColor}" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="amber" cx="78%" cy="68%" r="42%">
            <stop offset="0" stop-color="${safeColor}" stop-opacity=".5" />
            <stop offset="1" stop-color="${safeColor}" stop-opacity="0" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#warm)" />
        <rect width="100%" height="100%" fill="url(#amber)" />
      </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filename);
  return filename;
};

const writeWeatherSandstormHazeLayer = async (filename, width, height, color) => {
  const safeColor = normalizeHexColor(color, "#f2c26b");
  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sandBase" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${safeColor}" stop-opacity=".22" />
        <stop offset="48%" stop-color="${safeColor}" stop-opacity=".34" />
        <stop offset="100%" stop-color="${safeColor}" stop-opacity=".22" />
      </linearGradient>
      <radialGradient id="sandGlow" cx="10%" cy="82%" r="62%">
        <stop offset="0%" stop-color="${safeColor}" stop-opacity=".58" />
        <stop offset="100%" stop-color="${safeColor}" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="sandLow" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="42%" stop-color="${safeColor}" stop-opacity="0" />
        <stop offset="100%" stop-color="${safeColor}" stop-opacity=".24" />
      </linearGradient>
      <pattern id="sandStreaks" width="42" height="30" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
        <rect width="42" height="30" fill="none" />
        <rect x="0" y="12" width="42" height="3" rx="1.5" fill="${safeColor}" fill-opacity=".14" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#sandBase)" />
    <rect width="100%" height="100%" fill="url(#sandGlow)" />
    <rect width="100%" height="100%" fill="url(#sandLow)" />
    <rect x="-18%" y="-18%" width="136%" height="136%" fill="url(#sandStreaks)" opacity=".85" />
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filename);
  return filename;
};

const weatherPhaseExpression = (cycle, delay, timeVariable = "T", start = 0) => {
  const safeCycle = Math.max(0.05, Number(cycle) || 1);
  // Make the modulo numerator positive so a negative CSS animation-delay
  // starts at the same deterministic phase in FFmpeg.
  const offset = safeCycle * 12 + Number(delay || 0);
  return `mod(${timeVariable}-${Number(start || 0).toFixed(4)}+${offset.toFixed(4)},${safeCycle.toFixed(4)})/${safeCycle.toFixed(4)}`;
};

const weatherFadeExpression = (phase, plateau = 0.9) =>
  `if(lt(${phase},0.1),${plateau.toFixed(4)}*${phase}/0.1,if(gt(${phase},0.9),${plateau.toFixed(4)}*(1-${phase})/0.1,${plateau.toFixed(4)}))`;

const weatherWindowExpression = (effect, timeVariable = "T") =>
  `if(lt(${timeVariable},${Number(effect.start).toFixed(4)}),0,if(gte(${timeVariable},${Number(effect.end).toFixed(4)}),0,1))`;
const WEATHER_FLICKER_SPEED_AT_ZERO = 0.18;
const isWeatherFlickerEffect = (effect) =>
  effect.type === "light-flicker" || effect.type === "thunder" || effect.type === "star-twinkle";
const weatherFlickerRate = (speed) =>
  Math.max(WEATHER_FLICKER_SPEED_AT_ZERO, Math.min(10, Number(speed) || 0));
const weatherEffectCycle = (effect, baseCycle, minimum = 0.05, speed = effect.speed) =>
  isWeatherFlickerEffect(effect)
    ? Math.max(minimum, baseCycle / weatherFlickerRate(speed))
    : speed > 0
    ? Math.max(minimum, baseCycle / speed)
    : effect.type === "star-twinkle"
      ? Math.max(minimum, baseCycle / 0.7)
      : 1;
const weatherEffectPhase = (effect, cycle, delay, timeVariable, start, speed = effect.speed) =>
  (effect.type === "light-flicker" || effect.type === "thunder" || effect.type === "star-twinkle")
    ? weatherPhaseExpression(cycle, delay, timeVariable, start)
    : speed > 0
    ? weatherPhaseExpression(cycle, delay, timeVariable, start)
    : effect.type === "star-twinkle"
      ? weatherPhaseExpression(cycle, delay, timeVariable, start)
    : effect.type === "thunder" ? "0.35" : "0.5";

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

const popupRenderFontFamily = "Render Be Vietnam Pro";
const popupFontRanges = {
  vietnamese: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
  latinExt: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
  latin: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
};
const popupFontFaces = [
  { weight: 400, file: "be-vietnam-pro-9473b8f2.woff2", range: popupFontRanges.vietnamese },
  { weight: 400, file: "be-vietnam-pro-883ecb8b.woff2", range: popupFontRanges.latinExt },
  { weight: 400, file: "be-vietnam-pro-885461ae.woff2", range: popupFontRanges.latin },
  { weight: 700, file: "be-vietnam-pro-0d107474.woff2", range: popupFontRanges.vietnamese },
  { weight: 700, file: "be-vietnam-pro-bcb4e33f.woff2", range: popupFontRanges.latinExt },
  { weight: 700, file: "be-vietnam-pro-e5c68d27.woff2", range: popupFontRanges.latin },
];
let popupFontCssPromise;
const readPopupFontFile = async (file) => {
  const candidates = [
    path.join(root, "assets", "_vinext_fonts", "be-vietnam-pro-11ccb883d025", file),
    path.join(root, ".vinext", "fonts", "be-vietnam-pro-11ccb883d025", file),
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch {
      // Try the next bundled build location.
    }
  }
  throw new Error(`Không tìm thấy font Popup ${file}`);
};
const loadPopupFontCss = () => {
  popupFontCssPromise ??= Promise.all(popupFontFaces.map(async (face) => {
    const data = (await readPopupFontFile(face.file)).toString("base64");
    return `@font-face{font-family:'${popupRenderFontFamily}';font-style:normal;font-weight:${face.weight};src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${face.range};}`;
  })).then((rules) => rules.join("\n")).catch((error) => {
    console.warn(`Không thể nạp font Popup giống Preview: ${error.message}`);
    return "";
  });
  return popupFontCssPromise;
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
        subtitleCueIds: Array.isArray(track.subtitleCueIds)
          ? track.subtitleCueIds.map((cueId) => String(cueId))
          : undefined,
      };
    });
};

const subtitleAudioStartForRender = (subtitle, audioTracks, fallbackStart) => {
  const subtitleId = String(subtitle?.id ?? "");
  const linkedTrack = audioTracks.find((track, trackIndex) => (
    Array.isArray(track.subtitleCueIds)
      ? track.subtitleCueIds.includes(subtitleId)
      : trackIndex === 0
  ));
  return linkedTrack
    ? Math.max(0, Number(linkedTrack.start) || 0)
    : Math.max(0, Number(fallbackStart) || 0);
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
    travel: { background: "#262118", backgroundOpacity: 0.94, title: "#fff3d6", body: "#e9ddc7", border: "#aa772c", accent: "#dda13e" },
    sunset: { background: "#3d1d2b", backgroundOpacity: 0.95, title: "#fff2e5", body: "#ffd1bd", border: "#ef8354", accent: "#ffb26b" },
    ocean: { background: "#122b3b", backgroundOpacity: 0.95, title: "#e8fbff", body: "#b9e9f4", border: "#39c5d8", accent: "#65d7e8" },
    minimal: { background: "#fbfaf7", backgroundOpacity: 0.97, title: "#2d2a26", body: "#5b554d", border: "#9b7d5d", accent: "#9b7d5d" },
  }[scene.popupTheme ?? "travel"] ?? { background: "#262118", backgroundOpacity: 0.94, title: "#fff3d6", body: "#e9ddc7", border: "#aa772c", accent: "#dda13e" };
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
  const popupFontCss = showText ? await loadPopupFontCss() : "";
  const popupFontFamily = popupFontCss ? popupRenderFontFamily : "Arial";
  const titleLineHeight = Math.round(previewPx(22.5));
  const titleBaseY = contentTop + Math.round(previewPx(
    layout === "quote" ? 51 : layout === "stats" ? 67 : 36,
  ));
  const bodyWithoutTitleY = contentTop + Math.round(previewPx(
    layout === "quote" ? 47 : layout === "stats" ? 64 : 32,
  ));
  const titleLines = titleValue
    ? await wrapTextByPixelWidth(titleValue.toUpperCase(), contentWidth, {
        fontCss: popupFontCss,
        fontKey: `popup-title-${popupFontFamily}`,
        fontFamily: popupFontFamily,
        fontSize: titleFontSize,
        fontWeight: 400,
      })
    : [];
  const bodyY = titleLines.length
    ? titleBaseY + (titleLines.length - 1) * titleLineHeight + Math.round(previewPx(24))
    : bodyWithoutTitleY;
  const maxBodyLines = Math.max(
    0,
    Math.floor((contentTop + contentHeight - bodyY - previewPx(15)) / bodyLineHeight) + 1,
  );
  const bodyLines = bodyValue
    ? (await wrapTextByPixelWidth(bodyValue, contentWidth, {
        fontCss: popupFontCss,
        fontKey: `popup-body-${popupFontFamily}`,
        fontFamily: popupFontFamily,
        fontSize: bodyFontSize,
        fontWeight: 400,
      })).slice(0, maxBodyLines)
    : [];
  const titleText = titleLines.map((line, lineIndex) =>
    `<text x="${contentX}" y="${titleBaseY + lineIndex * titleLineHeight}" font-size="${titleFontSize}" fill="${colors.title}">${escapeXml(line)}</text>`,
  ).join("");
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
    : `<rect x="${borderWidth / 2}" y="${borderWidth / 2}" width="${width - borderWidth}" height="${height - borderWidth}" rx="${radius}" fill="${colors.background}" fill-opacity="${colors.backgroundOpacity}"/>`;
  // Keep the render in sync with the editor preview. The preview's media
  // area always has this light sky/sand background when transparent media is
  // disabled. Without it, transparent pixels in a PNG/WebP reveal the dark
  // popup card background during export.
  const mediaBackground = showVisual && !transparentMedia
    ? `<g clip-path="url(#imageClip)"><rect width="${imageWidth}" height="${imageHeight}" fill="url(#popupMediaBackground)"/></g>`
    : "";
  const quoteMark = showText && layout === "quote"
    ? `<text x="${contentX}" y="${contentTop + Math.round(previewPx(38))}" font-family="Georgia" font-weight="700" font-size="${Math.round(previewPx(46))}" fill="${colors.accent}" fill-opacity=".85">“</text>`
    : "";
  const statRow = showText && layout === "stats"
    ? `<text x="${contentX}" y="${contentTop + Math.round(previewPx(27))}" font-family="${popupFontFamily}" font-weight="700" font-size="${Math.round(previewPx(9))}" letter-spacing="${previewPx(1.08)}" fill="${colors.accent}">${escapeXml(String(scene.location || "HÀNH TRÌNH").toUpperCase())}</text><text x="${width - paddingX}" y="${contentTop + Math.round(previewPx(31))}" text-anchor="end" font-family="${popupFontFamily}" font-weight="700" font-size="${Math.round(previewPx(18))}" fill="${colors.accent}">${escapeXml(String(scene.milestone ?? index + 1).padStart(2, "0"))}</text>`
    : "";
  const svg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>${popupFontCss}</style>
      <defs>
        <linearGradient id="placeholderSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#c9e4f5"/><stop offset="100%" stop-color="#f6d8af"/></linearGradient>
        <linearGradient id="popupMediaBackground" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#c9e4f5"/><stop offset="100%" stop-color="#f6d8af"/></linearGradient>
        <clipPath id="imageClip"><path d="${imageClipPath}"/></clipPath>
      </defs>
      ${cardBackground}
      ${mediaBackground}
      ${hasVisual && !image && !video && layout !== "quote" ? `<g clip-path="url(#imageClip)">${placeholder}<circle cx="${width * 0.78}" cy="${previewPx(30)}" r="${previewPx(14)}" fill="#ffe1a3"/><ellipse cx="${width * 0.25}" cy="${imageHeight + previewPx(22)}" rx="${width * 0.48}" ry="${previewPx(48)}" fill="#769b79"/><ellipse cx="${width * 0.82}" cy="${imageHeight + previewPx(28)}" rx="${width * 0.44}" ry="${previewPx(52)}" fill="#557c64"/></g>` : ""}
      ${quoteMark}${statRow}
      <g font-family="${popupFontFamily}" font-weight="400">${titleText}${bodyText}</g>
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
  const fontOptions = [
    "Arial",
    "Segoe UI",
    "Calibri",
    "Cambria",
    "Trebuchet MS",
    "Tahoma",
    "Verdana",
    "Georgia",
    "Book Antiqua",
    "Times New Roman",
    "Courier New",
  ];
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
  const fontWeight = String(overlay?.style ?? "normal").includes("bold") ? 700 : 400;
  const fontStyle = String(overlay?.style ?? "normal").includes("italic") ? "italic" : "normal";
  // Browser Preview finishes the letter-spacing animation at zero. Keeping a
  // permanent 5 px gap in the raster made the exported text wider than its
  // final Preview state and changed its line breaks.
  const letterSpacing = 0;
  const textMeasureOptions = {
    fontKey: `overlay-${font}-${fontWeight}-${fontStyle}-${size}`,
    fontFamily: font,
    fontSize: size,
    fontWeight,
    fontStyle,
    letterSpacing,
  };
  const requestedBoxWidth = Number(overlay?.boxWidth ?? overlay?.width);
  const minimumBoxWidth = overlay?.boxWidth !== undefined ? 0.4 : 0.04;
  const boxWidth = Number.isFinite(requestedBoxWidth)
    ? Math.round(outputWidth * clamp(requestedBoxWidth / 100, minimumBoxWidth, 1))
    : null;
  const requestedBoxHeight = Number(overlay?.boxHeight ?? overlay?.height);
  const availableContentWidth = Math.max(
    1,
    (boxWidth ?? outputWidth) - paddingX * 2 - borderWidth * 2,
  );
  const sourceLines = text.split(/\r?\n/);
  let lines;
  if (boxWidth) {
    lines = (await Promise.all(sourceLines.map((line) => line
      ? wrapTextByPixelWidth(line, availableContentWidth, textMeasureOptions)
      : [""]))).flat();
  } else {
    const sourceWidths = await Promise.all(sourceLines.map((line) =>
      measureSvgTextWidth(line, textMeasureOptions),
    ));
    lines = Math.max(0, ...sourceWidths) > availableContentWidth
      ? (await Promise.all(sourceLines.map((line) => line
          ? wrapTextByPixelWidth(line, availableContentWidth, textMeasureOptions)
          : [""]))).flat()
      : sourceLines;
  }
  const lineWidths = await Promise.all(lines.map((line) =>
    measureSvgTextWidth(line, textMeasureOptions),
  ));
  const intrinsicWidth = Math.max(
    Math.round(previewPx(32)),
    Math.ceil(Math.max(1, ...lineWidths) + paddingX * 2 + borderWidth * 2),
  );
  const width = boxWidth ?? Math.min(outputWidth, intrinsicWidth);
  const intrinsicHeight = Math.max(
    Math.round(previewPx(24)),
    Math.ceil(lines.length * lineHeight + paddingY * 2 + borderWidth * 2),
  );
  const height = Number.isFinite(requestedBoxHeight)
    ? Math.max(Math.round(previewPx(24)), Math.round(outputHeight * clamp(requestedBoxHeight / 100, 0.03, 0.4)))
    : intrinsicHeight;
  const radius = Math.min(
    Math.round(previewPx(clamp(Number(overlay?.borderRadius ?? 6), 0, 24))),
    Math.floor(Math.min(width, height) / 2),
  );
  const textNodes = lines.map((line, lineIndex) => {
    const y = paddingY + size * 0.86 + lineIndex * lineHeight;
    return `<text x="${width / 2}" y="${y}" text-anchor="middle" font-family="${escapeXml(font)}" font-weight="${fontWeight}" font-style="${fontStyle}" font-size="${size}" letter-spacing="${letterSpacing}" fill="${color}" fill-opacity="${textOpacity}" ${strokeWidth > 0 ? `stroke="${strokeColor}" stroke-opacity="${textOpacity}" stroke-width="${strokeWidth}" paint-order="stroke fill" stroke-linejoin="round"` : ""}>${escapeXml(line)}</text>`;
  }).join("");
  const baseShadowY = Math.max(1, previewPx(2));
  const baseShadowBlur = Math.max(1, previewPx(2.5));
  const liftedShadow = textEffect === "shadow-lift"
    ? `<feDropShadow dx="0" dy="${previewPx(13)}" stdDeviation="${previewPx(8)}" flood-color="#000000" flood-opacity=".35"/>`
    : "";
  const svg = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs><filter id="textBaseShadow" x="-35%" y="-35%" width="170%" height="190%"><feDropShadow dx="0" dy="${baseShadowY}" stdDeviation="${baseShadowBlur}" flood-color="#000000" flood-opacity=".72"/>${liftedShadow}</filter></defs>
      <rect x="${borderWidth / 2}" y="${borderWidth / 2}" width="${Math.max(1, width - borderWidth)}" height="${Math.max(1, height - borderWidth)}" rx="${radius}" fill="${borderFill}" fill-opacity="${borderOpacity}" stroke="${borderColor}" stroke-opacity="${borderOpacity}" stroke-width="${borderWidth}" />
      <g filter="url(#textBaseShadow)">${textNodes}</g>
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
          textEffectReverse: scene.overlayTextEffectReverse,
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
  const nonWeatherLayerCandidates = [
    ...textLayerIds.map((id) => layerToken("text", id)),
    ...popupLayerIds.map((id) => layerToken("popup", id)),
    ...decorationLayerIds.map((id) => layerToken("decoration", id)),
    ...sceneImageLayerIds.map((id) => layerToken("image", id)),
    ...(subtitleRenders.length ? [layerToken("subtitle", "subtitle")] : []),
  ];
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
  const sceneEffects = normalizeSceneEffects(scene.effects, duration);
  const weatherLayerOutputs = [];
  const createWeatherRegion = (effect, label) => {
    const widthPercent = clamp(Number(effect.width ?? 100) / 100, 0.05, 2);
    const heightPercent = clamp(Number(effect.height ?? 100) / 100, 0.05, 2);
    const regionWidth = Math.max(2, Math.round(outputWidth * widthPercent / 2) * 2);
    const regionHeight = Math.max(2, Math.round(outputHeight * heightPercent / 2) * 2);
    const baseInputIndex = weatherInputIndex + weatherInputSpecs.length;
    const baseLabel = `${label}Base`;
    weatherInputSpecs.push(`color=c=black@0:s=${regionWidth}x${regionHeight}:r=${fps}:d=${duration},format=rgba`);
    filter += `[${baseInputIndex}:v]format=rgba[${baseLabel}];`;
    let regionComposedLabel = `[${baseLabel}]`;

    const add = ({ source, input, x, y, label: sourceLabel, inputFilter = "" }) => {
      const inputLabel = `${sourceLabel}Input`;
      if (input) {
        const inputIndex = weatherInputIndex + weatherInputSpecs.length;
        weatherInputSpecs.push(input);
        filter += `[${inputIndex}:v]${inputFilter}[${inputLabel}];`;
      } else {
        const sourceIsLabel = typeof source === "string" && /^\[[^\]]+\]$/.test(source.trim());
        filter += `${source}${inputFilter ? `${sourceIsLabel ? "" : ","}${inputFilter}` : ""}[${inputLabel}];`;
      }
      filter += `${regionComposedLabel}[${inputLabel}]overlay=` +
        `x='${x}':y='${y}':shortest=1:eval=frame[${sourceLabel}];`;
      regionComposedLabel = `[${sourceLabel}]`;
    };

    const finish = () => {
      weatherLayerOutputs.push({
        token: layerToken("effect", `weather:${effect.id}`),
        effect,
        label: regionComposedLabel,
        width: regionWidth,
        height: regionHeight,
      });
    };

    return { width: regionWidth, height: regionHeight, add, finish };
  };
  for (const [effectIndex, effect] of sceneWeatherEffectsOfType(sceneEffects, "light-flicker").entries()) {
    const cycle = weatherEffectCycle(effect, 2.8, 0.2, effect.flickerSpeed);
    const phase = weatherEffectPhase(effect, cycle, 0, "T", effect.start, effect.flickerSpeed);
    const pulse = `if(lt(${phase},0.24),1-0.38*${phase}/0.24,if(lt(${phase},0.45),0.62+0.38*(${phase}-0.24)/0.21,if(lt(${phase},0.68),1-0.3*(${phase}-0.45)/0.23,0.7+0.3*(${phase}-0.68)/0.32)))`;
    const alpha = (
      (effect.intensity / 100)
      * (effect.opacity / 100)
      * 0.68
    ).toFixed(4);
    const lightScaleValue = Math.max(0.25, effect.size / 100);
    const lightPath = await writeWeatherGradientLayer(
      path.join(renderDir, `weather-light-${index + 1}-${effectIndex}.png`),
      "light",
      effect.color,
    );
    const customLightImage = String(effect.customImage ?? "").trim()
      ? await resolveImage(
          effect.customImage,
          `weather-light-${index + 1}-${effectIndex + 1}-custom.png`,
        )
      : null;
    const region = createWeatherRegion(effect, `lightFlickerRegion${effectIndex}`);
    const lightWidth = Math.max(2, Math.round(region.width * lightScaleValue / 2) * 2);
    const lightHeight = Math.max(2, Math.round(region.height * lightScaleValue / 2) * 2);
    region.add({
      ...(customLightImage
        ? {
            input: { type: "file", path: customLightImage },
            inputFilter: `format=rgba,scale=${lightWidth}:${lightHeight}:force_original_aspect_ratio=decrease,pad=${lightWidth}:${lightHeight}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba${weatherBlurFilter(effect)},${geqRgba({ alpha: `alpha(X,Y)*${alpha}*(${pulse})*${weatherWindowExpression(effect)}` })}`,
          }
        : {
            input: { type: "file", path: lightPath },
            inputFilter: `format=rgba,scale=${lightWidth}:${lightHeight}${weatherBlurFilter(effect)},${geqRgba({ alpha: `alpha(X,Y)*${alpha}*(${pulse})*${weatherWindowExpression(effect)}` })}`,
          }),
      x: `(main_w-overlay_w)/2`,
      y: `(main_h-overlay_h)/2`,
      label: `lightFlicker${effectIndex}`,
    });
    region.finish();
  }
  for (const [effectIndex, effect] of sceneWeatherEffectsOfType(sceneEffects, "thunder").entries()) {
    const cycle = weatherEffectCycle(effect, 3.6, 0.4, effect.flickerSpeed);
    const phase = weatherEffectPhase(effect, cycle, 0, "T", effect.start, effect.flickerSpeed);
    const pulse = `if(lt(${phase},0.31),0,if(lt(${phase},0.33),0.72*(${phase}-0.31)/0.02,if(lt(${phase},0.35),0.72-0.57*(${phase}-0.33)/0.02,if(lt(${phase},0.37),0.15+0.75*(${phase}-0.35)/0.02,if(lt(${phase},0.4),0.9*(0.4-${phase})/0.03,if(lt(${phase},0.68),0,if(lt(${phase},0.7),0.48*(${phase}-0.68)/0.02,if(lt(${phase},0.72),0.48*(0.72-${phase})/0.02,0))))))))`;
    const alpha = (
      (effect.intensity / 100)
      * (effect.opacity / 100)
      * (0.35 + (effect.glow / 100) * 0.65)
      * 0.78
    ).toFixed(4);
    const thunderScaleValue = Math.max(0.25, effect.size / 100);
    const thunderPath = await writeWeatherGradientLayer(
      path.join(renderDir, `weather-thunder-${index + 1}-${effectIndex}.png`),
      "thunder",
      effect.color,
    );
    const region = createWeatherRegion(effect, `thunderRegion${effectIndex}`);
    const thunderWidth = Math.max(2, Math.round(region.width * thunderScaleValue / 2) * 2);
    const thunderHeight = Math.max(2, Math.round(region.height * thunderScaleValue / 2) * 2);
    region.add({
      input: { type: "file", path: thunderPath },
      x: `(W-overlay_w)/2`,
      y: `(H-overlay_h)/2`,
      label: `thunder${effectIndex}`,
      inputFilter: `format=rgba,scale=${thunderWidth}:${thunderHeight}${weatherBlurFilter(effect)},${geqRgba({ alpha: `alpha(X,Y)*${alpha}*(${pulse})*${weatherWindowExpression(effect)}` })}`,
    });
    region.finish();
  }
  for (const [effectIndex, effect] of sceneWeatherEffectsOfType(sceneEffects, "cloud").entries()) {
    const region = createWeatherRegion(effect, `cloudRegion${effectIndex}`);
    for (let cloudIndex = 0; cloudIndex < cloudSeeds.length; cloudIndex += 1) {
      const cloud = cloudSeeds[cloudIndex];
      const cloudWidth = Math.max(12, Math.round(region.width * cloud.width / 100));
      const cloudHeight = Math.max(10, Math.round(region.height * cloud.height / 100));
      const cycle = weatherEffectCycle(effect, cloud.duration);
      const phase = weatherEffectPhase(effect, cycle, cloud.delay, "T", effect.start);
      const overlayPhase = weatherEffectPhase(effect, cycle, cloud.delay, "t", effect.start);
      const opacity = weatherFadeExpression(phase, 0.9);
      const travel = `(-0.45+(${overlayPhase})*(${cloud.drift / 100 + 0.45}))`;
      const cloudMask = "if(gt(lte((X-W*0.5)^2/(W*0.5)^2+(Y-H*0.52)^2/(H*0.45)^2,1)+lte((X-W*0.7)^2/(W*0.28)^2+(Y-H*0.42)^2/(H*0.37)^2,1)+lte((X-W*0.3)^2/(W*0.25)^2+(Y-H*0.56)^2/(H*0.32)^2,1),0),alpha(X,Y),0)";
      region.add({
        source: `color=c=0xE0ECF8@0.48:s=${cloudWidth}x${cloudHeight}:r=${fps}:d=${duration},format=rgba,${geqRgba({ alpha: cloudMask })},boxblur=${Math.max(1, Math.round(previewPx(5)))}:1`,
        x: `main_w*${(cloud.x / 100).toFixed(4)}+overlay_w*${travel}`,
        y: `main_h*${(cloud.y / 100).toFixed(4)}`,
        label: `cloud${effectIndex}_${cloudIndex}`,
        inputFilter: `format=rgba,${geqRgba({ alpha: `alpha(X,Y)*${(effect.intensity / 100).toFixed(4)}*(${opacity})*${weatherWindowExpression(effect)}` })}`,
      });
    }
    region.finish();
  }
  for (const [effectIndex, effect] of sceneWeatherEffectsOfType(sceneEffects, "rain").entries()) {
    const rainColor = weatherColorValue(effect.color, "#cae5ff");
    const rainCount = weatherParticleCount(rainDropSeeds, effect);
    const rainOpacity = ((effect.intensity / 100) * (effect.opacity / 100)).toFixed(4);
    const region = createWeatherRegion(effect, `rainRegion${effectIndex}`);
    for (let rainIndex = 0; rainIndex < rainCount; rainIndex += 1) {
      const drop = rainDropSeeds[rainIndex % rainDropSeeds.length];
      const position = weatherParticlePosition(drop, effect);
      const motion = weatherParticleMotion(effect, rainIndex, 90);
      const vectorX = Math.round(region.width * motion.x / 100);
      const vectorY = Math.round(region.height * motion.y / 100);
      const dropSize = Math.max(0.25, effect.size / 100);
      const dropWidth = Math.max(1, Math.round(previewPx(drop.width * dropSize)));
      const dropHeight = Math.max(6, Math.round(previewPx(drop.length * dropSize * (1 + effect.trail / 100))));
      const cycle = weatherEffectCycle(effect, drop.duration);
      const phase = weatherEffectPhase(effect, cycle, drop.delay, "T", effect.start);
      const overlayPhase = weatherEffectPhase(effect, cycle, drop.delay, "t", effect.start);
      const opacity = weatherFadeExpression(phase, 0.9);
      region.add({
        source: `color=c=0x${rainColor}@0.95:s=${dropWidth}x${dropHeight}:r=${fps}:d=${duration},format=rgba,${geqRgba({ alpha: "alpha(X,Y)*Y/H" })},rotate=${((motion.angle - 76) * Math.PI / 180).toFixed(6)}:c=none:ow=rotw(iw):oh=roth(ih)${weatherBlurFilter(effect)}`,
        x: `main_w*${(position.x / 100).toFixed(4)}+${vectorX}*(2*(${overlayPhase})-1)-overlay_w/2`,
        y: `main_h*${(position.y / 100).toFixed(4)}+${vectorY}*(2*(${overlayPhase})-1)-overlay_h/2`,
        label: `rain${effectIndex}_${rainIndex}`,
        inputFilter: `format=rgba,${geqRgba({ alpha: `alpha(X,Y)*${rainOpacity}*(${opacity})*${weatherWindowExpression(effect)}` })}`,
      });
    }
    region.finish();
  }
  for (const [effectIndex, effect] of sceneWeatherEffectsOfType(sceneEffects, "snow").entries()) {
    const snowColor = weatherColorValue(effect.color, "#ffffff");
    const snowCount = weatherParticleCount(snowflakeSeeds, effect);
    const snowOpacity = ((effect.intensity / 100) * (effect.opacity / 100)).toFixed(4);
    const region = createWeatherRegion(effect, `snowRegion${effectIndex}`);
    for (let snowIndex = 0; snowIndex < snowCount; snowIndex += 1) {
      const flake = snowflakeSeeds[snowIndex % snowflakeSeeds.length];
      const position = weatherParticlePosition(flake, effect);
      const motion = weatherParticleMotion(effect, snowIndex, 90);
      const vectorX = Math.round(region.width * motion.x / 100);
      const vectorY = Math.round(region.height * motion.y / 100);
      const snowSize = Math.max(1, Math.round(previewPx(flake.size * Math.max(0.25, effect.size / 100))));
      const cycle = weatherEffectCycle(effect, flake.duration);
      const phase = weatherEffectPhase(effect, cycle, flake.delay, "T", effect.start);
      const overlayPhase = weatherEffectPhase(effect, cycle, flake.delay, "t", effect.start);
      const opacity = weatherFadeExpression(phase, 0.92);
      const snowLabel = `snow${effectIndex}_${snowIndex}`;
      region.add({
        source: `color=c=0x${snowColor}@0.92:s=${snowSize}x${snowSize}:r=${fps}:d=${duration},format=rgba,${geqRgba({ alpha: "if(lte((X-W/2)^2+(Y-H/2)^2,(min(W,H)/2)^2),alpha(X,Y),0)" })}${weatherBlurFilter(effect)}`,
        x: `main_w*${(position.x / 100).toFixed(4)}+${vectorX}*(2*(${overlayPhase})-1)-overlay_w/2`,
        y: `main_h*${(position.y / 100).toFixed(4)}+${vectorY}*(2*(${overlayPhase})-1)-overlay_h/2`,
        label: snowLabel,
        inputFilter: `format=rgba,${geqRgba({ alpha: `alpha(X,Y)*${snowOpacity}*(${opacity})*${weatherWindowExpression(effect)}` })}`,
      });
    }
    region.finish();
  }
  // Render the sand grains as real animated overlay streams. Previously the
  // browser preview had particles, but the FFmpeg graph had no sandstorm
  // branch, so rendered videos silently lost the moving dust.
  for (const [effectIndex, effect] of sceneWeatherEffectsOfType(sceneEffects, "sandstorm").entries()) {
    const sandColor = weatherColorValue(effect.color, "#f2c26b");
    const sandCount = weatherParticleCount(sandstormSeeds, effect);
    const region = createWeatherRegion(effect, `sandstormRegion${effectIndex}`);
    const hazePath = await writeWeatherSandstormHazeLayer(
      path.join(renderDir, `weather-sandstorm-haze-${index + 1}-${effectIndex}.png`),
      region.width,
      region.height,
      effect.color,
    );
    const hazePhase = weatherPhaseExpression(
      weatherEffectCycle(effect, 4.8),
      0,
      "T",
      effect.start,
    );
    const hazePulse = `(0.7+0.3*(0.5+0.5*sin(6.283185*${hazePhase})))`;
    const sandHazeOpacity = (
      (effect.intensity / 100)
      * (effect.opacity / 100)
    ).toFixed(4);
    region.add({
      input: { type: "file", path: hazePath },
      x: `(main_w-overlay_w)/2`,
      y: `(main_h-overlay_h)/2`,
      label: `sandstormHaze${effectIndex}`,
      inputFilter: `format=rgba,${geqRgba({ alpha: `alpha(X,Y)*${sandHazeOpacity}*${hazePulse}*${weatherWindowExpression(effect)}` })}`,
    });
    const sandOpacity = (
      (effect.intensity / 100)
      * (effect.opacity / 100)
    ).toFixed(4);
    for (let sandIndex = 0; sandIndex < sandCount; sandIndex += 1) {
      const grain = sandstormSeeds[sandIndex % sandstormSeeds.length];
      const position = weatherParticlePosition(grain, effect);
      const motion = weatherParticleMotion(effect, sandIndex, 0);
      const vectorX = Math.round(region.width * motion.x / 100);
      const vectorY = Math.round(region.height * motion.y / 100);
      const grainSize = Math.max(0.25, effect.size / 100);
      const grainWidth = Math.max(2, Math.round(previewPx(grain.size * 1.8 * grainSize * (1 + effect.trail / 100))));
      const grainHeight = Math.max(2, Math.round(previewPx(grain.size * grainSize)));
      const cycle = weatherEffectCycle(effect, grain.duration);
      const phase = weatherEffectPhase(effect, cycle, grain.delay, "T", effect.start);
      const overlayPhase = weatherEffectPhase(effect, cycle, grain.delay, "t", effect.start);
      const opacity = weatherFadeExpression(phase, 0.98);
      const sandLabel = `sandstorm${effectIndex}_${sandIndex}`;
      region.add({
        source: `color=c=0x${sandColor}@0.98:s=${grainWidth}x${grainHeight}:r=${fps}:d=${duration},format=rgba,${geqRgba({ alpha: "alpha(X,Y)" })}${weatherBlurFilter(effect)}`,
        x: `main_w*${(position.x / 100).toFixed(4)}+${vectorX}*(2*(${overlayPhase})-1)-overlay_w/2`,
        y: `main_h*${(position.y / 100).toFixed(4)}+${vectorY}*(2*(${overlayPhase})-1)-overlay_h/2`,
        label: sandLabel,
        inputFilter: `format=rgba,${geqRgba({ alpha: `alpha(X,Y)*${sandOpacity}*(${opacity})*${weatherWindowExpression(effect)}` })}`,
      });
    }
    region.finish();
  }
  for (const [effectIndex, effect] of sceneWeatherEffectsOfType(sceneEffects, "star-twinkle").entries()) {
    const starColor = weatherColorValue(effect.color, "#fff6c9");
    const starCount = weatherParticleCount(starTwinkleSeeds, effect);
    const customStarImage = String(effect.customImage ?? "").trim()
      ? await resolveImage(
          effect.customImage,
          `weather-star-${index + 1}-${effectIndex + 1}-custom.png`,
        )
      : null;
    const region = createWeatherRegion(effect, `starTwinkleRegion${effectIndex}`);
    const customStarImageLabels = [];
    if (customStarImage) {
      const customImageInputIndex = weatherInputIndex + weatherInputSpecs.length;
      weatherInputSpecs.push({ type: "file", path: customStarImage });
      filter += `[${customImageInputIndex}:v]format=rgba,split=${starCount}`;
      for (let starIndex = 0; starIndex < starCount; starIndex += 1) {
        const label = `starTwinkleCustomImage${effectIndex}_${starIndex}`;
        filter += `[${label}]`;
        customStarImageLabels.push(label);
      }
      filter += ";";
    }
    const starOpacity = (
      (effect.intensity / 100)
      * (effect.opacity / 100)
      * (0.3 + (effect.glow / 100) * 0.7)
    ).toFixed(4);
    for (let starIndex = 0; starIndex < starCount; starIndex += 1) {
      const star = starTwinkleSeeds[starIndex % starTwinkleSeeds.length];
      const position = weatherParticlePosition(star, effect);
      const motion = weatherParticleMotion(effect, starIndex, 0, effect.speed > 0 ? 24 : 0);
      const vectorX = Math.round(region.width * motion.x / 100);
      const vectorY = Math.round(region.height * motion.y / 100);
      const starSize = Math.max(2, Math.round(previewPx(star.size * 2.4 * Math.max(0.25, effect.size / 100))));
      const cycle = weatherEffectCycle(effect, star.duration, 0.05, effect.flickerSpeed);
      const phase = weatherEffectPhase(effect, cycle, star.delay, "T", effect.start, effect.flickerSpeed);
      const overlayPhase = weatherEffectPhase(effect, cycle, star.delay, "t", effect.start, effect.flickerSpeed);
      const opacity = `if(lt(${phase},0.36),0.06+0.24*${phase}/0.36,if(lt(${phase},0.46),0.3+0.7*(${phase}-0.36)/0.1,if(lt(${phase},0.56),1-0.94*(${phase}-0.46)/0.1,0.06)))`;
      const starLabel = `starTwinkle${effectIndex}_${starIndex}`;
      const starSource = customStarImage
        ? {
            source: `[${customStarImageLabels[starIndex]}]`,
            inputFilter: `scale=${starSize}:${starSize}:force_original_aspect_ratio=decrease,pad=${starSize}:${starSize}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba${weatherBlurFilter(effect)}`,
          }
        : {
            source: `color=c=0x${starColor}@0.98:s=${starSize}x${starSize}:r=${fps}:d=${duration},format=rgba,${geqRgba({ alpha: "if(lte((X-W/2)^2+(Y-H/2)^2,(min(W,H)/2)^2),alpha(X,Y),0)" })}${weatherBlurFilter(effect)}`,
          };
      region.add({
        ...starSource,
        x: `main_w*${(position.x / 100).toFixed(4)}+${vectorX}*(2*(${overlayPhase})-1)-overlay_w/2`,
        y: `main_h*${(position.y / 100).toFixed(4)}+${vectorY}*(2*(${overlayPhase})-1)-overlay_h/2`,
        label: starLabel,
        inputFilter: `format=rgba,${geqRgba({ alpha: `alpha(X,Y)*${starOpacity}*(${opacity})*${weatherWindowExpression(effect)}` })}`,
      });
    }
    region.finish();
  }
  const layerCandidates = [
    ...weatherLayerOutputs.map(({ token }) => token),
    ...nonWeatherLayerCandidates,
  ];
  const knownLayerTokens = new Set(layerCandidates);
  const storedLayerOrder = Array.isArray(scene.layerOrder)
    ? scene.layerOrder.filter((token) => typeof token === "string")
    : [];
  const orderedLayerTokens = Array.from(new Set([
    ...storedLayerOrder.filter((token) => knownLayerTokens.has(token)),
    ...layerCandidates.filter((token) => !storedLayerOrder.includes(token)),
  ]));
  const appendWeatherLayer = (weatherIndex) => {
    const weatherLayer = weatherLayerOutputs[weatherIndex];
    if (!weatherLayer) return;
    const centerX = `main_w*(0.5+${(Number(weatherLayer.effect.offsetX ?? 0) / 100).toFixed(4)})-overlay_w/2`;
    const centerY = `main_h*(0.5+${(Number(weatherLayer.effect.offsetY ?? 0) / 100).toFixed(4)})-overlay_h/2`;
    const outputLabel = `weatherLayer${weatherIndex}`;
    filter += `${composedLabel}${weatherLayer.label}overlay=` +
      `x='${centerX}':y='${centerY}':shortest=1:eval=frame[${outputLabel}];`;
    composedLabel = `[${outputLabel}]`;
  };
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
    const reverse = overlay.textEffectReverse === true || overlay.overlayTextEffectReverse === true;
    const effectDuration = clamp(
      Number(overlay.textEffectDuration ?? overlay.overlayTextEffectDuration ?? 0.6) || 0.6,
      0.05,
      reverse ? textSpan / 2 : textSpan,
    );
    const reverseStart = textEnd - effectDuration;
    const forwardProgress = `min(1,max(0,(t-${textStart})/${effectDuration}))`;
    const forwardGeqProgress = `min(1,max(0,(T-${textStart})/${effectDuration}))`;
    const reverseProgress = `min(1,max(0,(${textEnd}-t)/${effectDuration}))`;
    const reverseGeqProgress = `min(1,max(0,(${textEnd}-T)/${effectDuration}))`;
    const progress = reverse
      ? `if(lt(t,${reverseStart}),${forwardProgress},${reverseProgress})`
      : forwardProgress;
    const geqProgress = reverse
      ? `if(lt(T,${reverseStart}),${forwardGeqProgress},${reverseGeqProgress})`
      : forwardGeqProgress;
    const reverseVisibility = `if(lt(T,${reverseStart}),1,min(1,max(0,(${textEnd}-T)/${effectDuration})))`;
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
      // Blur the complete overlay as one surface. A sharp/blurred crossfade
      // makes high-contrast borders leave a visible halo after the letters
      // look sharp, because the blurred border spreads beyond its source
      // pixels. A time-varying radius keeps the text, stroke and frame on
      // exactly the same blur curve in preview and in the final video.
      const blurProgress = progress;
      const blurRadius = `min(10,max(0,10*(1-(${blurProgress}))))`;
      filter += `[${inputIndex}:v]format=rgba,boxblur=` +
        `luma_radius='${blurRadius}':luma_power=1:` +
        `chroma_radius='${blurRadius}':chroma_power=1:` +
        `alpha_radius='${blurRadius}':alpha_power=1[${inputLabel}];`;
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
        inputFilter += `,scale=w='iw*(0.72+0.28*${progress})':h='ih*(0.72+0.28*${progress})':eval=frame`;
      } else if (effect === "pop") {
        const popScale = `if(lt(${progress},0.7),0.72+0.36*${progress}/0.7,1.08-0.08*(${progress}-0.7)/0.3)`;
        inputFilter += `,scale=w='iw*(${popScale})':h='ih*(${popScale})':eval=frame`;
      }
      filter += `${inputFilter}[${inputLabel}];`;
    }
    if (reverse && effect !== "none" && effect !== "fade") {
      const reverseVisibleLabel = `textReverseVisible${textIndex}`;
      filter += `[${overlayInputLabel}]${geqRgba({ alpha: `alpha(X,Y)*(${reverseVisibility})` })}[${reverseVisibleLabel}];`;
      overlayInputLabel = reverseVisibleLabel;
    }
    const baseX = `main_w*${x}-overlay_w/2`;
    const baseY = `main_h*${y}-overlay_h/2`;
    let overlayX = baseX;
    let overlayY = baseY;
    if (effect === "slide-left") overlayX = `${baseX}+overlay_w*0.34*(1-${progress})`;
    if (effect === "slide-right") overlayX = `${baseX}-overlay_w*0.34*(1-${progress})`;
    if (effect === "slide-up") overlayY = `${baseY}+overlay_h*0.34*(1-${progress})`;
    if (effect === "slide-down") overlayY = `${baseY}-overlay_h*0.34*(1-${progress})`;
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
    // Popup text effects belong to .card-content in Preview. Scaling the
    // complete card here made its frame and media drift, so the composition
    // layer only follows the Popup opening/closing transform.
    const popupScale = popupScaleBase;
    const popupAngle = `if(lt(t,${popupStart}),${popupIn === "flip" ? `-PI/2*(1-(${popupInProgress}))` : "0"},if(lt(t,${popupStart + transition}),${popupIn === "flip" ? `-PI/2*(1-(${popupInProgress}))` : "0"},if(gt(t,${popupEnd - transition}),${popupOut === "flip" ? `PI/2*(${popupOutProgress})` : "0"},0)))`;
    const popupXValue = Number(popupScene.popupX ?? 5);
    const popupYValue = Number(popupScene.popupY ?? 55);
    // Preview treats x/y as the card's top-left point and simply clips any
    // overflow at the phone edge. Do not move the card back inside the frame
    // during export, otherwise a resized Popup changes position in the video.
    const popupXRatio = clamp((Number.isFinite(popupXValue) ? popupXValue : 5) / 100, 0, 1);
    const popupYRatio = clamp((Number.isFinite(popupYValue) ? popupYValue : 55) / 100, 0, 1);
    // CSS scales Popup from center-bottom. FFmpeg scales the bitmap itself,
    // so compensate its x/y to preserve that same transform origin.
    const popupBaseX = `main_w*${popupXRatio}+overlay_w*(1/(${popupScale})-1)/2`;
    const popupBaseY = `main_h*${popupYRatio}+overlay_h*(1/(${popupScale})-1)`;
    const popupHorizontalTravel = `overlay_w/(${popupScale})*0.85`;
    const openingX = popupIn === "slide-left"
      ? `if(lt(t,${popupStart + transition}),${popupBaseX}-${popupHorizontalTravel}*(1-(${popupInProgress})),${popupBaseX})`
      : popupIn === "slide-right"
        ? `if(lt(t,${popupStart + transition}),${popupBaseX}+${popupHorizontalTravel}*(1-(${popupInProgress})),${popupBaseX})`
        : popupBaseX;
    const closingX = popupOut === "slide-left"
      ? `if(gt(t,${popupEnd - transition}),${popupBaseX}-${popupHorizontalTravel}*(${popupOutProgress}),${openingX})`
      : popupOut === "slide-right"
        ? `if(gt(t,${popupEnd - transition}),${popupBaseX}+${popupHorizontalTravel}*(${popupOutProgress}),${openingX})`
        : openingX;
    const popupSlideDistance = Math.round(previewPx(52));
    const bounceInDistance = Math.round(previewPx(70));
    const bouncePeak = Math.round(previewPx(12));
    const bounceOutPeak = Math.round(previewPx(13));
    const bounceOutDistance = Math.round(previewPx(75));
    const popupY = popupIn === "bounce"
      ? `if(lt(t,${popupStart + transition}),${popupBaseY}+if(lt(${popupInProgress},0.65),${bounceInDistance}-${bounceInDistance + bouncePeak}*(${popupInProgress})/0.65,-${bouncePeak}*(1-(${popupInProgress}-0.65)/0.35)),${popupBaseY})`
      : popupOut === "bounce"
        ? `if(gt(t,${popupEnd - transition}),${popupBaseY}+if(lt(${popupOutProgress},0.35),-${bounceOutPeak}*(${popupOutProgress})/0.35,-${bounceOutPeak}+${bounceOutPeak + bounceOutDistance}*((${popupOutProgress})-0.35)/0.65),${popupBaseY})`
        : popupIn === "fade-slide-up" || popupOut === "fade-slide-down"
          ? `if(lt(t,${popupStart + transition}),${popupBaseY}+${popupSlideDistance}*(1-(t-${popupStart})/${transition}),if(gt(t,${popupEnd - transition}),${popupBaseY}+${popupSlideDistance}*(t-${popupEnd - transition})/${transition},${popupBaseY}))`
          : popupBaseY;
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
    const subtitleAudioStart = subtitleAudioStartForRender(subtitle, resolvedSceneAudioTracks, subtitleOffset);
    const subtitleStart = Math.min(duration, subtitleAudioStart + cueStart);
    const subtitleEnd = Math.min(
      duration,
      Math.max(subtitleStart + 0.1, subtitleAudioStart + (Number(subtitle.end) || cueStart + 0.1)),
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
        } else if (kind === "effect" && id.startsWith("weather:")) {
          const index = weatherLayerOutputs.findIndex((item) => item.token === token);
          if (index >= 0) appendWeatherLayer(index);
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
          Math.max(
            darkStart + 0.1,
            darkStart
              + Math.max(0, Number(darkEffect.fadeInDuration) || 0)
              + Math.max(0, Number(darkEffect.holdDuration) || 0)
              + Math.max(0, Number(darkEffect.fadeOutDuration) || 0),
          ),
        );
        const darkDuration = Math.max(0.1, darkEnd - darkStart);
        const darkFadeInDuration = Math.min(
          darkDuration,
          Math.max(0, Number(darkEffect.fadeInDuration) || 0),
        );
        const darkHoldDuration = Math.min(
          Math.max(0, darkDuration - darkFadeInDuration),
          Math.max(0, Number(darkEffect.holdDuration ?? 0) || 0),
        );
        const darkFadeOutDuration = Math.max(
          0,
          darkDuration - darkFadeInDuration - darkHoldDuration,
        );
        const darkFadeInDenominator = Math.max(0.05, darkFadeInDuration);
        const darkFadeOutDenominator = Math.max(0.05, darkFadeOutDuration);
        const darkHoldStart = darkStart + darkFadeInDuration;
        const darkHoldEnd = darkHoldStart + darkHoldDuration;
        const darkProgressRaw = `if(lt(T,${darkStart}),0,if(lt(T,${darkHoldStart}),(T-${darkStart})/${darkFadeInDenominator},if(lt(T,${darkHoldEnd}),1,if(lt(T,${darkEnd}),(${darkEnd}-T)/${darkFadeOutDenominator},0))))`;
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
  // Close every scene at its own local boundary before the individual clips
  // are concatenated. This prevents a delayed/looped layer from carrying a
  // frame or a non-zero timestamp into the next scene clip.
  filter += `${composedLabel}trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS,setsar=1[composed]`;
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
    ...videoEncoderArgs,
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
