// Mô hình lỗi theo 17_DAC_TA_API.md mục 2
export type ErrorCode =
  | 'ERR_VALIDATION'
  | 'ERR_UNAUTHENTICATED'
  | 'ERR_FORBIDDEN'
  | 'ERR_NOT_FOUND'
  | 'ERR_CONFLICT'
  | 'ERR_RULE_VIOLATION'
  | 'ERR_RATE_LIMIT'
  | 'ERR_INTERNAL'
  // Gói dịch vụ của trường (DT-SaaS phần S5a, YCTD-194): phân hệ ngoài gói, trường chỉ đọc, vượt giới hạn của gói
  | 'MODULE_NOT_IN_PLAN'
  | 'SCHOOL_READ_ONLY'
  | 'PLAN_LIMIT_EXCEEDED';

export const STATUS_BY_ERROR_CODE: Record<ErrorCode, number> = {
  ERR_VALIDATION: 400,
  ERR_UNAUTHENTICATED: 401,
  ERR_FORBIDDEN: 403,
  ERR_NOT_FOUND: 404,
  ERR_CONFLICT: 409,
  ERR_RULE_VIOLATION: 422,
  ERR_RATE_LIMIT: 429,
  ERR_INTERNAL: 500,
  MODULE_NOT_IN_PLAN: 403,
  SCHOOL_READ_ONLY: 403,
  PLAN_LIMIT_EXCEEDED: 422,
};

export interface FieldError {
  field: string;
  message: string;
}

export class ApplicationError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: FieldError[] = [],
    readonly retryAfterSeconds?: number,
    readonly ruleCode?: string,
  ) {
    super(message);
  }
}

// Vi phạm quy tắc nghiệp vụ trả kèm mã quy tắc (17_DAC_TA_API.md mục 2)
export function ruleViolationError(ruleCode: string, message: string, details: FieldError[] = []): ApplicationError {
  return new ApplicationError('ERR_RULE_VIOLATION', message, details, undefined, ruleCode);
}

export function validationError(details: FieldError[]): ApplicationError {
  return new ApplicationError('ERR_VALIDATION', 'Dữ liệu không hợp lệ', details);
}

export function unauthenticatedError(message = 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn'): ApplicationError {
  return new ApplicationError('ERR_UNAUTHENTICATED', message);
}
