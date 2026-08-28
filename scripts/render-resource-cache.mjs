import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const DOWNLOAD_TIMEOUT_MS = 45_000;
const MAX_RESOURCE_BYTES = 768 * 1024 * 1024;
const inFlightDownloads = new Map();

export const isRemoteResourceUrl = (value) => /^https?:\/\//i.test(String(value ?? "").trim());

export const referenceName = (value, fallbackName = "resource") => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return fallbackName;
  if (isRemoteResourceUrl(trimmed)) {
    try {
      const name = path.basename(decodeURIComponent(new URL(trimmed).pathname));
      if (name && name !== ".") return name;
    } catch {
      // The request validator below provides the actionable error message.
    }
  }
  return path.basename(trimmed.replaceAll("\\", "/")) || fallbackName;
};

// Keep this key compatible with the cache used by earlier renderer versions.
// It deliberately reuses an asset when several scenes use the same filename.
export const resourceKey = (kind, value, fallbackName = "resource") => {
  const trimmed = String(value ?? "").trim();
  const name = referenceName(trimmed, fallbackName).toLowerCase();
  if (name && name !== fallbackName.toLowerCase()) return `${kind}:name:${name}`;
  return `${kind}:url:${trimmed}`;
};

const safeName = (value) => String(value || "resource")
  .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
  .replace(/[^a-z0-9._-]+/gi, "-")
  .replace(/^-+|-+$/g, "") || "resource";

const cacheAssetDirectory = (cacheRoot) => path.join(path.resolve(cacheRoot), "assets");

const validateRemoteUrl = (value) => {
  const url = new URL(String(value ?? "").trim());
  if (!/^https?:$/.test(url.protocol) || !url.hostname) {
    throw new Error("URL tài nguyên chỉ hỗ trợ http hoặc https");
  }
  return url;
};

export const cacheRemoteResource = async ({
  cacheRoot,
  kind,
  value,
  fallbackName = "resource",
}) => {
  const url = String(value ?? "").trim();
  validateRemoteUrl(url);
  const normalizedKind = ["image", "video", "audio"].includes(kind) ? kind : "image";
  const key = resourceKey(normalizedKind, url, fallbackName);
  const shared = inFlightDownloads.get(key);
  if (shared) return shared;

  const task = (async () => {
    const assetDirectory = cacheAssetDirectory(cacheRoot);
    await fs.mkdir(assetDirectory, { recursive: true });
    const filename = `${normalizedKind}-${createHash("sha1").update(key).digest("hex").slice(0, 10)}-${safeName(referenceName(url, fallbackName))}`;
    const target = path.join(assetDirectory, filename);
    try {
      const stat = await fs.stat(target);
      if (stat.isFile() && stat.size > 0) {
        return { path: target, cached: true, bytes: stat.size, kind: normalizedKind, url };
      }
    } catch {
      // The resource is not cached yet.
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    const partial = `${target}.${process.pid}.${Date.now()}.part`;
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
      if (!response.ok) throw new Error(`Không thể tải URL (${response.status})`);
      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (declaredSize > MAX_RESOURCE_BYTES) {
        throw new Error("Tài nguyên vượt quá giới hạn 768 MB");
      }
      const data = Buffer.from(await response.arrayBuffer());
      if (!data.length) throw new Error("Tài nguyên tải về rỗng");
      if (data.length > MAX_RESOURCE_BYTES) throw new Error("Tài nguyên vượt quá giới hạn 768 MB");
      await fs.writeFile(partial, data);
      try {
        await fs.rename(partial, target);
      } catch (error) {
        // A concurrent request may have won the race. In that case, use it.
        const existing = await fs.stat(target).catch(() => null);
        if (!existing?.isFile() || existing.size <= 0) throw error;
        await fs.rm(partial, { force: true }).catch(() => undefined);
        return { path: target, cached: true, bytes: existing.size, kind: normalizedKind, url };
      }
      return { path: target, cached: false, bytes: data.length, kind: normalizedKind, url };
    } finally {
      clearTimeout(timeout);
      await fs.rm(partial, { force: true }).catch(() => undefined);
    }
  })();

  inFlightDownloads.set(key, task);
  try {
    return await task;
  } finally {
    inFlightDownloads.delete(key);
  }
};

