import { ApplicationError, type FieldError } from './server.js';

// Đọc và kiểm tra từng trường của thân yêu cầu; lỗi gom vào danh sách để trả một lần ERR_VALIDATION
export type RequestBody = Record<string, unknown> | undefined;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function readOptionalText(body: RequestBody, field: string, errors: FieldError[]): string | null | undefined {
  const value = body?.[field];
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    errors.push({ field, message: 'Phải là chữ' });
    return undefined;
  }
  return value.trim() === '' ? null : value.trim();
}

export function readRequiredText(body: RequestBody, field: string, errors: FieldError[]): string {
  const value = readOptionalText(body, field, errors);
  if (!value) {
    errors.push({ field, message: 'Bắt buộc nhập' });
    return '';
  }
  return value;
}

export function readOptionalUuid(body: RequestBody, field: string, errors: FieldError[]): string | null | undefined {
  const value = body?.[field];
  if (value === undefined || value === null || value === '') {
    return value === undefined ? undefined : null;
  }
  if (!isUuid(value)) {
    errors.push({ field, message: 'Mã không hợp lệ' });
    return undefined;
  }
  return value;
}

export function readRequiredUuid(body: RequestBody, field: string, errors: FieldError[], message: string): string {
  const value = readOptionalUuid(body, field, errors);
  if (!value) {
    errors.push({ field, message });
    return '';
  }
  return value;
}

export function readInteger(
  body: RequestBody,
  field: string,
  errors: FieldError[],
  range: { min: number; max: number },
): number | undefined {
  const value = body?.[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < range.min || value > range.max) {
    errors.push({ field, message: `Phải là số nguyên từ ${range.min} đến ${range.max}` });
    return undefined;
  }
  return value;
}

export function readRequiredInteger(
  body: RequestBody,
  field: string,
  errors: FieldError[],
  range: { min: number; max: number },
): number {
  if (body?.[field] === undefined) {
    errors.push({ field, message: 'Bắt buộc nhập' });
    return range.min;
  }
  return readInteger(body, field, errors, range) ?? range.min;
}

export type RecordStatus = 'active' | 'inactive';

export function readStatus(body: RequestBody, errors: FieldError[]): RecordStatus | undefined {
  const value = body?.status;
  if (value === undefined) {
    return undefined;
  }
  if (value !== 'active' && value !== 'inactive') {
    errors.push({ field: 'status', message: 'Trạng thái phải là active hoặc inactive' });
    return undefined;
  }
  return value;
}

// Vi phạm ràng buộc duy nhất của PostgreSQL đổi thành ERR_CONFLICT để hai yêu cầu đồng thời vẫn trả lỗi đúng
export async function conflictOnDuplicate<Result>(
  operation: Promise<Result>,
  message: string,
  field: string,
): Promise<Result> {
  try {
    return await operation;
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ApplicationError('ERR_CONFLICT', message, [{ field, message }]);
    }
    throw error;
  }
}

export function notFoundError(message: string, entity: string): ApplicationError {
  return new ApplicationError('ERR_NOT_FOUND', message, [{ field: 'entity', message: entity }]);
}
