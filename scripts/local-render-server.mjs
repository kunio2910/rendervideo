import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { alignSubtitles } from "./align-subtitles.mjs";
import { getResourceCacheSummary, syncProjectResourceCache } from "./render-resource-cache.mjs";
import { processSpriteSheetBuffer } from "./sprite-sheet.mjs";

const root = process.cwd();
const host = "127.0.0.1";
const port = Number(process.env.LOCAL_RENDER_PORT || 4179);
const jobsRoot = path.join(root, "work", "local-render-jobs");
const spriteAssetsRoot = path.join(jobsRoot, "sprite-assets");
const renderCacheRoot = path.join(jobsRoot, "render-cache");
const renderedClipsRoot = path.join(jobsRoot, "rendered-clips");
const concatJobsRoot = path.join(jobsRoot, "concat-jobs");
const spriteProcessVersion = "alpha-v5-auto-grid-local-file";
const ffmpegPath = process.env.FFMPEG_PATH ||
  path.join(root, ".local-renderer", "ffmpeg", "bin", "ffmpeg.exe");
const ffprobePath = process.env.FFPROBE_PATH ||
  path.join(root, ".local-renderer", "ffmpeg", "bin", "ffprobe.exe");
const jobs = new Map();
const concatJobs = new Map();
let activeJobId = null;
let activeConcatJobId = null;
let activeSubtitleAlignment = false;
let activeCacheSync = false;

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

const runCommand = (command, args) => new Promise((resolve, reject) => {
  execFile(command, args, { windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      reject(new Error(String(stderr || "").trim() || error.message));
      return;
    }
    resolve(String(stdout || ""));
  });
});

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
}) => {
  const id = randomUUID();
  const destination = clipVideoPath(id);
  await fs.copyFile(sourcePath, destination);
  const stat = await fs.stat(destination);
  let inspectedProfile = null;
  try {
    inspectedProfile = await inspectVideo(destination);
  } catch {
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
    if (exitCode !== 0) throw new Error(`FFmpeg nối video kết thúc với mã lỗi ${exitCode}`);
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
  try {
    await fs.mkdir(job.sourceDir, { recursive: true });
    await fs.mkdir(job.outputDir, { recursive: true });
    for (const file of files) {
      const filename = safeName(file.name);
      await fs.writeFile(path.join(job.sourceDir, filename), Buffer.from(await file.arrayBuffer()));
    }
    await fs.writeFile(job.projectPath, JSON.stringify(project, null, 2), "utf8");
    if (job.cancelRequested) {
      job.status = "cancelled";
      job.progress = 0;
      job.message = "Đã dừng render";
      return;
    }
    job.status = "rendering";
    job.message = `Đang dựng 0/${project.scenes?.length || 0} cảnh`;

    const rendererArgs = [
      ...(process.allowedNodeEnvironmentFlags.has("--use-system-ca") ? ["--use-system-ca"] : []),
      path.join(root, "scripts", "render-video.mjs"),
      job.projectPath,
      job.outputPath,
    ];
    const child = spawn(
      process.execPath,
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
      const match = text.match(/Rendering scene\s+(\d+)\/(\d+):\s*(.+)/);
      if (match) {
        job.progress = Math.round((Number(match[1]) / Number(match[2])) * 90);
        job.message = `Đang dựng cảnh ${match[1]}/${match[2]}: ${match[3].trim()}`;
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
      return;
    }
    if (exitCode !== 0) throw new Error(`FFmpeg kết thúc với mã lỗi ${exitCode}`);
    job.clip = await storeRenderedClip({
      sourcePath: job.outputPath,
      name: project.title || "video",
      scope: project.renderScope === "scene" ? "scene" : "project",
      sceneName: project.renderedSceneName || "",
    });
    job.status = "completed";
    job.progress = 100;
    job.message = "Render hoàn tất";
    job.downloadUrl = job.clip.downloadUrl;
  } catch (error) {
    if (job.cancelRequested) {
      job.status = "cancelled";
      job.progress = 0;
      job.message = "Đã dừng render";
    } else {
      job.status = "failed";
      job.message = error instanceof Error ? error.message : "Không thể render video";
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
      if (!text) throw new Error("Thiếu Lời thuyết minh để tạo phụ đề");
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
      sendJson(response, 200, { id: job.id, status: job.status });
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
