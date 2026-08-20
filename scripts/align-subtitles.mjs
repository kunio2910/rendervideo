import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const bundledFfmpeg = path.join(root, ".local-renderer", "ffmpeg", "bin", "ffmpeg.exe");
const ffmpegPath = process.env.FFMPEG_PATH || bundledFfmpeg;

const runCapture = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: root,
    windowsHide: true,
    shell: process.platform === "win32" && /\.cmd$/i.test(command),
    ...options,
  });
  let output = "";
  child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  child.once("error", reject);
  child.once("close", (code) => resolve({ code: code ?? 1, output }));
});

const parseDuration = (output) => {
  const match = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
};

const detectAudio = async (audioPath) => {
  const probe = await runCapture(ffmpegPath, ["-hide_banner", "-i", audioPath, "-f", "null", "-"]);
  const duration = parseDuration(probe.output);
  const silence = await runCapture(ffmpegPath, [
    "-hide_banner",
    "-i",
    audioPath,
    "-af",
    "silencedetect=noise=-35dB:d=0.18",
    "-f",
    "null",
    "-",
  ]);
  const events = silence.output;
  const windows = [];
  let speechStart = 0;
  const silenceEvents = [...events.matchAll(/silence_(start|end):\s*([\d.]+)/g)]
    .map((match) => ({ kind: match[1], time: Number(match[2]), index: match.index ?? 0 }))
    .sort((a, b) => a.index - b.index);
  for (const event of silenceEvents) {
    if (!Number.isFinite(event.time)) continue;
    if (event.kind === "start") {
      if (event.time > speechStart + 0.08) windows.push([speechStart, event.time]);
    } else {
      speechStart = Math.max(speechStart, event.time);
    }
  }
  if (duration > speechStart + 0.08) windows.push([speechStart, duration]);
  const mergedWindows = windows
    .filter(([start, end]) => end > start + 0.08)
    .sort((a, b) => a[0] - b[0])
    .reduce((merged, window) => {
      const previous = merged.at(-1);
      if (previous && window[0] <= previous[1] + 0.12) previous[1] = Math.max(previous[1], window[1]);
      else merged.push([...window]);
      return merged;
    }, []);
  return { duration, windows: mergedWindows };
};

const splitNarration = (value) => {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^.!?。！？…]+[.!?。！？…]?/g)?.map((item) => item.trim()).filter(Boolean) ?? [normalized];
  if (sentences.length > 1 || normalized.split(" ").length <= 12) return sentences;
  const words = normalized.split(" ");
  const chunks = [];
  for (let index = 0; index < words.length; index += 10) chunks.push(words.slice(index, index + 10).join(" "));
  return chunks;
};

const fallbackCues = (text, duration, windows) => {
  const segments = splitNarration(text);
  if (!segments.length) return [];
  const safeDuration = Math.max(0.2, duration || 1);
  const voiceWindows = windows.length ? windows : [[0, safeDuration]];
  const totalVoice = voiceWindows.reduce((sum, [start, end]) => sum + Math.max(0.1, end - start), 0);
  const totalWeight = segments.reduce((sum, segment) => sum + Math.max(1, segment.length), 0);
  let cursor = 0;
  let windowIndex = 0;
  let windowCursor = voiceWindows[0][0];
  return segments.map((segment, index) => {
    const requested = totalVoice * Math.max(1, segment.length) / totalWeight;
    const start = windowCursor;
    let remaining = requested;
    while (remaining > 0 && windowIndex < voiceWindows.length) {
      const [, windowEnd] = voiceWindows[windowIndex];
      const available = Math.max(0, windowEnd - windowCursor);
      const consumed = Math.min(remaining, available);
      windowCursor += consumed;
      remaining -= consumed;
      if (remaining > 0 && windowIndex < voiceWindows.length - 1) {
        windowIndex += 1;
        windowCursor = voiceWindows[windowIndex][0];
      }
    }
    const end = Math.max(start + 0.2, Math.min(safeDuration, windowCursor));
    cursor = end;
    return { id: `subtitle-${index + 1}`, text: segment, start, end, visible: true };
  }).map((cue, index, items) => ({
    ...cue,
    start: Number(Math.max(0, Math.min(cue.start, safeDuration - 0.1)).toFixed(2)),
    end: Number(Math.max(cue.start + 0.1, Math.min(cue.end, safeDuration)).toFixed(2)),
    id: `subtitle-${index + 1}`,
  }));
};

const whisperCues = async (audioPath, workDir, duration) => {
  const command = process.env.WHISPER_CLI || "whisper";
  const outputDir = path.join(workDir, "whisper-output");
  await fs.mkdir(outputDir, { recursive: true });
  const args = [
    audioPath,
    "--model",
    process.env.WHISPER_MODEL || "small",
    "--language",
    process.env.WHISPER_LANGUAGE || "vi",
    "--output_format",
    "json",
    "--output_dir",
    outputDir,
  ];
  const result = await runCapture(command, args);
  if (result.code !== 0) throw new Error(result.output.trim().slice(-700) || "Whisper không tạo được JSON timestamp");
  const expected = path.join(outputDir, `${path.basename(audioPath, path.extname(audioPath))}.json`);
  let jsonPath = expected;
  try {
    await fs.access(jsonPath);
  } catch {
    const files = (await fs.readdir(outputDir)).filter((file) => file.toLowerCase().endsWith(".json"));
    jsonPath = files[0] ? path.join(outputDir, files[0]) : "";
  }
  if (!jsonPath) throw new Error("Whisper không trả về file JSON timestamp");
  const data = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  const scale = duration > 0 && Number(data.duration) > 0 ? duration / Number(data.duration) : 1;
  const cues = (Array.isArray(data.segments) ? data.segments : [])
    .map((segment, index) => ({
      id: `subtitle-${index + 1}`,
      text: String(segment.text ?? "").trim(),
      start: Number(segment.start) * scale,
      end: Number(segment.end) * scale,
      visible: true,
    }))
    .filter((cue) => cue.text && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start);
  if (!cues.length) throw new Error("Whisper không nhận diện được câu nói trong audio");
  return cues;
};

export const alignSubtitles = async ({ text, audioPath, workDir, requestedDuration = 0 }) => {
  const detected = await detectAudio(audioPath);
  const audioDuration = detected.duration || Number(requestedDuration) || 1;
  const targetDuration = Number(requestedDuration) > 0 ? Number(requestedDuration) : audioDuration;
  try {
    const cues = await whisperCues(audioPath, workDir, targetDuration);
    return {
      cues: cues.map((cue) => ({ ...cue, start: Number(Math.max(0, Math.min(cue.start, targetDuration - 0.1)).toFixed(2)), end: Number(Math.min(targetDuration, Math.max(cue.start + 0.1, cue.end)).toFixed(2)) })),
      engine: "whisper",
      duration: audioDuration,
      warning: "Whisper đã tạo timestamp; hãy rà soát lại từng cue trước khi render.",
    };
  } catch (error) {
    const fallback = fallbackCues(text, targetDuration, detected.windows.map(([start, end]) => [start * targetDuration / audioDuration, end * targetDuration / audioDuration]));
    return {
      cues: fallback,
      engine: "ffmpeg-fallback",
      duration: audioDuration,
      warning: `Chưa chạy được Whisper (${error instanceof Error ? error.message : "lỗi không xác định"}). Đã tạo timestamp dự phòng theo nhịp audio; cài Whisper để đạt độ chính xác cao hơn.`,
    };
  }
};
