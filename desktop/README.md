# Kito Video Studio Desktop

Đây là project desktop Windows riêng, tái sử dụng nguyên giao diện trong
`../app/page.tsx` và `../app/globals.css`. Website hiện tại không bị thay đổi
quy trình build hoặc cách sử dụng.

## Chạy ở chế độ phát triển

Từ thư mục này:

```powershell
npm install
npm run build:ui
npm run dev
```

Electron sẽ tự khởi động local renderer tại `http://127.0.0.1:4179`. Chế độ
phát triển dùng `../scripts` và `.local-renderer` của project cha, vì vậy cần
chạy `npm install` ở project cha và chạy `npm run render:setup` một lần.

## Tạo installer Windows

```powershell
npm run dist:win
```

Lệnh này build giao diện, đóng gói các script render, Node runtime, Sharp,
FFmpeg/FFprobe và tạo installer trong `desktop/release/`.

Không ghi dữ liệu render vào thư mục cài đặt. Bản desktop lưu job, cache, log và
video đã render trong thư mục dữ liệu ứng dụng của Windows. Workspace được lưu
bền vững tại `%APPDATA%\\kito-video-studio-desktop\\data\\workspace.json`, nên
nút **Lưu máy** vẫn giữ dữ liệu sau khi đóng và mở lại app. Đăng nhập Google và
đồng bộ Firebase vẫn cần Internet; chỉnh sửa và render cục bộ không cần Internet
nếu media đã có sẵn.

## Backup và chuyển workspace

Trong tab **Xuất**, chọn **Tạo file backup** để tải file `.kito.zip` chứa
workspace cùng thư viện media. Trên máy khác, chọn **Import backup** để khôi
phục project và tiếp tục làm việc mà không cần kết nối tài khoản Google.

## Cấu trúc

- `main.mjs`: khởi động Electron, giao diện và local renderer.
- `preload.cjs`: cầu nối an toàn tối thiểu giữa giao diện và Electron.
- `static-server.mjs`: phục vụ bản build React qua localhost để giữ Firebase OAuth
  và asset path hoạt động ổn định.
- `stage-runtime.mjs`: chuẩn bị runtime Node/Sharp/FFmpeg cho installer.
