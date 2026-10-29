# 02. Nhật ký dự án

### 2026-10-30 — Khởi tạo bằng cách tách khỏi School Management

#### Công việc đã thực hiện

- Tạo kho riêng tư `luckyshopvn/cho-gia-su`, monorepo pnpm: `apps/api`, `apps/web`, `apps/quan-tri`, `packages/database`, `packages/ui`, `packages/pwa`, `packages/config`, `tests`.
- Chép mã chợ từ School Management (`main` commit `133b2d11`), thay phụ thuộc vào gói của School Management bằng bản chép phần cần dùng.
- Bỏ liên kết hồ sơ con với trường, công tắc bật chợ và tên miền trong cấu hình, kiểm tên miền nền tảng, đăng nhập nhân viên vận hành.
- Thêm cấu hình chợ ở bảng `market_settings`, tài khoản quản trị riêng có TOTP và mã khôi phục, lệnh `tao-quan-tri`, ứng dụng quản trị.
- docker-compose riêng (PostgreSQL 5442, SeaweedFS 8343), lệnh `cai-dat-tren-may`, `pnpm dev`, CI.
- Kiểm thử: chuyển kiểm thử máy chủ và kiểm thử đầu cuối của chợ; bỏ các ca về cách ly với trường và tên miền.

#### Quyết định

- Eric ngày 2026-10-30: sản phẩm riêng, kho riêng tư, không liên hệ với School Management, dữ liệu trống; quản trị bằng ứng dụng và tài khoản riêng có TOTP; giữ Mẫu 03 và khai báo giáo viên đang dạy ở trường.
- Giữ nguyên 11 tệp thay đổi cấu trúc của bản gốc làm bản nền (sửa tệp 0004 bỏ bảng liên kết trường) thay vì gộp thành một tệp, vì cơ sở dữ liệu bắt đầu trống và giữ được truy vết về bản gốc. Claude tự chọn.

#### Vấn đề tồn đọng

- Chưa có môi trường thật, chưa có nhà cung cấp gửi thư điện tử, tin nhắn.
