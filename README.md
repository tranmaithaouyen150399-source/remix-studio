# Remix Studio

Web app cắt ghép video quảng cáo 9:16 từ cảnh quay sản phẩm:

- **Remix video**: tự tìm điểm chuyển cảnh, ghép thành nhiều video khác nhau, có chống trùng.
- **Tạo Source Video**: dựng theo phân cảnh (Hook → Vấn đề → Sản phẩm → Kêu gọi).
- **Kịch bản AI** (Claude): viết kịch bản, xem khung hình, chọn cảnh khớp với từng câu.
- **Giọng đọc AI** (Google Cloud Text-to-Speech): đọc từng câu, phụ đề khớp theo câu.
- Phụ đề tùy chỉnh font, màu, kiểu chữ; sửa và dựng lại từng video; lịch đăng; nhật ký.

Video được dựng ngay trên trình duyệt của người dùng (Chrome, Cốc Cốc, Edge). Máy chủ chỉ giữ khóa API và chuyển yêu cầu tới Claude và Google, nên chạy được trên gói miễn phí.

## Cấu trúc

| File | Vai trò |
|---|---|
| `server.js` | Máy chủ Express: phục vụ trang, `/api/ai` (Claude), `/api/voices` và `/api/tts` (Google), mật khẩu, giới hạn số yêu cầu |
| `public/index.html` | Toàn bộ giao diện và phần dựng video |
| `render.yaml` | Cấu hình đưa lên Render |
| `Dockerfile` | Dùng cho Google Cloud Run hoặc máy chủ riêng |
| `.env.example` | Các biến môi trường cần điền |

## Biến môi trường

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `ANTHROPIC_API_KEY` | Nên có | Khóa Claude API, lấy ở https://platform.claude.com → API Keys. Thiếu thì tắt phần AI. |
| `GOOGLE_TTS_API_KEY` | Nên có | Khóa Google Cloud đã bật Cloud Text-to-Speech API. Thiếu thì tắt giọng AI. |
| `APP_PASSWORD` | **Rất nên có** | Mật khẩu vào trang. Để trống thì ai có link cũng dùng được và tiêu tiền API của bạn. |
| `CLAUDE_MODEL` | Không | Mặc định `claude-opus-5-5`. |

## Chạy thử trên máy

```bash
npm install
cp .env.example .env      # rồi điền khóa vào .env
node --env-file=.env server.js
```

Mở http://localhost:3000

## Đưa lên mạng bằng Render (miễn phí)

1. Đưa thư mục này lên một repo GitHub.
2. Vào https://render.com → đăng nhập bằng GitHub → **New → Blueprint** → chọn repo. Render đọc `render.yaml` và tạo dịch vụ.
3. Điền `ANTHROPIC_API_KEY`, `GOOGLE_TTS_API_KEY`, `APP_PASSWORD` khi Render hỏi → **Apply**.
4. Sau vài phút sẽ có link dạng `https://remix-studio-xxxx.onrender.com`.

Gói miễn phí của Render ngủ sau khoảng 15 phút không dùng; lần mở đầu tiên sau đó mất khoảng 30–60 giây để thức dậy.

## Chi phí ước tính

- **Google TTS**: tính theo số ký tự đọc. Mỗi tháng có hạn mức miễn phí (giọng Standard nhiều hơn, Neural2/Wavenet/Chirp ít hơn); xem bảng giá hiện tại trên trang Google Cloud. Một kịch bản 30 giây khoảng 350 ký tự.
- **Claude API**: tính theo token. Viết kịch bản tốn ít; xem khung hình (mỗi cảnh một ảnh) tốn nhiều hơn. Nên đặt hạn mức chi tiêu trong Claude Console.

## Giới hạn hiện tại

- Dự án, clip và video đã tạo lưu trên trình duyệt (IndexedDB), không đồng bộ giữa các máy.
- Chưa có tài khoản nhiều người dùng, chưa tự đăng lên TikTok.
- Dựng video theo thời gian thực trên trình duyệt: phải giữ tab mở.
