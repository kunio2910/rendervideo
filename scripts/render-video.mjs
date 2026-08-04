import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import sharp from "sharp";

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
const scenes = project.scenes ?? [];
const timelineDuration = Math.max(
  0.1,
  Number(project.duration ?? 0) || 0,
  ...scenes.map((scene) => Number(scene.end ?? 0) || 0),
);
const [outputWidth, outputHeight] = String(project.resolution ?? "1080x1920")
  .split("x")
  .map((value) => Math.max(1, Number.parseInt(value, 10) || 1));
const fps = Math.max(1, Number(project.fps ?? 30) || 30);
const PREVIEW_REFERENCE_WIDTH = 472;
const PREVIEW_REFERENCE_HEIGHT = PREVIEW_REFERENCE_WIDTH * 16 / 9;
const previewScale = outputWidth / PREVIEW_REFERENCE_WIDTH;
const previewPx = (value) => value * previewScale;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

await fs.rm(renderDir, { recursive: true, force: true });
await fs.mkdir(renderDir, { recursive: true });
await fs.mkdir(path.dirname(outputPath), { recursive: true });

const escapeXml = (value = "") =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

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

const createPopup = async (scene, index) => {
  const width = Math.round(outputWidth * clamp((scene.popupWidth ?? 90) / 100, 0.45, 1));
  const height = Math.round(previewPx(clamp(Number(scene.popupHeight ?? 255), 170, 440)));
  const radius = Math.max(10, Math.round(previewPx(14)));
  const borderWidth = Math.max(1, Math.round(previewPx(1)));
  const paddingX = Math.round(previewPx(15));
  const titleFontSize = Math.round(previewPx(15));
  const bodyFontSize = Math.round(previewPx(11));
  const bodyLineHeight = Math.round(previewPx(18.15));
  const imageVisible = scene.imageVisible !== false;
  const image = imageVisible
    ? await resolveImage(scene.image, `scene-${index + 1}-image`)
    : null;
  const imageHeight = imageVisible ? Math.round(previewPx(115)) : 0;
  const titleY = imageHeight + Math.round(previewPx(33));
  const bodyY = titleY + Math.round(previewPx(24));
  const maxCharacters = Math.max(
    24,
    Math.floor((width - paddingX * 2) / Math.max(1, bodyFontSize * 0.54)),
  );
  const maxBodyLines = Math.max(
    1,
    Math.floor((height - bodyY - previewPx(15)) / bodyLineHeight) + 1,
  );
  const bodyLines = wrap(scene.body ?? "", maxCharacters).slice(0, maxBodyLines);
  const bodyText = bodyLines
    .map((line, lineIndex) =>
      `<text x="${paddingX}" y="${bodyY + lineIndex * bodyLineHeight}" font-size="${bodyFontSize}" fill="#e9ddc7">${escapeXml(line)}</text>`,
    )
    .join("");
  const imageClipPath = `M ${radius} 0 H ${width - radius} Q ${width} 0 ${width} ${radius} V ${imageHeight} H 0 V ${radius} Q 0 0 ${radius} 0 Z`;
  const svg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="placeholderSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#c9e4f5"/>
          <stop offset="100%" stop-color="#f6d8af"/>
        </linearGradient>
        <clipPath id="imageClip"><path d="${imageClipPath}"/></clipPath>
      </defs>
      <rect x="${borderWidth / 2}" y="${borderWidth / 2}" width="${width - borderWidth}" height="${height - borderWidth}" rx="${radius}" fill="#262118" fill-opacity=".94"/>
      ${imageVisible && !image ? `
        <g clip-path="url(#imageClip)">
          <rect width="${width}" height="${imageHeight}" fill="url(#placeholderSky)"/>
          <circle cx="${width * 0.78}" cy="${previewPx(30)}" r="${previewPx(14)}" fill="#ffe1a3"/>
          <ellipse cx="${width * 0.25}" cy="${imageHeight + previewPx(22)}" rx="${width * 0.48}" ry="${previewPx(48)}" fill="#769b79"/>
          <ellipse cx="${width * 0.82}" cy="${imageHeight + previewPx(28)}" rx="${width * 0.44}" ry="${previewPx(52)}" fill="#557c64"/>
        </g>
      ` : ""}
      <text x="${paddingX}" y="${titleY}" font-family="Arial, sans-serif" font-weight="700" font-size="${titleFontSize}" fill="#fff3d6">${escapeXml(String(scene.title ?? "").toUpperCase())}</text>
      <g font-family="Arial">${bodyText}</g>
    </svg>
  `);
  const base = sharp(svg);
  const composites = [];
  if (image) {
    const mask = Buffer.from(`
      <svg width="${width}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
        <path d="${imageClipPath}" fill="#fff"/>
      </svg>
    `);
    const resized = await sharp(image)
      .resize(width, imageHeight, { fit: "cover" })
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
    composites.push({ input: resized, top: 0, left: 0 });
  }
  const border = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${borderWidth / 2}" y="${borderWidth / 2}" width="${width - borderWidth}" height="${height - borderWidth}" rx="${radius}" fill="none" stroke="#aa772c" stroke-width="${borderWidth}"/>
    </svg>
  `);
  composites.push({ input: border, top: 0, left: 0 });
  const filename = path.join(renderDir, `popup-${index + 1}.png`);
  await base.composite(composites).png().toFile(filename);
  return filename;
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
  ? await resolveImage(project.background, "background", true)
  : null;
