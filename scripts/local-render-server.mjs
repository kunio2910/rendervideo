import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { alignSubtitles } from "./align-subtitles.mjs";
import { getResourceCacheSummary, syncProjectResourceCache } from "./render-resource-cache.mjs";
import { processSpriteSheetBuffer } from "./sprite-sheet.mjs";

// `root` is the read-only bundle root in the packaged desktop app.  The
// writable job/cache area can be redirected independently through
// KITO_DATA_DIR, which keeps the installer directory read-only.
const root = process.env.KITO_RENDER_BUNDLE_ROOT || process.cwd();
const dataRoot = process.env.KITO_DATA_DIR || root;
const host = "127.0.0.1";
const port = Number(process.env.LOCAL_RENDER_PORT || 4179);
const jobsRoot = path.join(dataRoot, "work", "local-render-jobs");
const spriteAssetsRoot = path.join(jobsRoot, "sprite-assets");
const renderCacheRoot = path.join(jobsRoot, "render-cache");
const renderedClipsRoot = path.join(jobsRoot, "rendered-clips");
const concatJobsRoot = path.join(jobsRoot, "concat-jobs");
const spriteProcessVersion = "alpha-v5-auto-grid-local-file";
const ffmpegPath = process.env.FFMPEG_PATH ||
  path.join(root, ".local-renderer", "ffmpeg", "bin", "ffmpeg.exe");
const ffprobePath = process.env.FFPROBE_PATH ||
  path.join(root, ".local-renderer", "ffmpeg", "bin", "ffprobe.exe");
const rendererScriptPath = process.env.KITO_RENDERER_SCRIPT ||
  path.join(root, "scripts", "render-video.mjs");
const nodeBinary = process.env.KITO_NODE_BINARY || process.execPath;
const jobs = new Map();
const concatJobs = new Map();
let activeJobId = null;
let activeConcatJobId = null;
let activeSubtitleAlignment = false;
let activeCacheSync = false;
const whiteboardJobsRoot = path.join(jobsRoot, "whiteboard");
const whiteboardRendererPath = process.env.KITO_WHITEBOARD_RENDERER ||
  path.join(root, "scripts", "whiteboard", "SRTWhiteboardPortable.exe");
const whiteboardJobs = new Map();
let activeWhiteboardJobId = null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Private-Network": "true",
  "Cache-Control": "no-store",
};

const sendJson = (response, status, body) => {
  response.writeHead(status, { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const safeName = (value) => {
  const name = path.basename(String(value || "resource"));
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-") || "resource";
};

const ffmpegReady = async () => {
  try {
    await fs.access(ffmpegPath);
    return true;
  } catch {
    return false;
  }
};

const isStoredClipId = (value) => /^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(String(value || ""));
const clipMetadataPath = (id) => path.join(renderedClipsRoot, `${id}.json`);
const clipVideoPath = (id) => path.join(renderedClipsRoot, `${id}.mp4`);
const safeVideoName = (value, fallback = "video") => {
  const base = safeName(value || fallback).replace(/\.(mp4|mov|mkv|webm)$/i, "").trim() || fallback;
  return `${base}.mp4`;
};

const clampInteger = (value, minimum, maximum) => Math.min(Math.max(Math.round(Number(value) || 0), minimum), maximum);

const detectImageDimensions = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) === 0x89504e47 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    if (buffer.toString("ascii", 12, 16) === "VP8X" && buffer.length >= 30) {
      return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      while (buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (offset + 1 >= buffer.length) break;
      const segmentLength = buffer.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
      const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame && offset + 7 < buffer.length) return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
      offset += segmentLength;
    }
  }
  return null;
};

const normalizeWhiteboardDirection = (value) => ["top_to_bottom", "bottom_to_top", "left_to_right", "right_to_left"].includes(String(value)) ? String(value) : "top_to_bottom";

const buildWhiteboardAnnotation = ({ lineBuffer, modules, canvas }) => {
  const detected = detectImageDimensions(lineBuffer);
  const width = Math.max(1, Number(detected?.width || canvas?.width || 1920));
  const height = Math.max(1, Number(detected?.height || canvas?.height || 1080));
  const rawModules = Array.isArray(modules) ? modules : [];
  const sourceModules = rawModules.length ? rawModules : [{ name: "Toàn bộ khung hình", x: 0, y: 0, width, height, direction: "top_to_bottom", startMs: 0, endMs: 3000, subtitle: "", narrativeRole: "Toàn cảnh" }];
  const elements = sourceModules.map((item, index) => {
    const x = clampInteger(item?.x, 0, Math.max(0, width - 1));
    const y = clampInteger(item?.y, 0, Math.max(0, height - 1));
    const regionWidth = Math.max(1, Math.min(width - x, Math.round(Number(item?.width) || width)));
    const regionHeight = Math.max(1, Math.min(height - y, Math.round(Number(item?.height) || height)));
    const startMs = Math.max(0, Math.round(Number(item?.startMs) || 0));
    const endMs = Math.max(startMs + 100, Math.round(Number(item?.endMs) || startMs + 3000));
    const direction = normalizeWhiteboardDirection(item?.direction);
    const handStart = direction === "bottom_to_top" ? [x + Math.round(regionWidth / 2), y + regionHeight] : direction === "left_to_right" ? [x, y + Math.round(regionHeight / 2)] : direction === "right_to_left" ? [x + regionWidth, y + Math.round(regionHeight / 2)] : [x + Math.round(regionWidth / 2), y];
    const handEnd = direction === "bottom_to_top" ? [x + Math.round(regionWidth / 2), y] : direction === "left_to_right" ? [x + regionWidth, y + Math.round(regionHeight / 2)] : direction === "right_to_left" ? [x, y + Math.round(regionHeight / 2)] : [x + Math.round(regionWidth / 2), y + regionHeight];
    return {
      id: String(item?.id || `module-${index + 1}`),
      label: String(item?.name || `Module ${index + 1}`),
      sequence: index + 1,
      narrativeRole: String(item?.narrativeRole || "Nội dung chính của cảnh"),
      subtitle: String(item?.subtitle || ""),
      type: "structure",
      region: { x, y, width: regionWidth, height: regionHeight },
      reveal: { direction, startMs, durationMs: endMs - startMs, maskPaddingPx: 22, protectedRegions: [] },
      handPath: { start: handStart, end: handEnd, easing: "easeInOut" },
    };
  });
  const lastEnd = elements.reduce((latest, element) => Math.max(latest, element.reveal.startMs + element.reveal.durationMs), 0);
  return { sceneId: "whiteboard-scene", canvas: { width, height }, storyBasis: "Tạo tự động từ Drawing Modules", sceneDurationMs: Math.max(1000, lastEnd + 500), elements };
};

const runCommand = (command, args) => new Promise((resolve, reject) => {
  execFile(command, args, {
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    timeout: 30_000,
    killSignal: "SIGTERM",
  }, (error, stdout, stderr) => {
    if (error) {
      reject(new Error(String(stderr || "").trim() || error.message));
      return;
    }
    resolve(String(stdout || ""));
  });
});

