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

const statusClass: Record<Scene["status"], string> = {
  Nháp: "draft",
  "Đã duyệt": "approved",
};

const formatTime = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(4, "0")}`;

const LOCAL_STORAGE_KEY = "kito-video-studio-project";

type StoredProject = {
  version: 1;
  projectDuration: 15 | 30 | 45;
  imageEnabled: boolean;
  narrationEnabled: boolean;
  background?: string;
  backgroundVisible?: boolean;
  scenes: Scene[];
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
  const [projectId, setProjectId] = useState("david-journey");
  const [projectTitle, setProjectTitle] = useState("Hành trình Vua Đa-vít");
  const [projects, setProjects] = useState<ProjectSnapshot[]>([]);
  const [projectDuration, setProjectDuration] = useState<15 | 30 | 45>(15);
  const [imageEnabled, setImageEnabled] = useState(true);
  const [narrationEnabled, setNarrationEnabled] = useState(true);
  const [background, setBackground] = useState("");
  const [backgroundVisible, setBackgroundVisible] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    "loading" | "saved" | "saving" | "offline" | "error"
  >("loading");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [audioPreview, setAudioPreview] = useState<Record<string, string>>({});
  const [draggingZoomCenter, setDraggingZoomCenter] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mapPreviewZoom, setMapPreviewZoom] = useState<Record<string, number>>({});
  const animationFrame = useRef<number | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const narrationAudio = useRef<HTMLAudioElement | null>(null);

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
  const popupPlaybackVisible =
    scene.popupVisible !== false &&
    (!playing ||
      (sceneLocalTime >= scene.zoomInDuration &&
        sceneLocalTime <= scene.zoomInDuration + scene.popupDuration));

  const currentProject = useMemo<ProjectSnapshot>(
    () => ({
      id: projectId,
      title: projectTitle,
      projectDuration,
      imageEnabled,
      narrationEnabled,
      background,
      backgroundVisible,
      scenes,
    }),
    [
      projectId,
      projectTitle,
      projectDuration,
      imageEnabled,
      narrationEnabled,
      background,
      backgroundVisible,
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
    setBackgroundVisible(project.backgroundVisible ?? true);
    setScenes(project.scenes);
    setSelectedId(project.scenes[0]?.id ?? "");
    setPlayTime(project.scenes[0]?.start ?? 0);
    setPlaying(false);
  };

  const applyStoredProject = (
    data: Partial<StoredWorkspace> | Partial<StoredProject> | null,
  ) => {
    if (!data) return false;
    if (data.version === 2 && Array.isArray(data.projects) && data.projects.length > 0) {
      const restoredProjects = data.projects as ProjectSnapshot[];
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
        projectDuration: [15, 30, 45].includes(Number(data.projectDuration))
          ? (data.projectDuration as 15 | 30 | 45)
          : 15,
        imageEnabled: data.imageEnabled ?? true,
        narrationEnabled: data.narrationEnabled ?? true,
        background: data.background ?? "",
        backgroundVisible: data.backgroundVisible ?? true,
        scenes: data.scenes,
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
      event.preventDefault();
      event.stopPropagation();
      if (playing || !backgroundVisible || !background.trim()) return;
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
  }, [selectedId, backgroundVisible, background, playing]);

  useEffect(() => {
    if (!hydrated) return;

    window.localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify(storedProject),
    );
    setSaveStatus("saving");

    const timeout = window.setTimeout(async () => {
      try {
        await saveDataToGoogle(storedProject);
        setSaveStatus("saved");
        setLastSavedAt(new Date());
      } catch {
        setSaveStatus("offline");
      }
    }, 1400);

    return () => window.clearTimeout(timeout);
  }, [hydrated, storedProject]);

  const saveProjectNow = async () => {
    window.localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify(storedProject),
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
      if (activeScene) setSelectedId(activeScene.id);
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

  const selectScene = (item: Scene) => {
    setSelectedId(item.id);
    setPlayTime(item.start);
  };

  const togglePlayback = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (playTime >= projectDuration) setPlayTime(0);
    setPlaying(true);
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
    setScenes((items) =>
      items.map((item) => (item.id === selectedId ? { ...item, [key]: value } : item)),
    );
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
      backgroundVisible: true,
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
      id: `scene-${String(number).padStart(2, "0")}`,
      number,
      title: "Cảnh mới",
      location: "Địa danh mới",
      reference: "",
      popup: "Nhập nội dung popup cho cảnh mới.",
      narration: "Nhập lời thuyết minh cho cảnh mới.",
      voice: "Nam trầm",
      image: `images/milestone-${number}.jpg`,
      start: last.end,
      end: last.end + 3,
      zoomInDuration: 0.5,
      popupDuration: 2,
      zoomOutDuration: 0.5,
      zoom: 2,
      centerX: 50,
      centerY: 50,
      voiceFile: `audio/milestone-${number}.mp3`,
      popupIn: "fade-slide-up",
      popupOut: "fade-slide-down",
      status: "Nháp",
    };
    setScenes((items) => [...items, next]);
    setSelectedId(next.id);
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
    setDraggingZoomCenter(true);

    const move = (moveEvent: PointerEvent) => {
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

  const exportPayload = useMemo(
    () => ({
      title: projectTitle,
      duration: projectDuration,
      resolution: "1080x1920",
      background,
      backgroundVisible,
      scenes: scenes.map((item) => ({
        milestone: item.number,
        title: item.title,
        start: item.start,
        zoomInDuration: item.zoomInDuration,
        popupDuration: item.popupDuration,
        zoomOutDuration: item.zoomOutDuration,
        zoom: item.zoom,
        centerX: item.centerX,
        centerY: item.centerY,
        location: item.location,
        reference: item.reference.replaceAll("–", "-"),
        body: item.popup,
        image: imageEnabled ? item.image.replace(/^media\//, "images/") : "",
        narration: narrationEnabled ? item.narration : "",
        voiceFile: narrationEnabled ? item.voiceFile : "",
        popupIn: item.popupIn,
        popupOut: item.popupOut,
        popupWidth: item.popupWidth ?? 90,
        popupHeight: item.popupHeight ?? 255,
        popupVisible: item.popupVisible !== false,
      })),
    }),
    [
      scenes,
      imageEnabled,
      narrationEnabled,
      projectDuration,
      projectTitle,
      background,
      backgroundVisible,
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

  return (
    <main className="studio-shell" data-theme={theme}>
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
            {theme === "light" ? "☾" : "☀"}
          </button>
          <div className={`save-state ${saveStatus}`}>
            <i />
            <span>
              {saveStatus === "loading" && "Đang tải dữ liệu"}
              {saveStatus === "saving" && "Đang lưu"}
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
            <select
              aria-label="Độ dài clip"
              value={projectDuration}
              onChange={(event) => {
                const duration = Number(event.target.value) as 15 | 30 | 45;
                setProjectDuration(duration);
                setPlayTime((time) => Math.min(time, duration));
              }}
            >
              <option value={15}>15s</option>
              <option value={30}>30s</option>
              <option value={45}>45s</option>
            </select>
          </label>
          <button className="button ghost" onClick={togglePlayback}>
            <span className="play-icon">{playing ? "Ⅱ" : "▶"}</span>
            {playing ? "Tạm dừng" : "Xem thử"}
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
            {scenes.map((item) => (
              <button
                key={item.id}
                draggable
                className={`scene-item ${item.id === selectedId ? "active" : ""} ${item.id === dragOverId ? "drag-over" : ""}`}
                onClick={() => selectScene(item)}
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
                  {(/^https?:\/\//i.test(item.image) || /^https?:\/\//i.test(background)) ? (
                    <img
                      src={/^https?:\/\//i.test(item.image) ? item.image : background}
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
                    <i className={statusClass[item.status]}>{item.status}</i>
                  </small>
                </span>
              </button>
            ))}
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
            <span className="time-pill">{formatTime(scene.start)}</span>
          </div>
          <div
            ref={previewRef}
            className={`phone-preview ${playing ? "is-playing" : ""} ${draggingZoomCenter ? "dragging-zoom-center" : ""}`}
          >
            {backgroundVisible && background.trim() && (
              <img
                className="project-background"
                src={background}
                alt=""
                aria-hidden="true"
                style={{
                  transformOrigin: `${scene.centerX}% ${scene.centerY}%`,
                  transform: `scale(${playbackMapScale})`,
                  transitionDuration: playing ? "80ms" : `${scene.zoomInDuration}s`,
                }}
              />
            )}
            <div className="map-label">BÊLEM</div>
            {!playing && (
              <div
                className="zoom-center-marker"
                style={{ left: `${scene.centerX}%`, top: `${scene.centerY}%` }}
                title={`Tâm zoom ${scene.centerX}%, ${scene.centerY}%`}
                onPointerDown={startZoomCenterDrag}
              >
                <span />
              </div>
            )}
            <div className="preview-progress">
              <span style={{ width: `${(playTime / projectDuration) * 100}%` }} />
            </div>
            <div className="map-zoom-badge">
              {Math.round(playbackMapScale * 100)}%
              <small>{playing ? `Đang phát · ${sceneLocalTime.toFixed(1)}s` : "Lăn chuột để zoom"}</small>
            </div>
            {popupPlaybackVisible && (
              <article
                className={`preview-card ${playing ? "playback-popup" : ""}`}
                style={{
                  width: `${scene.popupWidth ?? 90}%`,
                  height: `${scene.popupHeight ?? 255}px`,
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
                <small>CẢNH {String(scene.number).padStart(2, "0")}</small>
                <h3>{scene.title}</h3>
                <p className="location-line">⌖ {scene.location} · {scene.reference}</p>
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
            <span><i /> Camera keyframe</span>
            <span><i /> Popup live</span>
            <button
              className={scene.popupVisible !== false ? "active" : ""}
              title={scene.popupVisible !== false ? "Ẩn popup" : "Hiện popup"}
              onClick={() => updateScene("popupVisible", scene.popupVisible === false)}
            >
              {scene.popupVisible !== false ? "◉ Ẩn popup" : "⊘ Hiện popup"}
            </button>
          </div>
        </section>

        <aside className="editor-panel">
          <div className="panel-heading">
            <h2>Biên soạn</h2>
            <span className="scene-pill">Cảnh {scene.number}</span>
          </div>
          <div className="editor-scroll">
            <div className="editor-group-label"><span>01</span> Hình ảnh & nền</div>
            <label className="field background-field">
              <span>Background chủ đề</span>
              <div className="background-input-row">
                <input
                  type="url"
                  placeholder="https://example.com/background.jpg"
                  value={background}
                  onChange={(event) => setBackground(event.target.value)}
                />
                <button
                  type="button"
                  className={`eye-button ${backgroundVisible ? "is-visible" : ""}`}
                  aria-label={backgroundVisible ? "Ẩn background" : "Hiện background"}
                  title={backgroundVisible ? "Ẩn background" : "Hiện background"}
                  onClick={() => setBackgroundVisible((visible) => !visible)}
                >
                  {backgroundVisible ? "◉" : "⊘"}
                </button>
              </div>
              {background.trim() && (
                <div className={`background-url-preview ${backgroundVisible ? "" : "is-hidden"}`}>
                  <img src={background} alt="Xem trước background chủ đề" />
                  <span>{backgroundVisible ? "Background đang hiển thị" : "Background đang bị ẩn"}</span>
                </div>
              )}
              <small>Áp dụng xuyên suốt mọi cảnh và nằm phía sau popup.</small>
            </label>
            <div className="editor-group-label"><span>02</span> Nội dung cảnh</div>
            <label className="field">
              <span>Tiêu đề</span>
              <input
                value={scene.title}
                onChange={(event) => updateScene("title", event.target.value)}
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Địa danh</span>
                <input
                  value={scene.location}
                  onChange={(event) => updateScene("location", event.target.value)}
                />
              </label>
              <label className="field">
                <span>Trích dẫn</span>
                <input
                  value={scene.reference}
                  onChange={(event) => updateScene("reference", event.target.value)}
                />
              </label>
            </div>
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
            <div className="editor-group-label"><span>03</span> Âm thanh</div>
            <label className="field audio-field">
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
            <div className="editor-group-label"><span>04</span> Chuyển động</div>
            <label className="field range-field">
              <span>Thời gian popup: <b>{scene.popupDuration.toFixed(1)} giây</b></span>
              <input
                type="range"
                min="1"
                max="6"
                step="0.5"
                value={scene.popupDuration}
                onChange={(event) => updateScene("popupDuration", Number(event.target.value))}
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Hiệu ứng mở</span>
                <select><option>Fade + trượt</option><option>Zoom nhẹ</option></select>
              </label>
              <label className="field">
                <span>Hiệu ứng đóng</span>
                <select><option>Fade + trượt</option><option>Thu nhỏ</option></select>
              </label>
            </div>
          </div>
        </aside>
      </section>

      <section className="timeline-panel">
        <div className="timeline-heading">
          <div>
            <h2>Timeline</h2>
            <span>{projectDuration} giây · {scenes.length} cảnh · 30 FPS</span>
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
              <div className="clip camera-a" style={{ left: "0%", width: "20%" }}>Zoom 1</div>
              <div className="clip camera-b" style={{ left: "20%", width: "17%" }}>Giữ</div>
              <div className="clip camera-a" style={{ left: "37%", width: "26%" }}>Zoom 2</div>
              <div className="clip camera-b" style={{ left: "63%", width: "17%" }}>Giữ</div>
              <div className="clip camera-c" style={{ left: "80%", width: "20%" }}>Kết</div>
            </div>
          </div>
          <div className="track">
            <strong>Popup</strong>
            <div className="track-content grid">
              {scenes.filter((item) => item.popupVisible !== false).map((item) => (
                <button
                  key={item.id}
                  onClick={() => selectScene(item)}
                  className={`clip popup-clip ${item.id === selectedId ? "selected" : ""}`}
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
                <div
                  key={item.id}
                  className="clip voice-clip"
                  style={{
                    left: `${(item.start / projectDuration) * 100}%`,
                    width: `${((item.end - item.start) / projectDuration) * 100}%`,
                  }}
                >
                  🎙 {item.voiceFile || `Thuyết minh ${item.number}`}
                </div>
              ))}
            </div>
          </div>
          <div className="track">
            <strong>Nhạc nền</strong>
            <div className="track-content grid">
              <div className="clip music-clip" style={{ left: "58%", width: "42%" }}>
                ♫ Nhạc nền
              </div>
            </div>
          </div>
          <div className="playhead" style={{ left: `${8.2 + (playTime / projectDuration) * 91.8}%` }}>
            <span>{playTime.toFixed(1)}s</span>
          </div>
        </div>
      </section>
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
    </main>
  );
}
