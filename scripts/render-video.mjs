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
const [outputWidth, outputHeight] = String(project.resolution ?? "1080x1920")
  .split("x")
  .map((value) => Math.max(1, Number.parseInt(value, 10) || 1));
const fps = Math.max(1, Number(project.fps ?? 30) || 30);

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
        const detail = error instanceof Error ? error.message : "unknown download error";
        throw new Error(`Không thể tải ảnh background từ URL: ${detail}`);
      }
      return null;
    }
  }
  const local = await findLocalResource("image", value, localCandidates(value));
  if (!local && required) throw new Error(`KhÃ´ng tÃ¬m tháº¥y áº£nh background: ${value}`);
  return local;
};

const resolveVoice = async (scene, index) => {
  const value = String(scene.voiceFile ?? "").trim();
  if (value && isRemote(value)) {
    try {
      return await downloadResource("audio", value, `scene-${index + 1}-voice.mp3`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown download error";
      throw new Error(`KhÃ´ng thá»ƒ táº£i Ã¢m thanh cáº£nh ${index + 1} tá»« URL: ${detail}`);
    }
  }
  const candidates = [
    value && path.resolve(root, value),
    value && path.join(sourceDir, path.basename(value)),
    value && path.join(defaultSourceDir, path.basename(value)),
    path.join(sourceDir, `vuadavit_canh${String(index + 1).padStart(2, "0")}.mp3`),
    path.join(defaultSourceDir, `vuadavit_canh${String(index + 1).padStart(2, "0")}.mp3`),
  ].filter(Boolean);
  return findLocalResource("audio", value || `fallback-${index + 1}.mp3`, candidates);
};

const resolveAudio = async (value, required = false) => {
  if (!value) return null;
  if (isRemote(value)) {
    try {
      return await downloadResource("audio", value, "track.mp3");
    } catch (error) {
      if (required) {
        const detail = error instanceof Error ? error.message : "unknown download error";
        throw new Error(`KhÃ´ng thá»ƒ táº£i nháº¡c ná»n tá»« URL: ${detail}`);
      }
      return null;
    }
  }
  return findLocalResource("audio", value, localCandidates(value));
};

const createPopup = async (scene, index) => {
  const width = Math.round(outputWidth * Math.min(1, Math.max(0.45, (scene.popupWidth ?? 90) / 100)));
  const height = Math.max(420, Math.min(760, Math.round((scene.popupHeight ?? 255) * 2)));
  const image = await resolveImage(scene.image, `scene-${index + 1}-image`);
  const imageHeight = image ? 205 : 0;
  const bodyLines = wrap(scene.body ?? "", 48).slice(0, 5);
  const titleY = 70 + imageHeight;
  const bodyY = titleY + 105;
  const referenceY = height - 38;
  const bodyText = bodyLines
    .map((line, lineIndex) =>
      `<text x="54" y="${bodyY + lineIndex * 42}" font-size="29" fill="#394454">${escapeXml(line)}</text>`,
    )
    .join("");
  const svg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" rx="30" fill="#ffffff" fill-opacity=".97"/>
      ${image ? `<rect x="0" y="0" width="${width}" height="${imageHeight}" rx="30" fill="#dce5ef"/>` : ""}
      <text x="54" y="${titleY}" font-family="Arial" font-weight="700" font-size="44" fill="#101827">${escapeXml(scene.title ?? "")}</text>
      <text x="54" y="${titleY + 50}" font-family="Arial" font-size="25" fill="#53708f">${escapeXml(scene.location ?? "")}</text>
      <g font-family="Arial">${bodyText}</g>
      <text x="54" y="${referenceY}" font-family="Arial" font-size="24" fill="#748091">${escapeXml(scene.reference ?? "")}</text>
    </svg>
  `);
  const base = sharp(svg);
  if (image) {
    const resized = await sharp(image)
      .resize(width, imageHeight, { fit: "cover" })
      .png()
      .toBuffer();
    base.composite([{ input: resized, top: 0, left: 0 }]);
  }
  const filename = path.join(renderDir, `popup-${index + 1}.png`);
  await base.png().toFile(filename);
  return filename;
};

const createZoomMarker = async (scene, index, effect = "marker", layer = 0) => {
  const requestedSize = Math.min(
    120,
    Math.max(16, Number(scene.zoomMarkerSize ?? 28) * (1 + layer * 0.18)),
  );
  const coreSize = Math.round(requestedSize * 2.75);
  const canvasSize = Math.max(96, Math.round(coreSize * 2.6));
  const center = canvasSize / 2;
  const radius = coreSize / 2;
  const glowRadius = radius * 1.75;
  const svg = Buffer.from(`
    <svg width="${canvasSize}" height="${canvasSize}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="markerFill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#fff2b8" stop-opacity=".98"/>
          <stop offset="32%" stop-color="#ffc45d" stop-opacity=".9"/>
          <stop offset="70%" stop-color="#e89b28" stop-opacity=".52"/>
          <stop offset="100%" stop-color="#d88317" stop-opacity="0"/>
        </radialGradient>
        <filter id="markerGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="${Math.max(5, radius * 0.28)}"/>
        </filter>
      </defs>
      <circle cx="${center}" cy="${center}" r="${glowRadius}" fill="#eaa033" fill-opacity=".42" filter="url(#markerGlow)"/>
      <circle cx="${center}" cy="${center}" r="${radius}" fill="url(#markerFill)"/>
      <circle cx="${center}" cy="${center}" r="${Math.max(3, radius * 0.22)}" fill="#fff7d8" fill-opacity=".98"/>
    </svg>
  `);
  const filename = path.join(renderDir, `zoom-marker-${index + 1}-${effect}.png`);
  await sharp(svg).png().toFile(filename);
  return filename;
};

const getActiveMarkerEffects = (scene) => {
  if (scene.zoomMarkerEnabled === false) return [];
  if (scene.zoomMarkerEffects) {
    return ["glow", "blink", "soft-fade"].filter(
      (effect) => scene.zoomMarkerEffects[effect] === true,
    );
  }
  const legacyEffect = scene.zoomMarkerEffect ?? "none";
  return legacyEffect === "none" ? [] : [legacyEffect];
};

const hasSceneBackgrounds = scenes.some((scene) => String(scene.background ?? "").trim());
const background = await resolveImage(
  project.background,
  "background",
  Boolean(project.background && !hasSceneBackgrounds),
);
const uploadedFallbackBackground = path.join(sourceDir, "map.png");
const defaultFallbackBackground = path.join(defaultSourceDir, "map.png");
let fallbackBackground = null;
try {
  await fs.access(uploadedFallbackBackground);
  fallbackBackground = uploadedFallbackBackground;
} catch {
  try {
    await fs.access(defaultFallbackBackground);
    fallbackBackground = defaultFallbackBackground;
  } catch {}
}
const backgroundPath = background ?? fallbackBackground;
if (!backgroundPath && scenes.some((scene) => !scene.background && !project.background)) {
  throw new Error(`Không tìm thấy ảnh background: ${project.background || "map.png"}`);
}

const clipPaths = [];
for (let index = 0; index < scenes.length; index += 1) {
  const scene = scenes[index];
  const sceneBackground = await resolveImage(
    scene.background || project.background,
    `scene-${index + 1}-background`,
    Boolean(scene.background || project.background),
  ) || backgroundPath;
  if (!sceneBackground) {
    throw new Error(`Không tìm thấy background cho cảnh ${index + 1}: ${scene.background || "map.png"}`);
  }
  const end = scenes[index + 1]?.start ?? project.duration;
  const duration = Math.max(0.1, end - scene.start);
  const popup = await createPopup(scene, index);
  const markerEffects = getActiveMarkerEffects(scene);
  const markers = await Promise.all(
    markerEffects.map((effect, markerIndex) =>
      createZoomMarker(scene, index, effect, markerIndex),
    ),
  );
  const voice = await resolveVoice(scene, index);
  const clip = path.join(renderDir, `scene-${index + 1}.mp4`);
  const frames = Math.round(duration * fps);
  const zoomStartFrames = Math.min(
    frames,
    Math.max(0, Math.round(Number(scene.zoomStart ?? 0) * fps)),
  );
  const zoomInFrames = Math.max(1, Math.round((scene.zoomInDuration ?? 0) * fps));
  const zoomOutFrames = Math.max(1, Math.round((scene.zoomOutDuration ?? 0) * fps));
  const zoomInEnd = Math.min(frames, zoomStartFrames + zoomInFrames);
  const zoomOutStart = Math.max(zoomInEnd, frames - zoomOutFrames);
  const targetZoom = scene.zoomEnabled === false
    ? 1
    : Math.max(1, Number(scene.zoom ?? 1));
  const centerX = Math.min(100, Math.max(0, Number(scene.centerX ?? 50))) / 100;
  const centerY = Math.min(100, Math.max(0, Number(scene.centerY ?? 50))) / 100;
  const popupStart = Math.min(
    duration,
    Math.max(0, Number(scene.popupStart ?? scene.zoomInDuration ?? 0)),
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
  const centerYExpression = "(main_h-overlay_h)*0.58";
  const popupY = popupIn === "bounce"
    ? `if(lt(t,${popupStart + transition}),${centerYExpression}+if(lt(${popupInProgress},0.65),70-82*(${popupInProgress})/0.65,-12*(1-(${popupInProgress}-0.65)/0.35)),${centerYExpression})`
    : popupOut === "bounce"
      ? `if(gt(t,${popupEnd - transition}),${centerYExpression}+if(lt(${popupOutProgress},0.35),-13*(${popupOutProgress})/0.35,-13+88*((${popupOutProgress})-0.35)/0.65),${centerYExpression})`
      : popupIn === "fade-slide-up" || popupOut === "fade-slide-down"
    ? `if(lt(t,${popupStart + transition}),${centerYExpression}+90*(1-(t-${popupStart})/${transition}),if(gt(t,${popupEnd - transition}),${centerYExpression}+90*(t-${popupEnd - transition})/${transition},${centerYExpression}))`
    : centerYExpression;
  const zoomExpression =
    `if(lt(on,${zoomStartFrames}),1,` +
    `if(lt(on,${zoomInEnd}),1+(${targetZoom}-1)*(on-${zoomStartFrames})/${zoomInFrames},` +
    `if(gte(on,${zoomOutStart}),${targetZoom}-(${targetZoom}-1)*(on-${zoomOutStart})/${zoomOutFrames},${targetZoom})))`;
  const backgroundInput = scene.backgroundVisible === false
    ? `color=c=0xdbe2e9:s=${outputWidth * 2}x${outputHeight * 2}:r=${fps},`
    : `[0:v]scale=${outputWidth * 2}:${outputHeight * 2}:force_original_aspect_ratio=increase,crop=${outputWidth * 2}:${outputHeight * 2},`;
  let filter =
    backgroundInput +
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
  markerEffects.forEach((markerEffect, markerIndex) => {
    const markerDuration = Math.max(0.2, Number(scene.zoomMarkerDuration ?? 1));
    const markerInput = 2 + markerIndex;
    const inputVideo = markerIndex === 0 ? "composed" : `composed_marker_${markerIndex - 1}`;
    const outputVideo = markerIndex === markerEffects.length - 1
      ? "v"
      : `composed_marker_${markerIndex}`;
    const markerScale = markerEffect === "glow"
      ? `1+0.13*sin(2*PI*t/${markerDuration})`
      : markerEffect === "soft-fade"
        ? `1+0.06*sin(2*PI*t/${markerDuration})`
        : "1";
    const markerEnable = markerEffect === "blink"
      ? `lt(mod(t,${markerDuration}),${markerDuration * 0.56})`
      : "1";
    const markerAlpha = markerEffect === "soft-fade"
      ? Array.from(
          { length: Math.ceil(duration / markerDuration) },
          (_, cycle) => {
            const start = cycle * markerDuration;
            const half = markerDuration / 2;
            return `,fade=t=out:st=${start}:d=${half}:alpha=1` +
              `,fade=t=in:st=${start + half}:d=${half}:alpha=1`;
          },
        ).join("")
      : "";
    filter +=
      `;[${markerInput}:v]format=rgba,` +
      `scale=w='iw*(${markerScale})':h='ih*(${markerScale})':eval=frame${markerAlpha}[marker_${markerIndex}];` +
      `[${inputVideo}][marker_${markerIndex}]overlay=` +
      `x='main_w*${centerX}-overlay_w/2':` +
      `y='main_h*${centerY}-overlay_h/2':` +
      `enable='${markerEnable}'[${outputVideo}]`;
  });
  const args = [
    "-y",
    "-loop", "1", "-i", sceneBackground,
    "-loop", "1", "-i", popup,
  ];
  markers.forEach((marker) => {
    args.push("-loop", "1", "-i", marker);
  });
  const audioInputIndex = 2 + markers.length;
  if (voice) {
    args.push("-i", voice);
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  }
  args.push(
    "-filter_complex", filter,
    "-map", markers.length > 0 ? "[v]" : "[composed]",
  );
  if (voice) {
    const audioDelay = popupVisible ? popupStart : 0;
    args.push("-map", `${audioInputIndex}:a:0`, "-af", `adelay=${Math.round(audioDelay * 1000)}:all=1,apad`);
  } else {
    args.push("-map", `${audioInputIndex}:a:0`);
  }
  args.push(
    "-t", String(duration),
    "-r", String(fps),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
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
  "-c", "copy",
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
    "-t", String(project.duration),
    "-movflags", "+faststart",
    outputPath,
  ]);
} else if (narrationVideo !== outputPath) {
  await fs.copyFile(narrationVideo, outputPath);
}
console.log(`Rendered: ${outputPath}`);
