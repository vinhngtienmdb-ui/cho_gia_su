# 17. Đặc tả API

Máy chủ API ở cổng 3300 (trên máy), tiền tố `/api/v1`. Lỗi trả dạng `{ "error": { "code", "message", "details": [{ "field", "message" }], "correlation_id" } }`.

Xác thực:

- Phiên chợ: `Authorization: Bearer <mã phiên>` lấy từ `POST /market/auth/register`, `/auth/login`, `/identity/complete`. Hạn 7 ngày.
- Phiên quản trị: `Authorization: Bearer <mã phiên>` lấy từ `POST /market/admin/auth/login` (tên đăng nhập, mật khẩu, mã TOTP hoặc mã khôi phục). Hạn 12 giờ. Vai được làm từng việc: `apps/api/src/common/shared.ts`.
- `POST /video/webhook`: chữ ký của máy chủ video.

Danh sách điểm cuối sinh từ mã lúc tách (2026-10-30); chi tiết thân yêu cầu, phản hồi xem ở bộ điều khiển tương ứng trong `apps/api/src`.

| Phương thức | Đường dẫn |
|---|---|
| `GET` | `/api/v1/market/admin` |
| `GET` | `/api/v1/market/admin/accounts` |
| `GET` | `/api/v1/market/admin/auth/me` |
| `GET` | `/api/v1/market/admin/payments` |
| `GET` | `/api/v1/market/admin/payments/disputes/:id` |
| `GET` | `/api/v1/market/admin/reviews` |
| `GET` | `/api/v1/market/admin/reviews-moderation` |
| `GET` | `/api/v1/market/admin/reviews/documents/:id` |
| `GET` | `/api/v1/market/admin/reviews/tutors/:id` |
| `GET` | `/api/v1/market/admin/safety` |
| `GET` | `/api/v1/market/admin/safety/recordings/:bookingId` |
| `GET` | `/api/v1/market/admin/safety/reports/:id` |
| `PUT` | `/api/v1/market/admin/settings` |
| `GET` | `/api/v1/market/bookings` |
| `GET` | `/api/v1/market/bookings/:id/dispute` |
| `GET` | `/api/v1/market/bookings/:id/recording` |
| `GET` | `/api/v1/market/bookings/:id/recording/stream` |
| `GET` | `/api/v1/market/bookings/:id/review` |
| `GET` | `/api/v1/market/bookings/:id/room` |
| `GET` | `/api/v1/market/children` |
| `PUT` | `/api/v1/market/children/:id` |
| `GET` | `/api/v1/market/children/:id/messages` |
| `GET` | `/api/v1/market/identity/linked` |
| `GET` | `/api/v1/market/identity/providers` |
| `GET` | `/api/v1/market/me` |
| `PUT` | `/api/v1/market/me` |
| `GET` | `/api/v1/market/messages/threads` |
| `GET` | `/api/v1/market/messages/threads/:id` |
| `GET` | `/api/v1/market/packages` |
| `GET` | `/api/v1/market/public/documents/:kind` |
| `GET` | `/api/v1/market/public/reviews/:tutorId` |
| `GET` | `/api/v1/market/public/site` |
| `GET` | `/api/v1/market/public/tutors` |
| `GET` | `/api/v1/market/public/tutors/:id` |
| `GET` | `/api/v1/market/recording-consents` |
| `GET` | `/api/v1/market/reports` |
| `GET` | `/api/v1/market/tutor/bookings` |
| `GET` | `/api/v1/market/tutor/bookings/:id/dispute` |
| `GET` | `/api/v1/market/tutor/bookings/:id/recording` |
| `GET` | `/api/v1/market/tutor/bookings/:id/recording/stream` |
| `GET` | `/api/v1/market/tutor/bookings/:id/room` |
| `GET` | `/api/v1/market/tutor/form-03` |
| `GET` | `/api/v1/market/tutor/listing` |
| `PUT` | `/api/v1/market/tutor/listing` |
| `GET` | `/api/v1/market/tutor/profile` |
| `PUT` | `/api/v1/market/tutor/profile` |
| `PUT` | `/api/v1/market/tutor/provider` |
| `GET` | `/api/v1/market/tutor/reviews` |
| `GET` | `/api/v1/market/tutor/safety` |
| `PUT` | `/api/v1/market/tutor/school-role` |
| `POST` | `/api/v1/market/admin/accounts` |
| `POST` | `/api/v1/market/admin/accounts/:id/disable` |
| `POST` | `/api/v1/market/admin/accounts/:id/enable` |
| `POST` | `/api/v1/market/admin/auth/login` |
| `POST` | `/api/v1/market/admin/auth/logout` |
| `POST` | `/api/v1/market/admin/auth/password` |
| `POST` | `/api/v1/market/admin/documents` |
| `POST` | `/api/v1/market/admin/payments/commission-rules` |
| `POST` | `/api/v1/market/admin/payments/disputes/:id/decide` |
| `POST` | `/api/v1/market/admin/payments/disputes/:id/finalize` |
| `POST` | `/api/v1/market/admin/payments/run-due` |
| `POST` | `/api/v1/market/admin/reviews-moderation/:id` |
| `POST` | `/api/v1/market/admin/reviews/tutors/:id/profile` |
| `POST` | `/api/v1/market/admin/reviews/tutors/:id/verifications/:kind` |
| `POST` | `/api/v1/market/admin/safety/reports/:id/assign` |
| `POST` | `/api/v1/market/admin/safety/reports/:id/decide` |
| `POST` | `/api/v1/market/admin/safety/reports/:id/export` |
| `POST` | `/api/v1/market/admin/safety/reports/:id/suspend` |
| `POST` | `/api/v1/market/admin/safety/run-due` |
| `POST` | `/api/v1/market/auth/login` |
| `POST` | `/api/v1/market/auth/logout` |
| `POST` | `/api/v1/market/auth/password/change` |
| `POST` | `/api/v1/market/auth/password/confirm` |
| `POST` | `/api/v1/market/auth/password/forgot` |
| `POST` | `/api/v1/market/auth/password/reset` |
| `POST` | `/api/v1/market/auth/register` |
| `POST` | `/api/v1/market/auth/resend` |
| `POST` | `/api/v1/market/auth/verify` |
| `POST` | `/api/v1/market/bookings` |
| `POST` | `/api/v1/market/bookings/:id/cancel` |
| `POST` | `/api/v1/market/bookings/:id/dispute` |
| `POST` | `/api/v1/market/bookings/:id/mock-pay` |
| `POST` | `/api/v1/market/bookings/:id/review` |
| `POST` | `/api/v1/market/bookings/:id/room/consent` |
| `POST` | `/api/v1/market/bookings/:id/room/decline-recording` |
| `POST` | `/api/v1/market/bookings/:id/room/enter` |
| `POST` | `/api/v1/market/bookings/:id/room/leave` |
| `POST` | `/api/v1/market/bookings/:id/session/join` |
| `POST` | `/api/v1/market/bookings/:id/tutor-no-show` |
| `POST` | `/api/v1/market/children` |
| `POST` | `/api/v1/market/children/:id/consent` |
| `POST` | `/api/v1/market/children/:id/consent/withdraw` |
| `POST` | `/api/v1/market/children/:id/reads-messages` |
| `POST` | `/api/v1/market/disputes/:id/appeal` |
| `POST` | `/api/v1/market/disputes/:id/statements` |
| `POST` | `/api/v1/market/identity/complete` |
| `POST` | `/api/v1/market/identity/start` |
| `POST` | `/api/v1/market/me/consents/:documentId` |
| `POST` | `/api/v1/market/messages/threads` |
| `POST` | `/api/v1/market/messages/threads/:id` |
| `POST` | `/api/v1/market/packages` |
| `POST` | `/api/v1/market/packages/:id/cancel` |
| `POST` | `/api/v1/market/packages/:id/mock-pay` |
| `POST` | `/api/v1/market/payments/webhooks/:provider` |
| `POST` | `/api/v1/market/recording-consents/:id/withdraw` |
| `POST` | `/api/v1/market/reports` |
| `POST` | `/api/v1/market/reports/:id/appeal` |
| `POST` | `/api/v1/market/tutor/bookings/:id/cancel` |
| `POST` | `/api/v1/market/tutor/bookings/:id/complete` |
| `POST` | `/api/v1/market/tutor/bookings/:id/room/confirm` |
| `POST` | `/api/v1/market/tutor/bookings/:id/room/participants/:identity` |
| `POST` | `/api/v1/market/tutor/bookings/:id/session/end` |
| `POST` | `/api/v1/market/tutor/bookings/:id/session/start` |
| `POST` | `/api/v1/market/tutor/listing/submit` |
| `POST` | `/api/v1/market/tutor/reviews/:id/reply` |
| `POST` | `/api/v1/market/tutor/verifications/:kind` |
| `POST` | `/api/v1/video/webhook` |
| `DELETE` | `/api/v1/market/children/:id` |
| `DELETE` | `/api/v1/market/tutor/school-role` |
