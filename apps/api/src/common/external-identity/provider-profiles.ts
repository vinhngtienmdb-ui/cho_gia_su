// Khai báo nhà cung cấp định danh bên ngoài ở mức nền tảng (DT-25, YCTD-225, tài liệu 47 mục 17.4). Nền tảng khai nhà cung cấp nào dùng
// được (biến môi trường EXTERNAL_IDENTITY_PROVIDERS, dạng JSON, không chứa bí mật); khóa bí mật dùng chung của nền tảng đặt ở biến môi
// trường riêng EXTERNAL_IDENTITY_<MÃ>_CLIENT_SECRET (QU-05). Mỗi trường tự bật, có thể dùng mã ứng dụng và khóa riêng (lưu mã hóa theo
// khóa của trường). Nhà cung cấp không khai ở nền tảng thì không trường nào bật được.
//
// Hồ sơ `vneid`: VNeID qua Trung tâm RAR (Cục C06). Chuẩn kỹ thuật của RAR chưa công bố (khảo sát 2026-10-26), nên địa chỉ, phạm vi,
// tên claim, cách xác thực ứng dụng và giá trị mức đảm bảo đều là cấu hình, giá trị mặc định dưới đây chỉ là giả định theo OIDC và được
// đánh dấu "chờ tài liệu RAR" (PENDING_RAR_DOCUMENTATION). Khi có tài liệu thì đổi cấu hình, không sửa mã.

export type ProviderProfile = 'oidc' | 'vneid';
export type TokenAuthMethod = 'client_secret_basic' | 'client_secret_post';

export interface ExternalProviderDefinition {
  code: string;
  profile: ProviderProfile;
  displayName: string;
  issuer: string;
  // Đọc địa chỉ từ /.well-known/openid-configuration; tắt thì phải khai đủ ba địa chỉ dưới
  discovery: boolean;
  authorizationEndpoint: string | null;
  tokenEndpoint: string | null;
  jwksUri: string | null;
  // Mã ứng dụng và khóa dùng chung của nền tảng; trường có thể thay bằng mã và khóa riêng
  clientId: string | null;
  clientSecret: string | null;
  scopes: string[];
  tokenAuthMethod: TokenAuthMethod;
  subjectClaim: string;
  assuranceClaim: string | null;
  birthdateClaim: string | null;
  // Giá trị mức đảm bảo được coi là đạt xác thực hai lớp; null là mọi giá trị (khi trường bật "coi là đạt xác thực hai lớp")
  mfaAssuranceValues: string[] | null;
  // Thuật toán chữ ký nhận cho id_token; không nhận `none` và thuật toán khóa đối xứng
  algorithms: string[];
  // Tham số thêm gửi kèm yêu cầu ủy quyền (ví dụ acr_values); chờ tài liệu RAR với hồ sơ vneid
  extraAuthorizationParameters: Record<string, string>;
  // Thời gian chờ (giây) giữa hai lần tải lại bộ khóa khi gặp mã khóa lạ (quay khóa); mặc định 30
  jwksCooldownSeconds: number;
}

// Các mục của hồ sơ vneid đang dùng giá trị giả định, chờ tài liệu kỹ thuật của Trung tâm RAR
export const PENDING_RAR_DOCUMENTATION = [
  'issuer',
  'discovery',
  'scopes',
  'token_auth_method',
  'subject_claim',
  'assurance_claim',
  'birthdate_claim',
  'mfa_assurance_values',
  'extra_authorization_parameters',
] as const;

const PROFILE_DEFAULTS: Record<
  ProviderProfile,
  Pick<
    ExternalProviderDefinition,
    | 'displayName'
    | 'scopes'
    | 'tokenAuthMethod'
    | 'subjectClaim'
    | 'assuranceClaim'
    | 'birthdateClaim'
    | 'mfaAssuranceValues'
    | 'algorithms'
  >
