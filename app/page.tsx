"use client";

import {
  Component,
  Fragment,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User as FirebaseUser } from "firebase/auth";
import {
  loadWorkspaceFromFirestore,
  observeGoogleUser,
  saveWorkspaceToFirestore,
  signInWithGoogle,
  signOutFromGoogle,
} from "./lib/firebase";

type OverlayTextFont = "Arial" | "Verdana" | "Georgia" | "Tahoma" | "Times New Roman" | "Courier New";

type TextOverlay = {
  id: string;
  name: string;
  text: string;
  visible: boolean;
  size: number;
  style: "normal" | "bold" | "italic" | "bold-italic";
  color: string;
  opacity: number;
  font: OverlayTextFont;
  strokeWidth: number;
  strokeColor: string;
  borderWidth: number;
  borderColor: string;
  borderOpacity: number;
  borderFill: string;
  x: number;
  y: number;
};

type SubtitleAnimation = "none" | "fade" | "pop" | "slide-up" | "typewriter";

type SubtitleStyle = Omit<TextOverlay, "id" | "name" | "text" | "visible"> & {
  boxWidth: number;
  animation: SubtitleAnimation;
  animationDuration: number;
};

type SubtitleCue = {
  id: string;
  text: string;
  start: number;
  end: number;
  visible: boolean;
};

type MapDecorationType = "text-3d" | "sticker" | "icon" | "effect" | "animated-sticker";
type AnimatedAssetType = "gif" | "apng" | "webm";
type MapDecorationAnimation = "none" | "fade" | "pop" | "float" | "pulse" | "spin";

type MapDecoration = {
  id: string;
  name: string;
  type: MapDecorationType;
  text: string;
  asset: string;
  assetType: "image" | AnimatedAssetType;
  symbol: string;
  effect: "sparkles" | "ring" | "confetti" | "glow";
  x: number;
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
  depth: number;
  size: number;
  color: string;
  accentColor: string;
  start: number;
  duration: number;
  animation: MapDecorationAnimation;
  visible: boolean;
};

type SceneImageShape = "rectangle" | "square" | "circle" | "triangle" | "diamond";

type SceneImage = {
  id: string;
  name: string;
  url: string;
  mediaType: "image" | "video";
  transparent: boolean;
  shape: SceneImageShape;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  borderWidth: number;
  borderColor: string;
  start: number;
  duration: number;
  visible: boolean;
};

type AlignmentGuides = {
  vertical: number | null;
  horizontal: number | null;
};

type SnapMode = "center" | "box";
type RulerStyle = "center" | "grid" | "all";

const EMPTY_ALIGNMENT_GUIDES: AlignmentGuides = { vertical: null, horizontal: null };
const ALIGNMENT_SNAP_THRESHOLD = 1.6;

const animatedAssetTypeFromValue = (value: string, fallback: AnimatedAssetType = "gif"): AnimatedAssetType => {
  const normalized = safeTrim(value).toLowerCase();
  if (/\.webm(?:[?#].*)?$/.test(normalized) || /[?&](?:format|fm)=webm/.test(normalized)) return "webm";
  if (/\.apng(?:[?#].*)?$/.test(normalized) || /[?&](?:format|fm)=apng/.test(normalized)) return "apng";
  return fallback;
};

const isAnimatedEffectFile = (file: File | { name: string; type?: string }) => {
  const name = String(file.name ?? "").toLowerCase();
  const mime = String(file.type ?? "").toLowerCase();
  return mime === "image/gif"
    || mime === "image/apng"
    || mime === "video/webm"
    || /\.(gif|apng|webm)$/.test(name);
};

type Scene = {
  id: string;
  number: number;
  sceneName: string;
  title: string;
  location: string;
  reference: string;
  popup: string;
  narration: string;
  voice: string;
  image: string;
  background?: string;
  start: number;
  end: number;
  zoomStart: number;
  zoomEnd: number;
  zoomInDuration: number;
  zoomOutDuration: number;
  zoom: number;
  centerX: number;
  centerY: number;
  zoomEnabled: boolean;
  effects: SceneEffects;
  overlayText: string;
  overlayTextSize: number;
  overlayTextStyle: "normal" | "bold" | "italic" | "bold-italic";
  overlayTextColor: string;
  overlayTextFont: OverlayTextFont;
  overlayTextStrokeWidth: number;
  overlayTextStrokeColor: string;
  overlayTextBorderWidth: number;
  overlayTextBorderColor: string;
  overlayTextX: number;
  overlayTextY: number;
  textOverlays: TextOverlay[];
  mapDecorations: MapDecoration[];
  sceneImages: SceneImage[];
  subtitleEnabled: boolean;
  subtitleStyle: SubtitleStyle;
  subtitles: SubtitleCue[];
  popupDuration: number;
  voiceFile: string;
  voiceVolume: number;
  popupIn: string;
  popupOut: string;
  popupStart?: number;
  popupWidth?: number;
  popupHeight?: number;
  popupBorderWidth?: number;
  popupLayout?: "image-top" | "split" | "quote" | "stats" | "image-only" | "content-only";
  popupTheme?: "travel" | "sunset" | "ocean" | "minimal";
  popupTextEffect?: "none" | "fade" | "rise" | "pop";
  popupVideo?: string;
  popupTransparentMedia?: boolean;
  popupX?: number;
  popupY?: number;
  popupVisible?: boolean;
  popups?: PopupConfig[];
  backgroundVisible?: boolean;
  sceneVisible: boolean;
  status: "Nháp" | "Đã duyệt";
};

type SceneEffects = {
  snowEnabled: boolean;
  snowIntensity: number;
  snowSpeed: number;
  lightFlickerEnabled: boolean;
  lightFlickerIntensity: number;
  lightFlickerSpeed: number;
  rainEnabled: boolean;
  rainIntensity: number;
  rainSpeed: number;
  thunderEnabled: boolean;
  thunderIntensity: number;
  thunderSpeed: number;
  cloudEnabled: boolean;
  cloudIntensity: number;
  cloudSpeed: number;
};

const defaultSceneEffects = (): SceneEffects => ({
  snowEnabled: false,
  snowIntensity: 55,
  snowSpeed: 1,
  lightFlickerEnabled: false,
  lightFlickerIntensity: 45,
  lightFlickerSpeed: 1,
  rainEnabled: false,
  rainIntensity: 55,
  rainSpeed: 1,
  thunderEnabled: false,
  thunderIntensity: 55,
  thunderSpeed: 1,
  cloudEnabled: false,
  cloudIntensity: 50,
  cloudSpeed: 1,
});

const SNOWFLAKE_SEEDS = Array.from({ length: 36 }, (_, index) => ({
  x: (index * 37) % 100,
  size: 2 + ((index * 5) % 5),
  duration: 5.5 + ((index * 17) % 45) / 10,
  delay: -((index * 23) % 80) / 10,
  drift: -24 + ((index * 19) % 49),
}));

const RAIN_DROP_SEEDS = Array.from({ length: 32 }, (_, index) => ({
  x: (index * 29) % 100,
  length: 14 + ((index * 11) % 18),
  width: 1 + (index % 2),
  duration: 1.2 + ((index * 13) % 14) / 10,
  delay: -((index * 17) % 35) / 10,
  drift: -18 + ((index * 7) % 37),
}));

const CLOUD_SEEDS = Array.from({ length: 7 }, (_, index) => ({
  x: -18 + ((index * 23) % 112),
  y: 12 + ((index * 17) % 43),
  width: 24 + ((index * 19) % 28),
  height: 8 + ((index * 7) % 8),
  duration: 18 + ((index * 11) % 14),
  delay: -((index * 13) % 28),
  drift: 118 + ((index * 17) % 45),
}));

type PopupConfig = {
  id: string;
  title: string;
  body: string;
  narration: string;
  image: string;
  video: string;
  transparentMedia: boolean;
  start: number;
  duration: number;
  in: string;
  out: string;
  width: number;
  height: number;
  borderWidth: number;
  layout: Scene["popupLayout"];
  theme: Scene["popupTheme"];
  textEffect: Scene["popupTextEffect"];
  x: number;
  y: number;
  visible: boolean;
  imageVisible: boolean;
};

type AspectRatio = "9:16" | "16:9";
type RenderResolution = "1080x1920" | "720x1280" | "1920x1080" | "1280x720";

const normalizeAspectRatio = (value: unknown): AspectRatio =>
  value === "16:9" ? "16:9" : "9:16";

const resolutionOptionsFor = (aspectRatio: AspectRatio) => aspectRatio === "16:9"
  ? [
      { value: "1920x1080" as RenderResolution, label: "1920×1080" },
      { value: "1280x720" as RenderResolution, label: "1280×720" },
    ]
  : [
      { value: "1080x1920" as RenderResolution, label: "1080×1920" },
      { value: "720x1280" as RenderResolution, label: "720×1280" },
    ];

const defaultResolutionFor = (aspectRatio: AspectRatio): RenderResolution =>
  aspectRatio === "16:9" ? "1920x1080" : "1080x1920";

const normalizeRenderResolution = (
  value: unknown,
  aspectRatio: AspectRatio,
): RenderResolution => {
  const options = resolutionOptionsFor(aspectRatio);
  return options.some((option) => option.value === value)
    ? value as RenderResolution
    : defaultResolutionFor(aspectRatio);
};

const defaultSubtitleStyle = (
  overrides: Partial<SubtitleStyle> = {},
): SubtitleStyle => ({
  size: 22,
  style: "bold",
  color: "#ffffff",
  opacity: 100,
  font: "Arial",
  strokeWidth: 1,
  strokeColor: "#000000",
  borderWidth: 1,
  borderColor: "#ffffff",
  borderOpacity: 88,
  borderFill: "#0b1220",
  x: 50,
  y: 83,
  boxWidth: 84,
  animation: "fade",
  animationDuration: 0.25,
  ...overrides,
});

const createEmptyScene = (id = "scene-01", number = 1, start = 0): Scene => ({
  id,
  number,
  sceneName: `Cảnh ${number}`,
  title: "",
  location: "",
  reference: "",
  popup: "",
  narration: "",
  voice: "",
  image: "",
  background: "",
  start,
  end: start + 5,
  zoomStart: 0,
  zoomEnd: 5,
  zoomInDuration: 0.8,
  zoomOutDuration: 0.8,
  zoom: 1.25,
  centerX: 50,
  centerY: 50,
  zoomEnabled: true,
  effects: defaultSceneEffects(),
  overlayText: "",
  overlayTextSize: 24,
  overlayTextStyle: "normal",
  overlayTextColor: "#ffffff",
  overlayTextFont: "Arial",
  overlayTextStrokeWidth: 0,
  overlayTextStrokeColor: "#000000",
  overlayTextBorderWidth: 0,
  overlayTextBorderColor: "#ffffff",
  overlayTextX: 50,
  overlayTextY: 18,
  textOverlays: [],
  mapDecorations: [],
  sceneImages: [],
  subtitleEnabled: true,
  subtitleStyle: defaultSubtitleStyle(),
  subtitles: [],
  popupDuration: 3,
  popupStart: 0.5,
  voiceFile: "",
  voiceVolume: 95,
  popupIn: "fade-slide-up",
  popupOut: "fade-slide-down",
  popupLayout: "image-top",
  popupTheme: "travel",
  popupTextEffect: "none",
  popupVideo: "",
  popupX: 5,
  popupY: 55,
  popupBorderWidth: 1,
  popupVisible: true,
  popups: [],
  backgroundVisible: true,
  sceneVisible: true,
  status: "Nháp",
});

const initialScenes: Scene[] = [createEmptyScene()];

const safeTrim = (value: unknown) => String(value ?? "").trim();

const formatTime = (value: number) => {
  const rounded = Math.max(0, Math.round(value * 10) / 10);
  const minutes = Math.floor(rounded / 60);
  const seconds = (rounded % 60).toFixed(1);
  return `${String(minutes).padStart(2, "0")}:${seconds.padStart(4, "0")}`;
};

const fileNameOnly = (value: unknown) => {
  const trimmed = safeTrim(value);
  if (!trimmed) return "";
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return decodeURIComponent(new URL(trimmed).pathname.split("/").filter(Boolean).at(-1) ?? "");
    }
  } catch {}
  return trimmed.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? trimmed;
};

const isRemoteUrl = (value: unknown) => /^https?:\/\/.+/i.test(safeTrim(value));

const isVideoMedia = (value: unknown) => {
  const normalized = safeTrim(value).toLowerCase();
  return /\.(mp4|webm|mov|m4v|ogv|avi|mkv)(?:[?#].*)?$/.test(normalized)
    || /\/video\/upload\//.test(normalized)
    || /[?&](?:format|fm)=(?:mp4|webm|mov|m4v)/.test(normalized);
};

const isTransparentMedia = (value: unknown) => {
  const normalized = safeTrim(value).toLowerCase();
  return /\.(png|apng|gif|webm)(?:[?#].*)?$/.test(normalized)
    || /[?&](?:format|fm)=(?:png|apng|gif|webm)/.test(normalized);
};

const assetReference = (value: unknown) => {
  const trimmed = safeTrim(value);
  return isRemoteUrl(trimmed) ? trimmed : fileNameOnly(trimmed);
};

const LOCAL_STORAGE_KEY = "kito-video-studio-project";
const LOCAL_ACTIVE_PROJECT_KEY = "kito-video-studio-active-project";
const LOCAL_SAVED_AT_KEY = "kito-video-studio-project-saved-at";
const LOCAL_RENDERER_URL = "http://127.0.0.1:4179";

type LocalRenderState = {
  status: "idle" | "checking" | "uploading" | "rendering" | "cancelling" | "completed" | "failed";
  progress: number;
  message: string;
  downloadUrl?: string;
  log?: string;
};

type AssetLibraryItem = {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  file: File;
};

type PreflightCheck = {
  id: string;
  label: string;
  status: "ok" | "warning" | "error";
  detail: string;
};

const ASSET_LIBRARY_DB = "kito-video-studio-assets";
const ASSET_LIBRARY_STORE = "files";

const getAssetId = (file: File) =>
  `${file.name}::${file.size}::${file.lastModified}`;

const openAssetLibrary = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Trình duyệt không hỗ trợ thư viện tài nguyên"));
      return;
    }
    const request = indexedDB.open(ASSET_LIBRARY_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(ASSET_LIBRARY_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Không mở được thư viện tài nguyên"));
  });

const readAssetLibrary = async () => {
  const database = await openAssetLibrary();
  return new Promise<AssetLibraryItem[]>((resolve, reject) => {
    const request = database
      .transaction(ASSET_LIBRARY_STORE, "readonly")
      .objectStore(ASSET_LIBRARY_STORE)
      .getAll();
    request.onsuccess = () => {
      database.close();
      resolve((request.result as AssetLibraryItem[]).filter((item) => item?.file));
    };
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("Không đọc được thư viện tài nguyên"));
    };
  });
};

const writeAssetLibrary = async (files: File[]) => {
  if (!files.length) return;
  const database = await openAssetLibrary();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(ASSET_LIBRARY_STORE, "readwrite");
    const store = transaction.objectStore(ASSET_LIBRARY_STORE);
    files.forEach((file) => store.put({
      id: getAssetId(file),
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
      file,
    } satisfies AssetLibraryItem));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Không lưu được tài nguyên"));
    };
  });
};

const removeAssetFromLibrary = async (id: string) => {
  const database = await openAssetLibrary();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(ASSET_LIBRARY_STORE, "readwrite");
    transaction.objectStore(ASSET_LIBRARY_STORE).delete(id);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Không xóa được tài nguyên"));
    };
  });
};

const reflowSceneTimeline = (items: Scene[]) => {
  let cursor = 0;
  return items.map((item, index) => {
    const duration = Math.max(0.1, item.end - item.start);
    const next = {
      ...item,
      number: index + 1,
      start: Number(cursor.toFixed(2)),
      end: Number((cursor + duration).toFixed(2)),
    };
    cursor += duration;
    return next;
  });
};

type StoredProject = {
  version: 1;
  projectDuration: number;
  timelineHeight?: number;
  rulerEnabled?: boolean;
  rulerStyle?: RulerStyle;
  aspectRatio?: AspectRatio;
  renderResolution?: RenderResolution;
  imageEnabled: boolean;
  narrationEnabled: boolean;
  background?: string;
  previewBackground?: string;
  backgroundVisible?: boolean;
  backgroundMusic?: string;
  backgroundMusicVolume?: number;
  renderFps?: 24 | 30 | 60;
  editorSections?: EditorSectionState;
  scenes: Scene[];
};

type EditorSectionState = {
  visual: boolean;
  content: boolean;
  audio: boolean;
  effects: boolean;
  popup: boolean;
  text: boolean;
  images: boolean;
};

type EditorSectionKey = keyof EditorSectionState;

type EditorSectionClipboard =
  | {
      section: "visual";
      background: string;
      backgroundVisible: boolean;
    }
  | {
      section: "content";
      duration: number;
      sceneName: string;
    }
  | {
      section: "audio";
      narration: string;
      voice: string;
      voiceFile: string;
      voiceVolume: number;
      backgroundMusic: string;
      backgroundMusicVolume: number;
    }
  | {
      section: "effects";
      zoomEnabled: boolean;
      zoomStart: number;
      zoomEnd: number;
      zoomInDuration: number;
      zoomOutDuration: number;
      zoom: number;
      centerX: number;
      centerY: number;
      effects: SceneEffects;
    }
  | {
      section: "popup";
      popups: PopupConfig[];
    }
  | {
      section: "text";
      textOverlays: TextOverlay[];
      mapDecorations: MapDecoration[];
    }
  | {
      section: "images";
      sceneImages: SceneImage[];
    };

type StudioTab = "compose" | "export" | "settings";

const DEFAULT_EDITOR_SECTIONS: EditorSectionState = {
  visual: true,
  content: true,
  audio: true,
  effects: true,
  popup: true,
  text: true,
  images: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const clampPercent = (value: unknown, fallback = 50) => {
  const numeric = value === null || value === undefined ? Number.NaN : Number(value);
  return Math.min(100, Math.max(0, Number.isFinite(numeric) ? numeric : fallback));
};

const normalizeTimelineHeight = (value: unknown, fallback = 245) => {
  const numeric = Number(value);
  return Math.min(520, Math.max(220, Number.isFinite(numeric) ? Math.round(numeric) : fallback));
};

const normalizeRulerStyle = (value: unknown): RulerStyle =>
  value === "grid" || value === "all" ? value : "center";

const positiveNumber = (value: unknown, fallback: number, minimum = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, numeric) : fallback;
};

const normalizeHexColor = (value: unknown, fallback: string) => {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
};

const sceneImageShapeOptions: Array<{ value: SceneImageShape; label: string }> = [
  { value: "rectangle", label: "Chữ nhật" },
  { value: "square", label: "Vuông" },
  { value: "circle", label: "Tròn" },
  { value: "triangle", label: "Tam giác" },
  { value: "diamond", label: "Hình thoi" },
];

const mapDecorationDefaultName = (type: MapDecorationType) => ({
  "animated-sticker": "Hiệu ứng động",
  "text-3d": "Chữ 3D",
  sticker: "Sticker",
  icon: "Icon",
  effect: "Hiệu ứng",
}[type]);

const sceneImageClipPath = (shape: SceneImageShape) => ({
  rectangle: "inset(0)",
  square: "inset(0)",
  circle: "circle(50% at 50% 50%)",
  triangle: "polygon(50% 0%, 100% 100%, 0% 100%)",
  diamond: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
}[shape]);

const defaultSceneImage = (
  id: string,
  overrides: Partial<SceneImage> = {},
): SceneImage => ({
  id,
  name: "Hình ảnh",
  url: "",
  mediaType: "image",
  transparent: false,
  shape: "rectangle",
  x: 50,
  y: 50,
  width: 42,
  height: 28,
  opacity: 100,
  borderWidth: 0,
  borderColor: "#ffffff",
  start: 0,
  duration: 5,
  visible: true,
  ...overrides,
});

const normalizeSceneImage = (
  value: unknown,
  id: string,
  fallback: Partial<SceneImage> = {},
): SceneImage => {
  const raw = isRecord(value) ? value : {};
  const base = defaultSceneImage(id, fallback);
  const rawShape = String(raw.shape ?? base.shape);
  const shape: SceneImageShape = sceneImageShapeOptions.some((option) => option.value === rawShape)
    ? rawShape as SceneImageShape
    : base.shape;
  const url = String(raw.url ?? raw.asset ?? raw.image ?? raw.video ?? base.url);
  const mediaType = raw.mediaType === "video" || isVideoMedia(url) ? "video" : "image";
  return {
    ...base,
    id: String(raw.id ?? base.id),
    name: String(raw.name ?? base.name).trim() || base.name,
    url,
    mediaType,
    transparent: typeof raw.transparent === "boolean"
      ? raw.transparent
      : raw.transparentMedia === true || isTransparentMedia(url),
    shape,
    x: clampPercent(raw.x ?? base.x, base.x),
    y: clampPercent(raw.y ?? base.y, base.y),
    width: Math.min(96, Math.max(1, positiveNumber(raw.width, base.width, 1))),
    height: Math.min(96, Math.max(1, positiveNumber(raw.height, base.height, 1))),
    opacity: Math.min(100, Math.max(0, positiveNumber(raw.opacity, base.opacity))),
    borderWidth: Math.min(12, Math.max(0, positiveNumber(raw.borderWidth, base.borderWidth))),
    borderColor: normalizeHexColor(raw.borderColor, base.borderColor),
    start: Math.max(0, positiveNumber(raw.start, base.start)),
    duration: Math.max(0.1, positiveNumber(raw.duration, base.duration, 0.1)),
    visible: raw.visible !== false,
  };
};

const colorWithAlpha = (value: unknown, alpha: number, fallback: string) => {
  const color = normalizeHexColor(value, fallback).slice(1);
  const red = Number.parseInt(color.slice(0, 2), 16);
  const green = Number.parseInt(color.slice(2, 4), 16);
  const blue = Number.parseInt(color.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.min(1, Math.max(0, alpha))})`;
};

const defaultTextOverlay = (
  id: string,
  overrides: Partial<TextOverlay> = {},
): TextOverlay => ({
  id,
  name: "Chữ viết",
  text: "",
  visible: true,
  size: 24,
  style: "normal",
  color: "#ffffff",
  opacity: 100,
  font: "Arial",
  strokeWidth: 0,
  strokeColor: "#000000",
  borderWidth: 0,
  borderColor: "#ffffff",
  borderOpacity: 100,
  borderFill: "#14202e",
  x: 50,
  y: 18,
  ...overrides,
});

const normalizeSubtitleStyle = (value: unknown): SubtitleStyle => {
  const raw = isRecord(value) ? value : {};
  const base = defaultSubtitleStyle();
  const style = String(raw.style ?? base.style);
  const font = String(raw.font ?? base.font);
  const animation = String(raw.animation ?? base.animation);
  return {
    ...base,
    size: Math.min(120, Math.max(8, positiveNumber(raw.size, base.size, 8))),
    style: ["normal", "bold", "italic", "bold-italic"].includes(style)
      ? style as SubtitleStyle["style"]
      : base.style,
    color: normalizeHexColor(raw.color, base.color),
    opacity: Math.min(100, Math.max(0, positiveNumber(raw.opacity, base.opacity))),
    font: ["Arial", "Verdana", "Georgia", "Tahoma", "Times New Roman", "Courier New"].includes(font)
      ? font as OverlayTextFont
      : base.font,
    strokeWidth: Math.min(12, positiveNumber(raw.strokeWidth, base.strokeWidth)),
    strokeColor: normalizeHexColor(raw.strokeColor, base.strokeColor),
    borderWidth: Math.min(12, positiveNumber(raw.borderWidth, base.borderWidth)),
    borderColor: normalizeHexColor(raw.borderColor, base.borderColor),
    borderOpacity: Math.min(100, Math.max(0, positiveNumber(raw.borderOpacity, base.borderOpacity))),
    borderFill: normalizeHexColor(raw.borderFill, base.borderFill),
    x: clampPercent(raw.x, base.x),
    y: clampPercent(raw.y, base.y),
    boxWidth: Math.min(100, Math.max(40, positiveNumber(raw.boxWidth, base.boxWidth, 40))),
    animation: ["none", "fade", "pop", "slide-up", "typewriter"].includes(animation)
      ? animation as SubtitleAnimation
      : base.animation,
    animationDuration: Math.min(1, Math.max(0.05, positiveNumber(raw.animationDuration, base.animationDuration, 0.05))),
  };
};

const defaultSubtitleCue = (
  id: string,
  overrides: Partial<SubtitleCue> = {},
): SubtitleCue => ({
  id,
  text: "",
  start: 0,
  end: 3,
  visible: true,
  ...overrides,
});

const normalizeSubtitleCue = (
  value: unknown,
  id: string,
  sceneDuration: number,
): SubtitleCue => {
  const raw = isRecord(value) ? value : {};
  const base = defaultSubtitleCue(id);
  const safeDuration = Math.max(0.1, sceneDuration);
  const maxStart = Math.max(0, safeDuration - 0.1);
  const start = Math.min(
    maxStart,
    Math.max(0, positiveNumber(raw.start, base.start)),
  );
  const end = Math.min(
    safeDuration,
    Math.max(start + 0.1, positiveNumber(raw.end, Math.min(safeDuration, start + 3), 0.1)),
  );
  return {
    ...base,
    id: String(raw.id ?? id),
    text: String(raw.text ?? ""),
    start,
    end,
    visible: raw.visible !== false,
  };
};

const defaultMapDecoration = (
  id: string,
  type: MapDecorationType,
  overrides: Partial<MapDecoration> = {},
): MapDecoration => ({
  id,
  name: mapDecorationDefaultName(type),
  type,
  text: type === "text-3d" ? "ĐIỂM ĐẾN" : "",
  asset: "",
  assetType: type === "animated-sticker" ? "gif" : "image",
  symbol: type === "icon" ? "📍" : "✦",
  effect: type === "effect" ? "sparkles" : "sparkles",
  x: 50,
  y: type === "text-3d" ? 30 : 50,
  scale: type === "text-3d" ? 1 : 0.8,
  rotate: 0,
  opacity: 100,
  depth: 5,
  size: type === "text-3d" ? 48 : 64,
  color: "#ffd166",
  accentColor: "#7c3aed",
  start: 0,
  duration: 5,
  animation: type === "effect" ? "pulse" : "pop",
  visible: true,
  ...overrides,
});

const normalizeMapDecoration = (
  value: unknown,
  id: string,
  fallback: Partial<MapDecoration> = {},
): MapDecoration => {
  const raw = isRecord(value) ? value : {};
  const rawType = String(raw.type ?? fallback.type ?? "text-3d");
  const type: MapDecorationType = ["text-3d", "sticker", "icon", "effect", "animated-sticker"].includes(rawType)
    ? rawType as MapDecorationType
    : "text-3d";
  const rawEffect = String(raw.effect ?? fallback.effect ?? "sparkles");
  const effect: MapDecoration["effect"] = ["sparkles", "ring", "confetti", "glow"].includes(rawEffect)
    ? rawEffect as MapDecoration["effect"]
    : "sparkles";
  const rawAnimation = String(raw.animation ?? fallback.animation ?? "none");
  const animation: MapDecorationAnimation = ["none", "fade", "pop", "float", "pulse", "spin"].includes(rawAnimation)
    ? rawAnimation as MapDecorationAnimation
    : "none";
  const base = defaultMapDecoration(id, type, fallback);
  const rawAssetType = String(raw.assetType ?? fallback.assetType ?? base.assetType);
  const assetType = type === "animated-sticker"
    ? (["gif", "apng", "webm"].includes(rawAssetType)
      ? rawAssetType as AnimatedAssetType
      : animatedAssetTypeFromValue(String(raw.asset ?? raw.url ?? "")))
    : "image";
  return {
    ...base,
    id: String(raw.id ?? base.id),
    name: String(raw.name ?? base.name).trim() || base.name,
    type,
    text: String(raw.text ?? base.text),
    asset: String(raw.asset ?? raw.url ?? base.asset),
    assetType,
    symbol: String(raw.symbol ?? base.symbol),
    effect,
    x: clampPercent(raw.x ?? base.x, base.x),
    y: clampPercent(raw.y ?? base.y, base.y),
    scale: Math.min(3, Math.max(0.1, positiveNumber(raw.scale, base.scale, 0.1))),
    rotate: (() => {
      const rawRotate = Number(raw.rotate ?? base.rotate);
      return Number.isFinite(rawRotate) ? Math.max(-180, Math.min(180, rawRotate)) : base.rotate;
    })(),
    opacity: Math.min(100, Math.max(0, positiveNumber(raw.opacity, base.opacity))),
    depth: Math.min(16, Math.max(0, Math.round(positiveNumber(raw.depth, base.depth)))),
    size: Math.min(120, Math.max(14, positiveNumber(raw.size, base.size, 14))),
    color: normalizeHexColor(raw.color, base.color),
    accentColor: normalizeHexColor(raw.accentColor, base.accentColor),
    start: Math.max(0, positiveNumber(raw.start, base.start)),
    duration: Math.max(0.1, positiveNumber(raw.duration, base.duration, 0.1)),
    animation,
    visible: raw.visible !== false,
  };
};

const normalizeTextOverlay = (
  value: unknown,
  id: string,
  fallback: Partial<TextOverlay> = {},
): TextOverlay => {
  const raw = isRecord(value) ? value : {};
  const base = defaultTextOverlay(id, fallback);
  const style = String(raw.style ?? raw.overlayTextStyle ?? base.style);
  const font = String(raw.font ?? raw.overlayTextFont ?? base.font);
  return {
    ...base,
    id: String(raw.id ?? base.id),
    name: String(raw.name ?? base.name).trim() || base.name,
    text: String(raw.text ?? raw.overlayText ?? base.text),
    visible: raw.visible !== false,
    size: Math.min(120, Math.max(8, positiveNumber(raw.size ?? raw.overlayTextSize, base.size, 8))),
    style: ["normal", "bold", "italic", "bold-italic"].includes(style)
      ? style as TextOverlay["style"]
      : base.style,
    color: normalizeHexColor(raw.color ?? raw.overlayTextColor, base.color),
    opacity: Math.min(100, Math.max(0, positiveNumber(raw.opacity, base.opacity))),
    font: ["Arial", "Verdana", "Georgia", "Tahoma", "Times New Roman", "Courier New"].includes(font)
      ? font as OverlayTextFont
      : base.font,
    strokeWidth: Math.min(12, positiveNumber(raw.strokeWidth ?? raw.overlayTextStrokeWidth, base.strokeWidth)),
    strokeColor: normalizeHexColor(raw.strokeColor ?? raw.overlayTextStrokeColor, base.strokeColor),
    borderWidth: Math.min(12, positiveNumber(raw.borderWidth ?? raw.overlayTextBorderWidth, base.borderWidth)),
    borderColor: normalizeHexColor(raw.borderColor ?? raw.overlayTextBorderColor, base.borderColor),
    borderOpacity: Math.min(100, Math.max(0, positiveNumber(raw.borderOpacity ?? raw.overlayTextBorderOpacity, base.borderOpacity))),
    borderFill: normalizeHexColor(raw.borderFill ?? raw.overlayTextBorderFill, base.borderFill),
    x: clampPercent(raw.x ?? raw.overlayTextX, base.x),
    y: clampPercent(raw.y ?? raw.overlayTextY, base.y),
  };
};

const clampVolume = (value: unknown, fallback = 100) => {
  const numeric = Number(value);
  return Math.min(100, Math.max(0, Number.isFinite(numeric) ? numeric : fallback));
};

const normalizeSceneEffects = (value: unknown): SceneEffects => {
  const raw = isRecord(value) ? value : {};
  return {
    snowEnabled: raw.snowEnabled === true,
    snowIntensity: Math.min(100, Math.max(0, positiveNumber(raw.snowIntensity, 55))),
    snowSpeed: Math.min(3, Math.max(0.2, positiveNumber(raw.snowSpeed, 1, 0.2))),
    lightFlickerEnabled: raw.lightFlickerEnabled === true,
    lightFlickerIntensity: Math.min(100, Math.max(0, positiveNumber(raw.lightFlickerIntensity, 45))),
    lightFlickerSpeed: Math.min(3, Math.max(0.2, positiveNumber(raw.lightFlickerSpeed, 1, 0.2))),
    rainEnabled: raw.rainEnabled === true,
    rainIntensity: Math.min(100, Math.max(0, positiveNumber(raw.rainIntensity, 55))),
    rainSpeed: Math.min(3, Math.max(0.2, positiveNumber(raw.rainSpeed, 1, 0.2))),
    thunderEnabled: raw.thunderEnabled === true,
    thunderIntensity: Math.min(100, Math.max(0, positiveNumber(raw.thunderIntensity, 55))),
    thunderSpeed: Math.min(3, Math.max(0.2, positiveNumber(raw.thunderSpeed, 1, 0.2))),
    cloudEnabled: raw.cloudEnabled === true,
    cloudIntensity: Math.min(100, Math.max(0, positiveNumber(raw.cloudIntensity, 50))),
    cloudSpeed: Math.min(3, Math.max(0.2, positiveNumber(raw.cloudSpeed, 1, 0.2))),
  };
};

const normalizeEditorSections = (
  sections?: Partial<EditorSectionState>,
): EditorSectionState => ({
  visual: sections?.visual ?? DEFAULT_EDITOR_SECTIONS.visual,
  content: sections?.content ?? DEFAULT_EDITOR_SECTIONS.content,
  audio: sections?.audio ?? DEFAULT_EDITOR_SECTIONS.audio,
  effects: sections?.effects ?? DEFAULT_EDITOR_SECTIONS.effects,
  popup: sections?.popup ?? DEFAULT_EDITOR_SECTIONS.popup,
  text: sections?.text ?? DEFAULT_EDITOR_SECTIONS.text,
  images: sections?.images ?? DEFAULT_EDITOR_SECTIONS.images,
});

const defaultPopupConfig = (id: string, overrides: Partial<PopupConfig> = {}): PopupConfig => ({
  id,
  title: "",
  body: "",
  narration: "",
  image: "",
  video: "",
  transparentMedia: false,
  start: 0.5,
  duration: 3,
  in: "fade-slide-up",
  out: "fade-slide-down",
  width: 90,
  height: 255,
  borderWidth: 1,
  layout: "image-top",
  theme: "travel",
  textEffect: "none",
  x: 5,
  y: 55,
  visible: true,
  imageVisible: true,
  ...overrides,
});

const popupConfigFromScene = (scene: Partial<Scene>, id: string): PopupConfig =>
  defaultPopupConfig(id, {
    title: String(scene.title ?? ""),
    body: String(scene.popup ?? ""),
    narration: String(scene.narration ?? ""),
    image: String(scene.image ?? ""),
    video: String(scene.popupVideo ?? ""),
    transparentMedia: scene.popupTransparentMedia === true,
    start: positiveNumber(scene.popupStart, 0.5),
    duration: positiveNumber(scene.popupDuration, 3, 0.1),
    in: scene.popupIn ?? "fade-slide-up",
    out: scene.popupOut ?? "fade-slide-down",
    width: clampPercent(scene.popupWidth, 90),
    height: positiveNumber(scene.popupHeight, 255, 170),
    borderWidth: Math.min(12, positiveNumber(scene.popupBorderWidth, 1)),
    layout: scene.popupLayout ?? "image-top",
    theme: scene.popupTheme ?? "travel",
    textEffect: scene.popupTextEffect ?? "none",
    x: clampPercent(scene.popupX, 5),
    y: clampPercent(scene.popupY, 55),
    visible: scene.popupVisible !== false,
    imageVisible: (scene as Scene & { imageVisible?: boolean }).imageVisible !== false,
  });

const scenePopupList = (scene: Scene): PopupConfig[] => {
  if (Array.isArray(scene.popups)) return scene.popups;
  return [popupConfigFromScene(scene, `${scene.id}-popup-1`)];
};

const popupSceneFields = (popup: PopupConfig) => ({
  title: popup.title,
  popup: popup.body,
  image: popup.image,
  popupVideo: popup.video,
  popupTransparentMedia: popup.transparentMedia,
  popupStart: popup.start,
  popupDuration: popup.duration,
  popupIn: popup.in,
  popupOut: popup.out,
  popupWidth: popup.width,
  popupHeight: popup.height,
  popupBorderWidth: popup.borderWidth,
  popupLayout: popup.layout,
  popupTheme: popup.theme,
  popupTextEffect: popup.textEffect,
  popupX: popup.x,
  popupY: popup.y,
  popupVisible: popup.visible,
});

const textOverlaySceneFields = (overlay: TextOverlay) => ({
  overlayText: overlay.text,
  overlayTextSize: overlay.size,
  overlayTextStyle: overlay.style,
  overlayTextColor: overlay.color,
  overlayTextFont: overlay.font,
  overlayTextStrokeWidth: overlay.strokeWidth,
  overlayTextStrokeColor: overlay.strokeColor,
  overlayTextBorderWidth: overlay.borderWidth,
  overlayTextBorderColor: overlay.borderColor,
  overlayTextX: overlay.x,
  overlayTextY: overlay.y,
});

const ensureUniqueSceneIds = (items?: Scene[]) => {
  const used = new Set<string>();
  const validItems = (Array.isArray(items) ? items : []).filter(isRecord) as Scene[];
  return validItems.map((item, index) => {
    let id = item.id || `scene-${index + 1}`;
    let suffix = 2;
    while (used.has(id)) {
      id = `${item.id || `scene-${index + 1}`}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    const rawDuration = Number(item.end ?? 0) - Number(item.start ?? 0);
    const sceneDuration = Number.isFinite(rawDuration) && rawDuration > 0
      ? rawDuration
      : 5;
    const zoomStart = Math.min(sceneDuration, positiveNumber(item.zoomStart, 0));
    const zoomInDuration = positiveNumber(item.zoomInDuration, 0.8, 0.1);
    const zoomInEnd = Math.min(sceneDuration, zoomStart + zoomInDuration);
    const zoomEnd = Math.min(
      sceneDuration,
      Math.max(zoomInEnd, positiveNumber(item.zoomEnd, sceneDuration)),
    );
    const rawPopups = (item as Scene & { popups?: unknown }).popups;
    const popups = Array.isArray(rawPopups)
      ? rawPopups.filter(isRecord).map((rawPopup, popupIndex) => {
          const fallback = popupIndex === 0 ? popupConfigFromScene(item, `${id}-popup-1`) : defaultPopupConfig(`${id}-popup-${popupIndex + 1}`);
          return defaultPopupConfig(
            String(rawPopup.id ?? fallback.id),
            {
              ...fallback,
              title: String(rawPopup.title ?? rawPopup.popup ?? fallback.title),
              body: String(rawPopup.body ?? rawPopup.content ?? rawPopup.popup ?? fallback.body),
              narration: String(rawPopup.narration ?? rawPopup.voiceover ?? fallback.narration),
              image: String(rawPopup.image ?? fallback.image),
              video: String(rawPopup.video ?? rawPopup.popupVideo ?? fallback.video),
              transparentMedia: rawPopup.transparentMedia === true || rawPopup.popupTransparentMedia === true || fallback.transparentMedia,
              start: positiveNumber(rawPopup.start ?? rawPopup.popupStart, fallback.start),
              duration: positiveNumber(rawPopup.duration ?? rawPopup.popupDuration, fallback.duration, 0.1),
              in: String(rawPopup.in ?? rawPopup.popupIn ?? fallback.in),
              out: String(rawPopup.out ?? rawPopup.popupOut ?? fallback.out),
              width: clampPercent(rawPopup.width ?? rawPopup.popupWidth, fallback.width),
              height: positiveNumber(rawPopup.height ?? rawPopup.popupHeight, fallback.height, 170),
              borderWidth: Math.min(12, positiveNumber(rawPopup.borderWidth ?? rawPopup.popupBorderWidth, fallback.borderWidth)),
              layout: ["image-top", "split", "quote", "stats", "image-only", "content-only"].includes(String(rawPopup.layout ?? rawPopup.popupLayout))
                ? (rawPopup.layout ?? rawPopup.popupLayout) as Scene["popupLayout"]
                : fallback.layout,
              theme: ["travel", "sunset", "ocean", "minimal"].includes(String(rawPopup.theme ?? rawPopup.popupTheme))
                ? (rawPopup.theme ?? rawPopup.popupTheme) as Scene["popupTheme"]
                : fallback.theme,
              textEffect: ["none", "fade", "rise", "pop"].includes(String(rawPopup.textEffect ?? rawPopup.popupTextEffect))
                ? (rawPopup.textEffect ?? rawPopup.popupTextEffect) as Scene["popupTextEffect"]
                : fallback.textEffect,
              x: clampPercent(rawPopup.x ?? rawPopup.popupX, fallback.x),
              y: clampPercent(rawPopup.y ?? rawPopup.popupY, fallback.y),
              visible: rawPopup.visible !== false,
              imageVisible: rawPopup.imageVisible !== false,
            },
          );
        })
      : [popupConfigFromScene(item, `${id}-popup-1`)];
    const firstPopup = popups[0];
    const rawTextOverlays = (item as Scene & { textOverlays?: unknown }).textOverlays;
    const legacyText = String((item as Scene & { overlayText?: unknown }).overlayText ?? "");
    const textOverlays = Array.isArray(rawTextOverlays) && rawTextOverlays.some(isRecord)
      ? rawTextOverlays.filter(isRecord).map((rawText, textIndex) => normalizeTextOverlay(
          rawText,
          String((rawText as { id?: unknown }).id ?? `${id}-text-${textIndex + 1}`),
          { name: `Chữ ${textIndex + 1}` },
        ))
      : safeTrim(legacyText)
        ? [normalizeTextOverlay({
            id: `${id}-text-1`,
            text: legacyText,
            size: (item as Scene & { overlayTextSize?: unknown }).overlayTextSize,
            style: (item as Scene & { overlayTextStyle?: unknown }).overlayTextStyle,
            color: (item as Scene & { overlayTextColor?: unknown }).overlayTextColor,
            font: (item as Scene & { overlayTextFont?: unknown }).overlayTextFont,
            strokeWidth: (item as Scene & { overlayTextStrokeWidth?: unknown }).overlayTextStrokeWidth,
            strokeColor: (item as Scene & { overlayTextStrokeColor?: unknown }).overlayTextStrokeColor,
            borderWidth: (item as Scene & { overlayTextBorderWidth?: unknown }).overlayTextBorderWidth,
            borderColor: (item as Scene & { overlayTextBorderColor?: unknown }).overlayTextBorderColor,
            x: (item as Scene & { overlayTextX?: unknown }).overlayTextX,
            y: (item as Scene & { overlayTextY?: unknown }).overlayTextY,
          }, `${id}-text-1`, { name: "Chữ 1" })]
        : [];
    const rawDecorations = (item as Scene & { mapDecorations?: unknown }).mapDecorations;
    const mapDecorations = Array.isArray(rawDecorations)
      ? rawDecorations.filter(isRecord).map((rawDecoration, decorationIndex) => normalizeMapDecoration(
        rawDecoration,
        String((rawDecoration as { id?: unknown }).id ?? `${id}-decoration-${decorationIndex + 1}`),
      ))
      : [];
    const rawSceneImages = (item as Scene & { sceneImages?: unknown }).sceneImages
      ?? (item as Scene & { images?: unknown }).images;
    const sceneImages = Array.isArray(rawSceneImages)
      ? rawSceneImages.filter(isRecord).map((rawImage, imageIndex) => normalizeSceneImage(
        rawImage,
        String((rawImage as { id?: unknown }).id ?? `${id}-image-${imageIndex + 1}`),
        { duration: sceneDuration, name: `Hình ảnh ${imageIndex + 1}` },
      ))
      : [];
    const rawSubtitles = (item as Scene & { subtitles?: unknown }).subtitles;
    const rawSubtitleStyle = (item as Scene & { subtitleStyle?: unknown }).subtitleStyle;
    const subtitles = Array.isArray(rawSubtitles)
      ? rawSubtitles.filter(isRecord).map((rawSubtitle, subtitleIndex) => normalizeSubtitleCue(
        rawSubtitle,
        String((rawSubtitle as { id?: unknown }).id ?? `${id}-subtitle-${subtitleIndex + 1}`),
        sceneDuration,
      ))
      : [];
    const firstTextOverlay = textOverlays[0] ?? defaultTextOverlay(`${id}-text-1`);
    return {
      ...item,
      id,
      sceneName: String((item as Scene & { sceneName?: unknown }).sceneName ?? item.title ?? `Cảnh ${index + 1}`),
      ...popupSceneFields(firstPopup ?? defaultPopupConfig(`${id}-popup-1`)),
      popups,
      mapDecorations,
      narration: String(item.narration ?? ""),
      zoomStart,
      zoomEnd,
      zoomInDuration,
      zoomOutDuration: positiveNumber(item.zoomOutDuration, 0.8),
      zoom: Math.min(5, Math.max(1, positiveNumber(item.zoom, 1.25, 1))),
      centerX: clampPercent(item.centerX),
      centerY: clampPercent(item.centerY),
      zoomEnabled: item.zoomEnabled !== false,
      effects: normalizeSceneEffects(item.effects),
      overlayText: firstTextOverlay.text,
      overlayTextSize: firstTextOverlay.size,
      overlayTextStyle: firstTextOverlay.style,
      overlayTextColor: firstTextOverlay.color,
      overlayTextFont: firstTextOverlay.font,
      overlayTextStrokeWidth: firstTextOverlay.strokeWidth,
      overlayTextStrokeColor: firstTextOverlay.strokeColor,
      overlayTextBorderWidth: firstTextOverlay.borderWidth,
      overlayTextBorderColor: firstTextOverlay.borderColor,
      overlayTextX: firstTextOverlay.x,
      overlayTextY: firstTextOverlay.y,
      textOverlays,
      subtitleEnabled: item.subtitleEnabled !== false,
      subtitleStyle: normalizeSubtitleStyle(rawSubtitleStyle),
      subtitles,
      voiceVolume: clampVolume(item.voiceVolume, 95),
      backgroundVisible: item.backgroundVisible ?? true,
      sceneVisible: item.sceneVisible !== false,
    };
  });
};

