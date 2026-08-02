# Hahaha — Ứng dụng nội bộ công ty (LAN)

Nhắn tin • Gọi thoại/video • Chia sẻ tài liệu ở chế độ **chỉ xem**.
Toàn bộ dữ liệu nằm trên một máy trong công ty, **không đi ra Internet**.

![Hahaha](https://img.shields.io/badge/chạy%20trong-LAN%20nội%20bộ-b3122b)

---

## 1. Cài đặt (một lần, trên máy làm "máy chủ")

Máy chủ có thể là bất kỳ máy tính nào luôn bật và nối cùng wifi công ty.

1. Cài **Node.js 18 trở lên**: https://nodejs.org (bản LTS).
2. Mở Terminal / PowerShell tại thư mục `hahaha` rồi chạy:

```bash
npm install
npm start
```

Màn hình sẽ hiện:

```
  ██  Hahaha - máy chủ nội bộ đã sẵn sàng
   https://localhost:8443
   https://192.168.1.25:8443      <-- địa chỉ để mọi người truy cập
   Mã tham gia công ty: hahaha
```

## 2. Nhân viên vào app như thế nào

* Máy tính / điện thoại **nối cùng wifi công ty**, mở trình duyệt và gõ địa chỉ
  `https://192.168.1.25:8443` (thay bằng địa chỉ máy chủ in ra ở trên).
* Lần đầu trình duyệt báo *"Kết nối không riêng tư"* — đó là do chứng chỉ tự ký
  do chính máy chủ tạo ra. Bấm **Nâng cao → Tiếp tục truy cập**. Chỉ cần làm một lần.
* Người **đăng ký đầu tiên** trở thành **quản trị viên**.
* Người sau đăng ký cần nhập **mã công ty** (mặc định `hahaha`).

Đổi mã công ty và cổng:

```bash
HAHAHA_JOIN_CODE="fujiwa2026" HAHAHA_PORT=8443 npm start        # macOS / Linux
set HAHAHA_JOIN_CODE=fujiwa2026 && npm start                     # Windows CMD
```

| Biến môi trường | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `HAHAHA_PORT` | `8443` | Cổng HTTPS chính |
| `HAHAHA_HTTP_PORT` | `8080` | Cổng HTTP, chỉ để chuyển hướng sang HTTPS |
| `HAHAHA_JOIN_CODE` | `hahaha` | Mã bắt buộc khi tạo tài khoản |
| `HAHAHA_MAX_FILE_MB` | `200` | Dung lượng tối đa mỗi tài liệu |
| `HAHAHA_DATA_DIR` | `./data` | Nơi lưu tin nhắn, tài khoản, tài liệu |

> **Windows**: lần đầu chạy, Windows Firewall sẽ hỏi — chọn **Cho phép truy cập**
> ở "Mạng riêng (Private)" để các máy khác trong công ty vào được.

## 3. Tính năng

| | |
| --- | --- |
| 💬 **Kênh chung** | Kênh "Toàn công ty" có sẵn; ai cũng tạo thêm kênh phòng ban được |
| 🔒 **Tin nhắn riêng** | 1-1, chỉ hai người nhìn thấy |
| 📞 **Gọi thoại / video** | 1-1 hoặc cả nhóm trong kênh, kèm chuông báo cuộc gọi đến |
| 🖥️ **Chia sẻ màn hình** | Ngay trong cuộc gọi |
| 📄 **Tài liệu chỉ xem** | PDF, ảnh, video, văn bản mở ngay trong app, có đóng dấu tên người xem |
| 📁 **Kho tài liệu** | Tìm lại mọi tài liệu đã chia sẻ |
| 👥 **Trạng thái trực tuyến** | Biết ai đang online, ai đang nhập tin |
| 📱 **Chạy trên điện thoại** | Giao diện tự co giãn, không cần cài app |

## 4. Bảo mật nội bộ hoạt động ra sao

* **Không có dịch vụ bên ngoài.** Không Firebase, không cloud, không STUN/TURN.
  Cuộc gọi WebRTC nối thẳng máy-với-máy trong LAN.
* **HTTPS bắt buộc.** Chứng chỉ tự sinh khi chạy lần đầu, lưu ở `data/server.crt`.
  Đây cũng là điều kiện để trình duyệt cho phép dùng micro/camera.
* **Mật khẩu** băm bằng `scrypt` + salt riêng, phiên đăng nhập bằng cookie `HttpOnly`.
* **Tài liệu** chỉ trả về cho người có quyền vào cuộc trò chuyện chứa tài liệu đó,
  luôn ở dạng `inline`, kèm `Cache-Control: no-store`.

### Giới hạn cần biết về chế độ "chỉ xem"

Hahaha bỏ nút tải xuống, chặn menu chuột phải, chặn `Ctrl+S/P`, render PDF ra
canvas (không nhúng trình đọc PDF của trình duyệt) và **đóng dấu chìm tên người
đang xem** lên toàn trang. Việc này ngăn chia sẻ vô ý và giúp truy vết nếu ảnh
chụp màn hình bị lộ — nhưng **không phải DRM**: người xem vẫn có thể chụp màn
hình hoặc chụp bằng điện thoại. Không có phần mềm nào chặn được điều đó.

### Trước khi triển khai rộng, nên làm thêm

1. Đổi `HAHAHA_JOIN_CODE` khỏi giá trị mặc định.
2. Sao lưu định kỳ thư mục `data/` (chứa toàn bộ tin nhắn và tài liệu).
3. Cho máy chủ một **địa chỉ IP tĩnh** để địa chỉ truy cập không đổi.
4. Nếu công ty có tên miền nội bộ, cấp chứng chỉ đúng tên miền để hết cảnh báo trình duyệt.

## 5. Cấu trúc mã nguồn

```
hahaha/
├── server.js          # HTTPS + Express + Socket.IO + báo hiệu cuộc gọi
├── lib/db.js          # Lưu trữ JSON (tài khoản, kênh, tin nhắn, tài liệu)
├── lib/auth.js        # Băm mật khẩu, phiên đăng nhập, cookie
├── public/index.html  # Giao diện chính
├── public/viewer.html # Trình xem tài liệu chỉ-xem (pdf.js render canvas)
├── public/js/app.js   # Chat, danh bạ, kho tài liệu, giao diện cuộc gọi
├── public/js/call.js  # WebRTC dạng lưới (mesh) cho gọi nhóm
└── data/              # Dữ liệu chạy thật — không đưa lên git
```

## 6. Chạy nền 24/7 (tuỳ chọn)

```bash
npm install -g pm2
pm2 start server.js --name hahaha
pm2 save && pm2 startup     # tự khởi động lại khi bật máy
```