> = {
  oidc: {
    displayName: 'Nhà cung cấp định danh',
    scopes: ['openid'],
    tokenAuthMethod: 'client_secret_basic',
    subjectClaim: 'sub',
    assuranceClaim: 'acr',
    birthdateClaim: null,
    mfaAssuranceValues: null,
    algorithms: ['RS256', 'PS256', 'ES256'],
  },
  // Chờ tài liệu RAR: mọi giá trị dưới đây là giả định theo chuẩn OIDC
  vneid: {
    displayName: 'VNeID',
    scopes: ['openid'],
    tokenAuthMethod: 'client_secret_basic',
    subjectClaim: 'sub',
    assuranceClaim: 'acr',
    birthdateClaim: 'birthdate',
    mfaAssuranceValues: null,
    algorithms: ['RS256', 'PS256', 'ES256'],
  },
};

const ALLOWED_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];
const CODE_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;
const CLAIM_PATTERN = /^[A-Za-z0-9_:.\-/]{1,100}$/;

export class ProviderConfigurationError extends Error {}

// Địa chỉ của nhà cung cấp phải là https; http chỉ nhận cho máy cục bộ (bộ giả lập khi phát triển và kiểm thử)
export function assertProviderUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderConfigurationError(`${field} không phải địa chỉ hợp lệ`);
  }
  if (url.protocol === 'https:') {
    return value;
  }
  if (url.protocol === 'http:' && isLocalHostname(url.hostname)) {
    return value;
  }
  throw new ProviderConfigurationError(`${field} phải dùng https`);
}

export function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost')
  );
}

function readString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new ProviderConfigurationError(`${key} phải là chuỗi`);
  }
  return value.trim();
}

function readStringList(raw: Record<string, unknown>, key: string): string[] | null {
  const value = raw[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new ProviderConfigurationError(`${key} phải là danh sách chuỗi`);
  }
  return value.map((item: string) => item.trim());
}

function readClaim(raw: Record<string, unknown>, key: string, fallback: string | null): string | null {
  if (!(key in raw)) {
    return fallback;
  }
  const value = readString(raw, key);
  if (value !== null && !CLAIM_PATTERN.test(value)) {
    throw new ProviderConfigurationError(`${key} không hợp lệ`);
  }
  return value;
}