const reflowVisibleSceneTimeline = (items: Scene[]) => {
  let cursor = 0;
  return items
    .filter((item) => item.sceneVisible !== false)
    .map((item) => {
      const duration = Math.max(0.1, item.end - item.start);
      const next = {
        ...item,
        start: Number(cursor.toFixed(2)),
        end: Number((cursor + duration).toFixed(2)),
      };
      cursor += duration;
      return next;
    });
};

type StudioErrorBoundaryProps = { children: ReactNode };
type StudioErrorBoundaryState = { error: Error | null };

class StudioErrorBoundary extends Component<StudioErrorBoundaryProps, StudioErrorBoundaryState> {
  state: StudioErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): StudioErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Kito Video Studio render error", error, errorInfo);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="studio-shell studio-error-shell">
        <section className="studio-error-card" role="alert">
          <span className="studio-error-kicker">KITO VIDEO STUDIO</span>
          <h1>Không thể hiển thị khu vực biên soạn</h1>
          <p>
            Dữ liệu cảnh hiện tại không hợp lệ hoặc chưa tải xong.
            Hãy đăng nhập lại để tải dữ liệu từ Firestore.
          </p>
          <button type="button" className="button primary" onClick={() => window.location.reload()}>
            Tải lại dữ liệu
          </button>
        </section>
      </main>
    );
  }
}

type ProjectSnapshot = Omit<StoredProject, "version"> & {
  id: string;
  title: string;
};

type StoredWorkspace = {
  version: 2;
  activeProjectId: string;
  projects: ProjectSnapshot[];
};

const isBundledSampleWorkspace = (data: unknown) => {
  const serialized = JSON.stringify(data) ?? "";
  return serialized.includes('"id":"david-journey"')
    || serialized.includes('"image":"media/samuel-anoints-david.jpg"')
    || serialized.includes('"voiceFile":"audio/milestone-1.mp3"');
};

type SettingsWorkspaceProps = {
  projectItems: ProjectSnapshot[];
  activeProjectId: string;
  projectTitle: string;
  aspectRatio: AspectRatio;
  assetPreviewSource: (value: string) => string;
  onAddClip: () => void;
  onRenameClip: (projectId: string, title: string) => void;
  onDuplicateClip: (project: ProjectSnapshot) => ProjectSnapshot;
  onDeleteClip: (project: ProjectSnapshot) => string | null;
  onOpenScene: (project: ProjectSnapshot, scene: Scene) => void;
  onSave: () => void;
  saveDisabled: boolean;
  saveLabel: string;
};

