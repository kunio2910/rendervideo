import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { startStaticServer } from "./static-server.mjs";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(desktopDirectory, "..");
const rendererPort = 4179;

let mainWindow;
let rendererChild;
let rendererLogStream;
let staticServer;

const isPackaged = () => app.isPackaged;

const getRuntimePaths = () => {
  if (!isPackaged()) {
    return {
      bundleRoot: projectDirectory,
      rendererScript: path.join(projectDirectory, "scripts", "local-render-server.mjs"),
      nodeBinary: process.env.KITO_NODE_BINARY || "node",
      ffmpegPath: path.join(projectDirectory, ".local-renderer", "ffmpeg", "bin", "ffmpeg.exe"),
      ffprobePath: path.join(projectDirectory, ".local-renderer", "ffmpeg", "bin", "ffprobe.exe"),
      uiRoot: path.join(desktopDirectory, "dist"),
      dataRoot: projectDirectory,
    };
  }

  const resourcesRoot = process.resourcesPath;
  // The Node sidecar and native Sharp module must be outside app.asar so the
  // bundled Node executable can resolve them as ordinary filesystem files.
  const bundleRoot = path.join(resourcesRoot, "app.asar.unpacked", "runtime");
  return {
    bundleRoot,
    rendererScript: path.join(bundleRoot, "scripts", "local-render-server.mjs"),
    nodeBinary: path.join(bundleRoot, "node", process.platform === "win32" ? "node.exe" : "node"),
    ffmpegPath: path.join(resourcesRoot, "ffmpeg", "bin", "ffmpeg.exe"),
    ffprobePath: path.join(resourcesRoot, "ffmpeg", "bin", "ffprobe.exe"),
    uiRoot: path.join(app.getAppPath(), "dist"),
    dataRoot: path.join(app.getPath("userData"), "data"),
  };
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const appendRendererLog = (chunk) => {
  const text = chunk.toString();
  rendererLogStream?.write(text);
  if (process.env.KITO_DESKTOP_DEBUG === "1") process.stdout.write(text);
};

const startRenderer = async (paths) => {
  await fs.mkdir(path.join(paths.dataRoot, "work"), { recursive: true });
  await fs.mkdir(path.join(paths.dataRoot, "logs"), { recursive: true });
  const logPath = path.join(paths.dataRoot, "logs", "local-renderer.log");
  rendererLogStream = createWriteStream(logPath, { flags: "a" });

  rendererChild = spawn(paths.nodeBinary, [paths.rendererScript], {
    cwd: paths.bundleRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      LOCAL_RENDER_PORT: String(rendererPort),
      KITO_DATA_DIR: paths.dataRoot,
      KITO_RENDER_BUNDLE_ROOT: paths.bundleRoot,
      KITO_RENDERER_SCRIPT: path.join(paths.bundleRoot, "scripts", "render-video.mjs"),
      KITO_NODE_BINARY: paths.nodeBinary,
      FFMPEG_PATH: paths.ffmpegPath,
      FFPROBE_PATH: paths.ffprobePath,
    },
  });
  rendererChild.stdout.on("data", appendRendererLog);
  rendererChild.stderr.on("data", appendRendererLog);

  let childError = null;
  rendererChild.once("error", (error) => { childError = error; });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (childError) throw childError;
    if (rendererChild.exitCode !== null) {
      throw new Error(`Local renderer đã dừng với mã ${rendererChild.exitCode}. Xem log: ${logPath}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${rendererPort}/api/health`);
      if (response.ok) {
        const health = await response.json();
        if (health.ready) return;
      }
    } catch {
      // Renderer may need a few hundred milliseconds to start.
    }
    await delay(250);
  }
  throw new Error(`Không thể khởi động local renderer tại cổng ${rendererPort}. Xem log: ${logPath}`);
};

const stopRenderer = () => {
  if (!rendererChild) return;
  if (process.platform === "win32" && rendererChild.pid) {
    spawn("taskkill", ["/PID", String(rendererChild.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    rendererChild.kill("SIGTERM");
  }
  rendererChild = null;
  rendererLogStream?.end();
  rendererLogStream = null;
};

const createMainWindow = async (uiUrl) => {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#101419",
    title: "Kito Video Studio",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(desktopDirectory, "preload.cjs"),
    },
  });

  mainWindow.webContents.session.on("will-download", (event, item) => {
    const defaultPath = path.join(app.getPath("downloads"), item.getFilename());
    item.setSaveDialogOptions({
      title: "Lưu video đã render",
      defaultPath,
      buttonLabel: "Lưu video",
    });
  });

  // Firebase signInWithPopup needs the OAuth window to remain inside the
  // Electron session so the result can be returned to the renderer.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "allow" }));
  mainWindow.on("closed", () => { mainWindow = null; });
  await mainWindow.loadURL(uiUrl);
};

const boot = async () => {
  const paths = getRuntimePaths();
  if (!(await fs.stat(paths.uiRoot).catch(() => null))) {
    throw new Error("Chưa có giao diện desktop. Hãy chạy npm run build:ui trong thư mục desktop.");
  }
  // Firebase Auth authorizes `localhost` by default more reliably than the
  // numeric loopback hostname. Keep the renderer API on 127.0.0.1 separately.
  staticServer = await startStaticServer({ root: paths.uiRoot, host: "localhost" });
  await startRenderer(paths);
  await createMainWindow(staticServer.url);
};

ipcMain.handle("open-external", async (_event, url) => {
  if (!/^https?:\/\//i.test(String(url || ""))) return false;
  await shell.openExternal(String(url));
  return true;
});

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => mainWindow?.show());
  app.whenReady().then(boot).catch((error) => {
    dialog.showErrorBox("Kito Video Studio không thể khởi động", error instanceof Error ? error.message : String(error));
    app.quit();
  });
  app.on("before-quit", () => {
    stopRenderer();
    staticServer?.server.close();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
