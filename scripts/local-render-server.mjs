import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { alignSubtitles } from "./align-subtitles.mjs";
import { processSpriteSheetBuffer } from "./sprite-sheet.mjs";

const root = process.cwd();
const host = "127.0.0.1";
const port = Number(process.env.LOCAL_RENDER_PORT || 4179);
const jobsRoot = path.join(root, "work", "local-render-jobs");
const spriteAssetsRoot = path.join(jobsRoot, "sprite-assets");
const ffmpegPath = process.env.FFMPEG_PATH ||
  path.join(root, ".local-renderer", "ffmpeg", "bin", "ffmpeg.exe");
const jobs = new Map();
let activeJobId = null;
let activeSubtitleAlignment = false;

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
    if (exitCode !== 0) throw new Error(`FFmpeg kết thúc với mã lỗi ${exitCode}`);
    job.status = "completed";
    job.progress = 100;
    job.message = "Render hoàn tất";
    job.downloadUrl = `/api/render/${job.id}/download`;
  } catch (error) {
    job.status = "failed";
    job.message = error instanceof Error ? error.message : "Không thể render video";
  } finally {
    job.child = null;
    activeJobId = null;
  }
};

await fs.mkdir(jobsRoot, { recursive: true });
await fs.mkdir(spriteAssetsRoot, { recursive: true });

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (request.method === "GET" && url.pathname === "/api/health") {
    const ready = await ffmpegReady();
    sendJson(response, ready ? 200 : 503, {
      ready,
      busy: Boolean(activeJobId),
      ffmpegPath,
      message: ready
        ? "Dịch vụ render cục bộ đã sẵn sàng"
        : "Chưa tìm thấy FFmpeg. Hãy chạy npm run render:setup",
    });
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
      const parsed = new URL(sourceUrl);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("URL hình phải dùng http hoặc https");
      const cacheKey = createHash("sha256").update(sourceUrl).digest("hex");
      const outputPath = path.join(spriteAssetsRoot, `${cacheKey}.webp`);
      const assetUrl = `http://${host}:${port}/api/sprite-assets/${cacheKey}.webp`;
      try {
        await fs.access(outputPath);
        sendJson(response, 200, { processed: true, assetUrl });
        return;
      } catch {
        // Cache miss: download and inspect the source below.
      }
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
      const sourceBuffer = Buffer.from(await remote.arrayBuffer());
      if (sourceBuffer.length > 25 * 1024 * 1024) throw new Error("Hình sprite vượt quá giới hạn 25 MB");
      const result = await processSpriteSheetBuffer(sourceBuffer);
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
    try {
      const stat = await fs.stat(assetPath);
      response.writeHead(200, {
        ...corsHeaders,
        "Content-Type": "image/webp",
        "Content-Length": stat.size,
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

  if (request.method === "POST" && url.pathname === "/api/render") {
    if (activeJobId) {
      sendJson(response, 409, { error: "Đang có một video được render. Vui lòng chờ hoàn tất." });
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
        progress: 0,
        message: "Đang chuẩn bị tài nguyên",
        log: "",
        sourceDir: path.join(jobRoot, "source"),
        renderDir: path.join(jobRoot, "render"),
        outputDir: path.join(jobRoot, "output"),
        projectPath: path.join(jobRoot, "project.json"),
        outputPath: path.join(jobRoot, "output", `${safeName(project.title || "video")}.mp4`),
      };
      jobs.set(id, job);
      void runJob(job, project, files);
      sendJson(response, 202, { jobId: id });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Dữ liệu render không hợp lệ" });
    }
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
    try {
      const stat = await fs.stat(job.outputPath);
      const downloadName = safeName(path.basename(job.outputPath));
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
      const file = await import("node:fs");
      file.createReadStream(job.outputPath).pipe(response);
    } catch {
      sendJson(response, 404, { error: "Không tìm thấy file video" });
    }
    return;
  }

  sendJson(response, 404, { error: "Đường dẫn không tồn tại" });
});

server.listen(port, host, () => {
  console.log(`Kito Local Renderer: http://${host}:${port}`);
  console.log("Giữ cửa sổ này mở trong khi render từ website.");
});
