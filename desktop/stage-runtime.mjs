import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(desktopDirectory, "..");
const runtimeDirectory = path.join(desktopDirectory, "runtime");
const ffmpegDirectory = path.join(desktopDirectory, "ffmpeg");

const requiredScripts = [
  "align-subtitles.mjs",
  "local-render-server.mjs",
  "render-resource-cache.mjs",
  "render-text-layout.mjs",
  "render-video.mjs",
  "sprite-sheet.mjs",
];

const copy = async (source, destination) => {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true });
};

const exists = async (filename) => Boolean(await fs.stat(filename).catch(() => null));

await fs.rm(runtimeDirectory, { recursive: true, force: true });
await fs.rm(ffmpegDirectory, { recursive: true, force: true });
await fs.mkdir(path.join(runtimeDirectory, "scripts"), { recursive: true });
await fs.mkdir(path.join(runtimeDirectory, "assets", "_vinext_fonts"), { recursive: true });

for (const script of requiredScripts) {
  await copy(path.join(projectDirectory, "scripts", script), path.join(runtimeDirectory, "scripts", script));
}
await copy(
  path.join(projectDirectory, "assets", "_vinext_fonts"),
  path.join(runtimeDirectory, "assets", "_vinext_fonts"),
);

const nodeBinary = process.execPath;
if (process.platform !== "win32") {
  throw new Error("Bản đóng gói hiện tại hỗ trợ Windows x64; hãy bổ sung Node runtime và FFmpeg theo từng nền tảng khi mở rộng.");
}
await fs.mkdir(path.join(runtimeDirectory, "node"), { recursive: true });
await copy(nodeBinary, path.join(runtimeDirectory, "node", "node.exe"));

// sharp is a native dependency. Keep only the packages needed by the render
// sidecar instead of copying the entire web application's node_modules.
for (const dependency of [
  ["sharp", "sharp"],
  ["@img", "@img"],
  ["detect-libc", "detect-libc"],
  ["semver", "semver"],
]) {
  await copy(
    path.join(projectDirectory, "node_modules", dependency[0]),
    path.join(runtimeDirectory, "node_modules", dependency[1]),
  );
}

const ffmpegSource = path.join(projectDirectory, ".local-renderer", "ffmpeg");
for (const binary of ["ffmpeg.exe", "ffprobe.exe"]) {
  const source = path.join(ffmpegSource, "bin", binary);
  if (!(await exists(source))) {
    throw new Error(`Thiếu ${source}. Hãy chạy npm run render:setup trước khi đóng gói.`);
  }
  await copy(source, path.join(ffmpegDirectory, "bin", binary));
}
for (const document of ["LICENSE", "README.txt"]) {
  const source = path.join(ffmpegSource, document);
  if (await exists(source)) await copy(source, path.join(ffmpegDirectory, document));
}

console.log("Đã chuẩn bị runtime desktop:");
console.log(`- ${runtimeDirectory}`);
console.log(`- ${ffmpegDirectory}`);