const summarizeFfmpegFailure = (log) => {
  const lines = String(log || "")
    .replaceAll("\r", "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const meaningful = lines.filter((line) => /error|failed|invalid|cannot|unable|no option|not found|unknown|failure/i.test(line));
  return (meaningful.at(-1) || lines.at(-1) || "")
    .replace(/\s+/g, " ")
    .slice(0, 360);
};

// Windows exposes FFmpeg's negative errno-style exit codes as unsigned
// 32-bit values (for example -22 becomes 4294967274). Decode them before
// showing the failure so the UI and log point to the real FFmpeg status.
const normalizeProcessExitCode = (code) => {
  const numeric = Number(code);
  return Number.isFinite(numeric) && numeric > 0x7fffffff
    ? numeric - 0x100000000
    : numeric;
};

const formatRenderClock = (value) => {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
};

// Keep progress tied to the same visible scenes, duration fallback and FPS
// rules used by render-video.mjs. A scene count alone is misleading when one
// scene is much longer than another.
const getRenderFrameMetrics = (project) => {
  const requestedFps = Math.max(1, Number(project?.fps ?? 30) || 30);
  const fps = project?.renderProfile === "fast" ? Math.min(requestedFps, 24) : requestedFps;
  const scenes = (Array.isArray(project?.scenes) ? project.scenes : [])
    .filter((scene) => scene?.sceneVisible !== false)
    .map((scene) => {
      const sourceDuration = Number(scene?.end ?? 0) - Number(scene?.start ?? 0);
      const duration = Math.max(0.1, Number.isFinite(sourceDuration) ? sourceDuration : 0.1);
      return {
        duration,
        frames: Math.max(1, Math.round(duration * fps)),
      };
    });
  let frameOffset = 0;
  const sceneMetrics = scenes.map((scene) => {
    const metric = { ...scene, frameOffset };
    frameOffset += scene.frames;
    return metric;
  });
  return {
    fps,
    scenes: sceneMetrics,
    totalDuration: sceneMetrics.reduce((sum, scene) => sum + scene.duration, 0),
    totalFrames: frameOffset,
  };
};

const clampRenderFrame = (value, totalFrames) => Math.min(
  Math.max(0, Math.round(Number(value) || 0)),
  Math.max(0, Number(totalFrames) || 0),
);

const renderProgressFromFrames = (renderedFrames, totalFrames) => {
  if (!(Number(totalFrames) > 0)) return 8;
  const ratio = Math.min(1, Math.max(0, Number(renderedFrames) || 0) / totalFrames);
  return Number((8 + ratio * 80).toFixed(2));
};

const renderElapsedSeconds = (job) => job.startedAt
  ? Math.max(0, (Date.now() - job.startedAt) / 1000)
  : Math.max(0, Number(job.elapsedSeconds) || 0);

const renderEtaSeconds = (job, elapsedSeconds = renderElapsedSeconds(job)) => {
  if (!job.startedAt || job.status !== "rendering" || job.progress < 8 || elapsedSeconds <= 0) return null;
  return Math.max(0, Math.round(elapsedSeconds * (100 - job.progress) / job.progress));
};

const renderJobPayload = (job) => {
  const elapsedSeconds = renderElapsedSeconds(job);
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    stage: job.stage || null,
    stageLabel: job.stageLabel || null,
    detail: job.detail || job.message,
    scene: Number(job.scene) || 0,
    totalScenes: Number(job.totalScenes) || 0,
    renderFps: Number(job.renderFps) || 0,
    renderedFrames: Number(job.renderedFrames) || 0,
    totalFrames: Number(job.totalFrames) || 0,
    sceneRenderedFrames: Number(job.sceneRenderedFrames) || 0,
    sceneTotalFrames: Number(job.sceneTotalFrames) || 0,
    elapsedSeconds: Math.round(elapsedSeconds),
    etaSeconds: renderEtaSeconds(job, elapsedSeconds),
    mediaTimeSeconds: Number(job.mediaTimeSeconds) || 0,
    mediaDurationSeconds: Number(job.mediaDurationSeconds) || 0,
    videoEncoder: job.videoEncoder || null,
    downloadUrl: job.downloadUrl || null,
    clip: job.clip || null,
    log: job.status === "failed" ? job.log.slice(-3000) : undefined,
    logTail: job.log ? job.log.slice(-1800) : "",
  };
};

const whiteboardRendererReady = async () => {
  try {
    await fs.access(whiteboardRendererPath);
    return true;
  } catch {
    return false;
  }
};

const whiteboardJobPayload = (job) => {
  const elapsedSeconds = renderElapsedSeconds(job);
  return {
    id: job.id,
    status: job.status,
    progress: Number(job.progress) || 0,
    message: job.message,
    detail: job.detail || job.message,
    stageLabel: job.stageLabel || null,
    renderFps: Number(job.renderFps) || 0,
    renderedFrames: Number(job.renderedFrames) || 0,
    totalFrames: Number(job.totalFrames) || 0,
    elapsedSeconds: Math.round(elapsedSeconds),
    etaSeconds: renderEtaSeconds(job, elapsedSeconds),
    downloadUrl: job.downloadUrl || null,
    clip: job.clip || null,
    log: job.status === "failed" ? String(job.log || "").slice(-24000) : undefined,
    logTail: String(job.log || "").slice(-24000),
  };
};
const rationalToNumber = (value) => {
  const [top, bottom] = String(value || "").split("/").map(Number);
  if (Number.isFinite(top) && Number.isFinite(bottom) && bottom > 0) return top / bottom;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const makeCompatibilityKey = (profile) => JSON.stringify({
  video: profile.video ? {
    codec: profile.video.codec,
    width: profile.video.width,
    height: profile.video.height,
    pixelFormat: profile.video.pixelFormat,
    fps: profile.video.fps,
    profile: profile.video.profile,
  } : null,
  audio: profile.audio ? {
    codec: profile.audio.codec,
    sampleRate: profile.audio.sampleRate,
    channels: profile.audio.channels,
    channelLayout: profile.audio.channelLayout,
  } : null,
});

const inspectVideo = async (filePath) => {
  const raw = await runCommand(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_name,codec_type,width,height,pix_fmt,r_frame_rate,avg_frame_rate,profile,sample_rate,channels,channel_layout",
    "-of", "json",
    filePath,
  ]);
  const probe = JSON.parse(raw || "{}");
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  if (!video) throw new Error("Clip không có luồng video để nối");
  return {
    duration: Math.max(0, Number(probe.format?.duration) || 0),
    video: {
      codec: String(video.codec_name || ""),
      width: Number(video.width) || 0,
      height: Number(video.height) || 0,
      pixelFormat: String(video.pix_fmt || ""),
      fps: Number((rationalToNumber(video.r_frame_rate) || rationalToNumber(video.avg_frame_rate)).toFixed(3)),
      profile: String(video.profile || ""),
    },
    audio: audio ? {
      codec: String(audio.codec_name || ""),
      sampleRate: Number(audio.sample_rate) || 0,
      channels: Number(audio.channels) || 0,
      channelLayout: String(audio.channel_layout || ""),
    } : null,
  };
};

const readStoredClip = async (id) => {
  if (!isStoredClipId(id)) return null;
  try {
    const record = JSON.parse(await fs.readFile(clipMetadataPath(id), "utf8"));
    await fs.access(clipVideoPath(id));
    return {
      ...record,
      id,
      downloadUrl: `/api/rendered-clips/${id}/download`,
    };
  } catch {
    return null;
  }
};

const listStoredClips = async () => {
  const entries = await fs.readdir(renderedClipsRoot, { withFileTypes: true });
  const clips = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => readStoredClip(entry.name.slice(0, -5))));
  return clips
    .filter(Boolean)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
};

const storeRenderedClip = async ({
  sourcePath,
  name,
  scope = "project",
  sceneName = "",
  profileOverride = null,
  compatibilityKeyOverride = "",
  onWarning = null,
}) => {
  const id = randomUUID();
  const destination = clipVideoPath(id);
  await fs.copyFile(sourcePath, destination);
  const stat = await fs.stat(destination);
  let inspectedProfile = null;
  try {
    const inspectionTimeout = new Promise((resolve) => {
      setTimeout(() => resolve(null), 8_000);
    });
    inspectedProfile = await Promise.race([inspectVideo(destination), inspectionTimeout]);
    if (!inspectedProfile) {
      onWarning?.("FFprobe kiểm tra metadata quá lâu; bỏ qua bước này để hoàn tất lưu video.");
    }
  } catch (error) {
    onWarning?.(`FFprobe không đọc được metadata clip: ${error instanceof Error ? error.message : String(error)}`);
    // Giữ video tải xuống được, nhưng chặn nối nhanh cho đến khi FFprobe sẵn sàng.
  }
  const profile = profileOverride || inspectedProfile;
  const compatibilityKey = compatibilityKeyOverride || (profile ? makeCompatibilityKey(profile) : "");
  const record = {
    id,
    name: safeVideoName(name),
    scope,
    sceneName: String(sceneName || ""),
    createdAt: new Date().toISOString(),
    size: stat.size,
    duration: profile?.duration || 0,
    profile,
    compatibilityKey,
  };
  await fs.writeFile(clipMetadataPath(id), JSON.stringify(record, null, 2), "utf8");
  return { ...record, downloadUrl: `/api/rendered-clips/${id}/download` };
};

