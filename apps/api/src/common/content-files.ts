import type { Response } from 'express';

// Tệp tải lên và trả tệp đã lưu (lấy hai hàm cần dùng từ activities/content-files.ts của School Management khi tách chợ, YCTD-384)
export interface UploadedPart {
  originalname: string;
  size: number;
  buffer: Buffer;
}

export function decodeFileName(part: UploadedPart): string {
  return Buffer.from(part.originalname, 'latin1').toString('utf8');
}

export function sendStoredFile(response: Response, file: { content_type: string; file_name: string }, body: Buffer) {
  response.setHeader('content-type', file.content_type);
  response.setHeader('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
  response.setHeader('cache-control', 'no-store');
  response.send(body);
}
