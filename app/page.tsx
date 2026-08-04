"use client";

import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadDataFromGoogle, saveDataToGoogle } from "./lib/googleSheets";

type Scene = {
  id: string;
  number: number;
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
  popupDuration: number;
  voiceFile: string;
  voiceVolume: number;
  popupIn: string;
  popupOut: string;
  popupStart?: number;
  popupWidth?: number;
  popupHeight?: number;
  popupVisible?: boolean;
  backgroundVisible?: boolean;
  status: "Nháp" | "Đã duyệt";
};

const createEmptyScene = (id = "scene-01", number = 1, start = 0): Scene => ({
  id,
  number,
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
  popupDuration: 3,
  popupStart: 0.5,
  voiceFile: "",
  voiceVolume: 95,
  popupIn: "fade-slide-up",
  popupOut: "fade-slide-down",
  popupVisible: true,
  backgroundVisible: true,
  status: "Nháp",
});

const initialScenes: Scene[] = [createEmptyScene()];

const formatTime = (value: number) => {
  const rounded = Math.max(0, Math.round(value * 10) / 10);
  const minutes = Math.floor(rounded / 60);
  const seconds = (rounded % 60).toFixed(1);
  return `${String(minutes).padStart(2, "0")}:${seconds.padStart(4, "0")}`;
};

const fileNameOnly = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return decodeURIComponent(new URL(trimmed).pathname.split("/").filter(Boolean).at(-1) ?? "");
    }
  } catch {}
  return trimmed.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? trimmed;
};

const isRemoteUrl = (value: string) => /^https?:\/\/.+/i.test(value.trim());

const assetReference = (value: string) => {
  const trimmed = value.trim();
  return isRemoteUrl(trimmed) ? trimmed : fileNameOnly(trimmed);
};

const LOCAL_STORAGE_KEY = "kito-video-studio-project";
const LOCAL_RENDERER_URL = "http://127.0.0.1:4179";

type LocalRenderState = {
  status: "idle" | "checking" | "uploading" | "rendering" | "completed" | "failed";
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
};

type StudioTab = "compose" | "export";

const DEFAULT_EDITOR_SECTIONS: EditorSectionState = {
  visual: true,
  content: true,
  audio: true,
  effects: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const clampPercent = (value: unknown, fallback = 50) => {
  const numeric = value === null || value === undefined ? Number.NaN : Number(value);
  return Math.min(100, Math.max(0, Number.isFinite(numeric) ? numeric : fallback));
};

const positiveNumber = (value: unknown, fallback: number, minimum = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, numeric) : fallback;
};

const clampVolume = (value: unknown, fallback = 100) => {
  const numeric = Number(value);
  return Math.min(100, Math.max(0, Number.isFinite(numeric) ? numeric : fallback));
};

