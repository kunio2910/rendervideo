import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export const WORKSPACE_BACKUP_FORMAT = "kito-video-studio-workspace";
export const WORKSPACE_BACKUP_VERSION = 1;

type WorkspaceBackupManifestAsset = {
  path: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  sha256?: string;
};

type WorkspaceBackupManifest = {
  format: typeof WORKSPACE_BACKUP_FORMAT;
  version: typeof WORKSPACE_BACKUP_VERSION;
  createdAt: string;
  workspaceFile: "workspace.json";
  mediaDirectory: "media/";
  assets: WorkspaceBackupManifestAsset[];
};

export type WorkspaceBackupAsset = {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  file: Blob;
};

export type ParsedWorkspaceBackup = {
  workspace: unknown;
  assets: File[];
  assetCount: number;
  createdAt: string;
};

const jsonBytes = (value: unknown) => strToU8(JSON.stringify(value, null, 2));

const safeFilename = (value: unknown, fallback = "resource") => {
  const basename = String(value || fallback).replaceAll("\\", "/").split("/").at(-1) || fallback;
  return basename
    .replace(/[<>:"/|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || fallback;
};

const sha256 = async (bytes: Uint8Array) => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return "";
  const digest = await subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
};

const parseJson = (bytes: Uint8Array, label: string) => {
  try {
    return JSON.parse(strFromU8(bytes)) as unknown;
  } catch {
    throw new Error(`File backup thiếu ${label} hợp lệ.`);
  }
};

const isValidMediaPath = (value: unknown): value is string => {
  const path = String(value || "");
  return path.startsWith("media/")
    && !path.includes("..")
    && !path.includes("\\")
    && path.length < 260;
};

const isValidWorkspace = (value: unknown) => {
  if (!value || typeof value !== "object") return false;
  const workspace = value as { version?: unknown; projects?: unknown };
  return workspace.version === 2
    && Array.isArray(workspace.projects)
    && workspace.projects.length > 0;
};

export async function createWorkspaceBackup(
  workspace: unknown,
  assets: WorkspaceBackupAsset[],
) {
  const archive: Record<string, Uint8Array> = {
    "workspace.json": jsonBytes(workspace),
  };
  const manifestAssets: WorkspaceBackupManifestAsset[] = [];

  for (const [index, asset] of assets.entries()) {
    const bytes = new Uint8Array(await asset.file.arrayBuffer());
    const filename = safeFilename(asset.name, `resource-${index + 1}`);
    const mediaPath = `media/${String(index + 1).padStart(4, "0")}-${filename}`;
    archive[mediaPath] = bytes;
    manifestAssets.push({
      path: mediaPath,
      name: filename,
      type: String(asset.type || "application/octet-stream"),
      size: bytes.byteLength,
      lastModified: Number(asset.lastModified) || Date.now(),
      sha256: await sha256(bytes),
    });
  }

  const manifest: WorkspaceBackupManifest = {
    format: WORKSPACE_BACKUP_FORMAT,
    version: WORKSPACE_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    workspaceFile: "workspace.json",
    mediaDirectory: "media/",
    assets: manifestAssets,
  };
  archive["manifest.json"] = jsonBytes(manifest);

  return new Blob([zipSync(archive, { level: 6 })], { type: "application/zip" });
}

export async function readWorkspaceBackup(file: Blob): Promise<ParsedWorkspaceBackup> {
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error("Không thể đọc file backup. Hãy chọn đúng file .kito.zip.");
  }

  const manifest = parseJson(archive["manifest.json"] ?? new Uint8Array(), "manifest.json");
  if (!manifest || typeof manifest !== "object") throw new Error("Manifest backup không hợp lệ.");
  const typedManifest = manifest as Partial<WorkspaceBackupManifest>;
  if (typedManifest.format !== WORKSPACE_BACKUP_FORMAT || typedManifest.version !== WORKSPACE_BACKUP_VERSION) {
    throw new Error("File backup không đúng định dạng hoặc không tương thích với phiên bản hiện tại.");
  }
  if (!Array.isArray(typedManifest.assets) || typedManifest.assets.length > 5000) {
    throw new Error("Danh sách media trong backup không hợp lệ.");
  }

  const workspace = parseJson(archive["workspace.json"] ?? new Uint8Array(), "workspace.json");
  if (!isValidWorkspace(workspace)) {
    throw new Error("Workspace trong file backup không đúng định dạng Kito.");
  }

  const assets: File[] = [];
  for (const rawAsset of typedManifest.assets) {
    if (!rawAsset || typeof rawAsset !== "object" || !isValidMediaPath(rawAsset.path)) {
      throw new Error("File backup chứa đường dẫn media không an toàn.");
    }
    const bytes = archive[rawAsset.path];
    if (!bytes) throw new Error(`Backup thiếu tài nguyên ${rawAsset.name || rawAsset.path}.`);
    const expectedSize = Math.max(0, Number(rawAsset.size) || 0);
    if (bytes.byteLength !== expectedSize) {
      throw new Error(`Tài nguyên ${rawAsset.name || rawAsset.path} bị thiếu hoặc hỏng.`);
    }
    if (rawAsset.sha256 && (await sha256(bytes)) !== rawAsset.sha256) {
      throw new Error(`Checksum không khớp cho tài nguyên ${rawAsset.name || rawAsset.path}.`);
    }
    const name = safeFilename(rawAsset.name, "resource");
    const fileBytes = bytes.slice().buffer as ArrayBuffer;
    assets.push(new File([fileBytes], name, {
      type: String(rawAsset.type || "application/octet-stream"),
      lastModified: Number(rawAsset.lastModified) || Date.now(),
    }));
  }

  return {
    workspace,
    assets,
    assetCount: assets.length,
    createdAt: String(typedManifest.createdAt || ""),
  };
}

export const workspaceBackupFilename = (title: unknown) => {
  const basename = safeFilename(title, "kito-workspace")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "kito-workspace";
  const stamp = new Date().toISOString().slice(0, 10);
  return `${basename}-${stamp}.kito.zip`;
};
