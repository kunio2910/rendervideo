"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";

const LOCAL_RENDERER_URL = "http://127.0.0.1:4179";
const WHITEBOARD_TEMPLATES_KEY = "kito.whiteboard.templates.v1";
type WhiteboardFileKey = "line" | "color" | "annotation" | "hand" | "audio" | "subtitle";
type WhiteboardFiles = Record<WhiteboardFileKey, File | null>;
type WhiteboardDirection = "top_to_bottom" | "bottom_to_top" | "left_to_right" | "right_to_left";
type WhiteboardModule = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  direction: WhiteboardDirection;
  startMs: number;
  endMs: number;
  subtitle: string;
  narrativeRole: string;
};
type WhiteboardTemplate = { id: string; name: string; modules: WhiteboardModule[] };
type WhiteboardOptions = { drawSpeed: number; colorFill: "hybrid" | "brush" | "contour-wipe"; lineReveal: "skeleton" | "pixel"; matchBg: "auto" | "on" | "off"; aspectRatio: "auto" | "9:16" | "16:9" | "4:3" | "1:1"; capLongEdge: number; audioStartMs: number; bareTip: boolean };
type WhiteboardJob = { id: string; status: "queued" | "preparing" | "rendering" | "completed" | "failed" | "cancelled"; progress: number; message: string; downloadUrl?: string | null; clip?: { name?: string; downloadUrl?: string } | null };
type WhiteboardWorkspaceProps = { onNotify: (message: string) => void };

const initialFiles: WhiteboardFiles = { line: null, color: null, annotation: null, hand: null, audio: null, subtitle: null };
const initialOptions: WhiteboardOptions = { drawSpeed: 0.7, colorFill: "hybrid", lineReveal: "skeleton", matchBg: "auto", aspectRatio: "auto", capLongEdge: 1080, audioStartMs: 0, bareTip: false };
const initialCanvas = { width: 1920, height: 1080 };
const fileLabels: Record<WhiteboardFileKey, string> = { line: "Line art · bắt buộc", color: "Color reference · khuyến nghị", annotation: "Annotation JSON · tuỳ chọn", hand: "Bàn tay PNG · tuỳ chọn", audio: "Audio · tuỳ chọn", subtitle: "SRT/VTT · tuỳ chọn" };
const fileHints: Record<WhiteboardFileKey, string> = { line: "Chọn file từ máy", color: "Chọn file từ máy", annotation: "Có thể để trống — dùng module panel", hand: "Chọn file từ máy", audio: "Chọn file từ máy", subtitle: "Chọn file từ máy" };
const accepts: Record<WhiteboardFileKey, string> = { line: "image/png,image/jpeg,image/webp", color: "image/png,image/jpeg,image/webp", annotation: ".json,application/json", hand: "image/png", audio: "audio/*,.mp3,.wav,.m4a,.aac,.ogg", subtitle: ".srt,.vtt,text/plain" };
const directionLabels: Record<WhiteboardDirection, string> = { top_to_bottom: "Trên xuống dưới", bottom_to_top: "Dưới lên trên", left_to_right: "Trái sang phải", right_to_left: "Phải sang trái" };