const normalizeEditorSections = (
  sections?: Partial<EditorSectionState>,
): EditorSectionState => ({
  visual: sections?.visual ?? DEFAULT_EDITOR_SECTIONS.visual,
  content: sections?.content ?? DEFAULT_EDITOR_SECTIONS.content,
  audio: sections?.audio ?? DEFAULT_EDITOR_SECTIONS.audio,
  effects: sections?.effects ?? DEFAULT_EDITOR_SECTIONS.effects,
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
    return {
      ...item,
      id,
      title: String(item.title ?? `Cảnh ${index + 1}`),
      narration: String(item.narration ?? ""),
      popup: String(item.popup ?? ""),
      zoomStart,
      zoomEnd,
      zoomInDuration,
      zoomOutDuration: positiveNumber(item.zoomOutDuration, 0.8),
      zoom: Math.min(5, Math.max(1, positiveNumber(item.zoom, 1.25, 1))),
      centerX: clampPercent(item.centerX),
      centerY: clampPercent(item.centerY),
      zoomEnabled: item.zoomEnabled !== false,
      voiceVolume: clampVolume(item.voiceVolume, 95),
      popupVisible: item.popupVisible ?? true,
      backgroundVisible: item.backgroundVisible ?? true,
    };
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
            Hãy tải lại để lấy lại dữ liệu từ Google Sheet.
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

function Home() {
  const [scenes, setScenes] = useState(initialScenes);
  const [selectedId, setSelectedId] = useState(initialScenes[0].id);
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([
    initialScenes[0].id,
  ]);
  const [projectId, setProjectId] = useState("google-sheet-project");
  const [projectTitle, setProjectTitle] = useState("Dự án mới");
  const [projects, setProjects] = useState<ProjectSnapshot[]>([]);
  const [projectDuration, setProjectDuration] = useState(30);
  const [renderResolution, setRenderResolution] = useState<"1080x1920" | "720x1280">("1080x1920");
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
  const [localRenderFiles, setLocalRenderFiles] = useState<File[]>([]);
  const [assetPreviewUrls, setAssetPreviewUrls] = useState<Record<string, string>>({});
  const [assetLibrary, setAssetLibrary] = useState<AssetLibraryItem[]>([]);
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[]>([]);
  const [clipboardScene, setClipboardScene] = useState<Scene | null>(null);
  const [localRenderState, setLocalRenderState] = useState<LocalRenderState>({
    status: "idle",
    progress: 0,
    message: "Chưa kết nối dịch vụ render cục bộ",
  });
  const [draggingZoomCenter, setDraggingZoomCenter] = useState(false);
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
  const historyPast = useRef<ProjectSnapshot[]>([]);
  const historyFuture = useRef<ProjectSnapshot[]>([]);
  const historySnapshot = useRef("");
  const historyApplying = useRef(false);
  const [, setHistoryVersion] = useState(0);
  const timelinePopupMoved = useRef(false);

  const scene = scenes.find((item) => item.id === selectedId) ?? scenes[0] ?? initialScenes[0];
  const totalDuration = Math.max(0, ...scenes.map((item) => item.end));
  const renderDuration = Math.max(projectDuration, totalDuration);
  const wordCount = scene.narration.trim().split(/\s+/).filter(Boolean).length;
  const voiceEstimate = Math.max(1, Math.ceil((wordCount / 145) * 60));
  const assetPreviewSource = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    return isRemoteUrl(trimmed)
      ? trimmed
      : assetPreviewUrls[fileNameOnly(trimmed)] ?? "";
  };
  const imagePreviewSource = imageEnabled ? assetPreviewSource(scene.image) : "";
  const legacyBackgroundPreview = previewBackground.trim() || background.trim();
  const backgroundPreviewSource =
    assetPreviewSource(scene.background ?? "") ||
    assetPreviewSource(legacyBackgroundPreview);
  const narrationPreviewSource =
    audioPreview[scene.id] || assetPreviewSource(scene.voiceFile);
  const musicPreviewSource =
    backgroundMusicPreview || assetPreviewSource(backgroundMusic);
  const sceneDuration = Math.max(0.1, scene.end - scene.start);
  const sceneLocalTime = Math.min(
    sceneDuration,
    Math.max(0, playTime - scene.start),
  );
  const timelineProgress = projectDuration > 0
    ? Math.min(1, Math.max(0, playTime / projectDuration))
    : 0;
  const popupStartTime = Math.min(
    sceneDuration,
    Math.max(0, Number(scene.popupStart ?? 0)),
  );
  const popupEndTime = Math.min(sceneDuration, popupStartTime + scene.popupDuration);
  const popupTransitionDuration = Math.min(0.65, scene.popupDuration / 3);
  const popupPlaybackPhase = !playing
    ? "idle"
    : sceneLocalTime < popupStartTime + popupTransitionDuration
      ? "opening"
      : sceneLocalTime > popupEndTime - popupTransitionDuration
        ? "closing"
        : "visible";
  const popupPlaybackVisible =
    scene.popupVisible !== false &&
    (!playing ||
      (sceneLocalTime >= popupStartTime && sceneLocalTime <= popupEndTime));
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

  const openProject = (project: ProjectSnapshot, preserveHistory = false) => {
    setProjectId(project.id);
    setProjectTitle(project.title);
    setProjectDuration(project.projectDuration);
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

  useEffect(() => {
    let cancelled = false;

    const restoreProject = async () => {
      let restoredLocally = false;
      let cloudLoaded = false;
      let cloudFailed = false;

      try {
        const cloudData = await loadDataFromGoogle();
        if (!cancelled && cloudData && applyStoredProject(cloudData)) {
          cloudLoaded = true;
          lastSavedProjectSnapshot.current = JSON.stringify(cloudData);
          setSaveStatus("saved");
          setLastSavedAt(new Date());
        }
      } catch {
        cloudFailed = true;
      }

      if (cloudLoaded) {
        if (!cancelled) setHydrated(true);
        return;
      }

      try {
        const localValue = window.localStorage.getItem(LOCAL_STORAGE_KEY);
        if (localValue) {
          const localData = JSON.parse(localValue);
          if (isBundledSampleWorkspace(localData)) {
            window.localStorage.removeItem(LOCAL_STORAGE_KEY);
          } else {
            restoredLocally = applyStoredProject(localData);
          }
          if (restoredLocally) {
            lastSavedProjectSnapshot.current = localValue;
            setSaveStatus("offline");
          }
        }
      } catch {
        window.localStorage.removeItem(LOCAL_STORAGE_KEY);
      }

      if (!cancelled && !restoredLocally) {
        setSaveStatus(cloudFailed ? "error" : "saved");
      }
      if (!cancelled) setHydrated(true);
    };

    restoreProject();
    return () => {
      cancelled = true;
    };
  }, []);

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
    const currentSnapshot = JSON.stringify(storedProject);
    window.localStorage.setItem(
      LOCAL_STORAGE_KEY,
      currentSnapshot,
    );
    setSaveStatus("saving");
    try {
      await saveDataToGoogle(storedProject);
      const now = new Date();
      setSaveStatus("saved");
      setLastSavedAt(now);
      setToast("Đã lưu dự án lên Google Sheet");
    } catch {
      setSaveStatus("offline");
      setToast("Đã lưu trên thiết bị · Google Sheet tạm thời lỗi");
    }
    lastSavedProjectSnapshot.current = currentSnapshot;
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
        const firstScene = scenes[0];
        setPlayTime(firstScene?.start ?? 0);
        setPlaying(false);
        if (firstScene) {
          setSelectedId(firstScene.id);
          setSelectedSceneIds([firstScene.id]);
        }
        return;
      }
      setPlayTime(nextTime);
      const activeScene = scenes.find(
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
  }, [playing, projectDuration, scenes]);

  useEffect(() => {
    narrationAudio.current?.pause();
    narrationAudio.current = null;
    if (!playing || !narrationEnabled) return;
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
  }, [playing, selectedId, narrationEnabled, narrationPreviewSource, scene.start, scene.voiceVolume]);

  useEffect(() => {
    backgroundMusicAudio.current?.pause();
    backgroundMusicAudio.current = null;
    if (!playing || !backgroundMusic.trim()) return;
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
    setPlayTime(primary.start);
  };

  const openTimelineEditor = (
    item: Scene | null,
    targetId: "editor-popup" | "editor-audio" | "editor-music",
  ) => {
    if (item) {
      setSelectedId(item.id);
      setSelectedSceneIds([item.id]);
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
    const resumeAt = playTime >= projectDuration ? 0 : playTime;
    setPlayTime(resumeAt);
    const activeScene =
      scenes.find((item) => resumeAt >= item.start && resumeAt < item.end) ??
      scenes[0];
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
        scenes.find(
          (item) =>
            nextTime >= item.start &&
            (nextTime < item.end || nextTime === projectDuration),
        ) ?? scenes.at(nextTime === projectDuration ? -1 : 0);
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
        scenes.find(
          (item) =>
            nextTime >= item.start &&
            (nextTime < item.end || nextTime === projectDuration),
        ) ?? scenes.at(nextTime === projectDuration ? -1 : 0);
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

  const updateCurrentScene = <K extends keyof Scene>(key: K, value: Scene[K]) => {
    if (!hydrated) return;
    setScenes((items) =>
      items.map((item) => (item.id === selectedId ? { ...item, [key]: value } : item)),
    );
  };

  const updatePopupStart = (value: number) => {
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    setScenes((items) =>
      items.map((item) => {
        if (!targetIds.has(item.id)) return item;
        const duration = Math.max(0.1, item.end - item.start);
        const popupDuration = Math.min(
          Math.max(0.1, item.popupDuration),
          duration,
        );
        const nextStart = Math.min(
          Math.max(0, duration - popupDuration),
          Math.max(0, Number(value) || 0),
        );
        return {
          ...item,
          popupStart: Number(nextStart.toFixed(2)),
          popupDuration: Number(popupDuration.toFixed(2)),
        };
      }),
    );
  };

  const updatePopupDuration = (value: number) => {
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    setScenes((items) =>
      items.map((item) => {
        if (!targetIds.has(item.id)) return item;
        const duration = Math.max(0.1, item.end - item.start);
        const popupStart = Math.min(
          Math.max(0, Number(item.popupStart ?? 0) || 0),
          Math.max(0, duration - 0.1),
        );
        const nextDuration = Math.min(
          Math.max(0.1, Number(value) || 0.1),
          Math.max(0.1, duration - popupStart),
        );
        return {
          ...item,
          popupStart: Number(popupStart.toFixed(2)),
          popupDuration: Number(nextDuration.toFixed(2)),
        };
      }),
    );
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
    const nextLibrary = [
      ...projects.filter((item) => item.id !== projectId),
      currentProject,
    ];
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

  const addScene = () => {
    const last = scenes.at(-1) ?? createEmptyScene();
    const number = scenes.length + 1;
    const next: Scene = {
      id: `scene-${Date.now().toString(36)}-${number}`,
      number,
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
      popupDuration: 2,
      popupStart: 0.5,
      voiceFile: "",
      voiceVolume: 95,
      popupIn: "fade-slide-up",
      popupOut: "fade-slide-down",
      status: "Nháp",
    };
    setScenes((items) => [...items, next]);
    setProjectDuration((duration) => Math.max(duration, next.end));
    setSelectedId(next.id);
    setSelectedSceneIds([next.id]);
  };

  const duplicateScene = (source = scene) => {
    if (!source) return;
    const sourceIndex = scenes.findIndex((item) => item.id === source.id);
    const insertIndex = sourceIndex >= 0
      ? sourceIndex + 1
      : Math.max(0, scenes.findIndex((item) => item.id === selectedId) + 1);
    const copied: Scene = {
      ...source,
      id: `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    };
    const nextScenes = [...scenes];
    nextScenes.splice(insertIndex, 0, copied);
    const reflowed = reflowSceneTimeline(nextScenes);
    setScenes(reflowed);
    setProjectDuration((duration) => Math.max(duration, reflowed.at(-1)?.end ?? duration));
    setSelectedId(copied.id);
    setSelectedSceneIds([copied.id]);
    setPlayTime(copied.start);
    setToast("Đã nhân bản cảnh");
    window.setTimeout(() => setToast(""), 2200);
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
    const countLabel = idsToDelete.length > 1 ? `${idsToDelete.length} cảnh` : `cảnh “${scene.title}”`;
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
    const startWidth = scene.popupWidth ?? 90;
    const startHeight = scene.popupHeight ?? 255;

    const resize = (moveEvent: PointerEvent) => {
      const width = Math.min(
        96,
        Math.max(55, startWidth + ((moveEvent.clientX - startX) / bounds.width) * 100),
      );
      const height = Math.min(
        440,
        Math.max(170, startHeight + moveEvent.clientY - startY),
      );
      setScenes((items) =>
        items.map((item) =>
          item.id === selectedId
            ? { ...item, popupWidth: Math.round(width), popupHeight: Math.round(height) }
            : item,
        ),
      );
    };
    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", resize);
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

  const startTimelineResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = timelineHeight;
    const move = (moveEvent: PointerEvent) => {
      const nextHeight = Math.min(
        520,
        Math.max(220, startHeight + startY - moveEvent.clientY),
      );
      setTimelineHeight(Math.round(nextHeight));
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
  ) => {
    if (playing) return;
    if (mode !== "move") event.preventDefault();
    event.stopPropagation();
    const track = event.currentTarget.closest(".track-content");
    if (!(track instanceof HTMLElement)) return;
    const bounds = track.getBoundingClientRect();
    const originalScene = scenes.find((item) => item.id === sceneId);
    if (!originalScene || bounds.width <= 0) return;
    const sceneDuration = Math.max(0.1, originalScene.end - originalScene.start);
    const originalStart = Math.min(
      Math.max(0, Number(originalScene.popupStart ?? 0) || 0),
      sceneDuration,
    );
    const originalDuration = Math.min(
      Math.max(0.1, Number(originalScene.popupDuration) || 0.1),
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
          return {
            ...item,
            popupStart: Number(nextStart.toFixed(2)),
            popupDuration: Number(Math.max(0.1, nextEnd - nextStart).toFixed(2)),
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
      const renderBackground = previewBackground.trim() || background.trim();
      return {
        title: projectTitle,
        duration: renderDuration,
        resolution: renderResolution,
        fps: renderFps,
        ...(renderBackground
          ? { background: assetReference(renderBackground) }
          : {}),
        ...(backgroundMusic.trim()
          ? {
              backgroundMusic: backgroundMusic.trim(),
              backgroundMusicVolume: Math.round(clampVolume(backgroundMusicVolume, 18)),
            }
          : {}),
        scenes: scenes.map((item) => {
          const image = imageEnabled ? assetReference(item.image) : "";
          const sceneBackground = assetReference(item.background ?? "");
          const voiceFile = narrationEnabled ? assetReference(item.voiceFile) : "";
          return {
            milestone: item.number,
            title: item.title,
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
            popupDuration: item.popupDuration,
            popupStart: item.popupStart ?? 0,
            body: item.popup,
            imageVisible: imageEnabled,
            ...(sceneBackground ? { background: sceneBackground } : {}),
            backgroundVisible: item.backgroundVisible !== false,
            ...(image ? { image } : {}),
            narration: narrationEnabled ? item.narration : "",
            ...(voiceFile ? { voiceFile } : {}),
            voiceVolume: Math.round(clampVolume(item.voiceVolume, 95)),
            popupIn: item.popupIn,
            popupOut: item.popupOut,
            popupWidth: item.popupWidth ?? 90,
            popupHeight: item.popupHeight ?? 255,
            popupVisible: item.popupVisible !== false,
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
        item.background ?? "",
        item.image ?? "",
        item.voiceFile ?? "",
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
    const addSourceCheck = (
      id: string,
      label: string,
      value: string,
      required: boolean,
    ) => {
      const source = value.trim();
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

    const legacyBackground = previewBackground.trim() || background.trim();
    if (legacyBackground) {
      addSourceCheck(
        "legacy-background",
        "Background mặc định",
        legacyBackground,
        false,
      );
    }
    if (backgroundMusic.trim()) {
      addSourceCheck("background-music", "Nhạc nền", backgroundMusic, true);
    } else {
      checks.push({ id: "background-music", label: "Nhạc nền", status: "warning", detail: "Không dùng nhạc nền." });
    }
    scenes.forEach((item) => {
      addSourceCheck(
        `scene-${item.id}-background`,
        `Background cảnh ${item.number}`,
        item.background ?? "",
        false,
      );
      addSourceCheck(`scene-${item.id}-image`, `Ảnh cảnh ${item.number}`, imageEnabled ? item.image : "", imageEnabled);
      addSourceCheck(`scene-${item.id}-audio`, `Âm thanh cảnh ${item.number}`, narrationEnabled ? item.voiceFile : "", narrationEnabled);
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
          return;
        }
        if (status.status === "failed") {
          throw Object.assign(new Error(status.message || "Render thất bại"), { log: status.log });
        }
        setLocalRenderState({
          status: "rendering",
          progress: Number(status.progress) || 5,
          message: status.message || "Đang render video…",
        });
      }
    } catch (error) {
      setLocalRenderState({
        status: "failed",
        progress: 0,
        message: error instanceof Error ? error.message : "Không thể render video",
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
        `CẢNH ${item.milestone}: ${item.title}`,
        `- Thời gian: ${item.start}s–${nextStart}s (thời lượng ${sceneDuration}s).`,
        `- Hình ảnh: ${item.image ?? "Không có"}${item.image ? ` (tên file: ${fileNameOnly(item.image)})` : ""}.`,
        `- Background cảnh: ${item.background ?? "map.png mặc định"}${item.background ? ` (tên file: ${fileNameOnly(item.background)})` : ""}.`,
        `- File thuyết minh: ${item.voiceFile ?? "Không có"}${item.voiceFile ? ` (tên file: ${fileNameOnly(item.voiceFile)})` : ""}, âm lượng ${item.voiceVolume}%.`,
        `- Lời thuyết minh: ${item.narration || "Không có"}.`,
        `- Nội dung popup: ${item.body || "Không có"}.`,
        `- Zoom bản đồ: ${item.zoomEnabled ? `bắt đầu sau ${item.zoomStart}s, đạt ${item.zoom}x trong ${item.zoomInDuration}s, kết thúc ở ${item.zoomEnd}s, zoom về trong ${item.zoomOutDuration}s, tâm X=${item.centerX}%, Y=${item.centerY}%` : "tắt"}.`,
        `- Popup: bắt đầu sau ${item.popupStart}s, hiển thị ${item.popupDuration}s, kích thước ${item.popupWidth}% × ${item.popupHeight}px, hiệu ứng mở "${item.popupIn}", hiệu ứng đóng "${item.popupOut}", trạng thái ${item.popupVisible ? "hiện" : "ẩn"}.`,
      ].join("\n");
    });

    return [
      "PROMPT TẠO VIDEO CHI TIẾT",
      "",
      `Tạo video dọc 9:16, độ phân giải ${exportPayload.resolution}, tổng thời lượng ${exportPayload.duration} giây.`,
      `Chủ đề: ${exportPayload.title}.`,
      `Background chủ đề: ${projectBackground}${projectBackground !== "Không có" ? ` (tên file: ${fileNameOnly(projectBackground)})` : ""}.`,
      `Nhạc nền: ${musicFile}, âm lượng ${musicVolume}%.`,
      "Phong cách chuyển động điện ảnh, bố cục dễ đọc và giữ hình ảnh nhất quán giữa các cảnh.",
      "Không tự tạo thêm chữ trong hình nền. Đồng bộ popup và lời thuyết minh theo timeline dưới đây.",
      "",
      ...scenePrompts.flatMap((prompt) => [prompt, ""]),
      "YÊU CẦU KỸ THUẬT",
      `- Xuất video ${exportPayload.resolution}, tỷ lệ 9:16, thời lượng chính xác ${exportPayload.duration} giây.`,
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
      className="studio-shell"
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
        </nav>

        <div className="studio-main">
          {activeStudioTab === "compose" ? (
            <>
              <header className="topbar compose-topbar">
                <div className="brand">
                  <div>
                    <h1>Kito Video Studio</h1>
                    <p>{projectTitle} · {projectDuration} giây · 9:16</p>
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
            disabled={saveStatus === "loading" || saveStatus === "saving"}
          >
            ☁ Lưu
          </button>
          <button
            className="button history-button"
            onClick={undo}
            disabled={!historyPast.current.length}
            title="Hoàn tác (Ctrl/Cmd + Z)"
            aria-label="Hoàn tác"
          >
            ↶
          </button>
          <button
            className="button history-button"
            onClick={redo}
            disabled={!historyFuture.current.length}
            title="Làm lại (Ctrl/Cmd + Y)"
            aria-label="Làm lại"
          >
            ↷
          </button>
          <button
            className="button restore-button"
            onClick={restoreLastSavedProject}
            disabled={!lastSavedProjectSnapshot.current || saveStatus === "loading" || saveStatus === "saving"}
            title="Khôi phục bản lưu gần nhất"
          >
            ↥ Khôi phục
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
            {scenes.map((item, index) => {
              const playbackActive =
                playing && playTime >= item.start && playTime < item.end;
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
                } ${item.id === dragOverId ? "drag-over" : ""}`}
                onClick={(event) => {
                  setDraggedId(null);
                  setDragOverId(null);
                  selectScene(item, event.shiftKey);
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
                {playbackActive && index < scenes.length - 1 && (
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
                  <strong>{item.title}</strong>
                  <small>
                    {formatTime(item.start)}–{formatTime(item.end)}
                  </small>
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

        <section className="preview-panel">
          <div className="panel-heading preview-panel-heading">
            <h2>Xem trước cảnh</h2>
            <div className="preview-heading-actions">
              <button
                className="button ghost preview-play-button"
                disabled={!hydrated}
                onClick={togglePlayback}
              >
                <span className="play-icon">{playing ? "Ⅱ" : "▶"}</span>
                {!hydrated ? "Đang tải..." : playing ? "Tạm dừng" : "Xem thử"}
              </button>
              <span className="time-pill">{formatTime(scene.start)}</span>
            </div>
          </div>
          <div className={`phone-preview ${playing ? "is-playing" : ""}`}>
            {scene.backgroundVisible !== false && backgroundPreviewSource && (
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
            )}
            {playing && (
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
            <div className="preview-progress">
              <span style={{ width: `${(playTime / projectDuration) * 100}%` }} />
            </div>
            {popupPlaybackVisible && (
              <article
                className={`preview-card ${
                  playing
                    ? `playback-popup popup-${popupPlaybackPhase} popup-in-${scene.popupIn} popup-out-${scene.popupOut}`
                    : ""
                }`}
                style={{
                  width: `${scene.popupWidth ?? 90}%`,
                  height: `${scene.popupHeight ?? 255}px`,
                  ["--popup-transition-duration" as string]: `${popupTransitionDuration}s`,
                }}
              >
              {imageEnabled && (
                <div className="photo-placeholder">
                  {imagePreviewSource ? (
                    <img src={imagePreviewSource} alt={`Ảnh minh họa ${scene.title}`} />
                  ) : (
                    <>
                      <div className="sun" />
                      <div className="hill hill-a" />
                      <div className="hill hill-b" />
                      <span>Nhập URL ảnh để xem trước</span>
                    </>
                  )}
                </div>
              )}
              <div className="card-content">
                <h3>{scene.title}</h3>
                <p>{scene.popup}</p>
              </div>
              <button
                className="popup-resize-handle"
                aria-label="Kéo để thay đổi kích thước popup"
                title="Kéo để phóng to hoặc thu nhỏ popup"
                onPointerDown={startPopupResize}
              />
              </article>
            )}
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
              <summary className="editor-group-label"><span>01</span> Hình ảnh & nền <i /></summary>
              <div className="editor-accordion-content">
            <label className="field background-field">
              <span>Background chủ đề cảnh {scene.number}</span>
              <input
                type="text"
                inputMode="url"
                placeholder="https://example.com/background.jpg"
                value={scene.background ?? ""}
                onChange={(event) => updateScene("background", event.target.value)}
              />
              {isRemoteUrl(scene.background ?? "") && (
                <div className="image-url-preview">
                  <img src={scene.background} alt={`Xem trước background cảnh ${scene.number}`} />
                  <span>Background này chỉ áp dụng cho cảnh đang chọn.</span>
                </div>
              )}
              <small>Nhập URL hoặc tên file riêng cho cảnh. URL sẽ được renderer tự tải về và dùng lại nếu các cảnh trùng tài nguyên.</small>
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
                className={`button editor-visibility-button ${scene.popupVisible !== false ? "active" : ""}`}
                title={scene.popupVisible !== false ? "Ẩn popup khỏi xem trước" : "Hiện popup trong xem trước"}
                onClick={() => updateCurrentScene("popupVisible", scene.popupVisible === false)}
              >
                {scene.popupVisible !== false ? "◉ Ẩn popup" : "⊘ Hiện popup"}
              </button>
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
              <summary className="editor-group-label"><span>02</span> Nội dung cảnh <i /></summary>
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
              <span>Tiêu đề</span>
              <input
                value={scene.title}
                onChange={(event) => updateScene("title", event.target.value)}
              />
            </label>
            <label className="field">
              <span>Nội dung popup</span>
              <textarea
                value={scene.popup}
                onChange={(event) => updateScene("popup", event.target.value)}
              />
              <small>{scene.popup.length}/180 ký tự</small>
            </label>
            <label className="field">
              <span>Lời thuyết minh</span>
              <textarea
                value={scene.narration}
                onChange={(event) => updateScene("narration", event.target.value)}
              />
              <small>{wordCount} từ · Ước tính {voiceEstimate} giây</small>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Ảnh popup</span>
                <input
                  type="url"
                  placeholder="https://example.com/image.jpg"
                  value={scene.image}
                  onChange={(event) => updateScene("image", event.target.value)}
                />
                {imagePreviewSource && (
                  <div className="image-url-preview">
                    <img src={imagePreviewSource} alt="Xem trước ảnh popup" />
                    <span>Đang hiển thị đúng tài nguyên sẽ dùng khi render</span>
                  </div>
                )}
              </label>
              <label className="field">
                <span>Giọng đọc</span>
                <select
                  value={scene.voice}
                  onChange={(event) => updateScene("voice", event.target.value)}
                >
                  <option>Nam trầm</option>
                  <option>Nữ ấm</option>
                  <option>Nam trẻ</option>
                </select>
              </label>
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
              <summary className="editor-group-label"><span>03</span> Âm thanh <i /></summary>
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
              <summary className="editor-group-label"><span>04</span> Hiệu ứng <i /></summary>
              <div className="editor-accordion-content">
                <div className="zoom-settings-card">
                  <div className="motion-settings-title">
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
              </div>
            </details>
            <details
              className="editor-accordion"
              open={editorSections.content}
            >
              <summary className="editor-group-label"><span>05</span> Popup <i /></summary>
              <div className="editor-accordion-content">
            <div className="popup-motion-settings-card" id="editor-popup">
              <div className="motion-settings-title">
                <strong>Popup</strong>
                <span>Thời gian và hiệu ứng xuất hiện</span>
              </div>
              <label className="field">
                <span>Thời gian bắt đầu xuất hiện popup</span>
                <div className="number-with-unit">
                  <input
                    type="number"
                    min="0"
                    max={Math.max(0, sceneDuration - 0.1)}
                    step="0.1"
                    value={scene.popupStart ?? 0}
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
                  value={scene.popupDuration}
                  onChange={(event) => updatePopupDuration(Number(event.target.value))}
                />
                <div className="number-with-unit popup-duration-number">
                  <input
                    type="number"
                    min="1"
                    max={Math.max(6, sceneDuration)}
                    step="0.1"
                    value={scene.popupDuration}
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
                  value={scene.popupIn}
                  onChange={(event) => updateScene("popupIn", event.target.value)}
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
                  value={scene.popupOut}
                  onChange={(event) => updateScene("popupOut", event.target.value)}
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
            <span>{projectDuration} giây · {scenes.length} cảnh · {renderFps} FPS</span>
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
              {Array.from({ length: 6 }, (_, index) => (
                <i key={index}>{(projectDuration / 5) * index}s</i>
              ))}
            </div>
          </div>
          <div className="track">
            <strong>Popup</strong>
            <div className="track-content grid">
              {scenes.filter((item) => item.popupVisible !== false).map((item) => {
                const sceneLength = Math.max(0.1, item.end - item.start);
                const popupStart = Math.min(
                  sceneLength,
                  Math.max(0, Number(item.popupStart ?? 0) || 0),
                );
                const popupDuration = Math.min(
                  Math.max(0.1, Number(item.popupDuration) || 0.1),
                  Math.max(0.1, sceneLength - popupStart),
                );
                return (
                  <button
                    key={item.id}
                    onPointerDown={(event) => startTimelinePopupDrag(event, item.id, "move")}
                    onClick={(event) => {
                      if (timelinePopupMoved.current) {
                        event.preventDefault();
                        event.stopPropagation();
                        timelinePopupMoved.current = false;
                        return;
                      }
                      openTimelineEditor(item, "editor-popup");
                    }}
                    className={`clip popup-clip ${!playing && item.id === selectedId ? "selected" : ""}`}
                    style={{
                      left: `${((item.start + popupStart) / projectDuration) * 100}%`,
                      width: `${Math.min((popupDuration / projectDuration) * 100, 100 - ((item.start + popupStart) / projectDuration) * 100)}%`,
                    }}
                  >
                    <span
                      className="timeline-edge-handle timeline-edge-start"
                      title="Kéo để đổi thời gian bắt đầu popup"
                      aria-label="Điểm bắt đầu popup"
                      onPointerDown={(event) => startTimelinePopupDrag(event, item.id, "start")}
                      onClick={(event) => event.stopPropagation()}
                    />
                    <span className="timeline-clip-label">Popup {item.number} · {popupDuration}s</span>
                    <span
                      className="timeline-edge-handle timeline-edge-end"
                      title="Kéo để đổi thời lượng popup"
                      aria-label="Điểm kết thúc popup"
                      onPointerDown={(event) => startTimelinePopupDrag(event, item.id, "end")}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="track">
            <strong>Thuyết minh</strong>
            <div className="track-content grid">
              {narrationEnabled && scenes.map((item) => (
                <button
                  key={item.id}
                  className="clip voice-clip"
                  onClick={() => openTimelineEditor(item, "editor-audio")}
                  style={{
                    left: `${(item.start / projectDuration) * 100}%`,
                    width: `${((item.end - item.start) / projectDuration) * 100}%`,
                  }}
                >
                  🎙 {item.voiceFile || `Thuyết minh ${item.number}`}
                </button>
              ))}
            </div>
          </div>
          <div className="track">
            <strong>Nhạc nền</strong>
            <div className="track-content grid">
              <button
                className={`clip music-clip ${backgroundMusic ? "" : "is-empty"}`}
                onClick={() => openTimelineEditor(null, "editor-music")}
                style={{ left: "0%", width: "100%" }}
              >
                ♫ {backgroundMusic || "Chưa có nhạc nền · Bấm để thêm"}
              </button>
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
          ) : (
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
                    <span>{renderResolution}</span>
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
                        <span>Độ phân giải</span>
                        <div className="export-segmented" role="group" aria-label="Độ phân giải render">
                          <button
                            type="button"
                            className={renderResolution === "1080x1920" ? "active" : ""}
                            onClick={() => setRenderResolution("1080x1920")}
                          >
                            1080×1920
                          </button>
                          <button
                            type="button"
                            className={renderResolution === "720x1280" ? "active" : ""}
                            onClick={() => setRenderResolution("720x1280")}
                          >
                            720×1280
                          </button>
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
              ) : (
                <button
                  className="button primary"
                  disabled={localRenderState.status === "uploading" || localRenderState.status === "rendering"}
                  onClick={() => void startLocalRender()}
                >
                  {localRenderState.status === "rendering" ? "Đang render…" : "Bắt đầu render"}
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
