"use client";

import { useMemo, useState } from "react";

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
  popupDuration: number;
  status: "Nháp" | "Chờ duyệt" | "Đã duyệt";
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
    popupDuration: 3,
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
    popupDuration: 3,
    status: "Chờ duyệt",
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
    popupDuration: 2.5,
    status: "Nháp",
  },
];

const statusClass: Record<Scene["status"], string> = {
  Nháp: "draft",
  "Chờ duyệt": "review",
  "Đã duyệt": "approved",
};

const formatTime = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(4, "0")}`;

export default function Home() {
  const [scenes, setScenes] = useState(initialScenes);
  const [selectedId, setSelectedId] = useState(initialScenes[0].id);
  const [imageEnabled, setImageEnabled] = useState(true);
  const [narrationEnabled, setNarrationEnabled] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [toast, setToast] = useState("");

  const scene = scenes.find((item) => item.id === selectedId) ?? scenes[0];
  const totalDuration = Math.max(...scenes.map((item) => item.end));
  const wordCount = scene.narration.trim().split(/\s+/).filter(Boolean).length;
  const voiceEstimate = Math.max(1, Math.ceil((wordCount / 145) * 60));

  const updateScene = <K extends keyof Scene>(key: K, value: Scene[K]) => {
    setScenes((items) =>
      items.map((item) => (item.id === selectedId ? { ...item, [key]: value } : item)),
    );
  };

  const addScene = () => {
    const last = scenes.at(-1)!;
    const next: Scene = {
      ...last,
      id: `scene-${String(scenes.length + 1).padStart(2, "0")}`,
      number: scenes.length + 1,
      title: "Cảnh mới",
      popup: "Nhập nội dung popup cho cảnh mới.",
      narration: "Nhập lời thuyết minh cho cảnh mới.",
      start: last.end,
      end: last.end + 3,
      status: "Nháp",
    };
    setScenes([...scenes, next]);
    setSelectedId(next.id);
  };

  const exportPayload = useMemo(
    () => ({
      schemaVersion: "1.0.0",
      project: {
        id: "david-journey",
        title: "Hành trình Vua Đa-vít",
        aspectRatio: "9:16",
        duration: totalDuration,
        locale: "vi-VN",
        fps: 30,
      },
      assets: {
        images: scenes.map((item) => ({
          id: `image-${item.number}`,
          src: item.image,
          checksum: "sha256:pending",
        })),
        audio: [
          { id: "background-music", src: "media/hopeful-journey.mp3", checksum: "sha256:pending" },
        ],
      },
      scenes: scenes.map(({ image, ...item }) => ({
        ...item,
        media: { image: imageEnabled ? `image-${item.number}` : null },
        narrationEnabled,
      })),
      renderManifest: {
        file: "render-manifest.json",
        checksumAlgorithm: "sha256",
        generatedAt: new Date().toISOString(),
      },
    }),
    [scenes, imageEnabled, narrationEnabled, totalDuration],
  );

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "david-journey.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("JSON hợp lệ · Đã tải xuống");
    window.setTimeout(() => setToast(""), 2600);
  };

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <h1>Kito Video Studio</h1>
            <p>Hành trình Vua Đa-vít · 15 giây · 9:16</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="button ghost" onClick={() => setPlaying(!playing)}>
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
            <button onClick={addScene}>＋ Thêm</button>
          </div>
          <div className="scene-list">
            {scenes.map((item) => (
              <button
                key={item.id}
                className={`scene-item ${item.id === selectedId ? "active" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="drag-dots" aria-hidden="true">⠿</span>
                <strong>{String(item.number).padStart(2, "0")} · {item.title}</strong>
                <small>
                  {formatTime(item.start)}–{formatTime(item.end)} ·{" "}
                  <i className={statusClass[item.status]}>{item.status}</i>
                </small>
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
          <div className={`phone-preview ${playing ? "is-playing" : ""}`}>
            <div className="map-label">BÊLEM</div>
            <div className="map-road road-one" />
            <div className="map-road road-two" />
            <div className="map-road road-three" />
            <div className="route-line" />
            <div className="map-pin pin-one">1</div>
            <div className="map-pin pin-two">2</div>
            <div className="map-pin pin-three">3</div>
            <div className="map-marker">⌖</div>
            <div className="preview-progress">
              <span style={{ width: `${(scene.end / Math.max(totalDuration, 15)) * 100}%` }} />
            </div>
            <article className="preview-card">
              {imageEnabled && (
                <div className="photo-placeholder">
                  <div className="sun" />
                  <div className="hill hill-a" />
                  <div className="hill hill-b" />
                  <span>Ảnh minh họa 16:9</span>
                </div>
              )}
              <div className="card-content">
                <small>CẢNH {String(scene.number).padStart(2, "0")}</small>
                <h3>{scene.title}</h3>
                <p className="location-line">⌖ {scene.location} · {scene.reference}</p>
                <p>{scene.popup}</p>
              </div>
            </article>
          </div>
          <div className="preview-footer">
            <span><i /> Camera keyframe</span>
            <span><i /> Popup live</span>
            <button title="Chọn tâm zoom">⌖ Chọn tâm zoom</button>
          </div>
        </section>

        <aside className="editor-panel">
          <div className="panel-heading">
            <h2>Biên soạn</h2>
            <span className="scene-pill">Cảnh {scene.number}</span>
          </div>
          <div className="editor-scroll">
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
                  value={scene.image}
                  onChange={(event) => updateScene("image", event.target.value)}
                />
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
            <span>15 giây · {scenes.length} cảnh · 30 FPS</span>
          </div>
          <div className={`duration-status ${totalDuration > 15 ? "has-error" : ""}`}>
            <span>{totalDuration > 15 ? "!" : "✓"}</span>
            {totalDuration > 15
              ? `Vượt giới hạn ${(totalDuration - 15).toFixed(1)} giây`
              : `Tổng: ${totalDuration.toFixed(1)} giây · Không có lỗi`}
          </div>
        </div>
        <div className="timeline">
          <div className="ruler-labels">
            <span />
            {Array.from({ length: 16 }, (_, index) => <i key={index}>{index}s</i>)}
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
              {scenes.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`clip popup-clip ${item.id === selectedId ? "selected" : ""}`}
                  style={{
                    left: `${(item.start / 15) * 100}%`,
                    width: `${Math.min((item.popupDuration / 15) * 100, 100 - (item.start / 15) * 100)}%`,
                  }}
                >
                  Popup {item.number} · {item.popupDuration}s
                </button>
              ))}
            </div>
          </div>
          <div className="track">
            <strong>Âm thanh</strong>
            <div className="track-content grid">
              {narrationEnabled && scenes.slice(0, 2).map((item) => (
                <div
                  key={item.id}
                  className="clip voice-clip"
                  style={{
                    left: `${(item.start / 15) * 100}%`,
                    width: `${((item.end - item.start) / 15) * 100}%`,
                  }}
                >
                  Voice {item.number}
                </div>
              ))}
              <div className="clip music-clip" style={{ left: "58%", width: "42%" }}>
                ♫ Nhạc nền
              </div>
            </div>
          </div>
          <div className="playhead" style={{ left: `${8.2 + (scene.start / 15) * 91.8}%` }}>
            <span>{scene.start.toFixed(1)}s</span>
          </div>
        </div>
      </section>
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}
