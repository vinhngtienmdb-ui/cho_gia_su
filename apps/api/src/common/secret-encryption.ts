import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Mã hóa AES-256-GCM dùng chung cho dữ liệu bí mật lưu trong cơ sở dữ liệu: số định danh của trẻ (BM-64) và khóa truy cập
// kết nối ngoài (YCTD-92). Kết quả gồm số dùng một lần, thẻ xác thực và bản mã, mã hóa base64
const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function encryptSecret(key: Buffer, plainText: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function decryptSecret(key: Buffer, encoded: string): string {
  const raw = Buffer.from(encoded, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, raw.subarray(0, NONCE_BYTES));
  decipher.setAuthTag(raw.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(NONCE_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
}
