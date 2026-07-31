"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  start: number;
  end: number;
  zoomInDuration: number;
  popupDuration: number;
  zoomOutDuration: number;
  zoom: number;
  centerX: number;
  centerY: number;
  voiceFile: string;
  popupIn: string;
  popupOut: string;
  popupWidth?: number;
  popupHeight?: number;
  popupVisible?: boolean;
  zoomMarkerEffect?: "none" | "glow" | "blink" | "soft-fade";
  zoomMarkerDuration?: number;
  zoomMarkerSize?: number;
  status: "Nháp" | "Đã duyệt";
};

const initialScenes: Scene[] = [
  {
    id: "scene-01",
    number: 1,
    title: "Samuel xức dầu",
    location: "Bêlem",
    reference: "1 Sm 16,1–13",
    popup: "Thiên Chúa sai ngôn sứ Samuel đến nhà ông Giêsê để xức dầu cho Đavít.",
    narration:
      "Tại Bêlem, Đavít được ngôn sứ Samuel xức dầu, trở thành người Thiên Chúa tuyển chọn.",
    voice: "Nam trầm",
    image: "media/samuel-anoints-david.jpg",
    start: 0,
    end: 5.5,
    zoomInDuration: 1,
    popupDuration: 3,
    zoomOutDuration: 1.5,
    zoom: 2.25,
    centerX: 20.6,
    centerY: 10.7,
    voiceFile: "audio/milestone-1.mp3",
    popupIn: "fade-slide-up",
    popupOut: "fade-slide-down",
    status: "Đã duyệt",
  },
  {
    id: "scene-02",
    number: 2,
    title: "Đánh bại Gôliát",
    location: "Thung lũng Êla",
    reference: "1 Sm 17,45–50",
    popup: "Đavít đối diện Gôliát chỉ với chiếc ná và lòng tin mạnh mẽ.",
    narration:
      "Không dựa vào gươm giáo, Đavít chiến thắng Gôliát bằng lòng can đảm và niềm tin.",
    voice: "Nam trầm",
    image: "media/david-goliath.jpg",
    start: 5.5,
    end: 12,
    zoomInDuration: 1,
    popupDuration: 3,
    zoomOutDuration: 1.5,
    zoom: 2.1,
    centerX: 45.2,
    centerY: 38.5,
    voiceFile: "audio/milestone-2.mp3",
    popupIn: "fade-slide-up",
    popupOut: "fade-slide-down",
    status: "Nháp",
  },
  {
    id: "scene-03",
    number: 3,
    title: "Màn hình kết",
    location: "Giêrusalem",
    reference: "2 Sm 5,4–5",
    popup: "Từ người chăn chiên, Đavít trở thành vị vua được dân Ítraen yêu mến.",
    narration: "Hành trình của Đavít là câu chuyện về niềm tin, can đảm và ơn gọi.",
    voice: "Nữ ấm",
    image: "media/david-king.jpg",
    start: 12,
    end: 15,
    zoomInDuration: 0.5,
    popupDuration: 2.5,
    zoomOutDuration: 0,
    zoom: 1.8,
    centerX: 72.4,
    centerY: 61.3,
    voiceFile: "audio/milestone-3.mp3",
    popupIn: "fade-slide-up",
    popupOut: "fade-slide-down",
    status: "Nháp",
  },
];

const formatTime = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(4, "0")}`;

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

const LOCAL_STORAGE_KEY = "kito-video-studio-project";
const LOCAL_RENDERER_URL = "http://127.0.0.1:4179";

type LocalRenderState = {
  status: "idle" | "checking" | "uploading" | "rendering" | "completed" | "failed";
  progress: number;
  message: string;
  downloadUrl?: string;
  log?: string;
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
  editorSections?: EditorSectionState;
  timelineVisible?: boolean;
  scenes: Scene[];
};

type EditorSectionState = {
  visual: boolean;
  content: boolean;
  audio: boolean;
  motion: boolean;
};

const DEFAULT_EDITOR_SECTIONS: EditorSectionState = {
  visual: true,
  content: true,
  audio: true,
  motion: true,
};

const ensureUniqueSceneIds = (items: Scene[]) => {
  const used = new Set<string>();
  return items.map((item, index) => {
    let id = item.id || `scene-${index + 1}`;
    let suffix = 2;
    while (used.has(id)) {
      id = `${item.id || `scene-${index + 1}`}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return { ...item, id };
  });
};

type ProjectSnapshot = Omit<StoredProject, "version"> & {
  id: string;
  title: string;
};

type StoredWorkspace = {
  version: 2;
  activeProjectId: string;
  projects: ProjectSnapshot[];
};

