# THÔNG TIN VỊ TRÍ

Tài liệu này thống nhất tên gọi và vị trí các khu vực/chức năng trong Kito Video
Studio. Khi yêu cầu chỉnh sửa, nên dùng đúng tên trong tài liệu này để tránh nhầm
lẫn giữa **Zoom camera**, **vòng tròn cột mốc**, **Popup** và **Timeline**.

Ngày cập nhật: 2026-08-03

Sơ đồ trực quan để mở nhanh: [THÔNG TIN VỊ TRÍ.jpg](THÔNG%20TIN%20VỊ%20TRÍ.jpg)

## 1. Cấu trúc màn hình tổng thể

Trên máy tính, giao diện có ba khu vực chính nằm ngang:

```text
┌─────────────────────────────────────────────────────────────────────┐
│  THANH CÔNG CỤ TRÊN CÙNG (Header / Topbar)                          │
├───────────────┬──────────────────────┬──────────────────────────────┤
│  CỘT CẢNH     │  XEM TRƯỚC CẢNH      │  BIÊN SOẠN                   │
│  scene-panel  │  preview-panel        │  editor-panel                │
├───────────────┴──────────────────────┴──────────────────────────────┤
│  TIMELINE (timeline-panel)                                          │
└─────────────────────────────────────────────────────────────────────┘
```

Trên màn hình nhỏ, ba cột được xếp dọc theo thứ tự: **Cảnh → Xem trước cảnh →
Biên soạn → Timeline**.

## 2. Thanh công cụ trên cùng

Tên mã nguồn chính: `.topbar`, `.header-actions`.

Các chức năng:

| Tên gọi thống nhất | Nhãn hiện trên giao diện | Ghi chú |
|---|---|---|
| Bộ chọn chủ đề | `Chủ đề` | Chuyển giữa các project/clip |
| Tạo project | `＋ Clip mới` | Tạo chủ đề mới |
| Đổi giao diện | `☾ Tối` / `☀ Sáng` | Dark/light mode |
| Trạng thái lưu | `Đang tải dữ liệu`, `Chưa lưu`, `Đã lưu...` | `.save-state` |
| Lưu thủ công | `☁ Lưu` | Ghi localStorage và Google Sheet |
| Undo / Redo | `↶` / `↷` | `Ctrl/Cmd + Z/Y` |
| Khôi phục | `↥ Khôi phục` | Khôi phục bản lưu gần nhất |
| Thời lượng project | `Độ dài ... giây` | Dữ liệu `projectDuration` |
| Tạo prompt | `✦ Tạo prompt` | Mở modal prompt |
| Render máy cục bộ | `● Render cục bộ` | Mở modal FFmpeg |
| Hiện/ẩn Timeline | `▾ Ẩn Timeline` / `▴ Hiện Timeline` | Không xóa dữ liệu |
| Xuất JSON | `↓ Xuất JSON` | Tải JSON hiện tại |

## 3. Cột Cảnh

Tên mã nguồn: `.scene-panel`.

### 3.1. Thanh tiêu đề và thao tác

- Tiêu đề: `Cảnh`.
- `Xóa`: xóa cảnh đang chọn; chọn nhiều cảnh bằng cách giữ `Shift`.
- `＋ Thêm`: thêm cảnh mới ở cuối danh sách.
- Hàng `.scene-edit-actions` gồm: `Nhân bản`, `Sao chép`, `Dán`.

### 3.2. Danh sách cảnh

Tên mã nguồn: `.scene-list`; mỗi cảnh là `.scene-item`.

Mỗi thẻ cảnh gồm:

- `drag-dots`: tay nắm kéo đổi thứ tự.
- `scene-number`: số thứ tự.
- `scene-thumb`: ô ảnh thu nhỏ/số cảnh.
- `scene-meta`: tên cảnh và khoảng thời gian `start–end`.
- Giữ `Shift` khi bấm để chọn nhiều cảnh.
- Kéo thả thẻ cảnh để sắp xếp lại thứ tự.

Cuối cột có hai công tắc: `Ảnh trong popup` và `Thuyết minh AI`.

## 4. Khu vực Xem trước cảnh