function SettingsWorkspace({
  projectItems,
  activeProjectId,
  projectTitle,
  aspectRatio,
  assetPreviewSource,
  onAddClip,
  onRenameClip,
  onDuplicateClip,
  onDeleteClip,
  onOpenScene,
  onSave,
  saveDisabled,
  saveLabel,
}: SettingsWorkspaceProps) {
  const [selectedClipId, setSelectedClipId] = useState(activeProjectId);
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [editingClipTitle, setEditingClipTitle] = useState("");
  const selectedClip = projectItems.find((item) => item.id === selectedClipId)
    ?? projectItems.find((item) => item.id === activeProjectId)
    ?? projectItems[0];
  const selectedScenes = selectedClip?.scenes ?? [];
  const selectedScene = selectedScenes.find((item) => item.id === selectedSceneId)
    ?? selectedScenes[0];

  useEffect(() => {
    if (!projectItems.length) return;
    if (!projectItems.some((item) => item.id === selectedClipId)) {
      setSelectedClipId(projectItems.find((item) => item.id === activeProjectId)?.id ?? projectItems[0].id);
    }
  }, [activeProjectId, projectItems, selectedClipId]);

  useEffect(() => {
    if (!selectedScenes.length) {
      setSelectedSceneId("");
      return;
    }
    if (!selectedScenes.some((item) => item.id === selectedSceneId)) {
      setSelectedSceneId(selectedScenes[0].id);
    }
  }, [selectedClipId, selectedSceneId, selectedScenes]);

  const selectClip = (project: ProjectSnapshot) => {
    setEditingClipId(null);
    setEditingClipTitle("");
    setSelectedClipId(project.id);
    setSelectedSceneId(project.scenes[0]?.id ?? "");
  };

  const startClipRename = (project: ProjectSnapshot) => {
    setSelectedClipId(project.id);
    setEditingClipId(project.id);
    setEditingClipTitle(project.title || "");
  };

  const cancelClipRename = () => {
    setEditingClipId(null);
    setEditingClipTitle("");
  };

  const commitClipRename = () => {
    if (!editingClipId) return;
    const source = projectItems.find((item) => item.id === editingClipId);
    const nextTitle = editingClipTitle.trim() || source?.title || "Clip chưa đặt tên";
    onRenameClip(editingClipId, nextTitle);
    cancelClipRename();
  };

  const handleDuplicateClip = () => {
    if (!selectedClip) return;
    const copied = onDuplicateClip(selectedClip);
    setSelectedClipId(copied.id);
    setSelectedSceneId(copied.scenes[0]?.id ?? "");
  };

  const handleDeleteClip = () => {
    if (!selectedClip) return;
    const fallbackId = onDeleteClip(selectedClip);
    if (fallbackId) {
      setSelectedClipId(fallbackId);
      const fallback = projectItems.find((item) => item.id === fallbackId);
      setSelectedSceneId(fallback?.scenes[0]?.id ?? "");
    }
  };

  if (!selectedClip) {
    return (
      <section className="settings-workspace settings-empty-state">
        <div className="settings-empty-card">
          <span className="settings-kicker">CÀI ĐẶT DỰ ÁN</span>
          <h2>Chưa có clip nào</h2>
          <p>Tạo clip đầu tiên để bắt đầu quản lý cảnh và tài nguyên.</p>
          <button type="button" className="button primary" onClick={onAddClip}>＋ Thêm clip</button>
        </div>
      </section>
    );
  }

  const clipDuration = Math.max(
    selectedClip.projectDuration,
    ...selectedScenes.map((item) => item.end),
  );
  const firstScene = selectedScenes[0];
  const clipAvatarValue = String(firstScene?.background ?? "").trim()
    || String(selectedClip.previewBackground ?? "").trim()
    || String(selectedClip.background ?? "").trim()
    || String(firstScene?.image ?? "").trim();

  return (
    <>
      <header className="topbar settings-topbar">
        <div className="settings-topbar-title">
          <span className="settings-kicker">KITO VIDEO STUDIO / CÀI ĐẶT</span>
          <h1>Quản lý clip &amp; cảnh</h1>
        </div>
        <div className="settings-project-chip">
          <i />
          <span>{projectTitle}</span>
          <b>{projectItems.length} clip</b>
        </div>
        <button
          type="button"
          className="button settings-save-button"
          onClick={onSave}
          disabled={saveDisabled}
        >
          {saveLabel}
        </button>
      </header>

      <section className="settings-workspace" aria-label="Nội dung cài đặt clip và cảnh">
        <div className="settings-layout">
          <div className="settings-content">
            <div className="settings-clip-grid">
              <section className="settings-card settings-clip-list-card">
                <div className="settings-card-heading">
                  <div>
                    <span className="settings-section-label">DỰ ÁN</span>
                    <h3>Danh sách clip</h3>
                  </div>
                  <span className="settings-count-badge">{projectItems.length}</span>
                </div>
                <div className="settings-clip-list">
                  {projectItems.map((project) => {
                    const duration = Math.max(
                      project.projectDuration,
                      ...project.scenes.map((item) => item.end),
                    );
                    return (
                      <div
                        role="button"
                        tabIndex={0}
                        key={project.id}
                        className={`settings-clip-item ${project.id === selectedClip.id ? "selected" : ""}`}
                        onClick={() => selectClip(project)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectClip(project);
                          }
                        }}
                        aria-pressed={project.id === selectedClip.id}
                      >
                        {(() => {
                          const projectFirstScene = project.scenes[0];
                          const projectAvatarValue = String(projectFirstScene?.background ?? "").trim()
                            || String(project.previewBackground ?? "").trim()
                            || String(project.background ?? "").trim()
                            || String(projectFirstScene?.image ?? "").trim();
                          const projectAvatarSource = assetPreviewSource(projectAvatarValue);
                          return (
                            <span className="settings-clip-thumb" aria-hidden="true">
                              {projectAvatarSource ? (
                                isVideoMedia(projectAvatarValue) ? (
                                  <video src={projectAvatarSource} muted loop playsInline preload="metadata" />
                                ) : (
                                  <img src={projectAvatarSource} alt="" />
                                )
                              ) : (
                                <b>{String(project.scenes.length).padStart(2, "0")}</b>
                              )}
                              <em>{String(project.scenes.length).padStart(2, "0")}</em>
                            </span>
                          );
                        })()}
                        <span className="settings-clip-copy">
                          {editingClipId === project.id ? (
                            <input
                              className="settings-clip-title-input"
                              value={editingClipTitle}
                              autoFocus
                              aria-label={`Đổi tên clip ${project.title || "chưa đặt tên"}`}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => setEditingClipTitle(event.target.value)}
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  commitClipRename();
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelClipRename();
                                }
                              }}
                              onKeyUp={(event) => event.stopPropagation()}
                            />
                          ) : (
                            <strong
                              title="Nhấp đúp để đổi tên clip"
                              onDoubleClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                startClipRename(project);
                              }}
                            >
                              {project.title || "Clip chưa đặt tên"}
                            </strong>
                          )}
                          <span>{project.scenes.length} cảnh · {formatTime(duration)} · {project.aspectRatio ?? "9:16"}</span>
                        </span>
                        <span className={`settings-clip-status ${project.id === activeProjectId ? "open" : ""}`}>
                          {project.id === activeProjectId ? "Đang mở" : "Đã lưu"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="settings-card settings-detail-card">
                <div className="settings-detail-heading">
                  <div>
                    <span className="settings-section-label">THÔNG TIN CLIP</span>
                    <h3>{selectedClip.title || "Clip chưa đặt tên"}</h3>
                    <p>{selectedClip.id === activeProjectId ? "Clip đang được mở trong Biên soạn" : "Clip đã lưu trong dự án"}</p>
                  </div>
                  <span className="settings-detail-ratio">{selectedClip.aspectRatio ?? aspectRatio}</span>
                </div>

                <div className="settings-clip-actions">
                  <div>
                    <strong>Thao tác clip</strong>
                    <span>Nhân bản để tạo một phiên bản độc lập hoặc xóa clip khỏi dự án.</span>
                  </div>
                  <div className="settings-action-buttons">
                    <button type="button" className="button settings-add-clip-action" onClick={onAddClip}>＋ Thêm clip</button>
                    <button type="button" className="button ghost" onClick={() => startClipRename(selectedClip)}>✎ Đổi tên clip</button>
                    <button type="button" className="button ghost" onClick={handleDuplicateClip}>⧉ Nhân bản clip</button>
                    <button type="button" className="button settings-danger-button" onClick={handleDeleteClip}>⌫ Xóa clip</button>
                  </div>
                </div>

                <div className="settings-summary-grid">
                  <div><span>Số cảnh</span><b>{selectedScenes.length}</b></div>
                  <div><span>Thời lượng</span><b>{formatTime(clipDuration)}</b></div>
                  <div><span>Tỷ lệ</span><b>{selectedClip.aspectRatio ?? aspectRatio}</b></div>
                </div>

                <div className="settings-scene-heading">
                  <div>
                    <span className="settings-section-label">NỘI DUNG CLIP</span>
                    <h3>Các cảnh trong clip</h3>
                  </div>
                  <span>{selectedScenes.length} cảnh · chọn để xem chi tiết</span>
                </div>
                <div className="settings-scenes-list">
                  {selectedScenes.map((item) => {
                    const sceneMediaValue = String(item.image ?? "").trim()
                      || String(item.background ?? "").trim()
                      || clipAvatarValue;
                    const sceneMediaSource = assetPreviewSource(sceneMediaValue);
                    return (
                      <button
                        type="button"
                        key={item.id}
                        className={`settings-scene-item ${item.id === selectedScene?.id ? "selected" : ""}`}
                        onClick={() => setSelectedSceneId(item.id)}
                      >
                        <span className="settings-scene-number">{String(item.number).padStart(2, "0")}</span>
                        <span className={`settings-scene-thumb scene-tone-${(item.number - 1) % 4}`} aria-hidden="true">
                          {sceneMediaSource ? (
                            isVideoMedia(sceneMediaValue) ? (
                              <video src={sceneMediaSource} muted loop playsInline preload="metadata" />
                            ) : (
                              <img src={sceneMediaSource} alt="" />
                            )
                          ) : (
                            <b>{String(item.number).padStart(2, "0")}</b>
                          )}
                          <i />
                        </span>
                        <span className="settings-scene-copy">
                          <strong>{item.sceneName || `Cảnh ${item.number}`}</strong>
                          <span>{formatTime(item.start)} – {formatTime(item.end)} · {item.status}</span>
                          <small>
                            {item.background || "Nền mặc định"}
                            {item.popup ? " · Popup" : ""}
                            {item.voiceFile ? " · Thuyết minh" : ""}
                          </small>
                        </span>
                        <span className="settings-scene-arrow" aria-hidden="true">›</span>
                      </button>
                    );
                  })}
                </div>
              </section>

                {selectedScene && (
                  <section className="settings-card settings-selected-scene settings-selected-scene-panel" aria-labelledby="selected-scene-heading">
                    <div className="settings-selected-scene-heading">
                      <div>
                        <span className="settings-section-label">CẢNH ĐANG CHỌN · {String(selectedScene.number).padStart(2, "0")}</span>
                        <h4 id="selected-scene-heading">{selectedScene.sceneName || `Cảnh ${selectedScene.number}`}</h4>
                      </div>
                      <button type="button" className="button primary" onClick={() => onOpenScene(selectedClip, selectedScene)}>Mở biên soạn</button>
                    </div>
                    <div className="settings-scene-facts">
                      <div><span>Thời gian</span><b>{formatTime(selectedScene.end - selectedScene.start)}</b></div>
                      <div><span>Background</span><b>{selectedScene.background || "Mặc định"}</b></div>
                      <div><span>Popup</span><b>{selectedScene.popup ? "Đã bật" : "Chưa có nội dung"}</b></div>
                      <div><span>Chuyển động</span><b>{selectedScene.zoomEnabled !== false ? `Zoom ${selectedScene.zoom.toFixed(1)}×` : "Đã tắt"}</b></div>
                    </div>
                    <p>{selectedScene.narration || "Cảnh này chưa có lời thuyết minh. Bạn có thể bổ sung nội dung trong Biên soạn."}</p>
                    <div className="settings-full-scene-info">
                      <section>
                        <h5>Nội dung cảnh</h5>
                        <div className="settings-info-grid">
                          <div><span>Tên cảnh</span><b>{selectedScene.sceneName || `Cảnh ${selectedScene.number}`}</b></div>
                          <div><span>Tiêu đề popup</span><b>{selectedScene.title || "Chưa có"}</b></div>
                          <div><span>Vị trí</span><b>{selectedScene.location || "Chưa có"}</b></div>
                          <div><span>Tham chiếu</span><b>{selectedScene.reference || "Chưa có"}</b></div>
                          <div className="wide"><span>Popup</span><b>{selectedScene.popup || "Chưa có nội dung"}</b></div>
                          <div className="wide"><span>Thuyết minh</span><b>{selectedScene.narration || "Chưa có nội dung"}</b></div>
                          <div><span>Giọng đọc</span><b>{selectedScene.voice || "Chưa chọn"}</b></div>
                          <div><span>Trạng thái</span><b>{selectedScene.status}</b></div>
                        </div>
                      </section>
                      <section>
                        <h5>Tài nguyên</h5>
                        <div className="settings-info-grid">
                          <div className="wide"><span>Ảnh cảnh</span><b>{selectedScene.image || "Chưa có"}</b></div>
                          <div className="wide"><span>Background</span><b>{selectedScene.background || "Mặc định"}</b></div>
                          <div className="wide"><span>Video popup</span><b>{selectedScene.popupVideo || "Chưa có"}</b></div>
                          <div className="wide"><span>Âm thanh thuyết minh</span><b>{selectedScene.voiceFile || "Chưa có"}</b></div>
                          <div><span>Âm lượng</span><b>{selectedScene.voiceVolume}%</b></div>
                        </div>
                      </section>
                      <section>
                        <h5>Popup</h5>
                        <div className="settings-info-grid">
                          <div><span>Hiển thị</span><b>{selectedScene.popupVisible !== false ? "Bật" : "Tắt"}</b></div>
                          <div><span>Bắt đầu</span><b>{formatTime(selectedScene.popupStart ?? 0)}</b></div>
                          <div><span>Thời lượng</span><b>{formatTime(selectedScene.popupDuration)}</b></div>
                          <div><span>Mở / đóng</span><b>{selectedScene.popupIn || "Chưa chọn"} / {selectedScene.popupOut || "Chưa chọn"}</b></div>
                          <div><span>Bố cục</span><b>{selectedScene.popupLayout || "Chưa chọn"}</b></div>
                          <div><span>Chủ đề</span><b>{selectedScene.popupTheme || "Chưa chọn"}</b></div>
                          <div><span>Hiệu ứng chữ</span><b>{selectedScene.popupTextEffect || "Chưa chọn"}</b></div>
                          <div><span>Vị trí</span><b>X {selectedScene.popupX ?? 5}% · Y {selectedScene.popupY ?? 55}%</b></div>
                          <div><span>Kích thước</span><b>{selectedScene.popupWidth ?? 90}% × {selectedScene.popupHeight ?? 255}px</b></div>
                        </div>
                      </section>
                      <section>
                        <h5>Zoom camera &amp; trạng thái</h5>
                        <div className="settings-info-grid">
                          <div><span>Zoom</span><b>{selectedScene.zoomEnabled !== false ? `${selectedScene.zoom.toFixed(1)}×` : "Tắt"}</b></div>
                          <div><span>Bắt đầu / kết thúc</span><b>{formatTime(selectedScene.zoomStart)} / {formatTime(selectedScene.zoomEnd)}</b></div>
                          <div><span>Thời lượng vào / ra</span><b>{formatTime(selectedScene.zoomInDuration)} / {formatTime(selectedScene.zoomOutDuration)}</b></div>
                          <div><span>Tâm zoom</span><b>X {Math.round(selectedScene.centerX)}% · Y {Math.round(selectedScene.centerY)}%</b></div>
                          <div><span>Khung thời gian</span><b>{formatTime(selectedScene.start)} – {formatTime(selectedScene.end)}</b></div>
                          <div><span>Hiển thị cảnh</span><b>{selectedScene.sceneVisible !== false ? "Bật" : "Tắt"}</b></div>
                          <div><span>Background trong cảnh</span><b>{selectedScene.backgroundVisible !== false ? "Bật" : "Tắt"}</b></div>
                        </div>
                      </section>
                    </div>
                  </section>
                )}

                <div className="settings-note settings-clip-note">
                  <span>i</span>
                  <p>Nhân bản clip sẽ sao chép toàn bộ cảnh, hiệu ứng và cấu hình render thành một bản độc lập.</p>
                </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function Home() {
  const [scenes, setScenes] = useState(initialScenes);
  const [selectedId, setSelectedId] = useState(initialScenes[0].id);
  const [selectedPopupId, setSelectedPopupId] = useState("");
  const [selectedTextOverlayId, setSelectedTextOverlayId] = useState("");
  const [selectedDecorationId, setSelectedDecorationId] = useState("");
  const [selectedSceneImageId, setSelectedSceneImageId] = useState("");
  const [renamingTextOverlayId, setRenamingTextOverlayId] = useState("");
  const [renamingTextOverlayName, setRenamingTextOverlayName] = useState("");
  const [renamingDecorationId, setRenamingDecorationId] = useState("");
  const [renamingDecorationName, setRenamingDecorationName] = useState("");
  const [renamingSceneImageId, setRenamingSceneImageId] = useState("");
  const [renamingSceneImageName, setRenamingSceneImageName] = useState("");
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([
    initialScenes[0].id,
  ]);
  const [projectId, setProjectId] = useState("google-sheet-project");
  const [projectTitle, setProjectTitle] = useState("Dự án mới");
  const [projects, setProjects] = useState<ProjectSnapshot[]>([]);
  const [projectDuration, setProjectDuration] = useState(30);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [renderResolution, setRenderResolution] = useState<RenderResolution>("1080x1920");
  const [renderFps, setRenderFps] = useState<24 | 30 | 60>(30);
  const [activeStudioTab, setActiveStudioTab] = useState<StudioTab>("compose");
  const [imageEnabled, setImageEnabled] = useState(true);
  const [narrationEnabled, setNarrationEnabled] = useState(true);
  const [background, setBackground] = useState("");
  const [previewBackground, setPreviewBackground] = useState("");
  const [backgroundVisible, setBackgroundVisible] = useState(true);
  const [backgroundMusic, setBackgroundMusic] = useState("");
  const [backgroundMusicVolume, setBackgroundMusicVolume] = useState(18);
  const [backgroundMusicPreview, setBackgroundMusicPreview] = useState("");
  const [editorSections, setEditorSections] = useState<EditorSectionState>(
    DEFAULT_EDITOR_SECTIONS,
  );
  const [playing, setPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [googleUser, setGoogleUser] = useState<FirebaseUser | null>(null);
  const [googleAuthReady, setGoogleAuthReady] = useState(false);
  const [googleAuthBusy, setGoogleAuthBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    "loading" | "saved" | "saving" | "unsaved" | "offline" | "error"
  >("loading");
  const lastSavedProjectSnapshot = useRef("");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showPromptGenerator, setShowPromptGenerator] = useState(false);
  const [showLocalRenderer, setShowLocalRenderer] = useState(false);
  const [jsonPreviewCleared, setJsonPreviewCleared] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [audioPreview, setAudioPreview] = useState<Record<string, string>>({});
  const [audioFiles, setAudioFiles] = useState<Record<string, File>>({});
  const [subtitleAlignState, setSubtitleAlignState] = useState<{
    status: "idle" | "running" | "success" | "error";
    sceneId: string;
    message: string;
  }>({ status: "idle", sceneId: "", message: "" });
  const [localRenderFiles, setLocalRenderFiles] = useState<File[]>([]);
  const [assetPreviewUrls, setAssetPreviewUrls] = useState<Record<string, string>>({});
  const [sceneImageSpritePreviewUrls, setSceneImageSpritePreviewUrls] = useState<Record<string, string>>({});
  const [assetLibrary, setAssetLibrary] = useState<AssetLibraryItem[]>([]);
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[]>([]);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [clipboardScene, setClipboardScene] = useState<Scene | null>(null);
  const [sectionClipboard, setSectionClipboard] = useState<Partial<Record<EditorSectionKey, EditorSectionClipboard>>>({});
  const [localRenderState, setLocalRenderState] = useState<LocalRenderState>({
    status: "idle",
    progress: 0,
    message: "Chưa kết nối dịch vụ render cục bộ",
  });
  const [draggingZoomCenter, setDraggingZoomCenter] = useState(false);
  const [draggingTextOverlay, setDraggingTextOverlay] = useState(false);
  const [draggingMapDecoration, setDraggingMapDecoration] = useState(false);
  const [draggingSceneImage, setDraggingSceneImage] = useState(false);
  const [mapEffectDragActive, setMapEffectDragActive] = useState(false);
  const [draggingSubtitle, setDraggingSubtitle] = useState(false);
  const [rulerEnabled, setRulerEnabled] = useState(false);
  const [rulerStyle, setRulerStyle] = useState<RulerStyle>("center");
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuides>(EMPTY_ALIGNMENT_GUIDES);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const savedTheme = window.localStorage.getItem("kito-video-studio-theme");
    const themeVersion = window.localStorage.getItem("kito-video-studio-theme-version");
    if (themeVersion !== "editor-v2") {
      window.localStorage.setItem("kito-video-studio-theme-version", "editor-v2");
      return "light";
    }
    return savedTheme === "dark" ? "dark" : "light";
  });
  const [timelineHeight, setTimelineHeight] = useState(245);
  const animationFrame = useRef<number | null>(null);
  const narrationAudio = useRef<HTMLAudioElement | null>(null);
  const backgroundMusicAudio = useRef<HTMLAudioElement | null>(null);
  const backgroundVideoRef = useRef<HTMLVideoElement | null>(null);
  const animatedEffectFileInput = useRef<HTMLInputElement | null>(null);
  const historyPast = useRef<ProjectSnapshot[]>([]);
  const historyFuture = useRef<ProjectSnapshot[]>([]);
  const historySnapshot = useRef("");
  const historyApplying = useRef(false);
  const [, setHistoryVersion] = useState(0);
  const timelinePopupMoved = useRef(false);
  const localRenderJobId = useRef("");

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => undefined;

    try {
      unsubscribe = observeGoogleUser((user) => {
        if (cancelled) return;
        setGoogleUser(user);
        setGoogleAuthReady(true);
      });
    } catch {
      if (!cancelled) setGoogleAuthReady(true);
    }

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const handleGoogleSignIn = async () => {
    setGoogleAuthBusy(true);
    try {
      await signInWithGoogle();
      setToast("Đăng nhập Google thành công");
    } catch (error) {
      const reason = error instanceof Error
        ? error.message.replace(/\s+/g, " ").slice(0, 180)
        : "Không thể đăng nhập Google";
      setToast(`Đăng nhập Google lỗi: ${reason}`);
    } finally {
      setGoogleAuthBusy(false);
      window.setTimeout(() => setToast(""), 3200);
    }
  };

  const handleGoogleSignOut = async () => {
    setGoogleAuthBusy(true);
    try {
      await signOutFromGoogle();
      setToast("Đã đăng xuất Google");
    } catch (error) {
      const reason = error instanceof Error
        ? error.message.replace(/\s+/g, " ").slice(0, 180)
        : "Không thể đăng xuất Google";
      setToast(`Đăng xuất Google lỗi: ${reason}`);
    } finally {
      setGoogleAuthBusy(false);
      window.setTimeout(() => setToast(""), 2800);
    }
  };

  /* Excel import was removed from the editor UI; keep this migration path disabled. const handleExcelImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    setFirestoreImportBusy(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const worksheet = workbook.Sheets.Storage ?? workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) throw new Error("File Excel không có sheet dữ liệu.");

      const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        raw: true,
        defval: "",
      });
      const dataRow = rows.find((row) =>
        String(row[0] ?? "").trim() === "render-video-default"
        && String(row[1] ?? "").trim(),
      );
      const rawJson = String(dataRow?.[1] ?? "").trim();
      if (!rawJson) throw new Error("Không tìm thấy dữ liệu workspace trong file Excel.");

      const workspace = JSON.parse(rawJson) as unknown;
      if (!isRecord(workspace) || workspace.version !== 2 || !Array.isArray(workspace.projects)) {
        throw new Error("Dữ liệu workspace trong Excel không đúng định dạng Kito.");
      }

      const result = await importWorkspaceSnapshotToFirestore(workspace);
      if (!applyStoredProject(workspace)) {
        throw new Error("Đã ghi Firestore nhưng không thể mở workspace từ file Excel.");
      }
      lastSavedProjectSnapshot.current = JSON.stringify(workspace);
      setSaveStatus("saved");
      setLastSavedAt(new Date());
      setToast(
        result.backupId
          ? "Đã nhập Excel vào Firestore · Bản hiện tại đã được sao lưu"
          : "Đã nhập Excel vào Firestore",
      );
    } catch (error) {
      const reason = error instanceof Error
        ? error.message.replace(/\s+/g, " ").slice(0, 180)
        : "Không thể nhập dữ liệu Excel";
      setToast(`Nhập Excel lỗi: ${reason}`);
    } finally {
      setFirestoreImportBusy(false);
      window.setTimeout(() => setToast(""), 3600);
    }
  }; */

  const visibleScenes = useMemo(
    () => reflowVisibleSceneTimeline(scenes.filter((item) => item.sceneVisible !== false)),
    [scenes],
  );
  const scene =
    visibleScenes.find((item) => item.id === selectedId) ??
    scenes.find((item) => item.id === selectedId) ??
    visibleScenes[0] ??
    scenes[0] ??
    initialScenes[0];
  const sceneEffects = normalizeSceneEffects(scene.effects);
  const scenePopups = useMemo(() => scenePopupList(scene), [scene]);
  const activePopup = scenePopups.find((item) => item.id === selectedPopupId) ?? scenePopups[0];
  const sceneTextOverlays = scene.textOverlays ?? [];
  const activeTextOverlay = sceneTextOverlays.find((item) => item.id === selectedTextOverlayId)
    ?? sceneTextOverlays[0];
  const sceneDecorations = scene.mapDecorations ?? [];
  const sceneImages = scene.sceneImages ?? [];
  const animatedEffectAssets = useMemo(
    () => assetLibrary.filter((item) => isAnimatedEffectFile(item.file)),
    [assetLibrary],
  );
  const activeDecoration = sceneDecorations.find((item) => item.id === selectedDecorationId)
    ?? sceneDecorations[0];
  const activeSceneImage = sceneImages.find((item) => item.id === selectedSceneImageId)
    ?? sceneImages[0];
  const totalDuration = Math.max(0, ...visibleScenes.map((item) => item.end));
  const renderDuration = Math.max(projectDuration, totalDuration);
  const timelineLength = Math.max(0.1, projectDuration);
  const timelinePercent = (time: number) => `${Math.min(100, Math.max(0, (time / timelineLength) * 100))}%`;
  const resolutionOptions = resolutionOptionsFor(aspectRatio);
  const updateAspectRatio = (nextAspectRatio: AspectRatio) => {
    setAspectRatio(nextAspectRatio);
    setRenderResolution(defaultResolutionFor(nextAspectRatio));
  };
  const adjustPreviewZoom = (delta: number) => {
    setPreviewZoom((value) => Math.min(125, Math.max(75, value + delta)));
  };
  const selectAdjacentScene = (direction: -1 | 1) => {
    const candidates = visibleScenes.length ? visibleScenes : scenes;
    const currentIndex = candidates.findIndex((item) => item.id === scene.id);
    const nextScene = candidates[currentIndex + direction];
    if (!nextScene) return;
    setSelectedId(nextScene.id);
    setSelectedSceneIds([nextScene.id]);
    setSelectedPopupId("");
    setSelectedTextOverlayId("");
    setPlayTime(nextScene.start);
    setPlaying(false);
  };
  const popupNarration = activePopup?.narration ?? "";
  const popupWordCount = safeTrim(popupNarration).split(/\s+/).filter(Boolean).length;
  const popupVoiceEstimate = Math.max(1, Math.ceil((popupWordCount / 145) * 60));
  const assetPreviewSource = (value: string) => {
    const trimmed = safeTrim(value);
    if (!trimmed) return "";
    return isRemoteUrl(trimmed)
      ? trimmed
      : assetPreviewUrls[fileNameOnly(trimmed)] ?? "";
  };
  const activePopupMediaValue = activePopup
    ? safeTrim(activePopup.video) || safeTrim(activePopup.image)
    : "";
  const popupMediaIsVideo = isVideoMedia(activePopupMediaValue);
  const popupMediaPreviewSource = activePopupMediaValue && (popupMediaIsVideo || imageEnabled)
    ? assetPreviewSource(activePopupMediaValue)
    : "";
  const legacyBackgroundPreview = safeTrim(previewBackground) || safeTrim(background);
  const sceneBackgroundValue = String(scene.background ?? "").trim();
  const backgroundValue = sceneBackgroundValue || legacyBackgroundPreview;
  const backgroundPreviewSource = assetPreviewSource(backgroundValue);
  const backgroundIsVideo = isVideoMedia(backgroundValue);
  const backgroundVideoPreviewSource = backgroundIsVideo ? backgroundPreviewSource : "";
  const narrationPreviewSource =
    audioPreview[scene.id] || assetPreviewSource(scene.voiceFile);
  const musicPreviewSource =
    backgroundMusicPreview || assetPreviewSource(backgroundMusic);
  const sceneDuration = Math.max(0.1, scene.end - scene.start);
  const sceneLocalTime = Math.min(
    sceneDuration,
    Math.max(0, playTime - scene.start),
  );
  useEffect(() => {
    const video = backgroundVideoRef.current;
    if (playing || !video || !backgroundVideoPreviewSource) return;
    if (Number.isFinite(video.duration)) video.currentTime = sceneLocalTime;
    video.pause();
  }, [backgroundVideoPreviewSource, playing, scene.id, sceneLocalTime]);
  useEffect(() => {
    const video = backgroundVideoRef.current;
    if (!playing || !video || !backgroundVideoPreviewSource) return;
    void video.play().catch(() => {
      // Trình duyệt có thể chặn autoplay; video vẫn có thể được xem khi bật phát thử.
    });
  }, [backgroundVideoPreviewSource, playing, scene.id]);
  const sceneProgress = sceneDuration > 0
    ? Math.min(1, Math.max(0, sceneLocalTime / sceneDuration))
    : 0;
  const timelineProgress = projectDuration > 0
    ? Math.min(1, Math.max(0, playTime / projectDuration))
    : 0;
  const sceneIsVisibleInPlayback = !playing || visibleScenes.some((item) =>
    item.id === scene.id && playTime >= item.start && playTime < item.end,
  );
  const popupHasMediaInput = (popup: PopupConfig) =>
    (imageEnabled && popup.imageVisible !== false && Boolean(safeTrim(popup.image)))
    || Boolean(safeTrim(popup.video));
  const popupHasContent = (popup: PopupConfig) => {
    const hasText = Boolean(safeTrim(popup.title) || safeTrim(popup.body));
    const hasMedia = popupHasMediaInput(popup);
    const layout = popup.layout ?? "image-top";
    return layout === "image-only"
      ? hasMedia
      : layout === "content-only"
        ? hasText
        : hasText || hasMedia;
  };
  const previewPopupItems = sceneIsVisibleInPlayback
    ? playing
      ? scenePopups.filter((popup) => {
          const timingStart = Math.min(sceneDuration, Math.max(0, Number(popup.start) || 0));
          const timingEnd = Math.min(sceneDuration, timingStart + Math.max(0.1, Number(popup.duration) || 0.1));
          return popup.visible !== false
            && popupHasContent(popup)
            && sceneLocalTime >= timingStart
            && sceneLocalTime <= timingEnd;
        })
      : scenePopups.filter((popup) => popup.visible !== false && popupHasContent(popup))
    : [];
  const decorationHasContent = (decoration: MapDecoration) =>
    decoration.type === "text-3d"
      ? Boolean(safeTrim(decoration.text))
      : decoration.type === "animated-sticker"
        ? Boolean(safeTrim(decoration.asset))
      : decoration.type === "sticker"
        ? Boolean(safeTrim(decoration.asset))
        : Boolean(safeTrim(decoration.symbol) || decoration.effect);
  const previewDecorationItems = sceneIsVisibleInPlayback
    ? playing
      ? sceneDecorations.filter((decoration) => {
          const start = Math.min(sceneDuration, Math.max(0, Number(decoration.start) || 0));
          const end = Math.min(sceneDuration, start + Math.max(0.1, Number(decoration.duration) || 0.1));
          return decoration.visible !== false
            && decorationHasContent(decoration)
            && sceneLocalTime >= start
            && sceneLocalTime <= end;
        })
      : sceneDecorations.filter((decoration) => decoration.visible !== false && decorationHasContent(decoration))
    : [];
  const previewSceneImageItems = sceneIsVisibleInPlayback
    ? playing
      ? sceneImages.filter((image) => {
          const start = Math.min(sceneDuration, Math.max(0, Number(image.start) || 0));
          const end = Math.min(sceneDuration, start + Math.max(0.1, Number(image.duration) || 0.1));
          return image.visible !== false
            && Boolean(safeTrim(image.url))
            && sceneLocalTime >= start
            && sceneLocalTime <= end;
        })
      : sceneImages.filter((image) => image.visible !== false && Boolean(safeTrim(image.url)))
    : [];
  const activeSubtitle = sceneIsVisibleInPlayback && scene.subtitleEnabled !== false
    ? (scene.subtitles ?? []).find((subtitle) => {
        const start = Math.min(sceneDuration, Math.max(0, Number(subtitle.start) || 0));
        const end = Math.min(
          sceneDuration,
          Math.max(start + 0.1, Number(subtitle.end) || start + 0.1),
        );
        return subtitle.visible !== false
          && safeTrim(subtitle.text)
          && sceneLocalTime >= start
          && sceneLocalTime < end;
      })
    : null;
  const subtitleStyle = normalizeSubtitleStyle(scene.subtitleStyle);
  const subtitleAnimationProgress = activeSubtitle
    ? Math.min(
        1,
        Math.max(
          0,
          (sceneLocalTime - Number(activeSubtitle.start || 0))
            / Math.max(0.05, subtitleStyle.animationDuration),
        ),
      )
    : 1;
  const subtitleAnimationScale = subtitleStyle.animation === "pop"
    ? 0.92 + subtitleAnimationProgress * 0.08
    : 1;
  const subtitleAnimationOffset = subtitleStyle.animation === "slide-up"
    ? (1 - subtitleAnimationProgress) * 3
    : 0;
  const subtitleAnimationOpacity = subtitleStyle.animation === "fade"
    ? subtitleAnimationProgress
    : 1;
  const subtitleAnimationClipPath = subtitleStyle.animation === "typewriter"
    ? `inset(0 ${Math.max(0, 100 - subtitleAnimationProgress * 100)}% 0 0)`
    : "none";
  const decorationSymbol = (decoration: MapDecoration) => {
    if (decoration.type === "effect") {
      return {
        sparkles: "✦",
        ring: "◉",
        confetti: "✺",
        glow: "✧",
      }[decoration.effect];
    }
    return decoration.symbol || "✦";
  };
  const decorationTextShadow = (decoration: MapDecoration) => Array.from(
    { length: Math.max(0, Math.round(decoration.depth)) },
    (_, index) => `${(index + 1) * 1.2}px ${(index + 1) * 1.2}px 0 ${decoration.accentColor}`,
  ).join(", ");
  const zoomEnabled = scene.zoomEnabled !== false;
  const zoomStartTime = Math.min(
    sceneDuration,
    Math.max(0, Number(scene.zoomStart ?? 0)),
  );
  const zoomInDuration = Math.max(0.1, Number(scene.zoomInDuration ?? 0.8) || 0.8);
  const zoomInEndTime = Math.min(
    sceneDuration,
    zoomStartTime + zoomInDuration,
  );
  const zoomEndTime = Math.min(
    sceneDuration,
    Math.max(
      zoomInEndTime,
      Number.isFinite(Number(scene.zoomEnd)) ? Number(scene.zoomEnd) : sceneDuration,
    ),
  );
  const zoomOutDuration = Math.max(0, Number(scene.zoomOutDuration ?? 0.8) || 0);
  const playbackMapScale = (() => {
    if (!zoomEnabled) return 1;
    if (sceneLocalTime < zoomStartTime) return 1;
    if (sceneLocalTime < zoomInEndTime) {
      const progress = (sceneLocalTime - zoomStartTime) / zoomInDuration;
      return 1 + (scene.zoom - 1) * progress;
    }
    const zoomOutStart = Math.max(
      zoomInEndTime,
      zoomEndTime - zoomOutDuration,
    );
    if (zoomOutDuration > 0 && sceneLocalTime < zoomEndTime && sceneLocalTime >= zoomOutStart) {
      const progress = Math.min(
        1,
        (sceneLocalTime - zoomOutStart) / Math.max(0.1, zoomEndTime - zoomOutStart),
      );
      return scene.zoom - (scene.zoom - 1) * progress;
    }
    return sceneLocalTime < zoomEndTime ? scene.zoom : 1;
  })();

  const currentProject = useMemo<ProjectSnapshot>(
    () => ({
      id: projectId,
      title: projectTitle,
      projectDuration,
      timelineHeight,
      rulerEnabled,
      rulerStyle,
      aspectRatio,
      renderResolution,
      imageEnabled,
      narrationEnabled,
      renderFps,
      background,
      previewBackground,
      backgroundVisible,
      backgroundMusic,
      backgroundMusicVolume,
      editorSections,
      scenes,
    }),
    [
      projectId,
      projectTitle,
      projectDuration,
      timelineHeight,
      rulerEnabled,
      rulerStyle,
      aspectRatio,
      renderResolution,
      imageEnabled,
      narrationEnabled,
      renderFps,
      background,
      previewBackground,
      backgroundVisible,
      backgroundMusic,
      backgroundMusicVolume,
      editorSections,
      scenes,
    ],
  );

  const storedProject = useMemo<StoredWorkspace>(() => ({
    version: 2,
    activeProjectId: projectId,
    projects: [...projects.filter((item) => item.id !== projectId), currentProject],
  }), [projects, projectId, currentProject]);

  const projectItems = useMemo(
    () => [...projects.filter((item) => item.id !== projectId), currentProject],
    [projects, projectId, currentProject],
  );

  const openProject = (project: ProjectSnapshot, preserveHistory = false) => {
    setProjectId(project.id);
    setProjectTitle(project.title);
    setProjectDuration(project.projectDuration);
    setTimelineHeight(normalizeTimelineHeight(project.timelineHeight));
    setRulerEnabled(project.rulerEnabled === true);
    setRulerStyle(normalizeRulerStyle(project.rulerStyle));
    setAlignmentGuides(EMPTY_ALIGNMENT_GUIDES);
    const nextAspectRatio = normalizeAspectRatio(project.aspectRatio);
    setAspectRatio(nextAspectRatio);
    setRenderResolution(normalizeRenderResolution(project.renderResolution, nextAspectRatio));
    setImageEnabled(project.imageEnabled);
    setNarrationEnabled(project.narrationEnabled);
    setRenderFps(project.renderFps ?? 30);
    setBackground(project.background ?? "");
    setPreviewBackground(project.previewBackground ?? "");
    setBackgroundVisible(project.backgroundVisible ?? true);
    setBackgroundMusic(project.backgroundMusic ?? "");
    setBackgroundMusicVolume(clampVolume(project.backgroundMusicVolume, 18));
    setBackgroundMusicPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
    const normalizedScenes = ensureUniqueSceneIds(project.scenes);
    const restoredScenes = (normalizedScenes.length ? normalizedScenes : ensureUniqueSceneIds(initialScenes)).map((item) => ({
      ...item,
      backgroundVisible: item.backgroundVisible ?? project.backgroundVisible ?? true,
    }));
    setEditorSections(normalizeEditorSections(project.editorSections));
    setScenes(restoredScenes);
    setSelectedId(restoredScenes[0]?.id ?? "");
    setSelectedPopupId("");
    setSelectedTextOverlayId("");
    setSelectedSceneIds(restoredScenes[0] ? [restoredScenes[0].id] : []);
    setPlayTime(restoredScenes[0]?.start ?? 0);
    setPlaying(false);
    if (!preserveHistory) {
      historyPast.current = [];
      historyFuture.current = [];
      historySnapshot.current = "";
      setHistoryVersion((version) => version + 1);
    }
  };

  const applyStoredProject = (
    data: Partial<StoredWorkspace> | Partial<StoredProject> | null,
  ) => {
    if (!data) return false;
    if (data.version === 2 && Array.isArray(data.projects) && data.projects.length > 0) {
      const restoredProjects = (data.projects as ProjectSnapshot[]).map((project) => ({
        ...project,
        timelineHeight: normalizeTimelineHeight(project.timelineHeight),
        rulerEnabled: project.rulerEnabled === true,
        rulerStyle: normalizeRulerStyle(project.rulerStyle),
        aspectRatio: normalizeAspectRatio(project.aspectRatio),
        renderResolution: normalizeRenderResolution(
          project.renderResolution,
          normalizeAspectRatio(project.aspectRatio),
        ),
        editorSections: normalizeEditorSections(project.editorSections),
        scenes: ensureUniqueSceneIds(project.scenes),
      }));
      setProjects(restoredProjects);
      openProject(
        restoredProjects.find((item) => item.id === data.activeProjectId) ??
          restoredProjects[0],
      );
      return true;
    }
    if (Array.isArray(data.scenes) && data.scenes.length > 0) {
      const migrated: ProjectSnapshot = {
        id: "google-sheet-project",
        title: "Dự án mới",
        projectDuration: Math.max(1, Number(data.projectDuration) || 30),
        timelineHeight: normalizeTimelineHeight(data.timelineHeight),
        rulerEnabled: data.rulerEnabled === true,
        rulerStyle: normalizeRulerStyle(data.rulerStyle),
        aspectRatio: normalizeAspectRatio(data.aspectRatio),
        renderResolution: normalizeRenderResolution(
          data.renderResolution,
          normalizeAspectRatio(data.aspectRatio),
        ),
        imageEnabled: data.imageEnabled ?? true,
        narrationEnabled: data.narrationEnabled ?? true,
        renderFps: data.renderFps ?? 30,
        background: data.background ?? "",
        previewBackground: data.previewBackground ?? "",
        backgroundVisible: data.backgroundVisible ?? true,
        backgroundMusic: data.backgroundMusic ?? "",
        editorSections: normalizeEditorSections(data.editorSections),
        scenes: ensureUniqueSceneIds(data.scenes),
      };
      setProjects([migrated]);
      openProject(migrated);
    }
    return true;
  };

  const restorePreferredActiveProject = (data: unknown) => {
    if (!isRecord(data) || data.version !== 2 || !Array.isArray(data.projects)) return;
    const preferredId = window.localStorage.getItem(LOCAL_ACTIVE_PROJECT_KEY);
    if (!preferredId) return;
    const preferred = (data.projects as ProjectSnapshot[]).find((item) => item.id === preferredId);
    if (preferred) openProject(preferred);
  };

  useEffect(() => {
    if (!googleAuthReady) return;
    let cancelled = false;

    const restoreProject = async () => {
      if (!googleUser) {
        setSaveStatus("error");
        setHydrated(true);
        return;
      }

      try {
        const firestoreData = await loadWorkspaceFromFirestore();
        if (cancelled) return;

        if (firestoreData && applyStoredProject(firestoreData)) {
          restorePreferredActiveProject(firestoreData);
          lastSavedProjectSnapshot.current = JSON.stringify(firestoreData);
          setSaveStatus("saved");
          setLastSavedAt(new Date());
        } else {
          setSaveStatus("error");
          setToast("Firestore chưa có workspace cho tài khoản này");
          window.setTimeout(() => setToast(""), 3600);
        }
      } catch (error) {
        if (cancelled) return;
        const reason = error instanceof Error
          ? error.message.replace(/\s+/g, " ").slice(0, 180)
          : "Không xác định được nguyên nhân";
        setSaveStatus("error");
        setToast(`Không tải được Firestore: ${reason}`);
        window.setTimeout(() => setToast(""), 3600);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };

    void restoreProject();
    return () => {
      cancelled = true;
    };
  }, [googleAuthReady, googleUser]);

  useEffect(() => {
    const nextUrls = Object.fromEntries(
      localRenderFiles.map((file) => [file.name, URL.createObjectURL(file)]),
    );
    setAssetPreviewUrls(nextUrls);
    return () => {
      Object.values(nextUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [localRenderFiles]);

  useEffect(() => {
    window.localStorage.setItem("kito-video-studio-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!previewFullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewFullscreen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewFullscreen]);

  useEffect(() => {
    if (!hydrated || saveStatus === "loading" || saveStatus === "saving") return;

    const currentSnapshot = JSON.stringify(storedProject);
    if (!lastSavedProjectSnapshot.current) {
      lastSavedProjectSnapshot.current = currentSnapshot;
      return;
    }

    if (currentSnapshot !== lastSavedProjectSnapshot.current) {
      setSaveStatus("unsaved");
    }
  }, [hydrated, saveStatus, storedProject]);

  useEffect(() => {
    if (!hydrated) return;
    const currentSnapshot = JSON.stringify(currentProject);
    if (!historySnapshot.current) {
      historySnapshot.current = currentSnapshot;
      return;
    }
    if (historySnapshot.current === currentSnapshot) return;
    if (!historyApplying.current) {
      try {
        historyPast.current.push(JSON.parse(historySnapshot.current) as ProjectSnapshot);
        if (historyPast.current.length > 50) historyPast.current.shift();
        historyFuture.current = [];
      } catch {
        historyPast.current = [];
        historyFuture.current = [];
      }
    }
    historySnapshot.current = currentSnapshot;
    historyApplying.current = false;
    setHistoryVersion((version) => version + 1);
  }, [hydrated, currentProject]);

  useEffect(() => {
    if (!hydrated) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (saveStatus !== "unsaved") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hydrated, saveStatus]);

  useEffect(() => {
    let cancelled = false;
    void readAssetLibrary()
      .then((items) => {
        if (!cancelled) {
          setAssetLibrary(items.sort((a, b) => a.name.localeCompare(b.name)));
          setLocalRenderFiles(items.map((item) => item.file));
        }
      })
      .catch(() => {
        // IndexedDB may be disabled in private browsing; file selection still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveProjectNow = async () => {
    if (!googleUser) {
      setSaveStatus("error");
      setToast("Hãy đăng nhập Google để lưu dữ liệu lên Firestore");
      window.setTimeout(() => setToast(""), 3200);
      return;
    }

    const currentSnapshot = JSON.stringify(storedProject);
    const savedAt = Date.now();
    window.localStorage.setItem(LOCAL_ACTIVE_PROJECT_KEY, projectId);
    window.localStorage.setItem(
      LOCAL_STORAGE_KEY,
      currentSnapshot,
    );
    window.localStorage.setItem(LOCAL_SAVED_AT_KEY, String(savedAt));
    setSaveStatus("saving");
    try {
      await saveWorkspaceToFirestore(storedProject);
      const now = new Date();
      lastSavedProjectSnapshot.current = currentSnapshot;
      setSaveStatus("saved");
      setLastSavedAt(now);
      setToast("Đã lưu dữ liệu lên Firestore");

    } catch (error) {
      setSaveStatus("error");
      const reason = error instanceof Error
        ? error.message.replace(/\s+/g, " ").slice(0, 180)
        : "Không xác định được nguyên nhân";
      setToast(`Firestore lỗi: ${reason}`);
    }
    window.setTimeout(() => setToast(""), 2800);
  };

  const restoreLastSavedProject = () => {
    if (!lastSavedProjectSnapshot.current) {
      setToast("Chưa có bản lưu gần nhất để khôi phục");
      window.setTimeout(() => setToast(""), 2600);
      return;
    }
    try {
      const restored = JSON.parse(lastSavedProjectSnapshot.current) as StoredWorkspace;
      if (!applyStoredProject(restored)) throw new Error("Bản lưu không hợp lệ");
      setSaveStatus("saved");
      setPlaying(false);
      setToast("Đã khôi phục bản lưu gần nhất");
    } catch {
      setToast("Không thể khôi phục bản lưu gần nhất");
    }
    window.setTimeout(() => setToast(""), 2600);
  };

  const undo = () => {
    const previous = historyPast.current.pop();
    if (!previous) return;
    try {
      historyFuture.current.push(JSON.parse(JSON.stringify(currentProject)) as ProjectSnapshot);
      historyApplying.current = true;
      openProject(previous, true);
      setHistoryVersion((version) => version + 1);
    } catch {
      historyApplying.current = false;
    }
  };

  const redo = () => {
    const next = historyFuture.current.pop();
    if (!next) return;
    try {
      historyPast.current.push(JSON.parse(JSON.stringify(currentProject)) as ProjectSnapshot);
      historyApplying.current = true;
      openProject(next, true);
      setHistoryVersion((version) => version + 1);
    } catch {
      historyApplying.current = false;
    }
  };

  useEffect(() => {
    if (!playing) {
      if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
      return;
    }

    const startedAt = performance.now() - playTime * 1000;
    const tick = () => {
      const nextTime = (performance.now() - startedAt) / 1000;
      if (nextTime >= projectDuration) {
        const firstScene = visibleScenes[0];
        setPlayTime(firstScene?.start ?? 0);
        setPlaying(false);
        if (firstScene) {
          setSelectedId(firstScene.id);
          setSelectedSceneIds([firstScene.id]);
        }
        return;
      }
      setPlayTime(nextTime);
      const activeScene = visibleScenes.find(
        (item) => nextTime >= item.start && nextTime < item.end,
      );
      if (activeScene) {
        setSelectedId(activeScene.id);
        setSelectedSceneIds((ids) =>
          ids.length === 1 && ids[0] === activeScene.id
            ? ids
            : [activeScene.id],
        );
      } else {
        setSelectedSceneIds((ids) => (ids.length === 0 ? ids : []));
      }
      animationFrame.current = requestAnimationFrame(tick);
    };
    animationFrame.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    };
  }, [playing, projectDuration, scenes, visibleScenes]);

  useEffect(() => {
    narrationAudio.current?.pause();
    narrationAudio.current = null;
    if (!playing || !narrationEnabled || !sceneIsVisibleInPlayback) return;
    const source = narrationPreviewSource;
    if (!source) return;
    const audio = new Audio(source);
    narrationAudio.current = audio;
    audio.volume = clampVolume(scene.voiceVolume, 95) / 100;
    const elapsed = Math.max(0, playTime - scene.start);
    const startAudio = () => {
      audio.currentTime = elapsed;
      void audio.play().catch(() => {
        // A local path that has not been uploaded is previewed silently.
      });
    };
    const timer = window.setTimeout(startAudio, 0);
    return () => {
      window.clearTimeout(timer);
      audio.pause();
      if (narrationAudio.current === audio) narrationAudio.current = null;
    };
  }, [playing, selectedId, narrationEnabled, narrationPreviewSource, scene.start, scene.voiceVolume, sceneIsVisibleInPlayback]);

  useEffect(() => {
    backgroundMusicAudio.current?.pause();
    backgroundMusicAudio.current = null;
    if (!playing || !safeTrim(backgroundMusic)) return;
    const source = musicPreviewSource;
    if (!source) return;
    const audio = new Audio(source);
    backgroundMusicAudio.current = audio;
    audio.loop = true;
    audio.volume = clampVolume(backgroundMusicVolume, 18) / 100;
    audio.currentTime = Math.max(0, playTime);
    void audio.play().catch(() => {
      // A local path that has not been uploaded is previewed silently.
    });
    return () => {
      audio.pause();
      if (backgroundMusicAudio.current === audio) backgroundMusicAudio.current = null;
    };
  }, [playing, backgroundMusic, musicPreviewSource, backgroundMusicVolume]);

  const selectScene = (item: Scene, additive = false) => {
    if (!additive) {
      setSelectedSceneIds([item.id]);
      setSelectedId(item.id);
      setSelectedPopupId("");
      setSelectedTextOverlayId("");
      setSelectedSceneImageId("");
      setPlayTime(item.start);
      return;
    }

    const nextIds = selectedSceneIds.includes(item.id)
      ? selectedSceneIds.length > 1
        ? selectedSceneIds.filter((id) => id !== item.id)
        : selectedSceneIds
      : [...selectedSceneIds, item.id];
    const primary =
      nextIds.includes(item.id)
        ? item
        : scenes.find((sceneItem) => sceneItem.id === nextIds.at(-1)) ?? item;
    setSelectedSceneIds(nextIds);
    setSelectedId(primary.id);
    setSelectedPopupId("");
    setSelectedTextOverlayId("");
    setSelectedSceneImageId("");
    setPlayTime(primary.start);
  };

  const openTimelineEditor = (
    item: Scene | null,
    targetId: "editor-popup" | "editor-audio" | "editor-music" | "editor-subtitle",
  ) => {
    if (item) {
      setSelectedId(item.id);
      setSelectedSceneIds([item.id]);
      setSelectedPopupId("");
      setSelectedTextOverlayId("");
      setSelectedSceneImageId("");
      setPlayTime(item.start);
    }
    setPlaying(false);
    window.setTimeout(() => {
      const target = document.getElementById(targetId);
      const group = target?.closest("details");
      if (group instanceof HTMLDetailsElement) group.open = true;
      target?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      target?.classList.add("timeline-focus");
      window.setTimeout(
        () => document.getElementById(targetId)?.classList.remove("timeline-focus"),
        1300,
      );
    }, 40);
  };

  const togglePlayback = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (!visibleScenes.length) {
      setToast("Chưa có cảnh đang hiện để xem thử");
      window.setTimeout(() => setToast(""), 2600);
      return;
    }
    const resumeAt = playTime >= projectDuration ? 0 : playTime;
    const activeScene =
      visibleScenes.find((item) => resumeAt >= item.start && resumeAt < item.end) ??
      visibleScenes.find((item) => item.start >= resumeAt) ??
      visibleScenes[0];
    const startAt = activeScene?.start ?? resumeAt;
    setPlayTime(activeScene && !(resumeAt >= activeScene.start && resumeAt < activeScene.end)
      ? startAt
      : resumeAt);
    if (activeScene) setSelectedId(activeScene.id);
    setPlaying(true);
  };

  const seekTimeline = (seconds: number) => {
    setPlaying(false);
    setPlayTime((currentTime) => {
      const nextTime = Math.min(
        projectDuration,
        Math.max(0, Number((currentTime + seconds).toFixed(2))),
      );
      const activeScene =
        visibleScenes.find(
          (item) =>
            nextTime >= item.start &&
            (nextTime < item.end || nextTime === projectDuration),
        ) ?? visibleScenes.at(nextTime === projectDuration ? -1 : 0);
      if (activeScene) setSelectedId(activeScene.id);
      return nextTime;
    });
  };

  const startTimelineScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (playing) return;
    event.preventDefault();
    event.stopPropagation();
    const layer = event.currentTarget.closest(".timeline-playhead-layer");
    if (!(layer instanceof HTMLElement)) return;
    const bounds = layer.getBoundingClientRect();
    if (bounds.width <= 0) return;
    setPlaying(false);

    const updatePosition = (clientX: number) => {
      const progress = Math.min(
        1,
        Math.max(0, (clientX - bounds.left) / bounds.width),
      );
      const nextTime = Number((progress * projectDuration).toFixed(2));
      setPlayTime(nextTime);
      const activeScene =
        visibleScenes.find(
          (item) =>
            nextTime >= item.start &&
            (nextTime < item.end || nextTime === projectDuration),
        ) ?? visibleScenes.at(nextTime === projectDuration ? -1 : 0);
      if (activeScene) {
        setSelectedId(activeScene.id);
        setSelectedSceneIds([activeScene.id]);
      }
    };

    updatePosition(event.clientX);
    const move = (moveEvent: PointerEvent) => updatePosition(moveEvent.clientX);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.matches("input, textarea, select, [contenteditable='true']");
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (isTyping) return;
      if (event.key === " ") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekTimeline(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seekTimeline(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const reorderScenes = (targetId: string) => {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    setScenes((items) => {
      const fromIndex = items.findIndex((item) => item.id === draggedId);
      const toIndex = items.findIndex((item) => item.id === targetId);
      const reordered = [...items];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      return reflowSceneTimeline(reordered);
    });
    setDraggedId(null);
    setDragOverId(null);
  };

  const updateScene = <K extends keyof Scene>(key: K, value: Scene[K]) => {
    if (!hydrated) return;
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    setScenes((items) =>
      items.map((item) => (targetIds.has(item.id) ? { ...item, [key]: value } : item)),
    );
  };

  const updateSceneEffects = <K extends keyof SceneEffects>(key: K, value: SceneEffects[K]) => {
    if (!hydrated) return;
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    setScenes((items) => items.map((item) => targetIds.has(item.id)
      ? { ...item, effects: { ...item.effects, [key]: value } }
      : item));
  };

  const updatePopup = <K extends keyof PopupConfig>(
    key: K,
    value: PopupConfig[K],
    popupId = selectedPopupId,
  ) => {
    if (!hydrated) return;
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    const popupIndex = Math.max(
      0,
      scenePopups.findIndex((item) => item.id === popupId),
    );
    setScenes((items) => items.map((item) => {
      if (!targetIds.has(item.id)) return item;
      const popups = scenePopupList(item);
      const current = popups[popupIndex];
      if (!current) return item;
      const nextPopup = { ...current, [key]: value } as PopupConfig;
      const nextPopups = popups.map((popup, index) => index === popupIndex ? nextPopup : popup);
      return {
        ...item,
        popups: nextPopups,
        ...(popupIndex === 0 ? popupSceneFields(nextPopup) : {}),
      };
    }));
  };

  const updatePopupMedia = (value: string, popupId = selectedPopupId) => {
    if (!hydrated) return;
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    const popupIndex = Math.max(
      0,
      scenePopups.findIndex((item) => item.id === popupId),
    );
    const isVideo = isVideoMedia(value);
    setScenes((items) => items.map((item) => {
      if (!targetIds.has(item.id)) return item;
      const popups = scenePopupList(item);
      const current = popups[popupIndex];
      if (!current) return item;
      const nextPopup = {
        ...current,
        image: isVideo ? "" : value,
        video: isVideo ? value : "",
        transparentMedia: isTransparentMedia(value),
      };
      const nextPopups = popups.map((popup, index) => index === popupIndex ? nextPopup : popup);
      return {
        ...item,
        popups: nextPopups,
        ...(popupIndex === 0 ? popupSceneFields(nextPopup) : {}),
      };
    }));
  };

  const copyEditorSection = (section: EditorSectionKey) => {
    if (!scene) return;
    const data: EditorSectionClipboard = section === "visual"
      ? {
          section,
          background: String(scene.background ?? ""),
          backgroundVisible: scene.backgroundVisible !== false,
        }
      : section === "content"
        ? {
            section,
            duration: Math.max(0.1, scene.end - scene.start),
            sceneName: scene.sceneName ?? "",
          }
        : section === "audio"
          ? {
              section,
              narration: scene.narration ?? "",
              voice: scene.voice ?? "",
              voiceFile: scene.voiceFile ?? "",
              voiceVolume: clampVolume(scene.voiceVolume, 95),
              backgroundMusic,
              backgroundMusicVolume,
            }
          : section === "effects"
            ? {
                section,
                zoomEnabled: scene.zoomEnabled !== false,
                zoomStart: Number(scene.zoomStart ?? 0),
                zoomEnd: Number(scene.zoomEnd ?? scene.end - scene.start),
                zoomInDuration: Number(scene.zoomInDuration ?? 0.8),
                zoomOutDuration: Number(scene.zoomOutDuration ?? 0.8),
                zoom: Number(scene.zoom ?? 1.25),
                centerX: Number(scene.centerX ?? 50),
                centerY: Number(scene.centerY ?? 50),
                effects: { ...scene.effects },
              }
            : section === "popup"
              ? {
                  section,
                  popups: scenePopupList(scene).map((popup) => ({ ...popup })),
                }
              : section === "text"
                ? {
                    section,
                    textOverlays: sceneTextOverlays.map((overlay) => ({ ...overlay })),
                    mapDecorations: (scene.mapDecorations ?? []).map((decoration) => ({ ...decoration })),
                  }
                : {
                    section,
                    sceneImages: (scene.sceneImages ?? []).map((image) => ({ ...image })),
                  };
    setSectionClipboard((items) => ({ ...items, [section]: data }));
    setToast(`Đã sao chép thông số mục ${section}`);
    window.setTimeout(() => setToast(""), 2200);
  };

  const pasteEditorSection = (section: EditorSectionKey) => {
    const data = sectionClipboard[section];
    if (!data) {
      setToast("Chưa có thông số để dán ở mục này");
      window.setTimeout(() => setToast(""), 2200);
      return;
    }
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    const nextScenes = scenes.map((item) => {
      if (!targetIds.has(item.id)) return item;
      switch (data.section) {
        case "visual":
          return {
            ...item,
            background: data.background,
            backgroundVisible: data.backgroundVisible,
          };
        case "content":
          return {
            ...item,
            sceneName: data.sceneName,
            end: item.start + Math.max(0.1, data.duration),
          };
        case "audio":
          return {
            ...item,
            narration: data.narration,
            voice: data.voice,
            voiceFile: data.voiceFile,
            voiceVolume: data.voiceVolume,
          };
        case "effects":
          return {
            ...item,
            zoomEnabled: data.zoomEnabled,
            zoomStart: data.zoomStart,
            zoomEnd: data.zoomEnd,
            zoomInDuration: data.zoomInDuration,
            zoomOutDuration: data.zoomOutDuration,
            zoom: data.zoom,
            centerX: data.centerX,
            centerY: data.centerY,
            effects: { ...data.effects },
          };
        case "popup": {
          const popups = data.popups.map((popup, index) => ({
            ...popup,
            id: `${item.id}-popup-${String(index + 1).padStart(2, "0")}`,
          }));
          const firstPopup = popups[0] ?? defaultPopupConfig(`${item.id}-popup-1`);
          return {
            ...item,
            popups,
            ...popupSceneFields(firstPopup),
          };
        }
        case "text": {
          const textOverlays = data.textOverlays.map((overlay, index) => ({
            ...overlay,
            id: `${item.id}-text-${String(index + 1).padStart(2, "0")}`,
          }));
          const mapDecorations = data.mapDecorations.map((decoration, index) => ({
            ...decoration,
            id: `${item.id}-decoration-${String(index + 1).padStart(2, "0")}`,
          }));
          const firstTextOverlay = textOverlays[0] ?? defaultTextOverlay(`${item.id}-text-1`);
          return {
            ...item,
            textOverlays,
            mapDecorations,
            ...textOverlaySceneFields(firstTextOverlay),
          };
        }
        case "images": {
          const sceneImages = data.sceneImages.map((image, index) => ({
            ...image,
            id: `${item.id}-image-${String(index + 1).padStart(2, "0")}`,
          }));
          return { ...item, sceneImages };
        }
        default:
          return item;
      }
    });
    const reflowedScenes = data.section === "content"
      ? reflowSceneTimeline(nextScenes)
      : nextScenes;
    setScenes(reflowedScenes);
    if (data.section === "audio") {
      setBackgroundMusic(data.backgroundMusic);
      setBackgroundMusicVolume(data.backgroundMusicVolume);
      setBackgroundMusicPreview("");
    }
    if (data.section === "content") {
      setProjectDuration((duration) => Math.max(duration, reflowedScenes.at(-1)?.end ?? duration));
    }
    setToast(`Đã dán thông số mục ${section} vào ${targetIds.size} cảnh`);
    window.setTimeout(() => setToast(""), 2400);
  };

  const editorSectionActions = (section: EditorSectionKey) => (
    <span
      className="editor-section-actions"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="editor-section-action"
        title={`Sao chép thông số mục ${section}`}
        aria-label={`Sao chép thông số mục ${section}`}
        onClick={(event) => {
          event.preventDefault();
          copyEditorSection(section);
        }}
      >
        ⧉
      </button>
      <button
        type="button"
        className="editor-section-action"
        title={`Dán thông số mục ${section}`}
        aria-label={`Dán thông số mục ${section}`}
        disabled={!sectionClipboard[section]}
        onClick={(event) => {
          event.preventDefault();
          pasteEditorSection(section);
        }}
      >
        ⇩
      </button>
    </span>
  );

  const updateTextOverlay = <K extends keyof TextOverlay>(key: K, value: TextOverlay[K]) => {
    if (!hydrated || !activeTextOverlay) return;
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    const overlayIndex = Math.max(
      0,
      sceneTextOverlays.findIndex((item) => item.id === activeTextOverlay.id),
    );
    setScenes((items) => items.map((item) => {
      if (!targetIds.has(item.id)) return item;
      const overlays = item.textOverlays ?? [];
      const current = overlays[overlayIndex];
      if (!current) return item;
      const nextOverlay = { ...current, [key]: value } as TextOverlay;
      const nextOverlays = overlays.map((overlay, index) => index === overlayIndex ? nextOverlay : overlay);
      return {
        ...item,
        textOverlays: nextOverlays,
        ...(overlayIndex === 0 ? textOverlaySceneFields(nextOverlay) : {}),
      };
    }));
  };

  const textOverlayLabel = (overlay: TextOverlay, index: number) =>
    safeTrim(overlay.name) || `Chữ ${index + 1}`;

  const beginTextOverlayRename = (overlay: TextOverlay, index: number) => {
    setSelectedTextOverlayId(overlay.id);
    setRenamingTextOverlayId(overlay.id);
    setRenamingTextOverlayName(textOverlayLabel(overlay, index));
  };

  const finishTextOverlayRename = () => {
    if (!scene || !renamingTextOverlayId) return;
    const target = (scene.textOverlays ?? []).find((overlay) => overlay.id === renamingTextOverlayId);
    if (!target) return;
    const targetIndex = (scene.textOverlays ?? []).findIndex((overlay) => overlay.id === target.id);
    const nextName = safeTrim(renamingTextOverlayName) || textOverlayLabel(target, targetIndex);
    setScenes((items) => items.map((item) => item.id === scene.id
      ? {
          ...item,
          textOverlays: (item.textOverlays ?? []).map((overlay) => overlay.id === target.id
            ? { ...overlay, name: nextName }
            : overlay),
        }
      : item));
    setRenamingTextOverlayId("");
    setRenamingTextOverlayName("");
  };

  const cancelTextOverlayRename = () => {
    setRenamingTextOverlayId("");
    setRenamingTextOverlayName("");
  };

  const updateCurrentScene = <K extends keyof Scene>(key: K, value: Scene[K]) => {
    if (!hydrated) return;
    setScenes((items) =>
      items.map((item) => (item.id === selectedId ? { ...item, [key]: value } : item)),
    );
  };

  const toggleSceneVisibility = (sceneId: string) => {
    if (!hydrated) return;
    const target = scenes.find((item) => item.id === sceneId);
    if (!target) return;
    const willShow = target.sceneVisible === false;
    const selectedSourceScene = scenes.find((item) => item.id === selectedId);
    const selectedOffset = selectedSourceScene
      ? Math.max(0, Math.min(playTime - selectedSourceScene.start, selectedSourceScene.end - selectedSourceScene.start))
      : 0;
    const nextScenes = scenes.map((item) =>
      item.id === sceneId ? { ...item, sceneVisible: willShow } : item,
    );
    const nextVisibleScenes = reflowVisibleSceneTimeline(nextScenes);
    setScenes(nextScenes);

    const selectedVisibleScene = nextVisibleScenes.find((item) => item.id === selectedId);
    if (selectedVisibleScene) {
      setPlayTime(Number((selectedVisibleScene.start + selectedOffset).toFixed(2)));
      return;
    }

    if (!willShow && sceneId === selectedId) {
      const fallback = nextVisibleScenes[0];
      setPlaying(false);
      if (fallback) {
        setSelectedId(fallback.id);
        setSelectedSceneIds([fallback.id]);
        setPlayTime(fallback.start);
      } else {
        setSelectedSceneIds([sceneId]);
      }
    }
  };

  const updatePopupStart = (value: number) => {
    const duration = Math.max(0.1, scene.end - scene.start);
    const popupDuration = Math.min(
      Math.max(0.1, activePopup?.duration ?? 0.1),
      duration,
    );
    const nextStart = Math.min(
      Math.max(0, duration - popupDuration),
      Math.max(0, Number(value) || 0),
    );
    updatePopup("start", Number(nextStart.toFixed(2)));
  };

  const updatePopupDuration = (value: number) => {
    const duration = Math.max(0.1, scene.end - scene.start);
    const popupStart = Math.min(
      Math.max(0, Number(activePopup?.start ?? 0) || 0),
      Math.max(0, duration - 0.1),
    );
    const nextDuration = Math.min(
      Math.max(0.1, Number(value) || 0.1),
      Math.max(0.1, duration - popupStart),
    );
    updatePopup("duration", Number(nextDuration.toFixed(2)));
  };

  const updateZoomStart = (value: number) => {
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    setScenes((items) =>
      items.map((item) => {
        if (!targetIds.has(item.id)) return item;
        const duration = Math.max(0.1, item.end - item.start);
        const zoomEnd = Math.min(duration, Math.max(0, Number(item.zoomEnd ?? duration) || duration));
        const maxStart = Math.max(0, zoomEnd - Math.max(0.1, item.zoomInDuration));
        return {
          ...item,
          zoomStart: Number(Math.min(maxStart, Math.max(0, Number(value) || 0)).toFixed(2)),
        };
      }),
    );
  };

  const updateZoomEnd = (value: number) => {
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    setScenes((items) =>
      items.map((item) => {
        if (!targetIds.has(item.id)) return item;
        const duration = Math.max(0.1, item.end - item.start);
        const zoomStart = Math.min(duration, Math.max(0, Number(item.zoomStart) || 0));
        const zoomInDuration = Math.max(0.1, Number(item.zoomInDuration) || 0.1);
        const minimumEnd = Math.min(duration, zoomStart + zoomInDuration);
        const numericValue = Number(value);
        const requestedEnd = Number.isFinite(numericValue) ? numericValue : duration;
        return {
          ...item,
          zoomEnd: Number(Math.min(duration, Math.max(minimumEnd, requestedEnd)).toFixed(2)),
        };
      }),
    );
  };

  const updateZoomInDuration = (value: number) => {
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    setScenes((items) =>
      items.map((item) => {
        if (!targetIds.has(item.id)) return item;
        const duration = Math.max(0.1, item.end - item.start);
        const zoomInDuration = Math.max(0.1, Number(value) || 0.1);
        const zoomStart = Math.min(duration, Math.max(0, Number(item.zoomStart) || 0));
        const zoomEnd = Math.min(
          duration,
          Math.max(zoomStart + zoomInDuration, Number(item.zoomEnd ?? duration) || duration),
        );
        return {
          ...item,
          zoomInDuration: Number(zoomInDuration.toFixed(2)),
          zoomEnd: Number(zoomEnd.toFixed(2)),
        };
      }),
    );
  };

  const updateSelectedSceneDuration = (duration: number) => {
    const nextDuration = Math.max(0.1, Number(duration) || 0.1);
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    let cursor = 0;
    const nextItems = scenes.map((item) => {
      const itemDuration = targetIds.has(item.id)
        ? nextDuration
        : Math.max(0.1, item.end - item.start);
      const normalized = {
        ...item,
        start: Number(cursor.toFixed(2)),
        end: Number((cursor + itemDuration).toFixed(2)),
      };
      cursor += itemDuration;
      return normalized;
    });
    setScenes(nextItems);
    setProjectDuration((current) => Math.max(current, cursor));
  };

  const switchProject = (nextId: string) => {
    const nextLibrary = projectItems;
    setProjects(nextLibrary);
    const target = nextLibrary.find((item) => item.id === nextId);
    if (target) openProject(target);
  };

  const createProject = () => {
    const title = newProjectTitle.trim() || `Chủ đề ${projects.length + 2}`;
    const id = `project-${Date.now()}`;
    const blankScene: Scene = {
      ...createEmptyScene(`${id}-scene-01`),
      id: `${id}-scene-01`,
      number: 1,
    };
    const nextProject: ProjectSnapshot = {
      id,
      title,
      projectDuration: 15,
      aspectRatio: "9:16",
      renderResolution: "1080x1920",
      imageEnabled: true,
      narrationEnabled: true,
      renderFps: 30,
      background: "",
      previewBackground: "",
      backgroundVisible: true,
      backgroundMusic: "",
      backgroundMusicVolume: 18,
      editorSections: DEFAULT_EDITOR_SECTIONS,
      scenes: [blankScene],
    };
    setProjects((items) => [
      ...items.filter((item) => item.id !== projectId),
      currentProject,
      nextProject,
    ]);
    openProject(nextProject);
    setNewProjectTitle("");
    setShowNewProject(false);
    setToast(`Đã tạo chủ đề “${title}”`);
    window.setTimeout(() => setToast(""), 2600);
  };

  const duplicateProjectClip = (source: ProjectSnapshot) => {
    const copyId = `project-${Date.now().toString(36)}-copy`;
    const copied: ProjectSnapshot = {
      ...source,
      id: copyId,
      title: `${source.title || "Clip chưa đặt tên"} (bản sao)`,
      scenes: source.scenes.map((item, index) => ({
        ...item,
        id: `${copyId}-scene-${String(index + 1).padStart(2, "0")}`,
        sceneImages: (item.sceneImages ?? []).map((image, imageIndex) => ({
          ...image,
          id: `${copyId}-scene-${String(index + 1).padStart(2, "0")}-image-${imageIndex + 1}`,
        })),
      })),
    };
    setProjects((items) => [
      ...items.filter((item) => item.id !== projectId && item.id !== copied.id),
      currentProject,
      copied,
    ]);
    setToast(`Đã nhân bản clip “${copied.title}”`);
    window.setTimeout(() => setToast(""), 2400);
    return copied;
  };

  const renameProjectClip = (targetId: string, title: string) => {
    const nextTitle = title.trim() || "Clip chưa đặt tên";
    if (targetId === projectId) setProjectTitle(nextTitle);
    setProjects((items) => items.map((item) => (
      item.id === targetId ? { ...item, title: nextTitle } : item
    )));
    setToast(`Đã đổi tên clip “${nextTitle}”`);
    window.setTimeout(() => setToast(""), 2200);
  };

  const deleteProjectClip = (source: ProjectSnapshot) => {
    if (projectItems.length <= 1) {
      setToast("Dự án cần có ít nhất một clip");
      window.setTimeout(() => setToast(""), 2400);
      return null;
    }
    if (!window.confirm(`Xóa clip “${source.title || "Clip chưa đặt tên"}”?`)) return null;

    const remaining = projectItems.filter((item) => item.id !== source.id);
    const fallback = remaining[0];
    setProjects(remaining.filter((item) => item.id !== projectId));
    if (source.id === projectId && fallback) openProject(fallback);
    setToast(`Đã xóa clip “${source.title || "Clip chưa đặt tên"}”`);
    window.setTimeout(() => setToast(""), 2400);
    return fallback?.id ?? null;
  };

  const openSettingsScene = (project: ProjectSnapshot, selectedScene: Scene) => {
    if (project.id !== projectId) openProject(project);
    setSelectedId(selectedScene.id);
    setSelectedSceneIds([selectedScene.id]);
    setSelectedPopupId("");
    setSelectedTextOverlayId("");
    setPlayTime(selectedScene.start);
    setActiveStudioTab("compose");
  };

  const addScene = () => {
    const last = scenes.at(-1) ?? createEmptyScene();
    const number = scenes.length + 1;
    const next: Scene = {
      id: `scene-${Date.now().toString(36)}-${number}`,
      number,
      sceneName: `Cảnh ${number}`,
      title: "",
      location: "",
      reference: "",
      popup: "",
      narration: "",
      voice: "",
      image: "",
      background: "",
      backgroundVisible: true,
      start: last.end,
      end: last.end + 3,
      zoomStart: 0,
      zoomEnd: 3,
      zoomInDuration: 0.8,
      zoomOutDuration: 0.8,
      zoom: 1.25,
      centerX: 50,
      centerY: 50,
      zoomEnabled: true,
      overlayText: "",
      overlayTextSize: 24,
      overlayTextStyle: "normal",
      overlayTextColor: "#ffffff",
      overlayTextFont: "Arial",
      overlayTextStrokeWidth: 0,
      overlayTextStrokeColor: "#000000",
      overlayTextBorderWidth: 0,
      overlayTextBorderColor: "#ffffff",
      overlayTextX: 50,
      overlayTextY: 18,
      textOverlays: [],
      mapDecorations: [],
      sceneImages: [],
      subtitleEnabled: true,
      subtitleStyle: defaultSubtitleStyle(),
      subtitles: [],
      popupDuration: 2,
      popupStart: 0.5,
      voiceFile: "",
      voiceVolume: 95,
      sceneVisible: true,
      popupIn: "fade-slide-up",
      popupOut: "fade-slide-down",
      popupLayout: "image-top",
      popupTheme: "travel",
      popupTextEffect: "none",
      popupVideo: "",
      popupX: 5,
      popupY: 55,
      popupBorderWidth: 1,
      popups: [],
      status: "Nháp",
    };
    setScenes((items) => [...items, next]);
    setProjectDuration((duration) => Math.max(duration, next.end));
    setSelectedId(next.id);
    setSelectedSceneIds([next.id]);
    setSelectedPopupId("");
    setSelectedTextOverlayId("");
  };

  const duplicateScene = (source = scene) => {
    if (!source) return;
    const sourceIndex = scenes.findIndex((item) => item.id === source.id);
    const insertIndex = sourceIndex >= 0
      ? sourceIndex + 1
      : Math.max(0, scenes.findIndex((item) => item.id === selectedId) + 1);
    const copiedId = `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const copied: Scene = {
      ...source,
      id: copiedId,
      popups: scenePopupList(source).map((popup, index) => ({
        ...popup,
        id: `${copiedId}-popup-${index + 1}`,
      })),
      mapDecorations: (source.mapDecorations ?? []).map((decoration, index) => ({
        ...decoration,
        id: `${copiedId}-decoration-${index + 1}`,
      })),
      sceneImages: (source.sceneImages ?? []).map((image, index) => ({
        ...image,
        id: `${copiedId}-image-${index + 1}`,
      })),
      subtitles: (source.subtitles ?? []).map((subtitle, index) => ({
        ...subtitle,
        id: `${copiedId}-subtitle-${index + 1}`,
      })),
    };
    const nextScenes = [...scenes];
    nextScenes.splice(insertIndex, 0, copied);
    const reflowed = reflowSceneTimeline(nextScenes);
    setScenes(reflowed);
    setProjectDuration((duration) => Math.max(duration, reflowed.at(-1)?.end ?? duration));
    setSelectedId(copied.id);
    setSelectedSceneIds([copied.id]);
    setSelectedPopupId("");
    setSelectedTextOverlayId("");
    setPlayTime(copied.start);
    setToast("Đã nhân bản cảnh");
    window.setTimeout(() => setToast(""), 2200);
  };

  const addPopup = () => {
    if (!scene) return;
    const currentPopups = scenePopupList(scene);
    const nextPopup = defaultPopupConfig(
      `${scene.id}-popup-${currentPopups.length + 1}-${Date.now().toString(36)}`,
      {
        start: Math.min(
          Math.max(0, sceneDuration - 1.5),
          Math.max(0, (currentPopups.at(-1)?.start ?? 0.5) + (currentPopups.at(-1)?.duration ?? 2) + 0.2),
        ),
        duration: Math.min(2, sceneDuration),
        y: Math.min(75, 55 + currentPopups.length * 6),
      },
    );
    setScenes((items) => items.map((item) => item.id === scene.id
      ? { ...item, popups: [...scenePopupList(item), nextPopup] }
      : item));
    setSelectedPopupId(nextPopup.id);
    setEditorSections((items) => ({ ...items, popup: true }));
    setToast(`Đã thêm Popup ${currentPopups.length + 1}`);
    window.setTimeout(() => setToast(""), 2200);
  };

  const addTextOverlay = () => {
    if (!scene) return;
    const currentOverlays = scene.textOverlays ?? [];
    const nextOverlay = defaultTextOverlay(
      `${scene.id}-text-${currentOverlays.length + 1}-${Date.now().toString(36)}`,
      {
        name: `Chữ ${currentOverlays.length + 1}`,
        y: Math.min(82, 18 + currentOverlays.length * 8),
      },
    );
    setScenes((items) => items.map((item) => {
      if (item.id !== scene.id) return item;
      const nextOverlays = [...(item.textOverlays ?? []), nextOverlay];
      return {
        ...item,
        textOverlays: nextOverlays,
        ...(nextOverlays.length === 1 ? textOverlaySceneFields(nextOverlay) : {}),
      };
    }));
    setSelectedTextOverlayId(nextOverlay.id);
    setEditorSections((items) => ({ ...items, text: true }));
    setToast(`Đã thêm chữ ${currentOverlays.length + 1}`);
    window.setTimeout(() => setToast(""), 2200);
  };

  const addSubtitleCue = () => {
    if (!scene) return;
    const currentSubtitles = scene.subtitles ?? [];
    const lastSubtitle = currentSubtitles.at(-1);
    const start = Math.min(
      Math.max(0, sceneDuration - 0.1),
      lastSubtitle ? Math.max(0, Number(lastSubtitle.end) || 0) : 0,
    );
    const end = Math.min(sceneDuration, Math.max(start + 0.1, start + Math.min(3, sceneDuration)));
    const nextSubtitle = defaultSubtitleCue(
      `${scene.id}-subtitle-${currentSubtitles.length + 1}-${Date.now().toString(36)}`,
      { start: Number(start.toFixed(2)), end: Number(end.toFixed(2)) },
    );
    setScenes((items) => items.map((item) => item.id === scene.id
      ? { ...item, subtitleEnabled: true, subtitles: [...(item.subtitles ?? []), nextSubtitle] }
      : item));
    setEditorSections((items) => ({ ...items, audio: true }));
    setPlayTime(Number((scene.start + start).toFixed(2)));
    setPlaying(false);
    setToast(`Đã thêm phụ đề ${currentSubtitles.length + 1}`);
    window.setTimeout(() => setToast(""), 2200);
  };

  const updateSubtitleStyle = <K extends keyof SubtitleStyle>(
    key: K,
    value: SubtitleStyle[K],
  ) => {
    if (!hydrated || !scene) return;
    setScenes((items) => items.map((item) => item.id === scene.id
      ? {
          ...item,
          subtitleStyle: {
            ...normalizeSubtitleStyle(item.subtitleStyle),
            [key]: value,
          },
        }
      : item));
  };

  const generateSubtitlesFromNarration = async () => {
    if (!scene) return;
    const narration = String(scene.narration || "").trim();
    const selectedAudio = audioFiles[scene.id]
      ?? localRenderFiles.find((file) => fileNameOnly(file.name) === fileNameOnly(scene.voiceFile));
    if (!narration) {
      setToast("Hãy nhập Lời thuyết minh trước khi tạo phụ đề");
      window.setTimeout(() => setToast(""), 2600);
      return;
    }
    if (!selectedAudio && !isRemoteUrl(scene.voiceFile)) {
      setToast("Hãy chọn file audio cho cảnh trước khi tạo phụ đề");
      window.setTimeout(() => setToast(""), 2600);
      return;
    }
    const targetSceneId = scene.id;
    const targetDuration = Math.max(0.1, scene.end - scene.start);
    setSubtitleAlignState({ status: "running", sceneId: targetSceneId, message: "Đang nghe audio và tạo timestamp…" });
    try {
      const form = new FormData();
      form.append("text", narration);
      form.append("duration", String(targetDuration));
      if (selectedAudio) form.append("audio", selectedAudio, selectedAudio.name);
      else form.append("audioUrl", safeTrim(scene.voiceFile));
      const response = await fetch(`${LOCAL_RENDERER_URL}/api/align-subtitles`, {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Không thể tạo timestamp phụ đề");
      const generated = Array.isArray(result.cues) ? result.cues : [];
      if (!generated.length) throw new Error("Không nhận được cue phụ đề từ audio");
      const subtitles = generated.map((cue: Partial<SubtitleCue>, index: number) => normalizeSubtitleCue(
        {
          ...cue,
          id: `${targetSceneId}-subtitle-${index + 1}-${Date.now().toString(36)}`,
        },
        `${targetSceneId}-subtitle-${index + 1}`,
        targetDuration,
      ));
      setScenes((items) => items.map((item) => item.id === targetSceneId
        ? { ...item, subtitleEnabled: true, subtitles }
        : item));
      const engineMessage = result.engine === "whisper"
        ? "Whisper đã tạo timestamp"
        : "đã tạo timestamp theo nhịp nói dự phòng";
      const message = `Đã tạo ${subtitles.length} cue; ${engineMessage}. Hãy phát và rà soát lại.`;
      setSubtitleAlignState({ status: "success", sceneId: targetSceneId, message });
      setToast(message);
      window.setTimeout(() => setToast(""), 3600);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể tạo phụ đề";
      setSubtitleAlignState({ status: "error", sceneId: targetSceneId, message });
      setToast(message);
      window.setTimeout(() => setToast(""), 3600);
    }
  };

  const updateSubtitleCue = (subtitleId: string, patch: Partial<SubtitleCue>) => {
    if (!hydrated) return;
    setScenes((items) => items.map((item) => {
      if (item.id !== scene.id) return item;
      const duration = Math.max(0.1, item.end - item.start);
      const subtitles = (item.subtitles ?? []).map((subtitle) => {
        if (subtitle.id !== subtitleId) return subtitle;
        const next = { ...subtitle, ...patch };
        const start = Math.min(
          Math.max(0, duration - 0.1),
          Math.max(0, Number(next.start) || 0),
        );
        const end = Math.min(
          duration,
          Math.max(start + 0.1, Number(next.end) || start + 0.1),
        );
        return {
          ...next,
          text: String(next.text ?? ""),
          start: Number(start.toFixed(2)),
          end: Number(end.toFixed(2)),
        };
      });
      return { ...item, subtitles };
    }));
  };

  const deleteSubtitleCue = (subtitleId: string) => {
    if (!scene) return;
    const currentSubtitles = scene.subtitles ?? [];
    const subtitleIndex = currentSubtitles.findIndex((subtitle) => subtitle.id === subtitleId);
    if (subtitleIndex < 0) return;
    setScenes((items) => items.map((item) => item.id === scene.id
      ? { ...item, subtitles: (item.subtitles ?? []).filter((subtitle) => subtitle.id !== subtitleId) }
      : item));
    setToast(`Đã xóa phụ đề ${subtitleIndex + 1}`);
    window.setTimeout(() => setToast(""), 2200);
  };

  const deleteAllSubtitleCues = () => {
    if (!scene || !(scene.subtitles ?? []).length) return;
    const count = scene.subtitles?.length ?? 0;
    setScenes((items) => items.map((item) => item.id === scene.id
      ? { ...item, subtitles: [] }
      : item));
    setSubtitleAlignState((current) => current.sceneId === scene.id
      ? { status: "idle", sceneId: "", message: "" }
      : current);
    setToast(`Đã xóa ${count} phụ đề trong cảnh`);
    window.setTimeout(() => setToast(""), 2200);
  };

  const toggleSubtitleCueVisibility = (subtitleId: string) => {
    if (!scene) return;
    setScenes((items) => items.map((item) => item.id === scene.id
      ? {
          ...item,
          subtitles: (item.subtitles ?? []).map((subtitle) => subtitle.id === subtitleId
            ? { ...subtitle, visible: !subtitle.visible }
            : subtitle),
        }
      : item));
  };

  const mapDecorationTypeLabel = (type: MapDecorationType) => ({
    "animated-sticker": "GIF / WebM / APNG",
    "text-3d": "Chữ 3D",
    sticker: "Sticker",
    icon: "Icon",
    effect: "Hiệu ứng",
  }[type]);

  const addMapDecoration = (type: MapDecorationType) => {
    if (!scene) return;
    const currentDecorations = scene.mapDecorations ?? [];
    const nextDecoration = defaultMapDecoration(
      `${scene.id}-decoration-${currentDecorations.length + 1}-${Date.now().toString(36)}`,
      type,
      type === "sticker"
        ? { symbol: "⭐", y: 50 }
        : type === "icon"
          ? { symbol: "📍", y: 50 }
          : type === "effect"
            ? { symbol: "✦", y: 45 }
            : { text: "ĐIỂM ĐẾN", y: 30 },
    );
    setScenes((items) => items.map((item) => item.id === scene.id
      ? { ...item, mapDecorations: [...(item.mapDecorations ?? []), nextDecoration] }
      : item));
    setSelectedDecorationId(nextDecoration.id);
    setEditorSections((items) => ({ ...items, text: true }));
    setToast(`Đã thêm ${mapDecorationTypeLabel(type)}`);
    window.setTimeout(() => setToast(""), 2200);
  };

  const updateMapDecoration = <K extends keyof MapDecoration>(key: K, value: MapDecoration[K]) => {
    if (!hydrated || !activeDecoration) return;
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    const decorationIndex = Math.max(
      0,
      sceneDecorations.findIndex((item) => item.id === activeDecoration.id),
    );
    setScenes((items) => items.map((item) => {
      if (!targetIds.has(item.id)) return item;
      const decorations = item.mapDecorations ?? [];
      const current = decorations[decorationIndex];
      if (!current) return item;
      return {
        ...item,
        mapDecorations: decorations.map((decoration, index) => index === decorationIndex
          ? { ...decoration, [key]: value }
          : decoration),
      };
    }));
  };

  const mapDecorationLabel = (decoration: MapDecoration, index: number) =>
    safeTrim(decoration.name) || `${mapDecorationTypeLabel(decoration.type)} ${index + 1}`;

  const beginMapDecorationRename = (decoration: MapDecoration, index: number) => {
    setSelectedDecorationId(decoration.id);
    setRenamingDecorationId(decoration.id);
    setRenamingDecorationName(mapDecorationLabel(decoration, index));
  };

  const finishMapDecorationRename = () => {
    if (!scene || !renamingDecorationId) return;
    const target = (scene.mapDecorations ?? []).find((decoration) => decoration.id === renamingDecorationId);
    if (!target) return;
    const targetIndex = (scene.mapDecorations ?? []).findIndex((decoration) => decoration.id === target.id);
    const nextName = safeTrim(renamingDecorationName) || mapDecorationLabel(target, targetIndex);
    setScenes((items) => items.map((item) => item.id === scene.id
      ? {
          ...item,
          mapDecorations: (item.mapDecorations ?? []).map((decoration) => decoration.id === target.id
            ? { ...decoration, name: nextName }
            : decoration),
        }
      : item));
    setRenamingDecorationId("");
    setRenamingDecorationName("");
  };

  const cancelMapDecorationRename = () => {
    setRenamingDecorationId("");
    setRenamingDecorationName("");
  };

  const toggleMapDecorationVisibility = (decorationId: string) => {
    if (!scene) return;
    setScenes((items) => items.map((item) => item.id === scene.id
      ? {
          ...item,
          mapDecorations: (item.mapDecorations ?? []).map((decoration) => decoration.id === decorationId
            ? { ...decoration, visible: !decoration.visible }
            : decoration),
        }
      : item));
  };

  const deleteMapDecoration = (decorationId = activeDecoration?.id) => {
    if (!scene || !decorationId) return;
    const currentDecorations = scene.mapDecorations ?? [];
    const decorationIndex = currentDecorations.findIndex((decoration) => decoration.id === decorationId);
    if (decorationIndex < 0) return;
    if (!window.confirm(`Xóa ${mapDecorationTypeLabel(currentDecorations[decorationIndex].type)} ${decorationIndex + 1}?`)) return;
    const remaining = currentDecorations.filter((decoration) => decoration.id !== decorationId);
    setScenes((items) => items.map((item) => item.id === scene.id
      ? { ...item, mapDecorations: remaining }
      : item));
    setSelectedDecorationId(remaining[Math.min(decorationIndex, remaining.length - 1)]?.id ?? "");
    setToast(`Đã xóa ${mapDecorationTypeLabel(currentDecorations[decorationIndex].type)}`);
    window.setTimeout(() => setToast(""), 2200);
  };

  const sceneImageLabel = (image: SceneImage, index: number) =>
    safeTrim(image.name) || `${image.mediaType === "video" ? "Video" : "Hình ảnh"} ${index + 1}`;

  const beginSceneImageRename = (image: SceneImage, index: number) => {
    setSelectedSceneImageId(image.id);
    setRenamingSceneImageId(image.id);
    setRenamingSceneImageName(sceneImageLabel(image, index));
  };

  const finishSceneImageRename = () => {
    if (!scene || !renamingSceneImageId) return;
    const target = (scene.sceneImages ?? []).find((image) => image.id === renamingSceneImageId);
    if (!target) return;
    const targetIndex = (scene.sceneImages ?? []).findIndex((image) => image.id === target.id);
    const nextName = safeTrim(renamingSceneImageName) || sceneImageLabel(target, targetIndex);
    setScenes((items) => items.map((item) => item.id === scene.id
      ? {
          ...item,
          sceneImages: (item.sceneImages ?? []).map((image) => image.id === target.id
            ? { ...image, name: nextName }
            : image),
        }
      : item));
    setRenamingSceneImageId("");
    setRenamingSceneImageName("");
  };

  const cancelSceneImageRename = () => {
    setRenamingSceneImageId("");
    setRenamingSceneImageName("");
  };

  const addSceneImage = () => {
    if (!scene) return;
    const currentImages = scene.sceneImages ?? [];
    const nextImage = defaultSceneImage(
      `${scene.id}-image-${currentImages.length + 1}-${Date.now().toString(36)}`,
      {
        name: `Hình ảnh ${currentImages.length + 1}`,
        duration: Math.min(sceneDuration, 5),
        y: 50 + Math.min(18, currentImages.length * 5),
      },
    );
    setScenes((items) => items.map((item) => item.id === scene.id
      ? { ...item, sceneImages: [...(item.sceneImages ?? []), nextImage] }
      : item));
    setSelectedSceneImageId(nextImage.id);
    setEditorSections((items) => ({ ...items, images: true }));
  };

  const updateSceneImage = <K extends keyof SceneImage>(key: K, value: SceneImage[K]) => {
    if (!hydrated || !activeSceneImage || !scene) return;
    const imageIndex = sceneImages.findIndex((image) => image.id === activeSceneImage.id);
    if (imageIndex < 0) return;
    setScenes((items) => items.map((item) => item.id === scene.id
      ? {
          ...item,
          sceneImages: (item.sceneImages ?? []).map((image, index) => index === imageIndex
            ? { ...image, [key]: value }
            : image),
        }
      : item));
  };

  const updateSceneImageUrl = (url: string) => {
    const imageId = activeSceneImage?.id;
    if (imageId) {
      setSceneImageSpritePreviewUrls((items) => {
        if (!items[imageId]) return items;
        const next = { ...items };
        delete next[imageId];
        return next;
      });
    }
    updateSceneImage("url", url);
    updateSceneImage("mediaType", isVideoMedia(url) ? "video" : "image");
    updateSceneImage("transparent", isTransparentMedia(url));
  };

  const prepareSceneImageSprite = async (imageId: string, url: string) => {
    const sourceUrl = safeTrim(url);
    if (!scene || !imageId || !isRemoteUrl(sourceUrl) || isVideoMedia(sourceUrl)) return;
    try {
      const response = await fetch(`${LOCAL_RENDERER_URL}/api/process-sprite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return;
      if (!result?.processed || !result.assetUrl) return;
      setSceneImageSpritePreviewUrls((items) => ({ ...items, [imageId]: result.assetUrl }));
      setScenes((items) => items.map((item) => item.id === scene.id
        ? {
            ...item,
            sceneImages: (item.sceneImages ?? []).map((image) => image.id === imageId
              ? { ...image, transparent: true }
              : image),
          }
        : item));
    } catch {
      // The editor remains usable with the original URL when the local
      // renderer is not running; rendering will retry the conversion later.
    }
  };

  useEffect(() => {
    const imageId = activeSceneImage?.id;
    const imageUrl = activeSceneImage?.url;
    if (!hydrated || !imageId || !imageUrl) return;
    void prepareSceneImageSprite(imageId, imageUrl);
    // Process an existing URL when switching to an image layer. URL edits are
    // still handled explicitly on blur/Enter to avoid requests per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, activeSceneImage?.id]);

  const toggleSceneImageVisibility = (imageId: string) => {
    if (!scene) return;
    setScenes((items) => items.map((item) => item.id === scene.id
      ? {
          ...item,
          sceneImages: (item.sceneImages ?? []).map((image) => image.id === imageId
            ? { ...image, visible: !image.visible }
            : image),
        }
      : item));
  };

  const deleteSceneImage = (imageId = activeSceneImage?.id) => {
    if (!scene || !imageId) return;
    const currentImages = scene.sceneImages ?? [];
    const imageIndex = currentImages.findIndex((image) => image.id === imageId);
    if (imageIndex < 0) return;
    const remaining = currentImages.filter((image) => image.id !== imageId);
    setScenes((items) => items.map((item) => item.id === scene.id
      ? { ...item, sceneImages: remaining }
      : item));
    setSelectedSceneImageId(remaining[Math.min(imageIndex, remaining.length - 1)]?.id ?? "");
  };

  const duplicateSceneImage = (image = activeSceneImage) => {
    if (!scene || !image) return;
    const currentImages = scene.sceneImages ?? [];
    const imageIndex = currentImages.findIndex((item) => item.id === image.id);
    const copy = {
      ...image,
      id: `${scene.id}-image-${currentImages.length + 1}-${Date.now().toString(36)}`,
      name: `${sceneImageLabel(image, imageIndex)} (bản sao)`,
      x: clampPercent(image.x + 4, image.x),
      y: clampPercent(image.y + 4, image.y),
    };
    const nextImages = [...currentImages];
    nextImages.splice(imageIndex + 1, 0, copy);
    setScenes((items) => items.map((item) => item.id === scene.id
      ? { ...item, sceneImages: nextImages }
      : item));
    setSelectedSceneImageId(copy.id);
  };

  const startSceneImageDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    imageId = activeSceneImage?.id,
  ) => {
    if (playing || (event.target as HTMLElement).closest(".scene-image-resize-handle")) return;
    const imageIndex = sceneImages.findIndex((image) => image.id === imageId);
    const draggedImage = sceneImages[imageIndex];
    if (!draggedImage || !scene) return;
    event.preventDefault();
    event.stopPropagation();
    const preview = event.currentTarget.closest(".phone-preview");
    if (!(preview instanceof HTMLElement)) return;
    const bounds = preview.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const draggedElement = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const baseX = clampPercent(draggedImage.x, 50);
    const baseY = clampPercent(draggedImage.y, 50);
    const widthPercent = Number(draggedImage.width) || 42;
    const heightPercent = Number(draggedImage.height) || 28;
    setSelectedSceneImageId(draggedImage.id);
    setDraggingSceneImage(true);
    const updatePosition = (clientX: number, clientY: number) => {
      const position = snapDragPosition({
        preview,
        bounds,
        target: draggedElement,
        rawX: baseX + ((clientX - startX) / bounds.width) * 100,
        rawY: baseY + ((clientY - startY) / bounds.height) * 100,
        mode: "box",
        sizeX: widthPercent,
        sizeY: heightPercent,
      });
      setAlignmentGuides(position.guides);
      setScenes((items) => items.map((item) => item.id === scene.id
        ? {
            ...item,
            sceneImages: (item.sceneImages ?? []).map((image, index) => index === imageIndex
              ? { ...image, x: position.x, y: position.y }
              : image),
          }
        : item));
    };
    updatePosition(event.clientX, event.clientY);
    const move = (moveEvent: PointerEvent) => updatePosition(moveEvent.clientX, moveEvent.clientY);
    const stop = () => {
      setDraggingSceneImage(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const startSceneImageResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (playing || !scene || !activeSceneImage) return;
    event.preventDefault();
    event.stopPropagation();
    const preview = event.currentTarget.closest(".phone-preview");
    if (!(preview instanceof HTMLElement)) return;
    const bounds = preview.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = activeSceneImage.width;
    const startHeight = activeSceneImage.height;
    const imageIndex = sceneImages.findIndex((image) => image.id === activeSceneImage.id);
    setDraggingSceneImage(true);
    const move = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(96, Math.max(1, startWidth + ((moveEvent.clientX - startX) / bounds.width) * 100));
      const nextHeight = Math.min(96, Math.max(1, startHeight + ((moveEvent.clientY - startY) / bounds.height) * 100));
      setScenes((items) => items.map((item) => item.id === scene.id
        ? {
            ...item,
            sceneImages: (item.sceneImages ?? []).map((image, index) => index === imageIndex
              ? { ...image, width: Number(nextWidth.toFixed(1)), height: Number(nextHeight.toFixed(1)) }
              : image),
          }
        : item));
    };
    const stop = () => {
      setDraggingSceneImage(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const toggleTextOverlayVisibility = (overlayId: string) => {
    if (!scene) return;
    setScenes((items) => items.map((item) => {
      if (item.id !== scene.id) return item;
      const overlays = item.textOverlays ?? [];
      const nextOverlays = overlays.map((overlay) => overlay.id === overlayId
        ? { ...overlay, visible: !overlay.visible }
        : overlay);
      return { ...item, textOverlays: nextOverlays };
    }));
  };

  const deleteTextOverlay = (overlayId = activeTextOverlay?.id) => {
    if (!scene || !overlayId) return;
    const currentOverlays = scene.textOverlays ?? [];
    const overlayIndex = currentOverlays.findIndex((overlay) => overlay.id === overlayId);
    if (overlayIndex < 0) return;
    if (!window.confirm(`Xóa chữ ${overlayIndex + 1}?`)) return;
    const remaining = currentOverlays.filter((overlay) => overlay.id !== overlayId);
    const firstOverlay = remaining[0] ?? defaultTextOverlay(`${scene.id}-text-1`);
    setScenes((items) => items.map((item) => item.id === scene.id
      ? { ...item, textOverlays: remaining, ...textOverlaySceneFields(firstOverlay) }
      : item));
    setSelectedTextOverlayId(remaining[Math.min(overlayIndex, remaining.length - 1)]?.id ?? "");
    setToast(`Đã xóa chữ ${overlayIndex + 1}`);
    window.setTimeout(() => setToast(""), 2200);
  };

  const deletePopup = (popupId = activePopup?.id) => {
    if (!scene || !popupId) return;
    const currentPopups = scenePopupList(scene);
    const popupIndex = currentPopups.findIndex((popup) => popup.id === popupId);
    if (popupIndex < 0) return;
    const popupLabel = safeTrim(currentPopups[popupIndex].title) || `Popup ${popupIndex + 1}`;
    if (!window.confirm(`Xóa ${popupLabel}?`)) return;
    const remaining = currentPopups.filter((popup) => popup.id !== popupId);
    setScenes((items) => items.map((item) => {
      if (item.id !== scene.id) return item;
      const firstPopup = remaining[0] ?? defaultPopupConfig(`${item.id}-popup-1`);
      return {
        ...item,
        popups: remaining,
        ...popupSceneFields(firstPopup),
      };
    }));
    setSelectedPopupId(remaining[Math.min(popupIndex, remaining.length - 1)]?.id ?? "");
    setToast(`Đã xóa ${popupLabel}`);
    window.setTimeout(() => setToast(""), 2200);
  };

  const togglePopupVisibility = (popupId: string) => {
    if (!scene) return;
    setScenes((items) => items.map((item) => {
      if (item.id !== scene.id) return item;
      const popups = scenePopupList(item);
      const nextPopups = popups.map((popup) => popup.id === popupId
        ? { ...popup, visible: !popup.visible }
        : popup);
      const firstPopup = nextPopups[0] ?? defaultPopupConfig(`${item.id}-popup-1`);
      return {
        ...item,
        popups: nextPopups,
        ...popupSceneFields(firstPopup),
      };
    }));
  };

  const toggleRuler = () => {
    const next = !rulerEnabled;
    setRulerEnabled(next);
    if (!next) setAlignmentGuides(EMPTY_ALIGNMENT_GUIDES);
  };

  const togglePreviewFullscreen = () => setPreviewFullscreen((current) => !current);

  const copySelectedScene = () => {
    if (!scene) return;
    setClipboardScene({
      ...scene,
    });
    setToast("Đã sao chép cảnh");
    window.setTimeout(() => setToast(""), 2200);
  };

  const pasteScene = () => {
    if (!clipboardScene) return;
    duplicateScene(clipboardScene);
    setToast("Đã dán cảnh");
    window.setTimeout(() => setToast(""), 2200);
  };

  const deleteScene = () => {
    const idsToDelete = selectedSceneIds.length ? selectedSceneIds : [selectedId];
    if (scenes.length - idsToDelete.length < 1) {
      setToast("Mỗi clip cần có ít nhất một cảnh");
      window.setTimeout(() => setToast(""), 2400);
      return;
    }
    const countLabel = idsToDelete.length > 1 ? `${idsToDelete.length} cảnh` : `cảnh “${scene.sceneName}”`;
    if (!window.confirm(`Xóa ${countLabel}?`)) return;
    const removedIndex = Math.max(
      0,
      Math.min(
        scenes.length - 1,
        Math.min(...idsToDelete.map((id) => scenes.findIndex((item) => item.id === id))),
      ),
    );
    const remaining = reflowSceneTimeline(
      scenes.filter((item) => !idsToDelete.includes(item.id)),
    );
    const nextScene = remaining[Math.min(removedIndex, remaining.length - 1)];
    setScenes(remaining);
    setSelectedId(nextScene.id);
    setSelectedSceneIds([nextScene.id]);
    setPlayTime(nextScene.start);
    setToast(idsToDelete.length > 1 ? `Đã xóa ${idsToDelete.length} cảnh` : "Đã xóa cảnh");
    window.setTimeout(() => setToast(""), 2400);
  };

  const startPopupResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const preview = event.currentTarget.closest(".phone-preview");
    if (!(preview instanceof HTMLElement)) return;
    const bounds = preview.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = activePopup?.width ?? 90;
    const startHeight = activePopup?.height ?? 255;
    const maxPopupHeight = Math.min(440, bounds.height * 0.88);

    const resize = (moveEvent: PointerEvent) => {
      const width = Math.min(
        96,
        Math.max(55, startWidth + ((moveEvent.clientX - startX) / bounds.width) * 100),
      );
      const height = Math.min(
        maxPopupHeight,
        Math.max(170, startHeight + moveEvent.clientY - startY),
      );
      updatePopup("width", Math.round(width));
      updatePopup("height", Math.round(height));
    };
    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
  };

  const getAlignmentPoints = (
    preview: HTMLElement,
    bounds: DOMRect,
    target: HTMLElement,
    mode: SnapMode,
  ) => {
    const x = [50];
    const y = [50];
    if (mode === "box") {
      x.push(0, 100);
      y.push(0, 100);
    }
    const elements = preview.querySelectorAll<HTMLElement>(
      "[data-popup-id], .map-text-overlay, .map-decoration, .subtitle-overlay",
    );
    elements.forEach((element) => {
      if (element === target) return;
      const elementBounds = element.getBoundingClientRect();
      if (elementBounds.width <= 0 || elementBounds.height <= 0) return;
      const left = ((elementBounds.left - bounds.left) / bounds.width) * 100;
      const right = ((elementBounds.right - bounds.left) / bounds.width) * 100;
      const top = ((elementBounds.top - bounds.top) / bounds.height) * 100;
      const bottom = ((elementBounds.bottom - bounds.top) / bounds.height) * 100;
      x.push(left, (left + right) / 2, right);
      y.push(top, (top + bottom) / 2, bottom);
    });
    return {
      x: x.filter((value) => Number.isFinite(value)),
      y: y.filter((value) => Number.isFinite(value)),
    };
  };

  const snapAxis = (
    rawValue: number,
    sizePercent: number,
    points: number[],
    mode: SnapMode,
  ) => {
    const safeSize = mode === "box" ? Math.min(100, Math.max(0, sizePercent)) : 0;
    const anchors = mode === "box" ? [0, safeSize / 2, safeSize] : [0];
    let nearest: { value: number; offset: number; distance: number } | null = null;
    anchors.forEach((offset) => {
      const anchorValue = rawValue + offset;
      points.forEach((point) => {
        const distance = Math.abs(anchorValue - point);
        if (!nearest || distance < nearest.distance) {
          nearest = { value: point, offset, distance };
        }
      });
    });
    const maxValue = mode === "box" ? 100 - safeSize : 100;
    const clampedRawValue = Math.min(maxValue, Math.max(0, rawValue));
    if (!nearest || nearest.distance > ALIGNMENT_SNAP_THRESHOLD) {
      return { value: clampedRawValue, guide: null };
    }
    const snappedValue = Math.min(maxValue, Math.max(0, nearest.value - nearest.offset));
    return { value: snappedValue, guide: Math.min(100, Math.max(0, nearest.value)) };
  };

  const snapDragPosition = ({
    preview,
    bounds,
    target,
    rawX,
    rawY,
    mode,
    sizeX = 0,
    sizeY = 0,
  }: {
    preview: HTMLElement;
    bounds: DOMRect;
    target: HTMLElement;
    rawX: number;
    rawY: number;
    mode: SnapMode;
    sizeX?: number;
    sizeY?: number;
  }) => {
    const clampedRawX = Math.min(100, Math.max(0, rawX));
    const clampedRawY = Math.min(100, Math.max(0, rawY));
    if (!rulerEnabled) {
      return { x: clampedRawX, y: clampedRawY, guides: EMPTY_ALIGNMENT_GUIDES };
    }
    const points = getAlignmentPoints(preview, bounds, target, mode);
    const x = snapAxis(clampedRawX, sizeX, points.x, mode);
    const y = snapAxis(clampedRawY, sizeY, points.y, mode);
    return {
      x: Number(x.value.toFixed(1)),
      y: Number(y.value.toFixed(1)),
      guides: { vertical: x.guide, horizontal: y.guide },
    };
  };

  const startPopupDrag = (event: React.PointerEvent<HTMLElement>, popupId = activePopup?.id) => {
    if (playing || (event.target as HTMLElement).closest(".popup-resize-handle")) return;
    event.preventDefault();
    event.stopPropagation();
    const preview = event.currentTarget.closest(".phone-preview");
    if (!(preview instanceof HTMLElement)) return;
    const bounds = preview.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const draggedPopup = scenePopups.find((popup) => popup.id === popupId) ?? activePopup;
    if (!draggedPopup) return;
    const draggedPopupElement = popupId
      ? Array.from(preview.querySelectorAll<HTMLElement>("[data-popup-id]"))
        .find((element) => element.dataset.popupId === popupId)
      : null;
    const draggedElement = draggedPopupElement ?? event.currentTarget;
    const draggedPopupBounds = draggedElement.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const baseX = clampPercent(draggedPopup.x, 5);
    const baseY = clampPercent(draggedPopup.y, 55);
    const popupWidth = draggedPopupBounds.width || (bounds.width * Number(draggedPopup.width ?? 90)) / 100;
    const popupHeight = draggedPopupBounds.height || Number(draggedPopup.height ?? 255);
    const popupWidthPercent = (popupWidth / bounds.width) * 100;
    const popupHeightPercent = (popupHeight / bounds.height) * 100;
    const updatePosition = (clientX: number, clientY: number) => {
      const position = snapDragPosition({
        preview,
        bounds,
        target: draggedElement,
        rawX: baseX + ((clientX - startX) / bounds.width) * 100,
        rawY: baseY + ((clientY - startY) / bounds.height) * 100,
        mode: "box",
        sizeX: popupWidthPercent,
        sizeY: popupHeightPercent,
      });
      setAlignmentGuides(position.guides);
      updatePopup("x", position.x, popupId);
      updatePopup("y", position.y, popupId);
    };
    const move = (moveEvent: PointerEvent) => updatePosition(moveEvent.clientX, moveEvent.clientY);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const startMapPointDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const preview = event.currentTarget.closest(".phone-preview");
    if (!(preview instanceof HTMLElement)) return;
    const bounds = preview.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    setDraggingZoomCenter(true);

    const updatePosition = (clientX: number, clientY: number) => {
      const centerX = Math.min(100, Math.max(0, ((clientX - bounds.left) / bounds.width) * 100));
      const centerY = Math.min(100, Math.max(0, ((clientY - bounds.top) / bounds.height) * 100));
      setScenes((items) =>
        items.map((item) => item.id === selectedId
          ? {
              ...item,
              centerX: Number(centerX.toFixed(1)),
              centerY: Number(centerY.toFixed(1)),
            }
          : item),
      );
    };
    updatePosition(event.clientX, event.clientY);
    const move = (moveEvent: PointerEvent) => updatePosition(moveEvent.clientX, moveEvent.clientY);
    const stop = () => {
      setDraggingZoomCenter(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const startTextOverlayDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    overlayId = activeTextOverlay?.id,
  ) => {
    if (playing) return;
    const overlayIndex = sceneTextOverlays.findIndex((item) => item.id === overlayId);
    const draggedOverlay = sceneTextOverlays[overlayIndex];
    if (!draggedOverlay) return;
    event.preventDefault();
    event.stopPropagation();
    const preview = event.currentTarget.closest(".phone-preview");
    if (!(preview instanceof HTMLElement)) return;
    const bounds = preview.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const draggedElement = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const baseX = clampPercent(draggedOverlay.x, 50);
    const baseY = clampPercent(draggedOverlay.y, 18);
    setSelectedTextOverlayId(draggedOverlay.id);
    setDraggingTextOverlay(true);

    const updatePosition = (clientX: number, clientY: number) => {
      const position = snapDragPosition({
        preview,
        bounds,
        target: draggedElement,
        rawX: baseX + ((clientX - startX) / bounds.width) * 100,
        rawY: baseY + ((clientY - startY) / bounds.height) * 100,
        mode: "center",
      });
      setAlignmentGuides(position.guides);
      const nextX = position.x;
      const nextY = position.y;
      setScenes((items) => items.map((item) => {
        if (item.id !== selectedId) return item;
        const overlays = item.textOverlays ?? [];
        const nextOverlays = overlays.map((overlay, index) => index === overlayIndex
          ? { ...overlay, x: Number(nextX.toFixed(1)), y: Number(nextY.toFixed(1)) }
          : overlay);
        const nextOverlay = nextOverlays[overlayIndex];
        return {
          ...item,
          textOverlays: nextOverlays,
          ...(overlayIndex === 0 && nextOverlay ? textOverlaySceneFields(nextOverlay) : {}),
        };
      }));
    };
    updatePosition(event.clientX, event.clientY);
    const move = (moveEvent: PointerEvent) => updatePosition(moveEvent.clientX, moveEvent.clientY);
    const stop = () => {
      setDraggingTextOverlay(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const startSubtitleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (playing || !scene || !activeSubtitle) return;
    event.preventDefault();
    event.stopPropagation();
    const preview = event.currentTarget.closest(".phone-preview");
    if (!(preview instanceof HTMLElement)) return;
    const bounds = preview.getBoundingClientRect();
    const subtitleBounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const draggedElement = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const baseX = clampPercent(subtitleStyle.x, 50);
    const baseY = clampPercent(subtitleStyle.y, 83);
    const halfWidthPercent = (subtitleBounds.width / bounds.width) * 50;
    const halfHeightPercent = (subtitleBounds.height / bounds.height) * 50;
    const minX = Math.min(50, Math.max(0, halfWidthPercent));
    const maxX = Math.max(50, Math.min(100, 100 - halfWidthPercent));
    const minY = Math.min(50, Math.max(0, halfHeightPercent));
    const maxY = Math.max(50, Math.min(100, 100 - halfHeightPercent));
    setDraggingSubtitle(true);

    const updatePosition = (clientX: number, clientY: number) => {
      const position = snapDragPosition({
        preview,
        bounds,
        target: draggedElement,
        rawX: baseX + ((clientX - startX) / bounds.width) * 100,
        rawY: baseY + ((clientY - startY) / bounds.height) * 100,
        mode: "center",
      });
      setAlignmentGuides(position.guides);
      const nextX = Math.min(maxX, Math.max(minX, position.x));
      const nextY = Math.min(maxY, Math.max(minY, position.y));
      setScenes((items) => items.map((item) => item.id === selectedId
        ? {
            ...item,
            subtitleStyle: {
              ...normalizeSubtitleStyle(item.subtitleStyle),
              x: Number(nextX.toFixed(1)),
              y: Number(nextY.toFixed(1)),
            },
          }
        : item));
    };
    updatePosition(event.clientX, event.clientY);
    const move = (moveEvent: PointerEvent) => updatePosition(moveEvent.clientX, moveEvent.clientY);
    const stop = () => {
      setDraggingSubtitle(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const startMapDecorationDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    decorationId = activeDecoration?.id,
  ) => {
    if (playing) return;
    const decorationIndex = sceneDecorations.findIndex((item) => item.id === decorationId);
    const draggedDecoration = sceneDecorations[decorationIndex];
    if (!draggedDecoration) return;
    event.preventDefault();
    event.stopPropagation();
    const preview = event.currentTarget.closest(".phone-preview");
    if (!(preview instanceof HTMLElement)) return;
    const bounds = preview.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const draggedElement = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const baseX = clampPercent(draggedDecoration.x, 50);
    const baseY = clampPercent(draggedDecoration.y, 50);
    setSelectedDecorationId(draggedDecoration.id);
    setDraggingMapDecoration(true);
    const updatePosition = (clientX: number, clientY: number) => {
      const position = snapDragPosition({
        preview,
        bounds,
        target: draggedElement,
        rawX: baseX + ((clientX - startX) / bounds.width) * 100,
        rawY: baseY + ((clientY - startY) / bounds.height) * 100,
        mode: "center",
      });
      setAlignmentGuides(position.guides);
      const nextX = position.x;
      const nextY = position.y;
      setScenes((items) => items.map((item) => item.id === selectedId
        ? {
            ...item,
            mapDecorations: (item.mapDecorations ?? []).map((decoration, index) => index === decorationIndex
              ? { ...decoration, x: Number(nextX.toFixed(1)), y: Number(nextY.toFixed(1)) }
              : decoration),
          }
        : item));
    };
    updatePosition(event.clientX, event.clientY);
    const move = (moveEvent: PointerEvent) => updatePosition(moveEvent.clientX, moveEvent.clientY);
    const stop = () => {
      setDraggingMapDecoration(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const startTimelineResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = normalizeTimelineHeight(timelineHeight);
    const move = (moveEvent: PointerEvent) => {
      setTimelineHeight(normalizeTimelineHeight(startHeight + startY - moveEvent.clientY));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const startTimelinePopupDrag = (
    event: React.PointerEvent<HTMLElement>,
    sceneId: string,
    mode: "move" | "start" | "end",
    popupId: string,
  ) => {
    if (playing) return;
    if (mode !== "move") event.preventDefault();
    event.stopPropagation();
    const track = event.currentTarget.closest(".track-content");
    if (!(track instanceof HTMLElement)) return;
    const bounds = track.getBoundingClientRect();
    const originalScene = scenes.find((item) => item.id === sceneId);
    if (!originalScene || bounds.width <= 0) return;
    const originalPopups = scenePopupList(originalScene);
    const popupIndex = Math.max(0, originalPopups.findIndex((item) => item.id === popupId));
    const originalPopup = originalPopups[popupIndex];
    if (!originalPopup) return;
    const sceneDuration = Math.max(0.1, originalScene.end - originalScene.start);
    const originalStart = Math.min(
      Math.max(0, Number(originalPopup.start) || 0),
      sceneDuration,
    );
    const originalDuration = Math.min(
      Math.max(0.1, Number(originalPopup.duration) || 0.1),
      Math.max(0.1, sceneDuration - originalStart),
    );
    const originalEnd = originalStart + originalDuration;
    const startX = event.clientX;
    timelinePopupMoved.current = false;

    const move = (moveEvent: PointerEvent) => {
      const delta = ((moveEvent.clientX - startX) / bounds.width) * projectDuration;
      if (Math.abs(moveEvent.clientX - startX) > 4) timelinePopupMoved.current = true;
      setScenes((items) =>
        items.map((item) => {
          if (item.id !== sceneId) return item;
          let nextStart = originalStart;
          let nextEnd = originalEnd;
          if (mode === "move") {
            nextStart = Math.min(
              Math.max(0, originalStart + delta),
              Math.max(0, sceneDuration - originalDuration),
            );
            nextEnd = nextStart + originalDuration;
          } else if (mode === "start") {
            nextStart = Math.min(
              Math.max(0, originalStart + delta),
              Math.max(0, originalEnd - 0.1),
            );
          } else {
            nextEnd = Math.min(
              Math.max(originalStart + 0.1, originalEnd + delta),
              sceneDuration,
            );
          }
          const nextPopup = {
            ...scenePopupList(item)[popupIndex],
            start: Number(nextStart.toFixed(2)),
            duration: Number(Math.max(0.1, nextEnd - nextStart).toFixed(2)),
          };
          const nextPopups = scenePopupList(item).map((popup, index) => index === popupIndex ? nextPopup : popup);
          return {
            ...item,
            popups: nextPopups,
            ...(popupIndex === 0 ? popupSceneFields(nextPopup) : {}),
          };
        }),
      );
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const exportPayload = useMemo(
    () => {
      const renderBackground = safeTrim(previewBackground) || safeTrim(background);
      return {
        title: projectTitle,
        duration: renderDuration,
        aspectRatio,
        resolution: renderResolution,
        fps: renderFps,
        ...(renderBackground
          ? { background: assetReference(renderBackground) }
          : {}),
        ...(safeTrim(backgroundMusic)
          ? {
              backgroundMusic: safeTrim(backgroundMusic),
              backgroundMusicVolume: Math.round(clampVolume(backgroundMusicVolume, 18)),
            }
          : {}),
        scenes: scenes.map((item) => {
          const popups = scenePopupList(item);
          const firstPopup = popups[0] ?? popupConfigFromScene(item, `${item.id}-popup-1`);
          const image = imageEnabled ? assetReference(firstPopup.image) : "";
          const sceneBackground = assetReference(item.background ?? "");
          const voiceFile = narrationEnabled ? assetReference(item.voiceFile) : "";
          const popupPayloads = popups.map((popup) => ({
            id: popup.id,
            title: popup.title,
            body: popup.body,
            narration: popup.narration,
            start: popup.start,
            duration: popup.duration,
            imageVisible: imageEnabled && popup.imageVisible !== false,
            transparentMedia: popup.transparentMedia === true,
            ...(imageEnabled && safeTrim(popup.image) ? { image: assetReference(popup.image) } : {}),
            ...(safeTrim(popup.video) ? { video: assetReference(popup.video) } : {}),
            in: popup.in,
            out: popup.out,
            width: popup.width,
            height: popup.height,
            borderWidth: popup.borderWidth,
            layout: popup.layout,
            theme: popup.theme,
            textEffect: popup.textEffect,
            x: popup.x,
            y: popup.y,
            visible: popup.visible,
          }));
          return {
            milestone: item.number,
            sceneName: item.sceneName,
            title: firstPopup.title,
            location: item.location,
            start: item.start,
            end: item.end,
            zoomStart: item.zoomStart,
            zoomEnd: item.zoomEnd,
            zoomInDuration: item.zoomInDuration,
            zoomOutDuration: item.zoomOutDuration,
            zoom: item.zoom,
            centerX: item.centerX,
            centerY: item.centerY,
            zoomEnabled: item.zoomEnabled,
            effects: { ...normalizeSceneEffects(item.effects) },
            overlayText: item.overlayText,
            overlayTextSize: item.overlayTextSize,
            overlayTextStyle: item.overlayTextStyle,
            overlayTextColor: item.overlayTextColor,
            overlayTextFont: item.overlayTextFont,
            overlayTextStrokeWidth: item.overlayTextStrokeWidth,
            overlayTextStrokeColor: item.overlayTextStrokeColor,
            overlayTextBorderWidth: item.overlayTextBorderWidth,
            overlayTextBorderColor: item.overlayTextBorderColor,
            overlayTextX: item.overlayTextX,
            overlayTextY: item.overlayTextY,
            textOverlays: item.textOverlays.map((overlay) => ({ ...overlay })),
            mapDecorations: (item.mapDecorations ?? []).map((decoration) => ({
              ...decoration,
              ...(["sticker", "animated-sticker"].includes(decoration.type) && safeTrim(decoration.asset)
                ? { asset: assetReference(decoration.asset) }
                : {}),
             })),
             sceneImages: (item.sceneImages ?? []).map((image) => ({
              ...image,
              url: assetReference(image.url),
              transparent: image.transparent === true,
             })),
             subtitleEnabled: item.subtitleEnabled !== false,
             subtitleStyle: { ...normalizeSubtitleStyle(item.subtitleStyle) },
             subtitles: (item.subtitles ?? []).map((subtitle) => ({
              id: subtitle.id,
              text: subtitle.text,
              start: subtitle.start,
              end: subtitle.end,
              visible: subtitle.visible !== false,
            })),
            sceneVisible: item.sceneVisible !== false,
            popupDuration: firstPopup.duration,
            popupStart: firstPopup.start,
            body: firstPopup.body,
            imageVisible: imageEnabled,
            ...(sceneBackground ? { background: sceneBackground } : {}),
            backgroundVisible: item.backgroundVisible !== false,
            ...(image ? { image } : {}),
            narration: narrationEnabled ? item.narration : "",
            ...(voiceFile ? { voiceFile } : {}),
            voiceVolume: Math.round(clampVolume(item.voiceVolume, 95)),
            popupIn: firstPopup.in,
            popupOut: firstPopup.out,
            popupWidth: firstPopup.width,
            popupHeight: firstPopup.height,
            popupBorderWidth: firstPopup.borderWidth,
            popupLayout: firstPopup.layout,
            popupTheme: firstPopup.theme,
            popupTextEffect: firstPopup.textEffect,
            ...(safeTrim(firstPopup.video) ? { popupVideo: assetReference(firstPopup.video) } : {}),
            popupX: firstPopup.x,
            popupY: firstPopup.y,
            popupVisible: firstPopup.visible,
            popupTransparentMedia: firstPopup.transparentMedia === true,
            popups: popupPayloads,
          };
        }),
      };
    },
    [
      scenes,
      imageEnabled,
      narrationEnabled,
      projectDuration,
      renderDuration,
      aspectRatio,
      renderResolution,
      renderFps,
      projectTitle,
      background,
      previewBackground,
      backgroundMusic,
      backgroundMusicVolume,
    ],
  );

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectTitle
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "video-project"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("JSON hợp lệ · Đã tải xuống");
    window.setTimeout(() => setToast(""), 2600);
  };

  const requiredRenderFiles = useMemo(() => {
    const values = [
      "background" in exportPayload ? exportPayload.background : "",
      "backgroundMusic" in exportPayload ? exportPayload.backgroundMusic : "",
      ...exportPayload.scenes.flatMap((item) => [
        ...(item.sceneVisible === false ? [] : [
        item.background ?? "",
        item.image ?? "",
        item.popupVideo ?? "",
        item.voiceFile ?? "",
        ...(item.mapDecorations ?? []).map((decoration) => decoration.asset ?? ""),
        ...(item.sceneImages ?? []).map((image) => image.url ?? ""),
        ...(item.popups ?? []).flatMap((popup) => [popup.image, popup.video]),
        ]),
      ]),
    ];
    return [...new Set(values.filter((value) => value && !isRemoteUrl(value)).map(fileNameOnly))];
  }, [exportPayload]);

  const addAssetsToLibrary = async (files: File[]) => {
    if (!files.length) return;
    const nextFiles = [...new Map(files.map((file) => [getAssetId(file), file])).values()];
    setLocalRenderFiles((items) => {
      const merged = [...items, ...nextFiles];
      return [...new Map(merged.map((file) => [getAssetId(file), file])).values()];
    });
    setAssetLibrary((items) => {
      const incoming = nextFiles.map((file) => ({
        id: getAssetId(file),
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        file,
      }));
      return [...new Map([...items, ...incoming].map((item) => [item.id, item])).values()]
        .sort((a, b) => a.name.localeCompare(b.name));
    });
    try {
      await writeAssetLibrary(nextFiles);
    } catch {
      setToast("Đã chọn tài nguyên cho lần render này; chưa lưu được vào thư viện");
      window.setTimeout(() => setToast(""), 2800);
    }
  };

  const addAnimatedMapDecoration = (
    asset: Pick<AssetLibraryItem, "id" | "name" | "type" | "file">,
    position: { x: number; y: number } = { x: 50, y: 50 },
  ) => {
    if (!scene) return;
    const currentDecorations = scene.mapDecorations ?? [];
    const assetType = animatedAssetTypeFromValue(
      asset.name,
      String(asset.type ?? "").toLowerCase() === "video/webm" ? "webm" : "gif",
    );
    const nextDecoration = defaultMapDecoration(
      `${scene.id}-animated-${currentDecorations.length + 1}-${Date.now().toString(36)}`,
      "animated-sticker",
      {
        asset: asset.name,
        assetType,
        x: clampPercent(position.x, 50),
        y: clampPercent(position.y, 50),
        scale: 0.8,
        duration: Math.min(sceneDuration, 5),
        animation: "none",
      },
    );
    setLocalRenderFiles((files) => files.some((file) => getAssetId(file) === asset.id)
      ? files
      : [...files, asset.file]);
    setScenes((items) => items.map((item) => item.id === scene.id
      ? { ...item, mapDecorations: [...(item.mapDecorations ?? []), nextDecoration] }
      : item));
    setSelectedDecorationId(nextDecoration.id);
    setEditorSections((items) => ({ ...items, text: true }));
    setToast(`Đã thêm hiệu ứng ${asset.name}`);
    window.setTimeout(() => setToast(""), 2400);
  };

  const addAnimatedEffectFiles = async (files: File[]) => {
    const accepted = files.filter(isAnimatedEffectFile);
    if (!accepted.length) {
      setToast("Chỉ hỗ trợ file GIF, APNG hoặc WebM VP9 có alpha");
      window.setTimeout(() => setToast(""), 2800);
      return;
    }
    await addAssetsToLibrary(accepted);
    setToast(`Đã thêm ${accepted.length} hiệu ứng vào thư viện`);
    window.setTimeout(() => setToast(""), 2400);
  };

  const handleMapEffectDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setMapEffectDragActive(false);
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = {
      x: clampPercent(((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 100, 50),
      y: clampPercent(((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 100, 50),
    };
    const droppedFiles = Array.from(event.dataTransfer.files).filter(isAnimatedEffectFile);
    if (droppedFiles.length) {
      const file = droppedFiles[0];
      await addAssetsToLibrary(droppedFiles);
      addAnimatedMapDecoration({
        id: getAssetId(file),
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        file,
      }, position);
      return;
    }
    const libraryId = event.dataTransfer.getData("application/x-kito-effect");
    const libraryItem = animatedEffectAssets.find((item) => item.id === libraryId);
    if (libraryItem) addAnimatedMapDecoration(libraryItem, position);
  };

  const handleMapEffectDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes("Files") || event.dataTransfer.types.includes("application/x-kito-effect")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setMapEffectDragActive(true);
    }
  };

  const toggleAssetSelection = (item: AssetLibraryItem) => {
    setLocalRenderFiles((files) => files.some((file) => getAssetId(file) === item.id)
      ? files.filter((file) => getAssetId(file) !== item.id)
      : [...files, item.file]);
  };

  const removeAsset = async (item: AssetLibraryItem) => {
    setAssetLibrary((items) => items.filter((candidate) => candidate.id !== item.id));
    setLocalRenderFiles((files) => files.filter((file) => getAssetId(file) !== item.id));
    try {
      await removeAssetFromLibrary(item.id);
    } catch {
      // The in-memory selection is still removed if persistent storage is unavailable.
    }
  };

  const runRenderPreflight = async () => {
    const checks: PreflightCheck[] = [];
    const selectedFileNames = new Set(localRenderFiles.map((file) => file.name));
    if (!visibleScenes.length) {
      checks.push({
        id: "visible-scenes",
        label: "Cảnh đang hiện",
        status: "error",
        detail: "Táº¥t cáº£ cáº£nh Ä‘ang bá»‹ áº©n; hÃ£y hiá»‡n Ã­t nháº¥t má»™t cáº£nh Ä‘á»ƒ render.",
      });
    }
    const addSourceCheck = (
      id: string,
      label: string,
      value: unknown,
      required: boolean,
    ) => {
      const source = safeTrim(value);
      if (!source) {
        checks.push({
          id,
          label,
          status: required ? "error" : "warning",
          detail: required ? "Chưa chọn tài nguyên." : "Đang dùng giá trị mặc định hoặc bỏ qua.",
        });
        return;
      }
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
        try {
          const parsed = new URL(source);
          if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) throw new Error("URL không hợp lệ");
          checks.push({
            id,
            label,
            status: "ok",
            detail: "URL hợp lệ; dịch vụ render sẽ tải tài nguyên từ mạng.",
          });
        } catch {
          checks.push({ id, label, status: "error", detail: "URL không hợp lệ." });
        }
        return;
      }
      const fileName = fileNameOnly(source);
      if (selectedFileNames.has(fileName)) {
        checks.push({ id, label, status: "ok", detail: `Đã có ${fileName} trong thư viện.` });
      } else {
        checks.push({ id, label, status: "error", detail: `Thiếu file cục bộ “${fileName}”.` });
      }
    };

    const legacyBackground = safeTrim(previewBackground) || safeTrim(background);
    if (legacyBackground) {
      addSourceCheck(
        "legacy-background",
        "Background mặc định",
        legacyBackground,
        false,
      );
    }
    if (safeTrim(backgroundMusic)) {
      addSourceCheck("background-music", "Nhạc nền", backgroundMusic, true);
    } else {
      checks.push({ id: "background-music", label: "Nhạc nền", status: "warning", detail: "Không dùng nhạc nền." });
    }
    visibleScenes.forEach((item) => {
      addSourceCheck(
        `scene-${item.id}-background`,
        `Background cảnh ${item.number}`,
        item.background ?? "",
        false,
      );
      addSourceCheck(`scene-${item.id}-image`, `Ảnh cảnh ${item.number}`, imageEnabled ? item.image : "", imageEnabled);
      addSourceCheck(`scene-${item.id}-audio`, `Âm thanh cảnh ${item.number}`, narrationEnabled ? item.voiceFile : "", narrationEnabled);
      (item.mapDecorations ?? []).forEach((decoration, decorationIndex) => {
        if (decoration.visible === false || !safeTrim(decoration.asset)) return;
        addSourceCheck(
          `scene-${item.id}-decoration-${decorationIndex + 1}`,
          `${mapDecorationTypeLabel(decoration.type)} cảnh ${item.number}`,
          decoration.asset,
          true,
        );
      });
    });

    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 2500);
      const response = await fetch(`${LOCAL_RENDERER_URL}/api/health`, { signal: controller.signal });
      window.clearTimeout(timeout);
      const result = await response.json();
      if (!response.ok || !result.ready) throw new Error(result.message || "FFmpeg chưa sẵn sàng");
      checks.push({
        id: "ffmpeg",
        label: "FFmpeg cục bộ",
        status: "ok",
        detail: result.busy ? "Đã kết nối nhưng dịch vụ đang render một video khác." : "Dịch vụ đã sẵn sàng.",
      });
      setLocalRenderState((state) => ({
        ...state,
        status: "idle",
        message: result.busy ? "Dịch vụ đang render một video khác" : "Dịch vụ render đã sẵn sàng",
      }));
    } catch (error) {
      checks.push({
        id: "ffmpeg",
        label: "FFmpeg cục bộ",
        status: "error",
        detail: error instanceof Error && error.name === "AbortError"
          ? "Không phản hồi. Hãy chạy npm run render:local."
          : "FFmpeg chưa chạy hoặc chưa sẵn sàng.",
      });
      setLocalRenderState((state) => ({
        ...state,
        status: "failed",
        message: "FFmpeg chưa chạy hoặc chưa sẵn sàng",
      }));
    }
    setPreflightChecks(checks);
    return !checks.some((check) => check.status === "error");
  };

  const startLocalRender = async () => {
    const canRender = await runRenderPreflight();
    if (!canRender) {
      const shouldContinue = window.confirm("Chưa đủ tài nguyên, bạn có muốn tiếp tục ?");
      if (!shouldContinue) {
        setLocalRenderState((state) => ({ ...state, status: "failed", message: "Cần xử lý các mục kiểm tra trước khi render" }));
        return;
      }
    }
    setLocalRenderState({
      status: "uploading",
      progress: 2,
      message: "Đang gửi JSON và tài nguyên tới máy render…",
    });
    try {
      const form = new FormData();
      form.append("project", JSON.stringify(exportPayload));
      localRenderFiles.forEach((file) => form.append("media", file, file.name));
      const response = await fetch(`${LOCAL_RENDERER_URL}/api/render`, {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Không thể bắt đầu render");
      const jobId = String(result.jobId);
      localRenderJobId.current = jobId;
      for (;;) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const statusResponse = await fetch(`${LOCAL_RENDERER_URL}/api/render/${jobId}`);
        const status = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(status.error || "Không đọc được tiến độ render");
        if (status.status === "completed") {
          setLocalRenderState({
            status: "completed",
            progress: 100,
            message: "Render hoàn tất. Video đã sẵn sàng để tải xuống.",
            downloadUrl: `${LOCAL_RENDERER_URL}${status.downloadUrl}`,
          });
          localRenderJobId.current = "";
          return;
        }
        if (status.status === "cancelled") {
          localRenderJobId.current = "";
          setLocalRenderState({
            status: "idle",
            progress: 0,
            message: "Đã dừng render. Sẵn sàng render lại.",
          });
          return;
        }
        if (status.status === "failed") {
          localRenderJobId.current = "";
          throw Object.assign(new Error(status.message || "Render thất bại"), { log: status.log });
        }
        if (status.status === "cancelling") {
          setLocalRenderState({
            status: "cancelling",
            progress: Number(status.progress) || 0,
            message: status.message || "Đang dừng render…",
          });
          continue;
        }
        setLocalRenderState({
          status: "rendering",
          progress: Number(status.progress) || 5,
          message: status.message || "Đang render video…",
        });
      }
    } catch (error) {
      localRenderJobId.current = "";
      setLocalRenderState({
        status: "failed",
        progress: 0,
        message: error instanceof Error ? error.message : "Không thể render video",
        log: error && typeof error === "object" && "log" in error ? String(error.log || "") : "",
      });
    }
  };

  const stopLocalRender = async () => {
    const jobId = localRenderJobId.current;
    if (!jobId || !["rendering", "cancelling"].includes(localRenderState.status)) return;
    setLocalRenderState((state) => ({
      ...state,
      status: "cancelling",
      message: "Đang dừng render…",
    }));
    try {
      const response = await fetch(`${LOCAL_RENDERER_URL}/api/render/${jobId}/cancel`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Không thể dừng render");
    } catch (error) {
      setLocalRenderState((state) => ({
        ...state,
        status: "rendering",
        message: error instanceof Error ? error.message : "Không thể dừng render",
      }));
    }
  };

  const promptText = useMemo(() => {
    const projectBackground = "background" in exportPayload
      ? exportPayload.background
      : "Dùng background theo từng cảnh hoặc map.png mặc định";
    const musicFile = "backgroundMusic" in exportPayload
      ? fileNameOnly(exportPayload.backgroundMusic)
      : "Không có";
    const musicVolume = "backgroundMusicVolume" in exportPayload
      ? exportPayload.backgroundMusicVolume
      : 18;
    const scenePrompts = exportPayload.scenes.map((item, index) => {
      const nextStart = exportPayload.scenes[index + 1]?.start ?? projectDuration;
      const sceneDuration = Math.max(0, nextStart - item.start);
      return [
        `CẢNH ${item.milestone}: ${item.sceneName ?? item.title}`,
        `- Thời gian: ${item.start}s–${nextStart}s (thời lượng ${sceneDuration}s).`,
        `- Hình ảnh: ${item.image ?? "Không có"}${item.image ? ` (tên file: ${fileNameOnly(item.image)})` : ""}.`,
        `- Background cảnh: ${item.background ?? "map.png mặc định"}${item.background ? ` (tên file: ${fileNameOnly(item.background)})` : ""}.`,
        `- File thuyết minh: ${item.voiceFile ?? "Không có"}${item.voiceFile ? ` (tên file: ${fileNameOnly(item.voiceFile)})` : ""}, âm lượng ${item.voiceVolume}%.`,
        `- Lời thuyết minh: ${item.narration || "Không có"}.`,
        `- Phụ đề: ${item.subtitleEnabled !== false && item.subtitles?.length ? item.subtitles.filter((subtitle) => subtitle.visible !== false && safeTrim(subtitle.text)).map((subtitle) => `"${subtitle.text}" (${subtitle.start}s-${subtitle.end}s)`).join("; ") : "Không có"}.`,
        `- Nội dung popup: ${item.body || "Không có"}.`,
        `- Zoom bản đồ: ${item.zoomEnabled ? `bắt đầu sau ${item.zoomStart}s, đạt ${item.zoom}x trong ${item.zoomInDuration}s, kết thúc ở ${item.zoomEnd}s, zoom về trong ${item.zoomOutDuration}s, tâm X=${item.centerX}%, Y=${item.centerY}%` : "tắt"}.`,
        `- Popup: bắt đầu sau ${item.popupStart}s, hiển thị ${item.popupDuration}s, kích thước ${item.popupWidth}% × ${item.popupHeight}px, hiệu ứng mở "${item.popupIn}", hiệu ứng đóng "${item.popupOut}", trạng thái ${item.popupVisible ? "hiện" : "ẩn"}.`,
      ].join("\n");
    });

    return [
      "PROMPT TẠO VIDEO CHI TIẾT",
      "",
      `Tạo video tỷ lệ ${exportPayload.aspectRatio}, độ phân giải ${exportPayload.resolution}, tổng thời lượng ${exportPayload.duration} giây.`,
      `Chủ đề: ${exportPayload.title}.`,
      `Background chủ đề: ${projectBackground}${projectBackground !== "Không có" ? ` (tên file: ${fileNameOnly(projectBackground)})` : ""}.`,
      `Nhạc nền: ${musicFile}, âm lượng ${musicVolume}%.`,
      "Phong cách chuyển động điện ảnh, bố cục dễ đọc và giữ hình ảnh nhất quán giữa các cảnh.",
      "Không tự tạo thêm chữ trong hình nền. Đồng bộ popup và lời thuyết minh theo timeline dưới đây.",
      "",
      ...scenePrompts.flatMap((prompt) => [prompt, ""]),
      "YÊU CẦU KỸ THUẬT",
      `- Xuất video ${exportPayload.resolution}, tỷ lệ ${exportPayload.aspectRatio}, thời lượng chính xác ${exportPayload.duration} giây.`,
      "- Không cắt đột ngột file âm thanh; giảm âm lượng nhạc nền khi có thuyết minh.",
      "- Chỉ sử dụng đúng tên file hình ảnh và âm thanh được liệt kê trong từng cảnh.",
      "- Không để hiệu ứng popup vượt quá thời lượng cảnh.",
    ].join("\n");
  }, [exportPayload, projectDuration]);

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(promptText);
    setToast("Đã sao chép prompt");
    window.setTimeout(() => setToast(""), 2200);
  };

  const copyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2));
    setToast("Đã sao chép JSON dự án");
    window.setTimeout(() => setToast(""), 2200);
  };

  const focusJsonPreview = () => {
    setJsonPreviewCleared(false);
    document.getElementById("export-json-preview")?.focus();
  };

  const clearJsonPreview = () => {
    setJsonPreviewCleared(true);
    setToast("Đã xóa nội dung JSON đang hiển thị");
    window.setTimeout(() => setToast(""), 2200);
  };

  const downloadPrompt = () => {
    const blob = new Blob([promptText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectTitle
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "video-project"}-prompt.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportFileName = `${projectTitle
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "video-project"}.mp4`;
  const exportJsonText = JSON.stringify(exportPayload, null, 2);
  const missingRenderFiles = requiredRenderFiles.filter(
    (fileName) => !localRenderFiles.some((file) => file.name === fileName),
  );
  const renderStatusLabel = {
    idle: "Chưa render",
    checking: "Đang kiểm tra",
    uploading: "Đang tải tài nguyên",
    rendering: "Đang render",
    cancelling: "Đang dừng",
    completed: "Hoàn tất",
    failed: "Lỗi",
  }[localRenderState.status];
  const renderStatusTone = localRenderState.status === "completed"
    ? "done"
    : localRenderState.status === "failed"
      ? "error"
      : localRenderState.status === "idle"
        ? "idle"
        : "progress";

  return (
    <main
      className={`studio-shell ${previewFullscreen ? "preview-fullscreen" : ""}`}
      data-studio-tab={activeStudioTab}
      data-theme={theme}
      style={{ ["--timeline-height" as string]: `${timelineHeight}px` }}
    >
      <div className="studio-layout">
        <nav className="studio-rail" aria-label="Khu vực chức năng chính">
          <div className="rail-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <button
            type="button"
            className={`rail-item ${activeStudioTab === "compose" ? "active" : ""}`}
            onClick={() => setActiveStudioTab("compose")}
            aria-current={activeStudioTab === "compose" ? "page" : undefined}
          >
            <span className="rail-icon" aria-hidden="true">✎</span>
            <span>Biên soạn</span>
          </button>
          <button
            type="button"
            className={`rail-item ${activeStudioTab === "export" ? "active" : ""}`}
            onClick={() => setActiveStudioTab("export")}
            aria-current={activeStudioTab === "export" ? "page" : undefined}
            title="Render cục bộ, Xuất JSON, Tạo prompt"
          >
            <span className="rail-icon" aria-hidden="true">↓</span>
            <span>Xuất</span>
          </button>
          <button
            type="button"
            className={`rail-item ${activeStudioTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveStudioTab("settings")}
            aria-current={activeStudioTab === "settings" ? "page" : undefined}
            title="Quản lý clip và cảnh"
          >
            <span className="rail-icon" aria-hidden="true">⚙</span>
            <span>Cài đặt</span>
          </button>
        </nav>

        <div className="studio-main">
          {activeStudioTab === "compose" ? (
            <>
              <header className="topbar compose-topbar">
                <div className="brand">
                  <div>
                    <h1>Kito Video Studio</h1>
                    <p>{projectTitle} · {projectDuration} giây · {aspectRatio}</p>
                  </div>
                </div>
                <div className="header-actions">
          <label className="project-picker">
            <span>Chủ đề</span>
            <select
              aria-label="Chọn chủ đề"
              value={projectId}
              onChange={(event) => switchProject(event.target.value)}
            >
              {[...projects.filter((item) => item.id !== projectId), currentProject].map(
                (item) => <option key={item.id} value={item.id}>{item.title}</option>,
              )}
            </select>
          </label>
          <button className="button new-project-button" onClick={() => setShowNewProject(true)}>
            ＋ Clip mới
          </button>
          <button
            className="button theme-toggle"
            onClick={() => setTheme((value) => value === "light" ? "dark" : "light")}
            aria-label={theme === "light" ? "Chuyển sang giao diện tối" : "Chuyển sang giao diện sáng"}
            title={theme === "light" ? "Giao diện tối" : "Giao diện sáng"}
          >
            {theme === "light" ? "☾ Tối" : "☀ Sáng"}
          </button>
          {googleUser ? (
            <>
              <div className="google-account" title={googleUser.email ?? "Tài khoản Google"}>
                <span className="google-account-name">
                  {googleUser.displayName || googleUser.email || "Google"}
                </span>
                <button
                  type="button"
                  className="button google-signin-button"
                  onClick={() => void handleGoogleSignOut()}
                  disabled={googleAuthBusy}
                >
                  Đăng xuất
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="button google-signin-button"
              onClick={() => void handleGoogleSignIn()}
              disabled={!googleAuthReady || googleAuthBusy}
            >
              {googleAuthBusy ? "Đang đăng nhập…" : "G Đăng nhập Google"}
            </button>
          )}
          <div className={`save-state ${saveStatus}`} aria-live="polite">
            <i />
            <span>
              {saveStatus === "loading" && "Đang tải dữ liệu"}
              {saveStatus === "saving" && "Đang lưu"}
              {saveStatus === "unsaved" && "Chưa lưu"}
              {saveStatus === "saved" &&
                (lastSavedAt
                  ? `Đã lưu ${lastSavedAt.toLocaleTimeString("vi-VN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : "Đã đồng bộ")}
              {saveStatus === "offline" && "Đã lưu trên thiết bị"}
              {saveStatus === "error" && "Chưa thể tải dữ liệu"}
            </span>
          </div>
          <button
            className="button save-button"
            onClick={saveProjectNow}
            disabled={!googleUser || saveStatus === "loading" || saveStatus === "saving"}
          >
            ☁ Lưu
          </button>
          <label className="duration-picker">
            <span>Độ dài</span>
            <input
              type="number"
              aria-label="Độ dài clip"
              min="1"
              step="1"
              value={projectDuration}
              onChange={(event) => {
                const duration = Math.max(1, Number(event.target.value) || 1);
                setProjectDuration(duration);
                setPlayTime((time) => Math.min(time, duration));
              }}
            />
            <b>giây</b>
          </label>
                </div>
              </header>

              <section className="workspace">
        <aside className="scene-panel">
          <div className="panel-heading">
            <h2>Cảnh <small className="scene-count">· {scenes.length}</small></h2>
            <div className="scene-heading-actions">
              <button
                type="button"
                className="scene-icon-button"
                onClick={() => duplicateScene()}
                title="Nhân bản cảnh đang chọn"
                aria-label="Nhân bản cảnh đang chọn"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="8" y="8" width="11" height="11" rx="2" />
                  <path d="M5 15V6a2 2 0 0 1 2-2h9" />
                </svg>
              </button>
              <button
                type="button"
                className="scene-icon-button scene-delete-icon"
                onClick={deleteScene}
                title={`Xóa cảnh${selectedSceneIds.length > 1 ? ` (${selectedSceneIds.length})` : ""}`}
                aria-label={`Xóa cảnh${selectedSceneIds.length > 1 ? ` (${selectedSceneIds.length})` : ""}`}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v5M14 11v5" />
                </svg>
              </button>
            </div>
          </div>
          <div className="scene-list">
            {scenes.map((item) => {
              const displayItem =
                visibleScenes.find((visibleItem) => visibleItem.id === item.id) ?? item;
              const visibleIndex = visibleScenes.findIndex(
                (visibleItem) => visibleItem.id === item.id,
              );
              const playbackActive =
                playing &&
                visibleIndex >= 0 &&
                playTime >= displayItem.start &&
                playTime < displayItem.end;
              const thumbSource =
                assetPreviewSource(item.image) ||
                assetPreviewSource(item.background ?? "") ||
                assetPreviewSource(legacyBackgroundPreview);
              return (
              <button
                key={item.id}
                draggable
                className={`scene-item ${
                  playbackActive || (!playing && item.id === selectedId)
                    ? "active"
                    : ""
                } ${playbackActive ? "playback-active" : ""} ${
                  !playing &&
                  selectedSceneIds.includes(item.id) &&
                  item.id !== selectedId
                    ? "multi-selected"
                    : ""
                } ${item.id === dragOverId ? "drag-over" : ""} ${
                  item.sceneVisible === false ? "is-hidden" : ""
                }`}
                data-scene-visibility={item.sceneVisible === false ? "hidden" : "visible"}
                onClick={(event) => {
                  setDraggedId(null);
                  setDragOverId(null);
                  selectScene(displayItem, event.shiftKey);
                }}
                onDragStart={(event) => {
                  setDraggedId(item.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", item.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverId(item.id);
                }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  reorderScenes(item.id);
                }}
                onDragEnd={() => {
                  setDraggedId(null);
                  setDragOverId(null);
                }}
              >
                <span className="drag-dots" aria-hidden="true">⠿</span>
                <span className="scene-number">{item.number}</span>
                <span className="scene-thumb">
                  {thumbSource ? (
                    <img src={thumbSource} alt="" />
                  ) : (
                    <b>{String(item.number).padStart(2, "0")}</b>
                  )}
                </span>
                {playbackActive && visibleIndex < visibleScenes.length - 1 && (
                  <span className="scene-running-flow" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <em>‹</em>
                    <em>⌄</em>
                    <b>›</b>
                  </span>
                )}
                <span className="scene-meta">
                  <strong>{item.sceneName || `Cảnh ${item.number}`}</strong>
                  <small>
                    {item.sceneVisible === false
                      ? "Đang ẩn"
                      : `${formatTime(displayItem.start)}–${formatTime(displayItem.end)}`}
                  </small>
                </span>
                <span
                  className={`scene-visibility-button ${item.sceneVisible === false ? "is-hidden" : ""}`}
                  role="button"
                  tabIndex={0}
                  title={item.sceneVisible === false ? "Hiện cảnh" : "Ẩn cảnh"}
                  aria-label={item.sceneVisible === false ? `Hiện cảnh ${item.number}` : `Ẩn cảnh ${item.number}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleSceneVisibility(item.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleSceneVisibility(item.id);
                    }
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2.8 12s3.2-5 9.2-5 9.2 5 9.2 5-3.2 5-9.2 5-9.2-5-9.2-5Z" />
                    <circle cx="12" cy="12" r="2.2" />
                    {item.sceneVisible === false && <path d="m4 4 16 16" />}
                  </svg>
                </span>
              </button>
              );
            })}
          </div>
          <button type="button" className="add-scene-button" onClick={addScene}>
            ＋ Thêm cảnh
          </button>
          <div className="toggles">
            <label>
              <input
                type="checkbox"
                checked={imageEnabled}
                onChange={(event) => setImageEnabled(event.target.checked)}
              />
              <span />
              Ảnh trong popup
            </label>
            <label>
              <input
                type="checkbox"
                checked={narrationEnabled}
                onChange={(event) => setNarrationEnabled(event.target.checked)}
              />
              <span />
              Thuyết minh AI
            </label>
          </div>
          <div className="schema-card">
            <span>SCHEMA</span>
            <strong>v1.0.0</strong>
            <p>Đã khóa cấu trúc render</p>
          </div>
        </aside>

        <section className={`preview-panel ${previewFullscreen ? "preview-fullscreen-panel" : ""}`}>
          <div className="preview-control-panel">
            <span className="preview-panel-kicker">XEM TRƯỚC</span>
            <div className="preview-panel-meta">
              <strong>Cảnh {scene.number} · {scene.sceneName || "CẢNH MỚI"}</strong>
              <span className="preview-aspect-badge">{aspectRatio}</span>
            </div>
            <div className="preview-control-bar">
              <div className="preview-aspect-switcher" role="group" aria-label="Tỷ lệ khung hình dự án">
                <span>Tỷ lệ</span>
                <button
                  type="button"
                  className={aspectRatio === "9:16" ? "active" : ""}
                  aria-pressed={aspectRatio === "9:16"}
                  onClick={() => updateAspectRatio("9:16")}
                >
                  9:16
                </button>
                <button
                  type="button"
                  className={aspectRatio === "16:9" ? "active" : ""}
                  aria-pressed={aspectRatio === "16:9"}
                  onClick={() => updateAspectRatio("16:9")}
                >
                  16:9
                </button>
              </div>
              <span className="time-pill">{formatTime(sceneLocalTime)} / {formatTime(sceneDuration)}</span>
              <button
                className="button ghost preview-play-button"
                disabled={!hydrated}
                onClick={togglePlayback}
              >
                <span className="play-icon">{playing ? "Ⅱ" : "▶"}</span>
                {!hydrated ? "Đang tải..." : playing ? "Tạm dừng" : "Xem thử"}
              </button>
              <div className="preview-ruler-control">
                <button
                  type="button"
                  className={`preview-ruler-toggle ${rulerEnabled ? "active" : ""}`}
                  aria-label={rulerEnabled ? "Tắt thước căn chỉnh" : "Bật thước căn chỉnh"}
                  aria-pressed={rulerEnabled}
                  aria-expanded={rulerEnabled}
                  title={rulerEnabled ? "Tắt thước căn chỉnh" : "Bật thước căn chỉnh"}
                  onClick={toggleRuler}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 5h16v14H4z" />
                    <path d="M8 5v4M12 5v7M16 5v4M8 19v-4M12 19v-7M16 19v-4" />
                  </svg>
                </button>
                {rulerEnabled && (
                  <div className="preview-ruler-style-popover" role="group" aria-label="Kiểu thước căn chỉnh">
                    <span>Kiểu thước</span>
                    <button
                      type="button"
                      className={rulerStyle === "center" ? "active" : ""}
                      aria-pressed={rulerStyle === "center"}
                      onClick={() => setRulerStyle("center")}
                    >
                      Canh giữa
                    </button>
                    <button
                      type="button"
                      className={rulerStyle === "grid" ? "active" : ""}
                      aria-pressed={rulerStyle === "grid"}
                      onClick={() => setRulerStyle("grid")}
                    >
                      Kẻ ô
                    </button>
                    <button
                      type="button"
                      className={rulerStyle === "all" ? "active" : ""}
                      aria-pressed={rulerStyle === "all"}
                      onClick={() => setRulerStyle("all")}
                    >
                      Tất cả
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                className={`preview-fullscreen-toggle ${previewFullscreen ? "active" : ""}`}
                aria-label={previewFullscreen ? "Thu nhỏ khu vực xem trước" : "Phóng to khu vực xem trước"}
                aria-pressed={previewFullscreen}
                title={previewFullscreen ? "Thu nhỏ khu vực xem trước (Esc)" : "Phóng to khu vực xem trước"}
                onClick={togglePreviewFullscreen}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {previewFullscreen ? (
                    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                  ) : (
                    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                  )}
                </svg>
              </button>
            </div>
            <div
              className="preview-panel-progress"
              role="progressbar"
              aria-label={`Tiến trình cảnh ${scene.number}`}
              aria-valuemin={0}
              aria-valuemax={sceneDuration}
              aria-valuenow={Number(sceneLocalTime.toFixed(1))}
            >
              <span style={{ width: `${sceneProgress * 100}%` }} />
              <i style={{ left: `${sceneProgress * 100}%` }} />
            </div>
          </div>
          <div
            className={`phone-preview ${aspectRatio === "16:9" ? "preview-landscape" : "preview-portrait"} ${playing ? "is-playing" : ""} ${rulerEnabled ? "ruler-enabled" : ""} ${mapEffectDragActive ? "effect-drop-target" : ""}`}
            style={{ transform: `scale(${previewZoom / 100})` }}
            onDragOver={handleMapEffectDragOver}
            onDragLeave={() => setMapEffectDragActive(false)}
            onDrop={handleMapEffectDrop}
          >
            {sceneIsVisibleInPlayback && scene.backgroundVisible !== false && backgroundPreviewSource && (
              backgroundIsVideo ? (
                <video
                  key={backgroundVideoPreviewSource}
                  ref={backgroundVideoRef}
                  className="project-background"
                  src={backgroundVideoPreviewSource}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  aria-hidden="true"
                  onLoadedMetadata={(event) => {
                    if (!playing && Number.isFinite(event.currentTarget.duration)) {
                      event.currentTarget.currentTime = sceneLocalTime;
                    }
                  }}
                  style={{
                    transformOrigin: `${scene.centerX}% ${scene.centerY}%`,
                    transform: `scale(${playing ? playbackMapScale : 1})`,
                    transitionDuration: playing ? "0ms" : "180ms",
                  }}
                />
              ) : (
                <img
                  className="project-background"
                  src={backgroundPreviewSource}
                  alt=""
                  aria-hidden="true"
                  style={{
                    transformOrigin: `${scene.centerX}% ${scene.centerY}%`,
                    transform: `scale(${playing ? playbackMapScale : 1})`,
                    transitionDuration: playing ? "0ms" : "180ms",
                  }}
                />
              )
            )}
            {sceneIsVisibleInPlayback && sceneEffects.lightFlickerEnabled && (
              <div
                className="scene-effect-layer light-flicker-effect"
                aria-hidden="true"
                style={{
                  ["--light-flicker-opacity" as string]: `${(sceneEffects.lightFlickerIntensity / 100) * 0.68}`,
                  ["--light-flicker-speed" as string]: `${Math.max(0.2, 2.8 / sceneEffects.lightFlickerSpeed)}s`,
                }}
              />
            )}
            {sceneIsVisibleInPlayback && sceneEffects.snowEnabled && (
              <div
                className="scene-effect-layer snow-effect"
                aria-hidden="true"
                style={{ ["--snow-intensity" as string]: `${sceneEffects.snowIntensity / 100}` }}
              >
                {SNOWFLAKE_SEEDS.map((flake, index) => (
                  <i
                    key={`snowflake-${index}`}
                    style={{
                      left: `${flake.x}%`,
                      width: `${flake.size}px`,
                      height: `${flake.size}px`,
                      animationDuration: `${flake.duration / sceneEffects.snowSpeed}s`,
                      animationDelay: `${flake.delay}s`,
                      ["--snow-drift" as string]: `${flake.drift}px`,
                    }}
                  />
                ))}
              </div>
            )}
            {sceneIsVisibleInPlayback && sceneEffects.cloudEnabled && (
              <div
                className="scene-effect-layer cloud-effect"
                aria-hidden="true"
                style={{ ["--cloud-intensity" as string]: `${sceneEffects.cloudIntensity / 100}` }}
              >
                {CLOUD_SEEDS.map((cloud, index) => (
                  <i
                    key={`cloud-${index}`}
                    style={{
                      left: `${cloud.x}%`,
                      top: `${cloud.y}%`,
                      width: `${cloud.width}%`,
                      height: `${cloud.height}px`,
                      animationDuration: `${cloud.duration / sceneEffects.cloudSpeed}s`,
                      animationDelay: `${cloud.delay}s`,
                      ["--cloud-drift" as string]: `${cloud.drift}%`,
                    }}
                  />
                ))}
              </div>
            )}
            {sceneIsVisibleInPlayback && sceneEffects.rainEnabled && (
              <div
                className="scene-effect-layer rain-effect"
                aria-hidden="true"
                style={{ ["--rain-intensity" as string]: `${sceneEffects.rainIntensity / 100}` }}
              >
                {RAIN_DROP_SEEDS.map((drop, index) => (
                  <i
                    key={`raindrop-${index}`}
                    style={{
                      left: `${drop.x}%`,
                      width: `${drop.width}px`,
                      height: `${drop.length}px`,
                      animationDuration: `${drop.duration / sceneEffects.rainSpeed}s`,
                      animationDelay: `${drop.delay}s`,
                      ["--rain-drift" as string]: `${drop.drift}px`,
                    }}
                  />
                ))}
              </div>
            )}
            {sceneIsVisibleInPlayback && sceneEffects.thunderEnabled && (
              <div
                className="scene-effect-layer thunder-effect"
                aria-hidden="true"
                style={{
                  ["--thunder-opacity" as string]: `${(sceneEffects.thunderIntensity / 100) * 0.78}`,
                  ["--thunder-speed" as string]: `${Math.max(0.4, 3.6 / sceneEffects.thunderSpeed)}s`,
                }}
              />
            )}
            {sceneIsVisibleInPlayback && sceneTextOverlays.filter((overlay) => overlay.visible !== false).map((overlay) => safeTrim(overlay.text) ? (
              <div
                key={overlay.id}
                className={`map-text-overlay ${draggingTextOverlay && overlay.id === activeTextOverlay?.id ? "is-dragging" : ""}`}
                style={{
                  left: `${overlay.x}%`,
                  top: `${overlay.y}%`,
                  color: colorWithAlpha(overlay.color, overlay.opacity / 100, "#ffffff"),
                  fontSize: `${overlay.size}px`,
                  fontFamily: overlay.font,
                  fontWeight: overlay.style.includes("bold") ? 700 : 400,
                  fontStyle: overlay.style.includes("italic") ? "italic" : "normal",
                  WebkitTextStroke: overlay.strokeWidth > 0
                    ? `${overlay.strokeWidth}px ${colorWithAlpha(overlay.strokeColor, overlay.opacity / 100, "#000000")}`
                    : undefined,
                  ["--text-border-width" as string]: `${overlay.borderWidth}px`,
                  ["--text-border-color" as string]: colorWithAlpha(overlay.borderColor, overlay.borderOpacity / 100, "#ffffff"),
                  ["--text-border-fill" as string]: colorWithAlpha(overlay.borderFill, overlay.borderOpacity / 100, "#14202e"),
                }}
                role="button"
                tabIndex={0}
                aria-label="Chữ viết trên bản đồ. Kéo để di chuyển."
                onPointerDown={(event) => startTextOverlayDrag(event, overlay.id)}
              >
                {overlay.text}
              </div>
            ) : null)}
            {sceneIsVisibleInPlayback && previewSceneImageItems.map((image) => {
              const imageSource = sceneImageSpritePreviewUrls[image.id] || assetPreviewSource(image.url);
              const imageIsVideo = image.mediaType === "video" || isVideoMedia(image.url);
              const imageIsTransparent = image.transparent || Boolean(sceneImageSpritePreviewUrls[image.id]);
              const squareSize = Math.min(image.width, image.height);
              const width = image.shape === "square" ? squareSize : image.width;
              const height = image.shape === "square" ? squareSize : image.height;
              return (
                <div
                  key={image.id}
                  data-scene-image-id={image.id}
                  className={`scene-image-overlay scene-image-shape-${image.shape} ${imageIsTransparent ? "is-transparent-media" : ""} ${draggingSceneImage && image.id === activeSceneImage?.id ? "is-dragging" : ""}`}
                  style={{
                    left: `${image.x}%`,
                    top: `${image.y}%`,
                    width: `${width}%`,
                    height: `${height}%`,
                    opacity: image.opacity / 100,
                    clipPath: sceneImageClipPath(image.shape),
                    border: image.borderWidth > 0 ? `${image.borderWidth}px solid ${image.borderColor}` : undefined,
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label="Hình ảnh trên bản đồ. Kéo để di chuyển."
                  onPointerDown={(event) => startSceneImageDrag(event, image.id)}
                >
                  {imageSource && imageIsVideo
                    ? <video src={imageSource} autoPlay loop muted playsInline preload="metadata" />
                    : imageSource
                      ? <img src={imageSource} alt="" draggable={false} />
                      : <span>Chưa có media</span>}
                  {image.id === activeSceneImage?.id && !playing && (
                    <button
                      type="button"
                      className="scene-image-resize-handle"
                      aria-label="Kéo để thay đổi kích thước hình ảnh"
                      title="Kéo để tăng hoặc giảm kích thước"
                      onPointerDown={startSceneImageResize}
                    />
                  )}
                </div>
              );
            })}
            {sceneIsVisibleInPlayback && previewDecorationItems.map((decoration) => {
              const stickerSource = decoration.type === "sticker" || decoration.type === "animated-sticker"
                ? assetPreviewSource(decoration.asset)
                : "";
              const animatedVideo = decoration.type === "animated-sticker" && decoration.assetType === "webm";
              const decorationContent = decoration.type === "animated-sticker" && stickerSource
                ? animatedVideo
                  ? <video src={stickerSource} autoPlay loop muted playsInline preload="metadata" aria-hidden="true" />
                  : <img src={stickerSource} alt="" draggable={false} />
                : decoration.type === "sticker" && stickerSource
                ? <img src={stickerSource} alt="" draggable={false} />
                : <span className="map-decoration-content">
                    {decoration.type === "text-3d" ? decoration.text : decorationSymbol(decoration)}
                  </span>;
              return (
                <div
                  key={decoration.id}
                  data-decoration-id={decoration.id}
                  className={`map-decoration map-decoration-${decoration.type} map-decoration-animation-${decoration.animation} ${draggingMapDecoration && decoration.id === activeDecoration?.id ? "is-dragging" : ""} ${playing ? "is-playing" : ""}`}
                  style={{
                    left: `${decoration.x}%`,
                    top: `${decoration.y}%`,
                    opacity: decoration.opacity / 100,
                    color: colorWithAlpha(decoration.color, decoration.opacity / 100, "#ffd166"),
                    fontSize: `${decoration.size}px`,
                    transform: `translate(-50%, -50%) rotate(${decoration.rotate}deg) scale(${decoration.scale})`,
                    ["--decoration-depth-shadow" as string]: decorationTextShadow(decoration),
                    ["--decoration-accent" as string]: decoration.accentColor,
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${mapDecorationTypeLabel(decoration.type)} trên bản đồ. Kéo để di chuyển.`}
                  onPointerDown={(event) => startMapDecorationDrag(event, decoration.id)}
                >
                  {decorationContent}
                </div>
              );
            })}
            {activeSubtitle && (
              <div
                className={`subtitle-overlay subtitle-animation-${subtitleStyle.animation} ${draggingSubtitle ? "is-dragging" : ""} ${playing ? "is-playing" : ""}`}
                role="status"
                aria-live="polite"
                aria-label="Phụ đề trên bản đồ. Kéo để di chuyển khung chữ."
                title="Kéo để di chuyển khung chữ phụ đề"
                onPointerDown={startSubtitleDrag}
                style={{
                  left: `${subtitleStyle.x}%`,
                  top: `${subtitleStyle.y + subtitleAnimationOffset}%`,
                  right: "auto",
                  width: `${subtitleStyle.boxWidth}%`,
                  maxWidth: "100%",
                  boxSizing: "border-box",
                  color: colorWithAlpha(subtitleStyle.color, (subtitleStyle.opacity / 100) * subtitleAnimationOpacity, "#ffffff"),
                  fontFamily: subtitleStyle.font,
                  fontSize: `clamp(11px, ${Math.max(1, subtitleStyle.size / 10)}vw, ${Math.max(12, subtitleStyle.size)}px)`,
                  fontStyle: subtitleStyle.style.includes("italic") ? "italic" : "normal",
                  fontWeight: subtitleStyle.style.includes("bold") ? 750 : 400,
                  borderWidth: `${subtitleStyle.borderWidth}px`,
                  borderColor: colorWithAlpha(subtitleStyle.borderColor, subtitleStyle.borderOpacity / 100, "#ffffff"),
                  background: colorWithAlpha(subtitleStyle.borderFill, subtitleStyle.borderOpacity / 100, "#0b1220"),
                  opacity: subtitleAnimationOpacity,
                  clipPath: subtitleAnimationClipPath,
                  textShadow: subtitleStyle.strokeWidth > 0
                    ? `0 0 ${Math.max(1, subtitleStyle.strokeWidth)}px ${subtitleStyle.strokeColor}`
                    : "none",
                  transform: `translate(-50%, -50%) scale(${subtitleAnimationScale})`,
                }}
              >
                {activeSubtitle.text}
              </div>
            )}
            {playing && sceneIsVisibleInPlayback && (
              <div className="playback-live">
                <i /> ĐANG PHÁT
              </div>
            )}
            {!playing && zoomEnabled && (
              <div
                className={`zoom-focus-target ${draggingZoomCenter ? "is-dragging" : ""}`}
                style={{
                  left: `${scene.centerX}%`,
                  top: `${scene.centerY}%`,
                }}
                role="slider"
                aria-label="Kéo để chọn vị trí zoom bản đồ"
                aria-valuetext={`X ${scene.centerX}%, Y ${scene.centerY}%`}
                onPointerDown={startMapPointDrag}
              >
                <span />
              </div>
            )}
            {previewPopupItems.map((popup) => {
              const popupStart = Math.min(sceneDuration, Math.max(0, Number(popup.start) || 0));
              const popupDuration = Math.max(0.1, Number(popup.duration) || 0.1);
              const popupEnd = Math.min(sceneDuration, popupStart + popupDuration);
              const popupTransition = Math.min(0.65, popupDuration / 3);
              const popupPhase = !playing
                ? "idle"
                : sceneLocalTime < popupStart + popupTransition
                  ? "opening"
                  : sceneLocalTime > popupEnd - popupTransition ? "closing" : "visible";
              const popupImageSource = imageEnabled && popup.imageVisible !== false
                ? assetPreviewSource(popup.image)
                : "";
              const popupVideoSource = assetPreviewSource(popup.video);
              const popupHasMedia = (imageEnabled && popup.imageVisible !== false && Boolean(safeTrim(popup.image)))
                || Boolean(safeTrim(popup.video));
              const popupHasText = Boolean(safeTrim(popup.title) || safeTrim(popup.body));
              const popupLayout = popup.layout ?? "image-top";
              const popupShowMedia = popupLayout !== "content-only" && popupHasMedia;
              const popupShowText = popupLayout !== "image-only" && popupHasText;
              const popupMediaOnly = popupShowMedia && !popupShowText;
              const popupTransparentMedia = popup.transparentMedia === true && popupShowMedia;
              const popupEmptyFrame = !popupShowMedia && !popupShowText;
              return (
                <article
                  key={popup.id}
                  data-popup-id={popup.id}
                  className={`preview-card popup-layout-${popupLayout} popup-theme-${popup.theme ?? "travel"} popup-text-${popup.textEffect ?? "none"} ${popupMediaOnly ? "popup-media-only popup-textless" : ""} ${popupTransparentMedia ? "popup-transparent-media" : ""} ${popupEmptyFrame ? "popup-empty-frame" : ""} ${
                    playing
                      ? `playback-popup popup-${popupPhase} popup-in-${popup.in} popup-out-${popup.out}`
                      : ""
                  }`}
                  style={{
                    width: `${popup.width ?? 90}%`,
                    height: `min(${popup.height ?? 255}px, 88%)`,
                    left: `${popup.x ?? 5}%`,
                    top: `${popup.y ?? 55}%`,
                    right: "auto",
                    bottom: "auto",
                    ["--popup-transition-duration" as string]: `${popupTransition}s`,
                    ["--popup-border-width" as string]: `${popup.borderWidth ?? 1}px`,
                  }}
                  onPointerDown={(event) => startPopupDrag(event, popup.id)}
                >
                  {popupShowMedia && (
                    <div className="photo-placeholder">
                      {popupVideoSource ? (
                        <video
                          className={`popup-video ${popupTransparentMedia ? "popup-transparent-media-asset" : ""}`}
                          src={popupVideoSource}
                          muted
                          autoPlay
                          loop
                          playsInline
                        />
                      ) : popupImageSource ? (
                        <img className={popupTransparentMedia ? "popup-transparent-media-asset" : ""} src={popupImageSource} alt={`Ảnh minh họa ${popup.title || scene.sceneName}`} />
                      ) : (
                        <>
                          <div className="sun" />
                          <div className="hill hill-a" />
                          <div className="hill hill-b" />
                          <span>Không tải được tài nguyên popup</span>
                        </>
                      )}
                    </div>
                  )}
                  {popupShowText && <div className="card-content">
                     {popupLayout === "stats" && (
                      <div className="popup-stat-row">
                        <span>{scene.location || "HÀNH TRÌNH"}</span>
                    <b>{String(scene.number).padStart(2, "0")}</b>
                    </div>
                     )}
                    {popup.layout === "quote" && <span className="popup-quote-mark">“</span>}
                    {safeTrim(popup.title) && <h3>{popup.title}</h3>}
                    {safeTrim(popup.body) && <p>{popup.body}</p>}
                   </div>}
                  {popup.id === activePopup?.id && (
                    <button
                      className="popup-resize-handle"
                      aria-label="Kéo để thay đổi kích thước popup"
                      title="Kéo để phóng to hoặc thu nhỏ popup"
                      onPointerDown={startPopupResize}
                    />
                  )}
                </article>
              );
            })}
            {rulerEnabled && (
              <div className={`preview-alignment-guides ruler-style-${rulerStyle}`} aria-hidden="true">
                {(rulerStyle === "grid" || rulerStyle === "all") && (
                  <span className="preview-ruler-grid" />
                )}
                {(rulerStyle === "center" || rulerStyle === "all") && (
                  <>
                    <span className="alignment-guide alignment-guide-vertical alignment-guide-center" style={{ left: "50%" }}>
                      <b>50%</b>
                    </span>
                    <span className="alignment-guide alignment-guide-horizontal alignment-guide-center" style={{ top: "50%" }}>
                      <b>50%</b>
                    </span>
                  </>
                )}
                {rulerStyle === "all" && alignmentGuides.vertical !== null && Math.abs(alignmentGuides.vertical - 50) > 0.1 && (
                  <span
                    className="alignment-guide alignment-guide-vertical alignment-guide-snap"
                    style={{ left: `${alignmentGuides.vertical}%` }}
                  >
                    <b>{Math.round(alignmentGuides.vertical)}%</b>
                  </span>
                )}
                {rulerStyle === "all" && alignmentGuides.horizontal !== null && Math.abs(alignmentGuides.horizontal - 50) > 0.1 && (
                  <span
                    className="alignment-guide alignment-guide-horizontal alignment-guide-snap"
                    style={{ top: `${alignmentGuides.horizontal}%` }}
                  >
                    <b>{Math.round(alignmentGuides.horizontal)}%</b>
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="preview-navigation" aria-label="Điều hướng cảnh và tỷ lệ xem trước">
            <button
              type="button"
              className="preview-scene-navigation preview-scene-navigation-previous"
              onClick={() => selectAdjacentScene(-1)}
              disabled={!visibleScenes.some((item) => item.id === scene.id) || visibleScenes.findIndex((item) => item.id === scene.id) <= 0}
            >
              ← Cảnh trước
            </button>
            <div className="preview-zoom-control" role="group" aria-label="Tỷ lệ zoom xem trước">
              <button
                type="button"
                onClick={() => adjustPreviewZoom(-5)}
                disabled={previewZoom <= 75}
                aria-label="Thu nhỏ xem trước"
              >
                −
              </button>
              <output>{previewZoom}%</output>
              <button
                type="button"
                onClick={() => adjustPreviewZoom(5)}
                disabled={previewZoom >= 125}
                aria-label="Phóng to xem trước"
              >
                +
              </button>
            </div>
            <button
              type="button"
              className="preview-scene-navigation preview-scene-navigation-next"
              onClick={() => selectAdjacentScene(1)}
              disabled={!visibleScenes.some((item) => item.id === scene.id) || visibleScenes.findIndex((item) => item.id === scene.id) >= visibleScenes.length - 1}
            >
              Cảnh tiếp theo →
            </button>
          </div>
        </section>

        <aside className={`editor-panel ${!hydrated ? "is-loading" : ""}`}>
          <div className="panel-heading">
            <h2>Biên soạn</h2>
            <div className="editor-heading-actions">
              <button
                type="button"
                className="accordion-toggle-all"
                onClick={() => {
                  const shouldOpen = !Object.values(editorSections).every(Boolean);
                  setEditorSections({
                    visual: shouldOpen,
                    content: shouldOpen,
                    audio: shouldOpen,
                    effects: shouldOpen,
                    popup: shouldOpen,
                    text: shouldOpen,
                  });
                }}
              >
                {Object.values(editorSections).every(Boolean) ? "Thu tất cả" : "Mở tất cả"}
              </button>
              <span className="scene-pill">
                {selectedSceneIds.length > 1
                  ? `${selectedSceneIds.length} cảnh`
                  : `Cảnh ${scene.number}`}
              </span>
            </div>
          </div>
          <div className="editor-scroll">
            <details
              className="editor-accordion"
              open={editorSections.visual}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setEditorSections((items) => ({
                  ...items,
                  visual: open,
                }));
              }}
            >
              <summary className="editor-group-label">
                <span>01</span><strong>Hình ảnh & nền</strong>{editorSectionActions("visual")}<i />
              </summary>
              <div className="editor-accordion-content">
            <label className="field background-field">
              <span>Background chủ đề cảnh {scene.number}</span>
              <input
                type="text"
                inputMode="url"
                placeholder="https://example.com/background.jpg hoặc .mp4"
                value={scene.background ?? ""}
                onChange={(event) => updateScene("background", event.target.value)}
              />
              {backgroundPreviewSource && (
                <div className="image-url-preview background-media-preview">
                  {backgroundIsVideo ? (
                    <video
                      src={backgroundPreviewSource}
                      muted
                      loop
                      playsInline
                      controls
                      preload="metadata"
                      aria-label={`Xem trước clip background cảnh ${scene.number}`}
                    />
                  ) : (
                    <img src={backgroundPreviewSource} alt={`Xem trước background cảnh ${scene.number}`} />
                  )}
                  <span>Background này chỉ áp dụng cho cảnh đang chọn.</span>
                </div>
              )}
              <small>Nhập URL hoặc tên file ảnh/clip riêng cho cảnh (.jpg, .png, .webp, .mp4, .webm, .mov). URL sẽ được renderer tự tải về.</small>
            </label>
            <div className="editor-visibility-actions" aria-label="Điều khiển hiển thị trong xem trước">
              <button
                type="button"
                className={`button editor-visibility-button ${scene.backgroundVisible !== false ? "active" : ""}`}
                title={scene.backgroundVisible !== false ? "Ẩn background khỏi xem trước" : "Hiện background trong xem trước"}
                onClick={() => updateCurrentScene("backgroundVisible", scene.backgroundVisible === false)}
              >
                {scene.backgroundVisible !== false ? "◉ Ẩn background" : "⊘ Hiện background"}
              </button>
              <button
                type="button"
                className={`button editor-visibility-button ${activePopup?.visible !== false ? "active" : ""}`}
                title={activePopup?.visible !== false ? "Ẩn popup khỏi xem trước" : "Hiện popup trong xem trước"}
                onClick={() => updatePopup("visible", activePopup?.visible === false)}
              >
                {activePopup?.visible !== false ? "◉ Ẩn popup" : "⊘ Hiện popup"}
              </button>
            </div>
              </div>
            </details>
            <details
              className="editor-accordion"
              open={editorSections.images}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setEditorSections((items) => ({ ...items, images: open }));
              }}
            >
              <summary className="editor-group-label">
                <span>02</span><strong>Hình ảnh</strong>{editorSectionActions("images")}<i />
              </summary>
              <div className="editor-accordion-content">
                <div className="scene-image-manager">
                  <div className="text-overlay-list-heading">
                    <span>Hình ảnh / video trên bản đồ</span>
                    <button type="button" className="button primary text-overlay-add" onClick={addSceneImage}>＋ Thêm hình ảnh</button>
                  </div>
                  <small>Nhập URL hình hoặc video. PNG, APNG, GIF và WebM VP9 Alpha có thể giữ nền trong suốt.</small>
                  {sceneImages.length > 0 ? (
                    <div className="scene-image-list">
                      {sceneImages.map((image, index) => (
                        <div key={image.id} className={`scene-image-item ${image.id === activeSceneImage?.id ? "active" : ""} ${image.visible === false ? "is-hidden" : ""}`}>
                          {renamingSceneImageId === image.id ? (
                            <div className="layer-name-editor">
                              <input
                                className="layer-name-input"
                                type="text"
                                value={renamingSceneImageName}
                                autoFocus
                                aria-label="Tên hình ảnh"
                                onChange={(event) => setRenamingSceneImageName(event.target.value)}
                                onBlur={finishSceneImageRename}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") finishSceneImageRename();
                                  if (event.key === "Escape") cancelSceneImageRename();
                                }}
                                onClick={(event) => event.stopPropagation()}
                              />
                            </div>
                          ) : (
                            <button type="button" className="scene-image-select" onClick={() => setSelectedSceneImageId(image.id)}>
                              <span>{String(index + 1).padStart(2, "0")}</span>
                              <strong>{sceneImageLabel(image, index)}</strong>
                            </button>
                          )}
                          <button
                            type="button"
                            className="scene-image-action scene-image-edit"
                            title="Đổi tên"
                            aria-label={`Đổi tên ${sceneImageLabel(image, index)}`}
                            onClick={() => beginSceneImageRename(image, index)}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="m4 16-.8 4.8L8 20l11-11a2.1 2.1 0 0 0-3-3L5 17" />
                              <path d="m14 5 5 5" />
                            </svg>
                          </button>
                          <button type="button" className="scene-image-action" title={image.visible === false ? "Hiện lớp" : "Ẩn lớp"} onClick={() => toggleSceneImageVisibility(image.id)}>
                            {image.visible === false ? "○" : "◉"}
                          </button>
                          <button type="button" className="scene-image-action" title="Nhân bản" onClick={() => duplicateSceneImage(image)}>⧉</button>
                          <button type="button" className="scene-image-action danger" title="Xóa" onClick={() => deleteSceneImage(image.id)}>×</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-overlay-empty">Chưa có hình ảnh. Bấm “Thêm hình ảnh” để tạo một lớp trên bản đồ.</div>
                  )}
                  {activeSceneImage && (
                    <div className="scene-image-controls">
                      <label className="field">
                        <span>URL hình ảnh hoặc video</span>
                        <input type="text" inputMode="url" value={activeSceneImage.url} placeholder="https://.../overlay.png hoặc overlay.webm" onChange={(event) => updateSceneImageUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void prepareSceneImageSprite(activeSceneImage.id, event.currentTarget.value); event.currentTarget.blur(); } }} onBlur={(event) => void prepareSceneImageSprite(activeSceneImage.id, event.currentTarget.value)} />
                      </label>
                      <label className="popup-transparent-toggle">
                        <input type="checkbox" checked={activeSceneImage.transparent} onChange={(event) => updateSceneImage("transparent", event.target.checked)} />
                        <span />
                        Giữ nền trong suốt cho lớp media
                      </label>
                      <div className="field-row">
                        <label className="field">
                          <span>Kiểu khung</span>
                          <select value={activeSceneImage.shape} onChange={(event) => updateSceneImage("shape", event.target.value as SceneImageShape)}>
                            {sceneImageShapeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        </label>
                        <label className="field">
                          <span>Độ mờ (%)</span>
                          <div className="number-with-unit"><input type="number" min="0" max="100" value={activeSceneImage.opacity} onChange={(event) => updateSceneImage("opacity", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} /><b>%</b></div>
                        </label>
                      </div>
                      <div className="field-row">
                        <label className="field">
                          <span>Chiều rộng</span>
                          <div className="number-with-unit"><input type="number" min="1" max="96" step="1" value={activeSceneImage.width} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateSceneImage("width", Math.min(96, Math.max(1, Number(event.target.value) || 1)))} /><b>%</b></div>
                        </label>
                        <label className="field">
                          <span>Chiều cao</span>
                          <div className="number-with-unit"><input type="number" min="1" max="96" step="1" value={activeSceneImage.height} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateSceneImage("height", Math.min(96, Math.max(1, Number(event.target.value) || 1)))} /><b>%</b></div>
                        </label>
                      </div>
                      <div className="field-row">
                        <label className="field">
                          <span>Border</span>
                          <div className="number-with-unit"><input type="number" min="0" max="12" step="1" value={activeSceneImage.borderWidth} onChange={(event) => updateSceneImage("borderWidth", Math.min(12, Math.max(0, Number(event.target.value) || 0)))} /><b>px</b></div>
                        </label>
                        <label className="field color-field"><span>Màu border</span><input className="text-color-picker" type="color" value={activeSceneImage.borderColor} onChange={(event) => updateSceneImage("borderColor", event.target.value)} /></label>
                      </div>
                      <div className="field-row">
                        <label className="field"><span>Bắt đầu</span><div className="number-with-unit"><input type="number" min="0" max={sceneDuration} step="0.1" value={activeSceneImage.start} onChange={(event) => updateSceneImage("start", Math.min(sceneDuration, Math.max(0, Number(event.target.value) || 0)))} /><b>s</b></div></label>
                        <label className="field"><span>Thời lượng</span><div className="number-with-unit"><input type="number" min="0.1" max={sceneDuration} step="0.1" value={Math.min(sceneDuration, activeSceneImage.duration)} onChange={(event) => updateSceneImage("duration", Math.min(sceneDuration, Math.max(0.1, Number(event.target.value) || 0.1)))} /><b>s</b></div></label>
                      </div>
                      <div className="field text-position-readout"><span>Vị trí hiện tại</span><b>X {Math.round(activeSceneImage.x)}% · Y {Math.round(activeSceneImage.y)}%</b></div>
                      <small>Kéo trực tiếp lớp trên bản đồ để di chuyển. Kéo nút ở góc lớp để tăng hoặc giảm kích thước.</small>
                    </div>
                  )}
                </div>
              </div>
            </details>
            <details
              className="editor-accordion"
              open={editorSections.content}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setEditorSections((items) => ({
                  ...items,
                  content: open,
                }));
              }}
            >
              <summary className="editor-group-label">
                <span>03</span><strong>Nội dung cảnh</strong>{editorSectionActions("content")}<i />
              </summary>
              <div className="editor-accordion-content">
            <label className="field">
              <span>Thời lượng cảnh</span>
              <div className="number-with-unit">
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={Number(sceneDuration.toFixed(1))}
                  onChange={(event) => updateSelectedSceneDuration(Number(event.target.value))}
                />
                <b>giây</b>
              </div>
              <small>
                {selectedSceneIds.length > 1
                  ? `Áp dụng cùng thời lượng cho ${selectedSceneIds.length} cảnh đã chọn.`
                  : "Các mốc thời gian phía sau sẽ tự động được tính lại."}
              </small>
            </label>
            <label className="field">
              <span>Tên Cảnh</span>
              <input
                value={scene.sceneName}
                placeholder={`Cảnh ${scene.number}`}
                onChange={(event) => updateScene("sceneName", event.target.value)}
              />
              <small>Tên này hiển thị ở danh sách cảnh và khu vực xem trước.</small>
            </label>
              </div>
            </details>
            <details
              className="editor-accordion"
              open={editorSections.text}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setEditorSections((items) => ({
                  ...items,
                  text: open,
                }));
              }}
            >
              <summary className="editor-group-label">
                <span>04</span><strong>Chữ viết</strong>{editorSectionActions("text")}<i />
              </summary>
              <div className="editor-accordion-content">
                <label className="field">
                  <span>Nội dung chữ viết</span>
                  <textarea
                    value={activeTextOverlay?.text ?? ""}
                    placeholder="Nhập chữ hiển thị trên bản đồ..."
                    onChange={(event) => updateTextOverlay("text", event.target.value)}
                  />
                  <div className="text-overlay-manager">
                    <div className="text-overlay-list-heading">
                      <span>Danh sách chữ trên bản đồ</span>
                      <button type="button" className="button primary text-overlay-add" onClick={addTextOverlay}>＋ Thêm chữ</button>
                    </div>
                    {sceneTextOverlays.length > 0 ? (
                      <div className="text-overlay-list">
                        {sceneTextOverlays.map((overlay, index) => (
                          <div key={overlay.id} className={`text-overlay-item ${overlay.id === activeTextOverlay?.id ? "active" : ""} ${overlay.visible === false ? "is-hidden" : ""}`}>
                            {renamingTextOverlayId === overlay.id ? (
                              <div className="layer-name-editor">
                                <input
                                  className="layer-name-input"
                                  type="text"
                                  value={renamingTextOverlayName}
                                  autoFocus
                                  aria-label="Tên chữ viết"
                                  onChange={(event) => setRenamingTextOverlayName(event.target.value)}
                                  onBlur={finishTextOverlayRename}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") finishTextOverlayRename();
                                    if (event.key === "Escape") cancelTextOverlayRename();
                                  }}
                                  onClick={(event) => event.stopPropagation()}
                                />
                              </div>
                            ) : (
                              <button type="button" className="text-overlay-select" onClick={() => setSelectedTextOverlayId(overlay.id)}>
                                <span>{String(index + 1).padStart(2, "0")}</span>
                                <strong>{textOverlayLabel(overlay, index)}</strong>
                              </button>
                            )}
                            <button
                              type="button"
                              className="text-overlay-edit"
                              title="Đổi tên"
                              aria-label={`Đổi tên ${textOverlayLabel(overlay, index)}`}
                              onClick={() => beginTextOverlayRename(overlay, index)}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="m4 16-.8 4.8L8 20l11-11a2.1 2.1 0 0 0-3-3L5 17" />
                                <path d="m14 5 5 5" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className={`text-overlay-visibility ${overlay.visible === false ? "is-hidden" : ""}`}
                              aria-label={overlay.visible === false ? `Hiện chữ ${index + 1}` : `Ẩn chữ ${index + 1}`}
                              title={overlay.visible === false ? `Hiện chữ ${index + 1}` : `Ẩn chữ ${index + 1}`}
                              onClick={() => toggleTextOverlayVisibility(overlay.id)}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M2.8 12s3.2-5 9.2-5 9.2 5 9.2 5-3.2 5-9.2 5-9.2-5-9.2-5Z" />
                                <circle cx="12" cy="12" r="2.2" />
                                {overlay.visible === false && <path d="m4 4 16 16" />}
                              </svg>
                            </button>
                            <button type="button" className="text-overlay-delete" aria-label={`Xóa chữ ${index + 1}`} onClick={() => deleteTextOverlay(overlay.id)}>×</button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-overlay-empty">Chưa có chữ. Bấm “Thêm chữ” để tạo một lớp mới.</div>
                    )}
                  </div>
                  <small>Kéo trực tiếp dòng chữ trên khung bản đồ để di chuyển vị trí.</small>
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>Cỡ chữ</span>
                    <div className="number-with-unit">
                      <input
                        type="number"
                        min="8"
                        max="120"
                        step="1"
                        value={activeTextOverlay?.size ?? 24}
                        onChange={(event) => updateTextOverlay("size", Math.min(120, Math.max(8, Number(event.target.value) || 24)))}
                      />
                      <b>px</b>
                    </div>
                  </label>
                  <label className="field">
                    <span>Kiểu chữ</span>
                    <select
                      value={activeTextOverlay?.style ?? "normal"}
                      onChange={(event) => updateTextOverlay("style", event.target.value as TextOverlay["style"])}
                    >
                      <option value="normal">Thường</option>
                      <option value="bold">Đậm</option>
                      <option value="italic">Nghiêng</option>
                      <option value="bold-italic">Đậm + nghiêng</option>
                    </select>
                  </label>
                 </div>
                 <div className="field-row">
                   <label className="field">
                     <span>Độ trong suốt</span>
                     <div className="number-with-unit">
                       <input
                         type="number"
                         min="0"
                         max="100"
                         step="1"
                         value={activeTextOverlay?.opacity ?? 100}
                         onChange={(event) => updateTextOverlay("opacity", Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
                       />
                       <b>%</b>
                     </div>
                   </label>
                 </div>
                 <div className="field-row">
                  <label className="field">
                    <span>Font chữ</span>
                    <select
                      value={activeTextOverlay?.font ?? "Arial"}
                      onChange={(event) => updateTextOverlay("font", event.target.value as OverlayTextFont)}
                    >
                      <option value="Arial">Arial</option>
                      <option value="Verdana">Verdana</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Tahoma">Tahoma</option>
                      <option value="Times New Roman">Times New Roman</option>
                      <option value="Courier New">Courier New</option>
                    </select>
                  </label>
                  <label className="field color-field">
                    <span>Màu chữ · mã HEX</span>
                    <div className="color-input-row">
                      <input
                        className="text-color-picker"
                        type="color"
                        value={normalizeHexColor(activeTextOverlay?.color ?? "#ffffff", "#ffffff")}
                        onChange={(event) => updateTextOverlay("color", event.target.value)}
                      />
                      <input
                        className="text-color-code"
                        type="text"
                        inputMode="text"
                        maxLength={7}
                        value={activeTextOverlay?.color ?? "#ffffff"}
                        placeholder="#FFFFFF"
                        onChange={(event) => updateTextOverlay("color", event.target.value)}
                        onBlur={(event) => updateTextOverlay("color", normalizeHexColor(event.target.value, "#ffffff"))}
                      />
                    </div>
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>Stroke chữ</span>
                    <div className="number-with-unit">
                      <input
                        type="number"
                        min="0"
                        max="12"
                        step="1"
                        value={activeTextOverlay?.strokeWidth ?? 0}
                        onChange={(event) => updateTextOverlay("strokeWidth", Math.min(12, Math.max(0, Number(event.target.value) || 0)))}
                      />
                      <b>px</b>
                    </div>
                  </label>
                  <label className="field color-field">
                    <span>Màu stroke</span>
                    <input
                      className="text-color-picker"
                      type="color"
                      value={normalizeHexColor(activeTextOverlay?.strokeColor ?? "#000000", "#000000")}
                      onChange={(event) => updateTextOverlay("strokeColor", event.target.value)}
                    />
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>Border khung</span>
                    <div className="number-with-unit">
                      <input
                        type="number"
                        min="0"
                        max="12"
                        step="1"
                        value={activeTextOverlay?.borderWidth ?? 0}
                        onChange={(event) => updateTextOverlay("borderWidth", Math.min(12, Math.max(0, Number(event.target.value) || 0)))}
                      />
                      <b>px</b>
                    </div>
                  </label>
                  <label className="field color-field">
                    <span>Màu border</span>
                    <input
                      className="text-color-picker"
                      type="color"
                      value={normalizeHexColor(activeTextOverlay?.borderColor ?? "#ffffff", "#ffffff")}
                      onChange={(event) => updateTextOverlay("borderColor", event.target.value)}
                    />
                  </label>
                </div>
                <div className="field-row">
                  <label className="field color-field">
                    <span>Màu nền border</span>
                    <div className="color-input-row">
                      <input
                        className="text-color-picker"
                        type="color"
                        value={normalizeHexColor(activeTextOverlay?.borderFill ?? "#14202e", "#14202e")}
                        onChange={(event) => updateTextOverlay("borderFill", event.target.value)}
                      />
                      <input
                        className="text-color-code"
                        type="text"
                        inputMode="text"
                        maxLength={7}
                        value={activeTextOverlay?.borderFill ?? "#14202e"}
                        placeholder="#14202E"
                        onChange={(event) => updateTextOverlay("borderFill", event.target.value)}
                        onBlur={(event) => updateTextOverlay("borderFill", normalizeHexColor(event.target.value, "#14202e"))}
                      />
                    </div>
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>Độ mờ border (%)</span>
                    <div className="number-with-unit">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={activeTextOverlay?.borderOpacity ?? 100}
                        onChange={(event) => updateTextOverlay("borderOpacity", Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
                      />
                      <b>%</b>
                    </div>
                  </label>
                </div>
                <div className="field text-position-readout">
                  <span>Vị trí hiện tại</span>
                    <b>X {Math.round(activeTextOverlay?.x ?? 50)}% · Y {Math.round(activeTextOverlay?.y ?? 18)}%</b>
                </div>
                <div className="map-decoration-manager">
                  <div className="text-overlay-list-heading">
                    <span>Trang trí trên bản đồ</span>
                    <div className="map-decoration-add-actions">
                      <button type="button" className="button secondary map-decoration-add" onClick={() => addMapDecoration("text-3d")}>＋ Chữ 3D</button>
                      <button type="button" className="button secondary map-decoration-add" onClick={() => addMapDecoration("sticker")}>＋ Sticker</button>
                      <button type="button" className="button secondary map-decoration-add" onClick={() => addMapDecoration("icon")}>＋ Icon</button>
                      <button type="button" className="button secondary map-decoration-add" onClick={() => addMapDecoration("effect")}>＋ Hiệu ứng</button>
                    </div>
                  </div>
                  <div className="map-effect-library">
                    <div className="map-effect-library-heading">
                      <span>Thư viện hiệu ứng động</span>
                      <button
                        type="button"
                        className="button secondary map-effect-library-add"
                        onClick={() => animatedEffectFileInput.current?.click()}
                      >
                        ＋ Thêm GIF / WebM / APNG
                      </button>
                      <input
                        ref={animatedEffectFileInput}
                        type="file"
                        accept=".gif,.apng,.webm,image/gif,image/apng,video/webm"
                        multiple
                        hidden
                        onChange={(event) => {
                          void addAnimatedEffectFiles(Array.from(event.target.files ?? []));
                          event.currentTarget.value = "";
                        }}
                      />
                    </div>
                    {animatedEffectAssets.length > 0 ? (
                      <div className="map-effect-library-list">
                        {animatedEffectAssets.map((item) => {
                          const previewSource = assetPreviewSource(item.name);
                          const itemType = animatedAssetTypeFromValue(item.name, item.type === "video/webm" ? "webm" : "gif");
                          return (
                            <button
                              type="button"
                              key={item.id}
                              className="map-effect-library-item"
                              draggable
                              title="Kéo hiệu ứng vào bản đồ hoặc bấm để thêm vào tâm bản đồ"
                              onClick={() => addAnimatedMapDecoration(item)}
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "copy";
                                event.dataTransfer.setData("application/x-kito-effect", item.id);
                              }}
                            >
                              <span className="map-effect-library-preview">
                                {previewSource && itemType === "webm"
                                  ? <video src={previewSource} autoPlay loop muted playsInline preload="metadata" aria-hidden="true" />
                                  : previewSource
                                    ? <img src={previewSource} alt="" draggable={false} />
                                    : <span>Chưa có preview</span>}
                              </span>
                              <strong>{item.name}</strong>
                              <span>{itemType}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="map-effect-library-empty">Thêm file GIF, APNG hoặc WebM VP9 có alpha để tạo thư viện hiệu ứng kéo thả.</div>
                    )}
                    <div className="map-effect-library-hint">Kéo một thẻ hoặc file từ máy vào bản đồ. Hiệu ứng sẽ được đặt tại vị trí thả và lưu riêng trong cảnh hiện tại.</div>
                  </div>
                  {sceneDecorations.length > 0 ? (
                    <div className="map-decoration-list">
                      {sceneDecorations.map((decoration, index) => (
                        <div key={decoration.id} className={`map-decoration-item ${decoration.id === activeDecoration?.id ? "active" : ""} ${decoration.visible === false ? "is-hidden" : ""}`}>
                          {renamingDecorationId === decoration.id ? (
                            <div className="layer-name-editor">
                              <input
                                className="layer-name-input"
                                type="text"
                                value={renamingDecorationName}
                                autoFocus
                                aria-label="Tên trang trí"
                                onChange={(event) => setRenamingDecorationName(event.target.value)}
                                onBlur={finishMapDecorationRename}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") finishMapDecorationRename();
                                  if (event.key === "Escape") cancelMapDecorationRename();
                                }}
                                onClick={(event) => event.stopPropagation()}
                              />
                            </div>
                          ) : (
                            <button type="button" className="map-decoration-select" onClick={() => setSelectedDecorationId(decoration.id)}>
                              <span>{String(index + 1).padStart(2, "0")}</span>
                              <strong>{mapDecorationLabel(decoration, index)}</strong>
                            </button>
                          )}
                          <button
                            type="button"
                            className="map-decoration-edit"
                            title="Đổi tên"
                            aria-label={`Đổi tên ${mapDecorationLabel(decoration, index)}`}
                            onClick={() => beginMapDecorationRename(decoration, index)}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="m4 16-.8 4.8L8 20l11-11a2.1 2.1 0 0 0-3-3L5 17" />
                              <path d="m14 5 5 5" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className={`map-decoration-visibility ${decoration.visible === false ? "is-hidden" : ""}`}
                            aria-label={decoration.visible === false ? `Hiện ${mapDecorationTypeLabel(decoration.type)} ${index + 1}` : `Ẩn ${mapDecorationTypeLabel(decoration.type)} ${index + 1}`}
                            title={decoration.visible === false ? "Hiện lớp" : "Ẩn lớp"}
                            onClick={() => toggleMapDecorationVisibility(decoration.id)}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M2.8 12s3.2-5 9.2-5 9.2 5 9.2 5-3.2 5-9.2 5-9.2-5-9.2-5Z" />
                              <circle cx="12" cy="12" r="2.2" />
                              {decoration.visible === false && <path d="m4 4 16 16" />}
                            </svg>
                          </button>
                          <button type="button" className="map-decoration-delete" aria-label={`Xóa lớp ${index + 1}`} onClick={() => deleteMapDecoration(decoration.id)}>×</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-overlay-empty">Chưa có chữ 3D, sticker, icon hoặc hiệu ứng.</div>
                  )}
                  {activeDecoration && (
                    <div className="map-decoration-controls">
                      {activeDecoration.type === "text-3d" && (
                        <label className="field">
                          <span>Nội dung chữ 3D</span>
                          <input type="text" value={activeDecoration.text} placeholder="ĐIỂM ĐẾN" onChange={(event) => updateMapDecoration("text", event.target.value)} />
                        </label>
                      )}
                      {activeDecoration.type === "sticker" && (
                        <label className="field">
                          <span>URL hoặc tên file sticker</span>
                          <input type="text" inputMode="url" value={activeDecoration.asset} placeholder="https://.../sticker.png" onChange={(event) => updateMapDecoration("asset", event.target.value)} />
                          <small>Sticker dùng ảnh PNG/WebP/JPG có nền trong suốt nếu muốn.</small>
                        </label>
                      )}
                      {activeDecoration.type === "animated-sticker" && (
                        <>
                          <label className="field">
                            <span>URL hoặc tên file hiệu ứng</span>
                            <input
                              type="text"
                              inputMode="url"
                              value={activeDecoration.asset}
                              placeholder="fight.gif / fight.apng / fight.webm"
                              onChange={(event) => {
                                const value = event.target.value;
                                updateMapDecoration("asset", value);
                                updateMapDecoration("assetType", animatedAssetTypeFromValue(value, activeDecoration.assetType === "webm" ? "webm" : "gif"));
                              }}
                            />
                            <small>Hỗ trợ GIF, APNG và WebM VP9 có alpha. File cục bộ cần được chọn trong thư viện render.</small>
                          </label>
                          <label className="field">
                            <span>Định dạng</span>
                            <select value={activeDecoration.assetType} onChange={(event) => updateMapDecoration("assetType", event.target.value as MapDecoration["assetType"])}>
                              <option value="gif">GIF</option>
                              <option value="apng">APNG</option>
                              <option value="webm">WebM VP9 alpha</option>
                            </select>
                          </label>
                        </>
                      )}
                      {activeDecoration.type === "icon" && (
                        <label className="field">
                          <span>Icon</span>
                          <select value={activeDecoration.symbol} onChange={(event) => updateMapDecoration("symbol", event.target.value)}>
                            <option value="📍">📍 Vị trí</option>
                            <option value="⭐">⭐ Sao</option>
                            <option value="✈️">✈️ Máy bay</option>
                            <option value="📸">📸 Ảnh</option>
                            <option value="🏷️">🏷️ Nhãn</option>
                            <option value="🌟">🌟 Điểm nhấn</option>
                          </select>
                        </label>
                      )}
                      {activeDecoration.type === "effect" && (
                        <label className="field">
                          <span>Kiểu hiệu ứng</span>
                          <select value={activeDecoration.effect} onChange={(event) => updateMapDecoration("effect", event.target.value as MapDecoration["effect"])}>
                            <option value="sparkles">✦ Lấp lánh</option>
                            <option value="ring">◉ Vòng sáng</option>
                            <option value="confetti">✺ Pháo giấy</option>
                            <option value="glow">✧ Quầng sáng</option>
                          </select>
                        </label>
                      )}
                      <div className="field-row">
                        <label className="field">
                          <span>Kích thước</span>
                          <div className="number-with-unit"><input type="number" min="14" max="120" step="1" value={activeDecoration.size} onChange={(event) => updateMapDecoration("size", Math.min(120, Math.max(14, Number(event.target.value) || 14)))} /><b>px</b></div>
                        </label>
                        <label className="field">
                          <span>Tỉ lệ</span>
                          <div className="number-with-unit"><input type="number" min="0.1" max="3" step="0.1" value={activeDecoration.scale} onChange={(event) => updateMapDecoration("scale", Math.min(3, Math.max(0.1, Number(event.target.value) || 0.1)))} /><b>x</b></div>
                        </label>
                      </div>
                      <div className="field-row">
                        <label className="field">
                          <span>Xoay</span>
                          <div className="number-with-unit"><input type="number" min="-180" max="180" step="1" value={activeDecoration.rotate} onChange={(event) => updateMapDecoration("rotate", Math.min(180, Math.max(-180, Number(event.target.value) || 0)))} /><b>°</b></div>
                        </label>
                        <label className="field">
                          <span>Độ trong suốt</span>
                          <div className="number-with-unit"><input type="number" min="0" max="100" step="1" value={activeDecoration.opacity} onChange={(event) => updateMapDecoration("opacity", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} /><b>%</b></div>
                        </label>
                      </div>
                      <div className="field-row">
                        <label className="field">
                          <span>Độ nổi 3D</span>
                          <div className="number-with-unit"><input type="number" min="0" max="16" step="1" value={activeDecoration.depth} onChange={(event) => updateMapDecoration("depth", Math.min(16, Math.max(0, Number(event.target.value) || 0)))} /><b>px</b></div>
                        </label>
                        <label className="field">
                          <span>Hiệu ứng động</span>
                          <select value={activeDecoration.animation} onChange={(event) => updateMapDecoration("animation", event.target.value as MapDecorationAnimation)}>
                            <option value="none">Không</option>
                            <option value="fade">Mờ dần</option>
                            <option value="pop">Bật nảy</option>
                            <option value="float">Trôi nhẹ</option>
                            <option value="pulse">Nhịp sáng</option>
                            <option value="spin">Xoay</option>
                          </select>
                        </label>
                      </div>
                      <div className="field-row">
                        <label className="field color-field"><span>Màu chính</span><input className="text-color-picker" type="color" value={normalizeHexColor(activeDecoration.color, "#ffd166")} onChange={(event) => updateMapDecoration("color", event.target.value)} /></label>
                        <label className="field color-field"><span>Màu chiều sâu</span><input className="text-color-picker" type="color" value={normalizeHexColor(activeDecoration.accentColor, "#7c3aed")} onChange={(event) => updateMapDecoration("accentColor", event.target.value)} /></label>
                      </div>
                      <div className="field-row">
                        <label className="field"><span>Bắt đầu</span><div className="number-with-unit"><input type="number" min="0" max={sceneDuration} step="0.1" value={activeDecoration.start} onChange={(event) => updateMapDecoration("start", Math.min(sceneDuration, Math.max(0, Number(event.target.value) || 0)))} /><b>s</b></div></label>
                        <label className="field"><span>Thời lượng</span><div className="number-with-unit"><input type="number" min="0.1" max={sceneDuration} step="0.1" value={Math.min(sceneDuration, activeDecoration.duration)} onChange={(event) => updateMapDecoration("duration", Math.min(sceneDuration, Math.max(0.1, Number(event.target.value) || 0.1)))} /><b>s</b></div></label>
                      </div>
                      <div className="field text-position-readout"><span>Vị trí hiện tại</span><b>X {Math.round(activeDecoration.x)}% · Y {Math.round(activeDecoration.y)}%</b></div>
                    </div>
                  )}
                </div>
              </div>
            </details>
            <details
              className="editor-accordion"
              open={editorSections.audio}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setEditorSections((items) => ({
                  ...items,
                  audio: open,
                }));
              }}
            >
              <summary className="editor-group-label">
                <span>05</span><strong>Âm thanh</strong>{editorSectionActions("audio")}<i />
              </summary>
              <div className="editor-accordion-content">
            <label className="field audio-field" id="editor-music">
              <span>Nhạc nền chủ đề</span>
              <div className="audio-input-row">
                <input
                  type="text"
                  inputMode="url"
                  value={backgroundMusic}
                  placeholder="background-music.mp3 hoặc URL"
                  onChange={(event) => {
                    setBackgroundMusic(event.target.value);
                    setBackgroundMusicPreview("");
                  }}
                />
                <label className="file-picker">
                  Chọn file
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        setBackgroundMusic(`audio/${file.name}`);
                        setBackgroundMusicPreview((current) => {
                          if (current) URL.revokeObjectURL(current);
                          return URL.createObjectURL(file);
                        });
                      }
                    }}
                  />
                </label>
              </div>
              <div className="field audio-volume-field">
                <span>Âm lượng nhạc nền (%)</span>
                <div className="number-with-unit">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    aria-label="Âm lượng nhạc nền (%)"
                    value={backgroundMusicVolume}
                    onChange={(event) => setBackgroundMusicVolume(clampVolume(event.target.value, 18))}
                  />
                  <b>%</b>
                </div>
              </div>
              <small>Để trống nếu clip không có nhạc nền.</small>
            </label>
            <label className="field narration-field" id="editor-narration">
              <span>Lời thuyết minh dùng để tạo phụ đề</span>
              <textarea
                rows={4}
                value={scene.narration}
                placeholder="Nhập nguyên văn nội dung của file audio…"
                onChange={(event) => updateScene("narration", event.target.value)}
              />
              <small>Nội dung này được dùng để Whisper/fallback tạo timestamp phụ đề. Có thể khác với lời thuyết minh ghi chú trong Popup.</small>
            </label>
            <label className="field audio-field" id="editor-audio">
              <span>File âm thanh thuyết minh</span>
              <div className="audio-input-row">
                <input
                  type="text"
                  inputMode="url"
                  value={scene.voiceFile}
                placeholder="voice.mp3 hoặc https://example.com/voice.mp3"
                  onChange={(event) => updateScene("voiceFile", event.target.value)}
                />
                <label className="file-picker">
                  Chọn file
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      updateScene("voiceFile", `audio/${file.name}`);
                      setAudioFiles((items) => ({ ...items, [scene.id]: file }));
                      void addAssetsToLibrary([file]);
                      setAudioPreview((items) => {
                        if (items[scene.id]) URL.revokeObjectURL(items[scene.id]);
                        return { ...items, [scene.id]: URL.createObjectURL(file) };
                      });
                    }}
                  />
                </label>
              </div>
              <div className="field audio-volume-field">
                <span>Âm lượng thuyết minh (%)</span>
                <div className="number-with-unit">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    aria-label="Âm lượng thuyết minh (%)"
                    value={scene.voiceVolume}
                    onChange={(event) => updateScene("voiceVolume", clampVolume(event.target.value, 95))}
                  />
                  <b>%</b>
                </div>
              </div>
              {audioPreview[scene.id] && (
                <audio className="audio-preview" controls src={audioPreview[scene.id]} />
              )}
              <small>Nhập tên file hoặc URL. URL âm thanh sẽ được tự tải khi render và dùng lại nếu nhiều cảnh trùng URL/tên file.</small>
            </label>
            <div className="subtitle-editor" id="editor-subtitle">
              <div className="subtitle-editor-heading">
                <div>
                  <strong>Phụ đề · rà soát timestamp</strong>
                  <small>Nhập lời thuyết minh + audio, hệ thống tự tạo cue để bạn kiểm tra và chỉnh lại.</small>
                </div>
                <div className="subtitle-editor-actions">
                  <button
                    type="button"
                    className="button primary subtitle-generate-button"
                    onClick={() => void generateSubtitlesFromNarration()}
                    disabled={subtitleAlignState.status === "running"}
                  >
                    {subtitleAlignState.status === "running" && subtitleAlignState.sceneId === scene.id
                      ? "Đang tạo…"
                      : "✦ Tạo từ lời thuyết minh"}
                  </button>
                  <button type="button" className="button subtitle-add-button" onClick={addSubtitleCue}>
                    ＋ Thêm câu
                  </button>
                  <button
                    type="button"
                    className="button subtitle-delete-all-button settings-danger-button"
                    onClick={deleteAllSubtitleCues}
                    disabled={(scene.subtitles ?? []).length === 0}
                    title="Xóa nhanh tất cả phụ đề của cảnh hiện tại"
                  >
                    ⌫ Xóa tất cả
                  </button>
                </div>
              </div>
              <div className="subtitle-align-steps">
                <span>1. Nhập <b>Lời thuyết minh</b></span>
                <span>2. Chọn <b>file audio</b></span>
                <span>3. Bấm <b>Tạo từ lời thuyết minh</b></span>
                <span>4. Phát từng cue để rà soát</span>
              </div>
              {subtitleAlignState.sceneId === scene.id && subtitleAlignState.message && (
                <p className={`subtitle-align-status is-${subtitleAlignState.status}`} role="status">
                  {subtitleAlignState.message}
                </p>
              )}
              <div className="subtitle-style-editor">
                <div className="subtitle-style-heading">
                  <strong>Tùy chỉnh chữ xuất hiện</strong>
                  <small>Áp dụng cho toàn bộ cue trong cảnh.</small>
                </div>
                <div className="field-row subtitle-style-fields">
                  <label className="field">
                    <span>Font</span>
                    <select value={subtitleStyle.font} onChange={(event) => updateSubtitleStyle("font", event.target.value as OverlayTextFont)}>
                      {(["Arial", "Verdana", "Georgia", "Tahoma", "Times New Roman", "Courier New"] as OverlayTextFont[]).map((font) => <option key={font} value={font}>{font}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>Kiểu chữ</span>
                    <select value={subtitleStyle.style} onChange={(event) => updateSubtitleStyle("style", event.target.value as SubtitleStyle["style"])}>
                      <option value="normal">Thường</option>
                      <option value="bold">Đậm</option>
                      <option value="italic">Nghiêng</option>
                      <option value="bold-italic">Đậm + nghiêng</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Style xuất hiện</span>
                    <select value={subtitleStyle.animation} onChange={(event) => updateSubtitleStyle("animation", event.target.value as SubtitleAnimation)}>
                      <option value="none">Không hiệu ứng</option>
                      <option value="fade">Fade in</option>
                      <option value="pop">Pop</option>
                      <option value="slide-up">Trượt lên</option>
                      <option value="typewriter">Hiện dần trái → phải</option>
                    </select>
                  </label>
                </div>
                <div className="field-row subtitle-style-fields">
                  <label className="field">
                    <span>Màu chữ</span>
                    <input type="color" value={subtitleStyle.color} onChange={(event) => updateSubtitleStyle("color", event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Cỡ chữ</span>
                    <div className="number-with-unit"><input type="number" min="8" max="120" value={subtitleStyle.size} onChange={(event) => updateSubtitleStyle("size", Number(event.target.value))} /><b>px</b></div>
                  </label>
                  <label className="field">
                    <span>Tốc độ xuất hiện</span>
                    <div className="number-with-unit"><input type="number" min="0.05" max="1" step="0.05" value={subtitleStyle.animationDuration} onChange={(event) => updateSubtitleStyle("animationDuration", Number(event.target.value))} /><b>s</b></div>
                  </label>
                  <label className="field">
                    <span>Chiều rộng khung chữ</span>
                    <div className="number-with-unit"><input type="number" min="40" max="100" step="1" value={subtitleStyle.boxWidth} onChange={(event) => updateSubtitleStyle("boxWidth", Math.min(100, Math.max(40, Number(event.target.value) || 40)))} /><b>%</b></div>
                  </label>
                </div>
                <div className="subtitle-border-heading"><strong>Border / nền phụ đề</strong><small>Điều chỉnh viền, màu viền, độ trong suốt và nền.</small></div>
                <div className="field-row subtitle-style-fields">
                  <label className="field">
                    <span>Độ dày border</span>
                    <div className="number-with-unit"><input type="number" min="0" max="12" step="1" value={subtitleStyle.borderWidth} onChange={(event) => updateSubtitleStyle("borderWidth", Number(event.target.value))} /><b>px</b></div>
                  </label>
                  <label className="field">
                    <span>Màu border</span>
                    <input type="color" value={subtitleStyle.borderColor} onChange={(event) => updateSubtitleStyle("borderColor", event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Màu nền</span>
                    <input type="color" value={subtitleStyle.borderFill} onChange={(event) => updateSubtitleStyle("borderFill", event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Độ trong suốt nền</span>
                    <div className="number-with-unit"><input type="number" min="0" max="100" step="5" value={subtitleStyle.borderOpacity} onChange={(event) => updateSubtitleStyle("borderOpacity", Number(event.target.value))} /><b>%</b></div>
                  </label>
                </div>
              </div>
              <label className="zoom-effect-toggle">
                <input
                  type="checkbox"
                  checked={scene.subtitleEnabled !== false}
                  disabled={!hydrated}
                  onChange={(event) => updateScene("subtitleEnabled", event.target.checked)}
                />
                <span aria-hidden="true" />
                <span>Hiện phụ đề trong bản xem trước và video</span>
              </label>
              {(scene.subtitles ?? []).length > 0 ? (
                <div className="subtitle-editor-list">
                  {(scene.subtitles ?? []).map((subtitle, index) => (
                    <div key={subtitle.id} className={`subtitle-editor-item ${subtitle.visible === false ? "is-hidden" : ""}`}>
                      <div className="subtitle-editor-item-heading">
                        <strong>Câu {index + 1}</strong>
                        <div>
                          <button
                            type="button"
                            className="subtitle-visibility-button"
                            onClick={() => toggleSubtitleCueVisibility(subtitle.id)}
                            title={subtitle.visible === false ? "Hiện câu phụ đề" : "Ẩn câu phụ đề"}
                          >
                            {subtitle.visible === false ? "Hiện" : "Ẩn"}
                          </button>
                          <button
                            type="button"
                            className="subtitle-delete-button"
                            onClick={() => deleteSubtitleCue(subtitle.id)}
                            aria-label={`Xóa câu phụ đề ${index + 1}`}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={2}
                        value={subtitle.text}
                        placeholder="Nhập nội dung phụ đề..."
                        onChange={(event) => updateSubtitleCue(subtitle.id, { text: event.target.value })}
                      />
                      <div className="field-row subtitle-timing-fields">
                        <label className="field">
                          <span>Bắt đầu</span>
                          <div className="number-with-unit">
                            <input
                              type="number"
                              min="0"
                              max={Math.max(0, sceneDuration - 0.1)}
                              step="0.1"
                              value={subtitle.start}
                              onChange={(event) => updateSubtitleCue(subtitle.id, { start: Number(event.target.value) })}
                            />
                            <b>s</b>
                          </div>
                        </label>
                        <label className="field">
                          <span>Kết thúc</span>
                          <div className="number-with-unit">
                            <input
                              type="number"
                              min="0.1"
                              max={sceneDuration}
                              step="0.1"
                              value={subtitle.end}
                              onChange={(event) => updateSubtitleCue(subtitle.id, { end: Number(event.target.value) })}
                            />
                            <b>s</b>
                          </div>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-overlay-empty">Chưa có câu phụ đề. Bấm “Thêm câu” để tạo cue đầu tiên.</div>
              )}
            </div>
              </div>
            </details>
            <details
              className="editor-accordion"
              open={editorSections.effects}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setEditorSections((items) => ({
                  ...items,
                  effects: open,
                }));
              }}
            >
              <summary className="editor-group-label">
                <span>06</span><strong>Hiệu ứng</strong>{editorSectionActions("effects")}<i />
              </summary>
              <div className="editor-accordion-content">
                <div className="zoom-settings-card scene-visual-effect-card scene-zoom-effect-card" aria-label="Hiệu ứng zoom bản đồ">
                  <div className="motion-settings-title scene-visual-effect-heading">
                    <strong>Zoom bản đồ</strong>
                    <span>Kéo vòng tròn trên bản đồ để chọn tâm zoom</span>
                  </div>
                  <label className="zoom-effect-toggle">
                    <input
                      type="checkbox"
                      checked={zoomEnabled}
                      disabled={!hydrated}
                      onChange={(event) => updateScene("zoomEnabled", event.target.checked)}
                    />
                    <span aria-hidden="true" />
                    <span>Bật hiệu ứng zoom bản đồ</span>
                  </label>
                  <div className="field-row zoom-settings-fields">
                    <label className="field">
                      <span>Thời gian bắt đầu zoom</span>
                      <div className="number-with-unit">
                        <input
                          type="number"
                          min="0"
                          max={Math.max(0, sceneDuration - 0.1)}
                          step="0.1"
                          value={scene.zoomStart}
                          disabled={!zoomEnabled}
                          onChange={(event) => updateZoomStart(Number(event.target.value))}
                        />
                        <b>giây</b>
                      </div>
                    </label>
                    <label className="field">
                      <span>Tỉ lệ zoom</span>
                      <div className="number-with-unit">
                        <input
                          type="number"
                          min="1"
                          max="5"
                          step="0.05"
                          value={scene.zoom}
                          disabled={!zoomEnabled}
                          onChange={(event) => updateScene("zoom", Number(event.target.value))}
                        />
                        <b>×</b>
                      </div>
                    </label>
                    <label className="field">
                      <span>Thời gian kết thúc zoom</span>
                      <div className="number-with-unit">
                        <input
                          type="number"
                          min={Math.min(sceneDuration, scene.zoomStart + scene.zoomInDuration)}
                          max={sceneDuration}
                          step="0.1"
                          value={scene.zoomEnd}
                          disabled={!zoomEnabled}
                          onChange={(event) => updateZoomEnd(Number(event.target.value))}
                        />
                        <b>giây</b>
                      </div>
                    </label>
                    <label className="field">
                      <span>Thời gian tới tỉ lệ đó</span>
                      <div className="number-with-unit">
                        <input
                          type="number"
                          min="0.1"
                          max={sceneDuration}
                          step="0.1"
                          value={scene.zoomInDuration}
                          disabled={!zoomEnabled}
                          onChange={(event) => updateZoomInDuration(Number(event.target.value))}
                        />
                        <b>giây</b>
                      </div>
                    </label>
                    <label className="field">
                      <span>Khoảng thời gian zoom về</span>
                      <div className="number-with-unit">
                        <input
                          type="number"
                          min="0"
                          max={sceneDuration}
                          step="0.1"
                          value={scene.zoomOutDuration}
                          disabled={!zoomEnabled}
                          onChange={(event) => updateScene("zoomOutDuration", Number(event.target.value))}
                        />
                        <b>giây</b>
                      </div>
                    </label>
                  </div>
                  <small className="zoom-settings-help">Vòng tròn màu vàng trên bản đồ chỉ là tay nắm chọn vị trí, không xuất hiện trong video.</small>
                </div>
                  <div className="scene-visual-effects">
                    <div className="scene-visual-effect-card">
                      <div className="scene-visual-effect-heading">
                        <strong>Tuyết rơi</strong>
                        <span>Hạt tuyết phủ trên bản đồ</span>
                      </div>
                      <label className="zoom-effect-toggle">
                        <input
                          type="checkbox"
                          checked={sceneEffects.snowEnabled}
                          disabled={!hydrated}
                          onChange={(event) => updateSceneEffects("snowEnabled", event.target.checked)}
                        />
                        <span aria-hidden="true" />
                        <span>Bật tuyết rơi</span>
                      </label>
                      <div className="field-row">
                        <label className="field">
                          <span>Cường độ</span>
                          <div className="number-with-unit">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={sceneEffects.snowIntensity}
                              disabled={!sceneEffects.snowEnabled}
                              onChange={(event) => updateSceneEffects("snowIntensity", Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
                            />
                            <b>%</b>
                          </div>
                        </label>
                        <label className="field">
                          <span>Tốc độ</span>
                          <div className="number-with-unit">
                            <input
                              type="number"
                              min="0.2"
                              max="3"
                              step="0.1"
                              value={sceneEffects.snowSpeed}
                              disabled={!sceneEffects.snowEnabled}
                              onChange={(event) => updateSceneEffects("snowSpeed", Math.min(3, Math.max(0.2, Number(event.target.value) || 0.2)))}
                            />
                            <b>×</b>
                          </div>
                        </label>
                      </div>
                    </div>
                    <div className="scene-visual-effect-card">
                      <div className="scene-visual-effect-heading">
                        <strong>Ánh sáng nhấp nháy</strong>
                        <span>Quầng sáng thay đổi theo nhịp</span>
                      </div>
                      <label className="zoom-effect-toggle">
                        <input
                          type="checkbox"
                          checked={sceneEffects.lightFlickerEnabled}
                          disabled={!hydrated}
                          onChange={(event) => updateSceneEffects("lightFlickerEnabled", event.target.checked)}
                        />
                        <span aria-hidden="true" />
                        <span>Bật ánh sáng nhấp nháy</span>
                      </label>
                      <div className="field-row">
                        <label className="field">
                          <span>Cường độ</span>
                          <div className="number-with-unit">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={sceneEffects.lightFlickerIntensity}
                              disabled={!sceneEffects.lightFlickerEnabled}
                              onChange={(event) => updateSceneEffects("lightFlickerIntensity", Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
                            />
                            <b>%</b>
                          </div>
                        </label>
                        <label className="field">
                          <span>Tốc độ</span>
                          <div className="number-with-unit">
                            <input
                              type="number"
                              min="0.2"
                              max="3"
                              step="0.1"
                              value={sceneEffects.lightFlickerSpeed}
                              disabled={!sceneEffects.lightFlickerEnabled}
                              onChange={(event) => updateSceneEffects("lightFlickerSpeed", Math.min(3, Math.max(0.2, Number(event.target.value) || 0.2)))}
                            />
                            <b>×</b>
                          </div>
                        </label>
                      </div>
                    </div>
                    <div className="scene-visual-effect-card">
                      <div className="scene-visual-effect-heading">
                        <strong>Mưa</strong>
                        <span>Hạt mưa rơi chéo trên bản đồ</span>
                      </div>
                      <label className="zoom-effect-toggle">
                        <input
                          type="checkbox"
                          checked={sceneEffects.rainEnabled}
                          disabled={!hydrated}
                          onChange={(event) => updateSceneEffects("rainEnabled", event.target.checked)}
                        />
                        <span aria-hidden="true" />
                        <span>Bật mưa</span>
                      </label>
                      <div className="field-row">
                        <label className="field">
                          <span>Cường độ</span>
                          <div className="number-with-unit">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={sceneEffects.rainIntensity}
                              disabled={!sceneEffects.rainEnabled}
                              onChange={(event) => updateSceneEffects("rainIntensity", Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
                            />
                            <b>%</b>
                          </div>
                        </label>
                        <label className="field">
                          <span>Tốc độ</span>
                          <div className="number-with-unit">
                            <input
                              type="number"
                              min="0.2"
                              max="3"
                              step="0.1"
                              value={sceneEffects.rainSpeed}
                              disabled={!sceneEffects.rainEnabled}
                              onChange={(event) => updateSceneEffects("rainSpeed", Math.min(3, Math.max(0.2, Number(event.target.value) || 0.2)))}
                            />
                            <b>×</b>
                          </div>
                        </label>
                      </div>
                    </div>
                    <div className="scene-visual-effect-card">
                      <div className="scene-visual-effect-heading">
                        <strong>Sấm chớp</strong>
                        <span>Ánh chớp lóe theo nhịp bất chợt</span>
                      </div>
                      <label className="zoom-effect-toggle">
                        <input
                          type="checkbox"
                          checked={sceneEffects.thunderEnabled}
                          disabled={!hydrated}
                          onChange={(event) => updateSceneEffects("thunderEnabled", event.target.checked)}
                        />
                        <span aria-hidden="true" />
                        <span>Bật sấm chớp</span>
                      </label>
                      <div className="field-row">
                        <label className="field">
                          <span>Cường độ</span>
                          <div className="number-with-unit">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={sceneEffects.thunderIntensity}
                              disabled={!sceneEffects.thunderEnabled}
                              onChange={(event) => updateSceneEffects("thunderIntensity", Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
                            />
                            <b>%</b>
                          </div>
                        </label>
                        <label className="field">
                          <span>Tốc độ</span>
                          <div className="number-with-unit">
                            <input
                              type="number"
                              min="0.2"
                              max="3"
                              step="0.1"
                              value={sceneEffects.thunderSpeed}
                              disabled={!sceneEffects.thunderEnabled}
                              onChange={(event) => updateSceneEffects("thunderSpeed", Math.min(3, Math.max(0.2, Number(event.target.value) || 0.2)))}
                            />
                            <b>×</b>
                          </div>
                        </label>
                      </div>
                    </div>
                    <div className="scene-visual-effect-card">
                      <div className="scene-visual-effect-heading">
                        <strong>Đám mây</strong>
                        <span>Mây trôi nhẹ phủ lên nền bản đồ</span>
                      </div>
                      <label className="zoom-effect-toggle">
                        <input
                          type="checkbox"
                          checked={sceneEffects.cloudEnabled}
                          disabled={!hydrated}
                          onChange={(event) => updateSceneEffects("cloudEnabled", event.target.checked)}
                        />
                        <span aria-hidden="true" />
                        <span>Bật đám mây</span>
                      </label>
                      <div className="field-row">
                        <label className="field">
                          <span>Cường độ</span>
                          <div className="number-with-unit">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={sceneEffects.cloudIntensity}
                              disabled={!sceneEffects.cloudEnabled}
                              onChange={(event) => updateSceneEffects("cloudIntensity", Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
                            />
                            <b>%</b>
                          </div>
                        </label>
                        <label className="field">
                          <span>Tốc độ</span>
                          <div className="number-with-unit">
                            <input
                              type="number"
                              min="0.2"
                              max="3"
                              step="0.1"
                              value={sceneEffects.cloudSpeed}
                              disabled={!sceneEffects.cloudEnabled}
                              onChange={(event) => updateSceneEffects("cloudSpeed", Math.min(3, Math.max(0.2, Number(event.target.value) || 0.2)))}
                            />
                            <b>×</b>
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>
                  <small className="zoom-settings-help">Các hiệu ứng được áp dụng cho cảnh đang chọn và xuất cùng thông số trong JSON render.</small>
              </div>
            </details>
            <details
              className="editor-accordion"
              open={editorSections.popup}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setEditorSections((items) => ({
                  ...items,
                  popup: open,
                }));
              }}
            >
              <summary className="editor-group-label">
                <span>07</span><strong>Popup</strong>{editorSectionActions("popup")}<i />
              </summary>
              <div className="editor-accordion-content">
            <div className="popup-manager" aria-label="Danh sách popup trong cảnh">
              <div className="popup-manager-heading">
                <strong>{scenePopups.length} popup{scenePopups.length > 1 ? "s" : ""}</strong>
                <button type="button" className="button popup-add-button" onClick={addPopup}>＋ Thêm popup</button>
              </div>
              <div className="popup-manager-list">
                {scenePopups.map((popup, index) => (
                  <div
                    key={popup.id}
                    className={`popup-manager-item ${popup.id === activePopup?.id ? "active" : ""} ${popup.visible === false ? "is-hidden" : ""}`}
                  >
                    <button
                      type="button"
                      className="popup-manager-select"
                      onClick={() => setSelectedPopupId(popup.id)}
                    >
                      <span>Popup {index + 1}</span>
                      <b>{popup.title || popup.body || "Chưa có nội dung"}</b>
                    </button>
                    <button
                      type="button"
                      className={`popup-visibility-button ${popup.visible === false ? "is-hidden" : ""}`}
                      aria-label={popup.visible === false ? `Hiện Popup ${index + 1}` : `Ẩn Popup ${index + 1}`}
                      title={popup.visible === false ? `Hiện Popup ${index + 1}` : `Ẩn Popup ${index + 1}`}
                      onClick={() => togglePopupVisibility(popup.id)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M2.8 12s3.2-5 9.2-5 9.2 5 9.2 5-3.2 5-9.2 5-9.2-5-9.2-5Z" />
                        <circle cx="12" cy="12" r="2.2" />
                        {popup.visible === false && <path d="m4 4 16 16" />}
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="popup-delete-button"
                      aria-label={`Xóa Popup ${index + 1}`}
                      title={`Xóa Popup ${index + 1}`}
                      onClick={() => deletePopup(popup.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
            {activePopup ? (
            <div className="popup-motion-settings-card" id="editor-popup">
              <div className="motion-settings-title">
                <strong>Popup {Math.max(1, scenePopups.findIndex((item) => item.id === activePopup?.id) + 1)}</strong>
                <span>Thời gian và hiệu ứng xuất hiện</span>
              </div>
              <label className="field">
                <span>Tiêu đề</span>
                <input
                  value={activePopup?.title ?? ""}
                  onChange={(event) => updatePopup("title", event.target.value)}
                />
              </label>
              <label className="field">
                <span>Nội dung cảnh</span>
                <textarea
                  value={activePopup?.body ?? ""}
                  onChange={(event) => updatePopup("body", event.target.value)}
                />
                <small>{(activePopup?.body ?? "").length}/180 ký tự</small>
              </label>
              <label className="field">
                <span>Lời thuyết minh</span>
                <textarea
                  value={activePopup?.narration ?? ""}
                  onChange={(event) => updatePopup("narration", event.target.value)}
                />
                <small>{popupWordCount} từ · Ước tính {popupVoiceEstimate} giây</small>
              </label>
              <div className="popup-design-grid">
                <label className="field">
                  <span>Bố cục popup</span>
                  <select
                    value={activePopup?.layout ?? "image-top"}
                    onChange={(event) => updatePopup("layout", event.target.value as Scene["popupLayout"])}
                  >
                    <option value="image-top">Ảnh trên · Cơ bản</option>
                    <option value="image-only">Chỉ có ảnh</option>
                    <option value="content-only">Chỉ có nội dung</option>
                    <option value="split">Ảnh trái · Nội dung phải</option>
                    <option value="quote">Trích dẫn nổi bật</option>
                    <option value="stats">Thông tin địa điểm</option>
                  </select>
                </label>
                <label className="field">
                  <span>Phong cách màu</span>
                  <select
                    value={activePopup?.theme ?? "travel"}
                    onChange={(event) => updatePopup("theme", event.target.value as Scene["popupTheme"])}
                  >
                    <option value="travel">Hành trình</option>
                    <option value="sunset">Hoàng hôn</option>
                    <option value="ocean">Đại dương</option>
                    <option value="minimal">Tối giản</option>
                  </select>
                </label>
                <label className="field">
                  <span>Hiệu ứng chữ</span>
                  <select
                    value={activePopup?.textEffect ?? "none"}
                    onChange={(event) => updatePopup("textEffect", event.target.value as Scene["popupTextEffect"])}
                  >
                    <option value="none">Không hiệu ứng</option>
                    <option value="fade">Mờ dần</option>
                    <option value="rise">Trượt lên</option>
                    <option value="pop">Bật nhẹ</option>
                  </select>
                </label>
              </div>
              <label className="field popup-border-field">
                <span>Độ dày viền popup</span>
                <div className="number-with-unit">
                  <input
                    type="number"
                    min="0"
                    max="12"
                    step="1"
                    value={activePopup?.borderWidth ?? 1}
                    onChange={(event) => updatePopup("borderWidth", Math.min(12, Math.max(0, Number(event.target.value) || 0)))}
                  />
                  <b>px</b>
                </div>
                <small>Nhập 0 để tắt viền.</small>
              </label>
              <label className="field popup-image-field">
                <span>Ảnh / video popup riêng</span>
                <input
                  type="text"
                  inputMode="url"
                  placeholder="https://example.com/image.jpg hoặc https://example.com/video.mp4"
                  value={activePopupMediaValue}
                  onChange={(event) => updatePopupMedia(event.target.value)}
                />
                <label className="popup-transparent-toggle">
                  <input
                    type="checkbox"
                    checked={activePopup?.transparentMedia === true}
                    onChange={(event) => updatePopup("transparentMedia", event.target.checked)}
                  />
                  <span />
                  Giữ nền trong suốt cho ảnh / video popup
                </label>
                {popupMediaPreviewSource && (
                  <div className="image-url-preview">
                    {popupMediaIsVideo ? (
                      <video
                        src={popupMediaPreviewSource}
                        muted
                        loop
                        playsInline
                        controls
                      />
                    ) : (
                      <img src={popupMediaPreviewSource} alt="Xem trước ảnh popup" />
                    )}
                    <span>Ảnh hoặc video này chỉ dùng cho popup đang chọn.</span>
                  </div>
                )}
              </label>
              <label className="field">
                <span>Thời gian bắt đầu xuất hiện popup</span>
                <div className="number-with-unit">
                  <input
                    type="number"
                    min="0"
                    max={Math.max(0, sceneDuration - 0.1)}
                    step="0.1"
                    value={activePopup?.start ?? 0}
                    onChange={(event) => updatePopupStart(Number(event.target.value))}
                  />
                  <b>giây</b>
                </div>
              </label>
              <label className="field range-field">
                <span>Thời gian popup</span>
                <div className="popup-duration-control">
                <input
                  type="range"
                  min="1"
                  max={Math.max(6, sceneDuration)}
                  step="0.1"
                  value={activePopup?.duration ?? 0.1}
                  onChange={(event) => updatePopupDuration(Number(event.target.value))}
                />
                <div className="number-with-unit popup-duration-number">
                  <input
                    type="number"
                    min="1"
                    max={Math.max(6, sceneDuration)}
                    step="0.1"
                    value={activePopup?.duration ?? 0.1}
                    onChange={(event) => updatePopupDuration(Number(event.target.value))}
                  />
                  <b>giây</b>
                </div>
                </div>
              </label>
              <div className="field-row">
              <label className="field">
                <span>Hiệu ứng mở</span>
                <select
                  value={activePopup?.in ?? "fade-slide-up"}
                  onChange={(event) => updatePopup("in", event.target.value)}
                >
                  <option value="fade-slide-up">Fade + trượt lên</option>
                  <option value="zoom-soft">Zoom nhẹ</option>
                  <option value="slide-left">Trượt từ trái</option>
                  <option value="slide-right">Trượt từ phải</option>
                  <option value="bounce">Nảy nhẹ</option>
                  <option value="flip">Lật 3D</option>
                </select>
              </label>
              <label className="field">
                <span>Hiệu ứng đóng</span>
                <select
                  value={activePopup?.out ?? "fade-slide-down"}
                  onChange={(event) => updatePopup("out", event.target.value)}
                >
                  <option value="fade-slide-down">Fade + trượt xuống</option>
                  <option value="zoom-soft">Thu nhỏ</option>
                  <option value="slide-left">Trượt sang trái</option>
                  <option value="slide-right">Trượt sang phải</option>
                  <option value="bounce">Nảy và biến mất</option>
                  <option value="flip">Lật 3D</option>
                </select>
              </label>
              </div>
            </div>
            ) : (
              <div className="popup-empty-state">
                <strong>Chưa có popup</strong>
                <span>Nhấn “＋ Thêm popup” để tạo popup đầu tiên cho cảnh này.</span>
              </div>
            )}
            </div>
            </details>
          </div>
        </aside>
      </section>

      <section className="timeline-panel">
        <button
          type="button"
          className="timeline-resize-handle"
          aria-label="Kéo để thay đổi chiều cao timeline"
          title={`Kéo để thay đổi chiều cao timeline · ${timelineHeight}px`}
          onPointerDown={startTimelineResize}
        >
          <span />
        </button>
        <div className="timeline-heading">
          <div>
            <h2>Timeline</h2>
            <span>{projectDuration} giây · {visibleScenes.length} cảnh hiện · {renderFps} FPS</span>
          </div>
          <div className="timeline-transport" aria-label="Điều khiển phát timeline">
            <button
              type="button"
              title="Chạy lùi 1 giây"
              aria-label="Chạy lùi 1 giây"
              disabled={!hydrated}
              onClick={() => seekTimeline(-1)}
            >
              ◀◀
            </button>
            <button
              type="button"
              className={playing ? "active" : ""}
              title="Phát"
              aria-label="Phát timeline"
              disabled={!hydrated}
              onClick={() => {
                if (!playing) togglePlayback();
              }}
            >
              ▶
            </button>
            <button
              type="button"
              className={!playing ? "active" : ""}
              title="Tạm dừng"
              aria-label="Tạm dừng timeline"
              disabled={!hydrated}
              onClick={() => setPlaying(false)}
            >
              Ⅱ
            </button>
            <button
              type="button"
              title="Chạy tới 1 giây"
              aria-label="Chạy tới 1 giây"
              disabled={!hydrated}
              onClick={() => seekTimeline(1)}
            >
              ▶▶
            </button>
          </div>
          <div className={`duration-status ${totalDuration > projectDuration ? "has-error" : ""}`}>
            <span>{totalDuration > projectDuration ? "!" : "✓"}</span>
            {totalDuration > projectDuration
              ? `Vượt giới hạn ${(totalDuration - projectDuration).toFixed(1)} giây`
              : `Tổng: ${totalDuration.toFixed(1)} giây · Không có lỗi`}
          </div>
        </div>
        <div className="timeline">
          <div className="ruler-labels">
            <span />
            <div className="ruler-scale">
              {Array.from({ length: 6 }, (_, index) => {
                const time = (projectDuration / 5) * index;
                return (
                  <i key={index} style={{ left: `${index * 20}%` }}>
                    {formatTime(time)}
                  </i>
                );
              })}
            </div>
          </div>
          <div className="track scene-time-track">
            <strong>Thời gian</strong>
            <div className="track-content grid">
              {visibleScenes.map((item) => (
                <Fragment key={`${item.id}-time`}>
                  <button
                    type="button"
                    className={`clip time-clip ${!playing && item.id === selectedId ? "selected" : ""}`}
                    onClick={() => {
                      setSelectedId(item.id);
                      setSelectedSceneIds([item.id]);
                      setSelectedPopupId("");
                      setSelectedTextOverlayId("");
                      setPlayTime(item.start);
                      setPlaying(false);
                    }}
                    style={{
                      left: timelinePercent(item.start),
                      width: timelinePercent(item.end - item.start),
                    }}
                    title={`Cảnh ${item.number}: ${formatTime(item.start)} – ${formatTime(item.end)}`}
                  >
                    <span className="time-clip-scene">{item.sceneName || `Cảnh ${item.number}`}</span>
                    <span className="time-clip-range">{formatTime(item.start)} – {formatTime(item.end)}</span>
                  </button>
                  <span className="timeline-boundary timeline-boundary-start" style={{ left: timelinePercent(item.start) }}>
                    {formatTime(item.start)}
                  </span>
                  <span className="timeline-boundary timeline-boundary-end" style={{ left: timelinePercent(item.end) }}>
                    {formatTime(item.end)}
                  </span>
                </Fragment>
              ))}
            </div>
          </div>
          <div className="track popup-track">
            <strong>Popup</strong>
            <div className="track-content grid">
              {visibleScenes.filter((item) => item.sceneVisible !== false).flatMap((item) => scenePopupList(item).map((popup) => ({ item, popup }))).filter(({ popup }) => popup.visible !== false && popupHasContent(popup)).map(({ item, popup }) => {
                const sceneLength = Math.max(0.1, item.end - item.start);
                const popupStart = Math.min(
                  sceneLength,
                  Math.max(0, Number(popup.start) || 0),
                );
                const popupDuration = Math.min(
                  Math.max(0.1, Number(popup.duration) || 0.1),
                  Math.max(0.1, sceneLength - popupStart),
                );
                const popupGlobalStart = item.start + popupStart;
                const popupGlobalEnd = popupGlobalStart + popupDuration;
                return (
                  <Fragment key={`${item.id}-${popup.id}`}>
                  <button
                    onPointerDown={(event) => startTimelinePopupDrag(event, item.id, "move", popup.id)}
                    onClick={(event) => {
                      if (timelinePopupMoved.current) {
                        event.preventDefault();
                        event.stopPropagation();
                        timelinePopupMoved.current = false;
                        return;
                      }
                      setSelectedPopupId(popup.id);
                      openTimelineEditor(item, "editor-popup");
                    }}
                    className={`clip popup-clip ${!playing && item.id === selectedId && popup.id === activePopup?.id ? "selected" : ""}`}
                    style={{
                      left: timelinePercent(popupGlobalStart),
                      width: timelinePercent(popupDuration),
                    }}
                  >
                    <span
                      className="timeline-edge-handle timeline-edge-start"
                      title="Kéo để đổi thời gian bắt đầu popup"
                      aria-label="Điểm bắt đầu popup"
                      onPointerDown={(event) => startTimelinePopupDrag(event, item.id, "start", popup.id)}
                      onClick={(event) => event.stopPropagation()}
                    />
                    <span className="timeline-clip-label">{popup.title || `Popup ${item.number}`} · {popupDuration}s</span>
                    <span
                      className="timeline-edge-handle timeline-edge-end"
                      title="Kéo để đổi thời lượng popup"
                      aria-label="Điểm kết thúc popup"
                      onPointerDown={(event) => startTimelinePopupDrag(event, item.id, "end", popup.id)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </button>
                  <span className="timeline-boundary timeline-boundary-start" style={{ left: timelinePercent(popupGlobalStart) }}>
                    {formatTime(popupGlobalStart)}
                  </span>
                  <span className="timeline-boundary timeline-boundary-end" style={{ left: timelinePercent(popupGlobalEnd) }}>
                    {formatTime(popupGlobalEnd)}
                  </span>
                  </Fragment>
                );
              })}
            </div>
          </div>
          <div className="track narration-track">
            <strong>Thuyết minh</strong>
            <div className="track-content grid">
              {narrationEnabled && visibleScenes.map((item) => (
                <Fragment key={`${item.id}-narration`}>
                <button
                  key={item.id}
                  className="clip voice-clip"
                  onClick={() => openTimelineEditor(item, "editor-audio")}
                  style={{
                    left: timelinePercent(item.start),
                    width: timelinePercent(item.end - item.start),
                  }}
                >
                  🎙 {item.voiceFile || `Thuyết minh ${item.number}`}
                </button>
                <span className="timeline-boundary timeline-boundary-start" style={{ left: timelinePercent(item.start) }}>
                  {formatTime(item.start)}
                </span>
                <span className="timeline-boundary timeline-boundary-end" style={{ left: timelinePercent(item.end) }}>
                  {formatTime(item.end)}
                </span>
                </Fragment>
              ))}
            </div>
          </div>
          <div className="track subtitle-track">
            <strong>Phụ đề</strong>
            <div className="track-content grid">
              {visibleScenes.flatMap((item) => (item.subtitleEnabled === false ? [] : (item.subtitles ?? []).map((subtitle) => ({ item, subtitle }))))
                .filter(({ subtitle }) => subtitle.visible !== false && safeTrim(subtitle.text))
                .map(({ item, subtitle }) => {
                  const sceneLength = Math.max(0.1, item.end - item.start);
                  const subtitleStart = Math.min(sceneLength, Math.max(0, Number(subtitle.start) || 0));
                  const subtitleEnd = Math.min(
                    sceneLength,
                    Math.max(subtitleStart + 0.1, Number(subtitle.end) || subtitleStart + 0.1),
                  );
                  const subtitleGlobalStart = item.start + subtitleStart;
                  const subtitleDuration = Math.max(0.1, subtitleEnd - subtitleStart);
                  return (
                    <button
                      key={`${item.id}-${subtitle.id}`}
                      type="button"
                      className="clip subtitle-clip"
                      onClick={() => {
                        setSelectedId(item.id);
                        setSelectedSceneIds([item.id]);
                        setPlaying(false);
                        openTimelineEditor(item, "editor-subtitle");
                        setPlayTime(Number(subtitleGlobalStart.toFixed(2)));
                      }}
                      style={{
                        left: timelinePercent(subtitleGlobalStart),
                        width: timelinePercent(subtitleDuration),
                      }}
                      title={`Phụ đề: ${formatTime(subtitleGlobalStart)} – ${formatTime(subtitleGlobalStart + subtitleDuration)}`}
                    >
                      <span className="timeline-clip-label">{subtitle.text}</span>
                    </button>
                  );
                })}
            </div>
          </div>
          <div
            className="timeline-playhead-layer"
            aria-label="Thanh tua timeline"
            aria-hidden={playing}
          >
            <div
              className={`playhead-grabber ${!playing ? "is-draggable" : ""}`}
              style={{ left: `${timelineProgress * 100}%` }}
              role={!playing ? "slider" : undefined}
              tabIndex={!playing ? 0 : -1}
              aria-label={!playing ? "Kéo để tua timeline" : undefined}
              aria-valuemin={!playing ? 0 : undefined}
              aria-valuemax={!playing ? projectDuration : undefined}
              aria-valuenow={!playing ? Number(playTime.toFixed(1)) : undefined}
              aria-valuetext={!playing ? formatTime(playTime) : undefined}
              onPointerDown={startTimelineScrub}
            >
              <div className={`playhead ${playing ? "is-playing" : ""}`}>
                <span>{formatTime(playTime)}</span>
              </div>
            </div>
          </div>
        </div>
              </section>
            </>
          ) : activeStudioTab === "export" ? (
            <>
              <header className="topbar export-topbar">
                <div className="export-topbar-title">
                  <button type="button" className="topbar-back-button" onClick={() => setActiveStudioTab("compose")}>
                    ← Quay lại biên soạn
                  </button>
                  <span>· {projectTitle}</span>
                </div>
                <button
                  className="button primary export-render-button"
                  onClick={() => {
                    setShowLocalRenderer(true);
                    void runRenderPreflight();
                  }}
                >
                  ▶ Render video mới
                </button>
              </header>
              <section className="export-workspace" aria-labelledby="export-heading">
                <div className="export-page-heading">
                  <div>
                    <span className="export-kicker">TRUNG TÂM XUẤT</span>
                    <h2 id="export-heading">Xuất &amp; Render</h2>
                    <p>Kiểm tra cấu hình, tài nguyên và tạo các tệp đầu ra cho dự án hiện tại.</p>
                  </div>
                  <div className="export-summary">
                    <span>{scenes.length} cảnh</span>
                    <span>{projectDuration}s</span>
                    <span>{aspectRatio} · {renderResolution}</span>
                  </div>
                </div>
                <div className="export-grid">
                  <div className="export-left-column">
                    <section className="export-card">
                      <div className="export-card-title">
                        <span className="export-card-icon" aria-hidden="true">▣</span>
                        <h3>Cài đặt render</h3>
                      </div>
                      <div className="export-field">
                        <span>Tỷ lệ khung hình dự án</span>
                        <div className="export-segmented" role="group" aria-label="Tỷ lệ khung hình dự án">
                          <button
                            type="button"
                            className={aspectRatio === "9:16" ? "active" : ""}
                            aria-pressed={aspectRatio === "9:16"}
                            onClick={() => updateAspectRatio("9:16")}
                          >
                            9:16 Dọc
                          </button>
                          <button
                            type="button"
                            className={aspectRatio === "16:9" ? "active" : ""}
                            aria-pressed={aspectRatio === "16:9"}
                            onClick={() => updateAspectRatio("16:9")}
                          >
                            16:9 Ngang
                          </button>
                        </div>
                      </div>
                      <div className="export-field">
                        <span>Độ phân giải</span>
                        <div className="export-segmented" role="group" aria-label="Độ phân giải render">
                          {resolutionOptions.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              className={renderResolution === option.value ? "active" : ""}
                              onClick={() => setRenderResolution(option.value)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="export-field-row">
                        <label className="export-field">
                          <span>Khung hình</span>
                          <select
                            value={`${renderFps} FPS`}
                            aria-label="Khung hình render"
                            onChange={(event) => setRenderFps(Number.parseInt(event.target.value, 10) as 24 | 30 | 60)}
                          >
                            <option value="30 FPS">30 FPS</option>
                            <option value="24 FPS">24 FPS</option>
                            <option value="60 FPS">60 FPS</option>
                          </select>
                        </label>
                        <label className="export-field">
                          <span>Định dạng</span>
                          <select defaultValue="MP4 (H.264)" aria-label="Định dạng render">
                            <option>MP4 (H.264)</option>
                            <option>MOV</option>
                          </select>
                        </label>
                      </div>
                      <div className="export-field">
                        <span>Tên tệp xuất</span>
                        <div className="export-file-name">{exportFileName}</div>
                      </div>
                      <div className="export-stat-row">
                        <div><span>Thời lượng</span><b>{formatTime(projectDuration)}</b></div>
                        <div><span>Số cảnh</span><b>{scenes.length}</b></div>
                        <div><span>Media thiếu</span><b className={missingRenderFiles.length ? "warning" : "ok"}>{missingRenderFiles.length}</b></div>
                      </div>
                    </section>

                    <section className="export-card">
                      <div className="export-card-title">
                        <span className="export-card-icon" aria-hidden="true">{`{}`}</span>
                        <h3>JSON dự án</h3>
                      </div>
                      <pre
                        id="export-json-preview"
                        className="export-json-preview"
                        tabIndex={0}
                        aria-live="polite"
                        aria-label="JSON dự án hiện tại"
                      >
                        {jsonPreviewCleared ? "" : exportJsonText}
                      </pre>
                      <div className="export-card-actions export-json-actions">
                        <button type="button" className="button ghost" onClick={() => void copyJson()}>⧉ Sao chép</button>
                        <button type="button" className="button ghost" onClick={focusJsonPreview}>Xem JSON</button>
                        <button type="button" className="button ghost json-clear-button" onClick={clearJsonPreview}>⌫ Xóa</button>
                        <button type="button" className="button primary" onClick={exportJson}>↓ Xuất JSON</button>
                      </div>
                    </section>

                    <section className="export-card export-prompt-card">
                      <div className="export-card-title">
                        <span className="export-card-icon prompt-icon" aria-hidden="true">✦</span>
                        <h3>Tạo prompt</h3>
                      </div>
                      <p>Prompt được tổng hợp từ cảnh, timeline, hình ảnh, âm thanh và hiệu ứng hiện tại.</p>
                      <button type="button" className="button export-prompt-button" onClick={() => setShowPromptGenerator(true)}>
                        Mở trình tạo prompt
                      </button>
                    </section>
                  </div>

                  <div className="export-right-column">
                    <div className="export-section-label">TRẠNG THÁI RENDER</div>
                    <section className="render-status-card">
                      <div className="render-status-thumb" aria-hidden="true">
                        {localRenderState.status === "completed" ? "▶" : localRenderState.status === "failed" ? "!" : "◌"}
                      </div>
                      <div className="render-status-info">
                        <strong>{exportFileName}</strong>
                        <span>{renderResolution} · {renderFps} FPS · {localRenderState.message}</span>
                        {localRenderState.status !== "idle" && localRenderState.status !== "failed" && (
                          <div className="render-progress"><i style={{ width: `${localRenderState.progress}%` }} /></div>
                        )}
                      </div>
                      <span className={`render-status-badge ${renderStatusTone}`}>{renderStatusLabel}</span>
                      <div className="render-status-actions">
                        {localRenderState.status === "completed" && localRenderState.downloadUrl ? (
                          <a className="icon-button" href={localRenderState.downloadUrl} download={exportFileName} aria-label="Tải video đã render">↓</a>
                        ) : localRenderState.status === "failed" ? (
                          <button type="button" className="icon-button" onClick={() => void runRenderPreflight()} aria-label="Kiểm tra lại">↻</button>
                        ) : null}
                      </div>
                    </section>

                    <div className="export-section-label">KIỂM TRA TRƯỚC KHI RENDER</div>
                    <section className="export-preflight-card">
                      <div className="preflight-summary">
                        <div>
                          <strong>{preflightChecks.length ? preflightChecks.filter((check) => check.status === "ok").length : 0}</strong>
                          <span>mục đạt</span>
                        </div>
                        <div>
                          <strong className={preflightChecks.some((check) => check.status === "error") ? "warning" : ""}>{preflightChecks.filter((check) => check.status === "error").length}</strong>
                          <span>mục lỗi</span>
                        </div>
                        <button type="button" className="button ghost" onClick={() => void runRenderPreflight()}>Kiểm tra lại</button>
                      </div>
                      {preflightChecks.length ? (
                        <ul className="preflight-mini-list">
                          {preflightChecks.map((check) => (
                            <li key={check.id} className={check.status}>
                              <span>{check.status === "ok" ? "✓" : check.status === "error" ? "!" : "○"}</span>
                              <b>{check.label}</b>
                              <small>{check.detail}</small>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="export-empty-note">Chưa chạy kiểm tra. Hãy kiểm tra trước khi bắt đầu render.</p>
                      )}
                    </section>
                    <p className="export-help">Các file trong thư viện tài nguyên sẽ được dùng lại cho những lần render tiếp theo.</p>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <SettingsWorkspace
              projectItems={projectItems}
              activeProjectId={projectId}
              projectTitle={projectTitle}
              aspectRatio={aspectRatio}
              assetPreviewSource={assetPreviewSource}
              onAddClip={() => setShowNewProject(true)}
              onRenameClip={renameProjectClip}
              onDuplicateClip={duplicateProjectClip}
              onDeleteClip={deleteProjectClip}
              onOpenScene={openSettingsScene}
              onSave={() => void saveProjectNow()}
              saveDisabled={!googleUser || saveStatus === "loading" || saveStatus === "saving"}
              saveLabel={saveStatus === "saving" ? "Đang lưu" : "Lưu"}
            />
          )}
        </div>
      </div>
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
      {showNewProject && (
        <div className="modal-backdrop" onMouseDown={() => setShowNewProject(false)}>
          <div className="project-modal" onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal-kicker">CLIP MỚI</span>
            <h2>Tạo chủ đề mới</h2>
            <p>Clip hiện tại vẫn được lưu. Chủ đề mới bắt đầu với một cảnh trống.</p>
            <label className="field">
              <span>Tên chủ đề</span>
              <input
                autoFocus
                value={newProjectTitle}
                placeholder="Ví dụ: Hành trình Môsê"
                onChange={(event) => setNewProjectTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") createProject();
                }}
              />
            </label>
            <div className="modal-actions">
              <button className="button ghost" onClick={() => setShowNewProject(false)}>Hủy</button>
              <button className="button primary" onClick={createProject}>Tạo và biên soạn</button>
            </div>
          </div>
        </div>
      )}
      {showPromptGenerator && (
        <div className="modal-backdrop prompt-modal-backdrop" onMouseDown={() => setShowPromptGenerator(false)}>
          <div className="project-modal prompt-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="prompt-modal-heading">
              <div>
                <span className="modal-kicker">AI VIDEO PROMPT</span>
                <h2>Trình tạo prompt</h2>
                <p>Nội dung được tạo trực tiếp từ dữ liệu JSON hiện tại, gồm tên file hình ảnh và âm thanh của từng cảnh.</p>
              </div>
              <button className="prompt-close" aria-label="Đóng" onClick={() => setShowPromptGenerator(false)}>×</button>
            </div>
            <textarea className="prompt-output" value={promptText} readOnly spellCheck={false} />
            <div className="modal-actions">
              <button className="button ghost" onClick={() => setShowPromptGenerator(false)}>Đóng</button>
              <button className="button ghost" onClick={downloadPrompt}>↓ Tải TXT</button>
              <button className="button primary" onClick={copyPrompt}>Sao chép prompt</button>
            </div>
          </div>
        </div>
      )}
      {showLocalRenderer && (
        <div className="modal-backdrop local-render-backdrop" onMouseDown={() => setShowLocalRenderer(false)}>
          <div className="project-modal local-render-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="prompt-modal-heading">
              <div>
                <span className="modal-kicker">FFMPEG · LOCAL</span>
                <h2>Render video trên máy</h2>
                <p>JSON hiện tại và các file bạn chọn sẽ được gửi tới dịch vụ FFmpeg đang chạy trên máy này.</p>
              </div>
              <button className="prompt-close" aria-label="Đóng" onClick={() => setShowLocalRenderer(false)}>×</button>
            </div>

            <div className="local-render-scroll">
              <div className={`local-render-status ${localRenderState.status}`}>
              <div className="local-render-status-heading">
                <strong>{localRenderState.message}</strong>
                <span>{Math.round(localRenderState.progress)}%</span>
              </div>
              <div className="local-render-progress">
                <i style={{ width: `${localRenderState.progress}%` }} />
              </div>
              </div>

              <section className="preflight-card" aria-live="polite">
              <div className="preflight-heading">
                <div>
                  <h3>Kiểm tra trước khi render</h3>
                  <p>Phát hiện thiếu tài nguyên, URL lỗi và trạng thái FFmpeg trước khi gửi job.</p>
                </div>
                <button className="button ghost" type="button" onClick={() => void runRenderPreflight()}>
                  Kiểm tra lại
                </button>
              </div>
              {preflightChecks.length ? (
                <ul className="preflight-list">
                  {preflightChecks.map((check) => (
                    <li key={check.id} className={check.status}>
                      <span aria-hidden="true">{check.status === "ok" ? "✓" : check.status === "warning" ? "!" : "×"}</span>
                      <div><strong>{check.label}</strong><small>{check.detail}</small></div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="local-render-note">Chưa chạy kiểm tra. Hãy bấm “Kiểm tra lại” trước khi render.</p>
              )}
              </section>

              <div className="local-render-grid">
              <section>
                <h3>Tài nguyên JSON đang yêu cầu</h3>
                {requiredRenderFiles.length ? (
                  <ul className="required-media-list">
                    {requiredRenderFiles.map((name) => (
                      <li key={name} className={localRenderFiles.some((file) => file.name === name) ? "ready" : ""}>
                        <span>{localRenderFiles.some((file) => file.name === name) ? "✓" : "○"}</span>
                        {name}
                      </li>
                    ))}
                  </ul>
                ) : <p className="local-render-note">JSON không tham chiếu file media cục bộ.</p>}
              </section>
              <section>
                <h3>Thư viện tài nguyên</h3>
                <label className="local-media-picker">
                  <strong>＋ Chọn nhiều file</strong>
                  <span>Ảnh background, ảnh popup, giọng đọc và nhạc nền</span>
                  <input
                    type="file"
                    multiple
                    accept="image/*,audio/*,video/*"
                    onChange={(event) => {
                      void addAssetsToLibrary(Array.from(event.target.files ?? []));
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <p className="local-render-note">
                  Đã chọn {localRenderFiles.length} file. File được lưu trên trình duyệt để dùng lại cho các lần render sau.
                </p>
                {assetLibrary.length > 0 && (
                  <ul className="asset-library-list">
                    {assetLibrary.map((item) => {
                      const selected = localRenderFiles.some((file) => getAssetId(file) === item.id);
                      return (
                        <li key={item.id} className={selected ? "selected" : ""}>
                          <label>
                            <input type="checkbox" checked={selected} onChange={() => toggleAssetSelection(item)} />
                            <span title={item.name}>{item.name}</span>
                          </label>
                          <button type="button" aria-label={`Xóa ${item.name} khỏi thư viện`} onClick={() => void removeAsset(item)}>×</button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              </div>

              {localRenderState.log && (
                <details className="local-render-log">
                  <summary>Chi tiết lỗi</summary>
                  <pre>{localRenderState.log}</pre>
                </details>
              )}

              <div className="local-render-help">
              <strong>Khởi động lần đầu trong thư mục dự án:</strong>
              <code>npm run render:setup</code>
              <code>npm run render:local</code>
              <small>Giữ cửa sổ lệnh mở trong suốt quá trình render.</small>
              </div>
            </div>

            <div className="modal-actions local-render-actions">
              <button className="button ghost" onClick={() => void runRenderPreflight()}>Kiểm tra kết nối</button>
              {localRenderState.status === "completed" && localRenderState.downloadUrl ? (
                <a className="button primary local-download-button" href={localRenderState.downloadUrl}>
                  ↓ Tải video MP4
                </a>
              ) : localRenderState.status === "rendering" || localRenderState.status === "cancelling" ? (
                <button
                  className="button settings-danger-button"
                  type="button"
                  disabled={localRenderState.status === "cancelling"}
                  onClick={() => void stopLocalRender()}
                >
                  {localRenderState.status === "cancelling" ? "Đang dừng…" : "Dừng render"}
                </button>
              ) : (
                <button
                  className="button primary"
                  disabled={localRenderState.status === "uploading" || localRenderState.status === "cancelling"}
                  onClick={() => void startLocalRender()}
                >
                  {localRenderState.status === "uploading" ? "Đang chuẩn bị…" : "Bắt đầu render"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function HomePage() {
  return (
    <StudioErrorBoundary>
      <Home />
    </StudioErrorBoundary>
  );
}
