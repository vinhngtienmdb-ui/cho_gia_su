import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// Chuỗi bí mật của chợ gia sư (DT-27 phần 27f, YCTD-256): phiên là chuỗi ngẫu nhiên 32 byte, cơ sở dữ liệu chỉ giữ băm SHA-256 nên lộ
// bảng phiên không dùng lại được phiên; mã xác nhận 6 số băm kèm mã tài khoản (cùng mã ở hai tài khoản cho băm khác nhau)
export const MARKET_SESSION_LIFETIME_MS = 7 * 24 * 3600 * 1000;
export const MARKET_CODE_LIFETIME_MS = 10 * 60 * 1000;
export const MARKET_CODE_MAX_ATTEMPTS = 5;

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(`market-session:${token}`).digest('hex');
}

export function newVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashVerificationCode(accountId: string, code: string): string {
  return createHash('sha256').update(`market-code:${accountId}:${code}`).digest('hex');
}

export function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
