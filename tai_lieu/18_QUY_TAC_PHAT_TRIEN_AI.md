# 18. Quy tắc phát triển

Áp dụng quy trình Vibecoding_Flow. Quy tắc riêng của dự án:

| Mã | Quy tắc |
|---|---|
| AI-01 | Mọi chú thích, tài liệu, nội dung commit viết tiếng Việt có dấu, không viết tắt; tên biến, hàm bằng tiếng Anh đầy đủ như mã gốc |
| AI-02 | Không liên hệ với School Management: không nhập mã, không gọi API, không dùng chung cơ sở dữ liệu, phiên, tên miền |
| AI-03 | Không commit khóa, mật khẩu, tệp `.env`, dữ liệu thật; tệp tạm của AI đặt ở `tam_thoi/` |
| AI-04 | Mỗi công việc một nhánh, một PR vào `main`; gộp khi CI đạt đủ kiểm tra; không force-push, không rebase |
| AI-05 | Thu tiền thật luôn tắt; bỏ chặn phải có yêu cầu thay đổi riêng được Eric duyệt |
| AI-06 | Thêm điểm cuối thì tự kiểm phiên bằng `MarketContext.account` hoặc `MarketContext.operator` với vai theo `operatorRolesFor` |
| AI-07 | Trước khi đẩy: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, kiểm thử của gói đã sửa |
