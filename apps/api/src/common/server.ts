import { unauthenticatedError } from './application-error.js';

// Các hàm dùng chung của máy chủ (lấy từ gói server của School Management khi tách chợ, YCTD-384)
export * from './application-error.js';
export * from './clock.js';
export * from './secret-encryption.js';
export * from './totp.js';

export function readBearerToken(authorizationHeader: string | undefined): string {
  const [scheme, token] = (authorizationHeader ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw unauthenticatedError();
  }
  return token;
}