Tên mã nguồn: `.preview-panel`.

- Tiêu đề: `Xem trước cảnh`.
- `.preview-play-button`: nút `Xem thử` / `Tạm dừng`.
- `.time-pill`: thời gian của cảnh đang chọn.
- `.phone-preview`: khung bản đồ dọc 9:16.
- `.project-background`: ảnh background bản đồ.
- `.zoom-camera-target`: vòng tròn chọn vị trí **Zoom camera**; chỉ hiện khi
  tạm dừng và Zoom camera bật.
- `.zoom-center-marker`: **vòng tròn cột mốc/tâm zoom**, dùng để hiển thị hiệu ứng.
- `.preview-card`: popup nội dung của cảnh.
- `.popup-resize-handle`: tay nắm đổi kích thước popup.
- `.preview-progress`: thanh tiến độ trong khung bản đồ.
- `.map-zoom-badge`: phần trăm zoom và trạng thái xem thử.
- `.playback-live`: nhãn `ĐANG PHÁT`.

Không gọi `.zoom-center-marker` là “Zoom camera”. Tên đúng là **vòng tròn cột
mốc**, **vòng tròn tâm zoom** hoặc **marker effect**.

### Thanh điều khiển dưới bản đồ

Tên mã nguồn: `.preview-footer`.

- Trường `Background`: URL ảnh hiển thị trong bản đồ preview.
- Nút con mắt: ẩn/hiện background preview.
- Nút `◉ Popup`: ẩn/hiện popup.

## 5. Khu vực Biên soạn

Tên mã nguồn: `.editor-panel`; vùng cuộn là `.editor-scroll`.

Các accordion theo đúng số và tên hiển thị:

### `01 Hình ảnh & nền`

- `Background chủ đề`: tên/thông tin background ghi vào JSON.
- Không nhầm với trường `Background` trong `.preview-footer`, là URL ảnh dùng
  trực tiếp trong preview.

### `02 Nội dung cảnh`

- `Thời lượng cảnh`.
- `Tiêu đề`.
- `Nội dung popup`.
- `Lời thuyết minh`.
- `Ảnh popup`.
- `Giọng đọc`.

### `03 Âm thanh`

- `Nhạc nền chủ đề`: ID `editor-music`.
- `File âm thanh thuyết minh`: ID `editor-audio`.

### `04 Chuyển động`

Nhóm này có hai panel con để tránh nhầm lẫn:

#### Panel `Zoom camera`

Tên mã nguồn: `.motion-settings-card`, ID `editor-camera`.

- `Bật hiệu ứng zoom camera`.
- `Mức zoom`.
- `Thời gian bắt đầu hiệu ứng zoom`: `zoomStart`, tính từ đầu cảnh.
- `Thời gian zoom tới mức đó`: `zoomInDuration`.
- `Thời gian thu camera về`: `zoomOutDuration`.

#### Panel `Popup`

Tên mã nguồn: `.popup-motion-settings-card`, ID `editor-popup`.

- `Thời gian bắt đầu xuất hiện popup`: `popupStart`, tính từ đầu cảnh.
- `Thời gian popup`: `popupDuration`.
- `Hiệu ứng mở`: `popupIn`.
- `Hiệu ứng đóng`: `popupOut`.

Khi nói “thời gian popup”, cần ghi rõ là **bắt đầu popup** hay **thời lượng
popup**.

### `05 Hiệu ứng`

Tên mã nguồn: `.effects-editor-content`; công tắc chính có ID `editor-effects`.

- `Hiển thị hiệu ứng vòng tròn cột mốc`: `zoomMarkerEnabled`.
- `Phát sáng`, `Nhấp nháy`, `Làm mờ`: các cài đặt trong `zoomMarkerEffects`.
- `Thời gian chu kỳ`: `zoomMarkerDuration`.
- `Kích thước vòng tròn`: `zoomMarkerSize`.

Nhóm này chỉ điều khiển **vòng tròn cột mốc**, không điều khiển thời điểm Zoom
camera hoặc thời điểm Popup xuất hiện.

## 6. Timeline

Tên mã nguồn: `.timeline-panel`.

### 6.1. Header Timeline

