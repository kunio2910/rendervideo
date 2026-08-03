import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
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
const fps = 30;

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

const download = async (url, filename) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot download ${url}: ${response.status}`);
  await fs.writeFile(filename, Buffer.from(await response.arrayBuffer()));
  return filename;
};

const resolveImage = async (value, fallbackName) => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      return await download(value, path.join(renderDir, fallbackName));
    } catch {
      return null;
    }
  }
  const candidates = [
    path.resolve(root, value),
    path.join(sourceDir, path.basename(value)),
    path.join(defaultSourceDir, path.basename(value)),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return null;
};

const resolveVoice = async (scene, index) => {
  const candidates = [
    scene.voiceFile && path.resolve(root, scene.voiceFile),
    scene.voiceFile && path.join(sourceDir, path.basename(scene.voiceFile)),
    scene.voiceFile && path.join(defaultSourceDir, path.basename(scene.voiceFile)),
    path.join(sourceDir, `vuadavit_canh${String(index + 1).padStart(2, "0")}.mp3`),
    path.join(defaultSourceDir, `vuadavit_canh${String(index + 1).padStart(2, "0")}.mp3`),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return null;
};

const resolveAudio = async (value) => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      return await download(value, path.join(renderDir, `audio-${path.basename(new URL(value).pathname) || "track.mp3"}`));
    } catch {
      return null;
    }
  }
  const candidates = [
    path.resolve(root, value),
    path.join(sourceDir, path.basename(value)),
    path.join(defaultSourceDir, path.basename(value)),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return null;
};

const createPopup = async (scene, index) => {
  const width = Math.round(1080 * Math.min(1, Math.max(0.45, (scene.popupWidth ?? 90) / 100)));
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

const background = await resolveImage(project.background, "background");
const uploadedFallbackBackground = path.join(sourceDir, "map.png");
const defaultFallbackBackground = path.join(defaultSourceDir, "map.png");
let fallbackBackground = uploadedFallbackBackground;
try {
  await fs.access(uploadedFallbackBackground);
} catch {
  fallbackBackground = defaultFallbackBackground;
}
const backgroundPath = background ?? fallbackBackground;
await fs.access(backgroundPath);

const clipPaths = [];
for (let index = 0; index < scenes.length; index += 1) {
  const scene = scenes[index];
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
  const zoomInFrames = Math.max(1, Math.round((scene.zoomInDuration ?? 0) * fps));
  const zoomOutFrames = Math.max(1, Math.round((scene.zoomOutDuration ?? 0) * fps));
  const zoomOutStart = Math.max(zoomInFrames, frames - zoomOutFrames);
  const targetZoom = scene.zoomEnabled === false
    ? 1
    : Math.max(1, Number(scene.zoom ?? 1));
  const centerX = Math.min(100, Math.max(0, Number(scene.centerX ?? 50))) / 100;
  const centerY = Math.min(100, Math.max(0, Number(scene.centerY ?? 50))) / 100;
  const popupStart = Math.min(duration, Number(scene.zoomInDuration ?? 0));
  const popupEnd = Math.min(duration, popupStart + Number(scene.popupDuration ?? duration));
  const transition = Math.min(0.65, Math.max(0.25, (popupEnd - popupStart) / 3));
  const popupCenterX = "(main_w-overlay_w)/2";
  const openingX = scene.popupIn === "slide-left"
    ? `if(lt(t,${popupStart + transition}),-overlay_w+(${popupCenterX}+overlay_w)*(t-${popupStart})/${transition},${popupCenterX})`
    : scene.popupIn === "slide-right"
      ? `if(lt(t,${popupStart + transition}),main_w-(main_w-${popupCenterX})*(t-${popupStart})/${transition},${popupCenterX})`
      : popupCenterX;
  const closingX = scene.popupOut === "slide-left"
    ? `if(gt(t,${popupEnd - transition}),${popupCenterX}-(${popupCenterX}+overlay_w)*(t-${popupEnd - transition})/${transition},${openingX})`
    : scene.popupOut === "slide-right"
      ? `if(gt(t,${popupEnd - transition}),${popupCenterX}+(main_w-${popupCenterX})*(t-${popupEnd - transition})/${transition},${openingX})`
      : openingX;
  const centerYExpression = "(main_h-overlay_h)*0.58";
  const popupY = scene.popupIn === "fade-slide-up" || scene.popupOut === "fade-slide-down"
    ? `if(lt(t,${popupStart + transition}),${centerYExpression}+90*(1-(t-${popupStart})/${transition}),if(gt(t,${popupEnd - transition}),${centerYExpression}+90*(t-${popupEnd - transition})/${transition},${centerYExpression}))`
    : centerYExpression;
  const zoomExpression =
    `if(lte(on,${zoomInFrames}),1+(${targetZoom}-1)*on/${zoomInFrames},` +
    `if(gte(on,${zoomOutStart}),${targetZoom}-(${targetZoom}-1)*(on-${zoomOutStart})/${zoomOutFrames},${targetZoom}))`;
  let filter =
    `[0:v]scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,` +
    `zoompan=z='${zoomExpression}':` +
    `x='iw*${centerX}*(1-1/zoom)':` +
    `y='ih*${centerY}*(1-1/zoom)':` +
    `s=1080x1920:fps=${fps}:d=${frames},setsar=1[bg];` +
    `[1:v]format=rgba,fade=t=in:st=${popupStart}:d=${transition}:alpha=1,` +
    `fade=t=out:st=${Math.max(popupStart, popupEnd - transition)}:d=${transition}:alpha=1[pop];` +
    `[bg][pop]overlay=x='${closingX}':y='${popupY}':enable='between(t,${popupStart},${popupEnd})'[composed]`;
  markerEffects.forEach((markerEffect, markerIndex) => {
    const markerDuration = Math.max(0.2, Number(scene.zoomMarkerDuration ?? 1));
    const markerInput = 2 + markerIndex;
    const inputVideo = markerIndex === 0 ? "composed" : `composed-marker-${markerIndex - 1}`;
    const outputVideo = markerIndex === markerEffects.length - 1
      ? "v"
      : `composed-marker-${markerIndex}`;
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
      `scale=w='iw*(${markerScale})':h='ih*(${markerScale})':eval=frame${markerAlpha}[marker-${markerIndex}];` +
      `[${inputVideo}][marker-${markerIndex}]overlay=` +
      `x='main_w*${centerX}-overlay_w/2':` +
      `y='main_h*${centerY}-overlay_h/2':` +
      `enable='${markerEnable}'[${outputVideo}]`;
  });
  const args = [
    "-y",
    "-loop", "1", "-i", backgroundPath,
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
    args.push("-map", `${audioInputIndex}:a:0`, "-af", `adelay=${Math.round(popupStart * 1000)}:all=1,apad`);
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
const narrationVideo = project.backgroundMusic
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

const music = await resolveAudio(project.backgroundMusic);
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
