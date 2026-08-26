import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const directoryName = path.dirname(fileURLToPath(import.meta.url));

const toSafePath = (root, pathname) => {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded.replace(/^[/\\]+/, "");
  const candidate = path.resolve(root, relative);
  const normalizedRoot = path.resolve(root) + path.sep;
  return candidate === path.resolve(root) || candidate.startsWith(normalizedRoot)
    ? candidate
    : null;
};

const fileExists = async (filename) => {
  try {
    const stat = await fs.stat(filename);
    return stat.isFile();
  } catch {
    return false;
  }
};

export const startStaticServer = async ({ root, host = "127.0.0.1", port = 0 }) => {
  const staticRoot = path.resolve(root || directoryName);
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", `http://${host}`);
      let filename = toSafePath(staticRoot, requestUrl.pathname);
      if (!filename || !(await fileExists(filename))) {
        filename = path.join(staticRoot, "index.html");
      }
      if (!(await fileExists(filename))) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Không tìm thấy giao diện desktop");
        return;
      }
      const extension = path.extname(filename).toLowerCase();
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      });
      response.end(await fs.readFile(filename));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Không thể đọc giao diện");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    server,
    url: `http://${host}:${actualPort}`,
    port: actualPort,
  };
};
