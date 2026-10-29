# 26. Triển khai

## 1. Chạy trên máy

Cổng dùng riêng, không trùng School Management (3100, 3101, 5190 đến 5196, 5432, 8333):

| Thành phần | Cổng |
|---|---|
| Máy chủ API | 3300 |
| Ứng dụng chợ | 5300 |
| Ứng dụng quản trị | 5301 |
| PostgreSQL (docker-compose) | 5442 |
| Kho tệp S3 (SeaweedFS) | 8343 |
| Kiểm thử đầu cuối | API 3390, chợ 5390, quản trị 5391 |

Các bước: README mục "Chạy trên máy".

## 2. Biến môi trường

Xem `.env.example`. Bắt buộc: `DATABASE_URL`, `MARKET_SECRETS_KEY`. Không bắt buộc: `MARKET_FILES_KEY` (trống thì không nhận tệp), `S3_*`, `VIDEO_PROVIDER` và `LIVEKIT_*`, `MARKET_IDENTITY_PROVIDERS`, `MARKET_HOST`, `MARKET_JOB_INTERVAL_SECONDS`, `TRUST_PROXY`.

## 3. Môi trường thật

Chưa có. Cần Eric quyết định trước khi triển khai: tên miền, máy chủ, nhà cung cấp video, thư điện tử và tin nhắn, nhà cung cấp định danh, sao lưu. Chưa có biên bản triển khai.
