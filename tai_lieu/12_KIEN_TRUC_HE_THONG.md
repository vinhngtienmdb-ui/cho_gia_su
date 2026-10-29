# 12. Kiến trúc hệ thống

```
Trình duyệt ──► apps/web (Vite, React)      ──┐  /api/v1/market/*
Trình duyệt ──► apps/quan-tri (Vite, React) ──┤  /api/v1/market/admin/*
Máy chủ video (LiveKit) ── sự kiện có chữ ký ─┤  /api/v1/video/webhook
                                              ▼
                                  apps/api (NestJS, cổng 3300)
                                    │            │            │
                       PostgreSQL `cho_gia_su`  Kho tệp S3   LiveKit, nhà cung cấp định danh OIDC
                       (vai trò riêng)          (mã hóa tệp)
```

| Thành phần | Thư mục | Ghi chú |
|---|---|---|
| Máy chủ API | `apps/api` | Mô-đun gốc `application.module.ts`; mã chợ ở `src/market`, tài khoản quản trị ở `src/admin`, hạ tầng chung ở `src/common` |
| Ứng dụng chợ | `apps/web` | Một ứng dụng cho phụ huynh và gia sư, cài được (service worker của `packages/pwa`) |
| Ứng dụng quản trị | `apps/quan-tri` | Đăng nhập mật khẩu và TOTP, phiên lưu ở sessionStorage |
| Cơ sở dữ liệu | `packages/database` | Kysely, tệp thay đổi cấu trúc ở `migrations/`, cấu hình chợ ở bảng `market_settings` |
| Giao diện dùng chung | `packages/ui` | Nút, thông báo, hộp xác nhận, ô biểu mẫu, phòng video |
| Kiểm thử đầu cuối | `tests` | Playwright |

Quyết định kiến trúc:

- Không có bộ kiểm phiên toàn cục: từng điểm cuối gọi `MarketContext.account` (phiên chợ) hoặc `MarketContext.operator` (phiên quản trị, theo vai).
- Phiên là chuỗi ngẫu nhiên 32 byte, cơ sở dữ liệu chỉ giữ băm SHA-256.
- Việc định kỳ (nhả chỗ giữ, giải ngân, xóa bản ghi hết hạn) chạy bằng hẹn giờ trong tiến trình API (`MARKET_JOB_INTERVAL_SECONDS`); chạy nhiều bản API cùng lúc là chưa xác định.
- Giới hạn tần suất theo địa chỉ mạng trong bộ nhớ của tiến trình (`market-rate-limit.ts`).