const sendVideoDownload = async (response, filePath, name) => {
  try {
    const stat = await fs.stat(filePath);
    const downloadName = safeVideoName(name);
    const asciiName = downloadName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7e]/g, "-");
    response.writeHead(200, {
      ...corsHeaders,
      "Content-Type": "video/mp4",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: "Không tìm thấy file video" });
  }
};

const runConcatJob = async (job, clips) => {
  activeConcatJobId = job.id;
  job.status = "joining";
  job.message = `Đang nối nhanh ${clips.length} video…`;
  try {
    await fs.mkdir(job.outputDir, { recursive: true });
    const concatLines = clips.map((clip) => `file '${clipVideoPath(clip.id).replace(/\\/g, "/").replace(/'/g, "'\\''")}'`);
    await fs.writeFile(job.manifestPath, `${concatLines.join("\n")}\n`, "utf8");
    const child = spawn(ffmpegPath, [
      "-y", "-f", "concat", "-safe", "0", "-i", job.manifestPath,
      "-c", "copy", "-movflags", "+faststart", job.outputPath,
    ], { cwd: root, windowsHide: true });
    job.child = child;
    const consume = (chunk) => {
      const text = chunk.toString();
      job.log = `${job.log}${text}`.slice(-12000);
      const time = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!time || !job.totalDuration) return;
      const elapsed = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
      job.progress = Math.min(96, Math.max(1, Math.round((elapsed / job.totalDuration) * 100)));
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    const normalizedExitCode = normalizeProcessExitCode(exitCode);
    if (normalizedExitCode !== 0) throw new Error(`FFmpeg nối video kết thúc với mã lỗi ${normalizedExitCode}`);
    job.clip = await storeRenderedClip({
      sourcePath: job.outputPath,
      name: job.name,
      scope: "joined",
      sceneName: clips.map((clip) => clip.sceneName || clip.name).join(" · "),
      profileOverride: clips[0].profile,
      compatibilityKeyOverride: clips[0].compatibilityKey,
    });
    job.status = "completed";
    job.progress = 100;
    job.message = `Đã nối nhanh ${clips.length} video, không mã hóa lại.`;
    job.downloadUrl = job.clip.downloadUrl;
  } catch (error) {
    job.status = "failed";
    job.message = error instanceof Error ? error.message : "Không thể nối video";
  } finally {
    job.child = null;
    activeConcatJobId = null;
  }
};

