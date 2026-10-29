import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { FileStorage } from '../common/file-storage.js';

// Mã hóa tệp giấy tờ của gia sư (DT-27 phần 27g, YCTD-257): AES-256-GCM bằng khóa của chợ (MARKET_FILES_KEY) trước khi vào kho tệp, nên
// người đọc được kho tệp không đọc được bằng cấp, lý lịch tư pháp. Dạng lưu: 12 byte IV, 16 byte thẻ xác thực, rồi dữ liệu mã hóa
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encryptFile(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptFile(key: Buffer, stored: Buffer): Buffer {
  const iv = stored.subarray(0, IV_BYTES);
  const tag = stored.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(stored.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

// Khóa trong kho tệp của chợ: thư mục `marketplace/` giữ như bản gốc
export function marketFileKey(accountId: string, documentId: string): string {
  return `marketplace/tutor-documents/${accountId}/${documentId}`;
}

// Có kho tệp để nhận tệp của chợ không: máy chủ không đặt S3_* thì dùng NoFileStorage
export function hasMarketStorage(files: FileStorage): boolean {
  return files.available;
}

export function marketStorage(files: FileStorage): FileStorage {
  return files;
}
