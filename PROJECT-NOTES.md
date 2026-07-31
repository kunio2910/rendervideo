# Ghi chú dự án Kito Video Studio

Tài liệu này dùng để xem nhanh chức năng, cấu trúc dữ liệu và quy trình xử lý
của dự án `rendervideo`. Khi tiếp tục phát triển trong những lần sau, nên đọc
file này trước rồi mới xem chi tiết mã nguồn.

## 1. Mục đích dự án

Kito Video Studio là công cụ biên soạn clip dọc 9:16 dựa trên bản đồ hành trình.
Người dùng tạo nhiều cảnh, đặt tâm zoom camera, soạn popup, gắn ảnh và âm thanh,
xem thử timeline rồi xuất JSON để renderer tạo video cuối cùng.

Các địa chỉ đang sử dụng:

- GitHub: <https://github.com/kunio2910/rendervideo>
- GitHub Pages: <https://kunio2910.github.io/rendervideo/>
- Production: <https://kito-video-studio.w9tty64sgh.chatgpt.site>

## 2. Công nghệ và file quan trọng

- React 19, TypeScript và Vinext/Vite.
- `app/page.tsx`: gần như toàn bộ giao diện, state và logic biên soạn.
- `app/globals.css`: bố cục, giao diện sáng/tối, timeline và animation.
- `app/lib/googleSheets.ts`: đọc/ghi dữ liệu qua Google Apps Script.
- `scripts/export-github-pages.mjs`: tạo bản tĩnh cho GitHub Pages.
- `scripts/render-video.mjs`: renderer FFmpeg cục bộ được tạo để dựng video từ
  JSON và tài nguyên trong `source/`.
- `scripts/local-render-server.mjs`: dịch vụ HTTP cục bộ nhận JSON/media từ
  nút Render cục bộ, gọi renderer, trả tiến độ và file MP4.
- `scripts/setup-local-renderer.ps1`: tải và cài FFmpeg vào `.local-renderer/`.
- `source/`: tài nguyên ảnh và âm thanh dùng khi render cục bộ.
- `outputs/`: video đã render và các gói triển khai.
- `.openai/hosting.json`: định danh dự án production.

Lưu ý: `source/` có thể chứa tài nguyên riêng và hiện không được đưa lên GitHub.

### Quy trình render cục bộ

1. Chạy `npm run render:setup` một lần để cài FFmpeg.
2. Chạy `npm run render:local` và giữ cửa sổ lệnh mở.
3. Trên website bấm **Render cục bộ**.
4. Chọn ảnh và âm thanh có tên khớp với tên được liệt kê trong JSON.
5. Bấm **Bắt đầu render**, theo dõi tiến độ và tải MP4 khi hoàn tất.

Dịch vụ chạy tại `127.0.0.1:4179`, chỉ xử lý một tác vụ tại một thời điểm.
Website gửi JSON cùng file media bằng multipart form. Mỗi tác vụ có thư mục
riêng trong `work/local-render-jobs/`; script render dùng FFmpeg để tạo từng
cảnh, ghép lời thuyết minh, trộn nhạc nền rồi nối thành video cuối.

## 3. Các khu vực giao diện

### Danh sách cảnh

- Thêm và xóa cảnh.
- Chọn cảnh để biên soạn.
- Kéo thả để thay đổi thứ tự.
- Sau khi sắp xếp, thời gian bắt đầu/kết thúc được tính lại liên tục.
- Tạo chủ đề mới để bắt đầu một clip hoàn toàn mới.
- Không còn trạng thái “Chờ duyệt”; trạng thái chính là Nháp hoặc Đã duyệt.

### Xem trước bản đồ

- Preview theo tỷ lệ dọc 9:16.
- Ô `Background` nằm ngay dưới bản đồ nhận URL ảnh dùng cho preview.
- Nút con mắt cạnh ô Background cho phép ẩn/hiện ảnh bản đồ.
- `Background chủ đề` trong Biên soạn chỉ là tên/metadata; nó không thay đổi
  ảnh preview.
- Lăn chuột trên bản đồ để zoom; thao tác này không cuộn trang.
- Kéo vòng tròn tâm zoom để thay đổi `centerX` và `centerY`.
- Có thể kéo góc popup để tăng/giảm chiều rộng và chiều cao.
- Có nút ẩn/hiện popup.

### Biên soạn

Các thông tin chính:

