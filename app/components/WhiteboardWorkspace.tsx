"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";

const LOCAL_RENDERER_URL = "http://127.0.0.1:4179";
type WhiteboardFileKey = "line" | "color" | "annotation" | "hand" | "audio" | "subtitle";
type WhiteboardFiles = Record<WhiteboardFileKey, File | null>;
type WhiteboardOptions = { drawSpeed: number; colorFill: "hybrid" | "brush" | "contour-wipe"; lineReveal: "skeleton" | "pixel"; matchBg: "auto" | "on" | "off"; aspectRatio: "auto" | "9:16" | "16:9" | "4:3" | "1:1"; capLongEdge: number; audioStartMs: number; bareTip: boolean };
type WhiteboardJob = { id: string; status: "queued" | "preparing" | "rendering" | "completed" | "failed" | "cancelled"; progress: number; message: string; downloadUrl?: string | null; clip?: { name?: string; downloadUrl?: string } | null };
type WhiteboardWorkspaceProps = { onNotify: (message: string) => void };

const initialFiles: WhiteboardFiles = { line: null, color: null, annotation: null, hand: null, audio: null, subtitle: null };
const initialOptions: WhiteboardOptions = { drawSpeed: 0.7, colorFill: "hybrid", lineReveal: "skeleton", matchBg: "auto", aspectRatio: "auto", capLongEdge: 1080, audioStartMs: 0, bareTip: false };
const fileLabels: Record<WhiteboardFileKey, string> = { line: "Line art · bắt buộc", color: "Color reference · khuyến nghị", annotation: "Annotation JSON · bắt buộc", hand: "Bàn tay PNG · tuỳ chọn", audio: "Audio · tuỳ chọn", subtitle: "SRT/VTT · tuỳ chọn" };
const accepts: Record<WhiteboardFileKey, string> = { line: "image/png,image/jpeg,image/webp", color: "image/png,image/jpeg,image/webp", annotation: ".json,application/json", hand: "image/png", audio: "audio/*,.mp3,.wav,.m4a,.aac,.ogg", subtitle: ".srt,.vtt,text/plain" };

function FilePicker({ fileKey, file, onChange }: { fileKey: WhiteboardFileKey; file: File | null; onChange: (file: File | null) => void }) {
  const inputId = `whiteboard-${fileKey}`;
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => { onChange(event.target.files?.[0] ?? null); event.target.value = ""; };
  return <label className={`whiteboard-file-picker ${file ? "ready" : ""}`} htmlFor={inputId}><input id={inputId} type="file" accept={accepts[fileKey]} onChange={handleChange} /><span className="whiteboard-file-icon" aria-hidden="true">{file ? "✓" : "＋"}</span><span className="whiteboard-file-copy"><strong>{fileLabels[fileKey]}</strong><small>{file ? file.name : "Chọn file từ máy"}</small></span></label>;
}