const makeModule = (index: number, canvas = initialCanvas, startMs = 0): WhiteboardModule => ({
  id: `module-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
  name: `Module ${index + 1}`,
  x: 0,
  y: 0,
  width: canvas.width,
  height: canvas.height,
  direction: "top_to_bottom",
  startMs,
  endMs: startMs + 3000,
  subtitle: "",
  narrativeRole: "Nội dung chính của cảnh",
});

const cloneModules = (modules: WhiteboardModule[]) => modules.map((item) => ({ ...item }));

function FilePicker({ fileKey, file, onChange }: { fileKey: WhiteboardFileKey; file: File | null; onChange: (file: File | null) => void }) {
  const inputId = `whiteboard-${fileKey}`;
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => { onChange(event.target.files?.[0] ?? null); event.target.value = ""; };
  return <label className={`whiteboard-file-picker ${file ? "ready" : ""}`} htmlFor={inputId}><input id={inputId} type="file" accept={accepts[fileKey]} onChange={handleChange} /><span className="whiteboard-file-icon" aria-hidden="true">{file ? "✓" : "＋"}</span><span className="whiteboard-file-copy"><strong>{fileLabels[fileKey]}</strong><small>{file ? file.name : fileHints[fileKey]}</small></span></label>;
}

export function WhiteboardWorkspace({ onNotify }: WhiteboardWorkspaceProps) {
  const [files, setFiles] = useState<WhiteboardFiles>(initialFiles);
  const [options, setOptions] = useState<WhiteboardOptions>(initialOptions);
  const [canvas, setCanvas] = useState(initialCanvas);
  const [modules, setModules] = useState<WhiteboardModule[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [draggingModuleId, setDraggingModuleId] = useState("");
  const [templates, setTemplates] = useState<WhiteboardTemplate[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = window.localStorage.getItem(WHITEBOARD_TEMPLATES_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [outputName, setOutputName] = useState("whiteboard-scene");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<WhiteboardJob | null>(null);
  const [error, setError] = useState("");
  const linePreviewUrl = useMemo(() => files.line ? URL.createObjectURL(files.line) : "", [files.line]);
  const colorPreviewUrl = useMemo(() => files.color ? URL.createObjectURL(files.color) : "", [files.color]);
  const selectedModule = modules.find((item) => item.id === selectedModuleId) ?? null;
  useEffect(() => () => { if (linePreviewUrl) URL.revokeObjectURL(linePreviewUrl); if (colorPreviewUrl) URL.revokeObjectURL(colorPreviewUrl); }, [linePreviewUrl, colorPreviewUrl]);
  useEffect(() => { try { window.localStorage.setItem(WHITEBOARD_TEMPLATES_KEY, JSON.stringify(templates)); } catch { /* localStorage có thể bị tắt */ } }, [templates]);

  const updateFile = (fileKey: WhiteboardFileKey, file: File | null) => { setFiles((current) => ({ ...current, [fileKey]: file })); setError(""); setJob(null); };
  const updateOption = <K extends keyof WhiteboardOptions>(key: K, value: WhiteboardOptions[K]) => setOptions((current) => ({ ...current, [key]: value }));
  const addModule = () => {
    const nextStart = modules.reduce((latest, item) => Math.max(latest, item.endMs), 0);
    const next = makeModule(modules.length, canvas, nextStart);
    setModules((current) => [...current, next]);
    setSelectedModuleId(next.id);
  };
  const deleteSelectedModule = () => {
    if (!selectedModule) return;
    const remaining = modules.filter((item) => item.id !== selectedModule.id);
    setModules(remaining);
    setSelectedModuleId(remaining[0]?.id ?? "");
  };
  const updateSelectedModule = <K extends keyof WhiteboardModule>(key: K, value: WhiteboardModule[K]) => {
    if (!selectedModule) return;
    setModules((current) => current.map((item) => item.id === selectedModule.id ? { ...item, [key]: value } : item));
  };
  const updateSelectedNumber = (key: "x" | "y" | "width" | "height" | "startMs" | "endMs", value: string) => {
    const parsed = Number(value);
    updateSelectedModule(key, Number.isFinite(parsed) ? Math.max(0, parsed) : 0);
  };
  const reorderModules = (targetId: string) => {
    if (!draggingModuleId || draggingModuleId === targetId) return;
    const from = modules.findIndex((item) => item.id === draggingModuleId);
    const to = modules.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const reordered = [...modules];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setModules(reordered);
    setDraggingModuleId("");
  };
  const saveTemplate = () => {
    if (!modules.length) { setError("Hãy thêm ít nhất một module trước khi lưu template."); return; }
    const name = templateName.trim() || `Template ${templates.length + 1}`;
    const template = { id: `template-${Date.now()}`, name, modules: cloneModules(modules) };
    setTemplates((current) => [...current, template]);
    setSelectedTemplateId(template.id);
    setTemplateName("");
  };
  const applyTemplate = () => {
    const template = templates.find((item) => item.id === selectedTemplateId);
    if (!template) return;
    const applied = cloneModules(template.modules);
    setModules(applied);
    setSelectedModuleId(applied[0]?.id ?? "");
  };
  const deleteTemplate = () => {
    if (!selectedTemplateId) return;
    setTemplates((current) => current.filter((item) => item.id !== selectedTemplateId));
    setSelectedTemplateId("");
  };
  const pollJob = async (jobId: string) => {
    for (;;) {
      const response = await fetch(`${LOCAL_RENDERER_URL}/api/whiteboard/render/${encodeURIComponent(jobId)}`);
      const next = await response.json().catch(() => ({})) as WhiteboardJob & { error?: string };
      if (!response.ok) throw new Error(next.error || "Không đọc được trạng thái Whiteboard");
      setJob(next);
      if (["completed", "failed", "cancelled"].includes(next.status)) return next;
      await new Promise((resolve) => window.setTimeout(resolve, 900));
    }
  };
  const renderWhiteboard = async () => {
    if (!files.line) { setError("Hãy chọn Line art trước khi render."); return; }
    setBusy(true); setError(""); setJob({ id: "local", status: "queued", progress: 0, message: "Đang gửi tài nguyên…" });
    try {
      const form = new FormData();
      form.append("line", files.line, files.line.name);
      if (files.annotation) form.append("annotation", files.annotation, files.annotation.name);
      if (files.color) form.append("color", files.color, files.color.name); if (files.hand) form.append("hand", files.hand, files.hand.name); if (files.audio) form.append("audio", files.audio, files.audio.name); if (files.subtitle) form.append("subtitle", files.subtitle, files.subtitle.name);
      form.append("name", outputName.trim() || "whiteboard-scene");
      form.append("options", JSON.stringify({ ...options, modules, canvas }));
      const response = await fetch(`${LOCAL_RENDERER_URL}/api/whiteboard/render`, { method: "POST", body: form });
      const payload = await response.json().catch(() => ({})) as { jobId?: string; error?: string };
      if (!response.ok || !payload.jobId) throw new Error(payload.error || "Không thể khởi động Whiteboard renderer");
      const completed = await pollJob(payload.jobId);
      if (completed.status !== "completed") throw new Error(completed.message || "Whiteboard render thất bại");
      onNotify("Đã render Whiteboard và lưu vào thư viện video");
    } catch (renderError) { const message = renderError instanceof Error ? renderError.message : "Không thể render Whiteboard"; setError(message); onNotify(message); } finally { setBusy(false); }
  };
  const downloadUrl = job?.downloadUrl ? `${LOCAL_RENDERER_URL}${job.downloadUrl}` : "";
  return <>
    <header className="topbar whiteboard-topbar"><div className="studio-page-title"><span className="studio-page-kicker">KITO WHITEBOARD</span><h1>Render Whiteboard</h1><p>Tô màu theo line art, giữ chuyển động bàn tay và xuất MP4 độc lập với pipeline video hiện tại.</p></div><div className="whiteboard-header-badge"><span>●</span> Renderer riêng · Module tự tạo annotation</div></header>
    <section className="whiteboard-workspace" aria-labelledby="whiteboard-heading">
      <aside className="whiteboard-assets-panel"><div className="whiteboard-panel-heading"><div><span>INPUT</span><h2 id="whiteboard-heading">Tài nguyên</h2></div><small>PNG · JSON · audio</small></div><div className="whiteboard-file-list">{(["line", "color", "annotation", "hand", "audio", "subtitle"] as WhiteboardFileKey[]).map((fileKey) => <FilePicker key={fileKey} fileKey={fileKey} file={files[fileKey]} onChange={(file) => updateFile(fileKey, file)} />)}</div><div className="whiteboard-safe-note"><span>i</span><p>Annotation JSON không bắt buộc. Nếu bỏ trống, dữ liệu từ Drawing Modules sẽ được tạo tự động và gửi cho local renderer.</p></div></aside>
      <main className="whiteboard-stage"><div className="whiteboard-stage-heading"><div><span>PREVIEW</span><h2>Đối chiếu line / color</h2></div><small>{files.line ? `${files.line.name}${files.color ? ` · ${files.color.name}` : ""}` : "Chưa chọn hình"}</small></div><div className="whiteboard-preview-grid"><div className="whiteboard-preview-card"><span>LINE ART</span>{linePreviewUrl ? <img src={linePreviewUrl} alt="Xem trước line art" onLoad={(event) => setCanvas({ width: event.currentTarget.naturalWidth || initialCanvas.width, height: event.currentTarget.naturalHeight || initialCanvas.height })} /> : <div className="whiteboard-empty-preview">Chọn line art để xem trước</div>}</div><div className="whiteboard-preview-card"><span>COLOR REFERENCE</span>{colorPreviewUrl ? <img src={colorPreviewUrl} alt="Xem trước color reference" /> : <div className="whiteboard-empty-preview">Color reference giúp phủ màu kín hơn</div>}</div></div><div className="whiteboard-flow-note"><strong>Quy trình:</strong> line art được vẽ trước → màu được phủ bằng Hybrid → giữ khung cuối cho tới khi audio kết thúc. {modules.length ? `${modules.length} module sẽ được vẽ theo thứ tự.` : "Chưa có module: renderer sẽ dùng toàn bộ khung hình."}</div></main>
      <aside className="whiteboard-settings-panel">
        <section className="whiteboard-module-editor" aria-labelledby="whiteboard-modules-heading"><div className="whiteboard-panel-heading"><div><span>DRAWING MODULES</span><h2 id="whiteboard-modules-heading">Drawing Modules <em>{modules.length} total</em></h2></div></div><p className="whiteboard-module-help">Kéo các module để đổi thứ tự vẽ. Có thể render ngay cả khi không nhập Annotation JSON.</p><div className="whiteboard-module-actions"><button type="button" className="button secondary" onClick={addModule}>＋ Add Module</button><button type="button" className="button secondary" onClick={deleteSelectedModule} disabled={!selectedModule}>Delete Selected</button></div>{modules.length > 0 && <div className="whiteboard-module-list">{modules.map((module, index) => <button key={module.id} type="button" className={`whiteboard-module-item ${module.id === selectedModuleId ? "selected" : ""}`} draggable onDragStart={() => setDraggingModuleId(module.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => reorderModules(module.id)} onClick={() => setSelectedModuleId(module.id)}><span className="whiteboard-module-index">{index + 1}</span><span><strong>{module.name || `Module ${index + 1}`}</strong><small>{module.x}, {module.y} · {Math.max(0, module.endMs - module.startMs)} ms</small></span><span className="whiteboard-drag-handle" aria-hidden="true">⋮⋮</span></button>)}</div>}
          <div className="whiteboard-template-block"><label className="whiteboard-field"><span>Templates</span><select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}><option value="">No saved templates</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><div className="whiteboard-template-name"><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Tên template mới" /><button type="button" className="button secondary" onClick={saveTemplate} disabled={!modules.length}>Save</button></div><div className="whiteboard-template-actions"><button type="button" className="button secondary" onClick={applyTemplate} disabled={!selectedTemplateId}>Apply</button><button type="button" className="button secondary danger" onClick={deleteTemplate} disabled={!selectedTemplateId}>Delete</button></div></div>
          {selectedModule && <div className="whiteboard-selected-module"><div className="whiteboard-selected-heading"><span>SELECTED MODULE</span><small>Canvas {canvas.width} × {canvas.height}</small></div><label className="whiteboard-module-field"><span>Name</span><input value={selectedModule.name} onChange={(event) => updateSelectedModule("name", event.target.value)} /></label><div className="whiteboard-module-field-grid">{(["x", "y", "width", "height"] as const).map((key) => <label key={key} className="whiteboard-module-field"><span>{key[0].toUpperCase() + key.slice(1)}</span><input type="number" min="0" value={selectedModule[key]} onChange={(event) => updateSelectedNumber(key, event.target.value)} /></label>)}</div><label className="whiteboard-module-field"><span>Direction</span><select value={selectedModule.direction} onChange={(event) => updateSelectedModule("direction", event.target.value as WhiteboardDirection)}>{Object.entries(directionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="whiteboard-module-field-grid"><label className="whiteboard-module-field"><span>Start (ms)</span><input type="number" min="0" value={selectedModule.startMs} onChange={(event) => updateSelectedNumber("startMs", event.target.value)} /></label><label className="whiteboard-module-field"><span>End (ms)</span><input type="number" min="0" value={selectedModule.endMs} onChange={(event) => updateSelectedNumber("endMs", event.target.value)} /></label></div><label className="whiteboard-module-field"><span>Duration (ms)</span><input value={Math.max(0, selectedModule.endMs - selectedModule.startMs)} readOnly /></label><label className="whiteboard-module-field"><span>Subtitle</span><textarea value={selectedModule.subtitle} onChange={(event) => updateSelectedModule("subtitle", event.target.value)} placeholder="Nội dung liên quan đến module" rows={3} /></label><label className="whiteboard-module-field"><span>Narrative role</span><input value={selectedModule.narrativeRole} onChange={(event) => updateSelectedModule("narrativeRole", event.target.value)} placeholder="Ví dụ: nhân vật chính xuất hiện" /></label></div>}
        </section>
        <div className="whiteboard-settings-divider" />
        <section aria-labelledby="whiteboard-settings-heading"><div className="whiteboard-panel-heading"><div><span>SETTINGS</span><h2 id="whiteboard-settings-heading">Thông số render</h2></div></div><label className="whiteboard-field"><span>Tốc độ vẽ <b>{options.drawSpeed.toFixed(2)}×</b></span><input type="range" min="0.25" max="1.5" step="0.05" value={options.drawSpeed} onChange={(event) => updateOption("drawSpeed", Number(event.target.value))} /><small>0.70× là mức chậm, tự nhiên và cân bằng nhất.</small></label><label className="whiteboard-field"><span>Phủ màu</span><select value={options.colorFill} onChange={(event) => updateOption("colorFill", event.target.value as WhiteboardOptions["colorFill"])}><option value="hybrid">Hybrid · khuyến nghị</option><option value="brush">Brush · theo nét</option><option value="contour-wipe">Contour wipe · phủ kín nhanh</option></select></label><div className="whiteboard-field-grid"><label className="whiteboard-field"><span>Line reveal</span><select value={options.lineReveal} onChange={(event) => updateOption("lineReveal", event.target.value as WhiteboardOptions["lineReveal"])}><option value="skeleton">Skeleton</option><option value="pixel">Pixel</option></select></label><label className="whiteboard-field"><span>Nền</span><select value={options.matchBg} onChange={(event) => updateOption("matchBg", event.target.value as WhiteboardOptions["matchBg"])}><option value="auto">Auto</option><option value="on">Bật</option><option value="off">Tắt</option></select></label></div><div className="whiteboard-field-grid"><label className="whiteboard-field"><span>Tỉ lệ</span><select value={options.aspectRatio} onChange={(event) => updateOption("aspectRatio", event.target.value as WhiteboardOptions["aspectRatio"])}><option value="auto">Theo ảnh</option><option value="9:16">9:16</option><option value="16:9">16:9</option><option value="4:3">4:3</option><option value="1:1">1:1</option></select></label><label className="whiteboard-field"><span>Cạnh dài</span><select value={options.capLongEdge} onChange={(event) => updateOption("capLongEdge", Number(event.target.value))}><option value="720">720 px</option><option value="1080">1080 px</option><option value="1440">1440 px</option></select></label></div><label className="whiteboard-check"><input type="checkbox" checked={options.bareTip} onChange={(event) => updateOption("bareTip", event.target.checked)} /> Không hiển thị bàn tay / bút</label><label className="whiteboard-field"><span>Tên file xuất</span><input value={outputName} onChange={(event) => setOutputName(event.target.value)} placeholder="whiteboard-scene" /></label><button type="button" className="button primary whiteboard-render-button" onClick={() => void renderWhiteboard()} disabled={busy}>{busy ? `Đang render · ${Math.round(job?.progress || 0)}%` : "▶ Render Whiteboard"}</button><div className="whiteboard-status" aria-live="polite">{job && <><strong>{job.message}</strong><div className="whiteboard-progress"><i style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }} /></div><small>{job.status === "completed" ? "Đã lưu vào thư viện video render." : "Đang xử lý ở local renderer."}</small></>}{error && <p className="whiteboard-error">{error}</p>}{downloadUrl && <a className="button secondary whiteboard-download" href={downloadUrl} download>{job?.clip?.name || "Tải video Whiteboard"} ↓</a>}</div></section>
      </aside>
    </section>
  </>;
}