const videoLike = (value, declaredType = "") => {
  const type = String(declaredType ?? "").toLowerCase();
  if (type === "video" || type === "webm") return true;
  return /\.(?:mp4|m4v|mov|webm|avi)(?:[?#].*)?$/i.test(String(value ?? ""));
};

const pushRemote = (resources, kind, value, fallbackName) => {
  const url = String(value ?? "").trim();
  if (!isRemoteResourceUrl(url)) return;
  const key = `${kind}\u0000${url}`;
  if (!resources.some((resource) => resource.key === key)) {
    resources.push({ key, kind, url, fallbackName });
  }
};

export const collectProjectRemoteResources = (project) => {
  const resources = [];
  if (!project || typeof project !== "object") return resources;
  pushRemote(resources, videoLike(project.background) ? "video" : "image", project.background, "background");
  pushRemote(resources, "audio", project.backgroundMusic, "background-music.mp3");

  const scenes = Array.isArray(project.scenes) ? project.scenes : [];
  scenes.forEach((scene, sceneIndex) => {
    if (!scene || scene.sceneVisible === false) return;
    pushRemote(
      resources,
      videoLike(scene.background) ? "video" : "image",
      scene.background,
      `scene-${sceneIndex + 1}-background`,
    );
    pushRemote(resources, "image", scene.avatar, `scene-${sceneIndex + 1}-avatar`);

    const tracks = Array.isArray(scene.audioTracks) ? scene.audioTracks : [];
    tracks.forEach((track, trackIndex) => {
      if (track?.visible === false) return;
      pushRemote(resources, "audio", track?.source ?? track?.url ?? track?.file, `scene-${sceneIndex + 1}-audio-${trackIndex + 1}.mp3`);
    });
    if (!tracks.length) pushRemote(resources, "audio", scene.voiceFile, `scene-${sceneIndex + 1}-voice.mp3`);

    const popups = Array.isArray(scene.popups) && scene.popups.length ? scene.popups : [scene];
    popups.forEach((popup, popupIndex) => {
      if (!popup || popup.visible === false || popup.popupVisible === false) return;
      if (popup.imageVisible !== false) {
        pushRemote(resources, "image", popup.image, `scene-${sceneIndex + 1}-popup-${popupIndex + 1}`);
      }
      pushRemote(resources, "video", popup.video ?? popup.popupVideo, `scene-${sceneIndex + 1}-popup-${popupIndex + 1}.mp4`);
    });

    (Array.isArray(scene.mapDecorations) ? scene.mapDecorations : []).forEach((decoration, decorationIndex) => {
      if (!decoration || decoration.visible === false) return;
      const kind = videoLike(decoration.asset, decoration.assetType) ? "video" : "image";
      pushRemote(resources, kind, decoration.asset, `scene-${sceneIndex + 1}-decoration-${decorationIndex + 1}`);
    });
    (Array.isArray(scene.sceneImages) ? scene.sceneImages : []).forEach((image, imageIndex) => {
      if (!image || image.visible === false) return;
      const source = image.url ?? image.asset;
      const kind = videoLike(source, image.mediaType) ? "video" : "image";
      pushRemote(resources, kind, source, `scene-${sceneIndex + 1}-image-${imageIndex + 1}`);
    });
    const weatherEffects = Array.isArray(scene.effects?.weatherEffects)
      ? scene.effects.weatherEffects
      : [];
    weatherEffects.forEach((effect, effectIndex) => {
      if (!effect || effect.enabled === false) return;
      pushRemote(
        resources,
        "image",
        effect.customImage,
        `scene-${sceneIndex + 1}-weather-${effectIndex + 1}-custom.png`,
      );
    });
  });
  return resources;
};

export const syncProjectResourceCache = async (project, cacheRoot, concurrency = 3) => {
  const resources = collectProjectRemoteResources(project);
  const results = new Array(resources.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency) || 1), resources.length || 1);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < resources.length) {
      const index = cursor;
      cursor += 1;
      const resource = resources[index];
      try {
        const cached = await cacheRemoteResource({
          cacheRoot,
          kind: resource.kind,
          value: resource.url,
          fallbackName: resource.fallbackName,
        });
        results[index] = {
          kind: resource.kind,
          url: resource.url,
          bytes: cached.bytes,
          status: cached.cached ? "cached" : "downloaded",
        };
      } catch (error) {
        results[index] = {
          kind: resource.kind,
          url: resource.url,
          status: "failed",
          error: error instanceof Error ? error.message : "Không thể tải tài nguyên",
        };
      }
    }
  }));
  const summary = await getResourceCacheSummary(cacheRoot);
  return {
    total: resources.length,
    cached: results.filter((item) => item?.status === "cached").length,
    downloaded: results.filter((item) => item?.status === "downloaded").length,
    failed: results.filter((item) => item?.status === "failed").length,
    items: results,
    cache: summary,
  };
};

export const getResourceCacheSummary = async (cacheRoot) => {
  const directory = cacheAssetDirectory(cacheRoot);
  await fs.mkdir(directory, { recursive: true });
  const names = await fs.readdir(directory);
  const items = [];
  for (const name of names) {
    if (name.endsWith(".part")) continue;
    const filename = path.join(directory, name);
    try {
      const stat = await fs.stat(filename);
      if (!stat.isFile() || stat.size <= 0) continue;
      items.push({ name, bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
    } catch {
      // Files can be replaced while the list is being read.
    }
  }
  items.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  return {
    count: items.length,
    totalBytes: items.reduce((total, item) => total + item.bytes, 0),
    items: items.slice(0, 100),
  };
};
