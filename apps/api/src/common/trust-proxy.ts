import type { INestApplication } from '@nestjs/common';

// Khi chạy sau máy chủ chuyển tiếp (Caddy, YCTD-92), địa chỉ người dùng lấy từ tiêu đề X-Forwarded-For để giới hạn số lần
// đăng nhập và ghi nhật ký đúng địa chỉ. Biến TRUST_PROXY nhận giá trị như thiết lập `trust proxy` của Express: số chặng tin
// cậy, `true`, hoặc danh sách địa chỉ/dải mạng cách nhau bằng dấu phẩy (ví dụ `uniquelocal`). Để trống là không tin cậy
export function parseTrustProxy(value: string | undefined): boolean | number | string | undefined {
  const text = value?.trim();
  if (!text || text === 'false') {
    return undefined;
  }
  if (text === 'true') {
    return true;
  }
  if (/^\d+$/.test(text)) {
    return Number(text);
  }
  return text;
}

export function applyTrustProxy(application: INestApplication, value: string | undefined): void {
  const setting = parseTrustProxy(value);
  if (setting === undefined) {
    return;
  }
  const instance = application.getHttpAdapter().getInstance() as { set(name: string, value: unknown): void };
  instance.set('trust proxy', setting);
}
