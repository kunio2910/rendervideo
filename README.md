# Kito Video Studio

Trình biên tập video hành trình dọc 9:16 với bốn khu vực:

- Danh sách và trạng thái cảnh.
- Preview bản đồ, cột mốc và popup.
- Bảng biên soạn nội dung, ảnh và giọng đọc.
- Timeline popup, thuyết minh và nhạc nền.

## Website

[Mở Kito Video Studio](https://kunio2910.github.io/rendervideo/)

## Phát triển

```bash
npm install
npm run dev
```

Sau đó mở `http://localhost:3000/`. Lệnh này dùng entry point mã nguồn trong
`github-pages/`, không phụ thuộc vào bundle GitHub Pages đã build trước đó.

## Xuất bản GitHub Pages

```bash
npm run build:pages
```

Lệnh này tạo `index.html` cùng các tài nguyên tĩnh ở thư mục gốc để GitHub
Pages có thể phục vụ trực tiếp từ nhánh `main`.

## Render video cục bộ bằng FFmpeg

Thiết lập FFmpeg một lần:

```bash
npm run render:setup
```

Mỗi khi muốn render, mở một cửa sổ lệnh tại thư mục dự án và chạy:

```bash
npm run render:local
```

Giữ cửa sổ đó mở, truy cập website và bấm **Render cục bộ**. Chọn các file ảnh,
giọng đọc và nhạc nền có tên trùng với JSON, sau đó bấm **Bắt đầu render**.
Khi hoàn tất, website hiển thị nút tải video MP4.

Dịch vụ chỉ lắng nghe tại `127.0.0.1:4179`, render một video tại một thời điểm
và lưu file tạm trong `work/local-render-jobs/`.

## Bản desktop Windows

Project desktop nằm riêng trong thư mục `desktop/`, tái sử dụng giao diện hiện
tại và tự khởi động local renderer:

```powershell
cd desktop
npm install
npm run dev
```

Tạo installer Windows:

```powershell
npm run dist:win
```

Installer được tạo tại `desktop/release/`.

Trong tab **Xuất**, nút **Tạo file backup** tạo một file `.kito.zip` gồm
workspace và thư viện media. Trên máy khác, mở cùng ứng dụng rồi chọn
**Import backup**; thao tác này không cần đăng nhập Google. Khi không dùng
Google, nút **Lưu máy** lưu bản làm việc vào dữ liệu cục bộ của trình duyệt/app.