const backgroundPath = background ?? hiddenBackgroundPath;

const clipPaths = [];
for (let index = 0; index < scenes.length; index += 1) {
  const scene = scenes[index];
  const sceneBackground = scene.backgroundVisible === false
    ? hiddenBackgroundPath
    : String(scene.background ?? "").trim()
      ? await resolveImage(scene.background, `scene-${index + 1}-background`, true)
      : backgroundPath;
  if (!sceneBackground) {
    throw new Error(`Không tìm thấy background cho cảnh ${index + 1}: ${scene.background || "map.png"}`);
  }
  const end = scenes[index + 1]?.start ?? timelineDuration;
  const duration = Math.max(0.1, end - scene.start);
  const popup = await createPopup(scene, index);
  const voice = await resolveVoice(scene, index);
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
  const popupStart = Math.min(
    duration,
    Math.max(0, Number(scene.popupStart ?? 0)),
  );
  const popupEnd = Math.min(duration, popupStart + Number(scene.popupDuration ?? duration));
  const transition = Math.min(0.65, Math.max(0.25, (popupEnd - popupStart) / 3));
  const popupVisible = scene.popupVisible !== false;
  const popupIn = scene.popupIn ?? "fade-slide-up";
  const popupOut = scene.popupOut ?? "fade-slide-down";
  const popupInProgress = `(t-${popupStart})/${transition}`;
  const popupOutProgress = `(t-${popupEnd - transition})/${transition}`;
  const popupScaleStart = (effect) => ({
    "fade-slide-up": "0.92",
    "fade-slide-down": "0.92",
    "zoom-soft": "0.68",
    bounce: "0.82",
    flip: "0.86",
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
  const popupScale =
    `if(lt(t,${popupStart}),${popupScaleStart(popupIn)},` +
    `if(lt(t,${popupStart + transition}),${popupScaleIn(popupIn)},` +
    `if(gt(t,${popupEnd - transition}),${popupScaleOut(popupOut)},1)))`;
  const popupAngle =
    `if(lt(t,${popupStart}),${popupIn === "flip" ? `-PI/2*(1-(${popupInProgress}))` : "0"},` +
    `if(lt(t,${popupStart + transition}),${popupIn === "flip" ? `-PI/2*(1-(${popupInProgress}))` : "0"},` +
    `if(gt(t,${popupEnd - transition}),${popupOut === "flip" ? `PI/2*(${popupOutProgress})` : "0"},0)))`;
  const popupCenterX = "(main_w-overlay_w)/2";
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
  const popupBottom = Math.round(outputHeight * (55 / PREVIEW_REFERENCE_HEIGHT));
  const popupSlideDistance = Math.round(previewPx(52));
  const bounceInDistance = Math.round(previewPx(70));
  const bouncePeak = Math.round(previewPx(12));
  const bounceOutPeak = Math.round(previewPx(13));
  const bounceOutDistance = Math.round(previewPx(75));
  const centerYExpression = `main_h-overlay_h-${popupBottom}`;
  const popupY = popupIn === "bounce"
    ? `if(lt(t,${popupStart + transition}),${centerYExpression}+if(lt(${popupInProgress},0.65),${bounceInDistance}-${bounceInDistance + bouncePeak}*(${popupInProgress})/0.65,-${bouncePeak}*(1-(${popupInProgress}-0.65)/0.35)),${centerYExpression})`
    : popupOut === "bounce"
      ? `if(gt(t,${popupEnd - transition}),${centerYExpression}+if(lt(${popupOutProgress},0.35),-${bounceOutPeak}*(${popupOutProgress})/0.35,-${bounceOutPeak}+${bounceOutPeak + bounceOutDistance}*((${popupOutProgress})-0.35)/0.65),${centerYExpression})`
      : popupIn === "fade-slide-up" || popupOut === "fade-slide-down"
    ? `if(lt(t,${popupStart + transition}),${centerYExpression}+${popupSlideDistance}*(1-(t-${popupStart})/${transition}),if(gt(t,${popupEnd - transition}),${centerYExpression}+${popupSlideDistance}*(t-${popupEnd - transition})/${transition},${centerYExpression}))`
    : centerYExpression;
  const zoomExpression =
    `if(lt(on,${zoomStartFrames}),1,` +
    `if(lt(on,${zoomInEnd}),1+(${targetZoom}-1)*(on-${zoomStartFrames})/${zoomInFrames},` +
    `if(lt(on,${zoomOutStart}),${targetZoom},` +
    `if(lt(on,${zoomEndFrames}),${targetZoom}-(${targetZoom}-1)*(on-${zoomOutStart})/${zoomOutSpan},1))))`;
  let filter =
    `[0:v]scale=${outputWidth * 2}:${outputHeight * 2}:force_original_aspect_ratio=increase,crop=${outputWidth * 2}:${outputHeight * 2},` +
    `zoompan=z='${zoomExpression}':` +
    `x='iw*${centerX}*(1-1/zoom)':` +
    `y='ih*${centerY}*(1-1/zoom)':` +
    `s=${outputWidth}x${outputHeight}:fps=${fps}:d=${frames},setsar=1[bg];`;
  if (popupVisible) {
    filter +=
      `[1:v]format=rgba,scale=w='iw*(${popupScale})':h='ih*(${popupScale})':eval=frame,` +
      (popupIn === "flip" || popupOut === "flip"
        ? `rotate=angle='${popupAngle}':fillcolor=none:ow=rotw(iw):oh=roth(ih),`
        : "") +
      `fade=t=in:st=${popupStart}:d=${transition}:alpha=1,` +
      `fade=t=out:st=${Math.max(popupStart, popupEnd - transition)}:d=${transition}:alpha=1[pop];` +
      `[bg][pop]overlay=x='${closingX}':y='${popupY}':enable='between(t,${popupStart},${popupEnd})'[composed]`;
  } else {
    filter += "[bg]copy[composed]";
  }
  const args = [
    "-y",
    "-loop", "1", "-i", sceneBackground,
    "-loop", "1", "-i", popup,
  ];
  const audioInputIndex = 2;
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
    ? "aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo,volume=0.95,apad"
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
  console.log(`Rendering scene ${index + 1}/${scenes.length}: ${scene.title}`);
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
  await run(ffmpeg, [
    "-y",
    "-i", narrationVideo,
    "-stream_loop", "-1",
    "-i", music,
    "-filter_complex", "[0:a]volume=1[a0];[1:a]volume=0.18[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]",
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
