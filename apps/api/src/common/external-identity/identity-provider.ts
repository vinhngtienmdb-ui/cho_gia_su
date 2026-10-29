import { createHash, randomBytes } from 'node:crypto';

// Lớp trừu tượng nhà cung cấp định danh bên ngoài (DT-25, YCTD-225, tài liệu 47 mục 17). Mã nghiệp vụ (liên kết tài khoản, đăng nhập,
// kiểm vai trò, nhật ký) chỉ làm việc với lớp này; mỗi giao thức là một bộ nối riêng. Hiện có bộ nối OIDC chung (`OidcIdentityProvider`);
// VNeID qua Trung tâm RAR (Cục C06) là một hồ sơ cấu hình của bộ nối OIDC. Nếu RAR dùng giao thức khác thì viết bộ nối mới theo lớp này,
// không sửa mã nghiệp vụ

// Tham số một lượt chuyển hướng sang nhà cung cấp: giữ ở máy chủ (Redis), không gửi xuống trình duyệt ngoài `state`
export interface AuthorizationParameters {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
}

// Kết quả đã kiểm chữ ký và các điều kiện của nhà cung cấp. Chỉ `subject` được lưu (mã hóa); mức đảm bảo và tuổi chỉ dùng để quyết
// định ngay trong yêu cầu, không lưu
export interface ExternalIdentityResult {
  subject: string;
  // Mức đảm bảo xác thực (claim `acr` hoặc tên claim cấu hình); null là nhà cung cấp không trả
  assurance: string | null;
  // Tuổi tính từ ngày sinh nhà cung cấp trả (nếu có cấu hình claim ngày sinh); null là không biết
  ageYears: number | null;
}

export class IdentityProviderError extends Error {
  constructor(
    readonly reason:
      | 'not_configured'
      | 'discovery_failed'
      | 'token_exchange_failed'
      | 'invalid_id_token'
      | 'nonce_mismatch'
      | 'missing_subject',
    message: string,
  ) {
    super(message);
  }
}

export abstract class IdentityProvider {
  abstract readonly code: string;

  // Địa chỉ chuyển hướng người dùng sang trang đăng nhập của nhà cung cấp
  abstract authorizationUrl(parameters: AuthorizationParameters): Promise<string>;

  // Đổi mã nhận được ở địa chỉ quay về lấy định danh đã kiểm (chữ ký, bên phát hành, đối tượng, hạn, nonce)
  abstract exchange(code: string, parameters: AuthorizationParameters, now: Date): Promise<ExternalIdentityResult>;
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// Tham số mới cho mỗi lượt: state chống giả yêu cầu, nonce gắn mã định danh với lượt, PKCE (S256) chống lộ mã ủy quyền
export function newAuthorizationParameters(redirectUri: string): AuthorizationParameters {
  return { state: randomToken(), nonce: randomToken(), codeVerifier: randomToken(48), redirectUri };
}

export function pkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

// Tuổi tròn năm theo ngày sinh dạng yyyy-mm-dd (claim `birthdate` của OIDC); dạng khác coi là không biết
export function ageFromBirthdate(value: unknown, now: Date): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now).split('-').map(Number);
  const [currentYear, currentMonth, currentDay] = today as [number, number, number];
  let age = currentYear - year;
  if (currentMonth < month || (currentMonth === month && currentDay < day)) {
    age -= 1;
  }
  return age >= 0 && age < 150 ? age : null;
}
