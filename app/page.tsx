"use client";

import {
  Component,
  Fragment,
  type ErrorInfo,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { User as FirebaseUser } from "firebase/auth";
import {
  loadWorkspaceFromFirestore,
  observeGoogleUser,
  saveWorkspaceToFirestore,
  signInWithGoogle,
  signOutFromGoogle,
} from "./lib/firebase";
import { parseSubtitleFileText } from "./lib/subtitles";

type OverlayTextFont = "Arial" | "Verdana" | "Georgia" | "Tahoma" | "Times New Roman" | "Courier New";

type TextOverlayEffect =
  | "none"
  | "fade"
  | "slide-up"
  | "slide-down"
  | "slide-left"
  | "slide-right"
  | "typewriter"
  | "zoom"
  | "pop"
  | "glow"
  | "letter-spacing"
  | "blur"
  | "highlight-sweep"
  | "stroke-draw"
  | "shake"
  | "glitch"
  | "shadow-lift"
  | "word-by-word"
  | "kinetic";

const TEXT_OVERLAY_EFFECT_OPTIONS: Array<{ value: TextOverlayEffect; label: string }> = [
  { value: "none", label: "Không hiệu ứng" },
  { value: "fade", label: "Fade in / out" },
  { value: "slide-up", label: "Trượt lên" },
  { value: "slide-down", label: "Trượt xuống" },
  { value: "slide-left", label: "Trượt sang trái" },
  { value: "slide-right", label: "Trượt sang phải" },
  { value: "typewriter", label: "Gõ từng ký tự" },
  { value: "word-by-word", label: "Hiện từng từ" },
  { value: "zoom", label: "Zoom vào" },
  { value: "pop", label: "Pop / Bounce" },
  { value: "glow", label: "Glow pulse" },
  { value: "letter-spacing", label: "Giãn khoảng cách chữ" },
  { value: "blur", label: "Nhòe → rõ nét" },
  { value: "highlight-sweep", label: "Vệt sáng quét" },
  { value: "stroke-draw", label: "Vẽ nét viền" },
  { value: "shake", label: "Rung nhẹ" },
  { value: "glitch", label: "Glitch" },
  { value: "shadow-lift", label: "Nâng bóng đổ" },
  { value: "kinetic", label: "Kinetic text" },
];

const normalizeTextOverlayEffect = (value: unknown): TextOverlayEffect => {
  const effect = String(value ?? "none");
  return TEXT_OVERLAY_EFFECT_OPTIONS.some((option) => option.value === effect)
    ? effect as TextOverlayEffect
    : "none";
};

type TextOverlay = {
  id: string;
  name: string;
  text: string;
  visible: boolean;
  editorVisible: boolean;
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
  textEffect: TextOverlayEffect;
  textEffectDuration: number;
  start: number;
  end: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
};

type SubtitleAnimation = "none" | "fade" | "pop" | "slide-up" | "typewriter";

type SubtitleStyle = Omit<TextOverlay, "id" | "name" | "text" | "visible" | "textEffect" | "textEffectDuration" | "start" | "end"> & {
  boxWidth: number;
  boxHeight?: number;
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
type SceneImageTransition = "cut" | "crossfade" | "fade-black" | "slide-left" | "slide-right" | "zoom" | "blur";

type SceneImage = {
  id: string;
  name: string;
  url: string;
  mediaType: "image" | "video";
  spriteSheet: boolean;
  spriteDelay: number;
  transparent: boolean;
  shape: SceneImageShape;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  borderWidth: number;
  borderColor: string;
  borderFill: string;
  start: number;
  duration: number;
  transition: SceneImageTransition;
  transitionEnd: number;
  visible: boolean;
  editorVisible: boolean;
};

type AlignmentGuides = {
  vertical: number | null;
  horizontal: number | null;
};

type SnapMode = "center" | "box";
type RulerStyle = "center" | "grid" | "all";
type PreviewLayerKind = "popup" | "text" | "image" | "decoration" | "subtitle";
type PreviewLayerItem = {
  token: string;
  kind: PreviewLayerKind;
  id: string;
  label: string;
  icon: string;
};

type SceneStructureKind =
  | "background"
  | "image"
  | "popup"
  | "text"
  | "decoration"
  | "subtitle"
  | "audio"
  | "effect";

type SceneStructureTimingMode = "both" | "start" | "none";

type SceneStructureItem = {
  token: string;
  kind: SceneStructureKind;
  id: string;
  label: string;
  detail: string;
  icon: string;
  start: number;
  end: number;
  timingMode: SceneStructureTimingMode;
  canHide: boolean;
  thumbnail: string;
  thumbnailIsVideo: boolean;
};

type SceneStructureTemplateKind = "image" | "text" | "popup" | "effect" | "audio";

type SceneStructureViewMode = "timeline" | "list" | "storyboard" | "table" | "tree" | "script";

type SceneStructureTemplate = {
  kind: SceneStructureTemplateKind;
  label: string;
  description: string;
  icon: string;
  duration: number;
};

type SceneStructureTemplatePointerDrag = {
  kind: SceneStructureTemplateKind;
  pointerId: number;
  originX: number;
  originY: number;
  active: boolean;
};

type SceneStructureItemPointerDrag = {
  token: string;
  pointerId: number;
  originX: number;
  grabOffset: number;
  duration: number;
  active: boolean;
};

type SceneStructureHoverPreview = {
  localTime: number;
  left: number;
  top: number;
  label: string;
};

const SCENE_STRUCTURE_TEMPLATES: SceneStructureTemplate[] = [
  {
    kind: "image",
    label: "Hình ảnh",
    description: "Tạo lớp hình hoặc video mới",
    icon: "IMG",
    duration: 5,
  },
  {
    kind: "text",
    label: "Chữ viết",
    description: "Tạo một lớp chữ trên bản đồ",
    icon: "T",
    duration: 3,
  },
  {
    kind: "popup",
    label: "Popup",
    description: "Tạo popup nội dung mới",
    icon: "P",
    duration: 3,
  },
  {
    kind: "effect",
    label: "Hiệu ứng",
    description: "Tạo hiệu ứng ánh sáng mới",
    icon: "✦",
    duration: 3,
  },
  {
    kind: "audio",
    label: "Âm thanh",
    description: "Tạo một track âm thanh mới",
    icon: "AU",
    duration: 5,
  },
];

const SCENE_STRUCTURE_VIEW_OPTIONS: Array<{
  value: SceneStructureViewMode;
  label: string;
  icon: string;
  description: string;
}> = [
  { value: "timeline", label: "Timeline", icon: "↔", description: "Sơ đồ thời gian hiện tại" },
  { value: "list", label: "Danh sách", icon: "☰", description: "Danh sách cảnh gọn" },
  { value: "storyboard", label: "Storyboard", icon: "▦", description: "Mạch hình ảnh của clip" },
  { value: "table", label: "Bảng", icon: "▤", description: "So sánh thuộc tính" },
  { value: "tree", label: "Cây", icon: "⌘", description: "Cấu trúc thành phần" },
  { value: "script", label: "Kịch bản", icon: "✓", description: "Nội dung và kiểm tra" },
];

// Tạm ẩn minimap khỏi giao diện Cấu trúc cảnh; giữ nguyên phần render và logic
// để có thể bật lại bằng một thay đổi cấu hình nhỏ khi cần.
const SCENE_STRUCTURE_MINIMAP_ENABLED = false;

const FieldLabel = ({ children, hint }: { children: ReactNode; hint: string }) => (
  <span className="field-label-with-hint">
    <span>{children}</span>
    <span
      className="time-field-hint"
      title={hint}
      role="img"
      aria-label={`Giải thích: ${hint}`}
      tabIndex={0}
    >
      !
    </span>
  </span>
);

const TimeFieldLabel = FieldLabel;

type EditorFieldGroupProps = {
  title: string;
  description?: string;
  children: ReactNode;
  advanced?: boolean;
  className?: string;
  action?: ReactNode;
};

const EditorFieldGroup = ({
  title,
  description = "",
  children,
  advanced = false,
  className = "",
  action,
}: EditorFieldGroupProps) => {
  const heading = (
    <div className="editor-field-group-heading">
      <span className="editor-field-group-marker" aria-hidden="true">{advanced ? "＋" : "•"}</span>
      <span>
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </span>
      {action && <span className="editor-field-group-action">{action}</span>}
      {advanced && <b>Nâng cao</b>}
    </div>
  );
  if (advanced) {
    return (
      <details className={`editor-field-group editor-field-group-advanced ${className}`.trim()}>
        <summary>{heading}</summary>
        <div className="editor-field-group-content">{children}</div>
      </details>
    );
  }
  return (
    <section className={`editor-field-group ${className}`.trim()}>
      {heading}
      <div className="editor-field-group-content">{children}</div>
    </section>
  );
};

const previewLayerToken = (kind: PreviewLayerKind, id: string) => `${kind}:${id}`;

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

type SceneAudioTrack = {
  id: string;
  name: string;
  source: string;
  volume: number;
  start: number;
  end: number;
  visible: boolean;
};

const defaultSceneAudioTrack = (
  id: string,
  overrides: Partial<SceneAudioTrack> = {},
): SceneAudioTrack => ({
  id,
  name: "Thuyết minh",
  source: "",
  volume: 95,
  start: 0,
  end: 5,
  visible: true,
  ...overrides,
});

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
  avatar: string;
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
  overlayTextStart?: number;
  overlayTextEnd?: number;
  overlayTextX: number;
  overlayTextY: number;
  textOverlays: TextOverlay[];
  mapDecorations: MapDecoration[];
  sceneImages: SceneImage[];
  layerOrder?: string[];
  subtitleEnabled: boolean;
  subtitleStart: number;
  subtitleStyle: SubtitleStyle;
  subtitles: SubtitleCue[];
  popupDuration: number;
  audioTracks: SceneAudioTrack[];
  voiceFile: string;
  voiceStart: number;
  voiceVolume: number;
  popupIn: string;
  popupOut: string;
  popupStart?: number;
  popupWidth?: number;
  popupHeight?: number;
  popupImageHeight?: number;
  popupContentHeight?: number;
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

type SceneDarkEffect = {
  id: string;
  enabled: boolean;
  start: number;
  end: number;
  holdDuration: number;
  intensity: number;
};

type SceneEffects = {
  sceneStartDarkEnabled: boolean;
  sceneStartDarkDuration: number;
  sceneStartDarkIntensity: number;
  sceneStartDarkEffects: SceneDarkEffect[];
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

const defaultSceneDarkEffect = (
  id = "scene-dark-1",
  overrides: Partial<SceneDarkEffect> = {},
): SceneDarkEffect => ({
  id,
  enabled: false,
  start: 0,
  end: 1.2,
  holdDuration: 0,
  intensity: 0,
  ...overrides,
});

const defaultSceneEffects = (): SceneEffects => ({
  sceneStartDarkEnabled: false,
  sceneStartDarkDuration: 1.2,
  sceneStartDarkIntensity: 0,
  sceneStartDarkEffects: [defaultSceneDarkEffect()],
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
  imageHeight: number;
  contentHeight: number;
  borderWidth: number;
  layout: Scene["popupLayout"];
  theme: Scene["popupTheme"];
  textEffect: Scene["popupTextEffect"];
  x: number;
  y: number;
  visible: boolean;
  editorVisible: boolean;
  imageVisible: boolean;
};

type AspectRatio = "9:16" | "16:9";
type RenderResolution = "1080x1920" | "720x1280" | "1920x1080" | "1280x720";
type RenderProfile = "quality" | "fast";

const normalizeRenderProfile = (value: unknown): RenderProfile =>
  value === "fast" ? "fast" : "quality";

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
  avatar: "",
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
  layerOrder: [],
  subtitleEnabled: true,
  subtitleStart: 0,
  subtitleStyle: defaultSubtitleStyle(),
  subtitles: [],
  popupDuration: 3,
  popupStart: 0.5,
  audioTracks: [defaultSceneAudioTrack(`${id}-audio-1`, { end: 5 })],
  voiceFile: "",
  voiceStart: 0,
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

const editorVisibilityIcon = (hidden: boolean) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3.5" y="4" width="17" height="13" rx="2" />
    <path d="M9 20h6M12 17v3" />
    {hidden && <path d="m5 5 14 14" />}
  </svg>
);

const reorderById = <T extends { id: string }>(items: T[], draggedItemId: string, targetItemId: string) => {
  const fromIndex = items.findIndex((item) => item.id === draggedItemId);
  const targetIndex = items.findIndex((item) => item.id === targetItemId);
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return items;
  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  if (!movedItem) return items;
  nextItems.splice(targetIndex, 0, movedItem);
  return nextItems;
};

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(reader.error ?? new Error("Không thể đọc file sprite"));
  reader.readAsDataURL(file);
});

const formatTime = (value: number) => {
  const rounded = Math.max(0, Math.round(value * 10) / 10);
  const minutes = Math.floor(rounded / 60);
  const seconds = (rounded % 60).toFixed(1);
  return `${String(minutes).padStart(2, "0")}:${seconds.padStart(4, "0")}`;
};

const formatRenderDuration = (value: number | null | undefined) => {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

const formatPreciseTime = (value: number) => {
  const rounded = Math.max(0, Math.round(value * 100) / 100);
  const minutes = Math.floor(rounded / 60);
  const seconds = (rounded % 60).toFixed(2);
  return `${String(minutes).padStart(2, "0")}:${seconds.padStart(5, "0")}`;
};

const parsePreciseTime = (value: string, fallback: number) => {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return fallback;
  const parts = normalized.split(":");
  const seconds = parts.length === 1
    ? Number(parts[0])
    : Number(parts.at(-1)) + Number(parts.at(-2)) * 60;
  return Number.isFinite(seconds) ? seconds : fallback;
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
  return /\.(png|apng|gif|webp|webm)(?:[?#].*)?$/.test(normalized)
    || /[?&](?:format|fm)=(?:png|apng|gif|webp|webm)/.test(normalized);
};

const assetReference = (value: unknown) => {
  const trimmed = safeTrim(value);
  return isRemoteUrl(trimmed) ? trimmed : fileNameOnly(trimmed);
};

const LOCAL_STORAGE_KEY = "kito-video-studio-project";
const LOCAL_ACTIVE_PROJECT_KEY = "kito-video-studio-active-project";
const LOCAL_SAVED_AT_KEY = "kito-video-studio-project-saved-at";
const LOCAL_REVIEW_ZOOM_KEY = "kito-video-studio-review-zoom";
const LOCAL_SCENE_STRUCTURE_ZOOM_KEY = "kito-video-studio-scene-structure-zoom";
const REVIEW_ZOOM_MIN = 35;
const REVIEW_ZOOM_MAX = 200;
const REVIEW_ZOOM_DEFAULT = 50;
const SCENE_STRUCTURE_ZOOM_MIN = 75;
const SCENE_STRUCTURE_ZOOM_MAX = 200;
const SCENE_STRUCTURE_ZOOM_STEP = 25;
const SCENE_STRUCTURE_ZOOM_DEFAULT = 100;
const LOCAL_RENDERER_URL = "http://127.0.0.1:4179";
const FFMPEG_SETUP_COMMANDS = [
  "node --version",
  "npm --version",
  "npm install",
  "npm run render:setup",
].join("\r\n");
const FFMPEG_START_COMMAND = "npm run render:local";
const FFMPEG_HEALTH_COMMAND = `curl ${LOCAL_RENDERER_URL}/api/health`;

const clampReviewZoom = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return REVIEW_ZOOM_DEFAULT;
  return Math.min(REVIEW_ZOOM_MAX, Math.max(REVIEW_ZOOM_MIN, numeric));
};

const readReviewZoomPreference = () => {
  if (typeof window === "undefined") return REVIEW_ZOOM_DEFAULT;
  try {
    return clampReviewZoom(window.localStorage.getItem(LOCAL_REVIEW_ZOOM_KEY));
  } catch {
    return REVIEW_ZOOM_DEFAULT;
  }
};

const clampSceneStructureZoom = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return SCENE_STRUCTURE_ZOOM_DEFAULT;
  return Math.min(SCENE_STRUCTURE_ZOOM_MAX, Math.max(SCENE_STRUCTURE_ZOOM_MIN, numeric));
};

const readSceneStructureZoomPreference = () => {
  if (typeof window === "undefined") return SCENE_STRUCTURE_ZOOM_DEFAULT;
  try {
    return clampSceneStructureZoom(window.localStorage.getItem(LOCAL_SCENE_STRUCTURE_ZOOM_KEY));
  } catch {
    return SCENE_STRUCTURE_ZOOM_DEFAULT;
  }
};

type LocalRenderState = {
  status: "idle" | "checking" | "uploading" | "rendering" | "cancelling" | "completed" | "failed";
  progress: number;
  message: string;
  downloadUrl?: string;
  log?: string;
  logTail?: string;
  stage?: string;
  stageLabel?: string;
  detail?: string;
  scene?: number;
  totalScenes?: number;
  elapsedSeconds?: number;
  etaSeconds?: number | null;
  mediaTimeSeconds?: number;
  mediaDurationSeconds?: number;
};

type RenderedClip = {
  id: string;
  name: string;
  scope: "scene" | "project" | "joined" | string;
  sceneName?: string;
  createdAt: string;
  size: number;
  duration: number;
  compatibilityKey?: string;
  downloadUrl: string;
  profile?: {
    video?: {
      codec?: string;
      width?: number;
      height?: number;
      fps?: number;
    };
    audio?: { codec?: string } | null;
  } | null;
};

type LocalConcatState = {
  status: "idle" | "joining" | "completed" | "failed";
  progress: number;
  message: string;
  downloadUrl?: string;
  log?: string;
};

type LocalResourceCacheState = {
  status: "idle" | "syncing" | "ready" | "failed";
  message: string;
  total: number;
  cached: number;
  downloaded: number;
  failed: number;
  count: number;
  totalBytes: number;
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
  renderProfile?: RenderProfile;
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

const EDITOR_SECTION_SHORTCUTS: Array<{
  key: EditorSectionKey;
  number: string;
  label: string;
}> = [
  { key: "visual", number: "01", label: "Hình & nền" },
  { key: "content", number: "02", label: "Nội dung" },
  { key: "images", number: "03", label: "Hình ảnh" },
  { key: "text", number: "04", label: "Chữ viết" },
  { key: "audio", number: "05", label: "Âm thanh" },
  { key: "effects", number: "06", label: "Hiệu ứng" },
  { key: "popup", number: "07", label: "Popup" },
];

type EditorSectionClipboard =
  | {
      section: "visual";
      avatar: string;
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
      voiceStart: number;
      voiceVolume: number;
      audioTracks: SceneAudioTrack[];
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
  content: false,
  audio: false,
  effects: false,
  popup: false,
  text: false,
  images: false,
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

const normalizeSceneImageBorderFill = (value: unknown, fallback = "transparent") => {
  const color = String(value ?? "").trim();
  return color.toLowerCase() === "transparent" ? "transparent" : normalizeHexColor(color, fallback);
};

const sceneImageShapeOptions: Array<{ value: SceneImageShape; label: string }> = [
  { value: "rectangle", label: "Chữ nhật" },
  { value: "square", label: "Vuông" },
  { value: "circle", label: "Tròn" },
  { value: "triangle", label: "Tam giác" },
  { value: "diamond", label: "Hình thoi" },
];

const sceneImageTransitionOptions: Array<{ value: SceneImageTransition; label: string; hint: string }> = [
  { value: "cut", label: "Cắt trực tiếp", hint: "Chuyển ngay sang hình mới." },
  { value: "crossfade", label: "Crossfade", hint: "Hình cũ mờ dần khi hình mới hiện lên." },
  { value: "fade-black", label: "Fade đen", hint: "Màn hình chuyển qua màu đen rồi hiện hình mới." },
  { value: "slide-left", label: "Trượt trái", hint: "Hình mới trượt vào từ bên trái." },
  { value: "slide-right", label: "Trượt phải", hint: "Hình mới trượt vào từ bên phải." },
  { value: "zoom", label: "Zoom", hint: "Hình mới thu nhẹ từ lớn về kích thước chuẩn." },
  { value: "blur", label: "Blur", hint: "Hình mới rõ dần từ trạng thái mờ." },
];

const normalizeSceneImageTransition = (value: unknown): SceneImageTransition => {
  const transition = String(value ?? "cut") as SceneImageTransition;
  return sceneImageTransitionOptions.some((option) => option.value === transition) ? transition : "cut";
};

const sceneImageTransitionEnd = (image: Pick<SceneImage, "transition" | "start" | "transitionEnd">) =>
  normalizeSceneImageTransition(image.transition) === "cut"
    ? Math.max(0, positiveNumber(image.start, 0))
    : Math.max(
        Math.max(0, positiveNumber(image.start, 0)) + 0.1,
        positiveNumber(image.transitionEnd, 0.5, 0.1),
      );

const sceneImageTransitionDuration = (image: Pick<SceneImage, "transition" | "start" | "transitionEnd">) =>
  normalizeSceneImageTransition(image.transition) === "cut"
    ? 0
    : Math.max(
        0.1,
        sceneImageTransitionEnd(image) - Math.max(0, positiveNumber(image.start, 0)),
      );

const sceneImageTransitionNeedsOverlap = (transition: SceneImageTransition) =>
  transition === "crossfade" || transition === "slide-left" || transition === "slide-right";

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
  spriteSheet: false,
  spriteDelay: 180,
  transparent: false,
  shape: "rectangle",
  x: 50,
  y: 50,
  width: 42,
  height: 28,
  opacity: 100,
  borderWidth: 0,
  borderColor: "#ffffff",
  borderFill: "transparent",
  start: 0,
  duration: 5,
  transition: "cut",
  transitionEnd: 0.5,
  visible: true,
  editorVisible: true,
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
  const start = Math.max(0, positiveNumber(raw.start, base.start));
  const legacyTransitionDuration = Math.max(
    0.1,
    positiveNumber(
      raw.transitionDuration,
      Math.max(0.1, base.transitionEnd - base.start),
      0.1,
    ),
  );
  const transitionEnd = Math.max(
    start + 0.1,
    positiveNumber(raw.transitionEnd, start + legacyTransitionDuration),
  );
  return {
    ...base,
    id: String(raw.id ?? base.id),
    name: String(raw.name ?? base.name).trim() || base.name,
    url,
    mediaType,
    spriteSheet: raw.spriteSheet === true,
    spriteDelay: Math.min(1000, Math.max(60, positiveNumber(raw.spriteDelay, base.spriteDelay, 60))),
    transparent: typeof raw.transparent === "boolean"
      ? raw.transparent
      : raw.transparentMedia === true || isTransparentMedia(url),
    shape,
    x: clampPercent(raw.x ?? base.x, base.x),
    y: clampPercent(raw.y ?? base.y, base.y),
    width: Math.min(200, Math.max(1, positiveNumber(raw.width, base.width, 1))),
    height: Math.min(200, Math.max(1, positiveNumber(raw.height, base.height, 1))),
    opacity: Math.min(100, Math.max(0, positiveNumber(raw.opacity, base.opacity))),
    borderWidth: Math.min(12, Math.max(0, positiveNumber(raw.borderWidth, base.borderWidth))),
    borderColor: normalizeHexColor(raw.borderColor, base.borderColor),
    borderFill: normalizeSceneImageBorderFill(raw.borderFill, base.borderFill),
    start,
    duration: Math.max(0.1, positiveNumber(raw.duration, base.duration, 0.1)),
    transition: normalizeSceneImageTransition(raw.transition ?? base.transition),
    transitionEnd,
    visible: raw.visible !== false,
    editorVisible: raw.editorVisible !== false,
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
  editorVisible: true,
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
  textEffect: "none",
  textEffectDuration: 0.6,
  start: 0,
  end: 3600,
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
  const rawBoxHeight = Number(raw.boxHeight);
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
    ...(Number.isFinite(rawBoxHeight)
      ? { boxHeight: Math.min(40, Math.max(3, rawBoxHeight)) }
      : {}),
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
    editorVisible: raw.editorVisible !== false,
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
    textEffect: normalizeTextOverlayEffect(raw.textEffect ?? raw.overlayTextEffect ?? base.textEffect),
    textEffectDuration: Math.min(8, Math.max(0.05, positiveNumber(raw.textEffectDuration ?? raw.overlayTextEffectDuration, base.textEffectDuration, 0.05))),
    start: Math.min(3599.9, Math.max(0, positiveNumber(raw.start ?? raw.overlayTextStart, base.start))),
    end: Math.min(3600, Math.max(
      Math.min(3599.9, Math.max(0, positiveNumber(raw.start ?? raw.overlayTextStart, base.start))) + 0.1,
      positiveNumber(raw.end ?? raw.overlayTextEnd, base.end, 0.1),
    )),
    x: clampPercent(raw.x ?? raw.overlayTextX, base.x),
    y: clampPercent(raw.y ?? raw.overlayTextY, base.y),
    ...(Number.isFinite(Number(raw.width ?? fallback.width))
      ? { width: clampPercent(raw.width ?? fallback.width, 60) }
      : {}),
    ...(Number.isFinite(Number(raw.height ?? fallback.height))
      ? { height: clampPercent(raw.height ?? fallback.height, 10) }
      : {}),
  };
};

const clampVolume = (value: unknown, fallback = 100) => {
  const numeric = Number(value);
  return Math.min(100, Math.max(0, Number.isFinite(numeric) ? numeric : fallback));
};

const normalizeSceneAudioTrack = (
  value: unknown,
  id: string,
  sceneDuration: number,
  fallback: Partial<SceneAudioTrack> = {},
): SceneAudioTrack => {
  const raw = isRecord(value) ? value : {};
  const base = defaultSceneAudioTrack(id, fallback);
  const safeDuration = Math.max(0.1, Number(sceneDuration) || 0.1);
  const start = Math.min(
    Math.max(0, safeDuration - 0.1),
    Math.max(0, positiveNumber(raw.start, base.start)),
  );
  const end = Math.min(
    safeDuration,
    Math.max(start + 0.1, positiveNumber(raw.end, base.end, 0.1)),
  );
  return {
    id: String(raw.id ?? id),
    name: String(raw.name ?? base.name),
    source: String(raw.source ?? raw.url ?? raw.file ?? base.source),
    volume: clampVolume(raw.volume, base.volume),
    start: Number(start.toFixed(2)),
    end: Number(end.toFixed(2)),
    visible: raw.visible !== false,
  };
};

const sceneAudioTrackKey = (sceneId: string, trackId: string) => `${sceneId}::${trackId}`;

const syncLegacyVoiceFields = (scene: Scene, audioTracks: SceneAudioTrack[]): Scene => {
  const primary = audioTracks[0];
  return {
    ...scene,
    audioTracks,
    voiceFile: primary?.source ?? "",
    voiceStart: primary?.start ?? 0,
    voiceVolume: primary?.volume ?? 95,
  };
};

const normalizeSceneEffects = (value: unknown): SceneEffects => {
  const raw = isRecord(value) ? value : {};
  const legacyDarkEffect = defaultSceneDarkEffect("scene-dark-1", {
    enabled: raw.sceneStartDarkEnabled === true,
    start: 0,
    end: positiveNumber(raw.sceneStartDarkDuration, 1.2, 0.1),
    intensity: positiveNumber(raw.sceneStartDarkIntensity, 0),
  });
  const rawDarkEffects = Array.isArray(raw.sceneStartDarkEffects)
    ? raw.sceneStartDarkEffects.map((item, index) => {
        const dark = isRecord(item) ? item : {};
        const start = Math.min(3599.9, Math.max(0, positiveNumber(dark.start, 0)));
        const end = Math.min(3600, Math.max(start + 0.1, positiveNumber(dark.end, start + 1.2, 0.1)));
        const holdDuration = Math.min(
          Math.max(0, end - start - 0.1),
          Math.max(0, positiveNumber(dark.holdDuration, 0)),
        );
        return {
          ...defaultSceneDarkEffect(`scene-dark-${index + 1}`),
          id: String(dark.id ?? `scene-dark-${index + 1}`),
          enabled: dark.enabled !== false,
          start,
          end,
          holdDuration,
          intensity: Math.min(100, Math.max(0, positiveNumber(dark.intensity, 0))),
        };
      })
    : [legacyDarkEffect];
  const firstDarkEffect = rawDarkEffects[0] ?? legacyDarkEffect;
  return {
    sceneStartDarkEnabled: rawDarkEffects.some((effect) => effect.enabled),
    sceneStartDarkDuration: Math.max(0.1, firstDarkEffect.end - firstDarkEffect.start),
    sceneStartDarkIntensity: firstDarkEffect.intensity,
    sceneStartDarkEffects: rawDarkEffects,
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
): EditorSectionState => {
  const source = sections ?? DEFAULT_EDITOR_SECTIONS;
  const firstOpen = (Object.keys(DEFAULT_EDITOR_SECTIONS) as EditorSectionKey[])
    .find((section) => source[section] === true);
  return firstOpen
    ? {
        visual: firstOpen === "visual",
        content: firstOpen === "content",
        audio: firstOpen === "audio",
        effects: firstOpen === "effects",
        popup: firstOpen === "popup",
        text: firstOpen === "text",
        images: firstOpen === "images",
      }
    : {
        visual: false,
        content: false,
        audio: false,
        effects: false,
        popup: false,
        text: false,
        images: false,
      };
};

const popupDimensionLayout = (value: unknown): NonNullable<Scene["popupLayout"]> =>
  ["image-top", "split", "quote", "stats", "image-only", "content-only"].includes(String(value))
    ? value as NonNullable<Scene["popupLayout"]>
    : "image-top";

const popupDimensionHeight = (value: unknown, fallback = 255) => {
  const numeric = Number(value);
  return Math.min(440, Math.max(170, Number.isFinite(numeric) ? numeric : fallback));
};

const popupSectionDefaults = (
  layoutValue: unknown,
  heightValue = 255,
) => {
  const layout = popupDimensionLayout(layoutValue);
  const height = popupDimensionHeight(heightValue);
  if (layout === "split") return { imageHeight: height, contentHeight: height, height };
  if (layout === "image-only") return { imageHeight: height, contentHeight: 0, height };
  if (layout === "content-only" || layout === "quote") return { imageHeight: 0, contentHeight: height, height };
  const imageHeight = Math.min(115, Math.max(48, height - 48));
  return { imageHeight, contentHeight: Math.max(48, height - imageHeight), height };
};

const popupSectionGeometry = (popup: PopupConfig, showVisual = true, showText = true) => {
  const layout = popupDimensionLayout(popup.layout);
  const defaults = popupSectionDefaults(layout, popup.height);
  const imageValue = Number(popup.imageHeight);
  const contentValue = Number(popup.contentHeight);
  let imageHeight = Number.isFinite(imageValue) ? Math.max(0, imageValue) : defaults.imageHeight;
  let contentHeight = Number.isFinite(contentValue) ? Math.max(0, contentValue) : defaults.contentHeight;
  if (!showVisual) imageHeight = 0;
  if (!showText) contentHeight = 0;
  if (showVisual && !showText) imageHeight = Math.max(imageHeight, defaults.height);
  if (!showVisual && showText) contentHeight = Math.max(contentHeight, defaults.height);
  const height = layout === "split"
    ? Math.max(imageHeight, contentHeight)
    : imageHeight + contentHeight;
  return {
    layout,
    imageHeight: Math.round(imageHeight),
    contentHeight: Math.round(contentHeight),
    height: Math.round(Math.max(0, height)),
  };
};

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
  imageHeight: 115,
  contentHeight: 140,
  borderWidth: 1,
  layout: "image-top",
  theme: "travel",
  textEffect: "none",
  x: 5,
  y: 55,
  visible: true,
  editorVisible: true,
  imageVisible: true,
  ...overrides,
});

const popupConfigFromScene = (scene: Partial<Scene>, id: string): PopupConfig => {
  const layout = popupDimensionLayout(scene.popupLayout);
  const height = popupDimensionHeight(scene.popupHeight, 255);
  const defaults = popupSectionDefaults(layout, height);
  return defaultPopupConfig(id, {
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
    height,
    imageHeight: scene.popupImageHeight ?? defaults.imageHeight,
    contentHeight: scene.popupContentHeight ?? defaults.contentHeight,
    borderWidth: Math.min(12, positiveNumber(scene.popupBorderWidth, 1)),
    layout,
    theme: scene.popupTheme ?? "travel",
    textEffect: scene.popupTextEffect ?? "none",
    x: clampPercent(scene.popupX, 5),
    y: clampPercent(scene.popupY, 55),
    visible: scene.popupVisible !== false,
    imageVisible: (scene as Scene & { imageVisible?: boolean }).imageVisible !== false,
  });
};

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
  popupImageHeight: popup.imageHeight,
  popupContentHeight: popup.contentHeight,
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
  overlayTextEffect: overlay.textEffect,
  overlayTextEffectDuration: overlay.textEffectDuration,
  overlayTextStart: overlay.start,
  overlayTextEnd: overlay.end,
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
          const rawLayout = String(rawPopup.layout ?? rawPopup.popupLayout ?? fallback.layout);
          const layout = ["image-top", "split", "quote", "stats", "image-only", "content-only"].includes(rawLayout)
            ? rawLayout as Scene["popupLayout"]
            : fallback.layout;
          const height = popupDimensionHeight(rawPopup.height ?? rawPopup.popupHeight, fallback.height);
          const sectionDefaults = popupSectionDefaults(layout, height);
          const rawImageHeight = Number(rawPopup.imageHeight ?? rawPopup.popupImageHeight);
          const rawContentHeight = Number(rawPopup.contentHeight ?? rawPopup.popupContentHeight);
          return defaultPopupConfig(
            String(rawPopup.id ?? fallback.id),
            {
              ...fallback,
              title: String(rawPopup.title ?? rawPopup.popup ?? fallback.title),
              body: String(rawPopup.body ?? rawPopup.content ?? rawPopup.popup ?? fallback.body),
              narration: String(rawPopup.narration ?? rawPopup.voiceover ?? fallback.narration),
              image: String(rawPopup.image ?? fallback.image),
              video: String(rawPopup.video ?? rawPopup.popupVideo ?? fallback.video),
              transparentMedia: typeof rawPopup.transparentMedia === "boolean"
                ? rawPopup.transparentMedia
                : typeof rawPopup.popupTransparentMedia === "boolean"
                  ? rawPopup.popupTransparentMedia
                  : fallback.transparentMedia,
              start: positiveNumber(rawPopup.start ?? rawPopup.popupStart, fallback.start),
              duration: positiveNumber(rawPopup.duration ?? rawPopup.popupDuration, fallback.duration, 0.1),
              in: String(rawPopup.in ?? rawPopup.popupIn ?? fallback.in),
              out: String(rawPopup.out ?? rawPopup.popupOut ?? fallback.out),
              width: clampPercent(rawPopup.width ?? rawPopup.popupWidth, fallback.width),
              height,
              imageHeight: Number.isFinite(rawImageHeight)
                ? Math.min(440, Math.max(0, rawImageHeight))
                : sectionDefaults.imageHeight,
              contentHeight: Number.isFinite(rawContentHeight)
                ? Math.min(440, Math.max(0, rawContentHeight))
                : sectionDefaults.contentHeight,
              borderWidth: Math.min(12, positiveNumber(rawPopup.borderWidth ?? rawPopup.popupBorderWidth, fallback.borderWidth)),
              layout,
              theme: ["travel", "sunset", "ocean", "minimal"].includes(String(rawPopup.theme ?? rawPopup.popupTheme))
                ? (rawPopup.theme ?? rawPopup.popupTheme) as Scene["popupTheme"]
                : fallback.theme,
              textEffect: ["none", "fade", "rise", "pop"].includes(String(rawPopup.textEffect ?? rawPopup.popupTextEffect))
                ? (rawPopup.textEffect ?? rawPopup.popupTextEffect) as Scene["popupTextEffect"]
                : fallback.textEffect,
              x: clampPercent(rawPopup.x ?? rawPopup.popupX, fallback.x),
              y: clampPercent(rawPopup.y ?? rawPopup.popupY, fallback.y),
              visible: rawPopup.visible !== false,
              editorVisible: rawPopup.editorVisible !== false,
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
            start: (item as Scene & { overlayTextStart?: unknown }).overlayTextStart,
            end: (item as Scene & { overlayTextEnd?: unknown }).overlayTextEnd,
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
    const rawAudioTracks = (item as Scene & { audioTracks?: unknown }).audioTracks;
    const legacyAudioTrack = defaultSceneAudioTrack(`${id}-audio-1`, {
      name: "Thuyết minh",
      source: String(item.voiceFile ?? ""),
      volume: clampVolume(item.voiceVolume, 95),
      start: Math.min(sceneDuration, Math.max(0, Number(item.voiceStart ?? 0) || 0)),
      end: sceneDuration,
    });
    const audioTracks = Array.isArray(rawAudioTracks)
      ? rawAudioTracks.filter(isRecord).map((rawAudio, audioIndex) => normalizeSceneAudioTrack(
          rawAudio,
          String((rawAudio as { id?: unknown }).id ?? `${id}-audio-${audioIndex + 1}`),
          sceneDuration,
          audioIndex === 0 ? legacyAudioTrack : {
            name: `Âm thanh ${audioIndex + 1}`,
            volume: 100,
            end: sceneDuration,
          },
        ))
      : [normalizeSceneAudioTrack(legacyAudioTrack, legacyAudioTrack.id, sceneDuration, legacyAudioTrack)];
    const primaryAudioTrack = audioTracks[0];
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
      avatar: String((item as Scene & { avatar?: unknown }).avatar ?? ""),
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
      subtitleStart: Math.min(
        sceneDuration,
        Math.max(0, positiveNumber((item as Scene & { subtitleStart?: unknown }).subtitleStart, 0)),
      ),
      subtitleStyle: normalizeSubtitleStyle(rawSubtitleStyle),
      subtitles,
      audioTracks,
      voiceFile: primaryAudioTrack?.source ?? "",
      voiceStart: primaryAudioTrack?.start ?? 0,
      voiceVolume: primaryAudioTrack?.volume ?? 95,
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
  onReorderClips: (draggedProjectId: string, targetProjectId: string) => void;
  onDuplicateClip: (project: ProjectSnapshot) => ProjectSnapshot;
  onDeleteClip: (project: ProjectSnapshot) => string | null;
  onOpenScene: (project: ProjectSnapshot, scene: Scene) => void;
  onSave: () => void;
  saveDisabled: boolean;
  saveLabel: string;
};

type ResourceSpriteNotice = {
  status: "idle" | "processing" | "success" | "error";
  message: string;
};

function SettingsResourcePanel() {
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [delay, setDelay] = useState(180);
  const [delayInput, setDelayInput] = useState("180");
  const [frameSize, setFrameSize] = useState(576);
  const [assetUrl, setAssetUrl] = useState("");
  const [frameCount, setFrameCount] = useState(0);
  const [gridLabel, setGridLabel] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<ResourceSpriteNotice>({ status: "idle", message: "" });

  const updateSourceUrl = (value: string) => {
    setSourceUrl(value);
    setSourceFile(null);
    setAssetUrl("");
    setFrameCount(0);
    setGridLabel("");
    setNotice({ status: "idle", message: "" });
  };

  const updateSourceFile = (file: File | null) => {
    setSourceFile(file);
    if (file) setSourceUrl("");
    setAssetUrl("");
    setFrameCount(0);
    setGridLabel("");
    setNotice({ status: "idle", message: "" });
  };

  const updateDelayInput = (value: string) => {
    const nextInput = value.replace(/[^0-9]/g, "");
    setDelayInput(nextInput);
    if (!nextInput) return;
    const numeric = Number(nextInput);
    if (Number.isFinite(numeric)) setDelay(Math.min(1000, Math.max(60, Math.round(numeric))));
  };

  const commitDelayInput = () => {
    const nextDelay = Math.min(1000, Math.max(60, Math.round(Number(delayInput) || 180)));
    setDelay(nextDelay);
    setDelayInput(String(nextDelay));
    return nextDelay;
  };

  const convertResourceSprite = async () => {
    const committedDelay = commitDelayInput();
    const source = safeTrim(sourceUrl);
    if (!source && !sourceFile) {
      setNotice({ status: "error", message: "Hãy nhập URL hoặc chọn file sprite trước." });
      return;
    }
    if (source && (!isRemoteUrl(source) || isVideoMedia(source))) {
      setNotice({ status: "error", message: "Chỉ hỗ trợ URL hình ảnh http/https." });
      return;
    }
    setNotice({ status: "processing", message: "Đang chuyển tài nguyên thành hình động…" });
    try {
      const sourceData = sourceFile ? await fileToDataUrl(sourceFile) : "";
      const response = await fetch(`${LOCAL_RENDERER_URL}/api/process-sprite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(source ? { sourceUrl: source } : {}),
          ...(sourceFile ? { sourceData, sourceName: sourceFile.name } : {}),
          delay: committedDelay,
          frameSize,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "Không thể kết nối dịch vụ xử lý hình.");
      if (!result?.processed || !result.assetUrl) {
        throw new Error(result?.reason || "Không phát hiện được sprite trong hình này.");
      }
      const convertedFrameCount = Number(result.frameCount) || 0;
      const detectedGrid = Number(result.columns) > 0 && Number(result.rows) > 0
        ? `${Number(result.columns)}×${Number(result.rows)}`
        : "";
      setAssetUrl(String(result.assetUrl));
      setFrameCount(convertedFrameCount);
      setGridLabel(detectedGrid);
      setNotice({
        status: "success",
        message: `Đã chuyển thành WebP động${detectedGrid ? ` · tự nhận diện ${detectedGrid}` : ""}${convertedFrameCount ? ` (${convertedFrameCount} frame)` : ""}.`,
      });
    } catch (error) {
      setAssetUrl("");
      const message = error instanceof Error && error.message
        ? `Chuyển tài nguyên thất bại: ${error.message}`
        : "Chuyển tài nguyên thất bại.";
      setNotice({ status: "error", message });
    }
  };

  const clearResourceSprite = () => {
    if (isProcessing) return;
    setSourceUrl("");
    setSourceFile(null);
    setDelay(180);
    setDelayInput("180");
    setFrameSize(576);
    setAssetUrl("");
    setFrameCount(0);
    setGridLabel("");
    setNotice({ status: "idle", message: "" });
  };

  const downloadResourceSprite = async () => {
    if (!assetUrl || downloading) return;
    setDownloading(true);
    try {
      const downloadAssetUrl = `${assetUrl}${assetUrl.includes("?") ? "&" : "?"}download=1`;
      const response = await fetch(downloadAssetUrl);
      if (!response.ok) throw new Error("Không thể tải file WebP về máy.");
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = "kito-sprite-animation.webp";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      setNotice({ status: "success", message: "Đã tải hình động WebP về máy." });
    } catch (error) {
      setNotice({
        status: "error",
        message: error instanceof Error ? error.message : "Không thể tải file WebP về máy.",
      });
    } finally {
      setDownloading(false);
    }
  };

  const isProcessing = notice.status === "processing";

  return (
    <section className="settings-card settings-resource-card" aria-labelledby="settings-resource-heading">
      <div className="settings-resource-heading">
        <div>
          <span className="settings-section-label">CÔNG CỤ TÀI NGUYÊN</span>
          <h3 id="settings-resource-heading">Tài Nguyên</h3>
          <p>Chuyển sprite sheet thành WebP động trong suốt để dùng lại khi biên soạn video.</p>
        </div>
        <span className="settings-resource-badge">WEBP</span>
      </div>

      <div className="settings-resource-form">
        <label className="field settings-resource-url-field">
          <span>URL hình ảnh</span>
          <input
            type="url"
            inputMode="url"
            value={sourceUrl}
            placeholder="https://.../sprite.png"
            disabled={isProcessing}
            onChange={(event) => updateSourceUrl(event.target.value)}
          />
        </label>
        <label className="field settings-resource-file-field">
          <span>Hoặc chọn file sprite từ máy</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/apng"
            disabled={isProcessing}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              if (file && (file.type.startsWith("video/") || !file.type.startsWith("image/"))) {
                setNotice({ status: "error", message: "File sprite phải là hình PNG, JPG, WebP hoặc GIF." });
                event.currentTarget.value = "";
                return;
              }
              updateSourceFile(file);
              event.currentTarget.value = "";
            }}
          />
          <small>{sourceFile ? `Đã chọn: ${sourceFile.name}` : "Dùng trực tiếp ảnh sprite sheet 6×5 của bạn, không cần tạo URL."}</small>
        </label>
        <div className="field-row">
          <label className="field">
            <span>Tốc độ (ms/frame)</span>
            <div className="number-with-unit">
              <input
                type="number"
                min="60"
                max="1000"
                step="1"
                value={delayInput}
                disabled={isProcessing}
                onChange={(event) => updateDelayInput(event.target.value)}
                onBlur={commitDelayInput}
              />
              <b>ms</b>
            </div>
            <small>Giá trị càng lớn thì chuyển động càng chậm.</small>
                 </label>
                 <label className="field">
            <span>Kích thước frame</span>
            <div className="number-with-unit">
              <input
                type="number"
                min="128"
                max="1024"
                step="16"
                value={frameSize}
                disabled={isProcessing}
                onChange={(event) => setFrameSize(Math.min(1024, Math.max(128, Number(event.target.value) || 576)))}
              />
              <b>px</b>
            </div>
          </label>
        </div>
        <div className="settings-resource-actions">
          <button type="button" className="button primary" onClick={() => void convertResourceSprite()} disabled={isProcessing}>
            {isProcessing ? "Đang chuyển thành hình động…" : assetUrl ? "Chuyển lại hình động" : "Chuyển sang hình động"}
          </button>
          {assetUrl && (
            <button type="button" className="button ghost" onClick={() => void downloadResourceSprite()} disabled={downloading}>
              {downloading ? "Đang tải…" : "Download WebP"}
            </button>
          )}
          <button type="button" className="button ghost" onClick={clearResourceSprite} disabled={isProcessing}>
            Clear
          </button>
        </div>
        {notice.message && <small className={`settings-resource-notice ${notice.status}`}>{notice.message}</small>}
      </div>

      {assetUrl && (
        <div className="settings-resource-result">
          <div className="settings-resource-result-heading">
            <strong>Hình động đã tạo</strong>
            <span>{`${gridLabel ? `${gridLabel} · ` : ""}${frameCount ? `${frameCount} frame · ` : ""}${frameSize}px · ${delay}ms`}</span>
          </div>
          <div className="settings-resource-preview">
            <img src={assetUrl} alt="Xem trước hình động WebP" />
          </div>
        </div>
      )}
    </section>
  );
}

function SettingsWorkspace({
  projectItems,
  activeProjectId,
  projectTitle,
  aspectRatio,
  assetPreviewSource,
  onAddClip,
  onRenameClip,
  onReorderClips,
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
  const [clipDrag, setClipDrag] = useState({ draggedId: "", overId: "" });
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

  const finishClipDrop = (targetProjectId: string) => {
    if (!clipDrag.draggedId || clipDrag.draggedId === targetProjectId) {
      setClipDrag({ draggedId: "", overId: "" });
      return;
    }
    onReorderClips(clipDrag.draggedId, targetProjectId);
    setClipDrag({ draggedId: "", overId: "" });
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
  const selectedSceneImages = selectedScene?.sceneImages ?? [];
  const selectedSceneTexts = selectedScene?.textOverlays ?? [];
  const selectedScenePopups = selectedScene ? scenePopupList(selectedScene) : [];
  const selectedSceneDecorations = selectedScene?.mapDecorations ?? [];
  const selectedSceneSubtitles = selectedScene?.subtitles ?? [];
  const selectedSceneAudioTracks = selectedScene?.audioTracks ?? [];
  const selectedSceneEffectLabels = selectedScene ? [
    selectedScene.zoomEnabled !== false ? "Zoom camera" : "",
    ...(selectedScene.effects?.sceneStartDarkEffects ?? [])
      .filter((effect) => effect.enabled)
      .map((_, index) => `Tối dần ${index + 1}`),
    selectedScene.effects?.snowEnabled ? "Tuyết" : "",
    selectedScene.effects?.lightFlickerEnabled ? "Ánh sáng chớp" : "",
    selectedScene.effects?.rainEnabled ? "Mưa" : "",
    selectedScene.effects?.thunderEnabled ? "Sấm chớp" : "",
    selectedScene.effects?.cloudEnabled ? "Mây" : "",
  ].filter(Boolean) : [];
  const selectedSceneMediaSources = selectedScene ? [
    selectedScene.avatar,
    selectedScene.image,
    selectedScene.background,
    ...selectedSceneAudioTracks.map((item) => item.source),
    ...selectedSceneImages.map((item) => item.url),
    ...selectedScenePopups.flatMap((item) => [item.image, item.video]),
    ...selectedSceneDecorations.map((item) => item.asset),
  ].map(safeTrim).filter(Boolean) : [];
  const selectedSceneMediaCount = new Set(selectedSceneMediaSources).size;
  const selectedSceneVisibleLayerCount = selectedScene
    ? selectedSceneImages.filter((item) => item.visible !== false).length
      + selectedSceneTexts.filter((item) => item.visible !== false).length
      + selectedScenePopups.filter((item) => item.visible !== false).length
      + selectedSceneDecorations.filter((item) => item.visible !== false).length
      + (selectedScene.subtitleEnabled !== false && selectedSceneSubtitles.some((item) => item.visible !== false) ? 1 : 0)
    : 0;
  const selectedSceneResourceRows = selectedScene ? [
    {
      id: `${selectedScene.id}-resource-background`,
      icon: "BG",
      kind: "Nền cảnh",
      name: isVideoMedia(selectedScene.background) ? "Background video" : "Background hình ảnh",
      source: safeTrim(selectedScene.background) || "Dùng background mặc định của clip",
      meta: `${selectedScene.backgroundVisible !== false ? "Đang hiển thị" : "Đang ẩn"} · phủ toàn cảnh`,
      visible: selectedScene.backgroundVisible !== false,
    },
    ...selectedSceneAudioTracks.map((item, index) => ({
      id: item.id,
      icon: "AU",
      kind: "Âm thanh",
      name: safeTrim(item.name) || `Âm thanh ${index + 1}`,
      source: safeTrim(item.source) || "Chưa chọn file âm thanh",
      meta: `${formatTime(item.start)}–${formatTime(item.end)} · âm lượng ${item.volume}%`,
      visible: item.visible !== false,
    })),
    ...selectedSceneImages.map((item) => ({
      id: item.id,
      icon: item.mediaType === "video" ? "VD" : "IMG",
      kind: "Hình ảnh / video",
      name: item.name || "Layer hình ảnh",
      source: safeTrim(item.url) || "Chưa nhập URL hoặc tên file",
      meta: `${item.visible !== false ? "Đang hiển thị" : "Đang ẩn"} · ${formatTime(item.start)}–${formatTime(item.start + item.duration)} · ${Math.round(item.width)}% × ${Math.round(item.height)}% · opacity ${Math.round(item.opacity)}%`,
      visible: item.visible !== false,
    })),
    ...selectedScenePopups.map((item, index) => ({
      id: item.id,
      icon: "P",
      kind: "Popup",
      name: item.title || `Popup ${index + 1}`,
      source: safeTrim(item.video) || safeTrim(item.image) || safeTrim(item.body) || "Chưa có media hoặc nội dung",
      meta: `${item.visible !== false ? "Đang hiển thị" : "Đang ẩn"} · ${formatTime(item.start)}–${formatTime(item.start + item.duration)} · ${item.layout || "bố cục mặc định"} · ${item.theme || "chủ đề mặc định"}`,
      visible: item.visible !== false,
    })),
    ...selectedSceneTexts.map((item, index) => ({
      id: item.id,
      icon: "T",
      kind: "Chữ viết",
      name: item.name || `Chữ ${index + 1}`,
      source: safeTrim(item.text) || "Chưa có nội dung chữ",
      meta: `${item.visible !== false ? "Đang hiển thị" : "Đang ẩn"} · ${formatTime(item.start)}–${formatTime(item.end)} · ${item.textEffect || "không hiệu ứng"} · cỡ ${item.size}px`,
      visible: item.visible !== false,
    })),
    ...selectedSceneDecorations.map((item, index) => ({
      id: item.id,
      icon: item.type === "effect" ? "FX" : "DC",
      kind: item.type === "effect" ? "Hiệu ứng" : "Trang trí",
      name: item.name || `Trang trí ${index + 1}`,
      source: safeTrim(item.asset) || safeTrim(item.text) || item.symbol || "Không có tệp đính kèm",
      meta: `${item.visible !== false ? "Đang hiển thị" : "Đang ẩn"} · ${formatTime(item.start)}–${formatTime(item.start + item.duration)} · ${item.animation || "không chuyển động"} · opacity ${Math.round(item.opacity)}%`,
      visible: item.visible !== false,
    })),
    ...(selectedSceneSubtitles.length ? [{
      id: `${selectedScene.id}-resource-subtitles`,
      icon: "CC",
      kind: "Phụ đề",
      name: `${selectedSceneSubtitles.length} dòng phụ đề`,
      source: selectedSceneSubtitles.map((item) => item.text).filter(Boolean).join(" · ") || "Chưa có nội dung",
      meta: `${selectedScene.subtitleEnabled !== false ? "Đang bật" : "Đang tắt"} · ${selectedSceneSubtitles.filter((item) => item.visible !== false).length} dòng đang hiển thị · ${selectedScene.subtitleStyle.animation || "không hiệu ứng"}`,
      visible: selectedScene.subtitleEnabled !== false,
    }] : []),
    ...(selectedSceneEffectLabels.length ? [{
      id: `${selectedScene.id}-resource-effects`,
      icon: "FX",
      kind: "Hiệu ứng cảnh",
      name: `${selectedSceneEffectLabels.length} hiệu ứng đang bật`,
      source: selectedSceneEffectLabels.join(" · "),
      meta: "Được đồng bộ với Preview, Timeline và bộ render",
      visible: true,
    }] : []),
  ] : [];

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
                        draggable
                        className={`settings-clip-item ${project.id === selectedClip.id ? "selected" : ""} ${project.id === clipDrag.overId ? "drag-over" : ""}`}
                        onClick={() => selectClip(project)}
                        onDragStart={(event) => {
                          setClipDrag({ draggedId: project.id, overId: "" });
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", project.id);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          if (clipDrag.overId !== project.id) setClipDrag((current) => ({ ...current, overId: project.id }));
                        }}
                        onDragLeave={() => setClipDrag((current) => current.overId === project.id ? { ...current, overId: "" } : current)}
                        onDrop={(event) => {
                          event.preventDefault();
                          finishClipDrop(project.id);
                        }}
                        onDragEnd={() => setClipDrag({ draggedId: "", overId: "" })}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectClip(project);
                          }
                        }}
                        aria-pressed={project.id === selectedClip.id}
                      >
                        <span className="settings-clip-drag-handle" aria-hidden="true" title="Kéo để đổi vị trí clip">⠿</span>
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
                    const sceneMediaValue = String(item.avatar ?? "").trim()
                      || String(item.image ?? "").trim()
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
                            {(item.audioTracks ?? []).some((track) => track.visible !== false && safeTrim(track.source)) ? ` · ${(item.audioTracks ?? []).filter((track) => track.visible !== false && safeTrim(track.source)).length} âm thanh` : ""}
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
                      <section className="settings-scene-resources">
                        <h5>Thông tin tài nguyên cảnh</h5>
                        <div className="settings-scene-resource-summary">
                          <div><strong>{selectedSceneMediaCount}</strong><span>Tệp / URL</span></div>
                          <div><strong>{selectedSceneResourceRows.length}</strong><span>Mục tài nguyên</span></div>
                          <div><strong>{selectedSceneVisibleLayerCount}</strong><span>Layer đang hiện</span></div>
                          <div><strong>{selectedScene.layerOrder?.length ?? 0}</strong><span>Thứ tự layer</span></div>
                        </div>
                        <div className="settings-info-grid settings-resource-facts">
                          <div className="wide"><span>Ảnh đại diện</span><b>{selectedScene.avatar || "Chưa có"}</b></div>
                          <div className="wide"><span>Ảnh cảnh / popup cũ</span><b>{selectedScene.image || "Chưa có"}</b></div>
                          <div className="wide"><span>Background</span><b>{selectedScene.background || "Mặc định của clip"}</b></div>
                          <div className="wide"><span>Video popup cũ</span><b>{selectedScene.popupVideo || "Chưa có"}</b></div>
                          <div className="wide"><span>Âm thanh trong cảnh</span><b>{selectedSceneAudioTracks.length} track</b></div>
                          <div><span>Đang phát</span><b>{selectedSceneAudioTracks.filter((track) => track.visible !== false && safeTrim(track.source)).length}</b></div>
                          <div><span>Audio chính</span><b>{selectedSceneAudioTracks[0]?.name || "Chưa có"}</b></div>
                          <div><span>Hình / video trên bản đồ</span><b>{selectedSceneImages.length}</b></div>
                          <div><span>Popup</span><b>{selectedScenePopups.length}</b></div>
                          <div><span>Chữ viết</span><b>{selectedSceneTexts.length}</b></div>
                          <div><span>Trang trí / hiệu ứng</span><b>{selectedSceneDecorations.length}</b></div>
                          <div><span>Phụ đề</span><b>{selectedSceneSubtitles.length} dòng</b></div>
                          <div><span>Hiệu ứng cảnh đang bật</span><b>{selectedSceneEffectLabels.length}</b></div>
                        </div>
                        <details className="settings-resource-breakdown" open>
                          <summary>
                            <span>Chi tiết layer và thời gian</span>
                            <b>{selectedSceneResourceRows.length} mục</b>
                          </summary>
                          <div className="settings-resource-row-list">
                            {selectedSceneResourceRows.map((resource) => (
                              <article key={resource.id} className={resource.visible ? "is-visible" : "is-hidden"}>
                                <span className="settings-resource-row-icon" aria-hidden="true">{resource.icon}</span>
                                <div>
                                  <span>{resource.kind}</span>
                                  <strong>{resource.name}</strong>
                                  <code title={resource.source}>{resource.source}</code>
                                  <small>{resource.meta}</small>
                                </div>
                                <em>{resource.visible ? "Hiện" : "Ẩn"}</em>
                              </article>
                            ))}
                          </div>
                        </details>
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
            <SettingsResourcePanel />
          </div>
        </div>
      </section>
    </>
  );
}

type ReviewEditableProps = {
  value: string;
  label: string;
  onCommit: (value: string) => void;
  numeric?: boolean;
  multiline?: boolean;
  className?: string;
};

function ReviewEditable({ value, label, onCommit, numeric = false, multiline = false, className = "" }: ReviewEditableProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    const nextValue = draft.trim();
    if (nextValue && nextValue !== value) onCommit(nextValue);
    setEditing(false);
  };

  if (editing) {
    const editorProps = {
      autoFocus: true,
      className: `review-edit-input ${multiline ? "review-edit-textarea" : ""}`,
      value: draft,
      "aria-label": label,
      inputMode: numeric ? "decimal" as const : undefined,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
      onBlur: commit,
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.key === "Enter" && (!multiline || !event.shiftKey)) {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setDraft(value);
          setEditing(false);
        }
      },
    };
    return multiline ? <textarea {...editorProps} rows={2} /> : <input {...editorProps} type={numeric ? "number" : "text"} />;
  }

  return (
    <button
      type="button"
      className={`review-edit-value ${className}`}
      title="Double-click để chỉnh sửa"
      aria-label={`${label}: ${value}`}
      onDoubleClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      {value || "—"}
    </button>
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
  const [renamingAudioTrackId, setRenamingAudioTrackId] = useState("");
  const [renamingAudioTrackName, setRenamingAudioTrackName] = useState("");
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
  const [renderProfile, setRenderProfile] = useState<RenderProfile>("quality");
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
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const activeEditorSectionRef = useRef<EditorSectionKey | null>(
    (Object.keys(DEFAULT_EDITOR_SECTIONS) as EditorSectionKey[])
      .find((section) => DEFAULT_EDITOR_SECTIONS[section]) ?? null,
  );
  useEffect(() => {
    activeEditorSectionRef.current = (Object.keys(editorSections) as EditorSectionKey[])
      .find((section) => editorSections[section]) ?? null;
  }, [editorSections]);
  const setEditorSectionOpen = (section: EditorSectionKey, open: boolean) => {
    if (open) {
      activeEditorSectionRef.current = section;
      editorScrollRef.current?.querySelectorAll<HTMLDetailsElement>(
        "details.editor-accordion[open]",
      ).forEach((item) => {
        if (item.dataset.editorSection !== section) item.open = false;
      });
      setEditorSections(normalizeEditorSections({ [section]: true }));
      return;
    }
    if (activeEditorSectionRef.current !== section) return;
    activeEditorSectionRef.current = null;
    setEditorSections((items) => normalizeEditorSections({
      ...items,
      [section]: false,
    }));
  };
  const focusEditorSection = (section: EditorSectionKey) => {
    setEditorSectionOpen(section, true);
    window.setTimeout(() => {
      const target = editorScrollRef.current?.querySelector<HTMLDetailsElement>(
        `details[data-editor-section="${section}"]`,
      );
      if (!(target instanceof HTMLElement)) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("timeline-focus");
      window.setTimeout(() => {
        target.classList.remove("timeline-focus");
      }, 1300);
    }, 40);
  };
  const [playing, setPlaying] = useState(false);
  // A paused preview is still a playback frame. Keep this separate from
  // `playing` so the editor does not swap back to its all-layers layout when
  // the user pauses in the middle of a scene.
  const [previewPlaybackMode, setPreviewPlaybackMode] = useState(false);
  const [previewAudioMuted, setPreviewAudioMuted] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [playbackRestartToken, setPlaybackRestartToken] = useState(0);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [layerListDrag, setLayerListDrag] = useState<{
    type: "popup" | "text" | "image" | "";
    id: string;
    overId: string;
  }>({ type: "", id: "", overId: "" });
  const [previewLayerDrag, setPreviewLayerDrag] = useState({ draggedId: "", overId: "" });
  const [previewLayerQuery, setPreviewLayerQuery] = useState("");
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
    progress?: number;
  }>({ status: "idle", sceneId: "", message: "", progress: 0 });
  const [subtitleImportBusy, setSubtitleImportBusy] = useState(false);
  const [localRenderFiles, setLocalRenderFiles] = useState<File[]>([]);
  const [assetPreviewUrls, setAssetPreviewUrls] = useState<Record<string, string>>({});
  const [sceneImageSpritePreviewUrls, setSceneImageSpritePreviewUrls] = useState<Record<string, string>>({});
  const [sceneImageSpriteDelayDrafts, setSceneImageSpriteDelayDrafts] = useState<Record<string, string>>({});
  const [sceneImageTransitionEndDrafts, setSceneImageTransitionEndDrafts] = useState<Record<string, string>>({});
  const [textOverlayTimingDrafts, setTextOverlayTimingDrafts] = useState<Record<string, string>>({});
  const [sceneImageSpriteNotice, setSceneImageSpriteNotice] = useState<{
    imageId: string;
    status: "idle" | "processing" | "success" | "error";
    message: string;
  }>({ imageId: "", status: "idle", message: "" });
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
  const [renderedClips, setRenderedClips] = useState<RenderedClip[]>([]);
  const [selectedRenderedClipIds, setSelectedRenderedClipIds] = useState<string[]>([]);
  const [concatVideoName, setConcatVideoName] = useState("video-noi");
  const [localConcatState, setLocalConcatState] = useState<LocalConcatState>({
    status: "idle",
    progress: 0,
    message: "Chọn ít nhất 2 video đã render để nối nhanh.",
  });
  const [localResourceCache, setLocalResourceCache] = useState<LocalResourceCacheState>({
    status: "idle",
    message: "Chưa đọc thư viện URL đã tải trước",
    total: 0,
    cached: 0,
    downloaded: 0,
    failed: 0,
    count: 0,
    totalBytes: 0,
  });
  const [draggingZoomCenter, setDraggingZoomCenter] = useState(false);
  const [draggingTextOverlay, setDraggingTextOverlay] = useState(false);
  const [draggingMapDecoration, setDraggingMapDecoration] = useState(false);
  const [draggingSceneImage, setDraggingSceneImage] = useState(false);
  const [mapEffectDragActive, setMapEffectDragActive] = useState(false);
  const [draggingSubtitle, setDraggingSubtitle] = useState(false);
  const [draggingSubtitleResize, setDraggingSubtitleResize] = useState(false);
  const [subtitleGuideVisible, setSubtitleGuideVisible] = useState(true);
  const [rulerEnabled, setRulerEnabled] = useState(false);
  const [rulerStyle, setRulerStyle] = useState<RulerStyle>("center");
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuides>(EMPTY_ALIGNMENT_GUIDES);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [sceneStructureOpen, setSceneStructureOpen] = useState(false);
  const [sceneStructurePreviewMode, setSceneStructurePreviewMode] = useState(false);
  const [sceneStructureLibraryCollapsed, setSceneStructureLibraryCollapsed] = useState(false);
  const [sceneStructureInspectorCollapsed, setSceneStructureInspectorCollapsed] = useState(false);
  const [sceneStructureViewMode, setSceneStructureViewMode] = useState<SceneStructureViewMode>("timeline");
  const [sceneStructureZoom, setSceneStructureZoom] = useState(readSceneStructureZoomPreference);
  const [sceneStructureSceneId, setSceneStructureSceneId] = useState("");
  const [sceneStructureSceneDragId, setSceneStructureSceneDragId] = useState("");
  const [sceneStructureSceneDragOverId, setSceneStructureSceneDragOverId] = useState("");
  const [selectedSceneStructureToken, setSelectedSceneStructureToken] = useState("");
  const [sceneStructureQuickEditToken, setSceneStructureQuickEditToken] = useState("");
  const [sceneStructureStartDraft, setSceneStructureStartDraft] = useState("");
  const [sceneStructureEndDraft, setSceneStructureEndDraft] = useState("");
  const [sceneStructureDraggedTemplate, setSceneStructureDraggedTemplate] = useState<SceneStructureTemplateKind | "">("");
  const [sceneStructureDropTime, setSceneStructureDropTime] = useState<number | null>(null);
  const [sceneStructureItemDragToken, setSceneStructureItemDragToken] = useState("");
  const [sceneStructureHoverPreview, setSceneStructureHoverPreview] = useState<SceneStructureHoverPreview | null>(null);
  const [sceneStructurePreviewPortalHost, setSceneStructurePreviewPortalHost] = useState<HTMLDivElement | null>(null);
  const [sceneStructureMinimapViewport, setSceneStructureMinimapViewport] = useState({ left: 0, width: 100 });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewZoom, setReviewZoom] = useState(readReviewZoomPreference);
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
  const [timelineZoom, setTimelineZoom] = useState(100);
  const [zoomInputDrafts, setZoomInputDrafts] = useState<Record<string, string>>({});
  const [effectInputDrafts, setEffectInputDrafts] = useState<Record<string, string>>({});
  const animationFrame = useRef<number | null>(null);
  const subtitleFileInput = useRef<HTMLInputElement | null>(null);
  const narrationAudio = useRef<HTMLAudioElement | null>(null);
  const sceneAudioPlayers = useRef<Array<{ audio: HTMLAudioElement; startTimer?: number; stopTimer?: number }>>([]);
  const playTimeRef = useRef(playTime);
  const backgroundMusicAudio = useRef<HTMLAudioElement | null>(null);
  const backgroundVideoRef = useRef<HTMLVideoElement | null>(null);
  const animatedEffectFileInput = useRef<HTMLInputElement | null>(null);
  const historyPast = useRef<ProjectSnapshot[]>([]);
  const historyFuture = useRef<ProjectSnapshot[]>([]);
  const historySnapshot = useRef("");
  const historyApplying = useRef(false);
  const [, setHistoryVersion] = useState(0);
  const timelinePopupMoved = useRef(false);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineZoomRef = useRef(100);
  const reviewZoomRef = useRef(readReviewZoomPreference());
  const rulerToggleRef = useRef<HTMLButtonElement | null>(null);
  const rulerPopoverRef = useRef<HTMLDivElement | null>(null);
  const sceneStructureTemplateDidDrag = useRef(false);
  const sceneStructureTemplatePointerDrag = useRef<SceneStructureTemplatePointerDrag | null>(null);
  const sceneStructureTemplateMouseCleanup = useRef<(() => void) | null>(null);
  const sceneStructureItemPointerDrag = useRef<SceneStructureItemPointerDrag | null>(null);
  const sceneStructureItemDidDrag = useRef(false);
  const sceneStructureFlowContentRef = useRef<HTMLDivElement | null>(null);
  const sceneStructureFlowScrollRef = useRef<HTMLDivElement | null>(null);
  const sceneStructureMinimapPointerId = useRef<number | null>(null);
  const [rulerPopoverPosition, setRulerPopoverPosition] = useState({ top: 8, left: 8 });
  const localRenderJobId = useRef("");
  const localConcatJobId = useRef("");

  // Keep the latest timeline position available to media readiness callbacks.
  // Audio files can finish loading after the playhead has already advanced.
  playTimeRef.current = playTime;

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
  const activeSceneImageSpriteDelayInput = activeSceneImage
    ? sceneImageSpriteDelayDrafts[activeSceneImage.id] ?? String(activeSceneImage.spriteDelay)
    : "";
  const activeSceneImageTransitionEndInput = activeSceneImage
    ? sceneImageTransitionEndDrafts[activeSceneImage.id] ?? String(activeSceneImage.transitionEnd)
    : "";
  const totalDuration = Math.max(0, ...visibleScenes.map((item) => item.end));
  const sceneTimelineDuration = Math.max(1, Number(totalDuration.toFixed(2)));
  const renderDuration = Math.max(projectDuration, totalDuration);
  const timelineLength = Math.max(0.1, projectDuration);
  const timelineCanvasWidth = Math.max(320, Math.ceil(projectDuration * 16 * (timelineZoom / 100)));
  const timelinePercent = (time: number) => `${Math.min(100, Math.max(0, (time / timelineLength) * 100))}%`;
  const handleTimelineWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) < 0.5) return;
    event.preventDefault();
    const viewport = event.currentTarget;
    const oldZoom = timelineZoomRef.current;
    const nextZoom = Math.min(300, Math.max(50, oldZoom + (event.deltaY < 0 ? 10 : -10)));
    if (nextZoom === oldZoom) return;
    const bounds = viewport.getBoundingClientRect();
    const pointerOffset = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const contentPosition = viewport.scrollLeft + pointerOffset;
    const scaleRatio = nextZoom / oldZoom;
    timelineZoomRef.current = nextZoom;
    setTimelineZoom(nextZoom);
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, contentPosition * scaleRatio - pointerOffset);
    });
  };
  const resolutionOptions = resolutionOptionsFor(aspectRatio);
  const updateAspectRatio = (nextAspectRatio: AspectRatio) => {
    setAspectRatio(nextAspectRatio);
    setRenderResolution(defaultResolutionFor(nextAspectRatio));
  };
  const adjustPreviewZoom = (delta: number) => {
    setPreviewZoom((value) => Math.min(125, Math.max(75, value + delta)));
  };
  const adjustSceneStructureZoom = (delta: number) => {
    setSceneStructureZoom((value) => Math.min(
      SCENE_STRUCTURE_ZOOM_MAX,
      Math.max(SCENE_STRUCTURE_ZOOM_MIN, value + delta),
    ));
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
  const legacyBackgroundPreview = safeTrim(previewBackground) || safeTrim(background);
  const sceneBackgroundValue = String(scene.background ?? "").trim();
  const backgroundValue = sceneBackgroundValue || legacyBackgroundPreview;
  const backgroundPreviewSource = assetPreviewSource(backgroundValue);
  const sceneAvatarPreviewSource = assetPreviewSource(scene.avatar ?? "");
  const backgroundIsVideo = isVideoMedia(backgroundValue);
  const backgroundVideoPreviewSource = backgroundIsVideo ? backgroundPreviewSource : "";
  const sceneDuration = Math.max(0.1, scene.end - scene.start);
  const sceneAudioTracks = Array.isArray(scene.audioTracks) ? scene.audioTracks : [];
  const audioTrackPreviewSource = (track: SceneAudioTrack, index: number) =>
    audioPreview[sceneAudioTrackKey(scene.id, track.id)]
      || (index === 0 ? audioPreview[scene.id] : "")
      || assetPreviewSource(track.source);
  const musicPreviewSource =
    backgroundMusicPreview || assetPreviewSource(backgroundMusic);
  const sceneLocalTime = Math.min(
    sceneDuration,
    Math.max(0, playTime - scene.start),
  );
  const sceneStartDarkEffects = sceneEffects.sceneStartDarkEffects;
  const sceneStartDarkEffectProgress = (effect: SceneDarkEffect, localTime = sceneLocalTime) => {
    const start = Math.max(0, Number(effect.start) || 0);
    const end = Math.max(start + 0.1, Number(effect.end) || start + 1.2);
    const duration = end - start;
    const holdDuration = Math.min(
      Math.max(0, duration - 0.1),
      Math.max(0, Number(effect.holdDuration) || 0),
    );
    const transitionDuration = Math.max(0.1, duration - holdDuration);
    const halfDuration = transitionDuration / 2;
    const elapsed = localTime - start;
    if (elapsed <= 0 || elapsed >= duration) return 0;
    if (elapsed < halfDuration) return elapsed / halfDuration;
    if (elapsed < halfDuration + holdDuration) return 1;
    return Math.max(0, (duration - elapsed) / halfDuration);
  };
  const sceneStartDarkOverlayItemsAtTime = (localTime: number) => sceneStartDarkEffects
    .filter((effect) => {
      const start = Math.max(0, Number(effect.start) || 0);
      const end = Math.max(start + 0.1, Number(effect.end) || start + 1.2);
      return effect.enabled && localTime >= start && localTime < end;
    })
    .map((effect) => {
      const progress = sceneStartDarkEffectProgress(effect, localTime);
      const easedProgress = progress * progress * (3 - 2 * progress);
      const strength = 1 - Math.min(100, Math.max(0, Number(effect.intensity) || 0)) / 100;
      const edgeOpacity = Math.min(0.74, easedProgress * 0.9 * strength);
      const centerOpacity = Math.min(0.46, Math.max(0, (easedProgress - 0.7) / 0.3) * 0.46 * strength);
      return {
        effect,
        clearRadius: Math.max(0, 150 * (1 - easedProgress)),
        edgeOpacity,
        midOpacity: Math.min(0.62, edgeOpacity * 0.8 + centerOpacity * 0.2),
        centerOpacity,
        blur: Math.round(easedProgress * 8),
      };
    });
  const sceneStartDarkOverlayItems = sceneStartDarkOverlayItemsAtTime(sceneLocalTime);
  const sceneImagePlaybackWindow = (image: SceneImage, imageIndex: number) => {
    const start = Math.min(sceneDuration, Math.max(0, Number(image.start) || 0));
    const baseEnd = start + Math.max(0.1, Number(image.duration) || 0.1);
    const transition = normalizeSceneImageTransition(image.transition);
    const ownTransitionEnd = transition === "cut"
      ? start
      : sceneImageTransitionEnd(image);
    const end = Math.min(sceneDuration, Math.max(baseEnd, ownTransitionEnd));
    const nextImage = sceneImages[imageIndex + 1];
    if (!nextImage) return { start, end };
    const nextStart = Math.min(sceneDuration, Math.max(0, Number(nextImage.start) || 0));
    const nextTransition = normalizeSceneImageTransition(nextImage.transition);
    if (!sceneImageTransitionNeedsOverlap(nextTransition)) return { start, end };
    const overlapEnd = nextStart + sceneImageTransitionDuration(nextImage);
    return { start, end: Math.min(sceneDuration, Math.max(end, overlapEnd)) };
  };
  const sceneImagePreviewTransition = (image: SceneImage, time = sceneLocalTime) => {
    const transition = normalizeSceneImageTransition(image.transition);
    const duration = sceneImageTransitionDuration(image);
    const start = Math.min(sceneDuration, Math.max(0, Number(image.start) || 0));
    const progress = duration > 0
      ? Math.min(1, Math.max(0, (time - start) / duration))
      : 1;
    if (!previewPlaybackMode || transition === "cut" || time < start) {
      return { transition, progress: 1 };
    }
    return { transition, progress };
  };
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
  const sceneIsVisibleInPlayback = sceneStructurePreviewMode || !previewPlaybackMode || visibleScenes.some((item) =>
    item.id === scene.id && playTime >= item.start && playTime < item.end,
  );
  const textOverlayTiming = (overlay: TextOverlay) => {
    const start = Math.min(sceneDuration, Math.max(0, Number(overlay.start) || 0));
    const end = Math.min(
      sceneDuration,
      Math.max(start + 0.1, Number(overlay.end) || sceneDuration),
    );
    return { start, end };
  };
  const previewTextOverlayItems = sceneIsVisibleInPlayback
    ? previewPlaybackMode
      ? sceneTextOverlays.filter((overlay) => {
          const { start, end } = textOverlayTiming(overlay);
          return overlay.visible !== false
            && safeTrim(overlay.text)
            && sceneLocalTime >= start
            && sceneLocalTime <= end;
        })
      : sceneTextOverlays.filter((overlay) =>
          overlay.editorVisible !== false && overlay.visible !== false && safeTrim(overlay.text),
        )
    : [];
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
    ? previewPlaybackMode
      ? scenePopups.filter((popup) => {
          const timingStart = Math.min(sceneDuration, Math.max(0, Number(popup.start) || 0));
          const timingEnd = Math.min(sceneDuration, timingStart + Math.max(0.1, Number(popup.duration) || 0.1));
          return (previewPlaybackMode || popup.editorVisible !== false)
            && popup.visible !== false
            && popupHasContent(popup)
            && sceneLocalTime >= timingStart
            && sceneLocalTime <= timingEnd;
        })
      : scenePopups.filter((popup) => popup.editorVisible !== false && popup.visible !== false && popupHasContent(popup))
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
    ? previewPlaybackMode
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
    ? previewPlaybackMode
      ? sceneImages.filter((image, imageIndex) => {
          const { start, end } = sceneImagePlaybackWindow(image, imageIndex);
          return image.visible !== false
            && Boolean(safeTrim(image.url))
            && sceneLocalTime >= start
            && sceneLocalTime < end;
        })
      : sceneImages.filter((image) => image.editorVisible !== false && image.visible !== false && Boolean(safeTrim(image.url)))
    : [];
  const activeFadeBlackImage = previewPlaybackMode
    ? sceneImages.find((image) => {
        const transition = normalizeSceneImageTransition(image.transition);
        const duration = sceneImageTransitionDuration(image);
        const start = Math.min(sceneDuration, Math.max(0, Number(image.start) || 0));
        return transition === "fade-black"
          && image.visible !== false
          && Boolean(safeTrim(image.url))
          && duration > 0
          && sceneLocalTime >= start
          && sceneLocalTime <= Math.min(sceneDuration, start + duration);
      })
    : null;
  const fadeBlackOpacity = activeFadeBlackImage
    ? (() => {
        const { progress } = sceneImagePreviewTransition(activeFadeBlackImage);
        return progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
      })()
    : 0;
  const activeSubtitle = sceneIsVisibleInPlayback && scene.subtitleEnabled !== false
    ? (scene.subtitles ?? []).find((subtitle) => {
        const subtitleOffset = Math.min(
          sceneDuration,
          Math.max(0, Number(scene.subtitleStart) || 0),
        );
        const cueStart = Math.max(0, Number(subtitle.start) || 0);
        const start = Math.min(sceneDuration, subtitleOffset + cueStart);
        const end = Math.min(
          sceneDuration,
          Math.max(start + 0.1, subtitleOffset + (Number(subtitle.end) || cueStart + 0.1)),
        );
        return subtitle.visible !== false
          && safeTrim(subtitle.text)
          && sceneLocalTime >= start
          && sceneLocalTime < end;
      })
    : null;
  const previewLayerItems = useMemo<PreviewLayerItem[]>(() => {
    const candidates: PreviewLayerItem[] = [
      ...previewTextOverlayItems
        .map((overlay, index) => ({
          token: previewLayerToken("text", overlay.id),
          kind: "text" as const,
          id: overlay.id,
          label: safeTrim(overlay.name) || safeTrim(overlay.text).slice(0, 32) || `Chữ ${index + 1}`,
          icon: "T",
        })),
      ...previewPopupItems.map((popup, index) => ({
        token: previewLayerToken("popup", popup.id),
        kind: "popup" as const,
        id: popup.id,
        label: safeTrim(popup.title) || `Popup ${index + 1}`,
        icon: "P",
      })),
      ...previewDecorationItems.map((decoration, index) => ({
        token: previewLayerToken("decoration", decoration.id),
        kind: "decoration" as const,
        id: decoration.id,
        label: safeTrim(decoration.name) || `${decoration.type === "text-3d" ? "Chữ 3D" : decoration.type === "animated-sticker" ? "GIF / WebM / APNG" : decoration.type === "sticker" ? "Sticker" : decoration.type === "icon" ? "Icon" : "Hiệu ứng"} ${index + 1}`,
        icon: "✦",
      })),
      ...previewSceneImageItems.map((image, index) => ({
        token: previewLayerToken("image", image.id),
        kind: "image" as const,
        id: image.id,
        label: safeTrim(image.name) || `${image.mediaType === "video" ? "Video" : "Hình ảnh"} ${index + 1}`,
        icon: "IMG",
      })),
      ...(((scene.subtitles ?? []).some((subtitle) => subtitle.visible !== false && safeTrim(subtitle.text))) ? [{
        token: previewLayerToken("subtitle", "subtitle"),
        kind: "subtitle" as const,
        id: "subtitle",
        label: "Phụ đề",
        icon: "CC",
      }] : []),
    ];
    const candidateTokens = new Set(candidates.map((item) => item.token));
    const storedOrder = Array.isArray(scene.layerOrder)
      ? scene.layerOrder.filter((token): token is string => typeof token === "string")
      : [];
    const orderedTokens = Array.from(new Set([
      ...storedOrder.filter((token) => candidateTokens.has(token)),
      ...candidates.map((item) => item.token).filter((token) => !storedOrder.includes(token)),
    ]));
    const itemByToken = new Map(candidates.map((item) => [item.token, item]));
    return orderedTokens
      .map((token) => itemByToken.get(token))
      .filter((item): item is PreviewLayerItem => Boolean(item));
  }, [
    previewPlaybackMode,
    previewDecorationItems,
    previewPopupItems,
    previewSceneImageItems,
    previewTextOverlayItems,
    scene.layerOrder,
    scene.subtitleEnabled,
    scene.subtitles,
  ]);
  const previewLayerZIndex = (kind: PreviewLayerKind, id: string) => {
    const index = previewLayerItems.findIndex((item) => item.token === previewLayerToken(kind, id));
    const baseIndex = 10 + (index < 0 ? previewLayerItems.length : index);
    if (kind === "text") return 100 + baseIndex;
    if (kind === "subtitle") return 200 + baseIndex;
    return baseIndex;
  };
  const explicitlySelectedPreviewLayerToken = selectedPopupId
    ? previewLayerToken("popup", selectedPopupId)
    : selectedTextOverlayId
      ? previewLayerToken("text", selectedTextOverlayId)
      : selectedSceneImageId
        ? previewLayerToken("image", selectedSceneImageId)
        : selectedDecorationId
          ? previewLayerToken("decoration", selectedDecorationId)
          : "";
  const visiblePreviewLayerItems = useMemo(() => {
    const query = safeTrim(previewLayerQuery).toLocaleLowerCase("vi-VN");
    if (!query) return previewLayerItems;
    return previewLayerItems.filter((item) =>
      `${item.label} ${item.kind}`.toLocaleLowerCase("vi-VN").includes(query),
    );
  }, [previewLayerItems, previewLayerQuery]);
  const previewLayerAvatar = (item: PreviewLayerItem) => {
    let source = "";
    let isVideo = false;
    if (item.kind === "image") {
      const image = previewSceneImageItems.find((entry) => entry.id === item.id);
      if (image) {
        source = sceneImageSpritePreviewUrls[image.id] || assetPreviewSource(image.url);
        isVideo = image.mediaType === "video" || isVideoMedia(image.url);
      }
    } else if (item.kind === "popup") {
      const popup = previewPopupItems.find((entry) => entry.id === item.id);
      if (popup) {
        source = assetPreviewSource(popup.video) || assetPreviewSource(popup.image);
        isVideo = Boolean(safeTrim(popup.video));
      }
    } else if (item.kind === "decoration") {
      const decoration = previewDecorationItems.find((entry) => entry.id === item.id);
      if (decoration && (decoration.type === "sticker" || decoration.type === "animated-sticker")) {
        source = assetPreviewSource(decoration.asset);
        isVideo = decoration.type === "animated-sticker" && decoration.assetType === "webm";
      }
    }
    if (!source) return <span>{item.icon}</span>;
    return isVideo ? (
      <video src={source} muted loop playsInline preload="metadata" aria-hidden="true" />
    ) : (
      <img src={source} alt="" />
    );
  };
  // Cấu trúc cảnh phải dùng đúng bản scene đã reflow như màn hình Xem trước.
  // Nếu dùng `scenes` thô ở đây, các cảnh ẩn phía trước sẽ làm lệch start/end
  // và review sẽ không còn đứng cùng một mốc với preview chính.
  const sceneStructureScene = visibleScenes.find((item) => item.id === sceneStructureSceneId)
    ?? scenes.find((item) => item.id === sceneStructureSceneId)
    ?? scene;
  const sceneStructureDuration = Math.max(0.1, sceneStructureScene.end - sceneStructureScene.start);
  const sceneStructurePopups = scenePopupList(sceneStructureScene);
  const sceneStructureImages = sceneStructureScene.sceneImages ?? [];
  const sceneStructureTexts = sceneStructureScene.textOverlays ?? [];
  const sceneStructureDecorations = sceneStructureScene.mapDecorations ?? [];
  const sceneStructureAudioTracks = sceneStructureScene.audioTracks ?? [];
  const sceneStructureEffects = normalizeSceneEffects(sceneStructureScene.effects);
  const sceneStructureBackgroundValue = safeTrim(sceneStructureScene.background) || legacyBackgroundPreview;
  const sceneStructureBackgroundSource = assetPreviewSource(sceneStructureBackgroundValue);
  const clampSceneStructureTiming = (startValue: number, endValue: number) => {
    const start = Math.min(
      Math.max(0, sceneStructureDuration - 0.1),
      Math.max(0, Number(startValue) || 0),
    );
    const end = Math.min(
      sceneStructureDuration,
      Math.max(start + 0.1, Number(endValue) || start + 0.1),
    );
    return { start: Number(start.toFixed(2)), end: Number(end.toFixed(2)) };
  };
  const sceneStructureItems: SceneStructureItem[] = [];
  const addSceneStructureItem = (
    item: Omit<SceneStructureItem, "start" | "end"> & { start: number; end: number },
  ) => {
    const timing = clampSceneStructureTiming(item.start, item.end);
    sceneStructureItems.push({ ...item, ...timing });
  };

  if (sceneStructureScene.backgroundVisible !== false && sceneStructureBackgroundValue) {
    addSceneStructureItem({
      token: "background:scene",
      kind: "background",
      id: "scene",
      label: "Nền bản đồ",
      detail: fileNameOnly(sceneStructureBackgroundValue) || "Nền cảnh",
      icon: "▧",
      start: 0,
      end: sceneStructureDuration,
      timingMode: "none",
      canHide: true,
      thumbnail: sceneStructureBackgroundSource,
      thumbnailIsVideo: isVideoMedia(sceneStructureBackgroundValue),
    });
  }
  if (sceneStructureScene.zoomEnabled !== false) {
    addSceneStructureItem({
      token: "effect:zoom",
      kind: "effect",
      id: "zoom",
      label: "Zoom bản đồ",
      detail: `Mức zoom ${Number(sceneStructureScene.zoom ?? 1.25).toFixed(2)}×`,
      icon: "✦",
      start: Number(sceneStructureScene.zoomStart ?? 0),
      end: Number(sceneStructureScene.zoomEnd ?? sceneStructureDuration),
      timingMode: "both",
      canHide: true,
      thumbnail: "",
      thumbnailIsVideo: false,
    });
  }
  sceneStructureEffects.sceneStartDarkEffects
    .filter((effect) => effect.enabled)
    .forEach((effect, index) => {
      addSceneStructureItem({
        token: `effect:dark:${effect.id}`,
        kind: "effect",
        id: `dark:${effect.id}`,
        label: `Hiệu ứng tối ${index + 1}`,
        detail: `Cường độ ${Math.round(effect.intensity)}%`,
        icon: "◐",
        start: effect.start,
        end: effect.end,
        timingMode: "both",
        canHide: true,
        thumbnail: "",
        thumbnailIsVideo: false,
      });
    });
  const weatherEffects = [
    sceneStructureEffects.snowEnabled ? "Tuyết" : "",
    sceneStructureEffects.rainEnabled ? "Mưa" : "",
    sceneStructureEffects.cloudEnabled ? "Mây" : "",
    sceneStructureEffects.lightFlickerEnabled ? "Chớp" : "",
    sceneStructureEffects.thunderEnabled ? "Sấm" : "",
  ].filter(Boolean);
  if (weatherEffects.length) {
    addSceneStructureItem({
      token: "effect:weather",
      kind: "effect",
      id: "weather",
      label: weatherEffects.join(" · "),
      detail: "Hiệu ứng môi trường",
      icon: "☂",
      start: 0,
      end: sceneStructureDuration,
      timingMode: "none",
      canHide: true,
      thumbnail: "",
      thumbnailIsVideo: false,
    });
  }

  const sceneStructureVisualItems: SceneStructureItem[] = [];
  sceneStructureTexts
    .filter((overlay) => overlay.visible !== false && safeTrim(overlay.text))
    .forEach((overlay, index) => {
      const timing = clampSceneStructureTiming(overlay.start, overlay.end);
      sceneStructureVisualItems.push({
        token: `text:${overlay.id}`,
        kind: "text",
        id: overlay.id,
        label: safeTrim(overlay.name) || safeTrim(overlay.text).slice(0, 30) || `Chữ ${index + 1}`,
        detail: safeTrim(overlay.text).slice(0, 52) || "Chữ viết",
        icon: "T",
        ...timing,
        timingMode: "both",
        canHide: true,
        thumbnail: "",
        thumbnailIsVideo: false,
      });
    });
  sceneStructureImages
    .filter((image) => image.visible !== false)
    .forEach((image, index) => {
      const timing = clampSceneStructureTiming(image.start, image.start + image.duration);
      const transitionLabel = sceneImageTransitionOptions.find((option) => option.value === image.transition)?.label;
      const thumbnail = sceneImageSpritePreviewUrls[image.id] || assetPreviewSource(image.url);
      sceneStructureVisualItems.push({
        token: `image:${image.id}`,
        kind: "image",
        id: image.id,
        label: safeTrim(image.name) || `${image.mediaType === "video" ? "Video" : "Hình ảnh"} ${index + 1}`,
        detail: safeTrim(image.url)
          ? transitionLabel || (image.mediaType === "video" ? "Video" : "Hình ảnh")
          : "Chưa nhập URL hình ảnh hoặc video",
        icon: "IMG",
        ...timing,
        timingMode: "both",
        canHide: true,
        thumbnail,
        thumbnailIsVideo: image.mediaType === "video" || isVideoMedia(image.url),
      });
    });
  sceneStructurePopups
    .filter((popup) => popup.visible !== false && popupHasContent(popup))
    .forEach((popup, index) => {
      const timing = clampSceneStructureTiming(popup.start, popup.start + popup.duration);
      const mediaValue = safeTrim(popup.video) || safeTrim(popup.image);
      sceneStructureVisualItems.push({
        token: `popup:${popup.id}`,
        kind: "popup",
        id: popup.id,
        label: safeTrim(popup.title) || `Popup ${index + 1}`,
        detail: popup.layout === "quote" ? "Trích dẫn" : `Bố cục ${popup.layout ?? "image-top"}`,
        icon: "P",
        ...timing,
        timingMode: "both",
        canHide: true,
        thumbnail: assetPreviewSource(mediaValue),
        thumbnailIsVideo: Boolean(safeTrim(popup.video)),
      });
    });
  sceneStructureDecorations
    .filter((decoration) => decoration.visible !== false && decorationHasContent(decoration))
    .forEach((decoration, index) => {
      const timing = clampSceneStructureTiming(decoration.start, decoration.start + decoration.duration);
      const typeLabel = decoration.type === "text-3d"
        ? "Chữ 3D"
        : decoration.type === "animated-sticker"
          ? "Hiệu ứng động"
          : decoration.type === "sticker"
            ? "Sticker"
            : decoration.type === "icon" ? "Icon" : "Hiệu ứng";
      sceneStructureVisualItems.push({
        token: `decoration:${decoration.id}`,
        kind: "decoration",
        id: decoration.id,
        label: safeTrim(decoration.name) || `${typeLabel} ${index + 1}`,
        detail: typeLabel,
        icon: decoration.type === "text-3d" ? "3D" : "✦",
        ...timing,
        timingMode: "both",
        canHide: true,
        thumbnail: assetPreviewSource(decoration.asset),
        thumbnailIsVideo: decoration.type === "animated-sticker" && decoration.assetType === "webm",
      });
    });
  sceneStructureVisualItems
    .sort((first, second) => first.start - second.start || first.end - second.end)
    .forEach((item) => sceneStructureItems.push(item));

  const visibleStructureSubtitles = (sceneStructureScene.subtitles ?? [])
    .filter((subtitle) => subtitle.visible !== false && safeTrim(subtitle.text));
  if (sceneStructureScene.subtitleEnabled !== false && visibleStructureSubtitles.length) {
    const subtitleOffset = Math.max(0, Number(sceneStructureScene.subtitleStart) || 0);
    const subtitleStart = Math.min(...visibleStructureSubtitles.map((subtitle) => subtitleOffset + Math.max(0, Number(subtitle.start) || 0)));
    const subtitleEnd = Math.max(...visibleStructureSubtitles.map((subtitle) => subtitleOffset + Math.max(0.1, Number(subtitle.end) || 0.1)));
    addSceneStructureItem({
      token: "subtitle:subtitle",
      kind: "subtitle",
      id: "subtitle",
      label: "Phụ đề",
      detail: `${visibleStructureSubtitles.length} câu đang hiển thị`,
      icon: "CC",
      start: subtitleStart,
      end: subtitleEnd,
      timingMode: "start",
      canHide: true,
      thumbnail: "",
      thumbnailIsVideo: false,
    });
  }
  if (narrationEnabled) {
    sceneStructureAudioTracks
      .filter((track) => track.visible !== false)
      .forEach((track, index) => {
        addSceneStructureItem({
          token: `audio:${track.id}`,
          kind: "audio",
          id: track.id,
          label: safeTrim(track.name) || `Âm thanh ${index + 1}`,
          detail: fileNameOnly(track.source) || "Chưa chọn file âm thanh",
          icon: "≋",
          start: track.start,
          end: track.end,
          timingMode: "both",
          canHide: true,
          thumbnail: "",
          thumbnailIsVideo: false,
        });
      });
  }

  const sceneStructureFirstToken = sceneStructureItems[0]?.token ?? "";
  const sceneStructureSelectedTokenExists = Boolean(
    selectedSceneStructureToken
    && sceneStructureItems.some((item) => item.token === selectedSceneStructureToken),
  );
  const selectedSceneStructureItem = sceneStructureItems.find((item) => item.token === selectedSceneStructureToken)
    ?? sceneStructureItems[0]
    ?? null;
  const sceneStructureQuickEditItem = sceneStructureItems.find((item) => item.token === sceneStructureQuickEditToken)
    ?? null;
  const selectedSceneStructureItemToken = selectedSceneStructureItem?.token ?? "";
  const selectedSceneStructureItemStart = selectedSceneStructureItem?.start ?? 0;
  const selectedSceneStructureItemEnd = selectedSceneStructureItem?.end ?? 0;
  const sceneStructureTicks = (() => {
    const step = sceneStructureDuration <= 10 ? 1 : sceneStructureDuration <= 30 ? 5 : 10;
    const ticks = Array.from(
      { length: Math.floor(sceneStructureDuration / step) + 1 },
      (_, index) => Number((index * step).toFixed(2)),
    );
    if (Math.abs((ticks.at(-1) ?? 0) - sceneStructureDuration) > 0.01) ticks.push(sceneStructureDuration);
    return ticks;
  })();
  const sceneStructureLocalTime = Math.min(
    sceneStructureDuration,
    Math.max(0, playTime - sceneStructureScene.start),
  );
  const sceneStructureMinimapTracks: Array<{
    key: string;
    label: string;
    kinds: SceneStructureItem["kind"][];
  }> = [
    { key: "visual", label: "Hình", kinds: ["background", "image"] },
    { key: "popup", label: "Popup", kinds: ["popup"] },
    { key: "copy", label: "Chữ", kinds: ["text", "subtitle"] },
    { key: "effect", label: "Hiệu ứng", kinds: ["effect", "decoration"] },
    { key: "audio", label: "Âm thanh", kinds: ["audio"] },
  ];

  const syncSceneStructureMinimapViewport = () => {
    const scroll = sceneStructureFlowScrollRef.current;
    if (!scroll) return;
    const scrollWidth = Math.max(1, scroll.scrollWidth);
    const viewportWidth = Math.min(100, scroll.clientWidth / scrollWidth * 100);
    const viewportLeft = Math.min(
      100 - viewportWidth,
      Math.max(0, scroll.scrollLeft / scrollWidth * 100),
    );
    setSceneStructureMinimapViewport((current) => (
      Math.abs(current.left - viewportLeft) < 0.05 && Math.abs(current.width - viewportWidth) < 0.05
        ? current
        : { left: viewportLeft, width: viewportWidth }
    ));
  };

  const moveSceneStructureMinimapViewport = (clientX: number, target: HTMLElement) => {
    const scroll = sceneStructureFlowScrollRef.current;
    if (!scroll) return;
    const bounds = target.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / Math.max(1, bounds.width)));
    const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    scroll.scrollLeft = Math.round(Math.min(
      maxScrollLeft,
      Math.max(0, ratio * scroll.scrollWidth - scroll.clientWidth / 2),
    ));
    syncSceneStructureMinimapViewport();
  };

  const startSceneStructureMinimapDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    sceneStructureMinimapPointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    moveSceneStructureMinimapViewport(event.clientX, event.currentTarget);
  };

  const moveSceneStructureMinimapDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (sceneStructureMinimapPointerId.current !== event.pointerId) return;
    moveSceneStructureMinimapViewport(event.clientX, event.currentTarget);
  };

  const endSceneStructureMinimapDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (sceneStructureMinimapPointerId.current !== event.pointerId) return;
    sceneStructureMinimapPointerId.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const navigateSceneStructureMinimapWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const scroll = sceneStructureFlowScrollRef.current;
    if (!scroll) return;
    const viewportStep = Math.max(80, scroll.clientWidth * 0.7);
    const maxScrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    let nextScrollLeft: number | null = null;
    if (event.key === "ArrowLeft") nextScrollLeft = scroll.scrollLeft - viewportStep;
    if (event.key === "ArrowRight") nextScrollLeft = scroll.scrollLeft + viewportStep;
    if (event.key === "Home") nextScrollLeft = 0;
    if (event.key === "End") nextScrollLeft = maxScrollLeft;
    if (nextScrollLeft === null) return;
    event.preventDefault();
    scroll.scrollLeft = Math.min(maxScrollLeft, Math.max(0, nextScrollLeft));
    syncSceneStructureMinimapViewport();
  };

  useEffect(() => {
    if (!sceneStructureOpen) return;
    if (!sceneStructureSelectedTokenExists) {
      setSelectedSceneStructureToken(sceneStructureFirstToken);
    }
  }, [
    sceneStructureOpen,
    sceneStructureScene.id,
    sceneStructureFirstToken,
    sceneStructureSelectedTokenExists,
  ]);

  useEffect(() => {
    if (!sceneStructureOpen || sceneStructureViewMode !== "timeline") return;
    const frame = window.requestAnimationFrame(syncSceneStructureMinimapViewport);
    window.addEventListener("resize", syncSceneStructureMinimapViewport);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", syncSceneStructureMinimapViewport);
    };
  }, [sceneStructureOpen, sceneStructureViewMode, sceneStructureZoom]);

  useEffect(() => {
    if (!sceneStructureOpen || !selectedSceneStructureItemToken) return;
    setSceneStructureStartDraft(formatPreciseTime(selectedSceneStructureItemStart));
    setSceneStructureEndDraft(formatPreciseTime(selectedSceneStructureItemEnd));
  }, [
    sceneStructureOpen,
    selectedSceneStructureItemToken,
    selectedSceneStructureItemStart,
    selectedSceneStructureItemEnd,
  ]);

  useEffect(() => {
    if (!sceneStructureOpen || !playing) return;
    if (playTime < sceneStructureScene.start || playTime < sceneStructureScene.end) return;
    setPlaying(false);
    setSelectedId(sceneStructureScene.id);
    setPlayTime(sceneStructureScene.end);
  }, [
    sceneStructureOpen,
    playing,
    playTime,
    sceneStructureScene.id,
    sceneStructureScene.start,
    sceneStructureScene.end,
  ]);
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
  const subtitleGuideHeight = Number.isFinite(Number(subtitleStyle.boxHeight))
    ? Number(subtitleStyle.boxHeight)
    : Math.min(16, Math.max(6, subtitleStyle.size / 3));
  const subtitleGuideMetrics = `Phụ đề mẫu · X ${Number(subtitleStyle.x.toFixed(1))}% · Y ${Number(subtitleStyle.y.toFixed(1))}% · Rộng ${Number(subtitleStyle.boxWidth.toFixed(1))}% · Cao ${Number(subtitleGuideHeight.toFixed(1))}%`;
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
      renderProfile,
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
      renderProfile,
      background,
      previewBackground,
      backgroundVisible,
      backgroundMusic,
      backgroundMusicVolume,
      editorSections,
      scenes,
    ],
  );

  const projectItems = useMemo(() => {
    const currentProjectIndex = projects.findIndex((item) => item.id === projectId);
    if (currentProjectIndex < 0) return [...projects, currentProject];
    return projects.map((item) => item.id === projectId ? currentProject : item);
  }, [projects, projectId, currentProject]);

  const storedProject = useMemo<StoredWorkspace>(() => ({
    version: 2,
    activeProjectId: projectId,
    projects: projectItems,
  }), [projectId, projectItems]);

  const openProject = (project: ProjectSnapshot, preserveHistory = false) => {
    const preservedSelectedId = preserveHistory ? selectedId : "";
    const preservedSelectedSceneIds = preserveHistory ? selectedSceneIds : [];
    const preservedSelectedPopupId = preserveHistory ? selectedPopupId : "";
    const preservedSelectedTextOverlayId = preserveHistory ? selectedTextOverlayId : "";
    const preservedSelectedDecorationId = preserveHistory ? selectedDecorationId : "";
    const preservedSelectedSceneImageId = preserveHistory ? selectedSceneImageId : "";
    const previousSelectedScene = preserveHistory
      ? scenes.find((item) => item.id === preservedSelectedId)
      : undefined;
    const previousSceneLocalTime = previousSelectedScene
      ? Math.max(0, Math.min(previousSelectedScene.end - previousSelectedScene.start, playTime - previousSelectedScene.start))
      : 0;
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
    setRenderProfile(normalizeRenderProfile(project.renderProfile));
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
    if (!preserveHistory) setEditorSections(normalizeEditorSections(project.editorSections));
    setScenes(restoredScenes);
    const restoredSelectedScene = restoredScenes.find((item) => item.id === preservedSelectedId)
      ?? restoredScenes[0];
    const restoredSelectedSceneIds = preservedSelectedSceneIds.filter((id) =>
      restoredScenes.some((item) => item.id === id),
    );
    const restoredPopupIds = restoredSelectedScene ? new Set(scenePopupList(restoredSelectedScene).map((item) => item.id)) : new Set<string>();
    const restoredTextOverlayIds = restoredSelectedScene ? new Set((restoredSelectedScene.textOverlays ?? []).map((item) => item.id)) : new Set<string>();
    const restoredDecorationIds = restoredSelectedScene ? new Set((restoredSelectedScene.mapDecorations ?? []).map((item) => item.id)) : new Set<string>();
    const restoredSceneImageIds = restoredSelectedScene ? new Set((restoredSelectedScene.sceneImages ?? []).map((item) => item.id)) : new Set<string>();
    setSelectedId(restoredSelectedScene?.id ?? "");
    setSelectedPopupId(restoredPopupIds.has(preservedSelectedPopupId) ? preservedSelectedPopupId : "");
    setSelectedTextOverlayId(restoredTextOverlayIds.has(preservedSelectedTextOverlayId) ? preservedSelectedTextOverlayId : "");
    setSelectedDecorationId(restoredDecorationIds.has(preservedSelectedDecorationId) ? preservedSelectedDecorationId : "");
    setSelectedSceneImageId(restoredSceneImageIds.has(preservedSelectedSceneImageId) ? preservedSelectedSceneImageId : "");
    setSelectedSceneIds(restoredSelectedSceneIds.length ? restoredSelectedSceneIds : (restoredSelectedScene ? [restoredSelectedScene.id] : []));
    setPlayTime(restoredSelectedScene
      ? Number((restoredSelectedScene.start + (preserveHistory ? Math.min(previousSceneLocalTime, restoredSelectedScene.end - restoredSelectedScene.start) : 0)).toFixed(2))
      : 0);
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
        renderProfile: normalizeRenderProfile(project.renderProfile),
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
        renderProfile: normalizeRenderProfile(data.renderProfile),
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
    try {
      window.localStorage.setItem(LOCAL_REVIEW_ZOOM_KEY, String(reviewZoom));
    } catch {
      // localStorage may be unavailable in private browsing or restricted contexts.
    }
  }, [reviewZoom]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LOCAL_SCENE_STRUCTURE_ZOOM_KEY, String(sceneStructureZoom));
    } catch {
      // localStorage may be unavailable in private browsing or restricted contexts.
    }
  }, [sceneStructureZoom]);

  useEffect(() => {
    if (!rulerEnabled) return;

    const repositionRulerPopover = () => {
      const toggle = rulerToggleRef.current;
      if (!toggle) return;
      const toggleBounds = toggle.getBoundingClientRect();
      const popover = rulerPopoverRef.current;
      const popoverWidth = popover?.offsetWidth ?? 168;
      const popoverHeight = popover?.offsetHeight ?? 72;
      const maxLeft = Math.max(8, window.innerWidth - popoverWidth - 8);
      const left = Math.min(maxLeft, Math.max(8, toggleBounds.right - popoverWidth));
      const top = Math.max(8, toggleBounds.top - popoverHeight - 8);
      setRulerPopoverPosition({ top, left });
    };

    repositionRulerPopover();
    window.addEventListener("resize", repositionRulerPopover);
    window.addEventListener("scroll", repositionRulerPopover, true);
    return () => {
      window.removeEventListener("resize", repositionRulerPopover);
      window.removeEventListener("scroll", repositionRulerPopover, true);
    };
  }, [previewFullscreen, rulerEnabled]);

  useEffect(() => {
    if (!previewFullscreen && !reviewOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (reviewOpen) setReviewOpen(false);
      else setPreviewFullscreen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewFullscreen, reviewOpen]);

  useEffect(() => {
    if (!sceneStructureOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (sceneStructureQuickEditToken) {
        event.preventDefault();
        setSceneStructureQuickEditToken("");
        return;
      }
      setPlaying(false);
      setSceneStructurePreviewMode(false);
      setPreviewPlaybackMode(false);
      setSceneStructurePreviewPortalHost(null);
      setSceneStructureOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sceneStructureOpen, sceneStructureQuickEditToken]);

  useEffect(() => {
    if (!sceneStructureOpen || sceneStructurePreviewMode) return;
    setPreviewPlaybackMode(false);
  }, [sceneStructureOpen, sceneStructurePreviewMode]);

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
    const durationFromScenes = sceneTimelineDuration;
    const workspaceToSave: StoredWorkspace = {
      ...storedProject,
      projects: storedProject.projects.map((item) => item.id === projectId
        ? { ...item, projectDuration: durationFromScenes }
        : item),
    };
    setProjectDuration(durationFromScenes);
    if (!googleUser) {
      setSaveStatus("error");
      setToast("Hãy đăng nhập Google để lưu dữ liệu lên Firestore");
      window.setTimeout(() => setToast(""), 3200);
      return;
    }

    const currentSnapshot = JSON.stringify(workspaceToSave);
    const savedAt = Date.now();
    window.localStorage.setItem(LOCAL_ACTIVE_PROJECT_KEY, projectId);
    window.localStorage.setItem(
      LOCAL_STORAGE_KEY,
      currentSnapshot,
    );
    window.localStorage.setItem(LOCAL_SAVED_AT_KEY, String(savedAt));
    setSaveStatus("saving");
    try {
      await saveWorkspaceToFirestore(workspaceToSave);
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
    const playbackEnd = sceneStructureOpen ? sceneStructureScene.end : sceneTimelineDuration;
    const tick = () => {
      const nextTime = (performance.now() - startedAt) / 1000;
      if (nextTime >= playbackEnd) {
        if (sceneStructureOpen) {
          setPlayTime(sceneStructureScene.end);
          setPlaying(false);
          return;
        }
        const firstScene = visibleScenes[0];
        setPlayTime(firstScene?.start ?? 0);
        setPlaying(false);
        if (firstScene) {
          setSelectedId(firstScene.id);
          setSelectedSceneIds([firstScene.id]);
        }
        setSelectedPopupId("");
        setSelectedTextOverlayId("");
        setSelectedDecorationId("");
        setSelectedSceneImageId("");
        return;
      }
      setPlayTime(nextTime);
      if (sceneStructureOpen) {
        setSelectedId(sceneStructureScene.id);
        setSelectedSceneIds([sceneStructureScene.id]);
        animationFrame.current = requestAnimationFrame(tick);
        return;
      }
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
  }, [
    playing,
    playbackRestartToken,
    sceneStructureOpen,
    sceneStructureScene.id,
    sceneStructureScene.end,
    sceneTimelineDuration,
    scenes,
    visibleScenes,
  ]);

  useEffect(() => {
    sceneAudioPlayers.current.forEach(({ audio, startTimer, stopTimer }) => {
      if (startTimer) window.clearTimeout(startTimer);
      if (stopTimer) window.clearTimeout(stopTimer);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    });
    sceneAudioPlayers.current = [];
    narrationAudio.current = null;
    if (!playing || !narrationEnabled || previewAudioMuted || !sceneIsVisibleInPlayback) return;

    const tracks = sceneAudioTracks.length
      ? sceneAudioTracks
      : [defaultSceneAudioTrack(`${scene.id}-audio-legacy`, {
          source: scene.voiceFile,
          volume: scene.voiceVolume,
          start: scene.voiceStart,
          end: sceneDuration,
        })];
    let cancelled = false;
    const players = tracks.flatMap((track, index) => {
      if (track.visible === false || !safeTrim(track.source) || track.end <= track.start) return [];
      const previewKey = sceneAudioTrackKey(scene.id, track.id);
      const source = audioPreview[previewKey]
        || (index === 0 ? audioPreview[scene.id] : "")
        || (isRemoteUrl(track.source)
          ? track.source
          : assetPreviewUrls[fileNameOnly(track.source)] ?? "");
      if (!source) return [];
      const audio = new Audio(source);
      const player: { audio: HTMLAudioElement; startTimer?: number; stopTimer?: number } = { audio };
      audio.preload = "auto";
      audio.volume = clampVolume(track.volume, 100) / 100;

      const launch = () => {
        if (cancelled) return;
        let started = false;
        const startAudio = () => {
          if (cancelled || started || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
          const localNow = Math.max(0, playTimeRef.current - scene.start);
          if (localNow >= track.end) return;
          const elapsed = Math.max(0, localNow - track.start);
          audio.currentTime = Math.min(elapsed, Math.max(0, audio.duration - 0.01));
          started = true;
          void audio.play().catch(() => {
            // A local path that has not been uploaded is previewed silently.
          });
          player.stopTimer = window.setTimeout(() => audio.pause(), Math.max(0, track.end - localNow) * 1000);
        };
        audio.addEventListener("loadedmetadata", startAudio, { once: true });
        audio.addEventListener("canplay", startAudio, { once: true });
        audio.load();
        if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) startAudio();
      };

      const localNow = Math.max(0, playTimeRef.current - scene.start);
      if (localNow < track.start) {
        player.startTimer = window.setTimeout(launch, Math.max(0, track.start - localNow) * 1000);
      } else if (localNow < track.end) {
        launch();
      }
      return [player];
    });
    sceneAudioPlayers.current = players;
    narrationAudio.current = players[0]?.audio ?? null;
    return () => {
      cancelled = true;
      players.forEach(({ audio, startTimer, stopTimer }) => {
        if (startTimer) window.clearTimeout(startTimer);
        if (stopTimer) window.clearTimeout(stopTimer);
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      });
      if (sceneAudioPlayers.current === players) sceneAudioPlayers.current = [];
      narrationAudio.current = null;
    };
  }, [playing, selectedId, narrationEnabled, previewAudioMuted, scene.id, scene.start, scene.end, scene.voiceFile, scene.voiceStart, scene.voiceVolume, sceneAudioTracks, sceneDuration, sceneIsVisibleInPlayback, audioPreview, assetPreviewUrls, playbackRestartToken]);

  useEffect(() => {
    backgroundMusicAudio.current?.pause();
    backgroundMusicAudio.current = null;
    if (!playing || previewAudioMuted || !safeTrim(backgroundMusic)) return;
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
  }, [playing, previewAudioMuted, backgroundMusic, musicPreviewSource, backgroundMusicVolume]);

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
    targetId: "editor-popup" | "editor-audio" | "editor-music" | "editor-subtitle" | "editor-effects",
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
    setEditorSectionOpen(
      targetId === "editor-popup"
        ? "popup"
        : targetId === "editor-subtitle"
          ? "audio"
          : targetId === "editor-effects"
            ? "effects"
          : "audio",
      true,
    );
    window.setTimeout(() => {
      const target = document.getElementById(targetId)
        ?? (targetId === "editor-effects" ? document.querySelector('[data-editor-section="effects"]') : null);
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

  const focusEditorLayer = (
    section: "popup" | "text" | "images",
    layerId: string,
  ) => {
    setEditorSectionOpen(section, true);
    window.setTimeout(() => {
      const target = document.getElementById(`editor-layer-${section}-${layerId}`);
      const group = target?.closest("details");
      if (group instanceof HTMLDetailsElement) group.open = true;
      if (!(target instanceof HTMLElement)) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
      target.classList.add("timeline-focus");
      window.setTimeout(() => {
        document.getElementById(`editor-layer-${section}-${layerId}`)?.classList.remove("timeline-focus");
      }, 1300);
    }, 40);
  };

  const selectPreviewLayer = (
    kind: "popup" | "text" | "image" | "decoration",
    layerId: string,
  ) => {
    setSelectedPopupId(kind === "popup" ? layerId : "");
    setSelectedTextOverlayId(kind === "text" ? layerId : "");
    setSelectedSceneImageId(kind === "image" ? layerId : "");
    setSelectedDecorationId(kind === "decoration" ? layerId : "");
    focusEditorLayer(kind === "popup" ? "popup" : kind === "image" ? "images" : "text", layerId);
  };

  const selectPreviewLayerItem = (item: PreviewLayerItem) => {
    if (item.kind === "subtitle") {
      setSelectedPopupId("");
      setSelectedTextOverlayId("");
      setSelectedSceneImageId("");
      setSelectedDecorationId("");
      openTimelineEditor(scene, "editor-subtitle");
      return;
    }
    selectPreviewLayer(item.kind, item.id);
  };

  const reorderPreviewLayers = (draggedToken: string, targetToken: string) => {
    if (!scene || !draggedToken || !targetToken || draggedToken === targetToken) return;
    const currentTokens = previewLayerItems.map((item) => item.token);
    const nextVisibleTokens = reorderById(
      currentTokens.map((token) => ({ id: token })),
      draggedToken,
      targetToken,
    ).map((item) => item.id);
    const storedTokens = Array.isArray(scene.layerOrder) ? scene.layerOrder : [];
    const visibleTokenSet = new Set(currentTokens);
    const nextOrder = [
      ...nextVisibleTokens,
      ...storedTokens.filter((token) => !visibleTokenSet.has(token)),
    ];
    setScenes((items) => items.map((item) => item.id === scene.id
      ? { ...item, layerOrder: nextOrder }
      : item));
  };

  const startPreviewLayerDrag = (event: React.DragEvent<HTMLButtonElement>, token: string) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", token);
    setPreviewLayerDrag({ draggedId: token, overId: "" });
  };

  const updatePreviewLayerDragOver = (event: React.DragEvent<HTMLButtonElement>, token: string) => {
    if (!previewLayerDrag.draggedId || previewLayerDrag.draggedId === token) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setPreviewLayerDrag((current) => ({ ...current, overId: token }));
  };

  const finishPreviewLayerDrop = (event: React.DragEvent<HTMLButtonElement>, token: string) => {
    event.preventDefault();
    reorderPreviewLayers(previewLayerDrag.draggedId, token);
    setPreviewLayerDrag({ draggedId: "", overId: "" });
  };

  const clearPreviewLayerDrag = () => setPreviewLayerDrag({ draggedId: "", overId: "" });

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
    const resumeAt = playTime >= sceneTimelineDuration ? 0 : playTime;
    const activeScene =
      visibleScenes.find((item) => resumeAt >= item.start && resumeAt < item.end) ??
      visibleScenes.find((item) => item.start >= resumeAt) ??
      visibleScenes[0];
    const startAt = activeScene?.start ?? resumeAt;
    setRulerEnabled(false);
    setAlignmentGuides(EMPTY_ALIGNMENT_GUIDES);
    setPlayTime(activeScene && !(resumeAt >= activeScene.start && resumeAt < activeScene.end)
      ? startAt
      : resumeAt);
    if (activeScene) setSelectedId(activeScene.id);
    setPreviewPlaybackMode(true);
    setPlaying(true);
  };

  const replayPlayback = () => {
    const firstScene = visibleScenes[0];
    if (!firstScene) {
      setToast("Chưa có cảnh đang hiện để chạy lại");
      window.setTimeout(() => setToast(""), 2600);
      return;
    }
    setRulerEnabled(false);
    setAlignmentGuides(EMPTY_ALIGNMENT_GUIDES);
    setPlayTime(firstScene.start);
    setSelectedId(firstScene.id);
    setSelectedSceneIds([firstScene.id]);
    setSelectedPopupId("");
    setSelectedTextOverlayId("");
    setSelectedDecorationId("");
    setSelectedSceneImageId("");
    setPlaybackRestartToken((value) => value + 1);
    setPreviewPlaybackMode(true);
    setPlaying(true);
  };

  const togglePreviewAudio = () => {
    setPreviewAudioMuted((muted) => !muted);
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

  const moveSelectedMapLayer = (
    direction: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
    step = 1,
  ) => {
    if (!hydrated || playing) return false;
    const deltaX = direction === "ArrowLeft" ? -step : direction === "ArrowRight" ? step : 0;
    const deltaY = direction === "ArrowUp" ? -step : direction === "ArrowDown" ? step : 0;
    const movePercent = (value: unknown, fallback: number, delta: number) =>
      clampPercent(clampPercent(value, fallback) + delta, fallback);
    const selectedPopup = selectedPopupId
      ? scenePopups.find((item) => item.id === selectedPopupId)
      : undefined;
    const selectedText = selectedTextOverlayId
      ? sceneTextOverlays.find((item) => item.id === selectedTextOverlayId)
      : undefined;
    const selectedImage = selectedSceneImageId
      ? sceneImages.find((item) => item.id === selectedSceneImageId)
      : undefined;
    const selectedDecoration = selectedDecorationId
      ? sceneDecorations.find((item) => item.id === selectedDecorationId)
      : undefined;

    if (selectedPopup) {
      updatePopup("x", movePercent(selectedPopup.x, 5, deltaX), selectedPopup.id);
      updatePopup("y", movePercent(selectedPopup.y, 55, deltaY), selectedPopup.id);
      return true;
    }
    if (selectedText) {
      updateTextOverlay("x", movePercent(selectedText.x, 50, deltaX));
      updateTextOverlay("y", movePercent(selectedText.y, 18, deltaY));
      return true;
    }
    if (selectedImage) {
      updateSceneImage("x", movePercent(selectedImage.x, 50, deltaX));
      updateSceneImage("y", movePercent(selectedImage.y, 50, deltaY));
      return true;
    }
    if (selectedDecoration) {
      updateMapDecoration("x", movePercent(selectedDecoration.x, 50, deltaX));
      updateMapDecoration("y", movePercent(selectedDecoration.y, 50, deltaY));
      return true;
    }
    return false;
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
      const isLayerArrow = event.key === "ArrowUp"
        || event.key === "ArrowDown"
        || event.key === "ArrowLeft"
        || event.key === "ArrowRight";
      if (!modifier && isLayerArrow && moveSelectedMapLayer(
        event.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
        event.shiftKey ? 5 : 1,
      )) {
        event.preventDefault();
        return;
      }
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
    setScenes((items) => items.map((item) => {
      if (!targetIds.has(item.id)) return item;
      const current = normalizeSceneEffects(item.effects);
      const next = { ...current, [key]: value } as SceneEffects;
      if (key === "sceneStartDarkEffects") {
        const darkEffects = value as SceneDarkEffect[];
        const first = darkEffects[0];
        next.sceneStartDarkEnabled = darkEffects.some((effect) => effect.enabled);
        next.sceneStartDarkDuration = first ? Math.max(0.1, first.end - first.start) : current.sceneStartDarkDuration;
        next.sceneStartDarkIntensity = first?.intensity ?? current.sceneStartDarkIntensity;
      }
      return { ...item, effects: next };
    }));
  };

  type SceneDarkEffectNumberField = "start" | "end" | "holdDuration" | "intensity";
  const darkEffectInputKey = (effectId: string, field: SceneDarkEffectNumberField) =>
    `${scene.id}:dark:${effectId}:${field}`;
  const darkEffectInputValue = (
    effect: SceneDarkEffect,
    field: SceneDarkEffectNumberField,
  ) => effectInputDrafts[darkEffectInputKey(effect.id, field)] ?? String(effect[field]);
  const updateSceneDarkEffect = <K extends keyof SceneDarkEffect>(
    effectId: string,
    key: K,
    value: SceneDarkEffect[K],
  ) => {
    if (!hydrated) return;
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    setScenes((items) => items.map((item) => {
      if (!targetIds.has(item.id)) return item;
      const effects = normalizeSceneEffects(item.effects);
      const nextDarkEffects = effects.sceneStartDarkEffects.map((effect) => {
        if (effect.id !== effectId) return effect;
        const next = { ...effect, [key]: value } as SceneDarkEffect;
        if (next.start > next.end - 0.1) next.end = next.start + 0.1;
        if (next.end < next.start + 0.1) next.start = Math.max(0, next.end - 0.1);
        next.holdDuration = Math.min(
          Math.max(0, next.end - next.start - 0.1),
          Math.max(0, Number(next.holdDuration) || 0),
        );
        return next;
      });
      const first = nextDarkEffects[0];
      return {
        ...item,
        effects: {
          ...effects,
          sceneStartDarkEffects: nextDarkEffects,
          sceneStartDarkEnabled: nextDarkEffects.some((effect) => effect.enabled),
          sceneStartDarkDuration: first ? Math.max(0.1, first.end - first.start) : effects.sceneStartDarkDuration,
          sceneStartDarkIntensity: first?.intensity ?? effects.sceneStartDarkIntensity,
        },
      };
    }));
  };
  const updateSceneDarkEffectInput = (
    effect: SceneDarkEffect,
    field: SceneDarkEffectNumberField,
    value: string,
  ) => {
    const key = darkEffectInputKey(effect.id, field);
    setEffectInputDrafts((items) => ({ ...items, [key]: value }));
    if (!value.trim()) return;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;
    const sceneLimit = Math.max(0.1, sceneDuration);
    if (field === "start") {
      updateSceneDarkEffect(effect.id, "start", Math.min(sceneLimit - 0.1, Math.max(0, numericValue)));
    } else if (field === "end") {
      updateSceneDarkEffect(effect.id, "end", Math.min(sceneLimit, Math.max(effect.start + 0.1, numericValue)));
    } else if (field === "holdDuration") {
      updateSceneDarkEffect(
        effect.id,
        "holdDuration",
        Math.min(Math.max(0, effect.end - effect.start - 0.1), Math.max(0, numericValue)),
      );
    } else {
      updateSceneDarkEffect(effect.id, "intensity", Math.min(100, Math.max(0, numericValue)));
    }
  };
  const commitSceneDarkEffectInput = (effect: SceneDarkEffect, field: SceneDarkEffectNumberField) => {
    const key = darkEffectInputKey(effect.id, field);
    const draft = effectInputDrafts[key];
    const numericValue = Number(draft);
    if (draft !== undefined && Number.isFinite(numericValue)) {
      updateSceneDarkEffectInput(effect, field, String(numericValue));
      setEffectInputDrafts((items) => ({ ...items, [key]: String(numericValue) }));
      return;
    }
    setEffectInputDrafts((items) => {
      const next = { ...items };
      delete next[key];
      return next;
    });
  };
  const addSceneDarkEffect = () => {
    if (!hydrated) return;
    const nextId = `${scene.id}-dark-${Date.now().toString(36)}`;
    const currentEffects = sceneEffects.sceneStartDarkEffects;
    const lastEnd = currentEffects.at(-1)?.end ?? 0;
    const start = Math.min(Math.max(0, sceneDuration - 0.1), Math.max(0, lastEnd));
    const nextEffect = defaultSceneDarkEffect(nextId, {
      enabled: true,
      start,
      end: Math.min(sceneDuration, start + Math.min(1.2, Math.max(0.1, sceneDuration - start))),
      holdDuration: 0,
      intensity: 0,
    });
    updateSceneEffects("sceneStartDarkEffects", [...currentEffects, nextEffect]);
    setToast(`Đã thêm hiệu ứng tối ${currentEffects.length + 1}`);
    window.setTimeout(() => setToast(""), 2200);
  };
  const deleteSceneDarkEffect = (effectId: string) => {
    const nextEffects = sceneEffects.sceneStartDarkEffects.filter((effect) => effect.id !== effectId);
    updateSceneEffects("sceneStartDarkEffects", nextEffects);
    setEffectInputDrafts((items) => {
      const next = { ...items };
      (Object.keys(next) as string[]).filter((key) => key.includes(`:dark:${effectId}:`)).forEach((key) => delete next[key]);
      return next;
    });
  };

  const updateReviewSceneField = <K extends keyof Scene>(
    sceneId: string,
    key: K,
    value: Scene[K],
  ) => {
    if (!hydrated) return;
    setScenes((items) => items.map((item) => item.id === sceneId
      ? { ...item, [key]: value }
      : item));
  };

  const updateReviewSceneDuration = (sceneId: string, value: string) => {
    if (!hydrated) return;
    const nextDuration = Math.max(0.1, Number(value.replace(",", ".")) || 0.1);
    const nextTotal = visibleScenes.reduce(
      (total, item) => total + (item.id === sceneId ? nextDuration : Math.max(0.1, item.end - item.start)),
      0,
    );
    let cursor = 0;
    setScenes((items) => items.map((item) => {
      if (item.sceneVisible === false) return item;
      const duration = item.id === sceneId
        ? nextDuration
        : Math.max(0.1, item.end - item.start);
      const next = {
        ...item,
        start: Number(cursor.toFixed(2)),
        end: Number((cursor + duration).toFixed(2)),
      };
      cursor += duration;
      return next;
    }));
    setProjectDuration((current) => Math.max(current, Number(nextTotal.toFixed(2))));
    setPlayTime((current) => Math.min(current, Number(nextTotal.toFixed(2))));
  };

  const updateReviewAudioTrackValue = <K extends keyof SceneAudioTrack>(
    sceneId: string,
    trackId: string,
    key: K,
    value: SceneAudioTrack[K],
  ) => {
    if (!hydrated) return;
    setScenes((items) => items.map((item) => {
      if (item.id !== sceneId) return item;
      const duration = Math.max(0.1, item.end - item.start);
      const nextTracks = (item.audioTracks ?? []).map((track) => {
        if (track.id !== trackId) return track;
        if (key === "start") {
          const start = Math.min(Math.max(0, duration - 0.1), Math.max(0, Number(value) || 0));
          return { ...track, start, end: Math.max(start + 0.1, track.end) };
        }
        if (key === "end") {
          return { ...track, end: Math.min(duration, Math.max(track.start + 0.1, Number(value) || track.start + 0.1)) };
        }
        if (key === "volume") return { ...track, volume: clampVolume(value, track.volume) };
        return { ...track, [key]: value };
      });
      return syncLegacyVoiceFields(item, nextTracks);
    }));
  };

  const updateReviewSceneImageValue = <K extends keyof SceneImage>(
    sceneId: string,
    imageId: string,
    key: K,
    value: SceneImage[K],
  ) => {
    if (!hydrated) return;
    setScenes((items) => items.map((item) => item.id === sceneId
      ? {
          ...item,
          sceneImages: (item.sceneImages ?? []).map((image) => image.id === imageId
            ? { ...image, [key]: value }
            : image),
        }
      : item));
  };

  const updateReviewPopupValue = <K extends keyof PopupConfig>(
    sceneId: string,
    popupId: string,
    key: K,
    value: PopupConfig[K],
  ) => {
    if (!hydrated) return;
    setScenes((items) => items.map((item) => {
      if (item.id !== sceneId) return item;
      const popups = scenePopupList(item);
      const popupIndex = popups.findIndex((popup) => popup.id === popupId);
      if (popupIndex < 0) return item;
      const nextPopup = { ...popups[popupIndex], [key]: value } as PopupConfig;
      const nextPopups = popups.map((popup, index) => index === popupIndex ? nextPopup : popup);
      return {
        ...item,
        popups: nextPopups,
        ...(popupIndex === 0 ? popupSceneFields(nextPopup) : {}),
      };
    }));
  };

  const updateReviewPopupHeight = (sceneId: string, popupId: string, value: string) => {
    if (!hydrated) return;
    const nextHeight = Math.min(440, Math.max(170, Number(value.replace(",", ".")) || 170));
    setScenes((items) => items.map((item) => {
      if (item.id !== sceneId) return item;
      const popups = scenePopupList(item);
      const popupIndex = popups.findIndex((popup) => popup.id === popupId);
      if (popupIndex < 0) return item;
      const popup = popups[popupIndex];
      const defaults = popupSectionDefaults(popup.layout, nextHeight);
      const nextPopup = {
        ...popup,
        height: nextHeight,
        imageHeight: defaults.imageHeight,
        contentHeight: defaults.contentHeight,
      };
      const nextPopups = popups.map((entry, index) => index === popupIndex ? nextPopup : entry);
      return {
        ...item,
        popups: nextPopups,
        ...(popupIndex === 0 ? popupSceneFields(nextPopup) : {}),
      };
    }));
  };

  const reviewNumber = (value: string, fallback: number) => {
    const numeric = Number(value.replace(",", "."));
    return Number.isFinite(numeric) ? numeric : fallback;
  };

  const updatePopupValues = (
    values: Partial<PopupConfig>,
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
      const nextPopup = { ...current, ...values } as PopupConfig;
      const nextPopups = popups.map((popup, index) => index === popupIndex ? nextPopup : popup);
      return {
        ...item,
        popups: nextPopups,
        ...(popupIndex === 0 ? popupSceneFields(nextPopup) : {}),
      };
    }));
  };

  const updatePopup = <K extends keyof PopupConfig>(
    key: K,
    value: PopupConfig[K],
    popupId = selectedPopupId,
  ) => {
    if (key === "layout") {
      const layout = popupDimensionLayout(value);
      const defaults = popupSectionDefaults(layout, activePopup?.height ?? 255);
      updatePopupValues({
        layout,
        height: defaults.height,
        imageHeight: defaults.imageHeight,
        contentHeight: defaults.contentHeight,
      }, popupId);
      return;
    }
    updatePopupValues({ [key]: value } as Partial<PopupConfig>, popupId);
  };

  const updatePopupHeight = (value: number, popupId = selectedPopupId) => {
    const popup = scenePopups.find((item) => item.id === popupId) ?? activePopup;
    if (!popup) return;
    const height = Math.min(440, Math.max(170, Number(value) || 170));
    const defaults = popupSectionDefaults(popup.layout, height);
    updatePopupValues({
      height,
      imageHeight: defaults.imageHeight,
      contentHeight: defaults.contentHeight,
    }, popupId);
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
            avatar: String(scene.avatar ?? ""),
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
              voiceStart: Math.max(0, Number(scene.voiceStart ?? 0) || 0),
              voiceVolume: clampVolume(scene.voiceVolume, 95),
              audioTracks: (scene.audioTracks ?? []).map((track) => ({ ...track })),
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
            avatar: data.avatar,
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
            voiceStart: data.voiceStart,
            voiceVolume: data.voiceVolume,
            audioTracks: data.audioTracks.map((track) => ({ ...track })),
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

  const resetActiveTextOverlayGeometry = () => {
    if (!activeTextOverlay) return;
    updateTextOverlay("x", 50);
    updateTextOverlay("y", 18);
    updateTextOverlay("width", undefined);
    updateTextOverlay("height", undefined);
  };

  type TextOverlayTimingField = "start" | "end";
  const textOverlayTimingKey = (overlayId: string, field: TextOverlayTimingField) =>
    `${scene.id}:text:${overlayId}:${field}`;
  const textOverlayTimingValue = (overlay: TextOverlay, field: TextOverlayTimingField) => {
    const draft = textOverlayTimingDrafts[textOverlayTimingKey(overlay.id, field)];
    if (draft !== undefined) return draft;
    const sceneLimit = Math.max(0.1, sceneDuration);
    const start = Math.min(sceneLimit - 0.1, Math.max(0, Number(overlay.start) || 0));
    const end = Math.min(sceneLimit, Math.max(start + 0.1, Number(overlay.end) || sceneLimit));
    return String(field === "start" ? start : end);
  };
  const updateTextOverlayTimingInput = (
    overlay: TextOverlay,
    field: TextOverlayTimingField,
    value: string,
  ) => {
    const key = textOverlayTimingKey(overlay.id, field);
    setTextOverlayTimingDrafts((items) => ({ ...items, [key]: value }));
    if (!value.trim()) return;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;
    const sceneLimit = Math.max(0.1, sceneDuration);
    const currentStart = Math.min(sceneLimit - 0.1, Math.max(0, Number(overlay.start) || 0));
    if (field === "start") {
      const nextStart = Math.min(sceneLimit - 0.1, Math.max(0, numericValue));
      const currentEnd = Math.min(sceneLimit, Math.max(currentStart + 0.1, Number(overlay.end) || sceneLimit));
      updateTextOverlay("start", nextStart);
      if (currentEnd < nextStart + 0.1) {
        updateTextOverlay("end", Math.min(sceneLimit, nextStart + 0.1));
      }
    } else {
      updateTextOverlay("end", Math.min(sceneLimit, Math.max(currentStart + 0.1, numericValue)));
    }
  };
  const commitTextOverlayTimingInput = (overlay: TextOverlay, field: TextOverlayTimingField) => {
    const key = textOverlayTimingKey(overlay.id, field);
    const draft = textOverlayTimingDrafts[key];
    const numericValue = Number(draft);
    if (draft !== undefined && Number.isFinite(numericValue)) {
      updateTextOverlayTimingInput(overlay, field, String(numericValue));
      setTextOverlayTimingDrafts((items) => ({ ...items, [key]: String(numericValue) }));
      return;
    }
    setTextOverlayTimingDrafts((items) => {
      const next = { ...items };
      delete next[key];
      return next;
    });
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
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    setScenes((items) =>
      items.map((item) => {
        if (!targetIds.has(item.id)) return item;
        return {
          ...item,
          zoomStart: numericValue,
        };
      }),
    );
  };

  const updateZoomEnd = (value: number) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    setScenes((items) =>
      items.map((item) => {
        if (!targetIds.has(item.id)) return item;
        return {
          ...item,
          zoomEnd: numericValue,
        };
      }),
    );
  };

  const updateZoomInDuration = (value: number) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    setScenes((items) =>
      items.map((item) => {
        if (!targetIds.has(item.id)) return item;
        return {
          ...item,
          zoomInDuration: numericValue,
        };
      }),
    );
  };

  type ZoomInputField = "zoomStart" | "zoom" | "zoomEnd" | "zoomInDuration" | "zoomOutDuration";
  const zoomInputKey = (field: ZoomInputField) => `${scene.id}:${field}`;
  const zoomInputValue = (field: ZoomInputField, value: number) =>
    zoomInputDrafts[zoomInputKey(field)] ?? String(value);
  const updateZoomInput = (field: ZoomInputField, value: string) => {
    const key = zoomInputKey(field);
    setZoomInputDrafts((items) => ({ ...items, [key]: value }));
    if (!value.trim()) return;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;
    if (field === "zoomStart") updateZoomStart(numericValue);
    if (field === "zoomEnd") updateZoomEnd(numericValue);
    if (field === "zoomInDuration") updateZoomInDuration(numericValue);
    if (field === "zoom" || field === "zoomOutDuration") updateScene(field, numericValue);
  };
  const commitZoomInput = (field: ZoomInputField) => {
    const key = zoomInputKey(field);
    const draft = zoomInputDrafts[key];
    const numericValue = Number(draft);
    if (draft !== undefined && Number.isFinite(numericValue)) {
      updateZoomInput(field, String(numericValue));
      setZoomInputDrafts((items) => ({ ...items, [key]: String(numericValue) }));
      return;
    }
    setZoomInputDrafts((items) => {
      const next = { ...items };
      delete next[key];
      return next;
    });
  };

  type SceneEffectNumberField =
    | "sceneStartDarkDuration" | "sceneStartDarkIntensity"
    | "snowIntensity" | "snowSpeed"
    | "lightFlickerIntensity" | "lightFlickerSpeed"
    | "rainIntensity" | "rainSpeed"
    | "thunderIntensity" | "thunderSpeed"
    | "cloudIntensity" | "cloudSpeed";
  const effectInputKey = (field: SceneEffectNumberField) => `${scene.id}:${field}`;
  const effectInputValue = (field: SceneEffectNumberField, value: number) =>
    effectInputDrafts[effectInputKey(field)] ?? String(value);
  const updateEffectInput = (field: SceneEffectNumberField, value: string) => {
    const key = effectInputKey(field);
    setEffectInputDrafts((items) => ({ ...items, [key]: value }));
    if (!value.trim()) return;
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) updateSceneEffects(field, numericValue);
  };
  const commitEffectInput = (field: SceneEffectNumberField) => {
    const key = effectInputKey(field);
    const draft = effectInputDrafts[key];
    const numericValue = Number(draft);
    if (draft !== undefined && Number.isFinite(numericValue)) {
      updateEffectInput(field, String(numericValue));
      setEffectInputDrafts((items) => ({ ...items, [key]: String(numericValue) }));
      return;
    }
    setEffectInputDrafts((items) => {
      const next = { ...items };
      delete next[key];
      return next;
    });
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
      renderProfile: "quality",
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
        audioTracks: (item.audioTracks ?? []).map((track, audioIndex) => ({
          ...track,
          id: `${copyId}-scene-${String(index + 1).padStart(2, "0")}-audio-${audioIndex + 1}`,
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

  const reorderProjectClips = (draggedProjectId: string, targetProjectId: string) => {
    const nextItems = reorderById(projectItems, draggedProjectId, targetProjectId);
    if (nextItems === projectItems) return;
    setProjects(nextItems);
    setToast("Đã cập nhật vị trí clip");
    window.setTimeout(() => setToast(""), 1800);
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
    const nextId = `scene-${Date.now().toString(36)}-${number}`;
    const next: Scene = {
      id: nextId,
      number,
      sceneName: `Cảnh ${number}`,
      title: "",
      location: "",
      reference: "",
      popup: "",
      narration: "",
      voice: "",
      image: "",
      avatar: "",
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
      audioTracks: [defaultSceneAudioTrack(`${nextId}-audio-1`, { end: 3 })],
      voiceFile: "",
      voiceStart: 0,
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
      audioTracks: (source.audioTracks ?? []).map((track, index) => ({
        ...track,
        id: `${copiedId}-audio-${index + 1}`,
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

  const addSceneAudioTrack = (startValue = 0, endValue = sceneDuration) => {
    if (!scene) return "";
    const currentTracks = scene.audioTracks ?? [];
    const start = Math.min(
      Math.max(0, sceneDuration - 0.1),
      Math.max(0, Number(startValue) || 0),
    );
    const end = Math.min(
      sceneDuration,
      Math.max(start + 0.1, Number(endValue) || sceneDuration),
    );
    const id = `${scene.id}-audio-${currentTracks.length + 1}-${Date.now().toString(36)}`;
    const nextTrack = defaultSceneAudioTrack(id, {
      name: currentTracks.length === 0 ? "Thuyết minh" : `Âm thanh ${currentTracks.length + 1}`,
      volume: currentTracks.length === 0 ? 95 : 100,
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
    });
    setScenes((items) => items.map((item) => item.id === scene.id
      ? syncLegacyVoiceFields(item, [...(item.audioTracks ?? []), nextTrack])
      : item));
    setRenamingAudioTrackId(nextTrack.id);
    setRenamingAudioTrackName(nextTrack.name);
    setToast("Đã thêm track âm thanh mới");
    window.setTimeout(() => setToast(""), 2000);
    return nextTrack.id;
  };

  const updateSceneAudioTrack = <K extends keyof SceneAudioTrack>(
    trackId: string,
    key: K,
    value: SceneAudioTrack[K],
  ) => {
    if (!scene) return;
    setScenes((items) => items.map((item) => {
      if (item.id !== scene.id) return item;
      const duration = Math.max(0.1, item.end - item.start);
      const nextTracks = (item.audioTracks ?? []).map((track) => {
        if (track.id !== trackId) return track;
        if (key === "start") {
          const start = Math.min(
            Math.max(0, duration - 0.1),
            Math.max(0, Number(value) || 0),
          );
          return { ...track, start: Number(start.toFixed(2)), end: Math.max(start + 0.1, track.end) };
        }
        if (key === "end") {
          const end = Math.min(duration, Math.max(track.start + 0.1, Number(value) || track.start + 0.1));
          return { ...track, end: Number(end.toFixed(2)) };
        }
        if (key === "volume") return { ...track, volume: clampVolume(value, track.volume) };
        return { ...track, [key]: value };
      });
      return syncLegacyVoiceFields(item, nextTracks);
    }));
  };

  const startSceneAudioTrackRename = (track: SceneAudioTrack, index: number) => {
    setRenamingAudioTrackId(track.id);
    setRenamingAudioTrackName(safeTrim(track.name) || `Âm thanh ${index + 1}`);
  };

  const finishSceneAudioTrackRename = () => {
    if (!renamingAudioTrackId) return;
    const trackIndex = sceneAudioTracks.findIndex((track) => track.id === renamingAudioTrackId);
    const nextName = safeTrim(renamingAudioTrackName) || `Âm thanh ${Math.max(1, trackIndex + 1)}`;
    updateSceneAudioTrack(renamingAudioTrackId, "name", nextName);
    setRenamingAudioTrackId("");
    setRenamingAudioTrackName("");
  };

  const cancelSceneAudioTrackRename = () => {
    setRenamingAudioTrackId("");
    setRenamingAudioTrackName("");
  };

  const deleteSceneAudioTrack = (trackId: string) => {
    if (!scene) return;
    const key = sceneAudioTrackKey(scene.id, trackId);
    setScenes((items) => items.map((item) => item.id === scene.id
      ? syncLegacyVoiceFields(item, (item.audioTracks ?? []).filter((track) => track.id !== trackId))
      : item));
    setAudioFiles((items) => {
      const next = { ...items };
      delete next[key];
      return next;
    });
    setAudioPreview((items) => {
      const next = { ...items };
      if (next[key]) URL.revokeObjectURL(next[key]);
      delete next[key];
      return next;
    });
    if (renamingAudioTrackId === trackId) cancelSceneAudioTrackRename();
    setToast("Đã xóa âm thanh · Ctrl+Z để hoàn tác");
    window.setTimeout(() => setToast(""), 2400);
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
    setEditorSectionOpen("popup", true);
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
        end: sceneDuration,
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
    setEditorSectionOpen("text", true);
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
    setEditorSectionOpen("audio", true);
    setPlayTime(Number((scene.start + start).toFixed(2)));
    setPlaying(false);
    setToast(`Đã thêm phụ đề ${currentSubtitles.length + 1}`);
    window.setTimeout(() => setToast(""), 2200);
  };

  const importSubtitlesFromFile = async (file: File) => {
    if (!scene || !hydrated || subtitleImportBusy) return;
    const targetSceneId = scene.id;
    const targetDuration = Math.max(0.1, scene.end - scene.start);
    setSubtitleImportBusy(true);
    try {
      const parsedCues = parseSubtitleFileText(await file.text());
      if (!parsedCues.length) {
        throw new Error("Không tìm thấy cue hợp lệ trong file SRT/VTT");
      }
      const importedCues = parsedCues
        .map((cue, index) => ({
          ...cue,
          start: Math.max(0, cue.start),
          end: Math.min(targetDuration, cue.end),
          index,
        }))
        .filter((cue) => cue.end - cue.start >= 0.05)
        .map((cue, index) => normalizeSubtitleCue(
          {
            id: `${targetSceneId}-subtitle-import-${Date.now().toString(36)}-${index + 1}`,
            text: cue.text,
            start: cue.start,
            end: cue.end,
          },
          `${targetSceneId}-subtitle-${index + 1}`,
          targetDuration,
        ));
      if (!importedCues.length) {
        throw new Error(`Timestamp trong file không nằm trong độ dài cảnh (${targetDuration.toFixed(1)} giây)`);
      }
      if ((scene.subtitles ?? []).length > 0
        && !window.confirm("Import SRT/VTT sẽ thay thế toàn bộ phụ đề hiện tại của cảnh này. Tiếp tục?")) {
        return;
      }
      setScenes((items) => items.map((item) => item.id === targetSceneId
        ? { ...item, subtitleEnabled: true, subtitles: importedCues }
        : item));
      setSubtitleAlignState({
        status: "success",
        sceneId: targetSceneId,
        message: `Đã import ${importedCues.length} cue từ ${file.name}. Hãy phát và rà soát lại.`,
        progress: 100,
      });
      setPlayTime(Number((scene.start + importedCues[0].start).toFixed(2)));
      setPlaying(false);
      setToast(`Đã import ${importedCues.length} cue phụ đề`);
      window.setTimeout(() => setToast(""), 3200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể import file SRT/VTT";
      setSubtitleAlignState({ status: "error", sceneId: targetSceneId, message, progress: 0 });
      setToast(message);
      window.setTimeout(() => setToast(""), 3200);
    } finally {
      setSubtitleImportBusy(false);
    }
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
    const primaryAudioTrack = (scene.audioTracks ?? [])[0];
    const primaryAudioSource = primaryAudioTrack?.source ?? scene.voiceFile;
    const selectedAudio = (primaryAudioTrack
      ? audioFiles[sceneAudioTrackKey(scene.id, primaryAudioTrack.id)]
      : undefined)
      ?? audioFiles[scene.id]
      ?? localRenderFiles.find((file) => fileNameOnly(file.name) === fileNameOnly(primaryAudioSource));
    if (!narration) {
      setToast("Hãy nhập Lời thuyết minh trước khi tạo phụ đề");
      window.setTimeout(() => setToast(""), 2600);
      return;
    }
    if (!selectedAudio && !isRemoteUrl(primaryAudioSource)) {
      setToast("Hãy chọn file audio cho cảnh trước khi tạo phụ đề");
      window.setTimeout(() => setToast(""), 2600);
      return;
    }
    const targetSceneId = scene.id;
    const targetDuration = Math.max(0.1, scene.end - scene.start);
    setSubtitleAlignState({ status: "running", sceneId: targetSceneId, message: "Đang nghe audio và tạo timestamp…" });
    let progressTimer: number | null = null;
    setSubtitleAlignState((current) => current.sceneId === targetSceneId
      ? { ...current, progress: 5 }
      : current);
    try {
      const form = new FormData();
      form.append("text", narration);
      form.append("duration", String(targetDuration));
      if (selectedAudio) form.append("audio", selectedAudio, selectedAudio.name);
      else form.append("audioUrl", safeTrim(primaryAudioSource));
      setSubtitleAlignState((current) => current.sceneId === targetSceneId
        ? { ...current, progress: 12 }
        : current);
      progressTimer = window.setInterval(() => {
        setSubtitleAlignState((current) => {
          if (current.status !== "running" || current.sceneId !== targetSceneId) return current;
          return { ...current, progress: Math.min(92, (current.progress ?? 0) + 2) };
        });
      }, 500);
      const response = await fetch(`${LOCAL_RENDERER_URL}/api/align-subtitles`, {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Không thể tạo timestamp phụ đề");
      setSubtitleAlignState((current) => current.sceneId === targetSceneId
        ? { ...current, progress: 96 }
        : current);
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
      setSubtitleAlignState({ status: "success", sceneId: targetSceneId, message, progress: 100 });
      setToast(message);
      window.setTimeout(() => setToast(""), 3600);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể tạo phụ đề";
      setSubtitleAlignState({ status: "error", sceneId: targetSceneId, message, progress: 0 });
      setToast(message);
      window.setTimeout(() => setToast(""), 3600);
    } finally {
      if (progressTimer !== null) window.clearInterval(progressTimer);
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
      ? { status: "idle", sceneId: "", message: "", progress: 0 }
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
    setEditorSectionOpen("text", true);
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
    setEditorSectionOpen("images", true);
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

  const resetActiveSceneImageGeometry = () => {
    if (!activeSceneImage) return;
    const defaults = defaultSceneImage(activeSceneImage.id);
    updateSceneImage("x", defaults.x);
    updateSceneImage("y", defaults.y);
    updateSceneImage("width", defaults.width);
    updateSceneImage("height", defaults.height);
  };

  const updateSceneImageEndTime = (value: number) => {
    if (!activeSceneImage) return;
    const minimumEnd = Math.min(sceneDuration, activeSceneImage.start + 0.1);
    const numericValue = Number(value);
    const nextEnd = Math.min(
      sceneDuration,
      Math.max(minimumEnd, Number.isFinite(numericValue) ? numericValue : minimumEnd),
    );
    updateSceneImage("duration", Number((nextEnd - activeSceneImage.start).toFixed(2)));
  };

  const updateSceneImageTransitionEndInput = (value: string) => {
    const imageId = activeSceneImage?.id;
    if (!imageId || !activeSceneImage) return;
    setSceneImageTransitionEndDrafts((items) => ({ ...items, [imageId]: value }));
    if (!value.trim()) return;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;
    updateSceneImage(
      "transitionEnd",
      Math.max(activeSceneImage.start + 0.1, numericValue),
    );
  };

  const commitSceneImageTransitionEnd = (imageId: string, value: string) => {
    const image = sceneImages.find((item) => item.id === imageId);
    if (!image) return;
    const numericValue = Number(value);
    const nextEnd = Number.isFinite(numericValue)
      ? Math.max(image.start + 0.1, numericValue)
      : Math.max(image.start + 0.1, image.transitionEnd);
    setSceneImageTransitionEndDrafts((items) => ({ ...items, [imageId]: String(nextEnd) }));
    updateSceneImage("transitionEnd", nextEnd);
  };

  const updateSceneImageUrl = (url: string) => {
    const imageId = activeSceneImage?.id;
    if (imageId) {
      setSceneImageSpriteDelayDrafts((items) => {
        if (!(imageId in items)) return items;
        const next = { ...items };
        delete next[imageId];
        return next;
      });
      setSceneImageSpritePreviewUrls((items) => {
        if (!items[imageId]) return items;
        const next = { ...items };
        delete next[imageId];
        return next;
      });
      setSceneImageSpriteNotice({ imageId, status: "idle", message: "" });
    }
    updateSceneImage("url", url);
    updateSceneImage("mediaType", isVideoMedia(url) ? "video" : "image");
    updateSceneImage("spriteSheet", false);
    updateSceneImage("transparent", isTransparentMedia(url));
  };

  const updateSceneImageSpriteDelay = (value: string) => {
    const imageId = activeSceneImage?.id;
    const nextInput = value.replace(/[^0-9]/g, "");
    if (imageId) {
      setSceneImageSpriteDelayDrafts((items) => ({ ...items, [imageId]: nextInput }));
      setSceneImageSpritePreviewUrls((items) => {
        if (!items[imageId]) return items;
        const next = { ...items };
        delete next[imageId];
        return next;
      });
      setSceneImageSpriteNotice({ imageId, status: "idle", message: "" });
    }
    if (!nextInput) return;
    const numeric = Number(nextInput);
    if (!Number.isFinite(numeric)) return;
    const nextDelay = Math.min(1000, Math.max(60, Math.round(numeric)));
    updateSceneImage("spriteDelay", nextDelay);
    updateSceneImage("spriteSheet", false);
  };

  const commitSceneImageSpriteDelay = (imageId: string, value: string) => {
    const nextDelay = Math.min(1000, Math.max(60, Math.round(Number(value) || 180)));
    setSceneImageSpriteDelayDrafts((items) => {
      const next = { ...items };
      delete next[imageId];
      return next;
    });
    updateSceneImage("spriteDelay", nextDelay);
    updateSceneImage("spriteSheet", false);
    return nextDelay;
  };

  const prepareSceneImageSprite = async (
    imageId: string,
    url: string,
    explicit = false,
    requestedDelay = 180,
    sourceFile: File | null = null,
  ) => {
    if (!explicit) return;
    const sourceUrl = safeTrim(url);
    const delay = Math.min(1000, Math.max(60, Math.round(Number(requestedDelay) || 180)));
    if (!scene || !imageId) return;
    if (!sourceUrl && !sourceFile) {
      setSceneImageSpriteNotice({ imageId, status: "error", message: "Hãy nhập URL hoặc chọn file sprite trước." });
      return;
    }
    if (sourceFile && (sourceFile.type.startsWith("video/") || !sourceFile.type.startsWith("image/"))) {
      setSceneImageSpriteNotice({ imageId, status: "error", message: "File sprite phải là hình PNG, JPG, WebP hoặc GIF." });
      return;
    }
    if (!sourceFile && (!isRemoteUrl(sourceUrl) || isVideoMedia(sourceUrl))) {
      setSceneImageSpriteNotice({ imageId, status: "error", message: "Chỉ hỗ trợ URL hình ảnh http/https." });
      return;
    }
    setSceneImageSpriteNotice({ imageId, status: "processing", message: "Đang chuyển sprite thành hình động…" });
    setToast("Đang chuyển sprite thành hình động…");
    try {
      const sourceData = sourceFile ? await fileToDataUrl(sourceFile) : "";
      const response = await fetch(`${LOCAL_RENDERER_URL}/api/process-sprite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(sourceUrl ? { sourceUrl } : {}),
          ...(sourceFile ? { sourceData, sourceName: sourceFile.name } : {}),
          delay,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "Không thể kết nối dịch vụ xử lý hình.");
      if (!result?.processed || !result.assetUrl) {
        throw new Error("Không phát hiện được sprite trong hình này.");
      }
      setSceneImageSpritePreviewUrls((items) => ({ ...items, [imageId]: result.assetUrl }));
      setScenes((items) => items.map((item) => item.id === scene.id
        ? {
            ...item,
            sceneImages: (item.sceneImages ?? []).map((image) => image.id === imageId
              ? { ...image, spriteSheet: true, spriteDelay: Number(result.delay) || delay, transparent: true }
              : image),
          }
        : item));
      const detectedGrid = Number(result.columns) > 0 && Number(result.rows) > 0
        ? ` · ${Number(result.columns)}×${Number(result.rows)}`
        : "";
      const frameMessage = Number(result.frameCount) > 0
        ? ` (${result.frameCount} frame${detectedGrid}${` · ${Number(result.delay) || delay}ms`})`
        : ` (${detectedGrid.replace(/^ · /, "")}${detectedGrid ? " · " : ""}${Number(result.delay) || delay}ms)`;
      setSceneImageSpriteNotice({ imageId, status: "success", message: `Đã chuyển thành hình động${frameMessage}.` });
      setToast(`Đã chuyển sprite thành hình động${frameMessage}`);
      window.setTimeout(() => setToast(""), 3000);
    } catch (error) {
      const message = error instanceof Error && error.message
        ? `Chuyển sprite thành hình động thất bại: ${error.message}`
        : "Chuyển sprite thành hình động thất bại.";
      setSceneImageSpriteNotice({ imageId, status: "error", message });
      setToast(message);
      window.setTimeout(() => setToast(""), 3200);
    }
  };

  const handleSceneImageSpriteFile = async (file: File | null) => {
    if (!file || !scene || !activeSceneImage) return;
    if (file.type.startsWith("video/") || !file.type.startsWith("image/")) {
      setSceneImageSpriteNotice({ imageId: activeSceneImage.id, status: "error", message: "File sprite phải là hình PNG, JPG, WebP hoặc GIF." });
      return;
    }
    const imageId = activeSceneImage.id;
    const delay = commitSceneImageSpriteDelay(imageId, activeSceneImageSpriteDelayInput);
    await addAssetsToLibrary([file]);
    setScenes((items) => items.map((item) => item.id === scene.id
      ? {
          ...item,
          sceneImages: (item.sceneImages ?? []).map((image) => image.id === imageId
            ? { ...image, url: file.name, mediaType: "image", spriteSheet: false, transparent: true }
            : image),
        }
      : item));
    await prepareSceneImageSprite(imageId, file.name, true, delay, file);
  };

  useEffect(() => {
    const imageId = activeSceneImage?.id;
    const imageUrl = activeSceneImage?.url;
    if (!hydrated || !activeSceneImage?.spriteSheet || !imageId || !imageUrl) return;
    const localSpriteFile = localRenderFiles.find((file) => file.name === imageUrl) ?? null;
    void prepareSceneImageSprite(imageId, imageUrl, true, activeSceneImage?.spriteDelay, localSpriteFile);
    // Restore an explicitly converted sprite when switching layers. New URLs
    // are never processed until the user clicks the conversion button.
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

  const toggleSceneImageEditorVisibility = (imageId: string) => {
    if (!scene) return;
    setScenes((items) => items.map((item) => item.id === scene.id
      ? {
          ...item,
          sceneImages: (item.sceneImages ?? []).map((image) => image.id === imageId
            ? { ...image, editorVisible: image.editorVisible === false }
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
    selectPreviewLayer("image", draggedImage.id);
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
    selectPreviewLayer("image", activeSceneImage.id);
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
      const nextWidth = Math.min(200, Math.max(1, startWidth + ((moveEvent.clientX - startX) / bounds.width) * 100));
      const nextHeight = Math.min(200, Math.max(1, startHeight + ((moveEvent.clientY - startY) / bounds.height) * 100));
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

  const toggleTextOverlayEditorVisibility = (overlayId: string) => {
    if (!scene) return;
    setScenes((items) => items.map((item) => item.id === scene.id
      ? {
          ...item,
          textOverlays: (item.textOverlays ?? []).map((overlay) => overlay.id === overlayId
            ? { ...overlay, editorVisible: overlay.editorVisible === false }
            : overlay),
        }
      : item));
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

  const togglePopupEditorVisibility = (popupId: string) => {
    if (!scene) return;
    setScenes((items) => items.map((item) => {
      if (item.id !== scene.id) return item;
      const popups = scenePopupList(item).map((popup) => popup.id === popupId
        ? { ...popup, editorVisible: popup.editorVisible === false }
        : popup);
      const firstPopup = popups[0] ?? defaultPopupConfig(`${item.id}-popup-1`);
      return {
        ...item,
        popups,
        ...popupSceneFields(firstPopup),
      };
    }));
  };

  const beginLayerListDrag = (
    type: "popup" | "text" | "image",
    id: string,
    event: React.DragEvent<HTMLElement>,
  ) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    setLayerListDrag({ type, id, overId: "" });
  };

  const updateLayerListDragOver = (
    type: "popup" | "text" | "image",
    id: string,
    event: React.DragEvent<HTMLDivElement>,
  ) => {
    if (layerListDrag.type !== type || !layerListDrag.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setLayerListDrag((current) => current.type === type
      ? { ...current, overId: id }
      : current);
  };

  const finishLayerListDrop = (
    type: "popup" | "text" | "image",
    targetId: string,
    event: React.DragEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const draggedLayerId = layerListDrag.type === type ? layerListDrag.id : "";
    if (!scene || !draggedLayerId || draggedLayerId === targetId) {
      setLayerListDrag({ type: "", id: "", overId: "" });
      return;
    }
    setScenes((items) => items.map((item) => {
      if (item.id !== scene.id) return item;
      if (type === "popup") {
        const popups = reorderById(scenePopupList(item), draggedLayerId, targetId);
        const firstPopup = popups[0] ?? defaultPopupConfig(`${item.id}-popup-1`);
        return { ...item, popups, ...popupSceneFields(firstPopup) };
      }
      if (type === "text") {
        const textOverlays = reorderById(item.textOverlays ?? [], draggedLayerId, targetId);
        const firstTextOverlay = textOverlays[0] ?? defaultTextOverlay(`${item.id}-text-1`);
        return { ...item, textOverlays, ...textOverlaySceneFields(firstTextOverlay) };
      }
      return { ...item, sceneImages: reorderById(item.sceneImages ?? [], draggedLayerId, targetId) };
    }));
    if (type === "popup") setSelectedPopupId(draggedLayerId);
    if (type === "text") setSelectedTextOverlayId(draggedLayerId);
    if (type === "image") setSelectedSceneImageId(draggedLayerId);
    setLayerListDrag({ type: "", id: "", overId: "" });
  };

  const clearLayerListDrag = () => setLayerListDrag({ type: "", id: "", overId: "" });

  const toggleRuler = () => {
    if (playing) {
      setRulerEnabled(false);
      setAlignmentGuides(EMPTY_ALIGNMENT_GUIDES);
      return;
    }
    const next = !rulerEnabled;
    setRulerEnabled(next);
    if (!next) setAlignmentGuides(EMPTY_ALIGNMENT_GUIDES);
  };

  const togglePreviewFullscreen = () => setPreviewFullscreen((current) => !current);

  const adjustReviewZoom = (delta: number, viewport?: HTMLDivElement | null) => {
    const oldZoom = reviewZoomRef.current;
    const nextZoom = clampReviewZoom(oldZoom + delta);
    if (nextZoom === oldZoom) return;
    reviewZoomRef.current = nextZoom;
    if (viewport) {
      const bounds = viewport.getBoundingClientRect();
      const pointerOffsetX = bounds.width / 2;
      const pointerOffsetY = bounds.height / 2;
      const contentPositionX = viewport.scrollLeft + pointerOffsetX;
      const contentPositionY = viewport.scrollTop + pointerOffsetY;
      const scaleRatio = nextZoom / oldZoom;
      window.requestAnimationFrame(() => {
        viewport.scrollLeft = Math.max(0, contentPositionX * scaleRatio - pointerOffsetX);
        viewport.scrollTop = Math.max(0, contentPositionY * scaleRatio - pointerOffsetY);
      });
    }
    setReviewZoom(nextZoom);
  };

  const handleReviewWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
    event.preventDefault();
    adjustReviewZoom(event.deltaY < 0 ? 10 : -10, event.currentTarget);
  };

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
    if (!activePopup) return;
    selectPreviewLayer("popup", activePopup.id);
    const preview = event.currentTarget.closest(".phone-preview");
    if (!(preview instanceof HTMLElement)) return;
    const bounds = preview.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = activePopup.width ?? 90;
    const startGeometry = popupSectionGeometry(activePopup);
    const startHeight = startGeometry.height || activePopup.height || 255;
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
      const layout = popupDimensionLayout(activePopup.layout);
      const nextDimensions = layout === "split"
        ? {
            imageHeight: Math.round(height),
            contentHeight: Math.round(height),
          }
        : startGeometry.imageHeight > 0 && startGeometry.contentHeight > 0
          ? {
              imageHeight: startGeometry.imageHeight,
              contentHeight: Math.round(Math.max(48, height - startGeometry.imageHeight)),
            }
          : startGeometry.imageHeight > 0
            ? { imageHeight: Math.round(height), contentHeight: 0 }
            : { imageHeight: 0, contentHeight: Math.round(height) };
      updatePopupValues({ width: Math.round(width), height: Math.round(height), ...nextDimensions });
    };
    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
  };

  const startPopupSectionResize = (
    event: React.PointerEvent<HTMLButtonElement>,
    section: "image" | "content",
    popupId = activePopup?.id,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (playing || !popupId) return;
    const preview = event.currentTarget.closest(".phone-preview");
    if (!(preview instanceof HTMLElement)) return;
    const popup = scenePopups.find((item) => item.id === popupId) ?? activePopup;
    if (!popup) return;
    selectPreviewLayer("popup", popup.id);
    const bounds = preview.getBoundingClientRect();
    if (bounds.height <= 0) return;
    const geometry = popupSectionGeometry(popup);
    const layout = popupDimensionLayout(popup.layout);
    const startHeight = section === "image" ? geometry.imageHeight : geometry.contentHeight;
    const otherHeight = section === "image" ? geometry.contentHeight : geometry.imageHeight;
    const maxPopupHeight = Math.min(440, bounds.height * 0.88);
    const maxHeight = layout === "split"
      ? maxPopupHeight
      : Math.max(48, maxPopupHeight - otherHeight);
    const startY = event.clientY;
    const field = section === "image" ? "imageHeight" : "contentHeight";
    const resize = (moveEvent: PointerEvent) => {
      const nextHeight = Math.min(
        maxHeight,
        Math.max(48, startHeight + moveEvent.clientY - startY),
      );
      const nextTotalHeight = layout === "split"
        ? Math.max(nextHeight, otherHeight)
        : nextHeight + otherHeight;
      updatePopupValues({
        [field]: Math.round(nextHeight),
        height: Math.round(nextTotalHeight),
      } as Partial<PopupConfig>, popupId);
    };
    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
  };

  const resetPopupSize = (popupId: string) => {
    const popup = scenePopups.find((item) => item.id === popupId);
    if (!popup) return;
    const defaults = popupSectionDefaults(popup.layout, 255);
    updatePopupValues({
      width: 90,
      height: defaults.height,
      imageHeight: defaults.imageHeight,
      contentHeight: defaults.contentHeight,
    }, popupId);
    setSelectedPopupId(popupId);
    setToast("Đã đặt lại kích thước Popup");
    window.setTimeout(() => setToast(""), 2200);
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
    if ((event.target as HTMLElement).closest(".popup-resize-handle")) return;
    const draggedPopup = scenePopups.find((popup) => popup.id === popupId) ?? activePopup;
    if (!draggedPopup) return;
    selectPreviewLayer("popup", draggedPopup.id);
    if (playing) return;
    event.preventDefault();
    event.stopPropagation();
    const preview = event.currentTarget.closest(".phone-preview");
    if (!(preview instanceof HTMLElement)) return;
    const bounds = preview.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
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
    if ((event.target as HTMLElement).closest(".map-text-resize-handle")) return;
    const overlayIndex = sceneTextOverlays.findIndex((item) => item.id === overlayId);
    const draggedOverlay = sceneTextOverlays[overlayIndex];
    if (!draggedOverlay) return;
    selectPreviewLayer("text", draggedOverlay.id);
    if (playing) return;
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

  const startTextOverlayResize = (
    event: React.PointerEvent<HTMLButtonElement>,
    overlayId = activeTextOverlay?.id,
  ) => {
    if (playing || !scene || !overlayId) return;
    event.preventDefault();
    event.stopPropagation();
    const overlayIndex = sceneTextOverlays.findIndex((item) => item.id === overlayId);
    const resizedOverlay = sceneTextOverlays[overlayIndex];
    if (!resizedOverlay) return;
    selectPreviewLayer("text", resizedOverlay.id);
    const preview = event.currentTarget.closest(".phone-preview");
    const target = event.currentTarget.closest(".map-text-overlay");
    if (!(preview instanceof HTMLElement) || !(target instanceof HTMLElement)) return;
    const bounds = preview.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = Number.isFinite(Number(resizedOverlay.width))
      ? Number(resizedOverlay.width)
      : (targetBounds.width / bounds.width) * 100;
    const startHeight = Number.isFinite(Number(resizedOverlay.height))
      ? Number(resizedOverlay.height)
      : (targetBounds.height / bounds.height) * 100;
    setDraggingTextOverlay(true);
    const resize = (moveEvent: PointerEvent) => {
      const width = Math.min(100, Math.max(4, startWidth + ((moveEvent.clientX - startX) / bounds.width) * 100));
      const height = Math.min(40, Math.max(3, startHeight + ((moveEvent.clientY - startY) / bounds.height) * 100));
      setScenes((items) => items.map((item) => {
        if (item.id !== scene.id) return item;
        const overlays = item.textOverlays ?? [];
        const nextOverlays = overlays.map((overlay, index) => index === overlayIndex
          ? { ...overlay, width: Number(width.toFixed(1)), height: Number(height.toFixed(1)) }
          : overlay);
        const nextOverlay = nextOverlays[overlayIndex];
        return {
          ...item,
          textOverlays: nextOverlays,
          ...(overlayIndex === 0 && nextOverlay ? textOverlaySceneFields(nextOverlay) : {}),
        };
      }));
    };
    resize(event.nativeEvent);
    const move = (moveEvent: PointerEvent) => resize(moveEvent);
    const stop = () => {
      setDraggingTextOverlay(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const startSubtitleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (playing || !scene || !subtitleGuideVisible) return;
    if ((event.target as HTMLElement).closest(".subtitle-resize-handle")) return;
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

  const startSubtitleResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (playing || !scene || !subtitleGuideVisible) return;
    event.preventDefault();
    event.stopPropagation();
    const preview = event.currentTarget.closest(".phone-preview");
    const target = event.currentTarget.closest(".subtitle-layout-guide");
    if (!(preview instanceof HTMLElement) || !(target instanceof HTMLElement)) return;
    const bounds = preview.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = subtitleStyle.boxWidth;
    const startHeight = Number.isFinite(Number(subtitleStyle.boxHeight))
      ? Number(subtitleStyle.boxHeight)
      : (targetBounds.height / bounds.height) * 100;
    setDraggingSubtitleResize(true);
    const resize = (moveEvent: PointerEvent) => {
      const width = Math.min(100, Math.max(40, startWidth + ((moveEvent.clientX - startX) / bounds.width) * 100));
      const height = Math.min(40, Math.max(3, startHeight + ((moveEvent.clientY - startY) / bounds.height) * 100));
      updateSubtitleStyle("boxWidth", Number(width.toFixed(1)));
      updateSubtitleStyle("boxHeight", Number(height.toFixed(1)));
    };
    resize(event.nativeEvent);
    const move = (moveEvent: PointerEvent) => resize(moveEvent);
    const stop = () => {
      setDraggingSubtitleResize(false);
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
    const decorationIndex = sceneDecorations.findIndex((item) => item.id === decorationId);
    const draggedDecoration = sceneDecorations[decorationIndex];
    if (!draggedDecoration) return;
    selectPreviewLayer("decoration", draggedDecoration.id);
    if (playing) return;
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
        renderProfile,
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
          const audioTrackPayloads = narrationEnabled
            ? (item.audioTracks ?? []).map((track) => ({
                id: track.id,
                name: track.name,
                source: assetReference(track.source),
                volume: Math.round(clampVolume(track.volume, 100)),
                start: Math.max(0, Number(track.start) || 0),
                end: Math.min(Math.max(0.1, item.end - item.start), Math.max(Number(track.start) + 0.1, Number(track.end) || 0.1)),
                visible: track.visible !== false,
              }))
            : [];
          const primaryAudioTrack = audioTrackPayloads[0];
          const voiceFile = narrationEnabled
            ? assetReference(primaryAudioTrack?.source || item.voiceFile)
            : "";
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
            imageHeight: popup.imageHeight,
            contentHeight: popup.contentHeight,
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
              spriteSheet: image.spriteSheet === true,
              spriteDelay: image.spriteDelay,
              transparent: image.transparent === true,
             })),
             subtitleEnabled: item.subtitleEnabled !== false,
             subtitleStart: item.subtitleStart,
             subtitleStyle: { ...normalizeSubtitleStyle(item.subtitleStyle) },
             subtitles: (item.subtitles ?? []).map((subtitle) => ({
              id: subtitle.id,
              text: subtitle.text,
              start: subtitle.start,
              end: subtitle.end,
              visible: subtitle.visible !== false,
            })),
            sceneVisible: item.sceneVisible !== false,
            ...(safeTrim(item.avatar) ? { avatar: assetReference(item.avatar) } : {}),
            popupDuration: firstPopup.duration,
            popupStart: firstPopup.start,
            body: firstPopup.body,
            imageVisible: imageEnabled,
            ...(sceneBackground ? { background: sceneBackground } : {}),
            backgroundVisible: item.backgroundVisible !== false,
            ...(image ? { image } : {}),
            narration: narrationEnabled ? item.narration : "",
            audioTracks: audioTrackPayloads,
            ...(voiceFile ? { voiceFile } : {}),
            voiceStart: primaryAudioTrack?.start ?? Math.max(0, Number(item.voiceStart) || 0),
            voiceVolume: primaryAudioTrack?.volume ?? Math.round(clampVolume(item.voiceVolume, 95)),
            popupIn: firstPopup.in,
            popupOut: firstPopup.out,
            popupWidth: firstPopup.width,
            popupHeight: firstPopup.height,
            popupImageHeight: firstPopup.imageHeight,
            popupContentHeight: firstPopup.contentHeight,
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
      renderProfile,
      projectTitle,
      background,
      previewBackground,
      backgroundMusic,
      backgroundMusicVolume,
    ],
  );

  const buildRenderPayload = (scope: "project" | "scene") => {
    if (scope === "project") {
      return { ...exportPayload, renderScope: "project" as const };
    }
    const sceneIndex = scenes.findIndex((item) => item.id === scene.id);
    const selectedScenePayload = exportPayload.scenes[sceneIndex];
    if (!selectedScenePayload) return null;
    const sceneDuration = Math.max(0.1, Number(selectedScenePayload.end) - Number(selectedScenePayload.start));
    const sceneName = safeTrim(scene.sceneName) || `Cảnh ${scene.number}`;
    return {
      ...exportPayload,
      title: `${projectTitle} - ${sceneName}`,
      duration: sceneDuration,
      renderScope: "scene" as const,
      renderedSceneName: sceneName,
      scenes: [{ ...selectedScenePayload, start: 0, end: sceneDuration }],
    };
  };

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
        ...(item.audioTracks ?? []).filter((track) => track.visible !== false).map((track) => track.source ?? ""),
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
    setEditorSectionOpen("text", true);
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

  const refreshLocalResourceCache = async () => {
    try {
      const response = await fetch(`${LOCAL_RENDERER_URL}/api/cache`);
      const summary = await response.json();
      if (!response.ok) throw new Error(summary.error || "Không thể đọc thư viện cache");
      const count = Math.max(0, Number(summary.count) || 0);
      const totalBytes = Math.max(0, Number(summary.totalBytes) || 0);
      setLocalResourceCache((state) => ({
        ...state,
        status: "ready",
        message: count
          ? `Đã có ${count} file URL trong thư viện cache trên máy.`
          : "Chưa có tài nguyên URL nào được tải trước.",
        count,
        totalBytes,
      }));
    } catch {
      // Preflight already gives the user the actionable renderer connection state.
    }
  };

  const syncLocalResourceCache = async () => {
    setLocalResourceCache((state) => ({
      ...state,
      status: "syncing",
      message: "Đang quét URL trong Biên soạn và tải tài nguyên về máy…",
      total: 0,
      cached: 0,
      downloaded: 0,
      failed: 0,
    }));
    try {
      const response = await fetch(`${LOCAL_RENDERER_URL}/api/cache/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: exportPayload }),
      });
      const report = await response.json();
      if (!response.ok) throw new Error(report.error || "Không thể tải trước tài nguyên URL");
      const total = Math.max(0, Number(report.total) || 0);
      const cached = Math.max(0, Number(report.cached) || 0);
      const downloaded = Math.max(0, Number(report.downloaded) || 0);
      const failed = Math.max(0, Number(report.failed) || 0);
      const count = Math.max(0, Number(report.cache?.count) || 0);
      const totalBytes = Math.max(0, Number(report.cache?.totalBytes) || 0);
      setLocalResourceCache({
        status: failed ? "failed" : "ready",
        message: failed
          ? `Đã tải trước ${downloaded + cached}/${total} URL; có ${failed} URL không tải được.`
          : total
            ? `Hoàn tất: ${downloaded} URL mới, ${cached} URL dùng lại từ cache.`
            : "Không có URL ảnh, video hoặc âm thanh nào cần tải trước.",
        total,
        cached,
        downloaded,
        failed,
        count,
        totalBytes,
      });
      setToast(failed ? "Một số URL chưa tải được; xem trạng thái trong Render" : "Đã tải trước tài nguyên URL vào máy");
      window.setTimeout(() => setToast(""), 2800);
    } catch (error) {
      setLocalResourceCache((state) => ({
        ...state,
        status: "failed",
        message: error instanceof Error ? error.message : "Không thể tải trước tài nguyên URL",
      }));
    }
  };

  const runRenderPreflight = async (scope: "project" | "scene" = "project") => {
    const checks: PreflightCheck[] = [];
    const selectedFileNames = new Set(localRenderFiles.map((file) => file.name));
    const renderScenes = scope === "scene" ? [scene] : visibleScenes;
    if (!renderScenes.length) {
      checks.push({
        id: "visible-scenes",
        label: scope === "scene" ? "Cảnh đang chọn" : "Cảnh đang hiện",
        status: "error",
        detail: scope === "scene"
          ? "Không tìm thấy cảnh đang chọn để render."
          : "Tất cả cảnh đang bị ẩn; hãy hiện ít nhất một cảnh để render.",
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
    renderScenes.forEach((item) => {
      addSourceCheck(
        `scene-${item.id}-background`,
        `Background cảnh ${item.number}`,
        item.background ?? "",
        false,
      );
      addSourceCheck(`scene-${item.id}-image`, `Ảnh cảnh ${item.number}`, imageEnabled ? item.image : "", imageEnabled);
      const visibleAudioTracks = narrationEnabled
        ? (item.audioTracks ?? []).filter((track) => track.visible !== false)
        : [];
      if (narrationEnabled && visibleAudioTracks.length) {
        visibleAudioTracks.forEach((track, trackIndex) => addSourceCheck(
          `scene-${item.id}-audio-${track.id}`,
          `${safeTrim(track.name) || `Âm thanh ${trackIndex + 1}`} · cảnh ${item.number}`,
          track.source,
          true,
        ));
      } else if (narrationEnabled) {
        checks.push({
          id: `scene-${item.id}-audio`,
          label: `Âm thanh cảnh ${item.number}`,
          status: "warning",
          detail: "Cảnh không có track âm thanh đang hiển thị.",
        });
      }
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
        detail: result.busy ? "Đã kết nối nhưng dịch vụ đang bận render hoặc nối video khác." : "Dịch vụ đã sẵn sàng.",
      });
      setLocalRenderState((state) => ({
        ...state,
        status: "idle",
        message: result.busy ? "Dịch vụ đang render hoặc nối video khác" : "Dịch vụ render đã sẵn sàng",
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

  const startLocalRender = async (scope: "project" | "scene" = "project") => {
    const renderPayload = buildRenderPayload(scope);
    if (!renderPayload) {
      setLocalRenderState({
        status: "failed",
        progress: 0,
        message: "Không tìm thấy cảnh đang chọn để render.",
      });
      return;
    }
    const canRender = await runRenderPreflight(scope);
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
      stage: "preparing",
      stageLabel: "Chuẩn bị tài nguyên",
      detail: "Đang gửi JSON và các file media tới dịch vụ FFmpeg…",
      scene: 0,
      totalScenes: renderPayload.scenes.length,
    });
    try {
      const form = new FormData();
      form.append("project", JSON.stringify(renderPayload));
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
        const serverProgress = Number(status.progress);
        const serverDetails = {
          progress: Number.isFinite(serverProgress) ? Math.min(100, Math.max(0, serverProgress)) : 0,
          message: String(status.message || "Đang render video…"),
          stage: typeof status.stage === "string" ? status.stage : undefined,
          stageLabel: typeof status.stageLabel === "string" ? status.stageLabel : undefined,
          detail: typeof status.detail === "string" ? status.detail : undefined,
          scene: Number(status.scene) || 0,
          totalScenes: Number(status.totalScenes) || renderPayload.scenes.length,
          elapsedSeconds: Number(status.elapsedSeconds) || 0,
          etaSeconds: Number.isFinite(Number(status.etaSeconds)) ? Number(status.etaSeconds) : null,
          mediaTimeSeconds: Number(status.mediaTimeSeconds) || 0,
          mediaDurationSeconds: Number(status.mediaDurationSeconds) || 0,
          logTail: typeof status.logTail === "string" ? status.logTail : "",
        };
        if (status.status === "completed") {
          setLocalRenderState({
            ...serverDetails,
            status: "completed",
            progress: 100,
            message: scope === "scene"
              ? "Đã render cảnh đang chọn. Video đã được thêm vào thư viện nối nhanh."
              : "Render hoàn tất. Video đã được thêm vào thư viện nối nhanh.",
            detail: "Video đã được lưu vào thư viện render.",
            downloadUrl: status.downloadUrl ? `${LOCAL_RENDERER_URL}${status.downloadUrl}` : undefined,
          });
          localRenderJobId.current = "";
          void refreshRenderedClips();
          return;
        }
        if (status.status === "cancelled") {
          localRenderJobId.current = "";
          setLocalRenderState({
            status: "idle",
            progress: 0,
            message: "Đã dừng render. Sẵn sàng render lại.",
            stage: "cancelled",
            stageLabel: "Đã dừng",
            detail: "Phiên render đã được dừng an toàn.",
          });
          return;
        }
        if (status.status === "failed") {
          localRenderJobId.current = "";
          throw Object.assign(new Error(status.message || "Render thất bại"), {
            log: status.log || status.logTail,
            logTail: status.logTail,
          });
        }
        if (status.status === "cancelling") {
          setLocalRenderState({
            ...serverDetails,
            status: "cancelling",
            message: serverDetails.message || "Đang dừng render…",
          });
          continue;
        }
        setLocalRenderState({
          ...serverDetails,
          status: status.status === "preparing" || status.status === "queued" ? "uploading" : "rendering",
        });
      }
    } catch (error) {
      localRenderJobId.current = "";
      setLocalRenderState({
        status: "failed",
        progress: 0,
        message: error instanceof Error ? error.message : "Không thể render video",
        log: error && typeof error === "object" && "log" in error ? String(error.log || "") : "",
        logTail: error && typeof error === "object" && "logTail" in error ? String(error.logTail || "") : "",
        stage: "failed",
        stageLabel: "Render lỗi",
        detail: error instanceof Error ? error.message : "Không thể render video",
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

  async function refreshRenderedClips() {
    try {
      const response = await fetch(`${LOCAL_RENDERER_URL}/api/rendered-clips`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Không thể đọc thư viện video đã render");
      const clips = Array.isArray(result.clips) ? result.clips as RenderedClip[] : [];
      setRenderedClips(clips);
      setSelectedRenderedClipIds((selectedIds) => selectedIds.filter((id) => clips.some((clip) => clip.id === id)));
    } catch {
      // Dịch vụ có thể chưa khởi động; trạng thái render phía trên sẽ hướng dẫn người dùng.
    }
  }

  const selectedRenderedClips = useMemo(
    () => selectedRenderedClipIds
      .map((id) => renderedClips.find((clip) => clip.id === id))
      .filter((clip): clip is RenderedClip => Boolean(clip)),
    [renderedClips, selectedRenderedClipIds],
  );
  const selectedRenderedClipsCompatible = selectedRenderedClips.length > 1
    && Boolean(selectedRenderedClips[0]?.compatibilityKey)
    && selectedRenderedClips.every((clip) => clip.compatibilityKey === selectedRenderedClips[0]?.compatibilityKey)
    && selectedRenderedClips.every((clip) => clip.scope !== "joined");

  const toggleRenderedClipSelection = (clipId: string) => {
    setSelectedRenderedClipIds((ids) => ids.includes(clipId)
      ? ids.filter((id) => id !== clipId)
      : [...ids, clipId]);
  };

  const moveSelectedRenderedClip = (clipId: string, direction: -1 | 1) => {
    setSelectedRenderedClipIds((ids) => {
      const index = ids.indexOf(clipId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return ids;
      const next = [...ids];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const renderClipProfileLabel = (clip: RenderedClip) => {
    const video = clip.profile?.video;
    if (!video?.width || !video.height) return "Chưa đọc được codec; không thể nối nhanh";
    const fps = video.fps ? ` · ${video.fps} FPS` : "";
    const audio = clip.profile?.audio?.codec ? ` · ${String(clip.profile.audio.codec).toUpperCase()}` : "";
    return `${video.width}×${video.height}${fps} · ${String(video.codec || "video").toUpperCase()}${audio}`;
  };

  const startLocalConcat = async () => {
    if (selectedRenderedClips.length < 2) {
      setLocalConcatState({ status: "failed", progress: 0, message: "Hãy chọn ít nhất 2 video để nối.", log: "" });
      return;
    }
    if (!selectedRenderedClipsCompatible) {
      setLocalConcatState({
        status: "failed",
        progress: 0,
        message: "Các video được chọn khác codec, kích thước, FPS hoặc âm thanh; hãy render cùng một cấu hình trước khi nối nhanh.",
        log: "",
      });
      return;
    }
    setLocalConcatState({ status: "joining", progress: 2, message: "Đang gửi danh sách video để nối nhanh…" });
    try {
      const response = await fetch(`${LOCAL_RENDERER_URL}/api/concat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipIds: selectedRenderedClips.map((clip) => clip.id),
          name: safeTrim(concatVideoName) || "video-noi",
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Không thể bắt đầu nối video");
      const jobId = String(result.jobId);
      localConcatJobId.current = jobId;
      for (;;) {
        await new Promise((resolve) => window.setTimeout(resolve, 550));
        const statusResponse = await fetch(`${LOCAL_RENDERER_URL}/api/concat/${jobId}`);
        const status = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(status.error || "Không đọc được tiến độ nối video");
        if (status.status === "completed") {
          localConcatJobId.current = "";
          setLocalConcatState({
            status: "completed",
            progress: 100,
            message: status.message || "Đã nối video.",
            downloadUrl: status.downloadUrl ? `${LOCAL_RENDERER_URL}${status.downloadUrl}` : undefined,
          });
          setSelectedRenderedClipIds([]);
          void refreshRenderedClips();
          return;
        }
        if (status.status === "failed") {
          localConcatJobId.current = "";
          throw Object.assign(new Error(status.message || "Nối video thất bại"), { log: status.log });
        }
        setLocalConcatState({
          status: "joining",
          progress: Number(status.progress) || 5,
          message: status.message || "Đang nối video…",
        });
      }
    } catch (error) {
      localConcatJobId.current = "";
      setLocalConcatState({
        status: "failed",
        progress: 0,
        message: error instanceof Error ? error.message : "Không thể nối video",
        log: error && typeof error === "object" && "log" in error ? String(error.log || "") : "",
      });
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

  const copyFfmpegCommands = async (commands: string, label: string) => {
    await navigator.clipboard.writeText(commands);
    setToast(`Đã sao chép ${label}`);
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
  const localResourceCacheSize = localResourceCache.totalBytes >= 1024 * 1024
    ? `${(localResourceCache.totalBytes / (1024 * 1024)).toFixed(1)} MB`
    : localResourceCache.totalBytes >= 1024
      ? `${Math.round(localResourceCache.totalBytes / 1024)} KB`
      : `${localResourceCache.totalBytes} B`;
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
  const renderStageSteps = [
    { key: "preparing", label: "Chuẩn bị" },
    { key: "scene", label: "Dựng cảnh" },
    { key: "joining", label: "Nối cảnh" },
    { key: "mixing", label: "Trộn âm thanh" },
    { key: "finalizing", label: "Hoàn tất" },
  ];
  const activeRenderStageIndex = localRenderState.status === "completed"
    ? renderStageSteps.length - 1
    : renderStageSteps.findIndex((step) => step.key === localRenderState.stage);

  const reviewAssetSource = (value: string) => assetPreviewSource(value);
  const reviewLayoutLabel = (value: PopupConfig["layout"]) => ({
    "image-top": "Ảnh trên",
    split: "Chia đôi",
    quote: "Trích dẫn",
    stats: "Số liệu",
    "image-only": "Chỉ hình",
    "content-only": "Chỉ nội dung",
  }[value ?? "image-top"] ?? "Ảnh trên");
  const reviewThemeLabel = (value: PopupConfig["theme"]) => ({
    travel: "Travel",
    sunset: "Sunset",
    ocean: "Ocean",
    minimal: "Minimal",
  }[value ?? "travel"] ?? "Travel");
  const reviewEffectSummary = (item: Scene) => {
    const effects = normalizeSceneEffects(item.effects);
    const entries = [
      ["Tuyết", effects.snowEnabled, effects.snowIntensity, effects.snowSpeed],
      ["Mưa", effects.rainEnabled, effects.rainIntensity, effects.rainSpeed],
      ["Mây", effects.cloudEnabled, effects.cloudIntensity, effects.cloudSpeed],
      ["Chớp sáng", effects.lightFlickerEnabled, effects.lightFlickerIntensity, effects.lightFlickerSpeed],
      ["Sấm", effects.thunderEnabled, effects.thunderIntensity, effects.thunderSpeed],
    ] as const;
    return entries.filter(([, enabled]) => enabled).map(([label, , intensity, speed]) => ({
      label,
      intensity,
      speed,
    }));
  };
  const reviewEffectConfiguration = (item: Scene) => {
    const effects = normalizeSceneEffects(item.effects);
    const entries = [
      ["Tuyết", effects.snowEnabled, effects.snowIntensity, effects.snowSpeed],
      ["Mưa", effects.rainEnabled, effects.rainIntensity, effects.rainSpeed],
      ["Mây", effects.cloudEnabled, effects.cloudIntensity, effects.cloudSpeed],
      ["Chớp sáng", effects.lightFlickerEnabled, effects.lightFlickerIntensity, effects.lightFlickerSpeed],
      ["Sấm", effects.thunderEnabled, effects.thunderIntensity, effects.thunderSpeed],
    ] as const;
    return entries.map(([label, enabled, intensity, speed]) => ({ label, enabled, intensity, speed }));
  };
  const reviewTextEffectLabel = (value: unknown) =>
    TEXT_OVERLAY_EFFECT_OPTIONS.find((option) => option.value === value)?.label ?? "Không hiệu ứng";
  const reviewImageTransitionLabel = (value: unknown) =>
    sceneImageTransitionOptions.find((option) => option.value === value)?.label ?? "Cắt trực tiếp";

  const renderReviewVisibility = (
    visible: boolean,
    label: string,
    onClick: () => void,
  ) => (
    <button
      type="button"
      className={`review-visibility ${visible ? "is-visible" : "is-hidden"}`}
      aria-label={visible ? `Ẩn ${label}` : `Hiện ${label}`}
      title={visible ? `Ẩn ${label}` : `Hiện ${label}`}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2.8 12s3.2-5 9.2-5 9.2 5 9.2 5-3.2 5-9.2 5-9.2-5-9.2-5Z" />
        <circle cx="12" cy="12" r="2.2" />
        {!visible && <path d="m4 4 16 16" />}
      </svg>
    </button>
  );

  const reviewLayerFocus = (
    item: Scene,
    section: "images" | "popup" | "effects",
    layerId = "",
  ) => {
    setSelectedId(item.id);
    setSelectedSceneIds([item.id]);
    if (section === "images") setSelectedSceneImageId(layerId);
    if (section === "popup") setSelectedPopupId(layerId);
    setEditorSectionOpen(section, true);
    setReviewOpen(false);
  };

  const reviewSceneCountLabel = `${visibleScenes.length} cảnh đang hiện`;
  const timelineEffectItems = visibleScenes.flatMap((item) => {
    const sceneLength = Math.max(0.1, item.end - item.start);
    const clampSceneTime = (value: unknown, fallback = 0) => Math.min(
      sceneLength,
      Math.max(0, Number.isFinite(Number(value)) ? Number(value) : fallback),
    );
    const effects = normalizeSceneEffects(item.effects);
    const entries: Array<{
      id: string;
      scene: Scene;
      start: number;
      end: number;
      label: string;
      kind: "zoom" | "dark" | "transition" | "weather";
    }> = [];
    const addEntry = (
      id: string,
      start: number,
      end: number,
      label: string,
      kind: "zoom" | "dark" | "transition" | "weather",
    ) => {
      const safeStart = clampSceneTime(start);
      const safeEnd = clampSceneTime(end, safeStart + 0.1);
      if (safeEnd <= safeStart) return;
      entries.push({ id: `${item.id}-${id}`, scene: item, start: item.start + safeStart, end: item.start + safeEnd, label, kind });
    };
    if (item.zoomEnabled !== false) {
      addEntry(
        "zoom",
        item.zoomStart,
        item.zoomEnd,
        `Zoom ${Number(item.zoom ?? 1).toFixed(1)}×`,
        "zoom",
      );
    }
    effects.sceneStartDarkEffects.filter((effect) => effect.enabled).forEach((effect, index) => {
      addEntry(
        `dark-${effect.id}`,
        effect.start,
        effect.end,
        `Tối ${index + 1} · giữ ${Number(effect.holdDuration ?? 0).toFixed(1)}s`,
        "dark",
      );
    });
    (item.sceneImages ?? [])
      .filter((image) => image.visible !== false && normalizeSceneImageTransition(image.transition) !== "cut")
      .forEach((image, index) => {
        addEntry(
          `transition-${image.id || index}`,
          image.start,
          sceneImageTransitionEnd(image),
          `${image.name || `Hình ${index + 1}`} · ${sceneImageTransitionOptions.find((option) => option.value === image.transition)?.label ?? "Chuyển hình"}`,
          "transition",
        );
      });
    const weatherLabels = [
      effects.snowEnabled ? "Tuyết" : "",
      effects.rainEnabled ? "Mưa" : "",
      effects.cloudEnabled ? "Mây" : "",
      effects.lightFlickerEnabled ? "Chớp" : "",
      effects.thunderEnabled ? "Sấm" : "",
    ].filter(Boolean);
    if (weatherLabels.length) addEntry("weather", 0, sceneLength, `Nền · ${weatherLabels.join(" · ")}`, "weather");
    return entries;
  });

  const sceneStructureSceneStats = (item: Scene) => ({
    images: (item.sceneImages ?? []).length,
    popups: scenePopupList(item).filter(popupHasContent).length,
    texts: (item.textOverlays ?? []).filter((overlay) => safeTrim(overlay.text)).length,
    audio: (item.audioTracks ?? []).filter((track) => track.visible !== false && safeTrim(track.source)).length,
    subtitles: (item.subtitles ?? []).filter((subtitle) => subtitle.visible !== false && safeTrim(subtitle.text)).length,
    effects: [
      item.zoomEnabled !== false,
      normalizeSceneEffects(item.effects).sceneStartDarkEffects.some((effect) => effect.enabled),
      normalizeSceneEffects(item.effects).snowEnabled,
      normalizeSceneEffects(item.effects).rainEnabled,
      normalizeSceneEffects(item.effects).cloudEnabled,
      normalizeSceneEffects(item.effects).lightFlickerEnabled,
      normalizeSceneEffects(item.effects).thunderEnabled,
    ].filter(Boolean).length,
  });

  const sceneStructureSceneIssues = (item: Scene) => {
    const issues: string[] = [];
    const duration = Math.max(0.1, item.end - item.start);
    const hasVisual = safeTrim(item.background)
      || safeTrim(item.avatar)
      || (item.sceneImages ?? []).some((image) => image.visible !== false && safeTrim(image.url));
    const visibleAudio = (item.audioTracks ?? []).filter((track) => track.visible !== false);
    if (!hasVisual) issues.push("Chưa có hình đại diện hoặc hình ảnh");
    if (!visibleAudio.some((track) => safeTrim(track.source))) issues.push("Chưa có âm thanh đang hiện");
    if (item.subtitleEnabled !== false && !(item.subtitles ?? []).some((subtitle) => subtitle.visible !== false && safeTrim(subtitle.text))) {
      issues.push("Chưa có phụ đề");
    }
    if (visibleAudio.some((track) => track.start < 0 || track.end > duration || track.end <= track.start)) {
      issues.push("Mốc âm thanh chưa hợp lệ");
    }
    return issues;
  };

  const selectSceneStructureScene = (item: Scene) => {
    setPlaying(false);
    setSceneStructurePreviewMode(false);
    setSceneStructureSceneId(item.id);
    setSelectedSceneStructureToken("");
    setSelectedId(item.id);
    setSelectedSceneIds([item.id]);
    setSelectedPopupId("");
    setSelectedTextOverlayId("");
    setSelectedSceneImageId("");
    setSelectedDecorationId("");
    setPlayTime(item.start);
  };

  const finishSceneStructureSceneDrop = (targetId: string) => {
    if (!sceneStructureSceneDragId || sceneStructureSceneDragId === targetId) {
      setSceneStructureSceneDragId("");
      setSceneStructureSceneDragOverId("");
      return;
    }
    setScenes((items) => reflowSceneTimeline(reorderById(items, sceneStructureSceneDragId, targetId)));
    setSceneStructureSceneDragId("");
    setSceneStructureSceneDragOverId("");
    setToast("Đã cập nhật thứ tự cảnh");
    window.setTimeout(() => setToast(""), 1800);
  };

  const sceneStructureSceneDragProps = (item: Scene) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent<HTMLElement>) => {
      setSceneStructureSceneDragId(item.id);
      setSceneStructureSceneDragOverId("");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.id);
    },
    onDragOver: (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setSceneStructureSceneDragOverId(item.id);
    },
    onDrop: (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      finishSceneStructureSceneDrop(item.id);
    },
    onDragEnd: () => {
      setSceneStructureSceneDragId("");
      setSceneStructureSceneDragOverId("");
    },
  });

  const openSceneStructure = () => {
    setPlaying(false);
    setSceneStructurePreviewMode(false);
    setPreviewPlaybackMode(false);
    setSceneStructurePreviewPortalHost(null);
    sceneStructureItemPointerDrag.current = null;
    sceneStructureItemDidDrag.current = false;
    setSceneStructureItemDragToken("");
    sceneStructureTemplateMouseCleanup.current?.();
    sceneStructureTemplateMouseCleanup.current = null;
    sceneStructureTemplatePointerDrag.current = null;
    sceneStructureTemplateDidDrag.current = false;
    setSceneStructureDraggedTemplate("");
    setSceneStructureDropTime(null);
    setPreviewFullscreen(false);
    setReviewOpen(false);
    setSceneStructureSceneId(scene.id);
    setSelectedSceneStructureToken(explicitlySelectedPreviewLayerToken);
    if (playTime < scene.start || playTime > scene.end) setPlayTime(scene.start);
    setSceneStructureOpen(true);
  };

  const closeSceneStructure = () => {
    setPlaying(false);
    setSceneStructurePreviewMode(false);
    setPreviewPlaybackMode(false);
    setSceneStructurePreviewPortalHost(null);
    setSceneStructureQuickEditToken("");
    sceneStructureItemPointerDrag.current = null;
    sceneStructureItemDidDrag.current = false;
    setSceneStructureItemDragToken("");
    sceneStructureTemplateMouseCleanup.current?.();
    sceneStructureTemplateMouseCleanup.current = null;
    sceneStructureTemplatePointerDrag.current = null;
    sceneStructureTemplateDidDrag.current = false;
    setSceneStructureDraggedTemplate("");
    setSceneStructureDropTime(null);
    setSceneStructureHoverPreview(null);
    setSceneStructureSceneDragId("");
    setSceneStructureSceneDragOverId("");
    setSceneStructureOpen(false);
  };

  const sceneStructureDropTimeFromClientX = (clientX: number, target: HTMLElement) => {
    const bounds = target.getBoundingClientRect();
    const horizontalPadding = 24;
    const timelineLeft = bounds.left + horizontalPadding;
    const timelineWidth = Math.max(1, bounds.width - horizontalPadding * 2);
    const ratio = Math.min(1, Math.max(0, (clientX - timelineLeft) / timelineWidth));
    const snapped = Math.round(ratio * sceneStructureDuration * 10) / 10;
    return Number(Math.min(
      Math.max(0, sceneStructureDuration - 0.1),
      Math.max(0, snapped),
    ).toFixed(2));
  };

  const showSceneStructureHoverPreview = (
    event: ReactPointerEvent<HTMLElement>,
    item?: SceneStructureItem,
  ) => {
    if (event.pointerType !== "mouse" || sceneStructurePreviewMode || sceneStructureItemPointerDrag.current?.active) return;
    const flowContent = sceneStructureFlowContentRef.current;
    if (!flowContent) return;
    const bounds = flowContent.getBoundingClientRect();
    const horizontalPadding = 24;
    const timelineLeft = bounds.left + horizontalPadding;
    const timelineWidth = Math.max(1, bounds.width - horizontalPadding * 2);
    const ratio = Math.min(1, Math.max(0, (event.clientX - timelineLeft) / timelineWidth));
    const localTime = Number((ratio * sceneStructureDuration).toFixed(2));
    const activeLayerNames = sceneStructureItems
      .filter((candidate) => localTime >= candidate.start && localTime < candidate.end)
      .map((candidate) => `${sceneStructureKindLabel(candidate.kind)}: ${candidate.label}`);
    const label = item
      ? `Layer: ${sceneStructureKindLabel(item.kind)} — ${item.label}`
      : activeLayerNames.length
        ? `Layer tại mốc: ${activeLayerNames.join(" · ")}`
        : "Không có layer nào tại mốc này";
    const previewWidth = 300;
    const captionLineCount = Math.max(2, Math.ceil(label.length / 38));
    const previewHeight = (aspectRatio === "16:9" ? 86 : 260) + Math.min(132, captionLineCount * 13 + 28);
    const margin = 12;
    const left = Math.min(
      Math.max(margin, window.innerWidth - previewWidth - margin),
      Math.max(margin, event.clientX - previewWidth / 2),
    );
    const belowTop = event.clientY + 18;
    const top = belowTop + previewHeight <= window.innerHeight - margin
      ? belowTop
      : Math.max(margin, event.clientY - previewHeight - 18);
    setSceneStructureHoverPreview({
      localTime,
      left,
      top,
      label,
    });
  };

  const hideSceneStructureHoverPreview = () => setSceneStructureHoverPreview(null);

  const startSceneStructureItemDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    item: SceneStructureItem,
  ) => {
    if (sceneStructurePreviewMode || item.timingMode === "none" || sceneStructureItemPointerDrag.current) return;
    const flowContent = sceneStructureFlowContentRef.current;
    if (!flowContent) return;
    event.preventDefault();
    event.stopPropagation();
    hideSceneStructureHoverPreview();
    const pointerTime = sceneStructureDropTimeFromClientX(event.clientX, flowContent);
    sceneStructureItemPointerDrag.current = {
      token: item.token,
      pointerId: event.pointerId,
      originX: event.clientX,
      grabOffset: pointerTime - item.start,
      duration: Math.max(0.1, item.end - item.start),
      active: false,
    };
    sceneStructureItemDidDrag.current = false;
    setSceneStructureItemDragToken(item.token);
    setSelectedSceneStructureToken(item.token);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveSceneStructureItemDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    item: SceneStructureItem,
  ) => {
    const drag = sceneStructureItemPointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.token !== item.token) return;
    if (Math.abs(event.clientX - drag.originX) > 3) {
      drag.active = true;
      sceneStructureItemDidDrag.current = true;
    }
    if (!drag.active) return;
    const flowContent = sceneStructureFlowContentRef.current;
    if (!flowContent) return;
    const pointerTime = sceneStructureDropTimeFromClientX(event.clientX, flowContent);
    const nextStart = Math.min(
      Math.max(0, sceneStructureDuration - drag.duration),
      Math.max(0, pointerTime - drag.grabOffset),
    );
    updateSceneStructureTiming(item, nextStart, nextStart + drag.duration);
  };

  const endSceneStructureItemDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = sceneStructureItemPointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    sceneStructureItemPointerDrag.current = null;
    setSceneStructureItemDragToken("");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.active) {
      setToast("Đã cập nhật vị trí trên timeline");
      window.setTimeout(() => setToast(""), 1800);
    }
  };

  const sceneStructurePlayheadTime = () => Math.min(
    Math.max(0, sceneStructureDuration - 0.1),
    Math.max(0, playTime - sceneStructureScene.start),
  );

  const insertSceneStructureTemplate = (
    kind: SceneStructureTemplateKind,
    startValue: number,
  ) => {
    const template = SCENE_STRUCTURE_TEMPLATES.find((item) => item.kind === kind);
    if (!template) return;
    const start = Number(Math.min(
      Math.max(0, sceneStructureDuration - 0.1),
      Math.max(0, Number(startValue) || 0),
    ).toFixed(2));
    const duration = Number(Math.max(
      0.1,
      Math.min(template.duration, sceneStructureDuration - start),
    ).toFixed(2));
    const end = Number(Math.min(sceneStructureDuration, start + duration).toFixed(2));
    const timestamp = Date.now().toString(36);
    const imageIndex = sceneStructureImages.length + 1;
    const textIndex = sceneStructureTexts.length + 1;
    const popupIndex = sceneStructurePopups.length + 1;
    const decorationIndex = sceneStructureDecorations.length + 1;
    const audioIndex = sceneStructureAudioTracks.length + 1;
    const createdId = kind === "image"
      ? `${sceneStructureScene.id}-image-${imageIndex}-${timestamp}`
      : kind === "text"
        ? `${sceneStructureScene.id}-text-${textIndex}-${timestamp}`
        : kind === "popup"
          ? `${sceneStructureScene.id}-popup-${popupIndex}-${timestamp}`
          : kind === "audio"
            ? `${sceneStructureScene.id}-audio-${audioIndex}-${timestamp}`
            : `${sceneStructureScene.id}-decoration-${decorationIndex}-${timestamp}`;
    const layerKind = kind === "effect" ? "decoration" : kind;
    const createdToken = `${layerKind}:${createdId}`;

    setScenes((items) => items.map((currentScene) => {
      if (currentScene.id !== sceneStructureScene.id) return currentScene;
      const currentLayerOrder = Array.isArray(currentScene.layerOrder) ? currentScene.layerOrder : [];
      const nextLayerOrder = [
        ...currentLayerOrder.filter((token) => token !== createdToken),
        createdToken,
      ];
      if (kind === "image") {
        const nextImage = defaultSceneImage(createdId, {
          name: `Hình ảnh ${imageIndex}`,
          start,
          duration,
          transitionEnd: Number(Math.min(end, start + 0.5).toFixed(2)),
          y: 50 + Math.min(18, (imageIndex - 1) * 5),
        });
        return {
          ...currentScene,
          sceneImages: [...(currentScene.sceneImages ?? []), nextImage],
          layerOrder: nextLayerOrder,
        };
      }
      if (kind === "text") {
        const nextOverlay = defaultTextOverlay(createdId, {
          name: `Chữ ${textIndex}`,
          text: "Nhập chữ",
          start,
          end,
          y: Math.min(82, 18 + (textIndex - 1) * 8),
        });
        const nextOverlays = [...(currentScene.textOverlays ?? []), nextOverlay];
        return {
          ...currentScene,
          textOverlays: nextOverlays,
          ...(nextOverlays.length === 1 ? textOverlaySceneFields(nextOverlay) : {}),
          layerOrder: nextLayerOrder,
        };
      }
      if (kind === "popup") {
        const nextPopup = defaultPopupConfig(createdId, {
          title: `Popup ${popupIndex}`,
          body: "Nhập nội dung popup",
          start,
          duration,
          y: Math.min(75, 55 + (popupIndex - 1) * 6),
        });
        const nextPopups = [...scenePopupList(currentScene), nextPopup];
        return {
          ...currentScene,
          popups: nextPopups,
          ...(nextPopups.length === 1 ? popupSceneFields(nextPopup) : {}),
          layerOrder: nextLayerOrder,
        };
      }
      if (kind === "audio") {
        const nextTrack = defaultSceneAudioTrack(createdId, {
          name: audioIndex === 1 ? "Thuyết minh" : `Âm thanh ${audioIndex}`,
          volume: audioIndex === 1 ? 95 : 100,
          start,
          end,
        });
        return syncLegacyVoiceFields({ ...currentScene, layerOrder: nextLayerOrder }, [
          ...(currentScene.audioTracks ?? []),
          nextTrack,
        ]);
      }
      const nextDecoration = defaultMapDecoration(createdId, "effect", {
        name: `Hiệu ứng ${decorationIndex}`,
        symbol: "✦",
        effect: "sparkles",
        start,
        duration,
        y: Math.min(78, 45 + (decorationIndex - 1) * 5),
      });
      return {
        ...currentScene,
        mapDecorations: [...(currentScene.mapDecorations ?? []), nextDecoration],
        layerOrder: nextLayerOrder,
      };
    }));

    setPlaying(false);
    setSceneStructurePreviewMode(false);
    setSelectedSceneStructureToken(createdToken);
    setSelectedId(sceneStructureScene.id);
    setSelectedSceneIds([sceneStructureScene.id]);
    setSelectedPopupId(kind === "popup" ? createdId : "");
    setSelectedTextOverlayId(kind === "text" ? createdId : "");
    setSelectedSceneImageId(kind === "image" ? createdId : "");
    setSelectedDecorationId(kind === "effect" ? createdId : "");
    if (kind === "audio") {
      setRenamingAudioTrackId(createdId);
      setRenamingAudioTrackName(audioIndex === 1 ? "Thuyết minh" : `Âm thanh ${audioIndex}`);
    }
    setPlayTime(Number((sceneStructureScene.start + start).toFixed(2)));
    setSceneStructureStartDraft(formatPreciseTime(start));
    setSceneStructureEndDraft(formatPreciseTime(end));
    setToast(kind === "image"
      ? "Đã thêm Hình ảnh · nhập URL trong Biên soạn"
      : kind === "audio"
        ? "Đã thêm Âm thanh · chọn file trong Biên soạn"
        : `Đã thêm ${template.label} tại ${formatPreciseTime(start)}`);
    window.setTimeout(() => setToast(""), 2400);
  };

  const sceneStructureTemplateDropAtPoint = (clientX: number, clientY: number) => {
    const target = sceneStructureFlowContentRef.current;
    if (!target) return null;
    const bounds = target.getBoundingClientRect();
    const isInside = clientX >= bounds.left
      && clientX <= bounds.right
      && clientY >= bounds.top
      && clientY <= bounds.bottom;
    return isInside ? sceneStructureDropTimeFromClientX(clientX, target) : null;
  };

  const beginSceneStructureTemplatePointerDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    kind: SceneStructureTemplateKind,
  ) => {
    if (sceneStructurePreviewMode || event.pointerType === "mouse") return;
    sceneStructureTemplateDidDrag.current = false;
    sceneStructureTemplatePointerDrag.current = {
      kind,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      active: false,
    };
    setSceneStructureDropTime(null);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const beginSceneStructureTemplateMouseDrag = (
    event: React.MouseEvent<HTMLButtonElement>,
    kind: SceneStructureTemplateKind,
  ) => {
    if (sceneStructurePreviewMode || event.button !== 0) return;
    sceneStructureTemplateMouseCleanup.current?.();
    sceneStructureTemplateDidDrag.current = false;
    const originX = event.clientX;
    const originY = event.clientY;
    let active = false;
    let handleMove: (moveEvent: MouseEvent) => void;
    let handleUp: (upEvent: MouseEvent) => void;
    const cleanup = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      if (sceneStructureTemplateMouseCleanup.current === cleanup) {
        sceneStructureTemplateMouseCleanup.current = null;
      }
    };
    handleMove = (moveEvent) => {
      if (!active) {
        const distance = Math.hypot(moveEvent.clientX - originX, moveEvent.clientY - originY);
        if (distance < 7) return;
        active = true;
        sceneStructureTemplateDidDrag.current = true;
        setSceneStructureDraggedTemplate(kind);
      }
      moveEvent.preventDefault();
      setSceneStructureDropTime(sceneStructureTemplateDropAtPoint(moveEvent.clientX, moveEvent.clientY));
    };
    handleUp = (upEvent) => {
      cleanup();
      if (!active) {
        sceneStructureTemplateDidDrag.current = false;
        return;
      }
      const dropTime = sceneStructureTemplateDropAtPoint(upEvent.clientX, upEvent.clientY);
      setSceneStructureDraggedTemplate("");
      setSceneStructureDropTime(null);
      if (dropTime !== null) insertSceneStructureTemplate(kind, dropTime);
      window.setTimeout(() => {
        sceneStructureTemplateDidDrag.current = false;
      }, 0);
    };
    sceneStructureTemplateMouseCleanup.current = cleanup;
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const moveSceneStructureTemplatePointerDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = sceneStructureTemplatePointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active) {
      const distance = Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY);
      if (distance < 7) return;
      drag.active = true;
      sceneStructureTemplateDidDrag.current = true;
      setSceneStructureDraggedTemplate(drag.kind);
    }
    event.preventDefault();
    setSceneStructureDropTime(sceneStructureTemplateDropAtPoint(event.clientX, event.clientY));
  };

  const endSceneStructureTemplatePointerDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = sceneStructureTemplatePointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const wasActive = drag.active;
    const dropTime = wasActive
      ? sceneStructureTemplateDropAtPoint(event.clientX, event.clientY)
      : null;
    sceneStructureTemplatePointerDrag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    setSceneStructureDraggedTemplate("");
    setSceneStructureDropTime(null);
    if (!wasActive) {
      sceneStructureTemplateDidDrag.current = false;
      return;
    }
    event.preventDefault();
    if (dropTime !== null) insertSceneStructureTemplate(drag.kind, dropTime);
    window.setTimeout(() => {
      sceneStructureTemplateDidDrag.current = false;
    }, 0);
  };

  const cancelSceneStructureTemplatePointerDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = sceneStructureTemplatePointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    sceneStructureTemplatePointerDrag.current = null;
    sceneStructureTemplateDidDrag.current = false;
    setSceneStructureDraggedTemplate("");
    setSceneStructureDropTime(null);
  };

  const addSceneStructureTemplateAtPlayhead = (kind: SceneStructureTemplateKind) => {
    if (sceneStructureTemplateDidDrag.current) return;
    insertSceneStructureTemplate(kind, sceneStructurePlayheadTime());
  };

  const selectSceneStructureItem = (item: SceneStructureItem) => {
    setPlaying(false);
    setSceneStructurePreviewMode(false);
    setSelectedSceneStructureToken(item.token);
    setSelectedId(sceneStructureScene.id);
    setSelectedSceneIds([sceneStructureScene.id]);
    setPlayTime(Number((sceneStructureScene.start + item.start).toFixed(2)));
    setSelectedPopupId(item.kind === "popup" ? item.id : "");
    setSelectedTextOverlayId(item.kind === "text" ? item.id : "");
    setSelectedSceneImageId(item.kind === "image" ? item.id : "");
    setSelectedDecorationId(item.kind === "decoration" ? item.id : "");
  };

  const openSceneStructureQuickEditor = (item: SceneStructureItem) => {
    selectSceneStructureItem(item);
    setSceneStructureQuickEditToken(item.token);
  };

  const updateSceneStructureQuickScene = (updater: (currentScene: Scene) => Scene) => {
    if (!hydrated) return;
    setScenes((items) => items.map((currentScene) => (
      currentScene.id === sceneStructureScene.id ? updater(currentScene) : currentScene
    )));
  };

  const updateSceneStructureQuickImage = (imageId: string, values: Partial<SceneImage>) => {
    updateSceneStructureQuickScene((currentScene) => ({
      ...currentScene,
      sceneImages: (currentScene.sceneImages ?? []).map((image) => (
        image.id === imageId ? { ...image, ...values } : image
      )),
    }));
  };

  const updateSceneStructureQuickPopup = (popupId: string, values: Partial<PopupConfig>) => {
    updateSceneStructureQuickScene((currentScene) => {
      const popups = scenePopupList(currentScene);
      const popupIndex = popups.findIndex((popup) => popup.id === popupId);
      if (popupIndex < 0) return currentScene;
      const currentPopup = popups[popupIndex];
      const nextPopup = { ...currentPopup, ...values } as PopupConfig;
      if (values.height !== undefined || values.layout !== undefined) {
        const layout = popupDimensionLayout(nextPopup.layout);
        const sections = popupSectionDefaults(layout, nextPopup.height);
        nextPopup.layout = layout;
        nextPopup.height = sections.height;
        nextPopup.imageHeight = sections.imageHeight;
        nextPopup.contentHeight = sections.contentHeight;
      }
      const nextPopups = popups.map((popup, index) => index === popupIndex ? nextPopup : popup);
      return {
        ...currentScene,
        popups: nextPopups,
        ...(popupIndex === 0 ? popupSceneFields(nextPopup) : {}),
      };
    });
  };

  const updateSceneStructureQuickText = (textId: string, values: Partial<TextOverlay>) => {
    updateSceneStructureQuickScene((currentScene) => {
      const overlays = currentScene.textOverlays ?? [];
      const overlayIndex = overlays.findIndex((overlay) => overlay.id === textId);
      if (overlayIndex < 0) return currentScene;
      const nextOverlay = { ...overlays[overlayIndex], ...values } as TextOverlay;
      const nextOverlays = overlays.map((overlay, index) => index === overlayIndex ? nextOverlay : overlay);
      return {
        ...currentScene,
        textOverlays: nextOverlays,
        ...(overlayIndex === 0 ? textOverlaySceneFields(nextOverlay) : {}),
      };
    });
  };

  const updateSceneStructureQuickDecoration = (decorationId: string, values: Partial<MapDecoration>) => {
    updateSceneStructureQuickScene((currentScene) => ({
      ...currentScene,
      mapDecorations: (currentScene.mapDecorations ?? []).map((decoration) => (
        decoration.id === decorationId ? { ...decoration, ...values } : decoration
      )),
    }));
  };

  const updateSceneStructureQuickAudio = (trackId: string, values: Partial<SceneAudioTrack>) => {
    updateSceneStructureQuickScene((currentScene) => {
      const duration = Math.max(0.1, currentScene.end - currentScene.start);
      const nextTracks = (currentScene.audioTracks ?? []).map((track) => {
        if (track.id !== trackId) return track;
        const next = { ...track, ...values } as SceneAudioTrack;
        const start = Math.min(duration - 0.1, Math.max(0, Number(next.start) || 0));
        const end = Math.min(duration, Math.max(start + 0.1, Number(next.end) || start + 0.1));
        return { ...next, start: Number(start.toFixed(2)), end: Number(end.toFixed(2)), volume: clampVolume(next.volume, track.volume) };
      });
      return syncLegacyVoiceFields(currentScene, nextTracks);
    });
  };

  const updateSceneStructureQuickDarkEffect = (effectId: string, values: Partial<SceneDarkEffect>) => {
    updateSceneStructureQuickScene((currentScene) => {
      const effects = normalizeSceneEffects(currentScene.effects);
      const nextDarkEffects = effects.sceneStartDarkEffects.map((effect) => (
        effect.id === effectId ? { ...effect, ...values } : effect
      ));
      const firstEffect = nextDarkEffects[0] ?? defaultSceneDarkEffect();
      return {
        ...currentScene,
        effects: {
          ...effects,
          sceneStartDarkEffects: nextDarkEffects,
          sceneStartDarkEnabled: nextDarkEffects.some((effect) => effect.enabled),
          sceneStartDarkDuration: Math.max(0.1, firstEffect.end - firstEffect.start),
          sceneStartDarkIntensity: firstEffect.intensity,
        },
      };
    });
  };

  const updateSceneStructureQuickEffects = (values: Partial<SceneEffects>) => {
    updateSceneStructureQuickScene((currentScene) => ({
      ...currentScene,
      effects: { ...normalizeSceneEffects(currentScene.effects), ...values },
    }));
  };

  const playSceneStructure = () => {
    if (sceneStructurePreviewMode && playing) {
      setPlaying(false);
      return;
    }
    const shouldRestart = !sceneStructurePreviewMode || playTime >= sceneStructureScene.end;
    setSelectedId(sceneStructureScene.id);
    setSelectedSceneIds([sceneStructureScene.id]);
    if (shouldRestart) setPlayTime(sceneStructureScene.start);
    setPlaybackRestartToken((value) => value + 1);
    setPreviewPlaybackMode(true);
    setSceneStructurePreviewPortalHost(null);
    setSceneStructurePreviewMode(true);
    setPlaying(true);
  };

  const returnFromSceneStructurePreview = () => {
    setPlaying(false);
    setSceneStructurePreviewMode(false);
    setPreviewPlaybackMode(false);
    setSceneStructurePreviewPortalHost(null);
    setSelectedId(sceneStructureScene.id);
    setSelectedSceneIds([sceneStructureScene.id]);
    setPlayTime(sceneStructureScene.start);
  };

  const updateSceneStructureTiming = (
    item: SceneStructureItem,
    nextStartValue: number,
    nextEndValue: number,
  ) => {
    if (item.timingMode === "none") return;
    const duration = sceneStructureDuration;
    const nextStart = Math.min(
      Math.max(0, duration - 0.1),
      Math.max(0, Number(nextStartValue) || 0),
    );
    const nextEnd = item.timingMode === "start"
      ? item.end
      : Math.min(
          duration,
          Math.max(nextStart + 0.1, Number(nextEndValue) || nextStart + 0.1),
        );
    const roundedStart = Number(nextStart.toFixed(2));
    const roundedEnd = Number(nextEnd.toFixed(2));

    setScenes((items) => items.map((currentScene) => {
      if (currentScene.id !== sceneStructureScene.id) return currentScene;
      if (item.kind === "image") {
        return {
          ...currentScene,
          sceneImages: (currentScene.sceneImages ?? []).map((image) => image.id === item.id
            ? {
                ...image,
                start: roundedStart,
                duration: Number(Math.max(0.1, roundedEnd - roundedStart).toFixed(2)),
                transitionEnd: normalizeSceneImageTransition(image.transition) === "cut"
                  ? roundedStart
                  : Number(Math.min(roundedEnd, Math.max(roundedStart + 0.1, image.transitionEnd)).toFixed(2)),
              }
            : image),
        };
      }
      if (item.kind === "popup") {
        const popups = scenePopupList(currentScene);
        const popupIndex = popups.findIndex((popup) => popup.id === item.id);
        if (popupIndex < 0) return currentScene;
        const nextPopups = popups.map((popup, index) => index === popupIndex
          ? {
              ...popup,
              start: roundedStart,
              duration: Number(Math.max(0.1, roundedEnd - roundedStart).toFixed(2)),
            }
          : popup);
        return {
          ...currentScene,
          popups: nextPopups,
          ...(popupIndex === 0 ? popupSceneFields(nextPopups[0]) : {}),
        };
      }
      if (item.kind === "text") {
        const overlays = currentScene.textOverlays ?? [];
        const overlayIndex = overlays.findIndex((overlay) => overlay.id === item.id);
        if (overlayIndex < 0) return currentScene;
        const nextOverlays = overlays.map((overlay, index) => index === overlayIndex
          ? { ...overlay, start: roundedStart, end: roundedEnd }
          : overlay);
        return {
          ...currentScene,
          textOverlays: nextOverlays,
          ...(overlayIndex === 0 ? textOverlaySceneFields(nextOverlays[0]) : {}),
        };
      }
      if (item.kind === "decoration") {
        return {
          ...currentScene,
          mapDecorations: (currentScene.mapDecorations ?? []).map((decoration) => decoration.id === item.id
            ? {
                ...decoration,
                start: roundedStart,
                duration: Number(Math.max(0.1, roundedEnd - roundedStart).toFixed(2)),
              }
            : decoration),
        };
      }
      if (item.kind === "audio") {
        const nextTracks = (currentScene.audioTracks ?? []).map((track) => track.id === item.id
          ? { ...track, start: roundedStart, end: roundedEnd }
          : track);
        return syncLegacyVoiceFields(currentScene, nextTracks);
      }
      if (item.kind === "subtitle") {
        const currentOffset = Math.max(0, Number(currentScene.subtitleStart) || 0);
        const shiftedOffset = Math.min(
          duration,
          Math.max(0, currentOffset + roundedStart - item.start),
        );
        return { ...currentScene, subtitleStart: Number(shiftedOffset.toFixed(2)) };
      }
      if (item.kind === "effect" && item.id === "zoom") {
        return { ...currentScene, zoomStart: roundedStart, zoomEnd: roundedEnd };
      }
      if (item.kind === "effect" && item.id.startsWith("dark:")) {
        const effectId = item.id.slice("dark:".length);
        const effects = normalizeSceneEffects(currentScene.effects);
        const darkEffects = effects.sceneStartDarkEffects.map((effect) => effect.id === effectId
          ? {
              ...effect,
              start: roundedStart,
              end: roundedEnd,
              holdDuration: Math.min(effect.holdDuration, Math.max(0, roundedEnd - roundedStart - 0.1)),
            }
          : effect);
        const firstEffect = darkEffects[0] ?? defaultSceneDarkEffect();
        return {
          ...currentScene,
          effects: {
            ...effects,
            sceneStartDarkEffects: darkEffects,
            sceneStartDarkEnabled: darkEffects.some((effect) => effect.enabled),
            sceneStartDarkDuration: Math.max(0.1, firstEffect.end - firstEffect.start),
            sceneStartDarkIntensity: firstEffect.intensity,
          },
        };
      }
      return currentScene;
    }));
    setSceneStructureStartDraft(formatPreciseTime(roundedStart));
    setSceneStructureEndDraft(formatPreciseTime(roundedEnd));
  };

  const commitSceneStructureTiming = () => {
    if (!selectedSceneStructureItem) return;
    const nextStart = parsePreciseTime(sceneStructureStartDraft, selectedSceneStructureItem.start);
    const nextEnd = parsePreciseTime(sceneStructureEndDraft, selectedSceneStructureItem.end);
    updateSceneStructureTiming(selectedSceneStructureItem, nextStart, nextEnd);
  };

  const resetSceneStructureTimingDrafts = () => {
    if (!selectedSceneStructureItem) return;
    setSceneStructureStartDraft(formatPreciseTime(selectedSceneStructureItem.start));
    setSceneStructureEndDraft(formatPreciseTime(selectedSceneStructureItem.end));
  };

  const toggleSceneStructureItemVisibility = (item: SceneStructureItem) => {
    if (!item.canHide) return;
    setScenes((items) => items.map((currentScene) => {
      if (currentScene.id !== sceneStructureScene.id) return currentScene;
      if (item.kind === "background") return { ...currentScene, backgroundVisible: false };
      if (item.kind === "image") {
        return {
          ...currentScene,
          sceneImages: (currentScene.sceneImages ?? []).map((image) => image.id === item.id
            ? { ...image, visible: false }
            : image),
        };
      }
      if (item.kind === "popup") {
        const popups = scenePopupList(currentScene);
        const popupIndex = popups.findIndex((popup) => popup.id === item.id);
        const nextPopups = popups.map((popup) => popup.id === item.id ? { ...popup, visible: false } : popup);
        return {
          ...currentScene,
          popups: nextPopups,
          ...(popupIndex === 0 && nextPopups[0] ? popupSceneFields(nextPopups[0]) : {}),
        };
      }
      if (item.kind === "text") {
        return {
          ...currentScene,
          textOverlays: (currentScene.textOverlays ?? []).map((overlay) => overlay.id === item.id
            ? { ...overlay, visible: false }
            : overlay),
        };
      }
      if (item.kind === "decoration") {
        return {
          ...currentScene,
          mapDecorations: (currentScene.mapDecorations ?? []).map((decoration) => decoration.id === item.id
            ? { ...decoration, visible: false }
            : decoration),
        };
      }
      if (item.kind === "subtitle") return { ...currentScene, subtitleEnabled: false };
      if (item.kind === "audio") {
        return syncLegacyVoiceFields(currentScene, (currentScene.audioTracks ?? []).map((track) => track.id === item.id
          ? { ...track, visible: false }
          : track));
      }
      if (item.kind === "effect" && item.id === "zoom") return { ...currentScene, zoomEnabled: false };
      if (item.kind === "effect" && item.id.startsWith("dark:")) {
        const effectId = item.id.slice("dark:".length);
        const effects = normalizeSceneEffects(currentScene.effects);
        const darkEffects = effects.sceneStartDarkEffects.map((effect) => effect.id === effectId
          ? { ...effect, enabled: false }
          : effect);
        return {
          ...currentScene,
          effects: {
            ...effects,
            sceneStartDarkEffects: darkEffects,
            sceneStartDarkEnabled: darkEffects.some((effect) => effect.enabled),
          },
        };
      }
      if (item.kind === "effect" && item.id === "weather") {
        return {
          ...currentScene,
          effects: {
            ...normalizeSceneEffects(currentScene.effects),
            snowEnabled: false,
            rainEnabled: false,
            cloudEnabled: false,
            lightFlickerEnabled: false,
            thunderEnabled: false,
          },
        };
      }
      return currentScene;
    }));
    setSelectedSceneStructureToken("");
    setToast(`Đã ẩn ${item.label}`);
    window.setTimeout(() => setToast(""), 2200);
  };

  const deleteSceneStructureItem = (item: SceneStructureItem) => {
    setPlaying(false);
    setSceneStructurePreviewMode(false);
    setScenes((items) => items.map((currentScene) => {
      if (currentScene.id !== sceneStructureScene.id) return currentScene;
      const nextLayerOrder = (currentScene.layerOrder ?? []).filter((token) => token !== item.token);
      if (item.kind === "background") {
        return { ...currentScene, background: "", backgroundVisible: false, layerOrder: nextLayerOrder };
      }
      if (item.kind === "image") {
        return {
          ...currentScene,
          sceneImages: (currentScene.sceneImages ?? []).filter((image) => image.id !== item.id),
          layerOrder: nextLayerOrder,
        };
      }
      if (item.kind === "popup") {
        const popups = scenePopupList(currentScene);
        const popupIndex = popups.findIndex((popup) => popup.id === item.id);
        const nextPopups = popups.filter((popup) => popup.id !== item.id);
        const fallbackPopup = defaultPopupConfig(`${currentScene.id}-popup-empty`, { visible: false });
        return {
          ...currentScene,
          popups: nextPopups,
          ...(popupIndex === 0 ? popupSceneFields(nextPopups[0] ?? fallbackPopup) : {}),
          layerOrder: nextLayerOrder,
        };
      }
      if (item.kind === "text") {
        const overlays = currentScene.textOverlays ?? [];
        const overlayIndex = overlays.findIndex((overlay) => overlay.id === item.id);
        const nextOverlays = overlays.filter((overlay) => overlay.id !== item.id);
        const fallbackOverlay = defaultTextOverlay(`${currentScene.id}-text-empty`, { text: "", visible: false });
        return {
          ...currentScene,
          textOverlays: nextOverlays,
          ...(overlayIndex === 0 ? textOverlaySceneFields(nextOverlays[0] ?? fallbackOverlay) : {}),
          layerOrder: nextLayerOrder,
        };
      }
      if (item.kind === "decoration") {
        return {
          ...currentScene,
          mapDecorations: (currentScene.mapDecorations ?? []).filter((decoration) => decoration.id !== item.id),
          layerOrder: nextLayerOrder,
        };
      }
      if (item.kind === "subtitle") {
        return {
          ...currentScene,
          subtitleEnabled: false,
          subtitles: [],
          layerOrder: nextLayerOrder,
        };
      }
      if (item.kind === "audio") {
        return syncLegacyVoiceFields(
          { ...currentScene, layerOrder: nextLayerOrder },
          (currentScene.audioTracks ?? []).filter((track) => track.id !== item.id),
        );
      }
      if (item.kind === "effect" && item.id === "zoom") {
        return { ...currentScene, zoomEnabled: false, layerOrder: nextLayerOrder };
      }
      if (item.kind === "effect" && item.id.startsWith("dark:")) {
        const effectId = item.id.slice("dark:".length);
        const effects = normalizeSceneEffects(currentScene.effects);
        const darkEffects = effects.sceneStartDarkEffects.filter((effect) => effect.id !== effectId);
        const firstEffect = darkEffects[0] ?? defaultSceneDarkEffect();
        return {
          ...currentScene,
          effects: {
            ...effects,
            sceneStartDarkEffects: darkEffects,
            sceneStartDarkEnabled: darkEffects.some((effect) => effect.enabled),
            sceneStartDarkDuration: Math.max(0.1, firstEffect.end - firstEffect.start),
            sceneStartDarkIntensity: firstEffect.intensity,
          },
          layerOrder: nextLayerOrder,
        };
      }
      if (item.kind === "effect" && item.id === "weather") {
        return {
          ...currentScene,
          effects: {
            ...normalizeSceneEffects(currentScene.effects),
            snowEnabled: false,
            rainEnabled: false,
            cloudEnabled: false,
            lightFlickerEnabled: false,
            thunderEnabled: false,
          },
          layerOrder: nextLayerOrder,
        };
      }
      return currentScene;
    }));
    setSelectedSceneStructureToken("");
    setSelectedPopupId("");
    setSelectedTextOverlayId("");
    setSelectedSceneImageId("");
    setSelectedDecorationId("");
    setToast(`Đã xóa ${item.label} · Ctrl+Z để hoàn tác`);
    window.setTimeout(() => setToast(""), 2600);
  };

  const openSceneStructureItemInEditor = (item: SceneStructureItem) => {
    setPlaying(false);
    setSceneStructurePreviewMode(false);
    setPreviewPlaybackMode(false);
    setSceneStructureQuickEditToken("");
    setSceneStructureOpen(false);
    setActiveStudioTab("compose");
    setSelectedId(sceneStructureScene.id);
    setSelectedSceneIds([sceneStructureScene.id]);
    setPlayTime(Number((sceneStructureScene.start + item.start).toFixed(2)));
    if (item.kind === "image") {
      setSelectedSceneImageId(item.id);
      setSelectedPopupId("");
      setSelectedTextOverlayId("");
      setSelectedDecorationId("");
      focusEditorLayer("images", item.id);
      return;
    }
    if (item.kind === "popup") {
      setSelectedPopupId(item.id);
      setSelectedTextOverlayId("");
      setSelectedSceneImageId("");
      setSelectedDecorationId("");
      focusEditorLayer("popup", item.id);
      return;
    }
    if (item.kind === "text") {
      setSelectedTextOverlayId(item.id);
      setSelectedPopupId("");
      setSelectedSceneImageId("");
      setSelectedDecorationId("");
      focusEditorLayer("text", item.id);
      return;
    }
    if (item.kind === "decoration") {
      setSelectedDecorationId(item.id);
      setSelectedPopupId("");
      setSelectedTextOverlayId("");
      setSelectedSceneImageId("");
      focusEditorSection("text");
      return;
    }
    setSelectedPopupId("");
    setSelectedTextOverlayId("");
    setSelectedSceneImageId("");
    setSelectedDecorationId("");
    if (item.kind === "subtitle") {
      openTimelineEditor(sceneStructureScene, "editor-subtitle");
    } else if (item.kind === "audio") {
      openTimelineEditor(sceneStructureScene, "editor-audio");
    } else if (item.kind === "effect") {
      openTimelineEditor(sceneStructureScene, "editor-effects");
    } else {
      focusEditorSection("visual");
    }
  };

  const sceneStructureKindLabel = (kind: SceneStructureKind) => ({
    background: "Nền",
    image: "Hình ảnh",
    popup: "Popup",
    text: "Chữ",
    decoration: "Trang trí",
    subtitle: "Phụ đề",
    audio: "Âm thanh",
    effect: "Hiệu ứng",
  }[kind]);

  const renderSceneStructureThumbnail = (item: SceneStructureItem, fallback = item.icon) => item.thumbnail
    ? item.thumbnailIsVideo
      ? <video src={item.thumbnail} muted loop playsInline preload="metadata" aria-hidden="true" />
      : <img src={item.thumbnail} alt="" />
    : <span>{fallback}</span>;

  const renderSceneStructureQuickEditor = () => {
    const item = sceneStructureQuickEditItem;
    if (!item) return null;
    const quickScene = sceneStructureScene;
    const numberValue = (value: string, fallback: number) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const timingFields = item.timingMode === "none" ? null : (
      <div className="scene-structure-quick-grid scene-structure-quick-grid-2">
        <label className="scene-structure-quick-field">
          <span>Bắt đầu (giây)</span>
          <input
            type="number"
            min="0"
            max={sceneStructureDuration}
            step="0.1"
            value={Number(item.start.toFixed(2))}
            onChange={(event) => updateSceneStructureTiming(
              item,
              numberValue(event.target.value, item.start),
              item.end,
            )}
          />
        </label>
        <label className="scene-structure-quick-field">
          <span>Kết thúc (giây)</span>
          <input
            type="number"
            min="0.1"
            max={sceneStructureDuration}
            step="0.1"
            value={Number(item.end.toFixed(2))}
            disabled={item.timingMode !== "both"}
            onChange={(event) => updateSceneStructureTiming(
              item,
              item.start,
              numberValue(event.target.value, item.end),
            )}
          />
        </label>
      </div>
    );

    let content: ReactNode = null;
    if (item.kind === "background") {
      content = (
        <div className="scene-structure-quick-stack">
          <label className="scene-structure-quick-field">
            <span>URL hình / video nền</span>
            <input
              type="url"
              value={quickScene.background ?? ""}
              placeholder="https://..."
              onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({
                ...currentScene,
                background: event.target.value,
              }))}
            />
          </label>
          <label className="scene-structure-quick-toggle">
            <input
              type="checkbox"
              checked={quickScene.backgroundVisible !== false}
              onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({
                ...currentScene,
                backgroundVisible: event.target.checked,
              }))}
            />
            <span>Hiển thị nền trong cảnh</span>
          </label>
        </div>
      );
    }

    if (item.kind === "image") {
      const image = (quickScene.sceneImages ?? []).find((entry) => entry.id === item.id);
      content = image ? (
        <div className="scene-structure-quick-stack">
          {timingFields}
          <label className="scene-structure-quick-field">
            <span>Tên hình</span>
            <input value={image.name} onChange={(event) => updateSceneStructureQuickImage(image.id, { name: event.target.value })} />
          </label>
          <label className="scene-structure-quick-field">
            <span>URL hình / video</span>
            <input
              type="url"
              value={image.url}
              placeholder="https://..."
              onChange={(event) => {
                const url = event.target.value;
                updateSceneStructureQuickImage(image.id, {
                  url,
                  mediaType: isVideoMedia(url) ? "video" : "image",
                  transparent: isTransparentMedia(url),
                });
              }}
            />
          </label>
          <div className="scene-structure-quick-grid scene-structure-quick-grid-2">
            <label className="scene-structure-quick-field"><span>Hình dạng</span><select value={image.shape} onChange={(event) => updateSceneStructureQuickImage(image.id, { shape: event.target.value as SceneImageShape })}>{sceneImageShapeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="scene-structure-quick-field"><span>Chuyển hình</span><select value={image.transition} onChange={(event) => updateSceneStructureQuickImage(image.id, { transition: normalizeSceneImageTransition(event.target.value) })}>{sceneImageTransitionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </div>
          <div className="scene-structure-quick-grid scene-structure-quick-grid-3">
            <label className="scene-structure-quick-field"><span>Vị trí X (%)</span><input type="number" min="0" max="100" value={image.x} onChange={(event) => updateSceneStructureQuickImage(image.id, { x: clampPercent(event.target.value, image.x) })} /></label>
            <label className="scene-structure-quick-field"><span>Vị trí Y (%)</span><input type="number" min="0" max="100" value={image.y} onChange={(event) => updateSceneStructureQuickImage(image.id, { y: clampPercent(event.target.value, image.y) })} /></label>
            <label className="scene-structure-quick-field"><span>Độ mờ (%)</span><input type="number" min="0" max="100" value={image.opacity} onChange={(event) => updateSceneStructureQuickImage(image.id, { opacity: Math.min(100, Math.max(0, numberValue(event.target.value, image.opacity))) })} /></label>
            <label className="scene-structure-quick-field"><span>Chiều rộng (%)</span><input type="number" min="1" max="200" value={image.width} onChange={(event) => updateSceneStructureQuickImage(image.id, { width: Math.min(200, Math.max(1, numberValue(event.target.value, image.width))) })} /></label>
            <label className="scene-structure-quick-field"><span>Chiều cao (%)</span><input type="number" min="1" max="200" value={image.height} onChange={(event) => updateSceneStructureQuickImage(image.id, { height: Math.min(200, Math.max(1, numberValue(event.target.value, image.height))) })} /></label>
            <label className="scene-structure-quick-field"><span>Đường viền (px)</span><input type="number" min="0" max="12" value={image.borderWidth} onChange={(event) => updateSceneStructureQuickImage(image.id, { borderWidth: Math.min(12, Math.max(0, numberValue(event.target.value, image.borderWidth))) })} /></label>
            <label className="scene-structure-quick-field"><span>Kết thúc chuyển (giây)</span><input type="number" min={image.start + 0.1} max={sceneStructureDuration} step="0.1" value={image.transitionEnd} onChange={(event) => updateSceneStructureQuickImage(image.id, { transitionEnd: Math.min(sceneStructureDuration, Math.max(image.start + 0.1, numberValue(event.target.value, image.transitionEnd))) })} /></label>
          </div>
          <div className="scene-structure-quick-grid scene-structure-quick-grid-2">
            <label className="scene-structure-quick-field"><span>Màu đường viền</span><input type="color" value={normalizeHexColor(image.borderColor, "#ffffff")} onChange={(event) => updateSceneStructureQuickImage(image.id, { borderColor: event.target.value })} /></label>
            <label className="scene-structure-quick-field"><span>Màu nền khung</span><input type="text" value={image.borderFill} placeholder="transparent / #FFFFFF" onChange={(event) => updateSceneStructureQuickImage(image.id, { borderFill: normalizeSceneImageBorderFill(event.target.value) })} /></label>
          </div>
          <div className="scene-structure-quick-grid scene-structure-quick-grid-2">
            <label className="scene-structure-quick-toggle"><input type="checkbox" checked={image.transparent} onChange={(event) => updateSceneStructureQuickImage(image.id, { transparent: event.target.checked })} /><span>Giữ nền trong suốt</span></label>
            <label className="scene-structure-quick-toggle"><input type="checkbox" checked={image.visible !== false} onChange={(event) => updateSceneStructureQuickImage(image.id, { visible: event.target.checked })} /><span>Hiển thị khi render</span></label>
            <label className="scene-structure-quick-toggle"><input type="checkbox" checked={image.editorVisible !== false} onChange={(event) => updateSceneStructureQuickImage(image.id, { editorVisible: event.target.checked })} /><span>Hiển thị khi biên soạn</span></label>
          </div>
        </div>
      ) : null;
    }

    if (item.kind === "popup") {
      const popup = scenePopupList(quickScene).find((entry) => entry.id === item.id);
      content = popup ? (
        <div className="scene-structure-quick-stack">
          {timingFields}
          <label className="scene-structure-quick-field"><span>Tiêu đề</span><input value={popup.title} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { title: event.target.value })} /></label>
          <label className="scene-structure-quick-field"><span>Nội dung</span><textarea rows={5} value={popup.body} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { body: event.target.value })} /></label>
          <label className="scene-structure-quick-field"><span>Lời thuyết minh popup</span><textarea rows={3} value={popup.narration} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { narration: event.target.value })} /></label>
          <label className="scene-structure-quick-field"><span>Ảnh / video riêng</span><input type="url" value={safeTrim(popup.video) || popup.image} placeholder="https://..." onChange={(event) => {
            const value = event.target.value;
            updateSceneStructureQuickPopup(popup.id, {
              image: isVideoMedia(value) ? "" : value,
              video: isVideoMedia(value) ? value : "",
              transparentMedia: isTransparentMedia(value),
            });
          }} /></label>
          <div className="scene-structure-quick-grid scene-structure-quick-grid-3">
            <label className="scene-structure-quick-field"><span>Vị trí X (%)</span><input type="number" min="0" max="100" value={popup.x} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { x: clampPercent(event.target.value, popup.x) })} /></label>
            <label className="scene-structure-quick-field"><span>Vị trí Y (%)</span><input type="number" min="0" max="100" value={popup.y} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { y: clampPercent(event.target.value, popup.y) })} /></label>
            <label className="scene-structure-quick-field"><span>Rộng (%)</span><input type="number" min="20" max="100" value={popup.width} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { width: Math.min(100, Math.max(20, numberValue(event.target.value, popup.width))) })} /></label>
            <label className="scene-structure-quick-field"><span>Cao (px)</span><input type="number" min="170" max="440" value={popup.height} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { height: Math.min(440, Math.max(170, numberValue(event.target.value, popup.height))) })} /></label>
            <label className="scene-structure-quick-field"><span>Viền (px)</span><input type="number" min="0" max="12" value={popup.borderWidth} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { borderWidth: Math.min(12, Math.max(0, numberValue(event.target.value, popup.borderWidth))) })} /></label>
            <label className="scene-structure-quick-field"><span>Bố cục</span><select value={popup.layout} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { layout: event.target.value as PopupConfig["layout"] })}><option value="image-top">Ảnh trên</option><option value="split">Chia đôi</option><option value="quote">Trích dẫn</option><option value="stats">Thống kê</option><option value="image-only">Chỉ ảnh</option><option value="content-only">Chỉ nội dung</option></select></label>
            <label className="scene-structure-quick-field"><span>Chủ đề</span><select value={popup.theme} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { theme: event.target.value as Scene["popupTheme"] })}><option value="travel">Travel</option><option value="sunset">Sunset</option><option value="ocean">Ocean</option><option value="minimal">Minimal</option></select></label>
            <label className="scene-structure-quick-field"><span>Hiệu ứng chữ</span><select value={popup.textEffect} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { textEffect: event.target.value as Scene["popupTextEffect"] })}><option value="none">Không hiệu ứng</option><option value="fade">Fade</option><option value="rise">Rise</option><option value="pop">Pop</option></select></label>
          </div>
          <div className="scene-structure-quick-grid scene-structure-quick-grid-2">
            <label className="scene-structure-quick-field"><span>Chiều cao ảnh (px)</span><input type="number" min="0" max="440" value={popup.imageHeight} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { imageHeight: Math.min(440, Math.max(0, numberValue(event.target.value, popup.imageHeight))) })} /></label>
            <label className="scene-structure-quick-field"><span>Chiều cao nội dung (px)</span><input type="number" min="0" max="440" value={popup.contentHeight} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { contentHeight: Math.min(440, Math.max(0, numberValue(event.target.value, popup.contentHeight))) })} /></label>
            <label className="scene-structure-quick-field"><span>Hiệu ứng mở</span><input value={popup.in} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { in: event.target.value })} placeholder="fade-slide-up" /></label>
            <label className="scene-structure-quick-field"><span>Hiệu ứng đóng</span><input value={popup.out} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { out: event.target.value })} placeholder="fade-slide-down" /></label>
          </div>
          <div className="scene-structure-quick-grid scene-structure-quick-grid-2">
            <label className="scene-structure-quick-toggle"><input type="checkbox" checked={popup.transparentMedia} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { transparentMedia: event.target.checked })} /><span>Giữ nền trong suốt của ảnh / video</span></label>
            <label className="scene-structure-quick-toggle"><input type="checkbox" checked={popup.imageVisible !== false} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { imageVisible: event.target.checked })} /><span>Hiển thị ảnh / video</span></label>
            <label className="scene-structure-quick-toggle"><input type="checkbox" checked={popup.visible !== false} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { visible: event.target.checked })} /><span>Hiển thị khi render</span></label>
            <label className="scene-structure-quick-toggle"><input type="checkbox" checked={popup.editorVisible !== false} onChange={(event) => updateSceneStructureQuickPopup(popup.id, { editorVisible: event.target.checked })} /><span>Hiển thị khi biên soạn</span></label>
          </div>
        </div>
      ) : null;
    }

    if (item.kind === "text") {
      const overlay = (quickScene.textOverlays ?? []).find((entry) => entry.id === item.id);
      content = overlay ? (
        <div className="scene-structure-quick-stack">
          {timingFields}
          <label className="scene-structure-quick-field"><span>Tên lớp chữ</span><input value={overlay.name} onChange={(event) => updateSceneStructureQuickText(overlay.id, { name: event.target.value })} /></label>
          <label className="scene-structure-quick-field"><span>Nội dung</span><textarea rows={4} value={overlay.text} onChange={(event) => updateSceneStructureQuickText(overlay.id, { text: event.target.value })} /></label>
          <div className="scene-structure-quick-grid scene-structure-quick-grid-3">
            <label className="scene-structure-quick-field"><span>Cỡ chữ</span><input type="number" min="8" max="160" value={overlay.size} onChange={(event) => updateSceneStructureQuickText(overlay.id, { size: Math.min(160, Math.max(8, numberValue(event.target.value, overlay.size))) })} /></label>
            <label className="scene-structure-quick-field"><span>Vị trí X (%)</span><input type="number" min="0" max="100" value={overlay.x} onChange={(event) => updateSceneStructureQuickText(overlay.id, { x: clampPercent(event.target.value, overlay.x) })} /></label>
            <label className="scene-structure-quick-field"><span>Vị trí Y (%)</span><input type="number" min="0" max="100" value={overlay.y} onChange={(event) => updateSceneStructureQuickText(overlay.id, { y: clampPercent(event.target.value, overlay.y) })} /></label>
            <label className="scene-structure-quick-field"><span>Độ mờ (%)</span><input type="number" min="0" max="100" value={overlay.opacity} onChange={(event) => updateSceneStructureQuickText(overlay.id, { opacity: Math.min(100, Math.max(0, numberValue(event.target.value, overlay.opacity))) })} /></label>
            <label className="scene-structure-quick-field"><span>Kiểu chữ</span><select value={overlay.style} onChange={(event) => updateSceneStructureQuickText(overlay.id, { style: event.target.value as TextOverlay["style"] })}><option value="normal">Bình thường</option><option value="bold">Đậm</option><option value="italic">Nghiêng</option><option value="bold-italic">Đậm nghiêng</option></select></label>
            <label className="scene-structure-quick-field"><span>Màu chữ</span><input type="color" value={normalizeHexColor(overlay.color, "#ffffff")} onChange={(event) => updateSceneStructureQuickText(overlay.id, { color: event.target.value })} /></label>
          </div>
          <div className="scene-structure-quick-grid scene-structure-quick-grid-2">
            <label className="scene-structure-quick-field"><span>Font chữ</span><select value={overlay.font} onChange={(event) => updateSceneStructureQuickText(overlay.id, { font: event.target.value as OverlayTextFont })}><option value="Arial">Arial</option><option value="Verdana">Verdana</option><option value="Georgia">Georgia</option><option value="Tahoma">Tahoma</option><option value="Times New Roman">Times New Roman</option><option value="Courier New">Courier New</option></select></label>
            <label className="scene-structure-quick-field"><span>Hiệu ứng chữ</span><select value={overlay.textEffect} onChange={(event) => updateSceneStructureQuickText(overlay.id, { textEffect: event.target.value as TextOverlayEffect })}>{TEXT_OVERLAY_EFFECT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="scene-structure-quick-field"><span>Thời lượng hiệu ứng (giây)</span><input type="number" min="0.05" max="8" step="0.05" value={overlay.textEffectDuration} onChange={(event) => updateSceneStructureQuickText(overlay.id, { textEffectDuration: Math.min(8, Math.max(0.05, numberValue(event.target.value, overlay.textEffectDuration))) })} /></label>
            <label className="scene-structure-quick-field"><span>Chiều rộng (%)</span><input type="number" min="4" max="100" value={overlay.width ?? ""} placeholder="Tự động" onChange={(event) => updateSceneStructureQuickText(overlay.id, { width: event.target.value === "" ? undefined : Math.min(100, Math.max(4, numberValue(event.target.value, overlay.width ?? 40))) })} /></label>
            <label className="scene-structure-quick-field"><span>Chiều cao (%)</span><input type="number" min="3" max="40" value={overlay.height ?? ""} placeholder="Tự động" onChange={(event) => updateSceneStructureQuickText(overlay.id, { height: event.target.value === "" ? undefined : Math.min(40, Math.max(3, numberValue(event.target.value, overlay.height ?? 10))) })} /></label>
            <label className="scene-structure-quick-field"><span>Độ dày Stroke (px)</span><input type="number" min="0" max="12" value={overlay.strokeWidth} onChange={(event) => updateSceneStructureQuickText(overlay.id, { strokeWidth: Math.min(12, Math.max(0, numberValue(event.target.value, overlay.strokeWidth))) })} /></label>
            <label className="scene-structure-quick-field"><span>Màu Stroke</span><input type="color" value={normalizeHexColor(overlay.strokeColor, "#000000")} onChange={(event) => updateSceneStructureQuickText(overlay.id, { strokeColor: event.target.value })} /></label>
            <label className="scene-structure-quick-field"><span>Viền khung (px)</span><input type="number" min="0" max="12" value={overlay.borderWidth} onChange={(event) => updateSceneStructureQuickText(overlay.id, { borderWidth: Math.min(12, Math.max(0, numberValue(event.target.value, overlay.borderWidth))) })} /></label>
            <label className="scene-structure-quick-field"><span>Màu viền</span><input type="color" value={normalizeHexColor(overlay.borderColor, "#ffffff")} onChange={(event) => updateSceneStructureQuickText(overlay.id, { borderColor: event.target.value })} /></label>
            <label className="scene-structure-quick-field"><span>Màu nền khung</span><input type="color" value={normalizeHexColor(overlay.borderFill, "#14202e")} onChange={(event) => updateSceneStructureQuickText(overlay.id, { borderFill: event.target.value })} /></label>
            <label className="scene-structure-quick-field"><span>Độ mờ viền (%)</span><input type="number" min="0" max="100" value={overlay.borderOpacity} onChange={(event) => updateSceneStructureQuickText(overlay.id, { borderOpacity: Math.min(100, Math.max(0, numberValue(event.target.value, overlay.borderOpacity))) })} /></label>
          </div>
          <div className="scene-structure-quick-grid scene-structure-quick-grid-2">
            <label className="scene-structure-quick-toggle"><input type="checkbox" checked={overlay.visible !== false} onChange={(event) => updateSceneStructureQuickText(overlay.id, { visible: event.target.checked })} /><span>Hiển thị khi render</span></label>
            <label className="scene-structure-quick-toggle"><input type="checkbox" checked={overlay.editorVisible !== false} onChange={(event) => updateSceneStructureQuickText(overlay.id, { editorVisible: event.target.checked })} /><span>Hiển thị khi biên soạn</span></label>
          </div>
        </div>
      ) : null;
    }

    if (item.kind === "decoration") {
      const decoration = (quickScene.mapDecorations ?? []).find((entry) => entry.id === item.id);
      content = decoration ? (
        <div className="scene-structure-quick-stack">
          {timingFields}
          <label className="scene-structure-quick-field"><span>Tên trang trí</span><input value={decoration.name} onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, { name: event.target.value })} /></label>
          <label className="scene-structure-quick-field"><span>Loại trang trí</span><select value={decoration.type} onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, { type: event.target.value as MapDecorationType })}><option value="text-3d">Chữ 3D</option><option value="sticker">Sticker</option><option value="animated-sticker">Sticker động</option><option value="icon">Icon</option><option value="effect">Hiệu ứng</option></select></label>
          {(decoration.type === "text-3d" || decoration.type === "icon" || decoration.type === "effect") && <label className="scene-structure-quick-field"><span>{decoration.type === "text-3d" ? "Nội dung" : "Biểu tượng"}</span><input value={decoration.type === "text-3d" ? decoration.text : decoration.symbol} onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, decoration.type === "text-3d" ? { text: event.target.value } : { symbol: event.target.value })} /></label>}
          {(decoration.type === "sticker" || decoration.type === "animated-sticker") && <label className="scene-structure-quick-field"><span>URL tài nguyên</span><input type="url" value={decoration.asset} placeholder="https://..." onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, { asset: event.target.value })} /></label>}
          <div className="scene-structure-quick-grid scene-structure-quick-grid-3">
            <label className="scene-structure-quick-field"><span>Vị trí X (%)</span><input type="number" min="0" max="100" value={decoration.x} onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, { x: clampPercent(event.target.value, decoration.x) })} /></label>
            <label className="scene-structure-quick-field"><span>Vị trí Y (%)</span><input type="number" min="0" max="100" value={decoration.y} onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, { y: clampPercent(event.target.value, decoration.y) })} /></label>
            <label className="scene-structure-quick-field"><span>Kích thước</span><input type="number" min="8" max="260" value={decoration.size} onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, { size: Math.min(260, Math.max(8, numberValue(event.target.value, decoration.size))) })} /></label>
            <label className="scene-structure-quick-field"><span>Tỷ lệ</span><input type="number" min="0.1" max="5" step="0.1" value={decoration.scale} onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, { scale: Math.min(5, Math.max(0.1, numberValue(event.target.value, decoration.scale))) })} /></label>
            <label className="scene-structure-quick-field"><span>Xoay (°)</span><input type="number" min="-360" max="360" value={decoration.rotate} onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, { rotate: Math.min(360, Math.max(-360, numberValue(event.target.value, decoration.rotate))) })} /></label>
            <label className="scene-structure-quick-field"><span>Độ mờ (%)</span><input type="number" min="0" max="100" value={decoration.opacity} onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, { opacity: Math.min(100, Math.max(0, numberValue(event.target.value, decoration.opacity))) })} /></label>
            <label className="scene-structure-quick-field"><span>Độ sâu bóng</span><input type="number" min="0" max="16" value={decoration.depth} onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, { depth: Math.min(16, Math.max(0, numberValue(event.target.value, decoration.depth))) })} /></label>
            <label className="scene-structure-quick-field"><span>Hiệu ứng chuyển động</span><select value={decoration.animation} onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, { animation: event.target.value as MapDecorationAnimation })}><option value="none">Không</option><option value="fade">Fade</option><option value="pop">Pop</option><option value="float">Trôi</option><option value="pulse">Nhấp nháy</option><option value="spin">Xoay</option></select></label>
            <label className="scene-structure-quick-field"><span>Màu chính</span><input type="color" value={normalizeHexColor(decoration.color, "#ffd166")} onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, { color: event.target.value })} /></label>
            <label className="scene-structure-quick-field"><span>Màu nhấn</span><input type="color" value={normalizeHexColor(decoration.accentColor, "#7c3aed")} onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, { accentColor: event.target.value })} /></label>
          </div>
          {decoration.type === "effect" && <label className="scene-structure-quick-field"><span>Kiểu hiệu ứng</span><select value={decoration.effect} onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, { effect: event.target.value as MapDecoration["effect"] })}><option value="sparkles">Lấp lánh</option><option value="ring">Vòng sáng</option><option value="confetti">Confetti</option><option value="glow">Glow</option></select></label>}
          <div className="scene-structure-quick-grid scene-structure-quick-grid-2">
            <label className="scene-structure-quick-toggle"><input type="checkbox" checked={decoration.visible !== false} onChange={(event) => updateSceneStructureQuickDecoration(decoration.id, { visible: event.target.checked })} /><span>Hiển thị khi render</span></label>
          </div>
        </div>
      ) : null;
    }

    if (item.kind === "audio") {
      const track = (quickScene.audioTracks ?? []).find((entry) => entry.id === item.id);
      content = track ? (
        <div className="scene-structure-quick-stack">
          {timingFields}
          <label className="scene-structure-quick-field"><span>Tên âm thanh</span><input value={track.name} onChange={(event) => updateSceneStructureQuickAudio(track.id, { name: event.target.value })} /></label>
          <label className="scene-structure-quick-field"><span>File / URL âm thanh</span><input value={track.source} placeholder="audio/file.mp3 hoặc https://..." onChange={(event) => updateSceneStructureQuickAudio(track.id, { source: event.target.value })} /></label>
          <label className="scene-structure-quick-field"><span>Âm lượng (%)</span><input type="number" min="0" max="100" value={track.volume} onChange={(event) => updateSceneStructureQuickAudio(track.id, { volume: Math.min(100, Math.max(0, numberValue(event.target.value, track.volume))) })} /></label>
          <label className="scene-structure-quick-toggle"><input type="checkbox" checked={track.visible !== false} onChange={(event) => updateSceneStructureQuickAudio(track.id, { visible: event.target.checked })} /><span>Phát track này khi xem thử và render</span></label>
        </div>
      ) : null;
    }

    if (item.kind === "subtitle") {
      const subtitleStyle = normalizeSubtitleStyle(quickScene.subtitleStyle);
      const quickSubtitles = quickScene.subtitles ?? [];
      const updateQuickSubtitle = (subtitleId: string, patch: Partial<SubtitleCue>) => updateSceneStructureQuickScene((currentScene) => ({
        ...currentScene,
        subtitles: (currentScene.subtitles ?? []).map((subtitle) => subtitle.id === subtitleId
          ? { ...subtitle, ...patch }
          : subtitle),
      }));
      content = (
        <div className="scene-structure-quick-stack">
          {timingFields}
          <label className="scene-structure-quick-toggle"><input type="checkbox" checked={quickScene.subtitleEnabled !== false} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleEnabled: event.target.checked }))} /><span>Hiển thị phụ đề</span></label>
          <label className="scene-structure-quick-field"><span>Thời gian bắt đầu toàn bộ phụ đề (giây)</span><input type="number" min="0" max={sceneStructureDuration} step="0.1" value={quickScene.subtitleStart} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStart: Math.min(sceneStructureDuration, Math.max(0, numberValue(event.target.value, currentScene.subtitleStart))) }))} /></label>
          <div className="scene-structure-quick-grid scene-structure-quick-grid-3">
            <label className="scene-structure-quick-field"><span>Cỡ chữ</span><input type="number" min="8" max="120" value={subtitleStyle.size} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStyle: { ...normalizeSubtitleStyle(currentScene.subtitleStyle), size: Math.min(120, Math.max(8, numberValue(event.target.value, subtitleStyle.size))) } }))} /></label>
            <label className="scene-structure-quick-field"><span>Font chữ</span><select value={subtitleStyle.font} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStyle: { ...normalizeSubtitleStyle(currentScene.subtitleStyle), font: event.target.value as OverlayTextFont } }))}><option value="Arial">Arial</option><option value="Verdana">Verdana</option><option value="Georgia">Georgia</option><option value="Tahoma">Tahoma</option><option value="Times New Roman">Times New Roman</option><option value="Courier New">Courier New</option></select></label>
            <label className="scene-structure-quick-field"><span>Kiểu chữ</span><select value={subtitleStyle.style} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStyle: { ...normalizeSubtitleStyle(currentScene.subtitleStyle), style: event.target.value as SubtitleStyle["style"] } }))}><option value="normal">Bình thường</option><option value="bold">Đậm</option><option value="italic">Nghiêng</option><option value="bold-italic">Đậm nghiêng</option></select></label>
            <label className="scene-structure-quick-field"><span>Vị trí X (%)</span><input type="number" min="0" max="100" value={subtitleStyle.x} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStyle: { ...normalizeSubtitleStyle(currentScene.subtitleStyle), x: clampPercent(event.target.value, subtitleStyle.x) } }))} /></label>
            <label className="scene-structure-quick-field"><span>Vị trí Y (%)</span><input type="number" min="0" max="100" value={subtitleStyle.y} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStyle: { ...normalizeSubtitleStyle(currentScene.subtitleStyle), y: clampPercent(event.target.value, subtitleStyle.y) } }))} /></label>
            <label className="scene-structure-quick-field"><span>Độ rộng hộp (%)</span><input type="number" min="20" max="100" value={subtitleStyle.boxWidth} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStyle: { ...normalizeSubtitleStyle(currentScene.subtitleStyle), boxWidth: Math.min(100, Math.max(20, numberValue(event.target.value, subtitleStyle.boxWidth))) } }))} /></label>
            <label className="scene-structure-quick-field"><span>Chiều cao hộp (%)</span><input type="number" min="3" max="40" value={subtitleStyle.boxHeight ?? ""} placeholder="Tự động" onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStyle: { ...normalizeSubtitleStyle(currentScene.subtitleStyle), boxHeight: event.target.value === "" ? undefined : Math.min(40, Math.max(3, numberValue(event.target.value, subtitleStyle.boxHeight ?? 10))) } }))} /></label>
            <label className="scene-structure-quick-field"><span>Màu chữ</span><input type="color" value={normalizeHexColor(subtitleStyle.color, "#ffffff")} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStyle: { ...normalizeSubtitleStyle(currentScene.subtitleStyle), color: event.target.value } }))} /></label>
            <label className="scene-structure-quick-field"><span>Độ mờ chữ (%)</span><input type="number" min="0" max="100" value={subtitleStyle.opacity} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStyle: { ...normalizeSubtitleStyle(currentScene.subtitleStyle), opacity: Math.min(100, Math.max(0, numberValue(event.target.value, subtitleStyle.opacity))) } }))} /></label>
            <label className="scene-structure-quick-field"><span>Border (px)</span><input type="number" min="0" max="12" value={subtitleStyle.borderWidth} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStyle: { ...normalizeSubtitleStyle(currentScene.subtitleStyle), borderWidth: Math.min(12, Math.max(0, numberValue(event.target.value, subtitleStyle.borderWidth))) } }))} /></label>
            <label className="scene-structure-quick-field"><span>Màu border</span><input type="color" value={normalizeHexColor(subtitleStyle.borderColor, "#ffffff")} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStyle: { ...normalizeSubtitleStyle(currentScene.subtitleStyle), borderColor: event.target.value } }))} /></label>
            <label className="scene-structure-quick-field"><span>Màu nền</span><input type="color" value={normalizeHexColor(subtitleStyle.borderFill, "#14202e")} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStyle: { ...normalizeSubtitleStyle(currentScene.subtitleStyle), borderFill: event.target.value } }))} /></label>
            <label className="scene-structure-quick-field"><span>Độ trong suốt nền (%)</span><input type="number" min="0" max="100" value={subtitleStyle.borderOpacity} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStyle: { ...normalizeSubtitleStyle(currentScene.subtitleStyle), borderOpacity: Math.min(100, Math.max(0, numberValue(event.target.value, subtitleStyle.borderOpacity))) } }))} /></label>
            <label className="scene-structure-quick-field"><span>Hiệu ứng phụ đề</span><select value={subtitleStyle.animation} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStyle: { ...normalizeSubtitleStyle(currentScene.subtitleStyle), animation: event.target.value as SubtitleAnimation } }))}><option value="none">Không</option><option value="fade">Fade</option><option value="pop">Pop</option><option value="slide-up">Trượt lên</option><option value="typewriter">Gõ chữ</option></select></label>
            <label className="scene-structure-quick-field"><span>Thời lượng hiệu ứng (giây)</span><input type="number" min="0.05" max="1" step="0.05" value={subtitleStyle.animationDuration} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, subtitleStyle: { ...normalizeSubtitleStyle(currentScene.subtitleStyle), animationDuration: Math.min(1, Math.max(0.05, numberValue(event.target.value, subtitleStyle.animationDuration))) } }))} /></label>
          </div>
          <div className="scene-structure-quick-divider"><strong>Nội dung từng câu</strong><small>Thời gian tính từ mốc bắt đầu toàn bộ phụ đề.</small></div>
          {quickSubtitles.length > 0 ? quickSubtitles.map((subtitle, index) => (
            <div className={`scene-structure-quick-subtitle ${subtitle.visible === false ? "is-hidden" : ""}`} key={subtitle.id}>
              <div className="scene-structure-quick-subtitle-heading">
                <strong>Câu {index + 1}</strong>
                <label className="scene-structure-quick-toggle"><input type="checkbox" checked={subtitle.visible !== false} onChange={(event) => updateQuickSubtitle(subtitle.id, { visible: event.target.checked })} /><span>Hiện</span></label>
              </div>
              <textarea rows={3} value={subtitle.text} placeholder="Nhập nội dung phụ đề..." onChange={(event) => updateQuickSubtitle(subtitle.id, { text: event.target.value })} />
              <div className="scene-structure-quick-grid scene-structure-quick-grid-2">
                <label className="scene-structure-quick-field"><span>Bắt đầu (giây)</span><input type="number" min="0" max={sceneStructureDuration} step="0.1" value={subtitle.start} onChange={(event) => updateQuickSubtitle(subtitle.id, { start: Math.min(sceneStructureDuration, Math.max(0, numberValue(event.target.value, subtitle.start))) })} /></label>
                <label className="scene-structure-quick-field"><span>Kết thúc (giây)</span><input type="number" min="0.1" max={sceneStructureDuration} step="0.1" value={subtitle.end} onChange={(event) => updateQuickSubtitle(subtitle.id, { end: Math.min(sceneStructureDuration, Math.max(subtitle.start + 0.1, numberValue(event.target.value, subtitle.end))) })} /></label>
              </div>
            </div>
          )) : <small className="scene-structure-quick-note">Chưa có câu phụ đề.</small>}
          <small className="scene-structure-quick-note">{quickSubtitles.filter((cue) => cue.visible !== false).length} câu phụ đề đang hiển thị.</small>
        </div>
      );
    }

    if (item.kind === "effect") {
      if (item.id === "zoom") {
        content = (
          <div className="scene-structure-quick-stack">
            {timingFields}
            <label className="scene-structure-quick-toggle"><input type="checkbox" checked={quickScene.zoomEnabled !== false} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, zoomEnabled: event.target.checked }))} /><span>Bật hiệu ứng zoom bản đồ</span></label>
            <div className="scene-structure-quick-grid scene-structure-quick-grid-3">
              <label className="scene-structure-quick-field"><span>Mức zoom</span><input type="number" min="1" max="5" step="0.05" value={quickScene.zoom} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, zoom: Math.min(5, Math.max(1, numberValue(event.target.value, currentScene.zoom))) }))} /></label>
              <label className="scene-structure-quick-field"><span>Zoom vào (giây)</span><input type="number" min="0.1" max={sceneStructureDuration} step="0.1" value={quickScene.zoomInDuration} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, zoomInDuration: Math.min(sceneStructureDuration, Math.max(0.1, numberValue(event.target.value, currentScene.zoomInDuration))) }))} /></label>
              <label className="scene-structure-quick-field"><span>Zoom ra (giây)</span><input type="number" min="0" max={sceneStructureDuration} step="0.1" value={quickScene.zoomOutDuration} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, zoomOutDuration: Math.min(sceneStructureDuration, Math.max(0, numberValue(event.target.value, currentScene.zoomOutDuration))) }))} /></label>
              <label className="scene-structure-quick-field"><span>Tâm X (%)</span><input type="number" min="0" max="100" value={quickScene.centerX} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, centerX: clampPercent(event.target.value, currentScene.centerX) }))} /></label>
              <label className="scene-structure-quick-field"><span>Tâm Y (%)</span><input type="number" min="0" max="100" value={quickScene.centerY} onChange={(event) => updateSceneStructureQuickScene((currentScene) => ({ ...currentScene, centerY: clampPercent(event.target.value, currentScene.centerY) }))} /></label>
            </div>
          </div>
        );
      } else if (item.id.startsWith("dark:")) {
        const effectId = item.id.slice("dark:".length);
        const darkEffect = normalizeSceneEffects(quickScene.effects).sceneStartDarkEffects.find((effect) => effect.id === effectId);
        content = darkEffect ? (
          <div className="scene-structure-quick-stack">
            {timingFields}
            <label className="scene-structure-quick-toggle"><input type="checkbox" checked={darkEffect.enabled} onChange={(event) => updateSceneStructureQuickDarkEffect(effectId, { enabled: event.target.checked })} /><span>Bật hiệu ứng tối</span></label>
            <div className="scene-structure-quick-grid scene-structure-quick-grid-2">
              <label className="scene-structure-quick-field"><span>Thời gian giữ tối (giây)</span><input type="number" min="0" max={Math.max(0, darkEffect.end - darkEffect.start - 0.1)} step="0.1" value={darkEffect.holdDuration} onChange={(event) => updateSceneStructureQuickDarkEffect(effectId, { holdDuration: Math.min(Math.max(0, darkEffect.end - darkEffect.start - 0.1), Math.max(0, numberValue(event.target.value, darkEffect.holdDuration))) })} /></label>
              <label className="scene-structure-quick-field"><span>Cường độ (%)</span><input type="number" min="0" max="100" value={darkEffect.intensity} onChange={(event) => updateSceneStructureQuickDarkEffect(effectId, { intensity: Math.min(100, Math.max(0, numberValue(event.target.value, darkEffect.intensity))) })} /></label>
            </div>
          </div>
        ) : null;
      } else {
        const effects = normalizeSceneEffects(quickScene.effects);
        const weatherControls: Array<{
          enabled: keyof SceneEffects;
          intensity: keyof SceneEffects;
          speed: keyof SceneEffects;
          label: string;
        }> = [
          { enabled: "snowEnabled", intensity: "snowIntensity", speed: "snowSpeed", label: "Tuyết rơi" },
          { enabled: "rainEnabled", intensity: "rainIntensity", speed: "rainSpeed", label: "Mưa" },
          { enabled: "cloudEnabled", intensity: "cloudIntensity", speed: "cloudSpeed", label: "Mây trôi" },
          { enabled: "lightFlickerEnabled", intensity: "lightFlickerIntensity", speed: "lightFlickerSpeed", label: "Chớp sáng" },
          { enabled: "thunderEnabled", intensity: "thunderIntensity", speed: "thunderSpeed", label: "Sấm chớp" },
        ];
        content = (
          <div className="scene-structure-quick-stack">
            <p className="scene-structure-quick-note">Bật/tắt từng hiệu ứng môi trường cho cảnh này.</p>
            {weatherControls.map(({ enabled, intensity, speed, label }) => (
              <div className="scene-structure-quick-environment" key={enabled}>
                <label className="scene-structure-quick-toggle">
                  <input type="checkbox" checked={Boolean(effects[enabled])} onChange={(event) => updateSceneStructureQuickEffects({ [enabled]: event.target.checked } as Partial<SceneEffects>)} />
                  <span>{label}</span>
                </label>
                <div className="scene-structure-quick-grid scene-structure-quick-grid-2">
                  <label className="scene-structure-quick-field"><span>Cường độ (%)</span><input type="number" min="0" max="100" value={Number(effects[intensity])} disabled={!Boolean(effects[enabled])} onChange={(event) => updateSceneStructureQuickEffects({ [intensity]: Math.min(100, Math.max(0, numberValue(event.target.value, Number(effects[intensity]) || 0))) } as Partial<SceneEffects>)} /></label>
                  <label className="scene-structure-quick-field"><span>Tốc độ (×)</span><input type="number" min="0.2" max="3" step="0.1" value={Number(effects[speed])} disabled={!Boolean(effects[enabled])} onChange={(event) => updateSceneStructureQuickEffects({ [speed]: Math.min(3, Math.max(0.2, numberValue(event.target.value, Number(effects[speed]) || 1))) } as Partial<SceneEffects>)} /></label>
                </div>
              </div>
            ))}
          </div>
        );
      }
    }

    return (
      <div
        className="scene-structure-quick-editor-overlay"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSceneStructureQuickEditToken("");
        }}
      >
        <section className="scene-structure-quick-editor" role="dialog" aria-modal="true" aria-labelledby="scene-structure-quick-editor-heading">
          <header>
            <div>
              <span>{item.icon}</span>
              <div>
                <p>CHỈNH SỬA NHANH</p>
                <h2 id="scene-structure-quick-editor-heading">{item.label}</h2>
                <small>{sceneStructureKindLabel(item.kind)} · Tự đồng bộ với Biên soạn</small>
              </div>
            </div>
            <button type="button" className="scene-structure-quick-close" aria-label="Đóng popup chỉnh sửa" title="Đóng" onClick={() => setSceneStructureQuickEditToken("")}>×</button>
          </header>
          <div className="scene-structure-quick-editor-body">{content ?? <p className="scene-structure-quick-note">Thẻ này không còn tồn tại hoặc đã được ẩn.</p>}</div>
          <footer>
            <button type="button" className="button secondary" onClick={() => openSceneStructureItemInEditor(item)}>Mở Biên soạn đầy đủ</button>
            <button type="button" className="button primary" onClick={() => setSceneStructureQuickEditToken("")}>Xong</button>
          </footer>
        </section>
      </div>
    );
  };

  const renderSceneStructureLivePreview = (
    localTime = sceneStructureLocalTime,
    options: { staticFrame?: boolean } = {},
  ) => {
    const staticFrame = options.staticFrame === true;
    const previewIsPlaying = !staticFrame && playing;
    const liveSubtitleStyle = normalizeSubtitleStyle(sceneStructureScene.subtitleStyle);
    const liveSubtitleOffset = Math.min(
      sceneStructureDuration,
      Math.max(0, Number(sceneStructureScene.subtitleStart) || 0),
    );
    const liveSubtitle = sceneStructureScene.subtitleEnabled !== false
      ? (sceneStructureScene.subtitles ?? []).find((subtitle) => {
          const cueStart = Math.max(0, Number(subtitle.start) || 0);
          const cueEnd = Math.min(
            sceneStructureDuration,
            Math.max(liveSubtitleOffset + cueStart + 0.1, liveSubtitleOffset + (Number(subtitle.end) || cueStart + 0.1)),
          );
          return subtitle.visible !== false
            && safeTrim(subtitle.text)
            && localTime >= Math.min(sceneStructureDuration, liveSubtitleOffset + cueStart)
            && localTime < cueEnd;
        })
      : null;
    const liveSubtitleStart = liveSubtitle
      ? Math.min(sceneStructureDuration, liveSubtitleOffset + Math.max(0, Number(liveSubtitle.start) || 0))
      : 0;
    const liveSubtitleProgress = liveSubtitle
      ? Math.min(1, Math.max(0, (localTime - liveSubtitleStart) / Math.max(0.05, liveSubtitleStyle.animationDuration)))
      : 1;
    const liveSubtitleOpacity = liveSubtitleStyle.animation === "fade" ? liveSubtitleProgress : 1;
    const liveSubtitleScale = liveSubtitleStyle.animation === "pop" ? 0.92 + liveSubtitleProgress * 0.08 : 1;
    const liveSubtitleOffsetY = liveSubtitleStyle.animation === "slide-up" ? (1 - liveSubtitleProgress) * 3 : 0;
    const liveSubtitleClipPath = liveSubtitleStyle.animation === "typewriter"
      ? `inset(0 ${Math.max(0, 100 - liveSubtitleProgress * 100)}% 0 0)`
      : "none";
    const activeLiveImageIds = new Set(
      sceneStructureImages
        .filter((image) => image.visible !== false && safeTrim(image.url))
        .filter((image) => {
          const start = Math.min(sceneStructureDuration, Math.max(0, Number(image.start) || 0));
          const end = Math.min(sceneStructureDuration, start + Math.max(0.1, Number(image.duration) || 0.1));
          return localTime >= start && localTime < end;
        })
        .map((image) => image.id),
    );

    const liveDarkOverlayItems = sceneStartDarkOverlayItemsAtTime(localTime);

    return (
      <div className={`phone-preview scene-structure-live-preview ${aspectRatio === "16:9" ? "preview-landscape" : "preview-portrait"} ${previewIsPlaying ? "is-playing" : "is-paused"} ${staticFrame ? "is-playback-paused scene-structure-static-frame" : ""}`} aria-label={staticFrame ? `Khung hình xem trước tại ${formatPreciseTime(localTime)}` : "Màn hình xem trước đang chạy thử"}>
        {sceneStructureScene.backgroundVisible !== false && sceneStructureBackgroundSource ? (
          isVideoMedia(sceneStructureBackgroundValue) ? (
            <video
              key={`${sceneStructureBackgroundSource}-${previewIsPlaying ? "playing" : "paused"}`}
              className="project-background"
              src={sceneStructureBackgroundSource}
              muted
              autoPlay={previewIsPlaying}
              loop
              playsInline
              preload="metadata"
              aria-hidden="true"
            />
          ) : (
            <img
              className="project-background"
              src={sceneStructureBackgroundSource}
              alt=""
              aria-hidden="true"
              style={{
                transformOrigin: `${sceneStructureScene.centerX}% ${sceneStructureScene.centerY}%`,
                transform: `scale(${sceneStructureScene.zoomEnabled ? Math.max(1, Number(sceneStructureScene.zoom ?? 1) || 1) : 1})`,
              }}
            />
          )
        ) : (
          <div className="scene-structure-live-empty-background">Chưa có nền bản đồ</div>
        )}

        {sceneStructureTexts
          .filter((overlay) => overlay.visible !== false && safeTrim(overlay.text))
          .map((overlay, index) => {
            const start = Math.min(sceneStructureDuration, Math.max(0, Number(overlay.start) || 0));
            const end = Math.min(sceneStructureDuration, Math.max(start + 0.1, Number(overlay.end) || sceneStructureDuration));
            if (localTime < start || localTime >= end) return null;
            return (
              <div
                key={`live-text-${overlay.id}`}
                className={`map-text-overlay scene-structure-live-layer text-effect-${overlay.textEffect ?? "none"} ${previewIsPlaying ? "is-playing" : ""}`}
                style={{
                  left: `${overlay.x}%`,
                  top: `${overlay.y}%`,
                  zIndex: 110 + index,
                  ...(Number.isFinite(Number(overlay.width)) ? { width: `${overlay.width}%` } : {}),
                  ...(Number.isFinite(Number(overlay.height)) ? { height: `${overlay.height}%` } : {}),
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
                  ["--text-effect-duration" as string]: `${Math.max(0.05, Number(overlay.textEffectDuration ?? 0.6) || 0.6)}s`,
                }}
              >
                {overlay.text}
              </div>
            );
          })}

        {sceneStructureImages
          .filter((image) => image.visible !== false && activeLiveImageIds.has(image.id))
          .map((image, index) => {
            const imageSource = sceneImageSpritePreviewUrls[image.id] || assetPreviewSource(image.url);
            const imageIsVideo = image.mediaType === "video" || isVideoMedia(image.url);
            const squareSize = Math.min(image.width, image.height);
            const width = image.shape === "square" ? squareSize : image.width;
            const height = image.shape === "square" ? squareSize : image.height;
            const transition = normalizeSceneImageTransition(image.transition);
            const transitionDuration = sceneImageTransitionDuration(image);
            const imageStart = Math.min(sceneStructureDuration, Math.max(0, Number(image.start) || 0));
            const transitionProgress = staticFrame && transition !== "cut" && transitionDuration > 0
              ? Math.min(1, Math.max(0, (localTime - imageStart) / transitionDuration))
              : 1;
            const transitionTransform = transition === "slide-left"
              ? `translate(-50%, -50%) translateX(${(transitionProgress - 1) * 110}%)`
              : transition === "slide-right"
                ? `translate(-50%, -50%) translateX(${(1 - transitionProgress) * 110}%)`
                : transition === "zoom"
                  ? `translate(-50%, -50%) scale(${1.14 - transitionProgress * 0.14})`
                  : undefined;
            const transitionFilter = transition === "blur"
              ? `blur(${Math.max(0, (1 - transitionProgress) * 12).toFixed(2)}px)`
              : undefined;
            return (
              <div
                key={`live-image-${image.id}`}
                className={`scene-image-overlay scene-structure-live-layer scene-image-shape-${image.shape}`}
                style={{
                  left: `${image.x}%`,
                  top: `${image.y}%`,
                  zIndex: 20 + index,
                  width: `${width}%`,
                  height: `${height}%`,
                  clipPath: sceneImageClipPath(image.shape),
                  backgroundColor: image.borderFill === "transparent" ? undefined : image.borderFill,
                  border: image.borderWidth > 0 ? `${image.borderWidth}px solid ${image.borderColor}` : undefined,
                  opacity: (image.opacity / 100) * (transition === "crossfade" ? transitionProgress : 1),
                  transform: transitionTransform,
                  filter: transitionFilter,
                  transformOrigin: "center center",
                }}
              >
                {imageSource && imageIsVideo
                  ? <video src={imageSource} autoPlay={previewIsPlaying} loop muted playsInline preload="metadata" />
                  : imageSource
                    ? <img src={imageSource} alt="" draggable={false} />
                    : <span>Chưa có media</span>}
              </div>
            );
          })}

        {sceneStructureDecorations
          .filter((decoration) => decoration.visible !== false && decorationHasContent(decoration))
          .filter((decoration) => {
            const start = Math.min(sceneStructureDuration, Math.max(0, Number(decoration.start) || 0));
            const end = Math.min(sceneStructureDuration, start + Math.max(0.1, Number(decoration.duration) || sceneStructureDuration));
            return localTime >= start && localTime < end;
          })
          .map((decoration, index) => {
            const stickerSource = decoration.type === "sticker" || decoration.type === "animated-sticker"
              ? assetPreviewSource(decoration.asset)
              : "";
            const animatedVideo = decoration.type === "animated-sticker" && decoration.assetType === "webm";
            const content = decoration.type === "animated-sticker" && stickerSource
              ? animatedVideo
                ? <video src={stickerSource} autoPlay={previewIsPlaying} loop muted playsInline aria-hidden="true" />
                : <img src={stickerSource} alt="" draggable={false} />
              : decoration.type === "sticker" && stickerSource
                ? <img src={stickerSource} alt="" draggable={false} />
                : <span className="map-decoration-content">{decoration.type === "text-3d" ? decoration.text : decorationSymbol(decoration)}</span>;
            return (
              <div
                key={`live-decoration-${decoration.id}`}
                className={`map-decoration scene-structure-live-layer map-decoration-${decoration.type} map-decoration-animation-${decoration.animation} ${previewIsPlaying ? "is-playing" : ""}`}
                style={{
                  left: `${decoration.x}%`,
                  top: `${decoration.y}%`,
                  zIndex: 30 + index,
                  opacity: decoration.opacity / 100,
                  color: colorWithAlpha(decoration.color, decoration.opacity / 100, "#ffd166"),
                  fontSize: `${decoration.size}px`,
                  transform: `translate(-50%, -50%) rotate(${decoration.rotate}deg) scale(${decoration.scale})`,
                  ["--decoration-depth-shadow" as string]: decorationTextShadow(decoration),
                  ["--decoration-accent" as string]: decoration.accentColor,
                }}
              >
                {content}
              </div>
            );
          })}

        {sceneStructurePopups
          .filter((popup) => popup.visible !== false)
          .map((popup, index) => {
            const popupStart = Math.min(sceneStructureDuration, Math.max(0, Number(popup.start) || 0));
            const popupDuration = Math.max(0.1, Number(popup.duration) || 0.1);
            const popupEnd = Math.min(sceneStructureDuration, popupStart + popupDuration);
            if (localTime < popupStart || localTime >= popupEnd) return null;
            const popupImageSource = imageEnabled && popup.imageVisible !== false ? assetPreviewSource(popup.image) : "";
            const popupVideoSource = assetPreviewSource(popup.video);
            const popupHasMedia = Boolean(popupVideoSource || popupImageSource);
            const popupHasText = Boolean(safeTrim(popup.title) || safeTrim(popup.body));
            const popupLayout = popup.layout ?? "image-top";
            const popupShowMedia = popupLayout !== "content-only" && popupHasMedia;
            const popupShowText = popupLayout !== "image-only" && popupHasText;
            const popupGeometry = popupSectionGeometry(popup, popupShowMedia, popupShowText);
            return (
              <article
                key={`live-popup-${popup.id}`}
                className={`preview-card scene-structure-live-layer popup-layout-${popupLayout} popup-theme-${popup.theme ?? "travel"}`}
                style={{
                  width: `${popup.width ?? 90}%`,
                  height: `min(${popupGeometry.height || popup.height || 255}px, 88%)`,
                  left: `${popup.x ?? 5}%`,
                  top: `${popup.y ?? 55}%`,
                  right: "auto",
                  bottom: "auto",
                  zIndex: 40 + index,
                }}
              >
                {popupShowMedia && (
                  <div className="photo-placeholder" style={{ height: `${popupGeometry.imageHeight}px` }}>
                    {popupVideoSource ? <video className="popup-video" src={popupVideoSource} muted autoPlay={previewIsPlaying} loop playsInline /> : popupImageSource ? <img src={popupImageSource} alt="" /> : null}
                  </div>
                )}
                {popupShowText && (
                  <div className="card-content" style={{ height: `${popupGeometry.contentHeight}px` }}>
                    {safeTrim(popup.title) && <h3>{popup.title}</h3>}
                    {safeTrim(popup.body) && <p>{popup.body}</p>}
                  </div>
                )}
              </article>
            );
          })}

        {(sceneStructurePreviewMode || staticFrame) && liveSubtitle && (
          <div
            className="subtitle-overlay scene-structure-live-layer"
            style={{
              left: `${liveSubtitleStyle.x}%`,
              top: `${liveSubtitleStyle.y + liveSubtitleOffsetY}%`,
              zIndex: 220,
              right: "auto",
              width: `${liveSubtitleStyle.boxWidth}%`,
              ...(Number.isFinite(Number(liveSubtitleStyle.boxHeight)) ? { height: `${liveSubtitleStyle.boxHeight}%` } : {}),
              maxWidth: "100%",
              boxSizing: "border-box",
              color: colorWithAlpha(liveSubtitleStyle.color, (liveSubtitleStyle.opacity / 100) * liveSubtitleOpacity, "#ffffff"),
              fontFamily: liveSubtitleStyle.font,
              fontSize: `${Math.max(12, liveSubtitleStyle.size)}px`,
              fontStyle: liveSubtitleStyle.style.includes("italic") ? "italic" : "normal",
              fontWeight: liveSubtitleStyle.style.includes("bold") ? 750 : 400,
              borderWidth: `${liveSubtitleStyle.borderWidth}px`,
              borderColor: colorWithAlpha(liveSubtitleStyle.borderColor, liveSubtitleStyle.borderOpacity / 100, "#ffffff"),
              background: colorWithAlpha(liveSubtitleStyle.borderFill, liveSubtitleStyle.borderOpacity / 100, "#0b1220"),
              opacity: liveSubtitleOpacity,
              clipPath: liveSubtitleClipPath,
              textShadow: liveSubtitleStyle.strokeWidth > 0 ? `0 0 ${Math.max(1, liveSubtitleStyle.strokeWidth)}px ${liveSubtitleStyle.strokeColor}` : "none",
              transform: `translate(-50%, -50%) scale(${liveSubtitleScale})`,
            }}
          >
            {liveSubtitle.text}
          </div>
        )}

        {liveDarkOverlayItems.map((item) => (
          <div
            key={`live-dark-${item.effect.id}`}
            className="scene-start-dark-effect scene-structure-live-layer"
            aria-hidden="true"
            style={{
              ["--scene-start-dark-clear-radius" as string]: `${item.clearRadius}%`,
              ["--scene-start-dark-edge-opacity" as string]: String(item.edgeOpacity),
              ["--scene-start-dark-mid-opacity" as string]: String(item.midOpacity),
              ["--scene-start-dark-center-opacity" as string]: String(item.centerOpacity),
              ["--scene-start-dark-blur" as string]: `${item.blur}px`,
            }}
          />
        ))}
        {!staticFrame && <div className="scene-structure-live-badge"><i /> {previewIsPlaying ? "ĐANG PHÁT" : "ĐÃ TẠM DỪNG"}</div>}
      </div>
    );
  };

  const renderSceneStructureHoverPreview = () => {
    if (!sceneStructureHoverPreview || sceneStructurePreviewMode) return null;
    return (
      <div
        className="scene-structure-hover-preview"
        role="tooltip"
        aria-label={`Khung hình xem trước tại ${formatPreciseTime(sceneStructureHoverPreview.localTime)}`}
        style={{
          left: `${sceneStructureHoverPreview.left}px`,
          top: `${sceneStructureHoverPreview.top}px`,
        }}
      >
        <div className={`scene-structure-hover-preview-frame ${aspectRatio === "16:9" ? "is-landscape" : "is-portrait"}`}>
          {renderSceneStructureLivePreview(sceneStructureHoverPreview.localTime, { staticFrame: true })}
        </div>
        <div className="scene-structure-hover-preview-caption">
          <strong>{formatPreciseTime(sceneStructureHoverPreview.localTime)}</strong>
          <span>{sceneStructureHoverPreview.label}</span>
        </div>
      </div>
    );
  };

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
              {projectItems.map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
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
              const displayDuration = Math.max(0.1, displayItem.end - displayItem.start);
              const playbackActive =
                playing &&
                visibleIndex >= 0 &&
                playTime >= displayItem.start &&
                playTime < displayItem.end;
              const thumbSource =
                assetPreviewSource(item.avatar) ||
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
                      ? `Đang ẩn · ${displayDuration.toFixed(1)} giây`
                      : `${formatTime(displayItem.start)}–${formatTime(displayItem.end)} · ${displayDuration.toFixed(1)} giây`}
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
                {!hydrated ? "Đang tải..." : playing ? "Tạm dừng" : previewPlaybackMode ? "Tiếp tục" : "Xem thử"}
              </button>
              <button
                type="button"
                className="preview-replay-button"
                disabled={!hydrated || !visibleScenes.length}
                aria-label="Chạy lại từ đầu"
                title="Chạy lại toàn bộ video từ đầu"
                onClick={replayPlayback}
              >
                <span aria-hidden="true">↻</span>
                <b>Chạy lại</b>
              </button>
              <button
                type="button"
                className={`preview-audio-toggle ${previewAudioMuted ? "muted" : ""}`}
                aria-label={previewAudioMuted ? "Bật âm thanh xem trước" : "Tắt âm thanh xem trước"}
                aria-pressed={previewAudioMuted}
                title={previewAudioMuted ? "Bật âm thanh của tất cả cảnh và nhạc nền" : "Tắt âm thanh của tất cả cảnh và nhạc nền"}
                onClick={togglePreviewAudio}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 10v4h3l4 3V7l-4 3H4Z" />
                  {previewAudioMuted ? (
                    <path d="m16 9 5 6m0-6-5 6" />
                  ) : (
                    <path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7.5 7.5 0 0 1 0 10" />
                  )}
                </svg>
              </button>
              <button
                type="button"
                className={`preview-subtitle-guide-toggle ${subtitleGuideVisible ? "active" : ""}`}
                aria-label={subtitleGuideVisible ? "Ẩn khung phụ đề mẫu" : "Hiện khung phụ đề mẫu"}
                aria-pressed={subtitleGuideVisible}
                title={subtitleGuideVisible ? "Ẩn khung phụ đề mẫu" : "Hiện khung phụ đề mẫu"}
                onClick={() => setSubtitleGuideVisible((visible) => !visible)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2.8 12s3.2-5 9.2-5 9.2 5 9.2 5-3.2 5-9.2 5-9.2-5-9.2-5Z" />
                  <circle cx="12" cy="12" r="2.2" />
                  {!subtitleGuideVisible && <path d="m4 4 16 16" />}
                </svg>
              </button>
              <button
                type="button"
                className="preview-review-toggle"
                aria-label="Mở Review tổng quan"
                title="Review tổng quan các cảnh đang hiện"
                onClick={() => {
                  setPlaying(false);
                  setPreviewFullscreen(false);
                  setReviewOpen(true);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M8 4v16M3 9h18M3 14h18" />
                </svg>
                <span>Review</span>
              </button>
              <div className="preview-ruler-control">
                <button
                  type="button"
                  ref={rulerToggleRef}
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
                  <div
                    ref={rulerPopoverRef}
                    className="preview-ruler-style-popover"
                    role="group"
                    aria-label="Kiểu thước căn chỉnh"
                    style={{ top: rulerPopoverPosition.top, left: rulerPopoverPosition.left }}
                  >
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
          <div className="preview-stage-layout">
            <div className="preview-stage">
          {(() => {
            const previewCanvas = (
          <div
            data-preview-source="editor"
            className={`phone-preview ${aspectRatio === "16:9" ? "preview-landscape" : "preview-portrait"} ${playing ? "is-playing" : ""} ${previewPlaybackMode && !playing ? "is-playback-paused" : ""} ${!sceneStructurePreviewMode && rulerEnabled ? "ruler-enabled" : ""} ${!sceneStructurePreviewMode && mapEffectDragActive ? "effect-drop-target" : ""} ${sceneStructurePreviewMode ? "scene-structure-live-preview" : ""}`}
            style={{ transform: sceneStructurePreviewMode ? "none" : `scale(${previewZoom / 100})` }}
            onDragOver={sceneStructurePreviewMode ? undefined : handleMapEffectDragOver}
            onDragLeave={sceneStructurePreviewMode ? undefined : () => setMapEffectDragActive(false)}
            onDrop={sceneStructurePreviewMode ? undefined : handleMapEffectDrop}
          >
            {sceneIsVisibleInPlayback && scene.backgroundVisible !== false && backgroundPreviewSource && (
              backgroundIsVideo ? (
                <video
                  key={backgroundVideoPreviewSource}
                  ref={backgroundVideoRef}
                  className="project-background"
                  src={backgroundVideoPreviewSource}
                  muted
                  autoPlay={playing}
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
                    transform: `scale(${previewPlaybackMode ? playbackMapScale : 1})`,
                    transitionDuration: previewPlaybackMode ? "0ms" : "180ms",
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
                    transform: `scale(${previewPlaybackMode ? playbackMapScale : 1})`,
                    transitionDuration: previewPlaybackMode ? "0ms" : "180ms",
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
            {sceneIsVisibleInPlayback && previewTextOverlayItems.map((overlay) => safeTrim(overlay.text) ? (
              <div
                key={overlay.id}
                className={`map-text-overlay text-effect-${overlay.textEffect ?? "none"} ${playing ? "is-playing" : ""} ${draggingTextOverlay && overlay.id === activeTextOverlay?.id ? "is-dragging" : ""}`}
                style={{
                  left: `${overlay.x}%`,
                  top: `${overlay.y}%`,
                  zIndex: previewLayerZIndex("text", overlay.id),
                  ...(Number.isFinite(Number(overlay.width)) ? { width: `${overlay.width}%` } : {}),
                  ...(Number.isFinite(Number(overlay.height)) ? { height: `${overlay.height}%` } : {}),
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
                  ["--text-effect-duration" as string]: `${Math.max(0.05, Number(overlay.textEffectDuration ?? 0.6) || 0.6)}s`,
                }}
                role="button"
                tabIndex={0}
                aria-label="Chữ viết trên bản đồ. Kéo để di chuyển."
                onPointerDown={(event) => startTextOverlayDrag(event, overlay.id)}
              >
                {overlay.text}
                {overlay.id === activeTextOverlay?.id && !playing && (
                  <button
                    type="button"
                    className="map-text-resize-handle"
                    aria-label="Kéo để thay đổi kích thước chữ viết"
                    title="Kéo để tăng hoặc giảm chiều rộng, chiều cao"
                    onPointerDown={(event) => startTextOverlayResize(event, overlay.id)}
                  />
                )}
              </div>
            ) : null)}
            {sceneIsVisibleInPlayback && previewSceneImageItems.map((image) => {
              const imageSource = sceneImageSpritePreviewUrls[image.id] || assetPreviewSource(image.url);
              const imageIsVideo = image.mediaType === "video" || isVideoMedia(image.url);
              const imageIsTransparent = image.transparent || Boolean(sceneImageSpritePreviewUrls[image.id]);
              const squareSize = Math.min(image.width, image.height);
              const width = image.shape === "square" ? squareSize : image.width;
              const height = image.shape === "square" ? squareSize : image.height;
              const imageTransition = sceneImagePreviewTransition(image);
              const transitionProgress = imageTransition.progress;
              const transitionTransform = imageTransition.transition === "slide-left"
                ? `translate(-50%, -50%) translateX(${(transitionProgress - 1) * 110}%)`
                : imageTransition.transition === "slide-right"
                  ? `translate(-50%, -50%) translateX(${(1 - transitionProgress) * 110}%)`
                  : imageTransition.transition === "zoom"
                    ? `translate(-50%, -50%) scale(${1.14 - transitionProgress * 0.14})`
                    : undefined;
              const transitionFilter = imageTransition.transition === "blur"
                ? `blur(${Math.max(0, (1 - transitionProgress) * 12).toFixed(2)}px)`
                : undefined;
              return (
                <div
                  key={image.id}
                  data-scene-image-id={image.id}
                  className={`scene-image-overlay scene-image-shape-${image.shape} ${imageIsTransparent ? "is-transparent-media" : ""} ${draggingSceneImage && image.id === activeSceneImage?.id ? "is-dragging" : ""}`}
                  style={{
                    left: `${image.x}%`,
                    top: `${image.y}%`,
                    zIndex: previewLayerZIndex("image", image.id),
                    width: `${width}%`,
                    height: `${height}%`,
                    clipPath: sceneImageClipPath(image.shape),
                    backgroundColor: image.borderFill === "transparent" ? undefined : image.borderFill,
                    border: image.borderWidth > 0 ? `${image.borderWidth}px solid ${image.borderColor}` : undefined,
                    opacity: (image.opacity / 100) * (imageTransition.transition === "crossfade" ? transitionProgress : 1),
                    transform: transitionTransform,
                    filter: transitionFilter,
                    transformOrigin: "center center",
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
                    zIndex: previewLayerZIndex("decoration", decoration.id),
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
            {playing && activeSubtitle && (
              <div
                className={`subtitle-overlay subtitle-animation-${subtitleStyle.animation} ${draggingSubtitle ? "is-dragging" : ""} ${playing ? "is-playing" : ""}`}
                role="button"
                tabIndex={0}
                aria-live="polite"
                aria-label="Mở phần Phụ đề trong Âm thanh"
                title="Bấm để mở Phụ đề trong Âm thanh"
                onPointerDown={startSubtitleDrag}
                onClick={() => openTimelineEditor(scene, "editor-subtitle")}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openTimelineEditor(scene, "editor-subtitle");
                  }
                }}
                style={{
                  left: `${subtitleStyle.x}%`,
                  top: `${subtitleStyle.y + subtitleAnimationOffset}%`,
                  zIndex: previewLayerZIndex("subtitle", "subtitle"),
                  right: "auto",
                  width: `${subtitleStyle.boxWidth}%`,
                  ...(Number.isFinite(Number(subtitleStyle.boxHeight)) ? { height: `${subtitleStyle.boxHeight}%` } : {}),
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
            {subtitleGuideVisible && !playing && (
              <div
                className={`subtitle-layout-guide ${draggingSubtitle || draggingSubtitleResize ? "is-dragging" : ""}`}
                style={{
                  left: `${subtitleStyle.x}%`,
                  top: `${subtitleStyle.y}%`,
                  zIndex: previewLayerZIndex("subtitle", "subtitle"),
                  width: `${subtitleStyle.boxWidth}%`,
                  height: `${subtitleGuideHeight}%`,
                }}
                role="button"
                tabIndex={0}
                aria-label="Mở phần Phụ đề trong Âm thanh hoặc kéo để di chuyển"
                title="Bấm để mở Phụ đề trong Âm thanh · Kéo để di chuyển vùng phụ đề"
                onPointerDown={startSubtitleDrag}
                onClick={() => openTimelineEditor(scene, "editor-subtitle")}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openTimelineEditor(scene, "editor-subtitle");
                  }
                }}
              >
                <span>{subtitleGuideMetrics}</span>
                <button
                  type="button"
                  className="subtitle-resize-handle"
                  aria-label="Kéo để thay đổi kích thước phụ đề"
                  title="Kéo để thay đổi chiều rộng và chiều cao phụ đề"
                  onPointerDown={startSubtitleResize}
                  onClick={(event) => event.stopPropagation()}
                />
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
              const popupGeometry = popupSectionGeometry(popup, popupShowMedia, popupShowText);
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
                    height: `min(${popupGeometry.height || popup.height || 255}px, 88%)`,
                    left: `${popup.x ?? 5}%`,
                    top: `${popup.y ?? 55}%`,
                    zIndex: previewLayerZIndex("popup", popup.id),
                    right: "auto",
                    bottom: "auto",
                    ["--popup-transition-duration" as string]: `${popupTransition}s`,
                    ["--popup-border-width" as string]: `${popup.borderWidth ?? 1}px`,
                  }}
                  tabIndex={0}
                  aria-label={`Popup ${popup.title || popup.id}. Dùng phím mũi tên để di chuyển`}
                  onPointerDown={(event) => startPopupDrag(event, popup.id)}
                >
                  {popupShowMedia && (
                    <div className="photo-placeholder" style={{ height: `${popupGeometry.imageHeight}px` }}>
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
                      {popup.id === activePopup?.id && !playing && (
                        <button
                          type="button"
                          className="popup-section-resize-handle popup-section-resize-handle-image"
                          aria-label="Kéo để thay đổi chiều cao phần hình ảnh Popup"
                          title="Kéo để tăng hoặc giảm chiều cao phần Hình ảnh"
                          onPointerDown={(event) => startPopupSectionResize(event, "image", popup.id)}
                        />
                      )}
                    </div>
                  )}
                  {popupShowText && <div className="card-content" style={{ height: `${popupGeometry.contentHeight}px` }}>
                     {popupLayout === "stats" && (
                      <div className="popup-stat-row">
                        <span>{scene.location || "HÀNH TRÌNH"}</span>
                    <b>{String(scene.number).padStart(2, "0")}</b>
                    </div>
                     )}
                    {popup.layout === "quote" && <span className="popup-quote-mark">“</span>}
                    {safeTrim(popup.title) && <h3>{popup.title}</h3>}
                    {safeTrim(popup.body) && <p>{popup.body}</p>}
                    {popup.id === activePopup?.id && !playing && (
                      <button
                        type="button"
                        className="popup-section-resize-handle popup-section-resize-handle-content"
                        aria-label="Kéo để thay đổi chiều cao phần nội dung Popup"
                        title="Kéo để tăng hoặc giảm chiều cao phần Nội dung"
                        onPointerDown={(event) => startPopupSectionResize(event, "content", popup.id)}
                      />
                    )}
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
            {activeFadeBlackImage && fadeBlackOpacity > 0 && (
              <div
                className="scene-image-fade-black"
                aria-hidden="true"
                style={{ opacity: fadeBlackOpacity }}
              />
            )}
            {sceneIsVisibleInPlayback && sceneStartDarkOverlayItems.map((item) => (
              <div
                key={`scene-start-dark-${item.effect.id}`}
                className="scene-start-dark-effect"
                aria-hidden="true"
                style={{
                  ["--scene-start-dark-clear-radius" as string]: `${item.clearRadius}%`,
                  ["--scene-start-dark-edge-opacity" as string]: String(item.edgeOpacity),
                  ["--scene-start-dark-mid-opacity" as string]: String(item.midOpacity),
                  ["--scene-start-dark-center-opacity" as string]: String(item.centerOpacity),
                  ["--scene-start-dark-blur" as string]: `${item.blur}px`,
                }}
              />
            ))}
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
            );
            if (sceneStructurePreviewMode) {
              return sceneStructurePreviewPortalHost
                ? createPortal(previewCanvas, sceneStructurePreviewPortalHost)
                : null;
            }
            return previewCanvas;
          })()}
          <div className="preview-navigation preview-navigation-zoom-only" aria-label="Tỷ lệ zoom xem trước">
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
          </div>
            </div>
            <aside className="preview-layer-panel" aria-label="Các lớp trong màn hình xem trước">
              <div className="preview-layer-panel-heading">
                <span className="preview-layer-panel-heading-copy">
                  <strong>Layer</strong>
                  <small>Trên cùng ở phía dưới</small>
                </span>
                <button
                  type="button"
                  className="preview-scene-structure-button"
                  aria-label="Mở Cấu trúc cảnh"
                  title="Cấu trúc cảnh"
                  onClick={openSceneStructure}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="4" width="6" height="5" rx="1" />
                    <rect x="15" y="4" width="6" height="5" rx="1" />
                    <rect x="9" y="15" width="6" height="5" rx="1" />
                    <path d="M9 6.5h6M6 9v3h6v3M18 9v3h-6" />
                  </svg>
                </button>
              </div>
              <label className="preview-layer-search">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="10.8" cy="10.8" r="6.4" />
                  <path d="m16 16 4.2 4.2" />
                </svg>
                <input
                  type="search"
                  value={previewLayerQuery}
                  onChange={(event) => setPreviewLayerQuery(event.target.value)}
                  placeholder="Tìm layer"
                  aria-label="Tìm layer trong màn hình xem trước"
                />
              </label>
              <div className="preview-layer-list">
                {visiblePreviewLayerItems.length ? visiblePreviewLayerItems.map((item) => (
                  <button
                    type="button"
                    key={item.token}
                    draggable
                    className={`preview-layer-item ${
                      item.token === explicitlySelectedPreviewLayerToken
                        ? "active"
                        : ""
                    } ${previewLayerDrag.overId === item.token ? "is-drag-over" : ""}`}
                    title="Kéo để thay đổi thứ tự layer · Bấm để chọn"
                    aria-label={`${item.label}. Kéo để thay đổi thứ tự layer`}
                    onClick={() => selectPreviewLayerItem(item)}
                    onDragStart={(event) => startPreviewLayerDrag(event, item.token)}
                    onDragOver={(event) => updatePreviewLayerDragOver(event, item.token)}
                    onDrop={(event) => finishPreviewLayerDrop(event, item.token)}
                    onDragEnd={clearPreviewLayerDrag}
                  >
                    <span className="preview-layer-drag-handle" aria-hidden="true">⠿</span>
                    <span className="preview-layer-avatar" aria-hidden="true">{previewLayerAvatar(item)}</span>
                    <span className="preview-layer-label">
                      <strong>{item.label}</strong>
                      <small>{item.token === previewLayerItems[previewLayerItems.length - 1]?.token ? "Trên cùng" : item.kind}</small>
                    </span>
                  </button>
                )) : (
                  <span className="preview-layer-empty">{previewLayerItems.length ? "Không tìm thấy layer." : "Chưa có layer trên màn hình."}</span>
                )}
              </div>
              <small className="preview-layer-panel-hint">Kéo item xuống dưới để đưa lên trên cùng.</small>
            </aside>
          </div>
        </section>

        <aside className={`editor-panel ${!hydrated ? "is-loading" : ""}`}>
          <div className="panel-heading editor-panel-heading">
            <h2>Biên soạn</h2>
            <div className="editor-heading-actions">
              <span className="scene-pill">
                {selectedSceneIds.length > 1
                  ? `${selectedSceneIds.length} cảnh`
                  : `Cảnh ${scene.number}`}
              </span>
              <label className="quick-scene-duration">
                <TimeFieldLabel hint="Độ dài toàn bộ cảnh; các mốc thời gian bên trong cảnh được tính từ 0 giây của cảnh này.">Thời lượng</TimeFieldLabel>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={Number(sceneDuration.toFixed(1))}
                  aria-label="Thay đổi nhanh thời lượng cảnh (giây)"
                  onChange={(event) => updateSelectedSceneDuration(Number(event.target.value))}
                />
                <b>s</b>
              </label>
            </div>
            <nav className="editor-section-shortcuts" aria-label="Đi tới nhanh mục biên soạn">
              {EDITOR_SECTION_SHORTCUTS.map((shortcut) => (
                <button
                  type="button"
                  key={shortcut.key}
                  className={`editor-section-shortcut ${editorSections[shortcut.key] ? "active" : ""}`}
                  title={`Mở mục ${shortcut.label}`}
                  aria-label={`Mở mục ${shortcut.number} ${shortcut.label}`}
                  onClick={() => focusEditorSection(shortcut.key)}
                >
                  <span>{shortcut.number}</span>
                  <b>{shortcut.label}</b>
                </button>
              ))}
            </nav>
          </div>
          <div className="editor-scroll" ref={editorScrollRef}>
            <details
              className="editor-accordion editor-accordion-visual"
              data-editor-section="visual"
              open={editorSections.visual}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setEditorSectionOpen("visual", open);
              }}
            >
              <summary className="editor-group-label">
                <span>01</span><strong>Hình ảnh & nền</strong>{editorSectionActions("visual")}<i />
              </summary>
              <div className="editor-accordion-content">
            <EditorFieldGroup
              title="Nền của cảnh"
              description="Ảnh hoặc video phủ toàn bộ cảnh đang chọn."
            >
            <label className="field background-field">
              <FieldLabel hint="Tài nguyên này chỉ làm nền cho cảnh hiện tại và không thay đổi avatar của cảnh.">Background chủ đề cảnh {scene.number}</FieldLabel>
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
            </EditorFieldGroup>
            <EditorFieldGroup
              title="Ảnh đại diện cảnh"
              description="Thumbnail dùng trong danh sách cảnh, không xuất hiện trong video."
              advanced
            >
              <label className="field scene-avatar-field">
                <FieldLabel hint="Ảnh này chỉ dùng làm avatar/thumbnail trong danh sách cảnh.">Ảnh avatar cho Cảnh {scene.number}</FieldLabel>
                <input
                  type="text"
                  inputMode="url"
                  placeholder="https://example.com/avatar.jpg"
                  value={scene.avatar ?? ""}
                  onChange={(event) => updateScene("avatar", event.target.value)}
                />
                {sceneAvatarPreviewSource && (
                  <div className="image-url-preview scene-avatar-preview">
                    <img src={sceneAvatarPreviewSource} alt={`Ảnh avatar Cảnh ${scene.number}`} />
                  </div>
                )}
                <small>Ảnh này chỉ dùng làm avatar/thumbnail của Cảnh trong danh sách, không thay thế background khi render.</small>
              </label>
            </EditorFieldGroup>
              </div>
            </details>
            <details
              className="editor-accordion editor-accordion-images"
              data-editor-section="images"
              open={editorSections.images}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setEditorSectionOpen("images", open);
              }}
            >
              <summary className="editor-group-label">
                <span>03</span><strong>Hình ảnh</strong>{editorSectionActions("images")}<i />
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
                        <div
                          key={image.id}
                          id={`editor-layer-images-${image.id}`}
                          tabIndex={-1}
                          aria-selected={image.id === activeSceneImage?.id}
                          className={`scene-image-item ${image.id === activeSceneImage?.id ? "active" : ""} ${image.visible === false ? "is-hidden" : ""} ${image.editorVisible === false ? "is-editor-hidden" : ""} ${layerListDrag.overId === image.id && layerListDrag.type === "image" ? "is-drag-over" : ""}`}
                          onDragOver={(event) => updateLayerListDragOver("image", image.id, event)}
                          onDrop={(event) => finishLayerListDrop("image", image.id, event)}
                        >
                          <span
                            className="layer-drag-handle"
                            draggable
                            role="button"
                            tabIndex={0}
                            title="Kéo để sắp xếp hình ảnh"
                            aria-label={`Kéo để sắp xếp ${sceneImageLabel(image, index)}`}
                            onDragStart={(event) => beginLayerListDrag("image", image.id, event)}
                            onDragEnd={clearLayerListDrag}
                          >⠿</span>
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
                          <button
                            type="button"
                            className={`scene-image-action editor-layer-visibility ${image.editorVisible === false ? "is-hidden" : ""}`}
                            title={image.editorVisible === false ? "Hiện lớp khi biên soạn" : "Ẩn lớp khi biên soạn"}
                            aria-label={image.editorVisible === false ? `Hiện ${sceneImageLabel(image, index)} khi biên soạn` : `Ẩn ${sceneImageLabel(image, index)} khi biên soạn`}
                            onClick={() => toggleSceneImageEditorVisibility(image.id)}
                          >
                            {editorVisibilityIcon(image.editorVisible === false)}
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
                      <EditorFieldGroup title="Nội dung" description="Nguồn hình ảnh hoặc video của layer đang chọn.">
                        <label className="field">
                          <FieldLabel hint="Có thể nhập URL hoặc tên file đã có trong thư viện tài nguyên.">URL hình ảnh hoặc video</FieldLabel>
                          <input type="text" inputMode="url" value={activeSceneImage.url} placeholder="https://.../overlay.png hoặc overlay.webm" onChange={(event) => updateSceneImageUrl(event.target.value)} />
                        </label>
                        {Boolean(safeTrim(activeSceneImage.url)) && (
                          <label className="popup-transparent-toggle">
                            <input type="checkbox" checked={activeSceneImage.transparent} onChange={(event) => updateSceneImage("transparent", event.target.checked)} />
                            <span />
                            Giữ nền trong suốt cho lớp media
                          </label>
                        )}
                      </EditorFieldGroup>

                      <EditorFieldGroup title="Thời gian hiển thị" description="Các mốc tuyệt đối tính từ đầu cảnh.">
                        <div className="field-row">
                          <label className="field"><TimeFieldLabel hint="Mốc tuyệt đối tính từ đầu cảnh; hình ảnh bắt đầu hiển thị từ thời điểm này.">Bắt đầu</TimeFieldLabel><div className="number-with-unit"><input type="number" min="0" max={Math.max(0, sceneDuration - 0.1)} step="0.1" value={activeSceneImage.start} onChange={(event) => {
                            const nextStart = Math.min(Math.max(0, sceneDuration - 0.1), Math.max(0, Number(event.target.value) || 0));
                            updateSceneImage("start", nextStart);
                            if (activeSceneImage.transitionEnd < nextStart + 0.1) {
                              updateSceneImage("transitionEnd", Math.min(sceneDuration, nextStart + 0.1));
                            }
                          }} /><b>s</b></div></label>
                          <label className="field"><TimeFieldLabel hint="Mốc tuyệt đối tính từ đầu cảnh; hình ảnh sẽ tự tắt khi chạy đến thời điểm này.">Thời gian kết thúc</TimeFieldLabel><div className="number-with-unit"><input type="number" min={Math.min(sceneDuration, activeSceneImage.start + 0.1)} max={sceneDuration} step="0.1" value={Number(Math.min(sceneDuration, activeSceneImage.start + Math.max(0.1, activeSceneImage.duration)).toFixed(1))} onChange={(event) => updateSceneImageEndTime(Number(event.target.value))} /><b>s</b></div></label>
                        </div>
                        <div className="editor-field-feedback" role="status">
                          Hiển thị từ {formatTime(activeSceneImage.start)} đến {formatTime(Math.min(sceneDuration, activeSceneImage.start + activeSceneImage.duration))} · tổng {formatTime(Math.min(sceneDuration - activeSceneImage.start, activeSceneImage.duration))}
                        </div>
                      </EditorFieldGroup>

                      <EditorFieldGroup
                        title="Vị trí & kích thước"
                        description="Có thể kéo trực tiếp layer trên bản đồ để cập nhật các giá trị này."
                        action={<button type="button" className="editor-reset-button" onClick={resetActiveSceneImageGeometry}>↺ Mặc định</button>}
                      >
                        <div className="field-row">
                          <label className="field"><FieldLabel hint="Vị trí ngang theo phần trăm chiều rộng bản đồ.">Vị trí X</FieldLabel><div className="number-with-unit"><input type="number" min="0" max="100" step="0.1" value={activeSceneImage.x} onChange={(event) => updateSceneImage("x", clampPercent(event.target.value, activeSceneImage.x))} /><b>%</b></div></label>
                          <label className="field"><FieldLabel hint="Vị trí dọc theo phần trăm chiều cao bản đồ.">Vị trí Y</FieldLabel><div className="number-with-unit"><input type="number" min="0" max="100" step="0.1" value={activeSceneImage.y} onChange={(event) => updateSceneImage("y", clampPercent(event.target.value, activeSceneImage.y))} /><b>%</b></div></label>
                        </div>
                        <div className="field-row">
                          <label className="field"><FieldLabel hint="Chiều rộng của layer tính theo phần trăm khung bản đồ.">Chiều rộng</FieldLabel><div className="number-with-unit"><input type="number" min="1" max="200" step="1" value={activeSceneImage.width} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateSceneImage("width", Math.min(200, Math.max(1, Number(event.target.value) || 1)))} /><b>%</b></div></label>
                          <label className="field"><FieldLabel hint="Chiều cao của layer tính theo phần trăm khung bản đồ.">Chiều cao</FieldLabel><div className="number-with-unit"><input type="number" min="1" max="200" step="1" value={activeSceneImage.height} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateSceneImage("height", Math.min(200, Math.max(1, Number(event.target.value) || 1)))} /><b>%</b></div></label>
                        </div>
                        <div className="field text-position-readout"><span>Vị trí hiện tại</span><b>X {Math.round(activeSceneImage.x)}% · Y {Math.round(activeSceneImage.y)}%</b></div>
                      </EditorFieldGroup>

                      <EditorFieldGroup title="Khung & hiển thị" description="Kiểu cắt, độ mờ và đường viền của layer." advanced>
                        <div className="field-row">
                          <label className="field">
                            <FieldLabel hint="Hình dạng dùng để cắt phần hiển thị của media.">Kiểu khung</FieldLabel>
                            <select value={activeSceneImage.shape} onChange={(event) => updateSceneImage("shape", event.target.value as SceneImageShape)}>
                              {sceneImageShapeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </label>
                          <label className="field"><FieldLabel hint="100% là hiển thị hoàn toàn; 0% là trong suốt.">Độ mờ</FieldLabel><div className="number-with-unit"><input type="number" min="0" max="100" value={activeSceneImage.opacity} onChange={(event) => updateSceneImage("opacity", Math.min(100, Math.max(0, Number(event.target.value) || 0)))} /><b>%</b></div></label>
                        </div>
                        <div className="field-row">
                          <label className="field"><FieldLabel hint="Đặt bằng 0 để tắt toàn bộ đường viền.">Độ dày border</FieldLabel><div className="number-with-unit"><input type="number" min="0" max="12" step="1" value={activeSceneImage.borderWidth} onChange={(event) => updateSceneImage("borderWidth", Math.min(12, Math.max(0, Number(event.target.value) || 0)))} /><b>px</b></div></label>
                          {activeSceneImage.borderWidth > 0 && (
                            <label className="field color-field"><FieldLabel hint="Màu của đường viền quanh layer.">Màu border</FieldLabel><input className="text-color-picker" type="color" value={activeSceneImage.borderColor} onChange={(event) => updateSceneImage("borderColor", event.target.value)} /></label>
                          )}
                        </div>
                        {activeSceneImage.borderWidth > 0 && (
                          <label className="field color-field scene-image-border-fill-field">
                            <FieldLabel hint="Để trống hoặc nhập transparent nếu không muốn có màu nền trong border.">Màu nền bên trong border</FieldLabel>
                            <div className="color-input-row">
                              <input className="text-color-picker" type="color" value={normalizeHexColor(activeSceneImage.borderFill, "#ffffff")} onChange={(event) => updateSceneImage("borderFill", event.target.value)} />
                              <input className="text-color-code" type="text" inputMode="text" maxLength={11} value={activeSceneImage.borderFill === "transparent" ? "" : activeSceneImage.borderFill} placeholder="transparent / #FFFFFF" onChange={(event) => updateSceneImage("borderFill", event.target.value || "transparent")} onBlur={(event) => updateSceneImage("borderFill", normalizeSceneImageBorderFill(event.target.value))} />
                            </div>
                          </label>
                        )}
                      </EditorFieldGroup>

                      <EditorFieldGroup title="Chuyển hình" description="Cách layer đi vào và mốc kết thúc hiệu ứng." advanced>
                        <div className="field-row scene-image-transition-row">
                          <label className="field scene-image-transition-field">
                            <FieldLabel hint="Chọn cách hình ảnh xuất hiện khi bắt đầu hiển thị.">Hiệu ứng chuyển hình</FieldLabel>
                            <select value={activeSceneImage.transition} onChange={(event) => updateSceneImage("transition", normalizeSceneImageTransition(event.target.value))}>
                              {sceneImageTransitionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                            <small>{sceneImageTransitionOptions.find((option) => option.value === activeSceneImage.transition)?.hint}</small>
                          </label>
                          {activeSceneImage.transition !== "cut" && (
                            <label className="field scene-image-transition-end-field">
                              <TimeFieldLabel hint="Mốc tuyệt đối tính từ đầu cảnh; khi chạy đến mốc này, hiệu ứng chuyển hình kết thúc.">Thời gian kết thúc hiệu ứng</TimeFieldLabel>
                              <div className="number-with-unit"><input type="number" inputMode="decimal" min={Math.max(0.1, activeSceneImage.start + 0.1)} step="0.1" value={activeSceneImageTransitionEndInput} onChange={(event) => updateSceneImageTransitionEndInput(event.target.value)} onBlur={() => commitSceneImageTransitionEnd(activeSceneImage.id, activeSceneImageTransitionEndInput)} /><b>s</b></div>
                            </label>
                          )}
                        </div>
                      </EditorFieldGroup>

                      <EditorFieldGroup title="Sprite động" description="Chuyển sprite sheet thành hình động; không cần dùng với ảnh hoặc video thông thường." advanced>
                        {activeSceneImage.spriteSheet && (
                          <label className="field scene-image-sprite-speed-field">
                            <TimeFieldLabel hint="Khoảng trễ giữa hai khung hình của sprite; giá trị lớn hơn làm chuyển động chậm hơn.">Tốc độ chuyển động</TimeFieldLabel>
                            <div className="number-with-unit"><input type="number" min="60" max="1000" step="10" value={activeSceneImageSpriteDelayInput} disabled={sceneImageSpriteNotice.status === "processing"} onChange={(event) => updateSceneImageSpriteDelay(event.target.value)} onBlur={() => commitSceneImageSpriteDelay(activeSceneImage.id, activeSceneImageSpriteDelayInput)} /><b>ms/frame</b></div>
                          </label>
                        )}
                        <div className="scene-image-sprite-action-row">
                          <button type="button" className="button ghost scene-image-sprite-button" disabled={!activeSceneImage.url || sceneImageSpriteNotice.status === "processing"} onClick={() => {
                            const delay = commitSceneImageSpriteDelay(activeSceneImage.id, activeSceneImageSpriteDelayInput);
                            void prepareSceneImageSprite(activeSceneImage.id, activeSceneImage.url, true, delay);
                          }}>
                            {sceneImageSpriteNotice.imageId === activeSceneImage.id && sceneImageSpriteNotice.status === "processing" ? "Đang chuyển thành hình động…" : activeSceneImage.spriteSheet ? "Chuyển lại hình động" : "Chuyển sprite thành hình động"}
                          </button>
                          {sceneImageSpriteNotice.imageId === activeSceneImage.id && sceneImageSpriteNotice.message && <small className={`scene-image-sprite-notice ${sceneImageSpriteNotice.status}`}>{sceneImageSpriteNotice.message}</small>}
                        </div>
                        <label className="field scene-image-sprite-file-field">
                          <FieldLabel hint="Hệ thống tự nhận diện lưới khung hình trong file sprite.">Hoặc chọn file sprite từ máy</FieldLabel>
                          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/apng" disabled={sceneImageSpriteNotice.status === "processing"} onChange={(event) => {
                            const file = event.currentTarget.files?.[0] ?? null;
                            void handleSceneImageSpriteFile(file);
                            event.currentTarget.value = "";
                          }} />
                        </label>
                      </EditorFieldGroup>
                    </div>
                  )}
                </div>
              </div>
            </details>
            <details
              className="editor-accordion editor-accordion-scene-content"
              data-editor-section="content"
              open={editorSections.content}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setEditorSectionOpen("content", open);
              }}
            >
              <summary className="editor-group-label">
                <span>02</span><strong>Nội dung cảnh</strong>{editorSectionActions("content")}<i />
              </summary>
              <div className="editor-accordion-content">
            <EditorFieldGroup title="Thông tin cơ bản" description="Tên và độ dài tổng thể của cảnh đang chọn.">
            <label className="field">
              <TimeFieldLabel hint="Độ dài toàn bộ cảnh; các layer, âm thanh và hiệu ứng dùng mốc thời gian nằm trong khoảng này.">Thời lượng cảnh</TimeFieldLabel>
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
              <FieldLabel hint="Tên giúp nhận biết cảnh trong danh sách và không trực tiếp xuất hiện trong video.">Tên Cảnh</FieldLabel>
              <input
                value={scene.sceneName}
                placeholder={`Cảnh ${scene.number}`}
                onChange={(event) => updateScene("sceneName", event.target.value)}
              />
              <small>Tên này hiển thị ở danh sách cảnh và khu vực xem trước.</small>
            </label>
            </EditorFieldGroup>
              </div>
            </details>
            <details
              className="editor-accordion editor-accordion-text"
              data-editor-section="text"
              open={editorSections.text}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setEditorSectionOpen("text", open);
              }}
            >
              <summary className="editor-group-label">
                <span>04</span><strong>Chữ viết</strong>{editorSectionActions("text")}<i />
              </summary>
              <div className="editor-accordion-content">
                <EditorFieldGroup title="Nội dung chữ" description="Chọn layer và nhập nội dung hiển thị trên bản đồ.">
                <label className="field">
                  <FieldLabel hint="Nội dung của layer chữ đang chọn; mỗi layer có thể chỉnh riêng.">Nội dung chữ viết</FieldLabel>
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
                          <div
                            key={overlay.id}
                            id={`editor-layer-text-${overlay.id}`}
                            tabIndex={-1}
                            aria-selected={overlay.id === activeTextOverlay?.id}
                            className={`text-overlay-item ${overlay.id === activeTextOverlay?.id ? "active" : ""} ${overlay.visible === false ? "is-hidden" : ""} ${overlay.editorVisible === false ? "is-editor-hidden" : ""} ${layerListDrag.overId === overlay.id && layerListDrag.type === "text" ? "is-drag-over" : ""}`}
                            onDragOver={(event) => updateLayerListDragOver("text", overlay.id, event)}
                            onDrop={(event) => finishLayerListDrop("text", overlay.id, event)}
                          >
                            <span
                              className="layer-drag-handle"
                              draggable
                              role="button"
                              tabIndex={0}
                              title="Kéo để sắp xếp chữ viết"
                              aria-label={`Kéo để sắp xếp ${textOverlayLabel(overlay, index)}`}
                              onDragStart={(event) => beginLayerListDrag("text", overlay.id, event)}
                              onDragEnd={clearLayerListDrag}
                            >⠿</span>
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
                            <button
                              type="button"
                              className={`text-overlay-visibility editor-layer-visibility ${overlay.editorVisible === false ? "is-hidden" : ""}`}
                              aria-label={overlay.editorVisible === false ? `Hiện chữ ${index + 1} khi biên soạn` : `Ẩn chữ ${index + 1} khi biên soạn`}
                              title={overlay.editorVisible === false ? `Hiện chữ ${index + 1} khi biên soạn` : `Ẩn chữ ${index + 1} khi biên soạn`}
                              onClick={() => toggleTextOverlayEditorVisibility(overlay.id)}
                            >
                              {editorVisibilityIcon(overlay.editorVisible === false)}
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
                </EditorFieldGroup>
                <EditorFieldGroup title="Kiểu chữ cơ bản" description="Cỡ chữ và kiểu nhấn mạnh thường dùng.">
                <div className="field-row">
                  <label className="field">
                    <FieldLabel hint="Kích thước chữ tính theo pixel trong khung xem trước.">Cỡ chữ</FieldLabel>
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
                    <FieldLabel hint="Chọn chữ thường, đậm, nghiêng hoặc kết hợp.">Kiểu chữ</FieldLabel>
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
                </EditorFieldGroup>
                <EditorFieldGroup title="Hiệu ứng chữ" description="Chuyển động khi chữ xuất hiện; bỏ qua nếu chọn Không hiệu ứng." advanced>
                <div className="field-row text-effect-controls">
                  <label className="field">
                    <FieldLabel hint="Hiệu ứng được đồng bộ giữa xem trước và video render.">Hiệu ứng chữ</FieldLabel>
                    <select
                      value={activeTextOverlay?.textEffect ?? "none"}
                      onChange={(event) => updateTextOverlay("textEffect", normalizeTextOverlayEffect(event.target.value))}
                    >
                      {TEXT_OVERLAY_EFFECT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  {activeTextOverlay?.textEffect !== "none" && (
                    <label className="field">
                      <TimeFieldLabel hint="Độ dài tương đối của hiệu ứng chữ, tính từ lúc hiệu ứng bắt đầu.">Thời lượng hiệu ứng</TimeFieldLabel>
                      <div className="number-with-unit"><input type="number" min="0.05" max="8" step="0.05" value={activeTextOverlay?.textEffectDuration ?? 0.6} disabled={!activeTextOverlay} onChange={(event) => updateTextOverlay("textEffectDuration", Math.min(8, Math.max(0.05, Number(event.target.value) || 0.05)))} /><b>s</b></div>
                    </label>
                  )}
                </div>
                <small>Hiệu ứng được đồng bộ khi xem thử và khi render. Với “Glow pulse”, “Rung”, “Glitch” và “Kinetic”, chuyển động sẽ lặp trong lúc cảnh đang phát.</small>
                </EditorFieldGroup>
                <EditorFieldGroup title="Thời gian hiển thị" description="Mốc bắt đầu và kết thúc tuyệt đối tính từ đầu cảnh.">
                <div className="field-row text-overlay-timing-fields">
                  <label className="field">
                    <TimeFieldLabel hint="Mốc tuyệt đối tính từ đầu cảnh; chữ bắt đầu xuất hiện từ thời điểm này.">Thời gian bắt đầu chữ</TimeFieldLabel>
                    <div className="number-with-unit">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={activeTextOverlay ? textOverlayTimingValue(activeTextOverlay, "start") : "0"}
                        disabled={!activeTextOverlay}
                        onChange={(event) => activeTextOverlay && updateTextOverlayTimingInput(activeTextOverlay, "start", event.target.value)}
                        onBlur={() => activeTextOverlay && commitTextOverlayTimingInput(activeTextOverlay, "start")}
                      />
                      <b>giây</b>
                    </div>
                  </label>
                  <label className="field">
                    <TimeFieldLabel hint="Mốc tuyệt đối tính từ đầu cảnh; chữ sẽ ẩn sau thời điểm này.">Thời gian kết thúc chữ</TimeFieldLabel>
                    <div className="number-with-unit">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={activeTextOverlay ? textOverlayTimingValue(activeTextOverlay, "end") : String(sceneDuration)}
                        disabled={!activeTextOverlay}
                        onChange={(event) => activeTextOverlay && updateTextOverlayTimingInput(activeTextOverlay, "end", event.target.value)}
                        onBlur={() => activeTextOverlay && commitTextOverlayTimingInput(activeTextOverlay, "end")}
                      />
                      <b>giây</b>
                    </div>
                  </label>
                </div>
                <small>Chữ chỉ hiển thị trong khoảng thời gian này. Khi để mặc định, chữ hiển thị suốt cảnh hiện tại.</small>
                {activeTextOverlay && (
                  <div className="editor-field-feedback" role="status">
                    Hiển thị từ {formatTime(activeTextOverlay.start)} đến {formatTime(activeTextOverlay.end)} · tổng {formatTime(Math.max(0.1, activeTextOverlay.end - activeTextOverlay.start))}
                  </div>
                )}
                </EditorFieldGroup>
                <EditorFieldGroup
                  title="Vị trí & kích thước"
                  description="Kéo chữ trên bản đồ hoặc nhập trực tiếp các giá trị phần trăm."
                  action={<button type="button" className="editor-reset-button" onClick={resetActiveTextOverlayGeometry}>↺ Mặc định</button>}
                >
                <div className="field-row">
                  <label className="field">
                    <FieldLabel hint="Vị trí ngang theo phần trăm chiều rộng bản đồ.">Vị trí X</FieldLabel>
                    <div className="number-with-unit"><input type="number" min="0" max="100" step="0.1" value={activeTextOverlay?.x ?? 50} onChange={(event) => updateTextOverlay("x", clampPercent(event.target.value, activeTextOverlay?.x ?? 50))} /><b>%</b></div>
                  </label>
                  <label className="field">
                    <FieldLabel hint="Vị trí dọc theo phần trăm chiều cao bản đồ.">Vị trí Y</FieldLabel>
                    <div className="number-with-unit"><input type="number" min="0" max="100" step="0.1" value={activeTextOverlay?.y ?? 18} onChange={(event) => updateTextOverlay("y", clampPercent(event.target.value, activeTextOverlay?.y ?? 18))} /><b>%</b></div>
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    <FieldLabel hint="Để trống nếu muốn chiều rộng tự động theo nội dung.">Chiều rộng</FieldLabel>
                    <div className="number-with-unit"><input type="number" min="4" max="100" step="0.1" value={activeTextOverlay?.width ?? ""} placeholder="Tự động" onChange={(event) => updateTextOverlay("width", event.target.value === "" ? undefined : Math.min(100, Math.max(4, Number(event.target.value) || 4)))} /><b>%</b></div>
                  </label>
                  <label className="field">
                    <FieldLabel hint="Để trống nếu muốn chiều cao tự động theo nội dung.">Chiều cao</FieldLabel>
                    <div className="number-with-unit"><input type="number" min="3" max="40" step="0.1" value={activeTextOverlay?.height ?? ""} placeholder="Tự động" onChange={(event) => updateTextOverlay("height", event.target.value === "" ? undefined : Math.min(40, Math.max(3, Number(event.target.value) || 3)))} /><b>%</b></div>
                  </label>
                </div>
                <small>Kéo nút ở góc chữ để thay đổi cả chiều rộng và chiều cao. Để trống để dùng kích thước tự động.</small>
                </EditorFieldGroup>
                <EditorFieldGroup title="Màu sắc & đường viền" description="Font, màu, độ trong suốt, stroke và nền khung chữ." advanced>
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
                </EditorFieldGroup>
                <EditorFieldGroup title="Trang trí & hiệu ứng động" description="Chữ 3D, sticker, icon và tài nguyên GIF/WebM/APNG." advanced>
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
                        {activeDecoration.type === "text-3d" && (
                          <label className="field">
                            <FieldLabel hint="Độ sâu bóng tạo cảm giác nổi cho chữ 3D.">Độ nổi 3D</FieldLabel>
                            <div className="number-with-unit"><input type="number" min="0" max="16" step="1" value={activeDecoration.depth} onChange={(event) => updateMapDecoration("depth", Math.min(16, Math.max(0, Number(event.target.value) || 0)))} /><b>px</b></div>
                          </label>
                        )}
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
                      {(activeDecoration.type === "text-3d" || activeDecoration.type === "icon" || activeDecoration.type === "effect") && (
                        <div className="field-row">
                          <label className="field color-field"><span>Màu chính</span><input className="text-color-picker" type="color" value={normalizeHexColor(activeDecoration.color, "#ffd166")} onChange={(event) => updateMapDecoration("color", event.target.value)} /></label>
                          {activeDecoration.type === "text-3d" && <label className="field color-field"><span>Màu chiều sâu</span><input className="text-color-picker" type="color" value={normalizeHexColor(activeDecoration.accentColor, "#7c3aed")} onChange={(event) => updateMapDecoration("accentColor", event.target.value)} /></label>}
                        </div>
                      )}
                      <div className="field-row">
                        <label className="field"><TimeFieldLabel hint="Mốc tuyệt đối tính từ đầu cảnh; hiệu ứng bắt đầu hiển thị từ thời điểm này.">Bắt đầu</TimeFieldLabel><div className="number-with-unit"><input type="number" min="0" max={sceneDuration} step="0.1" value={activeDecoration.start} onChange={(event) => updateMapDecoration("start", Math.min(sceneDuration, Math.max(0, Number(event.target.value) || 0)))} /><b>s</b></div></label>
                        <label className="field"><TimeFieldLabel hint="Độ dài tương đối của hiệu ứng, tính từ mốc bắt đầu.">Thời lượng</TimeFieldLabel><div className="number-with-unit"><input type="number" min="0.1" max={sceneDuration} step="0.1" value={Math.min(sceneDuration, activeDecoration.duration)} onChange={(event) => updateMapDecoration("duration", Math.min(sceneDuration, Math.max(0.1, Number(event.target.value) || 0.1)))} /><b>s</b></div></label>
                      </div>
                      <div className="field text-position-readout"><span>Vị trí hiện tại</span><b>X {Math.round(activeDecoration.x)}% · Y {Math.round(activeDecoration.y)}%</b></div>
                    </div>
                  )}
                </div>
                </EditorFieldGroup>
              </div>
            </details>
            <details
              className="editor-accordion editor-accordion-audio"
              data-editor-section="audio"
              open={editorSections.audio}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setEditorSectionOpen("audio", open);
              }}
            >
              <summary className="editor-group-label">
                <span>05</span><strong>Âm thanh</strong>{editorSectionActions("audio")}<i />
              </summary>
              <div className="editor-accordion-content">
            <EditorFieldGroup title="Nhạc nền" description="Nhạc dùng chung cho video và mức âm lượng phát nền.">
            <label className="field audio-field" id="editor-music">
              <FieldLabel hint="Có thể nhập URL, tên file hoặc chọn file âm thanh từ máy.">Nhạc nền chủ đề</FieldLabel>
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
                <FieldLabel hint="Mức âm lượng của nhạc nền so với âm lượng gốc.">Âm lượng nhạc nền</FieldLabel>
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
            </EditorFieldGroup>
            <EditorFieldGroup
              title="Thuyết minh & âm thanh cảnh"
              description="Nội dung dùng tạo phụ đề và các track âm thanh phát độc lập trong cảnh."
              action={(
                <button type="button" className="scene-audio-add-button" onClick={() => addSceneAudioTrack()}>
                  ＋ Thêm âm thanh
                </button>
              )}
            >
            <label className="field narration-field" id="editor-narration">
              <FieldLabel hint="Văn bản này được dùng để tạo và căn thời gian phụ đề.">Lời thuyết minh dùng để tạo phụ đề</FieldLabel>
              <textarea
                rows={4}
                value={scene.narration}
                placeholder="Nhập nguyên văn nội dung của file audio…"
                onChange={(event) => updateScene("narration", event.target.value)}
              />
              <small>Nội dung này được dùng để Whisper/fallback tạo timestamp phụ đề. Có thể khác với lời thuyết minh ghi chú trong Popup.</small>
            </label>
            <div className="scene-audio-editor" id="editor-audio">
              <div className="scene-audio-list-heading">
                <div>
                  <strong>{sceneAudioTracks.length} âm thanh</strong>
                  <small>Track đầu tiên được dùng để tạo phụ đề; tất cả track đang hiện sẽ được phát và render.</small>
                </div>
              </div>
              {sceneAudioTracks.length ? (
                <div className="scene-audio-list">
                  {sceneAudioTracks.map((track, index) => {
                    const inputKey = sceneAudioTrackKey(scene.id, track.id);
                    const previewSource = audioTrackPreviewSource(track, index);
                    return (
                      <article key={track.id} className={`scene-audio-item ${track.visible === false ? "is-hidden" : ""}`}>
                        <header className="scene-audio-item-heading">
                          <span className="scene-audio-item-index">{String(index + 1).padStart(2, "0")}</span>
                          <div className="scene-audio-item-title">
                            {renamingAudioTrackId === track.id ? (
                              <input
                                type="text"
                                value={renamingAudioTrackName}
                                autoFocus
                                aria-label="Tên âm thanh"
                                onChange={(event) => setRenamingAudioTrackName(event.target.value)}
                                onBlur={finishSceneAudioTrackRename}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    finishSceneAudioTrackRename();
                                  } else if (event.key === "Escape") {
                                    event.preventDefault();
                                    cancelSceneAudioTrackRename();
                                  }
                                }}
                              />
                            ) : (
                              <strong>{safeTrim(track.name) || `Âm thanh ${index + 1}`}</strong>
                            )}
                            <small>{index === 0 ? "Dùng tạo phụ đề" : fileNameOnly(track.source) || "Chưa chọn file"}</small>
                          </div>
                          <div className="scene-audio-item-actions">
                            <button type="button" onClick={() => startSceneAudioTrackRename(track, index)} title="Đổi tên âm thanh" aria-label="Đổi tên âm thanh">✎</button>
                            <button
                              type="button"
                              className={track.visible === false ? "is-off" : ""}
                              onClick={() => updateSceneAudioTrack(track.id, "visible", track.visible === false)}
                              title={track.visible === false ? "Hiện âm thanh trong Preview và video" : "Ẩn âm thanh khỏi Preview và video"}
                              aria-label={track.visible === false ? "Hiện âm thanh" : "Ẩn âm thanh"}
                            >
                              {track.visible === false ? "◌" : "◉"}
                            </button>
                            <button type="button" className="danger" onClick={() => deleteSceneAudioTrack(track.id)} title="Xóa âm thanh" aria-label="Xóa âm thanh">×</button>
                          </div>
                        </header>

                        <label className="field audio-field">
                          <FieldLabel hint="Có thể nhập URL, tên file hoặc chọn file âm thanh từ máy.">URL hoặc file âm thanh</FieldLabel>
                          <div className="audio-input-row">
                            <input
                              type="text"
                              inputMode="url"
                              value={track.source}
                              placeholder="audio.mp3 hoặc https://example.com/audio.mp3"
                              onChange={(event) => {
                                updateSceneAudioTrack(track.id, "source", event.target.value);
                                setAudioFiles((items) => {
                                  const next = { ...items };
                                  delete next[inputKey];
                                  if (index === 0) delete next[scene.id];
                                  return next;
                                });
                                setAudioPreview((items) => {
                                  const next = { ...items };
                                  if (next[inputKey]) URL.revokeObjectURL(next[inputKey]);
                                  delete next[inputKey];
                                  if (index === 0 && next[scene.id]) {
                                    URL.revokeObjectURL(next[scene.id]);
                                    delete next[scene.id];
                                  }
                                  return next;
                                });
                              }}
                            />
                            <label className="file-picker">
                              Chọn file
                              <input
                                type="file"
                                accept="audio/*"
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  event.currentTarget.value = "";
                                  if (!file) return;
                                  updateSceneAudioTrack(track.id, "source", `audio/${file.name}`);
                                  setAudioFiles((items) => ({ ...items, [inputKey]: file }));
                                  void addAssetsToLibrary([file]);
                                  setAudioPreview((items) => {
                                    if (items[inputKey]) URL.revokeObjectURL(items[inputKey]);
                                    return { ...items, [inputKey]: URL.createObjectURL(file) };
                                  });
                                }}
                              />
                            </label>
                          </div>
                        </label>

                        <div className="scene-audio-timing-grid">
                          <label className="field">
                            <span>Cường độ âm thanh</span>
                            <div className="number-with-unit"><input type="number" step="1" value={track.volume} onChange={(event) => updateSceneAudioTrack(track.id, "volume", Number(event.target.value))} /><b>%</b></div>
                          </label>
                          <label className="field">
                            <TimeFieldLabel hint="Mốc tính từ đầu cảnh; 0 giây nghĩa là phát ngay.">Bắt đầu</TimeFieldLabel>
                            <div className="number-with-unit"><input type="number" step="0.1" value={track.start} onChange={(event) => updateSceneAudioTrack(track.id, "start", Number(event.target.value))} /><b>s</b></div>
                          </label>
                          <label className="field">
                            <TimeFieldLabel hint="Âm thanh sẽ dừng tại mốc này, kể cả khi file gốc còn dài.">Kết thúc</TimeFieldLabel>
                            <div className="number-with-unit"><input type="number" step="0.1" value={track.end} onChange={(event) => updateSceneAudioTrack(track.id, "end", Number(event.target.value))} /><b>s</b></div>
                          </label>
                        </div>
                        {previewSource && <audio className="audio-preview" controls preload="metadata" src={previewSource} />}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="scene-audio-empty">
                  <strong>Cảnh chưa có âm thanh</strong>
                  <span>Bấm “Thêm âm thanh” để tạo track đầu tiên.</span>
                  <button type="button" className="button" onClick={() => addSceneAudioTrack()}>＋ Thêm âm thanh</button>
                </div>
              )}
            </div>
            </EditorFieldGroup>
            <EditorFieldGroup title="Phụ đề" description="Tạo, nhập và rà soát timestamp của từng câu.">
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
                    disabled={subtitleAlignState.status === "running" || subtitleImportBusy}
                  >
                    {subtitleAlignState.status === "running" && subtitleAlignState.sceneId === scene.id
                      ? "Đang tạo…"
                      : "✦ Tạo từ lời thuyết minh"}
                  </button>
                  <button
                    type="button"
                    className="button subtitle-add-button"
                    onClick={() => subtitleFileInput.current?.click()}
                    disabled={subtitleImportBusy || subtitleAlignState.status === "running"}
                  >
                    {subtitleImportBusy ? "Đang đọc…" : "⇧ Import SRT/VTT"}
                  </button>
                  <input
                    ref={subtitleFileInput}
                    className="visually-hidden"
                    type="file"
                    accept=".srt,.vtt,application/x-subrip,text/vtt,text/plain"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void importSubtitlesFromFile(file);
                    }}
                    aria-label="Chọn file phụ đề SRT hoặc VTT"
                  />
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
                <span>Hoặc import <b>SRT/VTT</b> đã có timestamp</span>
                <span>4. Phát từng cue để rà soát</span>
              </div>
              {subtitleAlignState.sceneId === scene.id && subtitleAlignState.message && (
                <>
                  {subtitleAlignState.status === "running" && (
                    <div
                      className="subtitle-align-progress"
                      role="status"
                      aria-label={`Tiến độ tạo phụ đề ${subtitleAlignState.progress ?? 0}%`}
                    >
                      <div className="subtitle-align-progress-heading">
                        <span>Tiến độ xử lý</span>
                        <b>{subtitleAlignState.progress ?? 0}%</b>
                      </div>
                      <div
                        className="subtitle-align-progress-track"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={subtitleAlignState.progress ?? 0}
                      >
                        <i style={{ width: `${subtitleAlignState.progress ?? 0}%` }} />
                      </div>
                    </div>
                  )}
                  <p className={`subtitle-align-status is-${subtitleAlignState.status}`} role="status">
                  {subtitleAlignState.message}
                  </p>
                </>
              )}
              <EditorFieldGroup title="Kiểu chữ phụ đề" description="Font, màu, nền, vị trí và hiệu ứng xuất hiện dùng chung cho các cue." advanced>
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
                <div className="field-row subtitle-style-fields subtitle-geometry-fields">
                  <label className="field">
                    <span>Vị trí X</span>
                    <div className="number-with-unit"><input type="number" min="0" max="100" step="0.1" value={subtitleStyle.x} onChange={(event) => updateSubtitleStyle("x", clampPercent(event.target.value, subtitleStyle.x))} /><b>%</b></div>
                  </label>
                  <label className="field">
                    <span>Vị trí Y</span>
                    <div className="number-with-unit"><input type="number" min="0" max="100" step="0.1" value={subtitleStyle.y} onChange={(event) => updateSubtitleStyle("y", clampPercent(event.target.value, subtitleStyle.y))} /><b>%</b></div>
                  </label>
                  <label className="field">
                    <span>Chiều cao khung chữ</span>
                    <div className="number-with-unit"><input type="number" min="3" max="40" step="0.1" value={subtitleStyle.boxHeight ?? ""} placeholder="Tự động" onChange={(event) => updateSubtitleStyle("boxHeight", event.target.value === "" ? undefined : Math.min(40, Math.max(3, Number(event.target.value) || 3)))} /><b>%</b></div>
                  </label>
                </div>
                <small>Chỉ hiện vùng chỉnh sửa này sau khi bấm “Xem thử”. Có thể kéo khung hoặc nhập trực tiếp X/Y, rộng/cao.</small>
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
              </EditorFieldGroup>
              <div className="field-row subtitle-global-timing-row">
                <label className="field">
                  <TimeFieldLabel hint="Mốc tuyệt đối tính từ đầu cảnh; toàn bộ cue phụ đề được dịch bắt đầu từ thời điểm này.">Thời gian bắt đầu phát tất cả phụ đề</TimeFieldLabel>
                  <div className="number-with-unit">
                    <input
                      type="number"
                      min="0"
                      max={sceneDuration}
                      step="0.1"
                      value={scene.subtitleStart}
                      disabled={!hydrated}
                      onChange={(event) => updateScene(
                        "subtitleStart",
                        Math.min(sceneDuration, Math.max(0, Number(event.target.value) || 0)),
                      )}
                    />
                    <b>s</b>
                  </div>
                  <small>Dịch toàn bộ cue phụ đề theo thời gian này; thời gian bắt đầu/kết thúc từng câu vẫn giữ nguyên.</small>
                </label>
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
                          <TimeFieldLabel hint="Mốc của câu phụ đề tính từ mốc bắt đầu phụ đề của cảnh.">Bắt đầu</TimeFieldLabel>
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
                          <TimeFieldLabel hint="Mốc kết thúc của câu phụ đề tính từ mốc bắt đầu phụ đề của cảnh.">Kết thúc</TimeFieldLabel>
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
            </EditorFieldGroup>
              </div>
            </details>
            <details
              className="editor-accordion editor-accordion-effects"
              data-editor-section="effects"
              open={editorSections.effects}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setEditorSectionOpen("effects", open);
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
                  {zoomEnabled && (
                    <>
                  <div className="field-row zoom-settings-fields">
                    <label className="field">
                      <TimeFieldLabel hint="Mốc tuyệt đối tính từ đầu cảnh; hiệu ứng zoom bắt đầu từ thời điểm này.">Thời gian bắt đầu zoom</TimeFieldLabel>
                      <div className="number-with-unit">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={zoomInputValue("zoomStart", scene.zoomStart)}
                          disabled={!zoomEnabled}
                          onChange={(event) => updateZoomInput("zoomStart", event.target.value)}
                          onBlur={() => commitZoomInput("zoomStart")}
                        />
                        <b>giây</b>
                      </div>
                    </label>
                    <label className="field">
                      <span>Tỉ lệ zoom</span>
                      <div className="number-with-unit">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={zoomInputValue("zoom", scene.zoom)}
                          disabled={!zoomEnabled}
                          onChange={(event) => updateZoomInput("zoom", event.target.value)}
                          onBlur={() => commitZoomInput("zoom")}
                        />
                        <b>×</b>
                      </div>
                    </label>
                    <label className="field">
                      <TimeFieldLabel hint="Mốc tuyệt đối tính từ đầu cảnh; hiệu ứng zoom hoàn tất tại thời điểm này.">Thời gian kết thúc zoom</TimeFieldLabel>
                      <div className="number-with-unit">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={zoomInputValue("zoomEnd", scene.zoomEnd)}
                          disabled={!zoomEnabled}
                          onChange={(event) => updateZoomInput("zoomEnd", event.target.value)}
                          onBlur={() => commitZoomInput("zoomEnd")}
                        />
                        <b>giây</b>
                      </div>
                    </label>
                    <label className="field">
                      <TimeFieldLabel hint="Độ dài tương đối của chuyển động zoom vào, tính từ mốc bắt đầu zoom.">Thời gian tới tỉ lệ đó</TimeFieldLabel>
                      <div className="number-with-unit">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={zoomInputValue("zoomInDuration", scene.zoomInDuration)}
                          disabled={!zoomEnabled}
                          onChange={(event) => updateZoomInput("zoomInDuration", event.target.value)}
                          onBlur={() => commitZoomInput("zoomInDuration")}
                        />
                        <b>giây</b>
                      </div>
                    </label>
                    <label className="field">
                      <TimeFieldLabel hint="Độ dài tương đối của chuyển động zoom về, tính lùi từ mốc kết thúc zoom.">Khoảng thời gian zoom về</TimeFieldLabel>
                      <div className="number-with-unit">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={zoomInputValue("zoomOutDuration", scene.zoomOutDuration)}
                          disabled={!zoomEnabled}
                          onChange={(event) => updateZoomInput("zoomOutDuration", event.target.value)}
                          onBlur={() => commitZoomInput("zoomOutDuration")}
                        />
                        <b>giây</b>
                      </div>
                    </label>
                  </div>
                  <small className="zoom-settings-help">Vòng tròn màu vàng trên bản đồ chỉ là tay nắm chọn vị trí, không xuất hiện trong video.</small>
                    </>
                  )}
                </div>
                <EditorFieldGroup title="Hiệu ứng môi trường" description="Tối viền, thời tiết và ánh sáng phụ trợ cho cảnh." advanced>
                <div className="scene-visual-effect-card scene-start-dark-effect-card" aria-label="Hiệu ứng tối dần từ ngoài vào trong">
                  <div className="scene-visual-effect-heading scene-start-dark-panel-heading">
                    <div>
                      <strong>Tối dần từ ngoài vào trong</strong>
                      <span>Viền tối lan dần vào tâm cảnh, giống hiệu ứng kết thúc phim.</span>
                    </div>
                    <button type="button" className="button secondary scene-start-dark-add" onClick={addSceneDarkEffect} disabled={!hydrated}>＋ Thêm hiệu ứng tối</button>
                  </div>
                  <div className="scene-start-dark-list">
                    {sceneEffects.sceneStartDarkEffects.length > 0 ? sceneEffects.sceneStartDarkEffects.map((effect, index) => (
                      <div className="scene-start-dark-effect-item" key={effect.id}>
                        <div className="scene-start-dark-effect-item-heading">
                          <strong>Hiệu ứng tối {index + 1}</strong>
                          <button type="button" className="scene-start-dark-delete" onClick={() => deleteSceneDarkEffect(effect.id)} aria-label={`Xóa hiệu ứng tối ${index + 1}`} title="Xóa hiệu ứng tối">×</button>
                        </div>
                        <label className="zoom-effect-toggle">
                          <input
                            type="checkbox"
                            checked={effect.enabled}
                            disabled={!hydrated}
                            onChange={(event) => updateSceneDarkEffect(effect.id, "enabled", event.target.checked)}
                          />
                          <span aria-hidden="true" />
                          <span>Bật hiệu ứng tối này</span>
                        </label>
                        {effect.enabled && (
                          <>
                        <div className="field-row scene-start-dark-time-row">
                          <label className="field">
                            <TimeFieldLabel hint="Mốc tuyệt đối tính từ đầu cảnh; hiệu ứng tối bắt đầu từ thời điểm này.">Thời gian bắt đầu</TimeFieldLabel>
                            <div className="number-with-unit">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={darkEffectInputValue(effect, "start")}
                                disabled={!hydrated || !effect.enabled}
                                onChange={(event) => updateSceneDarkEffectInput(effect, "start", event.target.value)}
                                onBlur={() => commitSceneDarkEffectInput(effect, "start")}
                              />
                              <b>giây</b>
                            </div>
                          </label>
                          <label className="field">
                            <TimeFieldLabel hint="Mốc tuyệt đối tính từ đầu cảnh; hiệu ứng tối kết thúc tại thời điểm này.">Thời gian kết thúc</TimeFieldLabel>
                            <div className="number-with-unit">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={darkEffectInputValue(effect, "end")}
                                disabled={!hydrated || !effect.enabled}
                                onChange={(event) => updateSceneDarkEffectInput(effect, "end", event.target.value)}
                                onBlur={() => commitSceneDarkEffectInput(effect, "end")}
                              />
                              <b>giây</b>
                            </div>
                          </label>
                          <label className="field">
                            <TimeFieldLabel hint="Độ dài tương đối phần giữ nguyên mức tối, nằm trong khoảng bắt đầu đến kết thúc.">Thời gian giữ tối</TimeFieldLabel>
                            <div className="number-with-unit">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={darkEffectInputValue(effect, "holdDuration")}
                                disabled={!hydrated || !effect.enabled}
                                onChange={(event) => updateSceneDarkEffectInput(effect, "holdDuration", event.target.value)}
                                onBlur={() => commitSceneDarkEffectInput(effect, "holdDuration")}
                              />
                              <b>giây</b>
                            </div>
                          </label>
                        </div>
                        <label className="field scene-start-dark-intensity-field">
                          <span>Cường độ tối (số lớn sẽ sáng hơn)</span>
                          <div className="number-with-unit">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={darkEffectInputValue(effect, "intensity")}
                              disabled={!hydrated || !effect.enabled}
                              onChange={(event) => updateSceneDarkEffectInput(effect, "intensity", event.target.value)}
                              onBlur={() => commitSceneDarkEffectInput(effect, "intensity")}
                            />
                            <b>%</b>
                          </div>
                          <small>0% là tối mạnh nhất, 100% là giảm tối tối đa; sau khi tối hẳn, hiệu ứng sẽ giữ theo thời gian đã nhập rồi mới reverse.</small>
                        </label>
                          </>
                        )}
                      </div>
                    )) : (
                      <div className="scene-start-dark-empty">Chưa có hiệu ứng tối. Bấm “Thêm hiệu ứng tối” để tạo một lớp.</div>
                    )}
                  </div>
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
                      {sceneEffects.snowEnabled && (
                      <div className="field-row">
                        <label className="field">
                          <span>Cường độ</span>
                          <div className="number-with-unit">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={effectInputValue("snowIntensity", sceneEffects.snowIntensity)}
                              disabled={!sceneEffects.snowEnabled}
                              onChange={(event) => updateEffectInput("snowIntensity", event.target.value)}
                              onBlur={() => commitEffectInput("snowIntensity")}
                            />
                            <b>%</b>
                          </div>
                        </label>
                        <label className="field">
                          <span>Tốc độ</span>
                          <div className="number-with-unit">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={effectInputValue("snowSpeed", sceneEffects.snowSpeed)}
                              disabled={!sceneEffects.snowEnabled}
                              onChange={(event) => updateEffectInput("snowSpeed", event.target.value)}
                              onBlur={() => commitEffectInput("snowSpeed")}
                            />
                            <b>×</b>
                          </div>
                        </label>
                      </div>
                      )}
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
                      {sceneEffects.lightFlickerEnabled && (
                      <div className="field-row">
                        <label className="field">
                          <span>Cường độ</span>
                          <div className="number-with-unit">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={effectInputValue("lightFlickerIntensity", sceneEffects.lightFlickerIntensity)}
                              disabled={!sceneEffects.lightFlickerEnabled}
                              onChange={(event) => updateEffectInput("lightFlickerIntensity", event.target.value)}
                              onBlur={() => commitEffectInput("lightFlickerIntensity")}
                            />
                            <b>%</b>
                          </div>
                        </label>
                        <label className="field">
                          <span>Tốc độ</span>
                          <div className="number-with-unit">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={effectInputValue("lightFlickerSpeed", sceneEffects.lightFlickerSpeed)}
                              disabled={!sceneEffects.lightFlickerEnabled}
                              onChange={(event) => updateEffectInput("lightFlickerSpeed", event.target.value)}
                              onBlur={() => commitEffectInput("lightFlickerSpeed")}
                            />
                            <b>×</b>
                          </div>
                        </label>
                      </div>
                      )}
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
                      {sceneEffects.rainEnabled && (
                      <div className="field-row">
                        <label className="field">
                          <span>Cường độ</span>
                          <div className="number-with-unit">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={effectInputValue("rainIntensity", sceneEffects.rainIntensity)}
                              disabled={!sceneEffects.rainEnabled}
                              onChange={(event) => updateEffectInput("rainIntensity", event.target.value)}
                              onBlur={() => commitEffectInput("rainIntensity")}
                            />
                            <b>%</b>
                          </div>
                        </label>
                        <label className="field">
                          <span>Tốc độ</span>
                          <div className="number-with-unit">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={effectInputValue("rainSpeed", sceneEffects.rainSpeed)}
                              disabled={!sceneEffects.rainEnabled}
                              onChange={(event) => updateEffectInput("rainSpeed", event.target.value)}
                              onBlur={() => commitEffectInput("rainSpeed")}
                            />
                            <b>×</b>
                          </div>
                        </label>
                      </div>
                      )}
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
                      {sceneEffects.thunderEnabled && (
                      <div className="field-row">
                        <label className="field">
                          <span>Cường độ</span>
                          <div className="number-with-unit">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={effectInputValue("thunderIntensity", sceneEffects.thunderIntensity)}
                              disabled={!sceneEffects.thunderEnabled}
                              onChange={(event) => updateEffectInput("thunderIntensity", event.target.value)}
                              onBlur={() => commitEffectInput("thunderIntensity")}
                            />
                            <b>%</b>
                          </div>
                        </label>
                        <label className="field">
                          <span>Tốc độ</span>
                          <div className="number-with-unit">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={effectInputValue("thunderSpeed", sceneEffects.thunderSpeed)}
                              disabled={!sceneEffects.thunderEnabled}
                              onChange={(event) => updateEffectInput("thunderSpeed", event.target.value)}
                              onBlur={() => commitEffectInput("thunderSpeed")}
                            />
                            <b>×</b>
                          </div>
                        </label>
                      </div>
                      )}
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
                      {sceneEffects.cloudEnabled && (
                      <div className="field-row">
                        <label className="field">
                          <span>Cường độ</span>
                          <div className="number-with-unit">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={effectInputValue("cloudIntensity", sceneEffects.cloudIntensity)}
                              disabled={!sceneEffects.cloudEnabled}
                              onChange={(event) => updateEffectInput("cloudIntensity", event.target.value)}
                              onBlur={() => commitEffectInput("cloudIntensity")}
                            />
                            <b>%</b>
                          </div>
                        </label>
                        <label className="field">
                          <span>Tốc độ</span>
                          <div className="number-with-unit">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={effectInputValue("cloudSpeed", sceneEffects.cloudSpeed)}
                              disabled={!sceneEffects.cloudEnabled}
                              onChange={(event) => updateEffectInput("cloudSpeed", event.target.value)}
                              onBlur={() => commitEffectInput("cloudSpeed")}
                            />
                            <b>×</b>
                          </div>
                        </label>
                      </div>
                      )}
                    </div>
                  </div>
                  <small className="zoom-settings-help">Các hiệu ứng được áp dụng cho cảnh đang chọn và xuất cùng thông số trong JSON render.</small>
                </EditorFieldGroup>
              </div>
            </details>
            <details
              className="editor-accordion editor-accordion-popup"
              data-editor-section="popup"
              open={editorSections.popup}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setEditorSectionOpen("popup", open);
              }}
            >
              <summary className="editor-group-label">
                <span>07</span><strong>Popup</strong>{editorSectionActions("popup")}<i />
              </summary>
              <div className="editor-accordion-content">
            <EditorFieldGroup title="Danh sách popup" description="Chọn popup để chỉnh, kéo để đổi thứ tự hoặc dùng các nút thao tác nhanh.">
            <div className="popup-manager" aria-label="Danh sách popup trong cảnh">
              <div className="popup-manager-heading">
                <strong>{scenePopups.length} popup{scenePopups.length > 1 ? "s" : ""}</strong>
                <button type="button" className="button popup-add-button" onClick={addPopup}>＋ Thêm popup</button>
              </div>
              <div className="popup-manager-list">
                {scenePopups.map((popup, index) => (
                  <div
                    key={popup.id}
                    id={`editor-layer-popup-${popup.id}`}
                    tabIndex={-1}
                    aria-selected={popup.id === activePopup?.id}
                    className={`popup-manager-item ${popup.id === activePopup?.id ? "active" : ""} ${popup.visible === false ? "is-hidden" : ""} ${popup.editorVisible === false ? "is-editor-hidden" : ""} ${layerListDrag.overId === popup.id && layerListDrag.type === "popup" ? "is-drag-over" : ""}`}
                    onDragOver={(event) => updateLayerListDragOver("popup", popup.id, event)}
                    onDrop={(event) => finishLayerListDrop("popup", popup.id, event)}
                  >
                    <span
                      className="layer-drag-handle"
                      draggable
                      role="button"
                      tabIndex={0}
                      title="Kéo để sắp xếp Popup"
                      aria-label={`Kéo để sắp xếp Popup ${index + 1}`}
                      onDragStart={(event) => beginLayerListDrag("popup", popup.id, event)}
                      onDragEnd={clearLayerListDrag}
                    >⠿</span>
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
                      className={`popup-visibility-button editor-layer-visibility ${popup.editorVisible === false ? "is-hidden" : ""}`}
                      aria-label={popup.editorVisible === false ? `Hiện Popup ${index + 1} khi biên soạn` : `Ẩn Popup ${index + 1} khi biên soạn`}
                      title={popup.editorVisible === false ? `Hiện Popup ${index + 1} khi biên soạn` : `Ẩn Popup ${index + 1} khi biên soạn`}
                      onClick={() => togglePopupEditorVisibility(popup.id)}
                    >
                      {editorVisibilityIcon(popup.editorVisible === false)}
                    </button>
                    <button
                      type="button"
                      className="popup-size-reset"
                      aria-label={`Đặt lại kích thước Popup ${index + 1}`}
                      title="Đặt lại kích thước Popup về mặc định"
                      onClick={() => resetPopupSize(popup.id)}
                    >
                      ↺
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
              <small className="popup-size-help">Trong khung xem trước, kéo vạch xanh ở cuối Hình ảnh hoặc Nội dung để chỉnh riêng chiều cao. Nút ↺ sẽ đặt lại kích thước mặc định.</small>
            </div>
            </EditorFieldGroup>
            {activePopup ? (
            <div className="popup-motion-settings-card" id="editor-popup">
              <div className="motion-settings-title">
                <strong>Popup {Math.max(1, scenePopups.findIndex((item) => item.id === activePopup?.id) + 1)}</strong>
                <span>Thời gian và hiệu ứng xuất hiện</span>
              </div>
              <EditorFieldGroup title="Nội dung" description="Tiêu đề, mô tả và lời thuyết minh của popup.">
              <label className="field">
                <FieldLabel hint="Dòng tiêu đề nổi bật ở đầu popup.">Tiêu đề</FieldLabel>
                <input
                  value={activePopup?.title ?? ""}
                  onChange={(event) => updatePopup("title", event.target.value)}
                />
              </label>
              <label className="field">
                <FieldLabel hint="Phần mô tả chính hiển thị bên trong popup.">Nội dung cảnh</FieldLabel>
                <textarea
                  value={activePopup?.body ?? ""}
                  onChange={(event) => updatePopup("body", event.target.value)}
                />
                <small>{(activePopup?.body ?? "").length}/180 ký tự</small>
              </label>
              <label className="field">
                <FieldLabel hint="Ghi chú lời đọc riêng của popup; không thay thế file âm thanh của cảnh.">Lời thuyết minh</FieldLabel>
                <textarea
                  value={activePopup?.narration ?? ""}
                  onChange={(event) => updatePopup("narration", event.target.value)}
                />
                <small>{popupWordCount} từ · Ước tính {popupVoiceEstimate} giây</small>
              </label>
              </EditorFieldGroup>
              <EditorFieldGroup title="Thiết kế" description="Bố cục, màu sắc, hiệu ứng chữ và đường viền." advanced>
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
                <FieldLabel hint="Đặt bằng 0 để tắt đường viền popup.">Độ dày viền popup</FieldLabel>
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
              </EditorFieldGroup>
              <EditorFieldGroup title="Vị trí & kích thước" description="Có thể kéo popup và tay nắm trong Xem trước để cập nhật tự động." advanced>
              <div className="field-row popup-geometry-fields">
                <label className="field">
                  <span>Vị trí X</span>
                  <div className="number-with-unit"><input type="number" min="0" max="100" step="0.1" value={activePopup?.x ?? 5} onChange={(event) => updatePopup("x", clampPercent(event.target.value, activePopup?.x ?? 5))} /><b>%</b></div>
                </label>
                <label className="field">
                  <span>Vị trí Y</span>
                  <div className="number-with-unit"><input type="number" min="0" max="100" step="0.1" value={activePopup?.y ?? 55} onChange={(event) => updatePopup("y", clampPercent(event.target.value, activePopup?.y ?? 55))} /><b>%</b></div>
                </label>
              </div>
              <div className="field-row popup-geometry-fields">
                <label className="field">
                  <span>Chiều rộng</span>
                  <div className="number-with-unit"><input type="number" min="55" max="96" step="1" value={activePopup?.width ?? 90} onChange={(event) => updatePopup("width", Math.min(96, Math.max(55, Number(event.target.value) || 55)))} /><b>%</b></div>
                </label>
                <label className="field">
                  <span>Chiều cao</span>
                  <div className="number-with-unit"><input type="number" min="170" max="440" step="1" value={activePopup?.height ?? 255} onChange={(event) => updatePopupHeight(Number(event.target.value), activePopup?.id)} /><b>px</b></div>
                </label>
              </div>
              <small className="popup-geometry-help">Kéo Popup hoặc nút ở góc để các thông số này tự cập nhật.</small>
              </EditorFieldGroup>
              {(activePopup?.layout ?? "image-top") !== "content-only" && (
              <EditorFieldGroup title="Ảnh / video" description="Media minh họa riêng của popup.">
              <label className="field popup-image-field">
                <FieldLabel hint="Có thể nhập URL hoặc tên file ảnh/video trong thư viện tài nguyên.">Ảnh / video popup riêng</FieldLabel>
                <input
                  type="text"
                  inputMode="url"
                  placeholder="https://example.com/image.jpg hoặc https://example.com/video.mp4"
                  value={activePopupMediaValue}
                  onChange={(event) => updatePopupMedia(event.target.value)}
                />
                {Boolean(activePopupMediaValue) && (
                  <label className="popup-transparent-toggle">
                    <input type="checkbox" checked={activePopup?.transparentMedia === true} onChange={(event) => updatePopup("transparentMedia", event.target.checked)} />
                    <span />
                    Giữ nền trong suốt cho ảnh / video popup
                  </label>
                )}
              </label>
              </EditorFieldGroup>
              )}
              <EditorFieldGroup title="Thời gian hiển thị" description="Mốc bắt đầu và độ dài popup trong cảnh.">
              <label className="field">
                <TimeFieldLabel hint="Mốc tuyệt đối tính từ đầu cảnh; popup bắt đầu xuất hiện từ thời điểm này.">Thời gian bắt đầu xuất hiện popup</TimeFieldLabel>
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
                <TimeFieldLabel hint="Độ dài tương đối của popup, tính từ mốc bắt đầu xuất hiện.">Thời gian popup</TimeFieldLabel>
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
              <div className="editor-field-feedback" role="status">
                Hiển thị từ {formatTime(activePopup?.start ?? 0)} đến {formatTime(Math.min(sceneDuration, (activePopup?.start ?? 0) + (activePopup?.duration ?? 0.1)))} · tổng {formatTime(activePopup?.duration ?? 0.1)}
              </div>
              </EditorFieldGroup>
              <EditorFieldGroup title="Hiệu ứng mở & đóng" description="Cách popup xuất hiện và biến mất trong video." advanced>
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
              </EditorFieldGroup>
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
            <span>{projectDuration} giây · {visibleScenes.length} cảnh hiện · {renderFps} FPS · Zoom {timelineZoom}% · Cuộn chuột để thu/phóng</span>
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
          <div
            className="timeline-scroll"
            ref={timelineScrollRef}
            role="region"
            tabIndex={0}
            aria-label="Nội dung Timeline có thể cuộn ngang"
            title="Cuộn bánh xe chuột để thu hẹp hoặc dãn Timeline"
            onWheel={handleTimelineWheel}
          >
            <div className="timeline-scroll-content" style={{ minWidth: `${timelineCanvasWidth}px` }}>
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
                <strong>Âm thanh</strong>
                <div className="track-content grid">
                  {narrationEnabled && visibleScenes.flatMap((item) => (item.audioTracks ?? [])
                    .filter((track) => track.visible !== false)
                    .map((track, trackIndex) => {
                      const sceneLength = Math.max(0.1, item.end - item.start);
                      const localStart = Math.min(sceneLength, Math.max(0, Number(track.start) || 0));
                      const localEnd = Math.min(sceneLength, Math.max(localStart + 0.1, Number(track.end) || sceneLength));
                      const globalStart = item.start + localStart;
                      const globalEnd = item.start + localEnd;
                      return (
                        <Fragment key={`${item.id}-${track.id}`}>
                          <button
                            type="button"
                            className="clip voice-clip"
                            onClick={() => openTimelineEditor(item, "editor-audio")}
                            style={{
                              left: timelinePercent(globalStart),
                              width: timelinePercent(globalEnd - globalStart),
                              zIndex: 2 + trackIndex,
                            }}
                            title={`${track.name || `Âm thanh ${trackIndex + 1}`} · ${formatTime(globalStart)} – ${formatTime(globalEnd)} · ${track.volume}%`}
                          >
                            🎙 {track.name || fileNameOnly(track.source) || `Âm thanh ${trackIndex + 1}`}
                          </button>
                          <span className="timeline-boundary timeline-boundary-start" style={{ left: timelinePercent(globalStart) }}>
                            {formatTime(globalStart)}
                          </span>
                          <span className="timeline-boundary timeline-boundary-end" style={{ left: timelinePercent(globalEnd) }}>
                            {formatTime(globalEnd)}
                          </span>
                        </Fragment>
                      );
                    }))}
                </div>
              </div>
              <div className="track effects-track">
                <strong>Hiệu ứng</strong>
                <div className="track-content grid">
                  {timelineEffectItems.length ? timelineEffectItems.map((effect) => (
                    <button
                      key={effect.id}
                      type="button"
                      className={`clip effect-clip effect-clip-${effect.kind} ${!playing && effect.scene.id === selectedId ? "selected" : ""}`}
                      style={{
                        left: timelinePercent(effect.start),
                        width: timelinePercent(effect.end - effect.start),
                      }}
                      title={`${effect.label} · ${formatTime(effect.start)} – ${formatTime(effect.end)}`}
                      onClick={() => {
                        openTimelineEditor(effect.scene, "editor-effects");
                        setPlayTime(effect.start);
                      }}
                    >
                      <span className="timeline-clip-label">{effect.label}</span>
                    </button>
                  )) : (
                    <span className="timeline-track-empty">Chưa có hiệu ứng</span>
                  )}
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
                    void refreshLocalResourceCache();
                    void refreshRenderedClips();
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
                      <label className="export-field render-profile-field">
                        <span>Chế độ render</span>
                        <select
                          className="render-profile-select"
                          value={renderProfile}
                          aria-label="Chế độ render"
                          onChange={(event) => setRenderProfile(normalizeRenderProfile(event.target.value))}
                        >
                          <option value="quality">Chất lượng cao</option>
                          <option value="fast">Render nhanh</option>
                        </select>
                        <small className="export-field-hint">
                          {renderProfile === "fast"
                            ? "Giảm độ phân giải, FPS và thời gian encode để xem thử nhanh."
                            : "Giữ nguyên độ phân giải và FPS đang chọn cho bản xuất cuối."}
                        </small>
                      </label>
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

                    <div className="export-section-label">CÀI ĐẶT FFMPEG BẰNG CMD</div>
                    <section className="export-ffmpeg-guide" aria-labelledby="ffmpeg-guide-heading">
                      <div className="export-ffmpeg-guide-heading">
                        <div>
                          <span className="export-card-icon ffmpeg-icon" aria-hidden="true">›_</span>
                          <div>
                            <h3 id="ffmpeg-guide-heading">Chuẩn bị máy để xuất video</h3>
                            <p>Chỉ thiết lập một lần trên mỗi thiết bị Windows.</p>
                          </div>
                        </div>
                        <a href="https://nodejs.org/" target="_blank" rel="noreferrer">Node.js LTS 22+</a>
                      </div>

                      <ol className="export-ffmpeg-steps">
                        <li>
                          <span>01</span>
                          <div>
                            <strong>Mở CMD trong thư mục dự án</strong>
                            <p>Dùng <code>cd /d</code> để đi tới thư mục <b>rendervideo</b> đã tải về.</p>
                            <code className="export-ffmpeg-inline-command">cd /d "C:\duong-dan\rendervideo"</code>
                          </div>
                        </li>
                        <li>
                          <span>02</span>
                          <div>
                            <strong>Cài gói Node và FFmpeg cục bộ</strong>
                            <p>Nếu CMD không nhận lệnh <code>node</code>, hãy cài Node.js LTS rồi mở lại CMD.</p>
                            <div className="export-ffmpeg-command-box">
                              <pre>{FFMPEG_SETUP_COMMANDS}</pre>
                              <button
                                type="button"
                                aria-label="Sao chép lệnh cài FFmpeg"
                                title="Sao chép lệnh cài đặt"
                                onClick={() => void copyFfmpegCommands(FFMPEG_SETUP_COMMANDS, "lệnh cài FFmpeg")}
                              >⧉</button>
                            </div>
                          </div>
                        </li>
                        <li>
                          <span>03</span>
                          <div>
                            <strong>Khởi động dịch vụ render</strong>
                            <p>Chạy lệnh dưới đây và giữ nguyên cửa sổ CMD trong suốt quá trình render.</p>
                            <div className="export-ffmpeg-command-box compact">
                              <pre>{FFMPEG_START_COMMAND}</pre>
                              <button
                                type="button"
                                aria-label="Sao chép lệnh khởi động render"
                                title="Sao chép lệnh khởi động"
                                onClick={() => void copyFfmpegCommands(FFMPEG_START_COMMAND, "lệnh khởi động render")}
                              >⧉</button>
                            </div>
                          </div>
                        </li>
                        <li>
                          <span>04</span>
                          <div>
                            <strong>Kiểm tra kết nối</strong>
                            <p>Mở một CMD khác để kiểm tra, hoặc bấm “Kiểm tra lại” ở panel phía trên.</p>
                            <div className="export-ffmpeg-command-box compact">
                              <pre>{FFMPEG_HEALTH_COMMAND}</pre>
                              <button
                                type="button"
                                aria-label="Sao chép lệnh kiểm tra FFmpeg"
                                title="Sao chép lệnh kiểm tra"
                                onClick={() => void copyFfmpegCommands(FFMPEG_HEALTH_COMMAND, "lệnh kiểm tra FFmpeg")}
                              >⧉</button>
                            </div>
                          </div>
                        </li>
                      </ol>
                      <div className="export-ffmpeg-note">
                        <span aria-hidden="true">i</span>
                        <p><strong>Không cần cài lại mỗi lần.</strong> Những lần sau chỉ chạy <code>npm run render:local</code> trước khi xuất video.</p>
                      </div>
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
                onReorderClips={reorderProjectClips}
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

              <section className={`local-render-detail-card ${localRenderState.status}`} aria-live="polite">
                <div className="local-render-detail-heading">
                  <div>
                    <span className="local-render-detail-kicker">TIẾN TRÌNH CHI TIẾT</span>
                    <strong>{localRenderState.stageLabel || "Đang chuẩn bị"}</strong>
                  </div>
                  <span className="local-render-detail-percent">{Math.round(localRenderState.progress)}%</span>
                </div>
                <ol className="local-render-stage-track" aria-label="Các giai đoạn render">
                  {renderStageSteps.map((step, index) => {
                    const stepState = index < activeRenderStageIndex
                      ? "done"
                      : index === activeRenderStageIndex
                        ? "active"
                        : "";
                    return (
                      <li key={step.key} className={stepState}>
                        <span>{index < activeRenderStageIndex || localRenderState.status === "completed" && index === activeRenderStageIndex ? "✓" : index + 1}</span>
                        <b>{step.label}</b>
                      </li>
                    );
                  })}
                </ol>
                <div className="local-render-detail-grid">
                  <div className="local-render-detail-item local-render-detail-wide">
                    <small>Đang xử lý</small>
                    <strong>{localRenderState.detail || localRenderState.message}</strong>
                  </div>
                  <div className="local-render-detail-item">
                    <small>Cảnh</small>
                    <strong>{localRenderState.scene && localRenderState.totalScenes ? `${localRenderState.scene}/${localRenderState.totalScenes}` : "—"}</strong>
                  </div>
                  <div className="local-render-detail-item">
                    <small>Đã chạy</small>
                    <strong>{formatRenderDuration(localRenderState.elapsedSeconds)}</strong>
                  </div>
                  <div className="local-render-detail-item">
                    <small>Còn lại (ước tính)</small>
                    <strong>{localRenderState.etaSeconds != null ? `~${formatRenderDuration(localRenderState.etaSeconds)}` : "Đang tính…"}</strong>
                  </div>
                  <div className="local-render-detail-item">
                    <small>Thời gian FFmpeg</small>
                    <strong>{localRenderState.mediaDurationSeconds ? `${formatRenderDuration(localRenderState.mediaTimeSeconds)} / ${formatRenderDuration(localRenderState.mediaDurationSeconds)}` : "—"}</strong>
                  </div>
                </div>
              </section>

              {localRenderState.logTail && (localRenderState.status === "uploading" || localRenderState.status === "rendering" || localRenderState.status === "cancelling") && (
                <details className="local-render-log local-render-live-log" open={localRenderState.status === "rendering"}>
                  <summary>Log FFmpeg gần nhất</summary>
                  <pre>{localRenderState.logTail}</pre>
                </details>
              )}

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

              <section className={`local-resource-cache-card ${localResourceCache.status}`} aria-live="polite">
                <div className="local-resource-cache-heading">
                  <div>
                    <h3>Tải trước URL để render nhanh hơn</h3>
                    <p>Tự quét tất cả URL ảnh, video và âm thanh đang dùng trong Biên soạn, rồi lưu vào máy render.</p>
                  </div>
                  <button
                    className="button ghost local-resource-cache-button"
                    type="button"
                    disabled={localResourceCache.status === "syncing" || localRenderState.status === "rendering" || localRenderState.status === "uploading"}
                    onClick={() => void syncLocalResourceCache()}
                  >
                    {localResourceCache.status === "syncing" ? "Đang tải trước…" : "↓ Tải trước URL"}
                  </button>
                </div>
                <div className="local-resource-cache-summary">
                  <strong>{localResourceCache.count} file · {localResourceCacheSize}</strong>
                  {localResourceCache.total > 0 && (
                    <span>{localResourceCache.cached} dùng lại · {localResourceCache.downloaded} tải mới · {localResourceCache.failed} lỗi</span>
                  )}
                </div>
                <p className="local-render-note">{localResourceCache.message} Khi render, URL đã có trong thư viện sẽ được dùng lại thay vì tải lại.</p>
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

              <section className={`rendered-clips-card ${localConcatState.status}`} aria-live="polite">
                <div className="rendered-clips-heading">
                  <div>
                    <h3>Video đã render · Nối nhanh</h3>
                    <p>Render từng cảnh, chọn theo thứ tự mong muốn rồi nối bằng FFmpeg mà không mã hóa lại.</p>
                  </div>
                  <button className="button ghost" type="button" onClick={() => void refreshRenderedClips()}>↻ Làm mới</button>
                </div>

                <div className="rendered-clips-join-bar">
                  <label>
                    <span>Tên video sau khi nối</span>
                    <input
                      value={concatVideoName}
                      onChange={(event) => setConcatVideoName(event.target.value)}
                      placeholder="video-noi"
                    />
                  </label>
                  <div>
                    <strong>{selectedRenderedClips.length} video đã chọn</strong>
                    <small>{selectedRenderedClips.some((clip) => clip.scope === "joined")
                      ? "Video đã nối không dùng để nối nhanh lần nữa; hãy chọn các clip render gốc."
                      : selectedRenderedClips.length > 1 && !selectedRenderedClipsCompatible
                      ? "Các video đang khác cấu hình, chưa thể nối nhanh."
                      : "Thứ tự chọn là thứ tự xuất hiện trong video."}</small>
                  </div>
                  <button
                    className="button primary"
                    type="button"
                    disabled={localConcatState.status === "joining" || selectedRenderedClips.length < 2 || !selectedRenderedClipsCompatible}
                    onClick={() => void startLocalConcat()}
                  >
                    {localConcatState.status === "joining"
                      ? "Đang nối…"
                      : selectedRenderedClips.length ? `⚡ Nối ${selectedRenderedClips.length} video` : "⚡ Nối video"}
                  </button>
                </div>

                {localConcatState.status !== "idle" && (
                  <div className="rendered-clips-progress">
                    <div><strong>{localConcatState.message}</strong><span>{Math.round(localConcatState.progress)}%</span></div>
                    <i style={{ width: `${localConcatState.progress}%` }} />
                    {localConcatState.downloadUrl && <a href={localConcatState.downloadUrl}>↓ Tải video đã nối</a>}
                  </div>
                )}

                {renderedClips.length ? (
                  <ol className="rendered-clips-list">
                    {renderedClips.map((clip) => {
                      const selectionIndex = selectedRenderedClipIds.indexOf(clip.id);
                      const isSelected = selectionIndex >= 0;
                      const scopeLabel = clip.scope === "scene"
                        ? "Cảnh riêng"
                        : clip.scope === "joined" ? "Video đã nối" : "Toàn clip";
                      return (
                        <li key={clip.id} className={isSelected ? "selected" : ""}>
                          <label className="rendered-clip-select">
                            <input type="checkbox" checked={isSelected} onChange={() => toggleRenderedClipSelection(clip.id)} />
                            <span>{isSelected ? selectionIndex + 1 : "·"}</span>
                          </label>
                          <div className="rendered-clip-info">
                            <strong title={clip.name}>{clip.name}</strong>
                            <small>{scopeLabel}{clip.sceneName ? ` · ${clip.sceneName}` : ""} · {formatTime(clip.duration)}</small>
                            <em>{renderClipProfileLabel(clip)}</em>
                          </div>
                          <div className="rendered-clip-actions">
                            {isSelected && <>
                              <button type="button" disabled={selectionIndex === 0} onClick={() => moveSelectedRenderedClip(clip.id, -1)} aria-label="Đưa lên">↑</button>
                              <button type="button" disabled={selectionIndex === selectedRenderedClipIds.length - 1} onClick={() => moveSelectedRenderedClip(clip.id, 1)} aria-label="Đưa xuống">↓</button>
                            </>}
                            <a href={`${LOCAL_RENDERER_URL}${clip.downloadUrl}`} download={clip.name} aria-label={`Tải ${clip.name}`}>⇩</a>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="local-render-note rendered-clips-empty">Chưa có video nào trong thư viện. Hãy render toàn clip hoặc từng cảnh trước.</p>
                )}
                {localConcatState.log && (
                  <details className="local-render-log rendered-clips-log">
                    <summary>Chi tiết lỗi nối video</summary>
                    <pre>{localConcatState.log}</pre>
                  </details>
                )}
              </section>

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
              ) : null}
              {localRenderState.status === "rendering" || localRenderState.status === "cancelling" ? (
                <button
                  className="button settings-danger-button"
                  type="button"
                  disabled={localRenderState.status === "cancelling"}
                  onClick={() => void stopLocalRender()}
                >
                  {localRenderState.status === "cancelling" ? "Đang dừng…" : "Dừng render"}
                </button>
              ) : (
                <>
                  <button
                    className="button ghost local-render-scene-button"
                    disabled={localRenderState.status === "uploading" || localRenderState.status === "cancelling" || localResourceCache.status === "syncing"}
                    onClick={() => void startLocalRender("scene")}
                  >
                    {localRenderState.status === "uploading" ? "Đang chuẩn bị…" : "Render cảnh đang chọn"}
                  </button>
                  <button
                    className="button primary"
                    disabled={localRenderState.status === "uploading" || localRenderState.status === "cancelling" || localResourceCache.status === "syncing"}
                    onClick={() => void startLocalRender("project")}
                  >
                    {localRenderState.status === "uploading" ? "Đang chuẩn bị…" : "Render toàn clip"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {sceneStructureOpen && (
        <div
          className={`scene-structure-overlay scene-structure-${theme}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="scene-structure-heading"
        >
          <section className="scene-structure-shell">
            <header className="scene-structure-topbar">
              <div className="scene-structure-title-wrap">
                <div className="scene-structure-brand-mark" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 8h16v12H4zM4 8l3-4h13l-3 4M8 4l3 4M14 4l3 4" />
                    <path d="M8 13h8M8 16h5" />
                  </svg>
                </div>
                <div>
                  <h1 id="scene-structure-heading">Cấu trúc cảnh</h1>
                  <p>
                    Cảnh {String(sceneStructureScene.number).padStart(2, "0")} · {sceneStructureScene.sceneName || "Cảnh mới"}
                    <i />
                    Thời lượng {formatPreciseTime(sceneStructureDuration)} · {sceneStructureItems.length} tài nguyên
                  </p>
                </div>
              </div>
              <div className="scene-structure-top-actions">
                <span className="scene-structure-sync-state"><i /> Đồng bộ với Biên soạn</span>
                <button
                  type="button"
                  className="scene-structure-theme-toggle"
                  aria-label={theme === "dark" ? "Chuyển Cấu trúc cảnh sang giao diện sáng" : "Chuyển Cấu trúc cảnh sang giao diện tối"}
                  aria-pressed={theme === "light"}
                  title={theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}
                  onClick={() => setTheme((value) => value === "light" ? "dark" : "light")}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    {theme === "dark" ? (
                      <path d="M12 3v2m0 14v2M3 12h2m14 0h2m-3.36-6.64-1.42 1.42M6.78 17.22l-1.42 1.42m0-13.28 1.42 1.42m10.44 10.44 1.42 1.42M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
                    ) : (
                      <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" />
                    )}
                  </svg>
                  <span>{theme === "dark" ? "Sáng" : "Tối"}</span>
                </button>
                <div className="scene-structure-tool-group" role="group" aria-label="Hoàn tác và làm lại">
                  <button
                    type="button"
                    className="scene-structure-tool-button"
                    aria-label="Hoàn tác"
                    title="Hoàn tác (Ctrl+Z)"
                    disabled={!historyPast.current.length}
                    onClick={() => {
                      setPlaying(false);
                      undo();
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7-5 5 5 5M5 12h8a6 6 0 0 1 6 6" /></svg>
                  </button>
                  <button
                    type="button"
                    className="scene-structure-tool-button"
                    aria-label="Làm lại"
                    title="Làm lại (Ctrl+Y)"
                    disabled={!historyFuture.current.length}
                    onClick={() => {
                      setPlaying(false);
                      redo();
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 7 5 5-5 5M19 12h-8a6 6 0 0 0-6 6" /></svg>
                  </button>
                </div>
                <div className="scene-structure-zoom-control" role="group" aria-label="Thu phóng sơ đồ cảnh">
                  <button
                    type="button"
                    aria-label="Thu nhỏ sơ đồ"
                    title="Thu nhỏ sơ đồ"
                    disabled={sceneStructureZoom <= SCENE_STRUCTURE_ZOOM_MIN}
                    onClick={() => adjustSceneStructureZoom(-SCENE_STRUCTURE_ZOOM_STEP)}
                  >
                    −
                  </button>
                  <output aria-label={`Tỷ lệ sơ đồ ${sceneStructureZoom}%`}>{sceneStructureZoom}%</output>
                  <button
                    type="button"
                    aria-label="Phóng to sơ đồ"
                    title="Phóng to sơ đồ"
                    disabled={sceneStructureZoom >= SCENE_STRUCTURE_ZOOM_MAX}
                    onClick={() => adjustSceneStructureZoom(SCENE_STRUCTURE_ZOOM_STEP)}
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className={`scene-structure-play-button ${playing ? "is-playing" : ""}`}
                  onClick={playSceneStructure}
                >
                  <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
                  {playing ? "Tạm dừng" : sceneStructurePreviewMode ? "Tiếp tục" : "Phát thử"}
                </button>
                {sceneStructurePreviewMode && (
                  <button
                    type="button"
                    className="scene-structure-return-button"
                    onClick={returnFromSceneStructurePreview}
                    title="Dừng chạy thử và quay lại mốc đầu cảnh"
                  >
                    ↶ Quay lại
                  </button>
                )}
                <button
                  type="button"
                  className="scene-structure-close-button"
                  aria-label="Đóng Cấu trúc cảnh"
                  title="Đóng Cấu trúc cảnh (Esc)"
                  onClick={closeSceneStructure}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                  <span>Đóng</span>
                </button>
              </div>
            </header>

            <nav className="scene-structure-viewbar" aria-label="Chế độ xem Cấu trúc cảnh">
              <div className="scene-structure-view-tabs" role="tablist">
                {SCENE_STRUCTURE_VIEW_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={sceneStructureViewMode === option.value}
                    className={sceneStructureViewMode === option.value ? "active" : ""}
                    title={option.description}
                    onClick={() => {
                      setPlaying(false);
                      setSceneStructurePreviewMode(false);
                      setSceneStructureViewMode(option.value);
                      setSceneStructureDropTime(null);
                    }}
                  >
                    <span aria-hidden="true">{option.icon}</span>
                    {option.label}
                  </button>
                ))}
              </div>
              <span className="scene-structure-view-hint">
                {SCENE_STRUCTURE_VIEW_OPTIONS.find((option) => option.value === sceneStructureViewMode)?.description}
              </span>
            </nav>

            <div className={`scene-structure-body ${sceneStructureLibraryCollapsed ? "library-collapsed" : ""} ${sceneStructureInspectorCollapsed ? "inspector-collapsed" : ""}`}>
              <aside
                id="scene-structure-library-panel"
                className={`scene-structure-library ${sceneStructureLibraryCollapsed ? "is-collapsed" : ""}`}
                aria-label="Thư viện thành phần cảnh"
              >
                <button
                  type="button"
                  className="scene-structure-panel-toggle scene-structure-panel-toggle-library"
                  aria-label={sceneStructureLibraryCollapsed ? "Hiện Thư viện thẻ" : "Ẩn Thư viện thẻ"}
                  aria-controls="scene-structure-library-panel"
                  aria-expanded={!sceneStructureLibraryCollapsed}
                  title={sceneStructureLibraryCollapsed ? "Hiện Thư viện thẻ" : "Ẩn Thư viện thẻ"}
                  onClick={() => setSceneStructureLibraryCollapsed((value) => !value)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={sceneStructureLibraryCollapsed ? "m9 5 7 7-7 7" : "m15 5-7 7 7 7"} />
                  </svg>
                </button>
                <div className="scene-structure-library-heading">
                  <span>THÊM THÀNH PHẦN</span>
                  <strong>Thư viện thẻ</strong>
                  <p>{sceneStructureViewMode === "timeline" ? "Kéo thẻ vào đúng mốc trên sơ đồ. Bấm thẻ để thêm tại playhead." : "Bấm thẻ để thêm vào cảnh đang chọn; chuyển sang Timeline nếu muốn kéo đến đúng mốc."}</p>
                </div>
                <div className="scene-structure-template-list">
                  {SCENE_STRUCTURE_TEMPLATES.map((template) => (
                    <button
                      type="button"
                      key={template.kind}
                      draggable={false}
                      disabled={sceneStructurePreviewMode}
                      data-draggable={sceneStructureViewMode === "timeline" ? "true" : "false"}
                      className={`scene-structure-template-card scene-structure-template-${template.kind} ${sceneStructureDraggedTemplate === template.kind ? "is-dragging" : ""}`}
                      title={sceneStructureViewMode === "timeline" ? `Kéo để thêm ${template.label} hoặc bấm để thêm tại playhead` : `Bấm để thêm ${template.label} vào cảnh đang chọn`}
                      aria-label={`Thêm ${template.label} vào cảnh đang chọn.`}
                      onClick={() => addSceneStructureTemplateAtPlayhead(template.kind)}
                      onMouseDown={(event) => {
                        if (sceneStructureViewMode === "timeline") beginSceneStructureTemplateMouseDrag(event, template.kind);
                      }}
                      onPointerDown={(event) => {
                        if (sceneStructureViewMode === "timeline") beginSceneStructureTemplatePointerDrag(event, template.kind);
                      }}
                      onPointerMove={moveSceneStructureTemplatePointerDrag}
                      onPointerUp={endSceneStructureTemplatePointerDrag}
                      onPointerCancel={cancelSceneStructureTemplatePointerDrag}
                    >
                      <span className="scene-structure-template-icon" aria-hidden="true">{template.icon}</span>
                      <span className="scene-structure-template-copy">
                        <strong>{template.label}</strong>
                        <small>{template.description}</small>
                      </span>
                      <span className="scene-structure-template-grip" aria-hidden="true">⠿</span>
                    </button>
                  ))}
                </div>
                <div className="scene-structure-library-note">
                  <span aria-hidden="true">↳</span>
                  <p><strong>Đồng bộ tức thì</strong>Thẻ mới xuất hiện trong Biên soạn, Timeline, JSON và Preview.</p>
                </div>
              </aside>
              <div className="scene-structure-flow-panel">
                {sceneStructureViewMode === "timeline" ? (<>
                <div
                  ref={sceneStructureFlowScrollRef}
                  className="scene-structure-flow-scroll"
                  onScroll={syncSceneStructureMinimapViewport}
                >
                  <div
                    ref={sceneStructureFlowContentRef}
                    className={`scene-structure-flow-content ${sceneStructureDropTime !== null ? "is-template-drop-target" : ""}`}
                    style={{
                      minWidth: `${Math.round(1040 * sceneStructureZoom / 100)}px`,
                      minHeight: `${Math.max(620, sceneStructureItems.length * 76 + 178)}px`,
                    }}
                  >
                    <div
                      className="scene-structure-ruler"
                      aria-label="Trục thời gian của cảnh"
                      onPointerMove={(event) => showSceneStructureHoverPreview(event)}
                      onPointerLeave={hideSceneStructureHoverPreview}
                    >
                      {sceneStructureTicks.map((tick) => (
                        <span
                          key={`scene-structure-tick-${tick}`}
                          style={{ left: `${Math.min(100, Math.max(0, tick / sceneStructureDuration * 100))}%` }}
                        >
                          <b>{formatTime(tick)}</b>
                          <i />
                        </span>
                      ))}
                    </div>
                    <div className="scene-structure-phase-row" aria-hidden="true">
                      <span className="scene-structure-phase-opening">MỞ CẢNH</span>
                      <span className="scene-structure-phase-main">NỘI DUNG CHÍNH</span>
                      <span className="scene-structure-phase-ending">KẾT CẢNH</span>
                    </div>
                    <div className="scene-structure-phase-grid" aria-hidden="true">
                      <span /><span /><span />
                    </div>
                    {sceneStructureDropTime !== null && (
                      <div
                        className="scene-structure-template-drop-indicator"
                        aria-hidden="true"
                        style={{ left: `${Math.min(100, Math.max(0, sceneStructureDropTime / sceneStructureDuration * 100))}%` }}
                      >
                        <b>{formatPreciseTime(sceneStructureDropTime)}</b>
                        <span>Thả để thêm</span>
                      </div>
                    )}
                    <div
                      className="scene-structure-playhead"
                      aria-hidden="true"
                      style={{ left: `${Math.min(100, Math.max(0, sceneStructureLocalTime / sceneStructureDuration * 100))}%` }}
                    >
                      <b>{formatPreciseTime(sceneStructureLocalTime)}</b>
                      <i />
                    </div>

                    {sceneStructureItems.length ? sceneStructureItems.map((item, index) => {
                      const leftPercent = Math.min(98, Math.max(0, item.start / sceneStructureDuration * 100));
                      const rawWidth = Math.max(8, (item.end - item.start) / sceneStructureDuration * 100);
                      const widthPercent = Math.min(100 - leftPercent, rawWidth);
                      const isLive = sceneStructurePreviewMode
                        && sceneStructureLocalTime >= item.start
                        && sceneStructureLocalTime < item.end;
                      return (
                        <div
                          className="scene-structure-flow-row"
                          key={item.token}
                          style={{ top: `${112 + index * 76}px` }}
                        >
                          <span className="scene-structure-flow-line" aria-hidden="true"><i /></span>
                          <button
                            type="button"
                            className={`scene-structure-card scene-structure-card-${item.kind} ${item.token === selectedSceneStructureItem?.token ? "active" : ""} ${isLive ? "is-live" : ""} ${item.token === sceneStructureItemDragToken ? "is-dragging" : ""} ${item.timingMode !== "none" ? "is-movable" : ""}`}
                            style={{
                              left: `${leftPercent}%`,
                              width: `${widthPercent}%`,
                              maxWidth: `calc(100% - ${leftPercent}% - 12px)`,
                            }}
                            aria-pressed={item.token === selectedSceneStructureItem?.token}
                            aria-label={`${item.label}, từ ${formatPreciseTime(item.start)} đến ${formatPreciseTime(item.end)}. Nhấn Delete để xóa`}
                            title={item.timingMode !== "none" ? "Kéo thẻ để đổi vị trí · Click đúp để chỉnh sửa · Nhấn Delete để xóa" : "Click đúp để chỉnh sửa · Nhấn Delete để xóa tài nguyên"}
                            onPointerDown={(event) => startSceneStructureItemDrag(event, item)}
                            onPointerMove={(event) => {
                              moveSceneStructureItemDrag(event, item);
                              showSceneStructureHoverPreview(event, item);
                              event.stopPropagation();
                            }}
                            onPointerUp={endSceneStructureItemDrag}
                            onPointerCancel={endSceneStructureItemDrag}
                            onPointerLeave={hideSceneStructureHoverPreview}
                            onClick={() => {
                              if (sceneStructureItemDidDrag.current) {
                                sceneStructureItemDidDrag.current = false;
                                return;
                              }
                              selectSceneStructureItem(item);
                            }}
                            onDoubleClick={() => openSceneStructureQuickEditor(item)}
                            onKeyDown={(event) => {
                              if (event.key !== "Delete") return;
                              event.preventDefault();
                              event.stopPropagation();
                              deleteSceneStructureItem(item);
                            }}
                          >
                            <span className="scene-structure-card-media" aria-hidden="true">
                              {renderSceneStructureThumbnail(item)}
                            </span>
                            <span className="scene-structure-card-index">{index + 1}</span>
                            <span className="scene-structure-card-copy">
                              <strong>{item.label}</strong>
                              <small>{formatPreciseTime(item.start)} → {formatPreciseTime(item.end)}</small>
                            </span>
                            <span className="scene-structure-card-kind">{sceneStructureKindLabel(item.kind)}</span>
                          </button>
                        </div>
                      );
                    }) : (
                      <div className="scene-structure-empty-state">
                        <strong>Cảnh chưa có tài nguyên đang hiển thị</strong>
                        <span>Thêm hình ảnh, popup, chữ hoặc hiệu ứng trong “Biên soạn” để xem flow của cảnh.</span>
                      </div>
                    )}

                    <footer className="scene-structure-legend">
                      {([
                        ["image", "Hình ảnh"],
                        ["popup", "Popup"],
                        ["text", "Chữ"],
                        ["effect", "Hiệu ứng"],
                        ["audio", "Âm thanh"],
                      ] as const).map(([kind, label]) => (
                        <span key={kind} className={`scene-structure-legend-${kind}`}><i /> {label}</span>
                      ))}
                    </footer>
                  </div>
                </div>
                {SCENE_STRUCTURE_MINIMAP_ENABLED && <section className="scene-structure-minimap" aria-label="Minimap timeline của cảnh">
                  <header className="scene-structure-minimap-heading">
                    <div>
                      <strong>Tổng quan timeline</strong>
                      <span>Kéo vùng xanh để di chuyển vùng đang xem</span>
                    </div>
                    <output>{formatPreciseTime(sceneStructureLocalTime)} / {formatPreciseTime(sceneStructureDuration)}</output>
                  </header>
                  <div className="scene-structure-minimap-legend" aria-label="Chú thích màu layer">
                    {sceneStructureMinimapTracks.map((track) => (
                      <span key={track.key} className={`scene-structure-minimap-legend-${track.key}`}><i />{track.label}</span>
                    ))}
                    <span className="scene-structure-minimap-legend-marker"><i />Mốc đáng chú ý</span>
                  </div>
                  <div
                    className="scene-structure-minimap-map"
                    role="button"
                    tabIndex={0}
                    aria-label="Minimap timeline. Kéo hoặc click để điều hướng vùng đang xem; dùng phím mũi tên trái phải để di chuyển."
                    title="Kéo vùng xanh để di chuyển vùng đang xem"
                    onPointerDown={startSceneStructureMinimapDrag}
                    onPointerMove={moveSceneStructureMinimapDrag}
                    onPointerUp={endSceneStructureMinimapDrag}
                    onPointerCancel={endSceneStructureMinimapDrag}
                    onKeyDown={navigateSceneStructureMinimapWithKeyboard}
                  >
                    <div className="scene-structure-minimap-labels" aria-hidden="true">
                      {sceneStructureMinimapTracks.map((track) => <span key={track.key}>{track.label}</span>)}
                    </div>
                    <div className="scene-structure-minimap-timeline" aria-hidden="true">
                      <div className="scene-structure-minimap-ticks">
                        {sceneStructureTicks.map((tick) => (
                          <i
                            key={`scene-structure-minimap-tick-${tick}`}
                            style={{ left: `${Math.min(100, Math.max(0, tick / sceneStructureDuration * 100))}%` }}
                          ><b>{formatTime(tick)}</b></i>
                        ))}
                      </div>
                      <div className="scene-structure-minimap-tracks">
                        {sceneStructureMinimapTracks.map((track) => (
                          <div key={track.key} className="scene-structure-minimap-track">
                            <div>
                              {sceneStructureItems
                                .filter((item) => track.kinds.includes(item.kind))
                                .map((item) => {
                                  const left = Math.min(99, Math.max(0, item.start / sceneStructureDuration * 100));
                                  const width = Math.min(100 - left, Math.max(1.2, (item.end - item.start) / sceneStructureDuration * 100));
                                  return (
                                    <i
                                      key={item.token}
                                      className={`scene-structure-minimap-item scene-structure-minimap-item-${item.kind}`}
                                      style={{ left: `${left}%`, width: `${width}%` }}
                                    />
                                  );
                                })}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="scene-structure-minimap-markers">
                        {sceneStructureItems
                          .filter((item) => item.kind === "popup" || item.kind === "effect" || item.kind === "subtitle")
                          .slice(0, 24)
                          .map((item) => (
                            <i
                              key={`scene-structure-minimap-marker-${item.token}`}
                              className={`scene-structure-minimap-marker-${item.kind}`}
                              style={{ left: `${Math.min(100, Math.max(0, item.start / sceneStructureDuration * 100))}%` }}
                            />
                          ))}
                      </div>
                      <i
                        className="scene-structure-minimap-playhead"
                        style={{ left: `${Math.min(100, Math.max(0, sceneStructureLocalTime / sceneStructureDuration * 100))}%` }}
                      ><b>{formatPreciseTime(sceneStructureLocalTime)}</b></i>
                      <span
                        className="scene-structure-minimap-viewport"
                        style={{ left: `${sceneStructureMinimapViewport.left}%`, width: `${sceneStructureMinimapViewport.width}%` }}
                      ><b>Vùng xem</b><i /><i /></span>
                    </div>
                    <span
                      className="scene-structure-minimap-hint"
                      aria-hidden="true"
                    >Click hoặc kéo để xem phần khác của timeline</span>
                  </div>
                </section>}
                </>) : (
                  <div
                    className={`scene-structure-alt-scroll scene-structure-alt-${sceneStructureViewMode}`}
                  >
                    <div
                      className="scene-structure-alt-content"
                      style={{ minWidth: `${Math.round((sceneStructureViewMode === "table" ? 980 : 760) * sceneStructureZoom / 100)}px` }}
                    >
                      <header className="scene-structure-alt-heading">
                        <div>
                          <span>{SCENE_STRUCTURE_VIEW_OPTIONS.find((option) => option.value === sceneStructureViewMode)?.icon}</span>
                          <div>
                            <strong>{SCENE_STRUCTURE_VIEW_OPTIONS.find((option) => option.value === sceneStructureViewMode)?.label}</strong>
                            <small>{scenes.length} cảnh · kéo thả để thay đổi thứ tự</small>
                          </div>
                        </div>
                        <b>{formatPreciseTime(Math.max(0, ...scenes.map((item) => item.end)))}</b>
                      </header>

                      {sceneStructureViewMode === "list" && (
                        <div className="scene-structure-scene-list">
                          {scenes.map((item) => {
                            const stats = sceneStructureSceneStats(item);
                            const issues = sceneStructureSceneIssues(item);
                            const thumbnailValue = safeTrim(item.avatar) || safeTrim(item.background) || safeTrim(item.sceneImages?.[0]?.url) || safeTrim(item.image);
                            const thumbnailSource = assetPreviewSource(thumbnailValue);
                            return (
                              <article
                                key={item.id}
                                {...sceneStructureSceneDragProps(item)}
                                className={`scene-structure-scene-row ${item.id === sceneStructureScene.id ? "active" : ""} ${item.id === sceneStructureSceneDragOverId ? "drag-over" : ""}`}
                                onClick={() => selectSceneStructureScene(item)}
                              >
                                <span className="scene-structure-scene-grip" aria-hidden="true">⠿</span>
                                <span className="scene-structure-scene-number">{String(item.number).padStart(2, "0")}</span>
                                <span className="scene-structure-scene-thumb">
                                  {thumbnailSource ? <img src={thumbnailSource} alt="" /> : <i>SC</i>}
                                </span>
                                <span className="scene-structure-scene-main">
                                  <ReviewEditable value={item.sceneName || `Cảnh ${item.number}`} label={`Tên cảnh ${item.number}`} onCommit={(value) => updateReviewSceneField(item.id, "sceneName", value)} />
                                  <small>{formatPreciseTime(item.start)} → {formatPreciseTime(item.end)} · {(item.end - item.start).toFixed(1)}s</small>
                                </span>
                                <span className="scene-structure-scene-stats">
                                  <b>IMG {stats.images}</b><b>POP {stats.popups}</b><b>TXT {stats.texts}</b><b>AU {stats.audio}</b>
                                </span>
                                <span className={`scene-structure-scene-health ${issues.length ? "has-issues" : "is-ready"}`} title={issues.join(" · ") || "Sẵn sàng"}>
                                  {issues.length ? `${issues.length} cảnh báo` : "Sẵn sàng"}
                                </span>
                                <button
                                  type="button"
                                  className={`scene-structure-scene-visible ${item.sceneVisible !== false ? "is-on" : ""}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    updateReviewSceneField(item.id, "sceneVisible", item.sceneVisible === false);
                                  }}
                                >
                                  {item.sceneVisible !== false ? "Hiện" : "Ẩn"}
                                </button>
                              </article>
                            );
                          })}
                        </div>
                      )}

                      {sceneStructureViewMode === "storyboard" && (
                        <div
                          className="scene-structure-storyboard-grid"
                          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(220 * sceneStructureZoom / 100)}px, 1fr))` }}
                        >
                          {scenes.map((item) => {
                            const stats = sceneStructureSceneStats(item);
                            const issues = sceneStructureSceneIssues(item);
                            const thumbnailValue = safeTrim(item.avatar) || safeTrim(item.background) || safeTrim(item.sceneImages?.[0]?.url) || safeTrim(item.image);
                            const thumbnailSource = assetPreviewSource(thumbnailValue);
                            return (
                              <article
                                key={item.id}
                                {...sceneStructureSceneDragProps(item)}
                                className={`scene-structure-story-card ${item.id === sceneStructureScene.id ? "active" : ""} ${item.id === sceneStructureSceneDragOverId ? "drag-over" : ""}`}
                                onClick={() => selectSceneStructureScene(item)}
                              >
                                <div className="scene-structure-story-media">
                                  {thumbnailSource ? <img src={thumbnailSource} alt="" /> : <span>Chưa có avatar</span>}
                                  <b>{String(item.number).padStart(2, "0")}</b>
                                  <i>{(item.end - item.start).toFixed(1)}s</i>
                                </div>
                                <div className="scene-structure-story-copy">
                                  <ReviewEditable value={item.sceneName || `Cảnh ${item.number}`} label={`Tên cảnh ${item.number}`} onCommit={(value) => updateReviewSceneField(item.id, "sceneName", value)} />
                                  <p>{safeTrim(item.narration).slice(0, 110) || safeTrim(scenePopupList(item)[0]?.body).slice(0, 110) || "Cảnh chưa có nội dung mô tả."}</p>
                                  <div><span>IMG {stats.images}</span><span>POP {stats.popups}</span><span>AU {stats.audio}</span><span>SUB {stats.subtitles}</span></div>
                                  <small className={issues.length ? "has-issues" : "is-ready"}>{issues.length ? issues.join(" · ") : "Sẵn sàng render"}</small>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}

                      {sceneStructureViewMode === "table" && (
                        <div className="scene-structure-table-wrap">
                          <table className="scene-structure-table">
                            <thead><tr><th>STT</th><th>Tên cảnh</th><th>Bắt đầu</th><th>Thời lượng</th><th>Hình</th><th>Popup</th><th>Chữ</th><th>Âm thanh</th><th>Phụ đề</th><th>Hiệu ứng</th><th>Trạng thái</th></tr></thead>
                            <tbody>
                              {scenes.map((item) => {
                                const stats = sceneStructureSceneStats(item);
                                const issues = sceneStructureSceneIssues(item);
                                return (
                                  <tr
                                    key={item.id}
                                    {...sceneStructureSceneDragProps(item)}
                                    className={`${item.id === sceneStructureScene.id ? "active" : ""} ${item.id === sceneStructureSceneDragOverId ? "drag-over" : ""}`}
                                    onClick={() => selectSceneStructureScene(item)}
                                  >
                                    <td><span className="scene-structure-table-grip">⠿</span> {String(item.number).padStart(2, "0")}</td>
                                    <td><ReviewEditable value={item.sceneName || `Cảnh ${item.number}`} label={`Tên cảnh ${item.number}`} onCommit={(value) => updateReviewSceneField(item.id, "sceneName", value)} /></td>
                                    <td>{formatPreciseTime(item.start)}</td>
                                    <td><ReviewEditable value={(item.end - item.start).toFixed(2)} numeric label={`Thời lượng cảnh ${item.number}`} onCommit={(value) => updateReviewSceneDuration(item.id, value)} /> s</td>
                                    <td>{stats.images}</td><td>{stats.popups}</td><td>{stats.texts}</td><td>{stats.audio}</td><td>{stats.subtitles}</td><td>{stats.effects}</td>
                                    <td><span className={issues.length ? "scene-structure-table-warning" : "scene-structure-table-ready"}>{issues.length ? `${issues.length} cảnh báo` : "Sẵn sàng"}</span></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {sceneStructureViewMode === "tree" && (
                        <div className="scene-structure-tree-list">
                          {scenes.map((item) => {
                            const effects = normalizeSceneEffects(item.effects);
                            const treePopups = scenePopupList(item).filter(popupHasContent);
                            return (
                              <details key={item.id} open={item.id === sceneStructureScene.id} className={item.id === sceneStructureScene.id ? "active" : ""}>
                                <summary onClick={() => selectSceneStructureScene(item)}>
                                  <span>▾</span><b>{String(item.number).padStart(2, "0")}</b><strong>{item.sceneName || `Cảnh ${item.number}`}</strong><small>{(item.end - item.start).toFixed(1)}s</small>
                                </summary>
                                <div className="scene-structure-tree-groups">
                                  <section><h3>▧ Hình ảnh & nền</h3><p>{item.background ? `Nền · ${fileNameOnly(item.background)}` : "Nền mặc định"}</p>{(item.sceneImages ?? []).map((image) => <p key={image.id}>└ {image.name || fileNameOnly(image.url) || "Hình chưa đặt tên"} · {formatTime(image.start)}–{formatTime(image.start + image.duration)}</p>)}</section>
                                  <section><h3>▤ Popup</h3>{treePopups.length ? treePopups.map((popup) => <p key={popup.id}>└ {popup.title || "Popup"} · {formatTime(popup.start)}–{formatTime(popup.start + popup.duration)}</p>) : <p>Chưa có popup</p>}</section>
                                  <section><h3>T Chữ viết</h3>{(item.textOverlays ?? []).length ? (item.textOverlays ?? []).map((overlay) => <p key={overlay.id}>└ {overlay.name || safeTrim(overlay.text).slice(0, 32) || "Chữ chưa đặt tên"} · {formatTime(overlay.start)}–{formatTime(overlay.end)}</p>) : <p>Chưa có chữ</p>}</section>
                                  <section><h3>≋ Âm thanh</h3>{(item.audioTracks ?? []).length ? (item.audioTracks ?? []).map((track) => <p key={track.id}>└ {track.name || fileNameOnly(track.source) || "Âm thanh"} · {formatTime(track.start)}–{formatTime(track.end)} · {track.volume}%</p>) : <p>Chưa có âm thanh</p>}</section>
                                  <section><h3>✦ Hiệu ứng</h3><p>{item.zoomEnabled !== false ? `└ Zoom ${Number(item.zoom ?? 1).toFixed(2)}×` : "Zoom đang tắt"}</p>{effects.sceneStartDarkEffects.filter((effect) => effect.enabled).map((effect) => <p key={effect.id}>└ Tối dần · {formatTime(effect.start)}–{formatTime(effect.end)}</p>)}</section>
                                  <section><h3>CC Phụ đề</h3><p>{item.subtitleEnabled !== false ? `${(item.subtitles ?? []).filter((cue) => cue.visible !== false).length} cue` : "Đang tắt"}</p></section>
                                </div>
                              </details>
                            );
                          })}
                        </div>
                      )}

                      {sceneStructureViewMode === "script" && (
                        <div className="scene-structure-script-list">
                          {scenes.map((item) => {
                            const issues = sceneStructureSceneIssues(item);
                            const primaryTrack = (item.audioTracks ?? [])[0];
                            return (
                              <article key={item.id} className={item.id === sceneStructureScene.id ? "active" : ""} onClick={() => selectSceneStructureScene(item)}>
                                <header><b>{String(item.number).padStart(2, "0")}</b><ReviewEditable value={item.sceneName || `Cảnh ${item.number}`} label={`Tên cảnh ${item.number}`} onCommit={(value) => updateReviewSceneField(item.id, "sceneName", value)} /><span>{formatPreciseTime(item.start)} → {formatPreciseTime(item.end)}</span></header>
                                <div className="scene-structure-script-grid">
                                  <label><span>Nội dung / ghi chú</span><ReviewEditable multiline value={item.reference || "Double-click để thêm ghi chú"} label={`Ghi chú cảnh ${item.number}`} onCommit={(value) => updateReviewSceneField(item.id, "reference", value)} /></label>
                                  <label><span>Lời thuyết minh</span><ReviewEditable multiline value={item.narration || "Double-click để nhập lời thuyết minh"} label={`Lời thuyết minh cảnh ${item.number}`} onCommit={(value) => updateReviewSceneField(item.id, "narration", value)} /></label>
                                  <label><span>Audio chính</span><strong>{primaryTrack ? `${primaryTrack.name || "Thuyết minh"} · ${fileNameOnly(primaryTrack.source) || "chưa có file"}` : "Chưa có"}</strong><small>{primaryTrack ? `${formatTime(primaryTrack.start)}–${formatTime(primaryTrack.end)} · ${primaryTrack.volume}%` : ""}</small></label>
                                  <label><span>Phụ đề</span><strong>{(item.subtitles ?? []).filter((cue) => cue.visible !== false).length} cue</strong><small>{item.subtitleEnabled !== false ? "Đang bật" : "Đang tắt"}</small></label>
                                </div>
                                <footer className={issues.length ? "has-issues" : "is-ready"}>{issues.length ? issues.map((issue) => <span key={issue}>! {issue}</span>) : <span>✓ Cảnh sẵn sàng</span>}</footer>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <aside
                id="scene-structure-inspector-panel"
                className={`scene-structure-inspector ${sceneStructureInspectorCollapsed ? "is-collapsed" : ""}`}
                aria-label="Thông tin tài nguyên"
              >
                <button
                  type="button"
                  className="scene-structure-panel-toggle scene-structure-panel-toggle-inspector"
                  aria-label={sceneStructureInspectorCollapsed ? "Hiện Thông tin tài nguyên" : "Ẩn Thông tin tài nguyên"}
                  aria-controls="scene-structure-inspector-panel"
                  aria-expanded={!sceneStructureInspectorCollapsed}
                  title={sceneStructureInspectorCollapsed ? "Hiện Thông tin tài nguyên" : "Ẩn Thông tin tài nguyên"}
                  onClick={() => setSceneStructureInspectorCollapsed((value) => !value)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={sceneStructureInspectorCollapsed ? "m15 5-7 7 7 7" : "m9 5 7 7-7 7"} />
                  </svg>
                </button>
                {sceneStructurePreviewMode ? (
                  <>
                    <div className="scene-structure-live-heading">
                      <div>
                        <h2>Xem trước</h2>
                        <p>Cảnh đang chạy thử theo đúng mốc thời gian.</p>
                      </div>
                      <strong>{formatPreciseTime(sceneStructureLocalTime)}</strong>
                    </div>
                    <div
                      ref={setSceneStructurePreviewPortalHost}
                      className="scene-structure-preview-portal-host"
                      data-scene-structure-review-preview="true"
                      aria-label="Màn hình xem trước đang chạy thử"
                      aria-busy={!sceneStructurePreviewPortalHost}
                    >
                      {!sceneStructurePreviewPortalHost && (
                        <div className="scene-structure-review-loading" role="status">
                          <span>Đang đồng bộ màn hình Xem trước…</span>
                          <small>Hình ảnh, âm thanh, phụ đề và hiệu ứng sẽ dùng cùng một canvas.</small>
                        </div>
                      )}
                    </div>
                    <p className="scene-structure-live-hint">Thẻ đang phát sẽ sáng viền trên sơ đồ. Bấm “Quay lại” để dừng và trở về đầu cảnh.</p>
                  </>
                ) : (
                  <>
                    <h2>Thông tin tài nguyên</h2>
                    {selectedSceneStructureItem ? (
                  <>
                    <div className={`scene-structure-inspector-preview ${aspectRatio === "16:9" ? "is-landscape" : ""}`}>
                      {sceneStructureBackgroundSource && (
                        isVideoMedia(sceneStructureBackgroundValue) ? (
                          <video src={sceneStructureBackgroundSource} muted loop autoPlay playsInline aria-hidden="true" />
                        ) : (
                          <img src={sceneStructureBackgroundSource} alt="" aria-hidden="true" />
                        )
                      )}
                      <div className={`scene-structure-inspector-resource scene-structure-inspector-resource-${selectedSceneStructureItem.kind}`}>
                        <span>{renderSceneStructureThumbnail(selectedSceneStructureItem)}</span>
                        <strong>{selectedSceneStructureItem.label}</strong>
                        <small>{selectedSceneStructureItem.detail}</small>
                      </div>
                    </div>

                    <div className="scene-structure-inspector-type">
                      <span>Loại</span>
                      <b className={`kind-${selectedSceneStructureItem.kind}`}><i>{selectedSceneStructureItem.icon}</i>{sceneStructureKindLabel(selectedSceneStructureItem.kind)}</b>
                    </div>
                    <label className="scene-structure-time-field">
                      <span>Bắt đầu</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={sceneStructureStartDraft}
                        disabled={selectedSceneStructureItem.timingMode === "none"}
                        aria-label="Thời gian bắt đầu tài nguyên"
                        onChange={(event) => setSceneStructureStartDraft(event.target.value)}
                        onBlur={commitSceneStructureTiming}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitSceneStructureTiming();
                            event.currentTarget.blur();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            resetSceneStructureTimingDrafts();
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    </label>
                    <label className="scene-structure-time-field">
                      <span>Kết thúc</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={sceneStructureEndDraft}
                        disabled={selectedSceneStructureItem.timingMode !== "both"}
                        aria-label="Thời gian kết thúc tài nguyên"
                        onChange={(event) => setSceneStructureEndDraft(event.target.value)}
                        onBlur={commitSceneStructureTiming}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitSceneStructureTiming();
                            event.currentTarget.blur();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            resetSceneStructureTimingDrafts();
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    </label>
                    <div className="scene-structure-duration-row">
                      <span>Thời lượng</span>
                      <strong>{formatPreciseTime(Math.max(0, selectedSceneStructureItem.end - selectedSceneStructureItem.start))}</strong>
                    </div>
                    {selectedSceneStructureItem.timingMode === "none" && (
                      <small className="scene-structure-readonly-note">Thời gian của tài nguyên này được xác định tự động theo cảnh.</small>
                    )}
                    <div className="scene-structure-inspector-actions">
                      <button
                        type="button"
                        className="scene-structure-open-editor"
                        onClick={() => openSceneStructureItemInEditor(selectedSceneStructureItem)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 13v6H5V6h6" /></svg>
                        Mở trong Biên soạn
                      </button>
                      <button
                        type="button"
                        className="scene-structure-hide-resource"
                        disabled={!selectedSceneStructureItem.canHide}
                        onClick={() => toggleSceneStructureItemVisibility(selectedSceneStructureItem)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M2.8 12s3.2-5 9.2-5 9.2 5 9.2 5-3.2 5-9.2 5-9.2-5-9.2-5Z" />
                          <circle cx="12" cy="12" r="2.2" />
                          <path d="m4 4 16 16" />
                        </svg>
                        Ẩn tài nguyên
                      </button>
                    </div>
                    <p className="scene-structure-inspector-hint">Thay đổi được đồng bộ với “Biên soạn”. Chọn thẻ và nhấn Delete để xóa; dùng Ctrl+Z để hoàn tác.</p>
                  </>
                    ) : (
                  <div className="scene-structure-inspector-empty">
                    <span>◇</span>
                    <strong>Chưa có tài nguyên</strong>
                    <p>Hãy đóng màn hình và thêm tài nguyên trong khu vực “Biên soạn”.</p>
                  </div>
                    )}
                  </>
                )}
              </aside>
            </div>
          </section>
          {renderSceneStructureHoverPreview()}
          {renderSceneStructureQuickEditor()}
        </div>
      )}
      {reviewOpen && (
        <div className="review-overlay" role="dialog" aria-modal="true" aria-labelledby="review-heading">
          <section className="review-shell">
            <header className="review-topbar">
              <div className="review-title-wrap">
                <div className="review-brand-mark" aria-hidden="true">
                  <span /><span /><span /><span />
                </div>
                <div>
                  <div className="review-kicker">KITO VIDEO STUDIO · XEM TRƯỚC</div>
                  <h1 id="review-heading">Review tổng quan</h1>
                  <p>{projectTitle} · {reviewSceneCountLabel} · {formatTime(totalDuration)}</p>
                </div>
              </div>
              <div className="review-top-actions">
                <span className="review-sync-state"><i /> Đồng bộ với Biên soạn</span>
                <div
                  className="review-zoom-control"
                  aria-label="Thu phóng cột cảnh"
                  title="Cuộn chuột tại đây hoặc dùng Ctrl/Alt + cuộn trong bảng để phóng to, thu nhỏ"
                  onWheel={(event) => {
                    event.preventDefault();
                    adjustReviewZoom(event.deltaY < 0 ? 10 : -10);
                  }}
                >
                  <button type="button" onClick={() => adjustReviewZoom(-10)} disabled={reviewZoom <= 35} aria-label="Thu nhỏ cột cảnh">−</button>
                  <output>{reviewZoom}%</output>
                  <button type="button" onClick={() => adjustReviewZoom(10)} disabled={reviewZoom >= REVIEW_ZOOM_MAX} aria-label="Phóng to cột cảnh">＋</button>
                </div>
                <button type="button" className="button primary review-save-button" onClick={() => void saveProjectNow()}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l2 2v14H5z" /><path d="M8 4v6h8V4M8 20v-6h8v6" /></svg>
                  Lưu thay đổi
                </button>
                <button
                  type="button"
                  className="review-close-button"
                  aria-label="Đóng Review"
                  title="Đóng Review (Esc)"
                  onClick={() => setReviewOpen(false)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                </button>
              </div>
            </header>

            <div className="review-notice">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></svg>
              <span>Double-click vào thông số để chỉnh sửa và đồng bộ ngay về khu vực “Biên soạn”. Enter để xác nhận · Esc để hủy.</span>
            </div>

            <div className="review-body">
              <div className="review-scroll-area" onWheel={handleReviewWheel}>
                {visibleScenes.length ? (
                  <div
                    className="review-table-grid"
                    style={{ gridTemplateColumns: `178px repeat(${visibleScenes.length}, ${Math.round(165 * reviewZoom / 50)}px)` }}
                  >
                    <div className="review-corner">Thông tin cảnh</div>
                    {visibleScenes.map((item) => {
                      const duration = Math.max(0.1, item.end - item.start);
                      return (
                        <div className="review-scene-header" key={`review-head-${item.id}`}>
                          <div className="review-scene-heading">
                            <b>{String(item.number).padStart(2, "0")}</b>
                            <ReviewEditable
                              value={item.sceneName || `Cảnh ${item.number}`}
                              label={`Tên cảnh ${item.number}`}
                              className="review-scene-name"
                              onCommit={(value) => updateReviewSceneField(item.id, "sceneName", value)}
                            />
                          </div>
                          <div className="review-scene-time"><strong>{formatTime(item.start)} → {formatTime(item.end)}</strong><span>{duration.toFixed(1)} giây</span></div>
                        </div>
                      );
                    })}

                    <div className="review-row-label">Tên cảnh <small>text</small></div>
                    {visibleScenes.map((item) => (
                      <div className="review-grid-cell review-basic-cell" key={`review-name-${item.id}`}>
                        <ReviewEditable
                          value={item.sceneName || `Cảnh ${item.number}`}
                          label={`Tên cảnh ${item.number}`}
                          onCommit={(value) => updateReviewSceneField(item.id, "sceneName", value)}
                        />
                      </div>
                    ))}

                    <div className="review-row-label">Bắt đầu <small>timeline</small></div>
                    {visibleScenes.map((item) => (
                      <div className="review-grid-cell review-basic-cell" key={`review-start-${item.id}`}>
                        <span className="review-readonly-value mono">{formatTime(item.start)}</span>
                        <small className="review-cell-help">Tự tính theo thứ tự cảnh</small>
                      </div>
                    ))}

                    <div className="review-row-label">Thời lượng <small>giây</small></div>
                    {visibleScenes.map((item) => (
                      <div className="review-grid-cell review-basic-cell" key={`review-duration-${item.id}`}>
                        <ReviewEditable
                          value={Math.max(0.1, item.end - item.start).toFixed(2)}
                          label={`Thời lượng cảnh ${item.number}`}
                          numeric
                          onCommit={(value) => updateReviewSceneDuration(item.id, value)}
                        />
                        <span className="review-unit">giây</span>
                      </div>
                    ))}

                    <div className="review-row-label">Âm thanh <small>voice</small></div>
                    {visibleScenes.map((item) => {
                      const tracks = item.audioTracks ?? [];
                      return (
                        <div className="review-grid-cell review-basic-cell review-audio-tracks" key={`review-audio-${item.id}`}>
                          {tracks.length ? tracks.map((track, trackIndex) => (
                            <div className={`review-audio-track ${track.visible === false ? "is-hidden" : ""}`} key={track.id}>
                              <strong>{track.name || `Âm thanh ${trackIndex + 1}`}</strong>
                              <ReviewEditable
                                value={fileNameOnly(track.source) || "Chưa có file âm thanh"}
                                label={`File ${track.name || `âm thanh ${trackIndex + 1}`} cảnh ${item.number}`}
                                className="review-audio-value"
                                onCommit={(value) => updateReviewAudioTrackValue(item.id, track.id, "source", value)}
                              />
                              <div className="review-detail-line">Âm lượng <ReviewEditable value={Number(track.volume).toFixed(0)} numeric label="Âm lượng âm thanh" onCommit={(value) => updateReviewAudioTrackValue(item.id, track.id, "volume", reviewNumber(value, track.volume))} />%</div>
                              <div className="review-detail-line">Phát <ReviewEditable value={Number(track.start).toFixed(2)} numeric label="Bắt đầu âm thanh" onCommit={(value) => updateReviewAudioTrackValue(item.id, track.id, "start", reviewNumber(value, track.start))} />–<ReviewEditable value={Number(track.end).toFixed(2)} numeric label="Kết thúc âm thanh" onCommit={(value) => updateReviewAudioTrackValue(item.id, track.id, "end", reviewNumber(value, track.end))} /> giây</div>
                            </div>
                          )) : <span>Chưa có âm thanh</span>}
                        </div>
                      );
                    })}

                    <div className="review-row-label">Phụ đề <small>cues</small></div>
                    {visibleScenes.map((item) => (
                      <div className="review-grid-cell review-basic-cell" key={`review-subtitle-${item.id}`}>
                        <button type="button" className={`review-toggle-row ${item.subtitleEnabled !== false ? "is-on" : ""}`} onClick={() => updateReviewSceneField(item.id, "subtitleEnabled", item.subtitleEnabled === false)}>
                          <span className="review-toggle-dot" /> {item.subtitleEnabled !== false ? `${(item.subtitles ?? []).filter((cue) => cue.visible !== false).length} cue đang bật` : "Đang tắt phụ đề"}
                        </button>
                        <div className="review-detail-line">Style: {normalizeSubtitleStyle(item.subtitleStyle).animation} · {normalizeSubtitleStyle(item.subtitleStyle).size}px</div>
                      </div>
                    ))}

                    <div className="review-row-label review-section-label">Hình ảnh <small>{"item"}</small></div>
                    {visibleScenes.map((item) => {
                      const images = item.sceneImages ?? [];
                      return (
                        <div className="review-grid-cell review-section-cell review-images-cell" key={`review-images-${item.id}`}>
                          <div className="review-section-heading">
                            <strong>{images.length} hình ảnh</strong>
                            <button type="button" className="review-add-link" onClick={() => reviewLayerFocus(item, "images", images[0]?.id ?? "")}>+ Mở Biên soạn</button>
                          </div>
                          {images.length ? images.map((image) => {
                            const source = reviewAssetSource(image.url);
                            return (
                              <article className="review-layer-card" key={image.id}>
                                <div className="review-layer-topline">
                                  <span className="review-drag-dots" aria-hidden="true">⋮</span>
                                  <div className="review-media-thumb">
                                    {source && image.mediaType === "video" ? <video src={source} muted playsInline preload="metadata" /> : source ? <img src={source} alt="" /> : <span>IMG</span>}
                                  </div>
                                  <div className="review-layer-title">
                                    <ReviewEditable value={image.name || "Hình ảnh"} label={`Tên hình ảnh ${image.name}`} onCommit={(value) => updateReviewSceneImageValue(item.id, image.id, "name", value)} />
                                    <small>{fileNameOnly(image.url) || "Chưa nhập URL"} · {image.mediaType === "video" ? "video" : "image"}</small>
                                  </div>
                                  {renderReviewVisibility(image.visible !== false, `hình ảnh ${image.name}`, () => updateReviewSceneImageValue(item.id, image.id, "visible", image.visible === false))}
                                </div>
                                <div className="review-metric-grid">
                                  <div><b>X</b><ReviewEditable value={String(image.x)} label="Vị trí X" numeric onCommit={(value) => updateReviewSceneImageValue(item.id, image.id, "x", clampPercent(reviewNumber(value, image.x), image.x))} /><em>%</em></div>
                                  <div><b>Y</b><ReviewEditable value={String(image.y)} label="Vị trí Y" numeric onCommit={(value) => updateReviewSceneImageValue(item.id, image.id, "y", clampPercent(reviewNumber(value, image.y), image.y))} /><em>%</em></div>
                                  <div><b>Rộng</b><ReviewEditable value={String(image.width)} label="Chiều rộng hình ảnh" numeric onCommit={(value) => updateReviewSceneImageValue(item.id, image.id, "width", Math.min(200, Math.max(1, reviewNumber(value, image.width))))} /><em>%</em></div>
                                  <div><b>Cao</b><ReviewEditable value={String(image.height)} label="Chiều cao hình ảnh" numeric onCommit={(value) => updateReviewSceneImageValue(item.id, image.id, "height", Math.min(200, Math.max(1, reviewNumber(value, image.height))))} /><em>%</em></div>
                                </div>
                                <div className="review-metric-grid review-metric-grid-secondary">
                                  <div><b>Bắt đầu</b><ReviewEditable value={Number(image.start).toFixed(2)} label="Thời gian bắt đầu hình ảnh" numeric onCommit={(value) => updateReviewSceneImageValue(item.id, image.id, "start", Math.max(0, reviewNumber(value, image.start)))} /><em>s</em></div>
                                  <div><b>Thời lượng</b><ReviewEditable value={Number(image.duration).toFixed(2)} label="Thời lượng hình ảnh" numeric onCommit={(value) => updateReviewSceneImageValue(item.id, image.id, "duration", Math.max(0.1, reviewNumber(value, image.duration)))} /><em>s</em></div>
                                  <div><b>Opacity</b><ReviewEditable value={String(image.opacity)} label="Độ trong suốt hình ảnh" numeric onCommit={(value) => updateReviewSceneImageValue(item.id, image.id, "opacity", Math.min(100, Math.max(0, reviewNumber(value, image.opacity))))} /><em>%</em></div>
                                  <div><b>Border</b><ReviewEditable value={String(image.borderWidth)} label="Độ dày border hình ảnh" numeric onCommit={(value) => updateReviewSceneImageValue(item.id, image.id, "borderWidth", Math.min(12, Math.max(0, reviewNumber(value, image.borderWidth))))} /><em>px</em></div>
                                </div>
                                <div className="review-layer-footer">
                                  <button type="button" className={`review-toggle-button ${image.transparent ? "is-on" : ""}`} onClick={() => updateReviewSceneImageValue(item.id, image.id, "transparent", !image.transparent)}><span /> Giữ nền trong suốt</button>
                                  <span className="review-chip">{image.spriteSheet ? `Sprite · ${image.spriteDelay}ms` : image.shape}</span>
                                  <button type="button" className="review-open-layer" onClick={() => reviewLayerFocus(item, "images", image.id)}>Mở</button>
                                </div>
                              </article>
                            );
                          }) : <div className="review-empty-layer">Chưa có hình ảnh trong cảnh này.</div>}
                          <button type="button" className="review-add-link review-add-bottom" onClick={() => reviewLayerFocus(item, "images", images[0]?.id ?? "")}>＋ Thêm hình ảnh trong Biên soạn</button>
                        </div>
                      );
                    })}

                    <div className="review-row-label review-section-label">Popup <small>items</small></div>
                    {visibleScenes.map((item) => {
                      const popups = scenePopupList(item);
                      return (
                        <div className="review-grid-cell review-section-cell review-popups-cell" key={`review-popups-${item.id}`}>
                          <div className="review-section-heading">
                            <strong>{popups.length} popup</strong>
                            <button type="button" className="review-add-link" onClick={() => reviewLayerFocus(item, "popup", popups[0]?.id ?? "")}>+ Mở Biên soạn</button>
                          </div>
                          {popups.map((popup) => {
                            const mediaValue = safeTrim(popup.video) || safeTrim(popup.image);
                            const source = reviewAssetSource(mediaValue);
                            return (
                              <article className="review-layer-card review-popup-card" key={popup.id}>
                                <div className="review-layer-topline">
                                  <div className="review-media-thumb popup-thumb">
                                    {source && isVideoMedia(mediaValue) ? <video src={source} muted playsInline preload="metadata" /> : source ? <img src={source} alt="" /> : <span>POPUP</span>}
                                  </div>
                                  <div className="review-layer-title">
                                    <ReviewEditable value={popup.title || "Popup"} label={`Tiêu đề popup ${popup.title}`} onCommit={(value) => updateReviewPopupValue(item.id, popup.id, "title", value)} />
                                    <small>{reviewLayoutLabel(popup.layout)} · {reviewThemeLabel(popup.theme)} · {popup.textEffect || "none"}</small>
                                  </div>
                                  {renderReviewVisibility(popup.visible !== false, `popup ${popup.title}`, () => updateReviewPopupValue(item.id, popup.id, "visible", popup.visible === false))}
                                </div>
                                <ReviewEditable value={popup.body || "Chưa có nội dung popup"} label={`Nội dung popup ${popup.title}`} multiline className="review-popup-body" onCommit={(value) => updateReviewPopupValue(item.id, popup.id, "body", value)} />
                                <div className="review-popup-meta-grid">
                                  <div><b>Bắt đầu</b><ReviewEditable value={Number(popup.start).toFixed(2)} label="Thời gian bắt đầu popup" numeric onCommit={(value) => updateReviewPopupValue(item.id, popup.id, "start", Math.max(0, reviewNumber(value, popup.start)))} /><em>s</em></div>
                                  <div><b>Độ dài</b><ReviewEditable value={Number(popup.duration).toFixed(2)} label="Thời lượng popup" numeric onCommit={(value) => updateReviewPopupValue(item.id, popup.id, "duration", Math.min(Math.max(0.1, reviewNumber(value, popup.duration)), Math.max(0.1, item.end - item.start - popup.start)))} /><em>s</em></div>
                                  <div><b>Rộng</b><ReviewEditable value={String(popup.width)} label="Chiều rộng popup" numeric onCommit={(value) => updateReviewPopupValue(item.id, popup.id, "width", Math.min(96, Math.max(55, reviewNumber(value, popup.width))))} /><em>%</em></div>
                                  <div><b>Cao</b><ReviewEditable value={String(popup.height)} label="Chiều cao popup" numeric onCommit={(value) => updateReviewPopupHeight(item.id, popup.id, value)} /><em>px</em></div>
                                  <div><b>X</b><ReviewEditable value={String(popup.x)} label="Vị trí X popup" numeric onCommit={(value) => updateReviewPopupValue(item.id, popup.id, "x", clampPercent(reviewNumber(value, popup.x), popup.x))} /><em>%</em></div>
                                  <div><b>Y</b><ReviewEditable value={String(popup.y)} label="Vị trí Y popup" numeric onCommit={(value) => updateReviewPopupValue(item.id, popup.id, "y", clampPercent(reviewNumber(value, popup.y), popup.y))} /><em>%</em></div>
                                </div>
                                <div className="review-layer-footer">
                                  <button type="button" className={`review-toggle-button ${popup.transparentMedia ? "is-on" : ""}`} onClick={() => updateReviewPopupValue(item.id, popup.id, "transparentMedia", !popup.transparentMedia)}><span /> Nền trong suốt</button>
                                  <span className="review-chip review-chip-orange">Border {popup.borderWidth}px</span>
                                  <button type="button" className="review-open-layer" onClick={() => reviewLayerFocus(item, "popup", popup.id)}>Mở</button>
                                </div>
                              </article>
                            );
                          })}
                          <button type="button" className="review-add-link review-add-bottom" onClick={() => reviewLayerFocus(item, "popup", popups[0]?.id ?? "")}>＋ Thêm popup trong Biên soạn</button>
                        </div>
                      );
                    })}

                    <div className="review-row-label review-section-label">Hiệu ứng <small>motion</small></div>
                    {visibleScenes.map((item) => {
                      const duration = Math.max(0.1, item.end - item.start);
                      const effectSummaries = reviewEffectSummary(item);
                      const effectConfigurations = reviewEffectConfiguration(item);
                      const sceneEffects = normalizeSceneEffects(item.effects);
                      const darkEffects = sceneEffects.sceneStartDarkEffects.filter((effect) => effect.enabled);
                      const imageTransitions = (item.sceneImages ?? []).filter((image) => normalizeSceneImageTransition(image.transition) !== "cut");
                      return (
                        <div className="review-grid-cell review-section-cell review-effects-cell" key={`review-effects-${item.id}`}>
                          <div className="review-effect-heading">
                            <button type="button" className={`review-effect-toggle ${item.zoomEnabled ? "is-on" : ""}`} onClick={() => updateReviewSceneField(item.id, "zoomEnabled", !item.zoomEnabled)}><span /> Hiệu ứng zoom</button>
                            <span className={`review-chip ${item.zoomEnabled ? "review-chip-orange" : "review-chip-muted"}`}>{item.zoomEnabled ? "Đang bật" : "Đang tắt"}</span>
                          </div>
                          <div className="review-effect-columns">
                            <div className="review-effect-group">
                              <strong>Zoom vào</strong>
                              <div><b>Bắt đầu</b><ReviewEditable value={Number(item.zoomStart).toFixed(2)} label="Thời gian bắt đầu zoom" numeric onCommit={(value) => updateReviewSceneField(item.id, "zoomStart", Math.max(0, reviewNumber(value, item.zoomStart)))} /><em>s</em></div>
                              <div><b>Kết thúc</b><ReviewEditable value={Number(item.zoomEnd).toFixed(2)} label="Thời gian kết thúc zoom" numeric onCommit={(value) => updateReviewSceneField(item.id, "zoomEnd", Math.max(0, reviewNumber(value, item.zoomEnd)))} /><em>s</em></div>
                            </div>
                            <div className="review-effect-group">
                              <strong>Zoom ra</strong>
                              <div><b>Bắt đầu</b><ReviewEditable value={Math.max(0, item.zoomEnd - item.zoomOutDuration).toFixed(2)} label="Thời gian bắt đầu zoom ra" numeric onCommit={(value) => updateReviewSceneField(item.id, "zoomOutDuration", Math.max(0, item.zoomEnd - reviewNumber(value, item.zoomEnd)))} /><em>s</em></div>
                              <div><b>Kết thúc</b><span className="review-readonly-value mono">{formatTime(duration)}</span></div>
                            </div>
                          </div>
                          <div className="review-metric-grid review-effect-metrics">
                            <div><b>Tỉ lệ zoom</b><ReviewEditable value={Number(item.zoom).toFixed(2)} label="Tỉ lệ zoom" numeric onCommit={(value) => updateReviewSceneField(item.id, "zoom", Math.max(1, reviewNumber(value, item.zoom)))} /><em>×</em></div>
                            <div><b>Zoom vào</b><ReviewEditable value={Number(item.zoomInDuration).toFixed(2)} label="Thời gian tới tỉ lệ zoom" numeric onCommit={(value) => updateReviewSceneField(item.id, "zoomInDuration", Math.max(0, reviewNumber(value, item.zoomInDuration)))} /><em>s</em></div>
                            <div><b>Tâm X</b><ReviewEditable value={String(item.centerX)} label="Tâm bản đồ X" numeric onCommit={(value) => updateReviewSceneField(item.id, "centerX", clampPercent(reviewNumber(value, item.centerX), item.centerX))} /><em>%</em></div>
                            <div><b>Tâm Y</b><ReviewEditable value={String(item.centerY)} label="Tâm bản đồ Y" numeric onCommit={(value) => updateReviewSceneField(item.id, "centerY", clampPercent(reviewNumber(value, item.centerY), item.centerY))} /><em>%</em></div>
                          </div>
                          <div className="review-effect-timeline" aria-label={`Timeline hiệu ứng cảnh ${item.number}`}>
                            <span><b>{formatTime(0)}</b><b>{formatTime(duration / 2)}</b><b>{formatTime(duration)}</b></span>
                            <div><i className={item.zoomEnabled ? "is-active" : ""} style={{ left: `${Math.min(100, Math.max(0, (item.zoomStart / duration) * 100))}%`, width: `${Math.min(100, Math.max(1, ((item.zoomEnd - item.zoomStart) / duration) * 100))}%` }} /></div>
                          </div>
                          <div className="review-active-effects">
                            <span>Hiệu ứng nền:</span>
                            {effectSummaries.length ? effectSummaries.map((effect) => <span className="review-chip" key={effect.label}>{effect.label} · {effect.intensity}% · ×{effect.speed}</span>) : <span className="review-chip review-chip-muted">Không có</span>}
                          </div>
                          <div className="review-effect-detail-list">
                            <div className="review-detail-line review-effect-detail-line">
                              <b>Chi tiết nền:</b>{" "}
                              {effectConfigurations.map((effect) => (
                                <span key={effect.label} className={`review-effect-status ${effect.enabled ? "is-on" : "is-off"}`}>
                                  {effect.label} {effect.enabled ? `${effect.intensity}% · ×${effect.speed}` : "tắt"}
                                </span>
                              ))}
                            </div>
                            <div className="review-detail-line review-effect-detail-line">
                              <b>Hiệu ứng tối:</b>{" "}
                              {darkEffects.length ? darkEffects.map((effect, index) => (
                                <span key={effect.id} className="review-effect-status is-on">
                                  #{index + 1} {formatTime(effect.start)}–{formatTime(effect.end)} · giữ {Number(effect.holdDuration ?? 0).toFixed(1)}s · cường độ {effect.intensity}%
                                </span>
                              )) : <span className="review-effect-status is-off">tắt</span>}
                            </div>
                            <div className="review-detail-line review-effect-detail-line">
                              <b>Chuyển hình:</b>{" "}
                              {imageTransitions.length ? imageTransitions.map((image) => (
                                <span key={image.id} className="review-effect-status is-on">
                                  {image.name || "Hình ảnh"}: {reviewImageTransitionLabel(image.transition)} · {formatTime(image.start)}–{formatTime(image.transitionEnd)}
                                </span>
                              )) : <span className="review-effect-status is-off">Cắt trực tiếp hoặc chưa có hình</span>}
                            </div>
                          </div>
                          <button type="button" className="review-add-link review-add-bottom" onClick={() => reviewLayerFocus(item, "effects")}>Mở mục Hiệu ứng trong Biên soạn</button>
                        </div>
                      );
                    })}

                    <div className="review-row-label">Chữ viết <small>items</small></div>
                    {visibleScenes.map((item) => {
                      const textOverlays = item.textOverlays ?? [];
                      const visibleTextOverlays = textOverlays.filter((overlay) => overlay.visible !== false);
                      const decorations = item.mapDecorations ?? [];
                      return (
                        <div className="review-grid-cell review-basic-cell review-text-cell" key={`review-text-${item.id}`}>
                          <div className="review-text-summary">
                            <span className="review-count-chip">{visibleTextOverlays.length}/{textOverlays.length} lớp chữ đang hiện</span>
                            <span className="review-detail-line">{visibleTextOverlays.map((overlay) => overlay.name || overlay.text).slice(0, 2).join(" · ") || "Chưa có lớp chữ"}</span>
                          </div>
                          {textOverlays.length ? (
                            <div className="review-text-detail-list">
                              {textOverlays.map((overlay, index) => (
                                <article className={`review-text-detail ${overlay.visible === false ? "is-hidden" : ""}`} key={overlay.id}>
                                  <div className="review-text-detail-heading">
                                    <strong>{overlay.name || `Chữ ${index + 1}`}</strong>
                                    <span className={`review-chip ${overlay.visible === false ? "review-chip-muted" : "review-chip-orange"}`}>
                                      {overlay.visible === false ? "Đang ẩn" : "Đang hiện"}
                                    </span>
                                  </div>
                                  <p>{safeTrim(overlay.text) || "Chưa có nội dung chữ"}</p>
                                  <div className="review-detail-line">Thời gian {formatTime(overlay.start)}–{formatTime(overlay.end)} · {overlay.size}px · {overlay.style} · {overlay.font}</div>
                                  <div className="review-detail-line">Hiệu ứng: {reviewTextEffectLabel(overlay.textEffect)} · {Number(overlay.textEffectDuration ?? 0.6).toFixed(2)}s · Opacity {overlay.opacity}%</div>
                                  <div className="review-detail-line">Vị trí X {Number(overlay.x).toFixed(1)}% · Y {Number(overlay.y).toFixed(1)}% · khung {Number(overlay.width ?? 60).toFixed(1)}% × {Number(overlay.height ?? 10).toFixed(1)}%</div>
                                  <div className="review-detail-line">Màu {overlay.color} · viền {overlay.strokeWidth}px {overlay.strokeColor} · nền {overlay.borderWidth}px {overlay.borderOpacity}%</div>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <div className="review-empty-layer">Chưa có lớp chữ trong cảnh này.</div>
                          )}
                          <div className="review-detail-line review-decoration-summary">
                            <b>Trang trí bản đồ:</b>{" "}
                            {decorations.length ? decorations.map((decoration) => `${decoration.name || mapDecorationTypeLabel(decoration.type)} · ${mapDecorationTypeLabel(decoration.type)} · X${Number(decoration.x).toFixed(0)} Y${Number(decoration.y).toFixed(0)} · ${decoration.opacity}%`).join(" | ") : "Chưa có"}
                          </div>
                        </div>
                      );
                    })}

                    <div className="review-row-label">Ghi chú <small>review</small></div>
                    {visibleScenes.map((item) => (
                      <div className="review-grid-cell review-basic-cell" key={`review-note-${item.id}`}>
                        <ReviewEditable value={item.reference || "Double-click để thêm ghi chú"} label={`Ghi chú cảnh ${item.number}`} multiline className="review-note-value" onCommit={(value) => updateReviewSceneField(item.id, "reference", value)} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="review-empty-state">
                    <strong>Chưa có cảnh đang hiện</strong>
                    <span>Hãy bật hiển thị ít nhất một cảnh để mở Review tổng quan.</span>
                  </div>
                )}
              </div>
            </div>

            <footer className="review-footer">
              <span><i /> {reviewSceneCountLabel} · Cột mặc định 50% · Ctrl/Alt + cuộn chuột để phóng to/thu nhỏ</span>
              <span>Thay đổi được cập nhật trực tiếp vào Biên soạn</span>
            </footer>
          </section>
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
