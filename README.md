# Chợ gia sư

Nền tảng kết nối phụ huynh với gia sư dạy kèm trực tuyến: ứng dụng chung cho phụ huynh và gia sư, ứng dụng quản trị, máy chủ API, cơ sở dữ liệu riêng. Thanh toán chỉ giả lập.

Sản phẩm tách khỏi School Management ngày 2026-10-30 và độc lập hoàn toàn: không đăng nhập chung, không chia sẻ dữ liệu, không đường dẫn qua lại. Nguồn gốc mã và các phần đã bỏ khi tách: [tai_lieu/04_TONG_QUAN_DU_AN.md](tai_lieu/04_TONG_QUAN_DU_AN.md). Mục lục tài liệu: [tai_lieu/index.md](tai_lieu/index.md).

## Cấu trúc

| Thư mục                                          | Nội dung                                                        |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `apps/api`                                       | Máy chủ API (NestJS), cổng 3300                                 |
| `apps/web`                                       | Ứng dụng chợ cho phụ huynh và gia sư (React, Vite), cổng 5300   |
| `apps/quan-tri`                                  | Ứng dụng quản trị, cổng 5301                                    |
| `packages/database`                              | Kiểu bảng, tệp thay đổi cấu trúc, cấu hình chợ                  |
| `packages/ui`, `packages/pwa`, `packages/config` | Giao diện dùng chung, vỏ ứng dụng cài được, cấu hình TypeScript |
| `tests`                                          | Kiểm thử đầu cuối (Playwright)                                  |

## Chạy trên máy

Cần Node.js 24, pnpm 10, Docker.

1. Chép `.env.example` thành `.env`, điền `POSTGRES_PASSWORD`, `MARKET_SECRETS_KEY`, `MARKET_FILES_KEY` (khóa sinh bằng lệnh ghi ở đầu tệp mẫu).
2. Cài và dựng:

   ```bash
   pnpm install
   ```

   ```bash
   pnpm environment:start
   ```

   ```bash
   pnpm build
   ```

3. Tạo cơ sở dữ liệu `cho_gia_su`, ghi `DATABASE_URL` vào `.env`, chạy tệp thay đổi cấu trúc:

   ```bash
   pnpm cai-dat-tren-may
   ```

4. Tạo tài khoản quản trị đầu tiên. Mật khẩu (từ 12 ký tự) đặt trong biến `QUAN_TRI_MAT_KHAU` của phiên dòng lệnh; lệnh in khóa TOTP để nhập vào ứng dụng xác thực và 8 mã khôi phục, chỉ một lần:

   ```bash
   pnpm --filter @cho-gia-su/api tao-quan-tri -- --login quantri --name "Họ tên"
   ```

5. Chạy máy chủ API, ứng dụng chợ, ứng dụng quản trị bằng một lệnh, rồi mở http://localhost:5300 và http://localhost:5301:

   ```bash
   pnpm dev
   ```

Khi chạy trên máy, phòng video dùng bộ giả lập (`VIDEO_PROVIDER=mock`), mã xác nhận gửi vào hộp thư giả lập trong máy chủ.

## Kiểm thử

```bash
pnpm test
```

```bash
pnpm test:e2e
```

Kiểm thử máy chủ tự tạo cơ sở dữ liệu riêng cho mỗi lần chạy trên PostgreSQL của docker-compose (cần `POSTGRES_PASSWORD` trong `.env`).

## Định danh

Xác minh danh tính gia sư và đăng nhập bằng nhà cung cấp OIDC khai ở `MARKET_IDENTITY_PROVIDERS` (danh sách JSON, mỗi mục có `code`, `issuer`, `client_id` và các trường của `apps/api/src/common/external-identity/provider-profiles.ts`); khóa bí mật của từng nhà cung cấp đặt ở `MARKET_IDENTITY_<CODE>_CLIENT_SECRET`. Không khai thì ứng dụng ẩn phần đăng nhập bằng định danh.
