# 04. Tổng quan dự án

## 1. Sản phẩm

Chợ gia sư là nền tảng kết nối phụ huynh với gia sư dạy kèm trực tuyến cho học sinh phổ thông. Một ứng dụng web chung cho phụ huynh và gia sư (giao diện theo loại tài khoản) và một ứng dụng quản trị riêng.

- Phụ huynh: đăng ký, tạo hồ sơ con (tên hiển thị, năm sinh, cấp, lớp) với đồng ý của cha mẹ theo phiên bản văn bản, tìm gia sư, đặt buổi, mua gói buổi, nhắn tin với gia sư, vào xem buổi học, đánh giá, khiếu nại, báo cáo vi phạm.
- Gia sư: hồ sơ, môn và giá, giờ trống, xác minh danh tính (nhà cung cấp định danh OIDC), bằng cấp, lý lịch tư pháp, đăng ký kinh doanh, khai là giáo viên đang dạy ở trường (Mẫu 03), dạy buổi trong phòng video, thu nhập, trả lời đánh giá.
- Quản trị: cấu hình chợ, văn bản pháp lý, duyệt hồ sơ và giấy tờ gia sư, duyệt đánh giá, thanh toán giả lập, giải ngân, tranh chấp, hoa hồng, kiểm duyệt và an toàn trẻ em, bản ghi buổi học, tài khoản quản trị.
- Thanh toán: chỉ giả lập. Thu tiền thật bị chặn trong mã cho đến khi xong các việc pháp lý E-01 đến E-07 (hoa hồng, tổ chức thanh toán có giấy phép, luật sư, pháp nhân).

## 2. Nguồn gốc

- Mã lấy từ kho School Management (`luckyshopvn/school_management`) ngày 2026-10-30, nhánh `main` commit `133b2d11`: `apps/market`, `packages/market-client`, `apps/api/src/market`, `database/marketplace`, `database/src/marketplace`, năm trang chợ của cổng vận hành `apps/platform`, kiểm thử máy chủ và kiểm thử đầu cuối 195 đến 199; phần dùng chung (`packages/ui`, `packages/pwa`, `packages/config`, các hàm của `packages/server`) chép phần cần dùng.
- Quyết định của Eric ngày 2026-10-30 (YCTD-393 của School Management): sản phẩm riêng, kho riêng tư `luckyshopvn/cho-gia-su`, máy chủ, cơ sở dữ liệu, đăng nhập riêng; hai hệ thống không liên hệ gì (không đăng nhập chung, không chia sẻ dữ liệu, không đường dẫn qua lại); dữ liệu chợ cũ không chuyển, sản phẩm bắt đầu trống; quản trị bằng tài khoản quản trị riêng có TOTP; giữ Mẫu 03 và khai báo giáo viên đang dạy ở trường (tự khai).
- Bỏ khi tách: liên kết hồ sơ con với trường (`market_school_links`, mã liên kết từ ứng dụng phụ huynh của trường), công tắc bật chợ và tên miền chợ trong cấu hình, kiểm tên miền của nền tảng nhiều trường, đăng nhập nhân viên vận hành của nền tảng.
- Mã định danh nghiệp vụ cũ (DT-27, GD-xxx, CT-xxx, YCTD-xxx) trong chú thích và tên kiểm thử giữ nguyên để truy được về hồ sơ gốc.

## 3. Người dùng

| Vai | Cách đăng nhập |
|---|---|
| Phụ huynh | Thư điện tử hoặc số điện thoại, mật khẩu, mã xác nhận 6 số; hoặc nhà cung cấp định danh |
| Gia sư | Như phụ huynh; xác minh danh tính bằng nhà cung cấp định danh, đủ 18 tuổi |
| Quản trị (quan_tri, ho_tro, ke_toan) | Tên đăng nhập, mật khẩu, mã TOTP hoặc mã khôi phục |