- Tiêu đề: `Timeline`.
- Thông tin tổng: số giây, số cảnh, `30 FPS`.
- `.timeline-transport`: chạy lùi, phát, tạm dừng, chạy tới.
- `.duration-status`: kiểm tra tổng thời lượng cảnh với `projectDuration`.
- `.timeline-resize-handle`: kéo mép trên để đổi chiều cao trên desktop.

### 6.2. Các track

| Tên track | Đối tượng | Cách thao tác |
|---|---|---|
| `Camera` | `.camera-clip` | Bấm mở `editor-camera`; kéo mép đổi biên cảnh |
| `Popup` | `.popup-clip` | Bấm mở `editor-popup`; kéo toàn thanh đổi `popupStart`; kéo mép đổi thời lượng |
| `Thuyết minh` | `.voice-clip` | Bấm mở `editor-audio` |
| `Nhạc nền` | `.music-clip` | Bấm mở `editor-music` |

### 6.3. Đường phát và tua

- `.timeline-playhead-layer`: lớp chứa đường phát màu xanh.
- `.playhead`: đường xanh và nhãn thời gian hiện tại.
- Khi đang phát: đường xanh tự động di chuyển.
- Khi tạm dừng: kéo `.playhead-grabber` để tua đến vị trí bất kỳ.
- Kéo playhead sẽ cập nhật `playTime` và chọn cảnh tương ứng.
- `Space`: phát/tạm dừng; `Arrow Left` và `Arrow Right`: tua 1 giây.

## 7. Các modal

Các modal đều nằm trên lớp `.modal-backdrop`:

- `Tạo chủ đề mới`: modal tạo project.
- `.prompt-modal`: modal `Trình tạo prompt`.
- `.local-render-modal`: modal `Render video trên máy`.
  - `.preflight-card`: kiểm tra tài nguyên, URL và FFmpeg.
  - `Tài nguyên JSON đang yêu cầu`: danh sách file JSON cần.
  - `Thư viện tài nguyên`: IndexedDB và file dùng cho render.
- `.zoom-setup-modal`: modal `Thiết lập hiệu ứng` cho vòng tròn cột mốc.

## 8. Tên dữ liệu cảnh

| Tên dữ liệu | Ý nghĩa |
|---|---|
| `start`, `end` | Biên toàn bộ cảnh trên Timeline |
| `zoomStart` | Thời điểm bắt đầu zoom, tính từ đầu cảnh |
| `zoomInDuration` | Thời gian zoom từ 1× tới mức zoom |
| `zoomOutDuration` | Thời gian thu camera về |
| `popupStart` | Thời điểm popup bắt đầu, tính từ đầu cảnh |
| `popupDuration` | Thời lượng popup |
| `zoomEnabled` | Bật/tắt chuyển động zoom camera |
| `centerX`, `centerY` | Vị trí tâm zoom trên bản đồ, đơn vị phần trăm |
| `zoomMarkerEnabled` | Bật/tắt vòng tròn cột mốc |
| `zoomMarkerEffects` | Hiệu ứng riêng của vòng tròn cột mốc |
| `popupIn`, `popupOut` | Hiệu ứng mở/đóng popup |

## 9. Mẫu câu yêu cầu chỉnh sửa

Nên mô tả theo mẫu:

```text
Khu vực: Biên soạn > 04 Chuyển động > Panel Popup
Đối tượng: Thời gian bắt đầu xuất hiện popup (`popupStart`)
Cảnh: Cảnh số 2, “Đánh bại Gôliát”
Thay đổi: đổi từ 1,0 giây thành 1,8 giây
Kỳ vọng: preview, Timeline và JSON đều dùng giá trị 1,8 giây
```

Ví dụ khác:

```text
Khu vực: Timeline > track Popup
Đối tượng: mép phải thanh Popup của cảnh số 2
Thay đổi: kéo dài thêm 0,5 giây
Kỳ vọng: chỉ tăng `popupDuration`, không đổi `popupStart`
```

Tránh chỉ nói “ô bên phải”, “vòng tròn”, “thanh màu tím” hoặc “thời gian zoom”
nếu chưa nêu rõ khu vực và tên chức năng.