export function WhiteboardWorkspace({ onNotify }: WhiteboardWorkspaceProps) {
  const [files, setFiles] = useState<WhiteboardFiles>(initialFiles);
  const [options, setOptions] = useState<WhiteboardOptions>(initialOptions);
  const [outputName, setOutputName] = useState("whiteboard-scene");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<WhiteboardJob | null>(null);
  const [error, setError] = useState("");
  const linePreviewUrl = useMemo(() => files.line ? URL.createObjectURL(files.line) : "", [files.line]);
  const colorPreviewUrl = useMemo(() => files.color ? URL.createObjectURL(files.color) : "", [files.color]);
  useEffect(() => () => { if (linePreviewUrl) URL.revokeObjectURL(linePreviewUrl); if (colorPreviewUrl) URL.revokeObjectURL(colorPreviewUrl); }, [linePreviewUrl, colorPreviewUrl]);
  const updateFile = (fileKey: WhiteboardFileKey, file: File | null) => { setFiles((current) => ({ ...current, [fileKey]: file })); setError(""); setJob(null); };
  const updateOption = <K extends keyof WhiteboardOptions>(key: K, value: WhiteboardOptions[K]) => setOptions((current) => ({ ...current, [key]: value }));
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
    if (!files.line || !files.annotation) { setError("Hãy chọn đủ Line art và Annotation JSON trước khi render."); return; }
    setBusy(true); setError(""); setJob({ id: "local", status: "queued", progress: 0, message: "Đang gửi tài nguyên…" });
    try {
      const form = new FormData();
      form.append("line", files.line, files.line.name); form.append("annotation", files.annotation, files.annotation.name);
      if (files.color) form.append("color", files.color, files.color.name); if (files.hand) form.append("hand", files.hand, files.hand.name); if (files.audio) form.append("audio", files.audio, files.audio.name); if (files.subtitle) form.append("subtitle", files.subtitle, files.subtitle.name);
      form.append("name", outputName.trim() || "whiteboard-scene"); form.append("options", JSON.stringify(options));
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
    <header className="topbar whiteboard-topbar"><div className="studio-page-title"><span className="studio-page-kicker">KITO WHITEBOARD</span><h1>Render Whiteboard</h1><p>Tô màu theo line art, giữ chuyển động bàn tay và xuất MP4 độc lập với pipeline video hiện tại.</p></div><div className="whiteboard-header-badge"><span>●</span> Renderer riêng · Hybrid fill</div></header>
    <section className="whiteboard-workspace" aria-labelledby="whiteboard-heading">
      <aside className="whiteboard-assets-panel"><div className="whiteboard-panel-heading"><div><span>INPUT</span><h2 id="whiteboard-heading">Tài nguyên</h2></div><small>PNG · JSON · audio</small></div><div className="whiteboard-file-list">{(["line", "color", "annotation", "hand", "audio", "subtitle"] as WhiteboardFileKey[]).map((fileKey) => <FilePicker key={fileKey} fileKey={fileKey} file={files[fileKey]} onChange={(file) => updateFile(fileKey, file)} />)}</div><div className="whiteboard-safe-note"><span>i</span><p>File chỉ được gửi cho local renderer trên máy này. Không thay đổi asset hoặc cảnh của project hiện tại.</p></div></aside>
      <main className="whiteboard-stage"><div className="whiteboard-stage-heading"><div><span>PREVIEW</span><h2>Đối chiếu line / color</h2></div><small>{files.line ? `${files.line.name}${files.color ? ` · ${files.color.name}` : ""}` : "Chưa chọn hình"}</small></div><div className="whiteboard-preview-grid"><div className="whiteboard-preview-card"><span>LINE ART</span>{linePreviewUrl ? <img src={linePreviewUrl} alt="Xem trước line art" /> : <div className="whiteboard-empty-preview">Chọn line art để xem trước</div>}</div><div className="whiteboard-preview-card"><span>COLOR REFERENCE</span>{colorPreviewUrl ? <img src={colorPreviewUrl} alt="Xem trước color reference" /> : <div className="whiteboard-empty-preview">Color reference giúp phủ màu kín hơn</div>}</div></div><div className="whiteboard-flow-note"><strong>Quy trình:</strong> line art được vẽ trước → màu được phủ bằng Hybrid → giữ khung cuối cho tới khi audio kết thúc.</div></main>
      <aside className="whiteboard-settings-panel"><div className="whiteboard-panel-heading"><div><span>SETTINGS</span><h2>Thông số render</h2></div></div><label className="whiteboard-field"><span>Tốc độ vẽ <b>{options.drawSpeed.toFixed(2)}×</b></span><input type="range" min="0.25" max="1.5" step="0.05" value={options.drawSpeed} onChange={(event) => updateOption("drawSpeed", Number(event.target.value))} /><small>0.70× là mức chậm, tự nhiên và cân bằng nhất.</small></label><label className="whiteboard-field"><span>Phủ màu</span><select value={options.colorFill} onChange={(event) => updateOption("colorFill", event.target.value as WhiteboardOptions["colorFill"])}><option value="hybrid">Hybrid · khuyến nghị</option><option value="brush">Brush · theo nét</option><option value="contour-wipe">Contour wipe · phủ kín nhanh</option></select></label><div className="whiteboard-field-grid"><label className="whiteboard-field"><span>Line reveal</span><select value={options.lineReveal} onChange={(event) => updateOption("lineReveal", event.target.value as WhiteboardOptions["lineReveal"])}><option value="skeleton">Skeleton</option><option value="pixel">Pixel</option></select></label><label className="whiteboard-field"><span>Nền</span><select value={options.matchBg} onChange={(event) => updateOption("matchBg", event.target.value as WhiteboardOptions["matchBg"])}><option value="auto">Auto</option><option value="on">Bật</option><option value="off">Tắt</option></select></label></div><div className="whiteboard-field-grid"><label className="whiteboard-field"><span>Tỉ lệ</span><select value={options.aspectRatio} onChange={(event) => updateOption("aspectRatio", event.target.value as WhiteboardOptions["aspectRatio"])}><option value="auto">Theo ảnh</option><option value="9:16">9:16</option><option value="16:9">16:9</option><option value="4:3">4:3</option><option value="1:1">1:1</option></select></label><label className="whiteboard-field"><span>Cạnh dài</span><select value={options.capLongEdge} onChange={(event) => updateOption("capLongEdge", Number(event.target.value))}><option value="720">720 px</option><option value="1080">1080 px</option><option value="1440">1440 px</option></select></label></div><label className="whiteboard-check"><input type="checkbox" checked={options.bareTip} onChange={(event) => updateOption("bareTip", event.target.checked)} /> Không hiển thị bàn tay / bút</label><label className="whiteboard-field"><span>Tên file xuất</span><input value={outputName} onChange={(event) => setOutputName(event.target.value)} placeholder="whiteboard-scene" /></label><button type="button" className="button primary whiteboard-render-button" onClick={() => void renderWhiteboard()} disabled={busy}>{busy ? `Đang render · ${Math.round(job?.progress || 0)}%` : "▶ Render Whiteboard"}</button><div className="whiteboard-status" aria-live="polite">{job && <><strong>{job.message}</strong><div className="whiteboard-progress"><i style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }} /></div><small>{job.status === "completed" ? "Đã lưu vào thư viện video render." : "Đang xử lý ở local renderer."}</small></>}{error && <p className="whiteboard-error">{error}</p>}{downloadUrl && <a className="button secondary whiteboard-download" href={downloadUrl} download>{job?.clip?.name || "Tải video Whiteboard"} ↓</a>}</div></aside>
    </section>
  </>;
}
