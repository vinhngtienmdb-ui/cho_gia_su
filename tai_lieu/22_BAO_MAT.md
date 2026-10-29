# 22. Bảo mật

| Chủ đề | Hiện trạng |
|---|---|
| Mật khẩu | argon2; tài khoản chợ khóa 15 phút sau 5 lần sai; tài khoản quản trị cũng vậy, cần thêm mã TOTP |
| Phiên | Chuỗi ngẫu nhiên 32 byte, lưu băm SHA-256; chợ 7 ngày, quản trị 12 giờ; khóa tài khoản quản trị thì thu hồi phiên |
| TOTP quản trị | Khóa mã hóa AES-256-GCM bằng `MARKET_SECRETS_KEY`; mỗi mã dùng một lần (lưu bước đã dùng); 8 mã khôi phục dùng một lần, lưu băm |
| Tệp | Giấy tờ gia sư và bản ghi buổi học mã hóa AES-256-GCM bằng `MARKET_FILES_KEY` trước khi vào kho tệp |
| Đặt lại mật khẩu | Mã lưu argon2, tối đa 10 lượt thử và 10 mã trong 24 giờ (YCTD-379) |
| Giới hạn tần suất | 600 yêu cầu mỗi phút mỗi địa chỉ mạng; điểm cuối mã, mật khẩu 30 mỗi phút |
| Trẻ em | Hồ sơ con tối thiểu, không số định danh, không ảnh; tin nhắn lọc thông tin liên lạc; buổi có trẻ dưới 18 tuổi luôn ghi hình |
| Định danh | OIDC có PKCE, state gắn cookie của trình duyệt; chỉ lưu băm mã chủ thể |
| Tiêu đề bảo mật | `securityHeaders()` cho mọi phản hồi của API |

Rủi ro đã biết: giới hạn tần suất và việc định kỳ chạy trong một tiến trình (chạy nhiều bản API cần xem lại); gửi mã xác nhận đang giả lập.
