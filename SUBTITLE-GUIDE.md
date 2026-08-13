# Phụ đề tự tạo theo lời thuyết minh

## Cách dùng trong Kito Video Studio

1. Mở cảnh cần làm phụ đề.
2. Nhập nội dung vào phần **Lời thuyết minh**.
3. Chọn file audio giọng đọc. File được thêm vào thư viện tài nguyên để dùng cho cả render.
4. Bấm **Tạo từ lời thuyết minh**.
5. Hệ thống gửi text và audio tới local renderer. Nếu có Whisper CLI, Whisper trả về timestamp theo từng segment; nếu chưa có Whisper, hệ thống dùng độ dài và khoảng ngắt tiếng của audio để tạo cue dự phòng.
6. Phát từng cue trên preview, rà soát câu chữ, thời gian bắt đầu/kết thúc và xóa/ẩn cue nếu cần.
7. Lưu project rồi render video.

## Tùy chỉnh kiểu chữ

Trong nhóm phụ đề của cảnh có thể chỉnh:

- Font, kiểu chữ, màu chữ và cỡ chữ.
- Style xuất hiện: không hiệu ứng, Fade in, Pop hoặc Trượt lên.
- Border: độ dày, màu border, màu nền và độ trong suốt nền.

Style được lưu ở `scene.subtitleStyle` và áp dụng cho toàn bộ cue của cảnh. Timestamp và nội dung vẫn được lưu riêng ở `scene.subtitles`, nên có thể rà soát từng câu mà không làm mất thiết lập giao diện.

## Bật Whisper để có timestamp chính xác hơn

Local renderer tìm lệnh `whisper` trong PATH. Có thể chỉ định rõ lệnh và model bằng biến môi trường trước khi chạy renderer:

```powershell
$env:WHISPER_CLI = "whisper"
$env:WHISPER_MODEL = "small"
$env:WHISPER_LANGUAGE = "vi"
npm run render:local
```

Nếu máy chưa cài Whisper, nút vẫn hoạt động nhưng hiển thị cảnh báo rằng cue được tạo bằng fallback. Với bản sản xuất nên cài Whisper/faster-whisper riêng trên máy chạy local renderer, sau đó khởi động lại `npm run render:local`.

## Lưu ý để audio và phụ đề khớp nhất

- Lời thuyết minh nên là đúng nội dung đã dùng để tạo file audio.
- Không nối nhiều đoạn audio khác nội dung vào cùng một file.
- Đặt thời lượng cảnh gần với thời lượng audio; hệ thống co giãn timestamp theo thời lượng cảnh nếu hai giá trị khác nhau.
- Sau khi tạo tự động, luôn nghe lại các cue ở đầu câu, cuối câu và các đoạn có tên riêng/số liệu.