export default function Home() {
  const [scenes, setScenes] = useState(initialScenes);
  const [selectedId, setSelectedId] = useState(initialScenes[0].id);
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([
    initialScenes[0].id,
  ]);
  const [projectId, setProjectId] = useState("david-journey");
  const [projectTitle, setProjectTitle] = useState("Hành trình Vua Đa-vít");
  const [projects, setProjects] = useState<ProjectSnapshot[]>([]);
  const [projectDuration, setProjectDuration] = useState(30);
  const [imageEnabled, setImageEnabled] = useState(true);
  const [narrationEnabled, setNarrationEnabled] = useState(true);
  const [background, setBackground] = useState("");
  const [previewBackground, setPreviewBackground] = useState("");
  const [backgroundVisible, setBackgroundVisible] = useState(true);
  const [backgroundMusic, setBackgroundMusic] = useState("");
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
  const [showZoomSetup, setShowZoomSetup] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [audioPreview, setAudioPreview] = useState<Record<string, string>>({});
  const [localRenderFiles, setLocalRenderFiles] = useState<File[]>([]);
  const [localRenderState, setLocalRenderState] = useState<LocalRenderState>({
    status: "idle",
    progress: 0,
    message: "Chưa kết nối dịch vụ render cục bộ",
  });
  const [draggingZoomCenter, setDraggingZoomCenter] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mapPreviewZoom, setMapPreviewZoom] = useState<Record<string, number>>({});
  const [mapFocused, setMapFocused] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(245);
  const [timelineVisible, setTimelineVisible] = useState(true);
  const animationFrame = useRef<number | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const narrationAudio = useRef<HTMLAudioElement | null>(null);
  const zoomCenterMoved = useRef(false);

  const scene = scenes.find((item) => item.id === selectedId) ?? scenes[0];
  const totalDuration = Math.max(...scenes.map((item) => item.end));
  const wordCount = scene.narration.trim().split(/\s+/).filter(Boolean).length;
  const voiceEstimate = Math.max(1, Math.ceil((wordCount / 145) * 60));
  const isRemoteImage = /^https?:\/\/.+/i.test(scene.image.trim());
  const sceneDuration = Math.max(0.1, scene.end - scene.start);
  const sceneLocalTime = Math.min(
    sceneDuration,
    Math.max(0, playTime - scene.start),
  );
  const editingMapScale = mapPreviewZoom[scene.id] ?? 1;
  const playbackMapScale = (() => {
    if (!playing) return editingMapScale;
    if (scene.zoomInDuration > 0 && sceneLocalTime < scene.zoomInDuration) {
      const progress = sceneLocalTime / scene.zoomInDuration;
      return 1 + (scene.zoom - 1) * progress;
    }
    const zoomOutStart = sceneDuration - scene.zoomOutDuration;
    if (scene.zoomOutDuration > 0 && sceneLocalTime > zoomOutStart) {
      const progress = Math.min(
        1,
        (sceneLocalTime - zoomOutStart) / scene.zoomOutDuration,
      );
      return scene.zoom - (scene.zoom - 1) * progress;
    }
    return scene.zoom;
  })();
  const popupStartTime = scene.zoomInDuration;
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

  const currentProject = useMemo<ProjectSnapshot>(
    () => ({
      id: projectId,
      title: projectTitle,
      projectDuration,
      imageEnabled,
      narrationEnabled,
      background,
      previewBackground,
      backgroundVisible,
      backgroundMusic,
      editorSections,
      timelineVisible,
      scenes,
    }),
    [
      projectId,
      projectTitle,
      projectDuration,
      imageEnabled,
      narrationEnabled,
      background,
      previewBackground,
      backgroundVisible,
      backgroundMusic,
      editorSections,
      timelineVisible,
      scenes,
    ],
  );

  const storedProject = useMemo<StoredWorkspace>(() => ({
    version: 2,
    activeProjectId: projectId,
    projects: [...projects.filter((item) => item.id !== projectId), currentProject],
  }), [projects, projectId, currentProject]);

  const openProject = (project: ProjectSnapshot) => {
    setProjectId(project.id);
    setProjectTitle(project.title);
    setProjectDuration(project.projectDuration);
    setImageEnabled(project.imageEnabled);
    setNarrationEnabled(project.narrationEnabled);
    setBackground(project.background ?? "");
    setPreviewBackground(project.previewBackground ?? "");
    setBackgroundVisible(project.backgroundVisible ?? true);
    setBackgroundMusic(project.backgroundMusic ?? "");
    const restoredScenes = ensureUniqueSceneIds(project.scenes);
    setEditorSections(project.editorSections ?? DEFAULT_EDITOR_SECTIONS);
    setTimelineVisible(project.timelineVisible ?? true);
    setScenes(restoredScenes);
    setSelectedId(restoredScenes[0]?.id ?? "");
    setSelectedSceneIds(restoredScenes[0] ? [restoredScenes[0].id] : []);
    setPlayTime(restoredScenes[0]?.start ?? 0);
    setPlaying(false);
  };

  const applyStoredProject = (
    data: Partial<StoredWorkspace> | Partial<StoredProject> | null,
  ) => {
    if (!data) return false;
    if (data.version === 2 && Array.isArray(data.projects) && data.projects.length > 0) {
      const restoredProjects = (data.projects as ProjectSnapshot[]).map((project) => ({
        ...project,
        editorSections: project.editorSections ?? DEFAULT_EDITOR_SECTIONS,
        timelineVisible: project.timelineVisible ?? true,
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
        id: "david-journey",
        title: "Hành trình Vua Đa-vít",
        projectDuration: Math.max(1, Number(data.projectDuration) || 30),
        imageEnabled: data.imageEnabled ?? true,
        narrationEnabled: data.narrationEnabled ?? true,
        background: data.background ?? "",
        previewBackground: data.previewBackground ?? "",
        backgroundVisible: data.backgroundVisible ?? true,
        backgroundMusic: data.backgroundMusic ?? "",
        editorSections: data.editorSections ?? DEFAULT_EDITOR_SECTIONS,
        timelineVisible: data.timelineVisible ?? true,
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
      try {
        const localValue = window.localStorage.getItem(LOCAL_STORAGE_KEY);
        if (localValue) {
          restoredLocally = applyStoredProject(JSON.parse(localValue));
          if (restoredLocally) setSaveStatus("offline");
        }
      } catch {
        window.localStorage.removeItem(LOCAL_STORAGE_KEY);
      }

      try {
        const cloudData = await loadDataFromGoogle();
        if (!cancelled && cloudData) {
          applyStoredProject(cloudData);
          setSaveStatus("saved");
          setLastSavedAt(new Date());
        } else if (!cancelled && !restoredLocally) {
          setSaveStatus("saved");
        }
      } catch {
        if (!cancelled) setSaveStatus(restoredLocally ? "offline" : "error");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };

    restoreProject();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("kito-video-studio-theme");
    if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("kito-video-studio-theme", theme);
  }, [theme]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;

    const handleWheel = (event: WheelEvent) => {
      if (!mapFocused || playing) return;

      event.preventDefault();
      event.stopPropagation();
      setMapPreviewZoom((items) => {
        const currentZoom = items[selectedId] ?? 1;
        const direction = event.deltaY < 0 ? 0.1 : -0.1;
        const nextZoom = Number(
          Math.min(4, Math.max(1, currentZoom + direction)).toFixed(1),
        );
        setScenes((sceneItems) =>
          sceneItems.map((item) =>
            item.id === selectedId ? { ...item, zoom: nextZoom } : item,
          ),
        );
        return { ...items, [selectedId]: nextZoom };
      });
    };

    preview.addEventListener("wheel", handleWheel, { passive: false });
    return () => preview.removeEventListener("wheel", handleWheel);
  }, [selectedId, playing, mapFocused]);

  useEffect(() => {
    const handleOutsidePointer = (event: PointerEvent) => {
      if (!previewRef.current?.contains(event.target as Node)) {
        setMapFocused(false);
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, []);

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

  useEffect(() => {
    if (!playing) {
      if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
      return;
    }

    const startedAt = performance.now() - playTime * 1000;
    const tick = () => {
      const nextTime = (performance.now() - startedAt) / 1000;
      if (nextTime >= projectDuration) {
        setPlayTime(projectDuration);
        setPlaying(false);
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
    const source = audioPreview[scene.id] || scene.voiceFile.trim();
    if (!source) return;
    const audio = new Audio(source);
    narrationAudio.current = audio;
    audio.volume = 0.95;
    audio.currentTime = Math.max(0, playTime - scene.start);
    void audio.play().catch(() => {
      // A local path that has not been uploaded is previewed silently.
    });
    return () => {
      audio.pause();
      if (narrationAudio.current === audio) narrationAudio.current = null;
    };
  }, [playing, selectedId, narrationEnabled, audioPreview, scene.voiceFile]);

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
    targetId: "editor-camera" | "editor-popup" | "editor-audio" | "editor-music",
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
      let cursor = 0;
      return reordered.map((item, index) => {
        const duration = item.end - item.start;
        const normalized = {
          ...item,
          number: index + 1,
          start: cursor,
          end: cursor + duration,
        };
        cursor += duration;
        return normalized;
      });
    });
    setDraggedId(null);
    setDragOverId(null);
  };

  const updateScene = <K extends keyof Scene>(key: K, value: Scene[K]) => {
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    setScenes((items) =>
      items.map((item) => (targetIds.has(item.id) ? { ...item, [key]: value } : item)),
    );
  };

  const updateSelectedSceneDuration = (duration: number) => {
    const nextDuration = Math.max(0.1, Number(duration) || 0.1);
    const targetIds = new Set(
      selectedSceneIds.length > 0 ? selectedSceneIds : [selectedId],
    );
    setScenes((items) => {
      let cursor = 0;
      return items.map((item) => {
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
    });
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
      ...initialScenes[0],
      id: `${id}-scene-01`,
      number: 1,
      title: "Cảnh mở đầu",
      location: "",
      reference: "",
      popup: "Nhập nội dung popup cho cảnh đầu tiên.",
      narration: "Nhập lời thuyết minh cho cảnh đầu tiên.",
      image: "",
      start: 0,
      end: 5,
      voiceFile: "",
      status: "Nháp",
    };
    const nextProject: ProjectSnapshot = {
      id,
      title,
      projectDuration: 15,
      imageEnabled: true,
      narrationEnabled: true,
      background: "",
      previewBackground: "",
      backgroundVisible: true,
      backgroundMusic: "",
      editorSections: DEFAULT_EDITOR_SECTIONS,
      timelineVisible: true,
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
    const last = scenes.at(-1)!;
    const number = scenes.length + 1;
    const next: Scene = {
      id: `scene-${Date.now().toString(36)}-${number}`,
      number,
      title: "Cảnh mới",
      location: "Địa danh mới",
      reference: "",
      popup: "Nhập nội dung popup cho cảnh mới.",
      narration: "Nhập lời thuyết minh cho cảnh mới.",
      voice: "Nam trầm",
      image: "",
      start: last.end,
      end: last.end + 3,
      zoomInDuration: 0.5,
      popupDuration: 2,
      zoomOutDuration: 0.5,
      zoom: 2,
      centerX: 50,
      centerY: 50,
      voiceFile: "",
      popupIn: "fade-slide-up",
      popupOut: "fade-slide-down",
      status: "Nháp",
    };
    setScenes((items) => [...items, next]);
    setSelectedId(next.id);
    setSelectedSceneIds([next.id]);
  };

  const deleteScene = () => {
    if (scenes.length <= 1) {
      setToast("Mỗi clip cần có ít nhất một cảnh");
      window.setTimeout(() => setToast(""), 2400);
      return;
    }
    if (!window.confirm(`Xóa cảnh “${scene.title}”?`)) return;
    const removedIndex = scenes.findIndex((item) => item.id === selectedId);
    let cursor = 0;
    const remaining = scenes
      .filter((item) => item.id !== selectedId)
      .map((item, index) => {
        const duration = item.end - item.start;
        const normalized = {
          ...item,
          number: index + 1,
          start: cursor,
          end: cursor + duration,
        };
        cursor += duration;
        return normalized;
      });
    const nextScene = remaining[Math.min(removedIndex, remaining.length - 1)];
    setScenes(remaining);
    setSelectedId(nextScene.id);
    setSelectedSceneIds([nextScene.id]);
    setPlayTime(nextScene.start);
    setToast("Đã xóa cảnh");
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

  const startZoomCenterDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const preview = event.currentTarget.closest(".phone-preview");
    if (!(preview instanceof HTMLElement)) return;
    const bounds = preview.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    zoomCenterMoved.current = false;
    setDraggingZoomCenter(true);

    const move = (moveEvent: PointerEvent) => {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 4) {
        zoomCenterMoved.current = true;
      }
      const centerX = Math.min(
        100,
        Math.max(0, ((moveEvent.clientX - bounds.left) / bounds.width) * 100),
      );
      const centerY = Math.min(
        100,
        Math.max(0, ((moveEvent.clientY - bounds.top) / bounds.height) * 100),
      );
      setScenes((items) =>
        items.map((item) =>
          item.id === selectedId
            ? {
                ...item,
                centerX: Number(centerX.toFixed(1)),
                centerY: Number(centerY.toFixed(1)),
              }
            : item,
        ),
      );
    };
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

  const exportPayload = useMemo(
    () => ({
      title: projectTitle,
      duration: projectDuration,
      resolution: "1080x1920",
      ...(background.trim()
        ? { background: fileNameOnly(background) }
        : {}),
      ...(backgroundMusic.trim()
        ? { backgroundMusic: backgroundMusic.trim() }
        : {}),
      scenes: scenes.map((item) => {
        const image = imageEnabled ? fileNameOnly(item.image) : "";
        const voiceFile = narrationEnabled ? fileNameOnly(item.voiceFile) : "";
        return {
          milestone: item.number,
          title: item.title,
          start: item.start,
          zoomInDuration: item.zoomInDuration,
          popupDuration: item.popupDuration,
          zoomOutDuration: item.zoomOutDuration,
          zoom: item.zoom,
          centerX: item.centerX,
          centerY: item.centerY,
          body: item.popup,
          ...(image ? { image } : {}),
          narration: narrationEnabled ? item.narration : "",
          ...(voiceFile ? { voiceFile } : {}),
          popupIn: item.popupIn,
          popupOut: item.popupOut,
          popupWidth: item.popupWidth ?? 90,
          popupHeight: item.popupHeight ?? 255,
          popupVisible: item.popupVisible !== false,
          zoomMarkerEffect: item.zoomMarkerEffect ?? "none",
          zoomMarkerDuration: item.zoomMarkerDuration ?? 1,
          zoomMarkerSize: item.zoomMarkerSize ?? 28,
        };
      }),
    }),
    [
      scenes,
      imageEnabled,
      narrationEnabled,
      projectDuration,
      projectTitle,
      background,
      backgroundMusic,
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
      ...exportPayload.scenes.flatMap((item) => [item.image ?? "", item.voiceFile ?? ""]),
    ];
    return [...new Set(values.filter((value) => value && !/^https?:\/\//i.test(value)).map(fileNameOnly))];
  }, [exportPayload]);

  const checkLocalRenderer = async () => {
    setLocalRenderState({
      status: "checking",
      progress: 0,
      message: "Đang kết nối dịch vụ render cục bộ…",
    });
    try {
      const response = await fetch(`${LOCAL_RENDERER_URL}/api/health`);
      const result = await response.json();
      if (!response.ok || !result.ready) throw new Error(result.message || "Dịch vụ chưa sẵn sàng");
      setLocalRenderState({
        status: "idle",
        progress: 0,
        message: result.busy ? "Dịch vụ đang render một video khác" : "Dịch vụ render đã sẵn sàng",
      });
    } catch (error) {
      setLocalRenderState({
        status: "failed",
        progress: 0,
        message: error instanceof Error
          ? error.message
          : "Không thể kết nối. Hãy chạy npm run render:local trên máy.",
      });
    }
  };

  const startLocalRender = async () => {
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
      : "Không có";
    const musicFile = "backgroundMusic" in exportPayload
      ? fileNameOnly(exportPayload.backgroundMusic)
      : "Không có";
    const scenePrompts = exportPayload.scenes.map((item, index) => {
      const nextStart = exportPayload.scenes[index + 1]?.start ?? projectDuration;
      const sceneDuration = Math.max(0, nextStart - item.start);
      return [
        `CẢNH ${item.milestone}: ${item.title}`,
        `- Thời gian: ${item.start}s–${nextStart}s (thời lượng ${sceneDuration}s).`,
        `- Hình ảnh: ${item.image ?? "Không có"}${item.image ? ` (tên file: ${fileNameOnly(item.image)})` : ""}.`,
        `- File thuyết minh: ${item.voiceFile ?? "Không có"}${item.voiceFile ? ` (tên file: ${fileNameOnly(item.voiceFile)})` : ""}.`,
        `- Lời thuyết minh: ${item.narration || "Không có"}.`,
        `- Nội dung popup: ${item.body || "Không có"}.`,
        `- Camera: zoom từ 1x đến ${item.zoom}x trong ${item.zoomInDuration}s, tâm zoom X=${item.centerX}%, Y=${item.centerY}%, sau đó thu về trong ${item.zoomOutDuration}s.`,
        `- Hiệu ứng tâm zoom: "${item.zoomMarkerEffect}", chu kỳ ${item.zoomMarkerDuration}s.`,
        `- Kích thước vòng tròn tâm zoom: ${item.zoomMarkerSize}px.`,
        `- Popup: hiển thị ${item.popupDuration}s, kích thước ${item.popupWidth}% × ${item.popupHeight}px, hiệu ứng mở "${item.popupIn}", hiệu ứng đóng "${item.popupOut}", trạng thái ${item.popupVisible ? "hiện" : "ẩn"}.`,
      ].join("\n");
    });

    return [
      "PROMPT TẠO VIDEO CHI TIẾT",
      "",
      `Tạo video dọc 9:16, độ phân giải ${exportPayload.resolution}, tổng thời lượng ${exportPayload.duration} giây.`,
      `Chủ đề: ${exportPayload.title}.`,
      `Background chủ đề: ${projectBackground}${projectBackground !== "Không có" ? ` (tên file: ${fileNameOnly(projectBackground)})` : ""}.`,
      `Nhạc nền: ${musicFile}.`,
      "Phong cách chuyển động điện ảnh, camera mượt, bố cục dễ đọc và giữ hình ảnh nhất quán giữa các cảnh.",
      "Không tự tạo thêm chữ trong hình nền. Đồng bộ popup, chuyển động camera và lời thuyết minh theo timeline dưới đây.",
      "",
      ...scenePrompts.flatMap((prompt) => [prompt, ""]),
      "YÊU CẦU KỸ THUẬT",
      `- Xuất video ${exportPayload.resolution}, tỷ lệ 9:16, thời lượng chính xác ${exportPayload.duration} giây.`,
      "- Không cắt đột ngột file âm thanh; giảm âm lượng nhạc nền khi có thuyết minh.",
      "- Chỉ sử dụng đúng tên file hình ảnh và âm thanh được liệt kê trong từng cảnh.",
      "- Không để hiệu ứng camera hoặc popup vượt quá thời lượng cảnh.",
    ].join("\n");
  }, [exportPayload, projectDuration]);

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(promptText);
    setToast("Đã sao chép prompt");
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

  return (
    <main
      className="studio-shell"
      data-timeline-visible={timelineVisible ? "true" : "false"}
      data-theme={theme}
      style={{ ["--timeline-height" as string]: `${timelineHeight}px` }}
    >
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
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
          <div className={`save-state ${saveStatus}`}>
            <i />
            <span>
              {saveStatus === "loading" && "Đang tải dữ liệu"}
              {saveStatus === "saving" && "Đang lưu"}
              {saveStatus === "unsaved" && "ChÆ°a lÆ°u"}
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
          <button className="button ghost prompt-button" onClick={() => setShowPromptGenerator(true)}>
            ✦ Tạo prompt
          </button>
          <button
            className="button local-render-button"
            onClick={() => {
              setShowLocalRenderer(true);
              void checkLocalRenderer();
            }}
          >
            ● Render cục bộ
          </button>
          <button
            className={`button ghost timeline-visibility-button ${timelineVisible ? "active" : ""}`}
            onClick={() => setTimelineVisible((visible) => !visible)}
            title={timelineVisible ? "Ẩn thanh timeline" : "Hiện thanh timeline"}
          >
            {timelineVisible ? "▾ Ẩn Timeline" : "▴ Hiện Timeline"}
          </button>
          <button className="button primary" onClick={exportJson}>
            <span>↓</span> Xuất JSON
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="scene-panel">
          <div className="panel-heading">
            <h2>Cảnh</h2>
            <div className="scene-heading-actions">
              <button className="delete-scene-button" onClick={deleteScene}>⌫ Xóa</button>
              <button onClick={addScene}>＋ Thêm</button>
            </div>
          </div>
          <div className="scene-list">
            {scenes.map((item, index) => {
              const playbackActive =
                playing && playTime >= item.start && playTime < item.end;
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
                  {(/^https?:\/\//i.test(item.image) || /^https?:\/\//i.test(previewBackground)) ? (
                    <img
                      src={/^https?:\/\//i.test(item.image) ? item.image : previewBackground}
                      alt=""
                    />
                  ) : (
                    <b>{String(item.number).padStart(2, "0")}</b>
                  )}
                </span>
                <span className="scene-meta">
                  <strong>{item.title}</strong>
                  <small>
                    {formatTime(item.start)}–{formatTime(item.end)}
                  </small>
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
              </button>
              );
            })}
          </div>
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
          <div className="panel-heading">
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
          <div
            ref={previewRef}
            tabIndex={0}
            onPointerDown={() => setMapFocused(true)}
            className={`phone-preview ${playing ? "is-playing" : ""} ${mapFocused ? "map-focused" : ""} ${draggingZoomCenter ? "dragging-zoom-center" : ""}`}
          >
            {backgroundVisible && previewBackground.trim() && (
              <img
                className="project-background"
                src={previewBackground}
                alt=""
                aria-hidden="true"
                style={{
                  transformOrigin: `${scene.centerX}% ${scene.centerY}%`,
                  transform: `scale(${playbackMapScale})`,
                  transitionDuration: playing ? "80ms" : `${scene.zoomInDuration}s`,
                }}
              />
            )}
            {playing && (
              <div className="playback-live">
                <i /> ĐANG PHÁT
              </div>
            )}
            {(!playing || (scene.zoomMarkerEffect ?? "none") !== "none") && (
              <div
                className={`zoom-center-marker marker-effect-${scene.zoomMarkerEffect ?? "none"}`}
                style={{
                  left: `${scene.centerX}%`,
                  top: `${scene.centerY}%`,
                  ["--marker-effect-duration" as string]: `${scene.zoomMarkerDuration ?? 1}s`,
                  ["--marker-size" as string]: `${scene.zoomMarkerSize ?? 28}px`,
                }}
                title={`Tâm zoom ${scene.centerX}%, ${scene.centerY}% · Click để chỉnh hiệu ứng`}
                onPointerDown={startZoomCenterDrag}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!zoomCenterMoved.current) setShowZoomSetup(true);
                  zoomCenterMoved.current = false;
                }}
              >
                <span />
              </div>
            )}
            <div className="preview-progress">
              <span style={{ width: `${(playTime / projectDuration) * 100}%` }} />
            </div>
            <div className="map-zoom-badge">
              {Math.round(playbackMapScale * 100)}%
              <small>
                {playing
                  ? `Đang phát · ${sceneLocalTime.toFixed(1)}s`
                  : mapFocused
                    ? "Đã focus · Lăn chuột để zoom"
                    : "Click bản đồ để bật zoom"}
              </small>
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
                  {isRemoteImage ? (
                    <img src={scene.image} alt={`Ảnh minh họa ${scene.title}`} />
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
          <div className="preview-footer">
            <label className="preview-background-field">
              <span>Background</span>
              <input
                type="url"
                value={previewBackground}
                placeholder="Dán URL ảnh hiển thị trên bản đồ"
                onChange={(event) => setPreviewBackground(event.target.value)}
              />
            </label>
            <button
              className={backgroundVisible ? "active" : ""}
              title={backgroundVisible ? "Ẩn background" : "Hiện background"}
              onClick={() => setBackgroundVisible((visible) => !visible)}
            >
              {backgroundVisible ? "◉" : "⊘"}
            </button>
            <button
              className={scene.popupVisible !== false ? "active popup-visibility-button" : "popup-visibility-button"}
              title={scene.popupVisible !== false ? "Ẩn popup" : "Hiện popup"}
              onClick={() => updateScene("popupVisible", scene.popupVisible === false)}
            >
              {scene.popupVisible !== false ? "◉ Popup" : "⊘ Popup"}
            </button>
          </div>
        </section>

        <aside className="editor-panel">
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
                    motion: shouldOpen,
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
              <span>Background chủ đề</span>
              <input
                type="text"
                placeholder="Ví dụ: Bản đồ hành trình Vua Đa-vít"
                value={background}
                onChange={(event) => setBackground(event.target.value)}
              />
              <small>Chỉ lưu tên/thông tin background vào JSON, không dùng làm ảnh bản đồ.</small>
            </label>
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
                {isRemoteImage && (
                  <div className="image-url-preview">
                    <img src={scene.image} alt="Xem trước ảnh popup" />
                    <span>Đang hiển thị ảnh từ URL</span>
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
                  value={backgroundMusic}
                  placeholder="audio/background-music.mp3 hoặc URL"
                  onChange={(event) => setBackgroundMusic(event.target.value)}
                />
                <label className="file-picker">
                  Chọn file
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) setBackgroundMusic(`audio/${file.name}`);
                    }}
                  />
                </label>
              </div>
              <small>Để trống nếu clip không có nhạc nền.</small>
            </label>
            <label className="field audio-field" id="editor-audio">
              <span>File âm thanh thuyết minh</span>
              <div className="audio-input-row">
                <input
                  value={scene.voiceFile}
                  placeholder="audio/milestone-1.mp3"
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
              {audioPreview[scene.id] && (
                <audio className="audio-preview" controls src={audioPreview[scene.id]} />
              )}
              <small>Đường dẫn này được ghi vào voiceFile khi xuất JSON.</small>
            </label>
              </div>
            </details>
            <details
              className="editor-accordion"
              open={editorSections.motion}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setEditorSections((items) => ({
                  ...items,
                  motion: open,
                }));
              }}
            >
              <summary className="editor-group-label"><span>04</span> Chuyển động <i /></summary>
              <div className="editor-accordion-content">
            <div className="motion-settings-card" id="editor-camera">
              <div className="motion-settings-title">
                <strong>Zoom camera</strong>
                <span>Xem thử dùng đúng các thông số này</span>
              </div>
              <div className="field-row motion-field-row">
                <label className="field">
                  <span>Mức zoom</span>
                  <div className="number-with-unit">
                    <input
                      type="number"
                      min="1"
                      max="5"
                      step="0.05"
                      value={scene.zoom}
                      onChange={(event) => updateScene("zoom", Number(event.target.value))}
                    />
                    <b>×</b>
                  </div>
                </label>
                <label className="field">
                  <span>Thời gian zoom tới mức đó</span>
                  <div className="number-with-unit">
                    <input
                      type="number"
                      min="0"
                      max={sceneDuration}
                      step="0.1"
                      value={scene.zoomInDuration}
                      onChange={(event) => updateScene("zoomInDuration", Number(event.target.value))}
                    />
                    <b>giây</b>
                  </div>
                </label>
              </div>
              <label className="field">
                <span>Thời gian thu camera về</span>
                <div className="number-with-unit">
                  <input
                    type="number"
                    min="0"
                    max={sceneDuration}
                    step="0.1"
                    value={scene.zoomOutDuration}
                    onChange={(event) => updateScene("zoomOutDuration", Number(event.target.value))}
                  />
                  <b>giây</b>
                </div>
              </label>
            </div>
            <label className="field range-field" id="editor-popup">
              <span>Thời gian popup</span>
              <div className="popup-duration-control">
                <input
                  type="range"
                  min="1"
                  max={Math.max(6, sceneDuration)}
                  step="0.1"
                  value={scene.popupDuration}
                  onChange={(event) => updateScene("popupDuration", Number(event.target.value))}
                />
                <div className="number-with-unit popup-duration-number">
                  <input
                    type="number"
                    min="1"
                    max={Math.max(6, sceneDuration)}
                    step="0.1"
                    value={scene.popupDuration}
                    onChange={(event) => updateScene("popupDuration", Number(event.target.value))}
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
            </details>
          </div>
        </aside>
      </section>

      {timelineVisible && <section className="timeline-panel">
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
            <span>{projectDuration} giây · {scenes.length} cảnh · 30 FPS</span>
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
            <strong>Camera</strong>
            <div className="track-content grid">
              {scenes.map((item, index) => (
                <button
                  key={item.id}
                  className={`clip camera-clip ${index % 2 ? "camera-b" : "camera-a"} ${!playing && item.id === selectedId ? "selected" : ""}`}
                  onClick={() => openTimelineEditor(item, "editor-camera")}
                  style={{
                    left: `${(item.start / projectDuration) * 100}%`,
                    width: `${((item.end - item.start) / projectDuration) * 100}%`,
                  }}
                >
                  Zoom {item.zoom}× · {item.zoomInDuration}s
                </button>
              ))}
            </div>
          </div>
          <div className="track">
            <strong>Popup</strong>
            <div className="track-content grid">
              {scenes.filter((item) => item.popupVisible !== false).map((item) => (
                <button
                  key={item.id}
                  onClick={() => openTimelineEditor(item, "editor-popup")}
                  className={`clip popup-clip ${!playing && item.id === selectedId ? "selected" : ""}`}
                  style={{
                    left: `${(item.start / projectDuration) * 100}%`,
                    width: `${Math.min((item.popupDuration / projectDuration) * 100, 100 - (item.start / projectDuration) * 100)}%`,
                  }}
                >
                  Popup {item.number} · {item.popupDuration}s
                </button>
              ))}
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
          <div className="playhead" style={{ left: `${8.2 + (playTime / projectDuration) * 91.8}%` }}>
          </div>
        </div>
      </section>}
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

            <div className={`local-render-status ${localRenderState.status}`}>
              <div className="local-render-status-heading">
                <strong>{localRenderState.message}</strong>
                <span>{Math.round(localRenderState.progress)}%</span>
              </div>
              <div className="local-render-progress">
                <i style={{ width: `${localRenderState.progress}%` }} />
              </div>
            </div>

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
                <h3>Chọn ảnh và âm thanh</h3>
                <label className="local-media-picker">
                  <strong>＋ Chọn nhiều file</strong>
                  <span>Ảnh background, ảnh popup, giọng đọc và nhạc nền</span>
                  <input
                    type="file"
                    multiple
                    accept="image/*,audio/*,video/*"
                    onChange={(event) => setLocalRenderFiles(Array.from(event.target.files ?? []))}
                  />
                </label>
                <p className="local-render-note">
                  Đã chọn {localRenderFiles.length} file. Tên file phải trùng với tên trong JSON; URL mạng sẽ được tải tự động.
                </p>
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

            <div className="modal-actions">
              <button className="button ghost" onClick={() => void checkLocalRenderer()}>Kiểm tra kết nối</button>
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
      {showZoomSetup && (
        <div className="modal-backdrop zoom-setup-backdrop" onMouseDown={() => setShowZoomSetup(false)}>
          <div className="project-modal zoom-setup-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="prompt-modal-heading">
              <div>
                <span className="modal-kicker">TÂM ZOOM</span>
                <h2>Thiết lập hiệu ứng</h2>
                <p>Chọn hiệu ứng cho vòng tròn tâm zoom của cảnh “{scene.title}”.</p>
              </div>
              <button className="prompt-close" aria-label="Đóng" onClick={() => setShowZoomSetup(false)}>×</button>
            </div>
            <div className="zoom-effect-preview">
              <div
                className={`zoom-center-marker marker-effect-${scene.zoomMarkerEffect ?? "none"}`}
                style={{
                  ["--marker-effect-duration" as string]: `${scene.zoomMarkerDuration ?? 1}s`,
                  ["--marker-size" as string]: `${scene.zoomMarkerSize ?? 28}px`,
                }}
              >
                <span />
              </div>
            </div>
            <label className="field">
              <span>Hiệu ứng vòng tròn</span>
              <select
                value={scene.zoomMarkerEffect ?? "none"}
                onChange={(event) => updateScene("zoomMarkerEffect", event.target.value)}
              >
                <option value="none">Không hiệu ứng</option>
                <option value="glow">Phát sáng</option>
                <option value="blink">Nhấp nháy</option>
                <option value="soft-fade">Làm mờ</option>
              </select>
            </label>
            <label className="field">
              <span>Thời gian một chu kỳ hiệu ứng</span>
              <div className="number-with-unit">
                <input
                  type="number"
                  min="0.2"
                  max="10"
                  step="0.1"
                  value={scene.zoomMarkerDuration ?? 1}
                  onChange={(event) => updateScene("zoomMarkerDuration", Number(event.target.value))}
                />
                <b>giây</b>
              </div>
            </label>
            <label className="field">
              <span>Kích thước vòng tròn</span>
              <div className="zoom-marker-size-control">
                <input
                  type="range"
                  min="16"
                  max="120"
                  step="1"
                  value={scene.zoomMarkerSize ?? 28}
                  onChange={(event) => updateScene("zoomMarkerSize", Number(event.target.value))}
                />
                <div className="number-with-unit">
                  <input
                    type="number"
                    min="16"
                    max="120"
                    step="1"
                    value={scene.zoomMarkerSize ?? 28}
                    onChange={(event) => updateScene("zoomMarkerSize", Number(event.target.value))}
                  />
                  <b>px</b>
                </div>
              </div>
            </label>
            <div className="modal-actions">
              <button className="button primary" onClick={() => setShowZoomSetup(false)}>Hoàn tất</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