const runJob = async (job, project, files) => {
  activeJobId = job.id;
  job.status = "preparing";
  job.stage = "preparing";
  job.stageLabel = "Chuẩn bị tài nguyên";
  job.detail = "Đang tạo thư mục làm việc cho phiên render…";
  try {
    await fs.mkdir(job.sourceDir, { recursive: true });
    await fs.mkdir(job.outputDir, { recursive: true });
    for (const [fileIndex, file] of files.entries()) {
      const filename = safeName(file.name);
      await fs.writeFile(path.join(job.sourceDir, filename), Buffer.from(await file.arrayBuffer()));
      job.progress = Math.min(6, Math.max(1, Math.round(((fileIndex + 1) / Math.max(1, files.length)) * 6)));
      job.detail = `Đã nhận tài nguyên ${fileIndex + 1}/${files.length}: ${filename}`;
    }
    await fs.writeFile(job.projectPath, JSON.stringify(project, null, 2), "utf8");
    job.progress = Math.max(job.progress, 7);
    job.detail = "Đã nhận JSON và tài nguyên; đang khởi động FFmpeg…";
    if (job.cancelRequested) {
      job.status = "cancelled";
      job.progress = 0;
      job.message = "Đã dừng render";
      job.stage = "cancelled";
      job.stageLabel = "Đã dừng";
      job.detail = job.message;
      return;
    }
    const frameMetrics = job.frameMetrics || getRenderFrameMetrics(project);
    job.frameMetrics = frameMetrics;
    job.renderFps = frameMetrics.fps;
    job.totalScenes = frameMetrics.scenes.length;
    job.totalDuration = frameMetrics.totalDuration;
    job.totalFrames = frameMetrics.totalFrames;
    job.renderedFrames = 0;
    job.sceneRenderedFrames = 0;
    job.sceneTotalFrames = 0;
    job.startedAt = Date.now();
    job.status = "rendering";
    job.stage = "scene";
    job.stageLabel = "Dựng cảnh";
    job.scene = 0;
    job.message = `Đang dựng 0/${job.totalScenes} cảnh`;
    job.detail = "Đang khởi động bộ dựng cảnh…";

    const rendererArgs = [
      ...(process.allowedNodeEnvironmentFlags.has("--use-system-ca") ? ["--use-system-ca"] : []),
      rendererScriptPath,
      job.projectPath,
      job.outputPath,
    ];
    const child = spawn(
      nodeBinary,
      rendererArgs,
      {
        cwd: root,
        windowsHide: true,
        env: {
          ...process.env,
          NODE_USE_SYSTEM_CA: process.env.NODE_USE_SYSTEM_CA || "1",
          FFMPEG_PATH: ffmpegPath,
          RENDER_SOURCE_DIR: job.sourceDir,
          RENDER_WORK_DIR: job.renderDir,
          RENDER_CACHE_DIR: renderCacheRoot,
        },
      },
    );
    job.child = child;
    const consume = (chunk) => {
      const text = chunk.toString();
      job.log = `${job.log}${text}`.slice(-12000);
      job.elapsedSeconds = renderElapsedSeconds(job);
      const lines = text.split(/\r?\n|\r/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        const encoderMatch = line.match(/^Video encoder:\s*(.+)$/i);
        if (encoderMatch) {
          job.videoEncoder = encoderMatch[1].trim();
          job.detail = `Encoder: ${job.videoEncoder}`;
          job.message = job.detail;
          continue;
        }
        const sceneMatch = line.match(/Rendering scene\s+(\d+)\/(\d+):\s*(.+)/i);
        if (sceneMatch) {
          const scene = Number(sceneMatch[1]);
          const totalScenes = Number(sceneMatch[2]);
          const sceneName = sceneMatch[3].trim();
          job.stage = "scene";
          job.stageLabel = "Dựng cảnh";
          job.scene = scene;
          job.totalScenes = totalScenes;
          job.sceneName = sceneName;
          const sceneMetric = job.frameMetrics?.scenes?.[scene - 1];
          job.sceneDuration = sceneMetric?.duration || 0;
          job.sceneRenderedFrames = 0;
          job.sceneTotalFrames = sceneMetric?.frames || 0;
          job.renderedFrames = sceneMetric?.frameOffset || 0;
          job.mediaTimeSeconds = 0;
          job.mediaDurationSeconds = job.sceneDuration;
          const frameRatio = job.totalFrames > 0
            ? renderProgressFromFrames(sceneMetric?.frameOffset || 0, job.totalFrames)
            : Number((8 + ((scene - 1) / Math.max(1, totalScenes)) * 80).toFixed(2));
          job.progress = Math.max(job.progress, frameRatio);
          job.detail = `Cảnh ${scene}/${totalScenes}: ${sceneName}`;
          job.message = job.detail;
          continue;
        }

        const sceneComplete = line.match(/Scene complete\s+(\d+)\/(\d+)/i);
        if (sceneComplete) {
          const scene = Number(sceneComplete[1]);
          const totalScenes = Number(sceneComplete[2]);
          job.scene = scene;
          job.totalScenes = totalScenes;
          const sceneMetric = job.frameMetrics?.scenes?.[scene - 1];
          if (sceneMetric) {
            job.sceneRenderedFrames = sceneMetric.frames;
            job.sceneTotalFrames = sceneMetric.frames;
            job.renderedFrames = sceneMetric.frameOffset + sceneMetric.frames;
          }
          const frameRatio = job.totalFrames > 0
            ? renderProgressFromFrames(job.renderedFrames, job.totalFrames)
            : Number((8 + (scene / Math.max(1, totalScenes)) * 80).toFixed(2));
          job.progress = Math.max(job.progress, frameRatio);
          job.detail = `Đã dựng xong cảnh ${scene}/${totalScenes}; đang chuyển sang bước tiếp theo…`;
          job.message = job.detail;
          continue;
        }

        const joining = line.match(/Render stage:\s*joining\s+(\d+)\s+rendered scenes/i);
        if (joining) {
          job.stage = "joining";
          job.stageLabel = "Nối các cảnh";
          job.mediaTimeSeconds = 0;
          job.mediaDurationSeconds = job.totalDuration || 0;
          job.progress = Math.max(job.progress, 90);
          job.detail = `Đang nối ${joining[1]} cảnh thành một video…`;
          job.message = job.detail;
          continue;
        }

        if (/Render stage:\s*mixing background music/i.test(line)) {
          job.stage = "mixing";
          job.stageLabel = "Trộn âm thanh";
          job.mediaTimeSeconds = 0;
          job.mediaDurationSeconds = job.totalDuration || 0;
          job.progress = Math.max(job.progress, 95);
          job.detail = "Đang trộn nhạc nền với phần thuyết minh…";
          job.message = job.detail;
          continue;
        }

        if (/Render stage:\s*finalizing output/i.test(line)) {
          job.stage = "finalizing";
          job.stageLabel = "Hoàn tất video";
          job.progress = Math.max(job.progress, 99);
          job.detail = "Đang đóng gói video và tối ưu file MP4…";
          job.message = job.detail;
          continue;
        }

        const frameMatch = line.match(/(?:^|\s)frame=\s*(\d+)/i);
        const time = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/i);
        if (!frameMatch && !time) continue;
        const mediaTime = time
          ? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3])
          : job.mediaTimeSeconds;
        job.mediaTimeSeconds = mediaTime;
        if (job.stage === "scene" && job.sceneDuration > 0 && job.totalScenes > 0) {
          const sceneMetric = job.frameMetrics?.scenes?.[job.scene - 1];
          const renderedSceneFrames = frameMatch
            ? clampRenderFrame(frameMatch[1], sceneMetric?.frames || job.sceneTotalFrames)
            : clampRenderFrame(mediaTime * job.renderFps, sceneMetric?.frames || job.sceneTotalFrames);
          const sceneProgress = sceneMetric?.frames > 0
            ? renderedSceneFrames / sceneMetric.frames
            : Math.min(1, mediaTime / job.sceneDuration);
          job.sceneRenderedFrames = renderedSceneFrames;
          job.sceneTotalFrames = sceneMetric?.frames || job.sceneTotalFrames;
          job.renderedFrames = (sceneMetric?.frameOffset || 0) + renderedSceneFrames;
          const overallFrameRatio = job.totalFrames > 0
            ? renderProgressFromFrames(job.renderedFrames, job.totalFrames)
            : Number((8 + ((job.scene - 1 + sceneProgress) / job.totalScenes) * 80).toFixed(2));
          job.progress = Math.max(job.progress, Math.min(88, overallFrameRatio));
          job.detail = `Cảnh ${job.scene}/${job.totalScenes}: ${job.sceneName || "đang mã hóa"} · ${renderedSceneFrames}/${job.sceneTotalFrames} frame · FFmpeg ${formatRenderClock(mediaTime)} / ${formatRenderClock(job.sceneDuration)}`;
          job.message = job.detail;
        } else if ((job.stage === "joining" || job.stage === "mixing") && job.mediaDurationSeconds > 0) {
          const start = job.stage === "joining" ? 90 : 95;
          const span = job.stage === "joining" ? 5 : 4;
          const ratio = Math.min(1, mediaTime / job.mediaDurationSeconds);
          job.progress = Math.max(job.progress, Math.min(start + span - 1, Math.round(start + ratio * span)));
          job.detail = `${job.stage === "joining" ? "Đang nối các cảnh" : "Đang trộn âm thanh"} · FFmpeg ${formatRenderClock(mediaTime)} / ${formatRenderClock(job.mediaDurationSeconds)}`;
          job.message = job.detail;
        }
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    if (job.cancelRequested) {
      job.status = "cancelled";
      job.progress = 0;
      job.message = "Đã dừng render";
      job.stage = "cancelled";
      job.stageLabel = "Đã dừng";
      job.detail = job.message;
      return;
    }
    const normalizedExitCode = normalizeProcessExitCode(exitCode);
    if (normalizedExitCode !== 0) {
      const detail = summarizeFfmpegFailure(job.log);
      throw new Error(`FFmpeg kết thúc với mã lỗi ${normalizedExitCode}${detail ? `: ${detail}` : ""}`);
    }
    job.stage = "finalizing";
    job.stageLabel = "Hoàn tất video";
    job.progress = Math.max(job.progress, 99);
    job.detail = "Đang lưu video vào thư viện render…";
    job.message = job.detail;
    job.clip = await storeRenderedClip({
      sourcePath: job.outputPath,
      name: project.title || "video",
      scope: project.renderScope === "scene" ? "scene" : "project",
      sceneName: project.renderedSceneName || "",
    });
    job.status = "completed";
    job.progress = 100;
    job.message = "Render hoàn tất";
    job.stage = "completed";
    job.stageLabel = "Hoàn tất";
    job.detail = "Video đã được lưu vào thư viện render.";
    job.mediaTimeSeconds = job.totalDuration || job.mediaTimeSeconds;
    job.mediaDurationSeconds = job.totalDuration || job.mediaDurationSeconds;
    job.downloadUrl = job.clip.downloadUrl;
  } catch (error) {
    if (job.cancelRequested) {
      job.status = "cancelled";
      job.progress = 0;
      job.message = "Đã dừng render";
      job.stage = "cancelled";
      job.stageLabel = "Đã dừng";
      job.detail = job.message;
    } else {
      job.status = "failed";
      job.message = error instanceof Error ? error.message : "Không thể render video";
      job.stage = "failed";
      job.stageLabel = "Render lỗi";
      job.detail = job.message;
    }
  } finally {
    job.child = null;
    activeJobId = null;
  }
};

await fs.mkdir(jobsRoot, { recursive: true });
await fs.mkdir(spriteAssetsRoot, { recursive: true });
await fs.mkdir(renderCacheRoot, { recursive: true });
await fs.mkdir(renderedClipsRoot, { recursive: true });
await fs.mkdir(concatJobsRoot, { recursive: true });

