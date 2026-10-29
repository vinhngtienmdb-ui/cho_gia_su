# 24. Yêu cầu thay đổi

### THAY_DOI_01: Khởi tạo sản phẩm bằng cách tách khỏi School Management – 2026-10-30

- Lý do: quyết định của Eric ngày 2026-10-30 (YCTD-384 của School Management).
- Nội dung thay đổi: xem tài liệu 04 mục 2 và nhật ký 02 ngày 2026-10-30.
- Thành phần bị ảnh hưởng: toàn bộ kho.
- Dữ liệu bị ảnh hưởng: không có dữ liệu chuyển sang; bảng `market_school_links` không còn; cấu hình chợ chuyển sang `market_settings`.
- API bị ảnh hưởng so với bản gốc: bỏ `POST`, `DELETE /market/children/:id/school-link`, `GET /children/:id/market-link`; `GET /market/children` bỏ trường `school_link`; `GET`, `PUT /market/admin` bỏ `enabled`, `host`, `tutor_host`; thêm `/market/admin/auth/*`, `/market/admin/accounts/*`; `/video/webhook` chỉ phục vụ phòng của chợ.
- Quyền bị ảnh hưởng: nhân viên vận hành nền tảng thay bằng tài khoản quản trị riêng, vai `quan_tri`, `ho_tro`, `ke_toan`.
- Trạng thái: Đã duyệt (Eric, 2026-10-30).