// Đọc một khai báo nhà cung cấp (khóa dạng snake_case như trong JSON); khóa bí mật lấy từ `secrets` theo mã
export function parseProviderDefinition(
  raw: unknown,
  secrets: Record<string, string | undefined> = {},
): ExternalProviderDefinition {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProviderConfigurationError('Mỗi nhà cung cấp phải là một đối tượng');
  }
  const item = raw as Record<string, unknown>;
  const code = readString(item, 'code') ?? '';
  if (!CODE_PATTERN.test(code)) {
    throw new ProviderConfigurationError('code chỉ gồm chữ thường, số, dấu gạch ngang, 2 đến 31 ký tự');
  }
  const profile = (readString(item, 'profile') ?? 'oidc') as ProviderProfile;
  if (!(profile in PROFILE_DEFAULTS)) {
    throw new ProviderConfigurationError(`${code}: profile phải là oidc hoặc vneid`);
  }
  const defaults = PROFILE_DEFAULTS[profile];
  const issuer = readString(item, 'issuer');
  if (!issuer) {
    throw new ProviderConfigurationError(`${code}: thiếu issuer`);
  }
  assertProviderUrl(issuer, `${code}: issuer`);
  const discovery = item.discovery === undefined ? true : item.discovery === true;
  const endpoints = {
    authorizationEndpoint: readString(item, 'authorization_endpoint'),
    tokenEndpoint: readString(item, 'token_endpoint'),
    jwksUri: readString(item, 'jwks_uri'),
  };
  for (const [field, value] of Object.entries(endpoints)) {
    if (value) {
      assertProviderUrl(value, `${code}: ${field}`);
    }
  }
  if (!discovery && (!endpoints.authorizationEndpoint || !endpoints.tokenEndpoint || !endpoints.jwksUri)) {
    throw new ProviderConfigurationError(
      `${code}: tắt discovery thì phải khai authorization_endpoint, token_endpoint, jwks_uri`,
    );
  }
  const tokenAuthMethod = (readString(item, 'token_auth_method') ?? defaults.tokenAuthMethod) as TokenAuthMethod;
  if (tokenAuthMethod !== 'client_secret_basic' && tokenAuthMethod !== 'client_secret_post') {
    throw new ProviderConfigurationError(
      `${code}: token_auth_method phải là client_secret_basic hoặc client_secret_post`,
    );
  }
  const algorithms = readStringList(item, 'algorithms') ?? defaults.algorithms;
  if (algorithms.length === 0 || algorithms.some((algorithm) => !ALLOWED_ALGORITHMS.includes(algorithm))) {
    throw new ProviderConfigurationError(`${code}: algorithms chỉ nhận chữ ký khóa bất đối xứng`);
  }
  const scopes = readStringList(item, 'scopes') ?? defaults.scopes;
  if (!scopes.includes('openid')) {
    throw new ProviderConfigurationError(`${code}: scopes phải có openid`);
  }
  const extra = item.extra_authorization_parameters ?? {};
  if (typeof extra !== 'object' || extra === null || Object.values(extra).some((value) => typeof value !== 'string')) {
    throw new ProviderConfigurationError(`${code}: extra_authorization_parameters phải là đối tượng chuỗi`);
  }
  const cooldown = item.jwks_cooldown_seconds === undefined ? 30 : Number(item.jwks_cooldown_seconds);
  if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 3600) {
    throw new ProviderConfigurationError(`${code}: jwks_cooldown_seconds từ 0 đến 3600`);
  }
  return {
    code,
    profile,
    displayName: readString(item, 'display_name') ?? defaults.displayName,
    issuer,
    discovery,
    ...endpoints,
    clientId: readString(item, 'client_id'),
    clientSecret: secrets[code]?.trim() || null,
    scopes,
    tokenAuthMethod,
    subjectClaim: readClaim(item, 'subject_claim', defaults.subjectClaim) ?? 'sub',
    assuranceClaim: readClaim(item, 'assurance_claim', defaults.assuranceClaim),
    birthdateClaim: readClaim(item, 'birthdate_claim', defaults.birthdateClaim),
    mfaAssuranceValues: readStringList(item, 'mfa_assurance_values') ?? defaults.mfaAssuranceValues,
    algorithms,
    extraAuthorizationParameters: extra as Record<string, string>,
    jwksCooldownSeconds: cooldown,
  };
}

export function secretVariableName(code: string, prefix = 'EXTERNAL_IDENTITY'): string {
  return `${prefix}_${code.toUpperCase().replaceAll('-', '_')}_CLIENT_SECRET`;
}

// Đọc khai báo của nền tảng từ biến môi trường; trống là không có nhà cung cấp nào (mặc định, hành vi như trước DT-25). Chợ gia sư
// (DT-27 phần 27g) dùng tiền tố riêng MARKET_IDENTITY: ứng dụng đăng ký ở nhà cung cấp là của chợ, địa chỉ quay về là của chợ
export function readProviderDefinitions(
  environment: NodeJS.ProcessEnv,
  prefix = 'EXTERNAL_IDENTITY',
): ExternalProviderDefinition[] {
  const variable = `${prefix}_PROVIDERS`;
  const text = environment[variable]?.trim();
  if (!text) {
    return [];
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProviderConfigurationError(`${variable} phải là JSON`);
  }
  if (!Array.isArray(raw)) {
    throw new ProviderConfigurationError(`${variable} phải là danh sách`);
  }
  const definitions = raw.map((item: unknown) => {
    const code = typeof item === 'object' && item !== null ? (item as { code?: unknown }).code : undefined;
    const secrets = typeof code === 'string' ? { [code]: environment[secretVariableName(code, prefix)] } : {};
    return parseProviderDefinition(item, secrets);
  });
  const codes = new Set<string>();
  for (const definition of definitions) {
    if (codes.has(definition.code)) {
      throw new ProviderConfigurationError(`Trùng mã nhà cung cấp ${definition.code}`);
    }
    codes.add(definition.code);
  }
  return definitions;
}
