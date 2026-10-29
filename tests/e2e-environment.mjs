// Môi trường kiểm thử giao diện của Chợ gia sư: cổng riêng, khác cổng chạy trên máy (3300, 5300, 5301) để chạy song song không đụng
// nhau; cơ sở dữ liệu và vai trò riêng, dựng lại mỗi lần chạy (e2e/global-setup.ts)
export const E2E_API_PORT = 3390;
export const E2E_WEB_PORT = 5390;
export const E2E_ADMIN_PORT = 5391;
// Ứng dụng chợ mở ở localhost: máy chủ API so tên máy của địa chỉ quay về sau xác minh danh tính với MARKET_HOST
export const E2E_MARKET_HOST = 'localhost';
export const E2E_DATABASE_NAME = 'cho_gia_su_e2e';
export const E2E_DATABASE_ROLE = 'cho_gia_su_e2e';
// Kho tệp riêng của kiểm thử trong kho tệp tương thích S3 trên máy (docker-compose.yml)
export const E2E_S3_BUCKET = 'cho-gia-su-e2e';
// Xác minh danh tính gia sư (spec 196): nhà cung cấp OIDC giả lập do spec chạy ở cổng này
export const E2E_MARKET_OIDC_PORT = 3398;
export const E2E_MARKET_OIDC_CODE = 'gia-lap-cho';
export const E2E_MARKET_OIDC_CLIENT_ID = 'cho-gia-su-e2e';
export const E2E_STATE_FILE = new URL('./.e2e-state.json', import.meta.url);
