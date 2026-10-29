import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Mật khẩu một lần theo thời gian (TOTP, RFC 6238, HMAC-SHA1, 30 giây, 6 chữ số) cho xác thực hai lớp (DT-SaaS phần S8b, YCTD-201, tài
// liệu 47 mục 14.5): tương thích Google Authenticator, Microsoft Authenticator, Authy. Mã hóa khóa bí mật khi lưu do nơi dùng đảm nhiệm
// (`secret-encryption`); ở đây chỉ sinh khóa, tính mã, kiểm tra mã (có cửa sổ lệch giờ) và dựng địa chỉ cấu hình cho ứng dụng xác thực
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
// Cho phép lệch một bước (30 giây) về hai phía vì đồng hồ điện thoại lệch nhẹ
const DEFAULT_WINDOW = 1;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) {
      throw new Error('Khóa không đúng dạng base32');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// Khóa bí mật 160 bit, mã hóa base32 để nhập vào ứng dụng xác thực
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCodeAt(secret: string, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] as number) & 15;
  const binary =
    (((hmac[offset] as number) & 127) << 24) |
    (((hmac[offset + 1] as number) & 255) << 16) |
    (((hmac[offset + 2] as number) & 255) << 8) |
    ((hmac[offset + 3] as number) & 255);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpStepOf(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
}

export function totpCode(secret: string, at: Date): string {
  return totpCodeAt(secret, totpStepOf(at));
}

// Kiểm tra mã; trả bước thời gian khớp (để nơi dùng chặn dùng lại một mã) hoặc null. `lastUsedStep` là bước đã dùng gần nhất: mã của
// bước đó trở về trước bị từ chối (mỗi mã dùng một lần)
export function verifyTotp(
  secret: string,
  code: string,
  at: Date,
  options: { window?: number; lastUsedStep?: number | null } = {},
): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) {
    return null;
  }
  const window = options.window ?? DEFAULT_WINDOW;
  const current = totpStepOf(at);
  const given = Buffer.from(clean);
  for (let step = current - window; step <= current + window; step += 1) {
    if (options.lastUsedStep !== undefined && options.lastUsedStep !== null && step <= options.lastUsedStep) {
      continue;
    }
    const expected = Buffer.from(totpCodeAt(secret, step));
    if (timingSafeEqual(given, expected)) {
      return step;
    }
  }
  return null;
}

// Địa chỉ cấu hình cho ứng dụng xác thực (mã QR dựng từ địa chỉ này ở giao diện)
export function totpUri(secret: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// Mã khôi phục dùng một lần khi mất điện thoại: 10 ký tự chữ và số dễ đọc, nhóm 5-5
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RECOVERY_CODE_COUNT = 8;

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const text = Array.from(bytes, (byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]).join('');
    return `${text.slice(0, 5)}-${text.slice(5)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

// Băm có khóa cố định (mã khôi phục đã đủ ngẫu nhiên 50 bit, chỉ cần không lưu bản rõ và so khớp được)
export function hashRecoveryCode(code: string): string {
  return createHmac('sha256', 'recovery-code-v1').update(normalizeRecoveryCode(code)).digest('hex');
}