- Background chủ đề: tên hoặc mô tả, chỉ dùng trong JSON.
- Tiêu đề, địa danh, trích dẫn và nội dung popup.
- Lời thuyết minh và ước lượng thời gian đọc.
- URL ảnh popup.
- Giọng đọc và file âm thanh thuyết minh.
- Nhạc nền cấp dự án.
- Mức zoom, thời gian zoom vào và thời gian thu camera về.
- Thời gian popup.
- Hiệu ứng mở/đóng popup.

Các hiệu ứng popup đang có:

- Fade kết hợp trượt.
- Zoom/thu nhỏ.
- Trượt trái.
- Trượt phải.
- Nảy nhẹ.
- Lật 3D.

### Timeline

- Timeline được ghim cố định ở đáy màn hình như footer.
- Kéo tay nắm ở giữa mép trên để thay đổi chiều cao.
- Chiều cao mặc định: 245 px.
- Giới hạn kéo: 220–520 px.
- Các hàng và clip tự co giãn theo chiều cao timeline.
- Các hàng gồm Camera, Popup, Thuyết minh và Nhạc nền.
- Bấm một event sẽ:
  1. Chọn đúng cảnh.
  2. Đưa playhead đến đầu cảnh.
  3. Dừng xem thử nếu đang phát.
  4. Cuộn panel Biên soạn tới đúng ô liên quan.
  5. Nháy viền ô tương ứng để dễ nhận biết.

## 4. Chế độ Xem thử

Khi bấm `Xem thử`:

1. Timeline chạy lại từ giây 0.
2. Cảnh đang phát được tự động chọn.
3. Camera zoom từ 1× tới `zoom` trong `zoomInDuration`.
4. Camera giữ mức zoom rồi thu về trong `zoomOutDuration`.
5. Popup xuất hiện sau khi zoom vào và tồn tại trong `popupDuration`.
6. Hiệu ứng mở/đóng lấy từ `popupIn` và `popupOut`.
7. Nếu có file âm thanh hợp lệ, thuyết minh của cảnh sẽ được phát.

URL âm thanh phải truy cập trực tiếp được. File được chọn từ máy có thể xem
trước trong phiên hiện tại nhưng cần được đặt cùng gói media khi render thật.

## 5. Lưu và khôi phục dữ liệu

Dữ liệu được lưu theo hai lớp:

1. `localStorage`: giúp giao diện phục hồi nhanh trên thiết bị hiện tại.
2. Google Sheet qua Google Apps Script: giúp mở lại dữ liệu ở lần sau.

Google Apps Script hiện dùng:

`https://script.google.com/macros/s/AKfycbylbUDCQZjsbVtWTb82KaNUICw_VySn7K3qSN3-51tnmgHJ2NM2zbiXUSLNDTjEIamqpg/exec`

Project ID gửi lên Apps Script:

`render-video-default`

Quy trình:

- Khi mở trang: thử đọc localStorage trước, sau đó tải dữ liệu Google Sheet.
- Khi chỉnh sửa: lưu localStorage và tự động gửi dữ liệu lên Google Sheet sau
  một khoảng chờ ngắn.
- Nút Lưu cho phép lưu ngay lập tức.
- Nếu Google Sheet lỗi, dữ liệu cục bộ vẫn được giữ và giao diện báo trạng thái
  offline.

## 6. Cấu trúc dữ liệu trong ứng dụng

Mỗi dự án có:

- `id`, `title`, `projectDuration`.
- `imageEnabled`, `narrationEnabled`.
- `background`: tên/metadata background chủ đề.
- `previewBackground`: URL ảnh hiển thị trong bản đồ.
- `backgroundVisible`.
- `backgroundMusic`.
- `scenes`.

Mỗi cảnh có các nhóm dữ liệu:

- Nội dung: `title`, `location`, `reference`, `popup`, `narration`.
- Timeline: `start`, `end`.
- Camera: `zoom`, `zoomInDuration`, `zoomOutDuration`, `centerX`, `centerY`.
- Popup: `popupDuration`, `popupIn`, `popupOut`, `popupWidth`,
  `popupHeight`, `popupVisible`.
- Media: `image`, `voiceFile`, `voice`.

## 7. JSON xuất ra

Ví dụ rút gọn:

```json
{
  "title": "Hành trình Vua Đa-vít",
  "duration": 30,
  "resolution": "1080x1920",
  "background": "map.png",
  "backgroundUrl": "https://example.com/map.png",
  "backgroundVisible": true,
  "backgroundMusic": "nhac-nen.mp3",
  "scenes": [
    {
      "milestone": 1,
      "title": "Samuel xức dầu",
      "start": 0,
      "zoomInDuration": 1,
      "popupDuration": 3,
      "zoomOutDuration": 1.5,
      "zoom": 2.25,
      "centerX": 20.6,
      "centerY": 10.7,
      "location": "Bêlem",
      "reference": "1 Sm 16,1-13",
      "body": "Nội dung popup",
      "image": "samuel.jpg",
      "narration": "Lời thuyết minh",
      "voiceFile": "milestone-1.mp3",
      "popupIn": "fade-slide-up",
      "popupOut": "fade-slide-down",
      "popupWidth": 90,
      "popupHeight": 255,
      "popupVisible": true
    }
  ]
}
```

Quy tắc media:

- `voiceFile` chỉ còn tên file, không có tiền tố `audio/`.
- `image` chỉ còn tên file, không có `image/` hoặc `images/`.
- `background` chỉ còn tên file nếu người dùng nhập đường dẫn.
- `backgroundUrl` giữ nguyên URL để renderer có thể tải ảnh.
- `backgroundMusic` chỉ xuất khi có giá trị.
- `image` và `voiceFile` không xuất nếu ô tương ứng để trống.
- `background` và `backgroundUrl` không xuất nếu để trống.

## 8. Quy trình render video cục bộ

Renderer hiện dùng FFmpeg và Sharp.

Quy trình tổng quát:

1. Đọc file JSON.
2. Xác định background từ URL hoặc `source/map.png`.
3. Tìm ảnh popup từ URL, đường dẫn dự án hoặc `source/`.
4. Tìm âm thanh theo tên file; nếu thiếu có thể ánh xạ theo số thứ tự cảnh.
5. Tạo ảnh popup cho từng cảnh bằng Sharp.
6. Render riêng từng cảnh:
   - Nền dọc 1080×1920.
   - Zoom theo `zoom`, `centerX`, `centerY` và thời gian.
   - Popup xuất hiện/biến mất theo timeline.
   - Ghép thuyết minh.
7. Nối các cảnh thành MP4 cuối cùng.
8. Kiểm tra video bằng FFprobe.

Ví dụ chạy renderer:

```powershell
node scripts/render-video.mjs "duong-dan\project.json" "outputs\video.mp4"
```

FFmpeg cục bộ đang được tìm tại:

`C:\Users\le.tt\Documents\Kito\tools\ffmpeg\ffmpeg-8.1.2-essentials_build\bin\ffmpeg.exe`

## 9. Quy trình phát triển và kiểm tra

Chạy local:

```powershell
npm install
npm run dev
```

Build production:

```powershell
npm run build
```

Build GitHub Pages:

```powershell
npm run build:pages
```

Sau mỗi thay đổi quan trọng:

1. Build production.
2. Build GitHub Pages.
3. Kiểm tra `git diff --check`.
4. Commit mã nguồn và tài nguyên build cần thiết.
5. Push nhánh `main` lên GitHub.
6. Lưu một phiên bản Sites mới và triển khai production.
7. Nếu trình duyệt còn cache cũ, dùng `Ctrl + F5`.

## 10. Những điểm cần chú ý khi phát triển tiếp

- Không commit `source/` nếu tài nguyên chưa được phép công khai.
- Không ghi đè thay đổi cục bộ chưa commit khi pull GitHub.
- Khi thêm trường dự án mới, phải cập nhật đồng thời:
  - TypeScript type.
  - State React.
  - `currentProject`.
  - `openProject`.
  - Logic migration dữ liệu cũ.
  - JSON export.
- Khi thêm hiệu ứng popup mới, cập nhật cả danh sách select và CSS animation.
- Khi sửa timeline, kiểm tra cả trạng thái thu nhỏ và mở rộng.
- Renderer nên bỏ qua media thiếu thay vì đoán đường dẫn hoặc chèn file giả.
- URL từ Cloudinary hoặc máy chủ ảnh phải là URL tải trực tiếp.
- Tổng thời gian cảnh không nên vượt `projectDuration`.

## 11. Trạng thái repository khi tạo ghi chú

- Nhánh chính: `main`.
- Commit chức năng gần nhất: `fc95102`.
- `source/` và `scripts/render-video.mjs` đang là nội dung cục bộ chưa được
  theo dõi trong Git.