const runWhiteboardJob = async (job, uploads, options) => {
  activeWhiteboardJobId = job.id;
  job.status = "preparing";
  job.message = "Đang nhận tài nguyên Whiteboard…";
  let heartbeatTimer = null;
  try {
    await fs.mkdir(job.sourceDir, { recursive: true });
    await fs.mkdir(job.outputDir, { recursive: true });
    const saved = {};
    let lineBuffer = null;
    job.log = String(job.log || "") + "[prepare] Bắt đầu chuẩn bị tài nguyên Whiteboard\n";
    for (const key of ["line", "annotation", "color", "hand", "audio", "subtitle"]) {
      const file = uploads[key];
      if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") continue;
      const filename = safeName(file.name || key);
      const target = path.join(job.sourceDir, filename);
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(target, buffer);
      saved[key] = target;
      if (key === "line") lineBuffer = buffer;
    }
    job.log = String(job.log || "") + "[prepare] Đã nhận line art" + (saved.color ? ", color reference" : "") + (saved.audio ? ", audio" : "") + (saved.subtitle ? ", subtitle" : "") + "\n";
    const remoteAudioUrl = typeof uploads.audioUrl === "string" ? uploads.audioUrl.trim() : "";
    if (!saved.audio && remoteAudioUrl) {
      const parsedAudioUrl = new URL(remoteAudioUrl);
      if (!/^https?:$/.test(parsedAudioUrl.protocol)) throw new Error("URL audio phải dùng http hoặc https");
      job.stage = "preparing";
      job.stageLabel = "Tải audio từ URL";
      job.progress = 4;
      job.detail = "Đang tải audio từ URL…";
      job.message = job.detail;
      const remoteAudio = await fetch(parsedAudioUrl);
      if (!remoteAudio.ok) throw new Error(`Không tải được audio từ URL (${remoteAudio.status})`);
      const remoteAudioBuffer = Buffer.from(await remoteAudio.arrayBuffer());
      if (remoteAudioBuffer.length > 128 * 1024 * 1024) throw new Error("Audio từ URL vượt quá giới hạn 128 MB");
      const extension = path.extname(parsedAudioUrl.pathname) || ".audio";
      const target = path.join(job.sourceDir, `remote-audio${extension}`);
      await fs.writeFile(target, remoteAudioBuffer);
      saved.audio = target;
      job.log = `${String(job.log || "")}Audio URL: đã tải ${remoteAudioBuffer.length.toLocaleString("en-US")} bytes\n`;
    }
    if (!saved.line) throw new Error("Thiếu Line art");
    if (!saved.annotation) {
      const generatedAnnotationPath = path.join(job.sourceDir, "generated.annotation.json");
      await fs.writeFile(generatedAnnotationPath, JSON.stringify(buildWhiteboardAnnotation({ lineBuffer, modules: options.modules, canvas: options.canvas }), null, 2), "utf8");
      saved.annotation = generatedAnnotationPath;
      job.log = String(job.log || "") + "[annotation] Không có Annotation JSON, đã tạo tự động từ Drawing Modules\n";
    } else {
      job.log = String(job.log || "") + "[annotation] Sử dụng Annotation JSON do người dùng cung cấp\n";
    }
    let annotation = null;
    try {
      annotation = JSON.parse(await fs.readFile(saved.annotation, "utf8"));
    } catch {
      annotation = null;
    }
    const totalDuration = Math.max(1, Number(annotation?.sceneDurationMs) || 5_000) / 1000;
    const renderFps = 30;
    job.renderFps = renderFps;
    job.totalDuration = totalDuration;
    job.totalFrames = Math.max(1, Math.ceil(totalDuration * renderFps));
    job.renderedFrames = 0;
    job.startedAt = Date.now();
    job.stage = "preparing";
    job.stageLabel = "Chuẩn bị Whiteboard";
    job.detail = `Whiteboard · 0/${job.totalFrames} frame · ${renderFps} FPS`;
    job.message = job.detail;
    job.log = `${String(job.log || "")}Whiteboard renderer: ${renderFps} FPS · ${job.totalFrames} total frames · ${totalDuration.toFixed(2)}s\n`;
    job.progress = 8;
    job.message = "Đang khởi động renderer Whiteboard…";
    job.log = String(job.log || "") + "[renderer] Khởi động native renderer với draw speed " + options.drawSpeed.toFixed(2) + "×\n";
    const args = [saved.line, saved.annotation, job.outputPath];
    if (saved.hand) args.push(saved.hand);
    if (saved.color) args.push("--color-reference", saved.color);
    if (saved.audio) {
      args.push("--audio", saved.audio);
      if (Number(options.audioStartMs) > 0) args.push("--audio-start-ms", String(Math.round(Number(options.audioStartMs))));
    }
    if (saved.subtitle) args.push("--subtitle", saved.subtitle);
    args.push("--draw-speed", String(options.drawSpeed), "--line-reveal", options.lineReveal, "--match-bg", options.matchBg, "--color-fill", options.colorFill, "--aspect-ratio", options.aspectRatio, "--cap-long-edge", String(options.capLongEdge));
    if (options.bareTip) args.push("--bare-tip");
    job.status = "rendering";
    job.stage = "rendering";
    job.stageLabel = "Đang vẽ Whiteboard";
    job.progress = 12;
    job.message = "Đang vẽ line art và phủ màu…";
    const updateHeartbeat = () => {
      if (job.status !== "rendering" || !job.startedAt) return;
      const elapsed = renderElapsedSeconds(job);
      const estimatedMediaTime = Math.min(job.totalDuration, elapsed);
      const estimatedFrames = clampRenderFrame(estimatedMediaTime * job.renderFps, job.totalFrames);
      if (estimatedFrames > job.renderedFrames) job.renderedFrames = estimatedFrames;
      if (!job.telemetrySeen) job.frameEstimate = true;
      job.elapsedSeconds = elapsed;
      const frameRatio = job.totalFrames > 0 ? job.renderedFrames / job.totalFrames : 0;
      const overrunSeconds = Math.max(0, elapsed - job.totalDuration);
      const overrunProgress = Math.min(7, overrunSeconds / Math.max(5, job.totalDuration * 0.25));
      job.progress = Math.max(job.progress, Math.min(99, Math.round(12 + frameRatio * 80 + overrunProgress)));
      const mediaTime = Math.min(job.totalDuration, Math.max(Number(job.mediaTimeSeconds) || 0, estimatedMediaTime));
      const estimateMark = job.frameEstimate ? "≈" : "";
      const phaseLabel = overrunSeconds > 0 ? " · đang hoàn tất renderer" : "";
      job.detail = "Whiteboard · " + estimateMark + job.renderedFrames + "/" + job.totalFrames + " frame · " + job.renderFps + " FPS · " + formatRenderClock(mediaTime) + " / " + formatRenderClock(job.totalDuration) + phaseLabel;
      job.message = job.detail;
    };
    heartbeatTimer = setInterval(updateHeartbeat, 500);
    heartbeatTimer.unref?.();
    const child = spawn(whiteboardRendererPath, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    job.child = child;
    const consume = (chunk) => {
      const output = chunk.toString();
      job.log = (String(job.log || "") + output).slice(-60000);
      job.elapsedSeconds = renderElapsedSeconds(job);
      const lower = output.toLowerCase();
      if (lower.includes("color") || lower.includes("colour")) job.progress = Math.max(job.progress, 72);
      else if (lower.includes("render") || lower.includes("frame")) job.progress = Math.max(job.progress, 34);
      const lines = output.split(/\r\n|\n|\r/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        const frameMatch = line.match(/(?:frame(?:s)?|rendered\s+frames?|processed\s+frames?)\s*[=:]?\s*(\d+)/i);
        const timeMatch = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/i);
        if (!frameMatch && !timeMatch) {
          job.detail = line.slice(-360);
          job.message = job.detail;
          continue;
        }
        const mediaTime = timeMatch ? Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]) : job.mediaTimeSeconds || 0;
        job.telemetrySeen = true;
        job.frameEstimate = false;
        job.mediaTimeSeconds = mediaTime;
        const renderedFrames = frameMatch
          ? clampRenderFrame(frameMatch[1], job.totalFrames)
          : clampRenderFrame(mediaTime * job.renderFps, job.totalFrames);
        job.renderedFrames = Math.max(job.renderedFrames, renderedFrames);
        const frameRatio = job.totalFrames > 0 ? job.renderedFrames / job.totalFrames : 0;
        job.progress = Math.max(job.progress, Math.min(92, Math.round(12 + frameRatio * 80)));
        job.detail = `Whiteboard · ${job.renderedFrames}/${job.totalFrames} frame · ${job.renderFps} FPS · ${formatRenderClock(mediaTime)} / ${formatRenderClock(job.totalDuration)}`;
        job.message = job.detail;
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    const exitCode = normalizeProcessExitCode(result.code);
    job.log = String(job.log || "") + "[renderer] Process kết thúc với mã " + String(exitCode) + (result.signal ? " (" + result.signal + ")" : "") + "\n";
    if (exitCode !== 0) throw new Error("Whiteboard renderer kết thúc với mã " + String(exitCode) + (result.signal ? " (" + result.signal + ")" : ""));
    await fs.access(job.outputPath);
    job.progress = 99;
    job.stage = "finalizing";
    job.stageLabel = "Lưu video";
    job.renderedFrames = job.totalFrames;
    job.detail = `Đã xử lý ${job.totalFrames} frame · đang lưu video vào thư viện render…`;
    job.message = job.detail;
    job.log = String(job.log || "") + "[finalize] Đã tạo file MP4, bắt đầu kiểm tra metadata và lưu vào thư viện render\n";
    job.clip = await storeRenderedClip({ sourcePath: job.outputPath, name: job.name, scope: "whiteboard", sceneName: "Whiteboard", onWarning: (message) => { job.log = (String(job.log || "") + "[finalize] " + message + "\n").slice(-60000); } });
    job.downloadUrl = job.clip.downloadUrl;
    job.status = "completed";
    job.progress = 100;
    job.stage = "completed";
    job.stageLabel = "Hoàn tất";
    job.detail = `Đã render Whiteboard · ${job.totalFrames} frame`;
    job.message = "Đã render Whiteboard thành công";
    job.log = (String(job.log || "") + "[complete] Hoàn tất render Whiteboard · " + job.totalFrames + " frame · video đã lưu\n").slice(-60000);
  } catch (error) {
    job.status = "failed";
    job.stage = "failed";
    job.stageLabel = "Render lỗi";
    job.detail = error instanceof Error ? error.message : "Không thể render Whiteboard";
    job.message = job.detail;
    job.log = (String(job.log || "") + "ERROR: " + job.detail + "\n").slice(-60000);
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    job.child = null;
    activeWhiteboardJobId = null;
  }
};
const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (request.method === "GET" && url.pathname === "/api/health") {
    const ready = await ffmpegReady();
    const busy = Boolean(activeJobId || activeCacheSync || activeConcatJobId);
    sendJson(response, ready ? 200 : 503, {
      ready,
      busy,
      ffmpegPath,
      message: ready
        ? activeCacheSync
          ? "Dịch vụ đang tải trước tài nguyên URL"
          : activeConcatJobId
            ? "Dịch vụ đang nối nhanh video"
          : "Dịch vụ render cục bộ đã sẵn sàng"
        : "Chưa tìm thấy FFmpeg. Hãy chạy npm run render:setup",
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/tts") {
    try {
      const webRequest = new Request(`http://${host}:${port}${url.pathname}`, {
        method: "POST",
        headers: request.headers,
        body: request,
        duplex: "half",
      });
      const body = await webRequest.json();
      const text = String(body?.text || "").trim();
      const apiKey = String(process.env.ELEVENLABS_API_KEY || "").trim();
      const voiceId = String(body?.voiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM").trim();
      if (!text) throw new Error("Thiếu lời thuyết minh");
      if (!apiKey) throw new Error("Chưa cấu hình ELEVENLABS_API_KEY");
      if (text.length > 10000) throw new Error("Lời thuyết minh vượt quá 10.000 ký tự");
      const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0,
            use_speaker_boost: true,
          },
        }),
      });
      if (!ttsResponse.ok) {
        const detail = (await ttsResponse.text()).replace(/\s+/g, " ").slice(0, 240);
        throw new Error(`ElevenLabs từ chối yêu cầu (${ttsResponse.status})${detail ? `: ${detail}` : ""}`);
      }
      const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
      sendJson(response, 200, {
        audioBase64: audioBuffer.toString("base64"),
        mimeType: "audio/mpeg",
      });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Không thể tạo giọng đọc" });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/cache") {
    try {
      sendJson(response, 200, await getResourceCacheSummary(renderCacheRoot));
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "Không thể đọc thư viện cache" });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/cache/sync") {
    if (activeJobId || activeConcatJobId) {
      sendJson(response, 409, { error: activeConcatJobId
        ? "Đang nối video. Hãy chờ hoàn tất trước khi tải trước tài nguyên."
        : "Đang render video. Hãy chờ render hoàn tất trước khi tải trước tài nguyên." });
      return;
    }
    if (activeCacheSync) {
      sendJson(response, 409, { error: "Đang có một lượt tải trước tài nguyên URL." });
      return;
    }
    activeCacheSync = true;
    try {
      const webRequest = new Request(`http://${host}:${port}${url.pathname}`, {
        method: "POST",
        headers: request.headers,
        body: request,
        duplex: "half",
      });
      const body = await webRequest.json();
      const project = body?.project;
      if (!project || typeof project !== "object" || !Array.isArray(project.scenes)) {
        throw new Error("Thiếu JSON dự án để quét URL tài nguyên");
      }
      const report = await syncProjectResourceCache(project, renderCacheRoot);
      sendJson(response, 200, report);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Không thể tải trước tài nguyên URL" });
    } finally {
      activeCacheSync = false;
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/process-sprite") {
    try {
      const webRequest = new Request(`http://${host}:${port}${url.pathname}`, {
        method: "POST",
        headers: request.headers,
        body: request,
        duplex: "half",
      });
      const body = await webRequest.json();
      const sourceUrl = String(body?.sourceUrl || "").trim();
      const sourceData = String(body?.sourceData || "");
      const sourceName = safeName(body?.sourceName || "sprite-sheet");
      if (!sourceUrl && !sourceData) throw new Error("Hãy nhập URL hoặc chọn file sprite");
      let parsed = null;
      if (sourceUrl) {
        parsed = new URL(sourceUrl);
        if (!/^https?:$/.test(parsed.protocol)) throw new Error("URL hình phải dùng http hoặc https");
      }
      if (sourceData && !/^data:[^;]+;base64,[a-z0-9+/=\s]+$/i.test(sourceData)) {
        throw new Error(`Dữ liệu file ${sourceName} không hợp lệ`);
      }
      const requestedDelay = Number(body?.delay);
      const delay = Number.isFinite(requestedDelay)
        ? Math.min(1000, Math.max(60, Math.round(requestedDelay)))
        : 180;
      const requestedFrameSize = Number(body?.frameSize);
      const frameSize = Number.isFinite(requestedFrameSize)
        ? Math.min(1024, Math.max(128, Math.round(requestedFrameSize)))
        : 0;
      const sourceKey = sourceUrl || createHash("sha256").update(sourceData).digest("hex");
      const cacheKey = createHash("sha256")
        .update(`${spriteProcessVersion}\0${sourceKey}\0${delay}\0${frameSize || "auto"}`)
        .digest("hex");
      const outputPath = path.join(spriteAssetsRoot, `${cacheKey}.webp`);
      const assetUrl = `http://${host}:${port}/api/sprite-assets/${cacheKey}.webp`;
      try {
        await fs.access(outputPath);
        sendJson(response, 200, { processed: true, assetUrl, delay, ...(frameSize ? { frameSize } : {}) });
        return;
      } catch {
        // Cache miss: read the selected file or download the remote source below.
      }
      let sourceBuffer;
      if (sourceData) {
        const encoded = sourceData.slice(sourceData.indexOf(",") + 1).replace(/\s+/g, "");
        sourceBuffer = Buffer.from(encoded, "base64");
      } else {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
        let remote;
        try {
          remote = await fetch(parsed, { signal: controller.signal });
        } finally {
          clearTimeout(timeout);
        }
        if (!remote.ok) throw new Error(`Không tải được hình (${remote.status})`);
        const contentLength = Number(remote.headers.get("content-length") || 0);
        if (contentLength > 25 * 1024 * 1024) throw new Error("Hình sprite vượt quá giới hạn 25 MB");
        sourceBuffer = Buffer.from(await remote.arrayBuffer());
      }
      if (sourceBuffer.length > 25 * 1024 * 1024) throw new Error("Hình sprite vượt quá giới hạn 25 MB");
      const result = await processSpriteSheetBuffer(sourceBuffer, {
        delay,
        ...(frameSize ? { frameSize } : {}),
      });
      if (!result.detected) {
        sendJson(response, 200, { processed: false, reason: result.reason });
        return;
      }
      await fs.writeFile(outputPath, result.buffer);
      sendJson(response, 200, {
        processed: true,
        assetUrl,
        frameCount: result.frameCount,
        frameSize: result.frameSize,
        delay: result.delay,
        ...(result.columns ? { columns: result.columns } : {}),
        ...(result.rows ? { rows: result.rows } : {}),
        ...(result.confidence ? { confidence: result.confidence } : {}),
        ...(result.mode ? { mode: result.mode } : {}),
      });
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : "Không thể xử lý sprite sheet",
      });
    }
    return;
  }

  const spriteAssetMatch = url.pathname.match(/^\/api\/sprite-assets\/([a-f0-9]{64})\.webp$/i);
  if (request.method === "GET" && spriteAssetMatch) {
    const assetPath = path.join(spriteAssetsRoot, `${spriteAssetMatch[1].toLowerCase()}.webp`);
    const download = url.searchParams.get("download") === "1";
    try {
      const stat = await fs.stat(assetPath);
      response.writeHead(200, {
        ...corsHeaders,
        "Content-Type": "image/webp",
        "Content-Length": stat.size,
        ...(download ? { "Content-Disposition": "attachment; filename=\"kito-sprite-animation.webp\"" } : {}),
      });
      const file = await import("node:fs");
      file.createReadStream(assetPath).pipe(response);
    } catch {
      sendJson(response, 404, { error: "Không tìm thấy ảnh sprite đã xử lý" });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/align-subtitles") {
    if (activeSubtitleAlignment) {
      sendJson(response, 409, { error: "Đang có một phiên tạo phụ đề khác. Vui lòng chờ hoàn tất." });
      return;
    }
    activeSubtitleAlignment = true;
    const alignmentId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const alignmentRoot = path.join(jobsRoot, "subtitle-align", alignmentId);
    try {
      const webRequest = new Request(`http://${host}:${port}${url.pathname}`, {
        method: "POST",
        headers: request.headers,
        body: request,
        duplex: "half",
      });
      const form = await webRequest.formData();
      const text = String(form.get("text") || "").trim();
      const mode = String(form.get("mode") || "").trim();
      if (!text && mode !== "audio") throw new Error("Thiếu Lời thuyết minh để tạo phụ đề");
      const audioValue = form.get("audio");
      const audioUrl = String(form.get("audioUrl") || "").trim();
      if (typeof audioValue === "string" && !audioUrl) throw new Error("File audio không hợp lệ");
      await fs.mkdir(alignmentRoot, { recursive: true });
      let audioPath = "";
      if (audioValue && typeof audioValue !== "string" && typeof audioValue.arrayBuffer === "function") {
        audioPath = path.join(alignmentRoot, safeName(audioValue.name || "voice-audio"));
        await fs.writeFile(audioPath, Buffer.from(await audioValue.arrayBuffer()));
      } else if (audioUrl) {
        const parsed = new URL(audioUrl);
        if (!/^https?:$/.test(parsed.protocol)) throw new Error("URL audio phải dùng http hoặc https");
        const remote = await fetch(parsed);
        if (!remote.ok) throw new Error(`Không tải được audio (${remote.status})`);
        const extension = path.extname(parsed.pathname) || ".audio";
        audioPath = path.join(alignmentRoot, `remote-audio${extension}`);
        await fs.writeFile(audioPath, Buffer.from(await remote.arrayBuffer()));
      } else {
        throw new Error("Chưa có file audio để đồng bộ phụ đề");
      }
      const result = await alignSubtitles({
        text,
        audioPath,
        workDir: alignmentRoot,
        requestedDuration: Number(form.get("duration") || 0),
      });
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Không thể tạo timestamp phụ đề" });
    } finally {
      activeSubtitleAlignment = false;
      await fs.rm(alignmentRoot, { recursive: true, force: true });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/rendered-clips") {
    try {
      sendJson(response, 200, { clips: await listStoredClips() });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "Không thể đọc thư viện video đã render" });
    }
    return;
  }

  const renderedClipDeleteMatch = url.pathname.match(/^\/api\/rendered-clips\/([a-f0-9-]+)$/i);
  if (request.method === "DELETE" && renderedClipDeleteMatch) {
    const id = renderedClipDeleteMatch[1];
    if (!isStoredClipId(id)) {
      sendJson(response, 400, { error: "Mã video không hợp lệ" });
      return;
    }
    try {
      const clip = await readStoredClip(id);
      if (!clip) {
        sendJson(response, 404, { error: "Không tìm thấy video đã render" });
        return;
      }
      await Promise.all([
        fs.rm(clipVideoPath(id), { force: true }),
        fs.rm(clipMetadataPath(id), { force: true }),
      ]);
      sendJson(response, 200, { deleted: true, id });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "Không thể xóa video đã render" });
    }
    return;
  }

  const renderedClipDownloadMatch = url.pathname.match(/^\/api\/rendered-clips\/([a-f0-9-]+)\/download$/i);
  if (request.method === "GET" && renderedClipDownloadMatch) {
    const clip = await readStoredClip(renderedClipDownloadMatch[1]);
    if (!clip) {
      sendJson(response, 404, { error: "Không tìm thấy video đã render" });
      return;
    }
    await sendVideoDownload(response, clipVideoPath(clip.id), clip.name);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/concat") {
    if (activeJobId || activeCacheSync || activeConcatJobId) {
      sendJson(response, 409, { error: activeJobId
        ? "Đang render video. Hãy chờ render hoàn tất trước khi nối."
        : activeCacheSync
          ? "Đang tải trước tài nguyên URL. Hãy chờ hoàn tất trước khi nối."
          : "Đang có một lượt nối video khác." });
      return;
    }
    if (!(await ffmpegReady())) {
      sendJson(response, 503, { error: "Chưa tìm thấy FFmpeg. Hãy chạy npm run render:setup." });
      return;
    }
    try {
      const webRequest = new Request(`http://${host}:${port}${url.pathname}`, {
        method: "POST",
        headers: request.headers,
        body: request,
        duplex: "half",
      });
      const body = await webRequest.json();
      const clipIds = Array.isArray(body?.clipIds) ? body.clipIds.map(String) : [];
      if (clipIds.length < 2) throw new Error("Hãy chọn ít nhất 2 video để nối");
      if (new Set(clipIds).size !== clipIds.length || clipIds.some((id) => !isStoredClipId(id))) {
        throw new Error("Danh sách video cần nối không hợp lệ");
      }
      const clips = await Promise.all(clipIds.map((id) => readStoredClip(id)));
      if (clips.some((clip) => !clip)) throw new Error("Một hoặc nhiều video đã render không còn trong thư viện");
      if (clips.some((clip) => clip.scope === "joined")) {
        throw new Error("Nối nhanh chỉ nhận clip render gốc. Hãy chọn các cảnh hoặc clip gốc để tránh lỗi timestamp khi nối lồng nhiều lần.");
      }
      const compatibleKey = clips[0].compatibilityKey;
      if (!compatibleKey || clips.some((clip) => clip.compatibilityKey !== compatibleKey)) {
        throw new Error("Các video chưa cùng codec, kích thước, FPS hoặc âm thanh nên không thể nối nhanh an toàn");
      }
      const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
      const jobRoot = path.join(concatJobsRoot, id);
      const job = {
        id,
        status: "queued",
        progress: 0,
        message: "Đang chuẩn bị nối video",
        log: "",
        name: safeVideoName(body?.name || "video-noi"),
        outputDir: path.join(jobRoot, "output"),
        manifestPath: path.join(jobRoot, "clips.txt"),
        outputPath: path.join(jobRoot, "output", safeVideoName(body?.name || "video-noi")),
        totalDuration: clips.reduce((total, clip) => total + (Number(clip.duration) || 0), 0),
      };
      concatJobs.set(id, job);
      void runConcatJob(job, clips);
      sendJson(response, 202, { jobId: id });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Không thể nối video" });
    }
    return;
  }

  const concatStatusMatch = url.pathname.match(/^\/api\/concat\/([^/]+)$/);
  if (request.method === "GET" && concatStatusMatch) {
    const job = concatJobs.get(concatStatusMatch[1]);
    if (!job) {
      sendJson(response, 404, { error: "Không tìm thấy phiên nối video" });
      return;
    }
    sendJson(response, 200, {
      id: job.id,
      status: job.status,
      progress: job.progress,
      message: job.message,
      downloadUrl: job.downloadUrl || null,
      clip: job.clip || null,
      log: job.status === "failed" ? job.log.slice(-3000) : undefined,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/whiteboard/render") {
    if (activeJobId || activeCacheSync || activeConcatJobId || activeWhiteboardJobId) {
      sendJson(response, 409, { error: "Local renderer đang bận với một phiên khác. Vui lòng chờ hoàn tất." });
      return;
    }
    if (!(await whiteboardRendererReady())) {
      sendJson(response, 503, { error: "Chưa tìm thấy Whiteboard renderer portable. Hãy chạy lại bước chuẩn bị desktop hoặc đặt KITO_WHITEBOARD_RENDERER." });
      return;
    }
    try {
      const webRequest = new Request("http://" + host + ":" + port + url.pathname, {
        method: "POST",
        headers: request.headers,
        body: request,
        duplex: "half",
      });
      const form = await webRequest.formData();
      const uploads = {
        line: form.get("line"),
        annotation: form.get("annotation"),
        color: form.get("color"),
        hand: form.get("hand"),
        audio: form.get("audio"),
        audioUrl: typeof form.get("audioUrl") === "string" ? String(form.get("audioUrl")).trim() : "",
        subtitle: form.get("subtitle"),
      };
      const validUpload = (value) => value && typeof value !== "string" && typeof value.arrayBuffer === "function";
      if (!validUpload(uploads.line)) throw new Error("Hãy gửi đủ Line art");
      let rawOptions = {};
      try {
        rawOptions = JSON.parse(String(form.get("options") || "{}"));
      } catch {
        rawOptions = {};
      }
      const pick = (value, choices, fallback) => choices.includes(value) ? value : fallback;
      const options = {
        drawSpeed: Math.min(1.5, Math.max(0.25, Number(rawOptions.drawSpeed) || 1.0)),
        colorFill: pick(rawOptions.colorFill, ["hybrid", "brush", "contour-wipe"], "hybrid"),
        lineReveal: pick(rawOptions.lineReveal, ["skeleton", "pixel"], "skeleton"),
        matchBg: pick(rawOptions.matchBg, ["auto", "on", "off"], "auto"),
        aspectRatio: pick(rawOptions.aspectRatio, ["auto", "9:16", "16:9", "4:3", "1:1"], "auto"),
        capLongEdge: pick(Number(rawOptions.capLongEdge), [720, 1080, 1440], 1080),
        audioStartMs: Math.max(0, Number(rawOptions.audioStartMs) || 0),
        bareTip: Boolean(rawOptions.bareTip),
        modules: Array.isArray(rawOptions.modules) ? rawOptions.modules : [],
        canvas: rawOptions.canvas && typeof rawOptions.canvas === "object" ? rawOptions.canvas : null,
      };
      const requestedName = typeof form.get("name") === "string" ? form.get("name") : "whiteboard-scene";
      const id = Date.now() + "-" + randomUUID().slice(0, 8);
      const jobRoot = path.join(whiteboardJobsRoot, id);
      const job = {
        id,
        status: "queued",
        progress: 0,
        message: "Đang xếp hàng Whiteboard…",
        log: "",
        name: safeVideoName(requestedName),
        sourceDir: path.join(jobRoot, "source"),
        outputDir: path.join(jobRoot, "output"),
        outputPath: path.join(jobRoot, "output", safeVideoName(requestedName)),
      };
      whiteboardJobs.set(id, job);
      void runWhiteboardJob(job, uploads, options);
      sendJson(response, 202, { jobId: id });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Dữ liệu Whiteboard không hợp lệ" });
    }
    return;
  }

  const whiteboardStatusMatch = url.pathname.match(/^\/api\/whiteboard\/render\/([^/]+)$/);
  if (request.method === "GET" && whiteboardStatusMatch) {
    const job = whiteboardJobs.get(whiteboardStatusMatch[1]);
    if (!job) {
      sendJson(response, 404, { error: "Không tìm thấy phiên Whiteboard" });
      return;
    }
    sendJson(response, 200, whiteboardJobPayload(job));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/render") {
    if (activeJobId || activeCacheSync || activeConcatJobId) {
      sendJson(response, 409, { error: activeCacheSync
        ? "Đang tải trước tài nguyên URL. Vui lòng chờ hoàn tất."
        : activeConcatJobId
          ? "Đang nối video. Vui lòng chờ hoàn tất."
          : "Đang có một video được render. Vui lòng chờ hoàn tất." });
      return;
    }
    if (!(await ffmpegReady())) {
      sendJson(response, 503, { error: "Chưa tìm thấy FFmpeg. Hãy chạy npm run render:setup." });
      return;
    }
    try {
      const webRequest = new Request(`http://${host}:${port}${url.pathname}`, {
        method: "POST",
        headers: request.headers,
        body: request,
        duplex: "half",
      });
      const form = await webRequest.formData();
      const projectValue = form.get("project");
      if (typeof projectValue !== "string") throw new Error("Thiếu dữ liệu JSON của dự án");
      const project = JSON.parse(projectValue);
      if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
        throw new Error("Dự án chưa có cảnh để render");
      }
      const frameMetrics = getRenderFrameMetrics(project);
      const files = form.getAll("media").filter(
        (item) => typeof item !== "string" && typeof item.arrayBuffer === "function",
      );
      const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
      const jobRoot = path.join(jobsRoot, id);
      const job = {
        id,
        status: "queued",
        cancelRequested: false,
        progress: 0,
        message: "Đang chuẩn bị tài nguyên",
        stage: "queued",
        stageLabel: "Đang xếp hàng",
        detail: "Đang chờ phiên render được khởi động…",
        scene: 0,
        totalScenes: frameMetrics.scenes.length,
        frameMetrics,
        renderFps: frameMetrics.fps,
        renderedFrames: 0,
        totalFrames: frameMetrics.totalFrames,
        sceneRenderedFrames: 0,
        sceneTotalFrames: 0,
        mediaTimeSeconds: 0,
        mediaDurationSeconds: 0,
        elapsedSeconds: 0,
        startedAt: null,
        log: "",
        sourceDir: path.join(jobRoot, "source"),
        renderDir: path.join(jobRoot, "render"),
        outputDir: path.join(jobRoot, "output"),
        projectPath: path.join(jobRoot, "project.json"),
        outputPath: path.join(jobRoot, "output", `${safeName(project.title || "video")}.mp4`),
        scope: project.renderScope === "scene" ? "scene" : "project",
        sceneName: String(project.renderedSceneName || ""),
      };
      jobs.set(id, job);
      void runJob(job, project, files);
      sendJson(response, 202, { jobId: id });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Dữ liệu render không hợp lệ" });
    }
    return;
  }

  const cancelMatch = url.pathname.match(/^\/api\/render\/([^/]+)\/cancel$/);
  if (request.method === "POST" && cancelMatch) {
    const job = jobs.get(cancelMatch[1]);
    if (!job) {
      sendJson(response, 404, { error: "Không tìm thấy phiên render" });
      return;
    }
    if (["completed", "failed", "cancelled"].includes(job.status)) {
      sendJson(response, 200, renderJobPayload(job));
      return;
    }
    job.cancelRequested = true;
    job.status = "cancelling";
    job.message = "Đang dừng render…";
    if (job.child?.pid) {
      if (process.platform === "win32") {
        execFile("taskkill", ["/PID", String(job.child.pid), "/T", "/F"], () => undefined);
      } else {
        job.child.kill("SIGTERM");
      }
    }
    sendJson(response, 202, { id: job.id, status: job.status });
    return;
  }

  const statusMatch = url.pathname.match(/^\/api\/render\/([^/]+)$/);
  if (request.method === "GET" && statusMatch) {
    const job = jobs.get(statusMatch[1]);
    if (!job) {
      sendJson(response, 404, { error: "Không tìm thấy phiên render" });
      return;
    }
    sendJson(response, 200, renderJobPayload(job));
    return;
  }

  const downloadMatch = url.pathname.match(/^\/api\/render\/([^/]+)\/download$/);
  if (request.method === "GET" && downloadMatch) {
    const job = jobs.get(downloadMatch[1]);
    if (!job || job.status !== "completed") {
      sendJson(response, 404, { error: "Video chưa sẵn sàng" });
      return;
    }
    await sendVideoDownload(response, job.outputPath, path.basename(job.outputPath));
    return;
  }

  sendJson(response, 404, { error: "Đường dẫn không tồn tại" });
});

server.listen(port, host, () => {
  console.log(`Kito Local Renderer: http://${host}:${port}`);
  console.log("Giữ cửa sổ này mở trong khi render từ website.");
});
