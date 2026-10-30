# 16. Cơ sở dữ liệu

PostgreSQL, một cơ sở dữ liệu `cho_gia_su` do vai trò riêng `cho_gia_su_service` sở hữu; quyền kết nối của PUBLIC bị thu. Mốc thời gian lưu theo giờ Việt Nam (tệp 0001). Kiểu bảng ở `packages/database/src/schema.ts` và `src/schema-parts/`.

## Tệp thay đổi cấu trúc

| Tệp | Nội dung |
|---|---|
| 0001 đến 0051 | Chép từ cơ sở dữ liệu `marketplace` của School Management (DT-27 phần 27f đến 27j, YCTD-364, 365); tệp 0004 bỏ bảng `market_school_links` khi tách |
| 0060 | `market_settings`, `market_admins`, `market_admin_recovery_codes`, `market_admin_sessions` (YCTD-393) |

Thêm tệp mới: đặt `migrations/<4 chữ số>_<tên>.ts` và thêm một dòng ở `migrations/index.ts`; kiểm thử `settings.test.ts` báo lỗi khi thiếu.

## Bảng (40)

| Nhóm | Bảng |
|---|---|
| Tài khoản | `market_accounts`, `market_sessions`, `market_verification_codes`, `market_external_identities`, `market_oidc_requests` |
| Văn bản, đồng ý | `market_legal_documents`, `market_consents` |
| Hồ sơ con | `market_children` |
| Gia sư | `market_tutor_profiles`, `market_tutor_subjects`, `market_tutor_availability`, `market_tutor_documents`, `market_tutor_verifications`, `market_tutor_school_roles`, `market_tutor_suspensions`, `market_providers` |
| Đặt buổi, thanh toán | `market_bookings`, `market_packages`, `market_payments`, `market_payment_events`, `market_commission_rules`, `market_disputes`, `market_dispute_statements` |
| An toàn | `market_message_threads`, `market_messages`, `market_reports`, `market_moderation_log`, `market_evidence_exports` |
| Phòng học | `market_session_rooms`, `market_session_participants`, `market_session_attendance`, `market_session_recordings`, `market_recording_consents`, `market_recording_views` |
| Đánh giá | `market_reviews` |
| Quản trị, nhật ký | `market_settings`, `market_admins`, `market_admin_recovery_codes`, `market_admin_sessions`, `market_audit_log` |

Cột `actor_type = 'operator'`, `operator_id` của bảng cũ nay chỉ người quản trị (`market_admins.id`).
