import { readProviderDefinitions, type ExternalProviderDefinition } from './external-identity/index.js';

// Cấu hình máy chủ API của Chợ gia sư, đọc từ biến môi trường. Lấy các mục của chợ trong cấu hình máy chủ API School Management khi tách
// (YCTD-384); bỏ mọi mục của trường, nền tảng nhiều trường, liên kết với trường
export const API_CONFIGURATION = Symbol('API_CONFIGURATION');

export type VideoProviderCode = 'livekit' | 'livekit-cloud' | 'mock';

export interface VideoSettings {
  provider: VideoProviderCode;
  // Địa chỉ API của máy chủ phòng (http/https) và địa chỉ trình duyệt kết nối (ws/wss); mock thì để trống
  apiUrl: string;
  clientUrl: string;
  apiKey: string;
  apiSecret: string;
}

export interface ObjectStorageSettings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ApiConfiguration {
  port: number;
  // Kết nối cơ sở dữ liệu của chợ bằng vai trò riêng của chợ
  databaseUrl: string;
  // Tên miền (kèm cổng nếu có) của ứng dụng chợ (MARKET_HOST), ví dụ cho-gia-su.vn hoặc localhost:5300
  marketHost: string | null;
  // Kho tệp tương thích S3; trống thì không nhận tệp giấy tờ, không lưu bản ghi buổi học
  objectStorage: ObjectStorageSettings | null;
  // Phòng video: `livekit` tự host, `livekit-cloud` dự phòng, `mock` kiểm thử; trống là tắt video
  video: VideoSettings | null;
  // Xác minh danh tính gia sư, đăng nhập bằng OIDC (DT-27 phần 27g): nhà cung cấp khai ở MARKET_IDENTITY_PROVIDERS. Khóa 32 byte mã hóa
  // tệp giấy tờ của gia sư và bản ghi buổi học (MARKET_FILES_KEY, base64); trống thì chưa nhận tệp
  marketIdentityProviders: ExternalProviderDefinition[];
  marketFilesKey: Buffer | null;
  // Khóa 32 byte mã hóa khóa TOTP của tài khoản quản trị (MARKET_SECRETS_KEY, base64); bắt buộc
  marketSecretsKey: Buffer;
  // Việc định kỳ (DT-27 phần 27h): nhả chỗ giữ quá hạn, giải ngân buổi hết hạn khiếu nại, chốt quyết định tranh chấp (giây, mặc định
  // 300; 0 là tắt, kiểm thử tự gọi)
  marketJobIntervalSeconds: number;
  // Số lớp proxy đứng trước máy chủ (TRUST_PROXY) để lấy đúng địa chỉ mạng của người gọi khi giới hạn tần suất
  trustProxy: string | undefined;
}

// Khóa 32 byte mã hóa base64; trống trả null
export function readKey32(name: string, text: string | undefined): Buffer | null {
  const value = text?.trim();
  if (!value) {
    return null;
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error(`${name} phải là 32 byte mã hóa base64`);
  }
  return key;
}

// VIDEO_PROVIDER: trống là tắt; `livekit`, `livekit-cloud` cần LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET (LIVEKIT_PUBLIC_URL
// là địa chỉ trình duyệt nối tới, mặc định theo LIVEKIT_URL); `mock` chỉ dùng cho kiểm thử và chạy trên máy
export function readVideoConfiguration(environment: NodeJS.ProcessEnv): VideoSettings | null {
  const provider = environment.VIDEO_PROVIDER?.trim() ?? '';
  if (provider === '') {
    return null;
  }
  if (provider === 'mock') {
    if (environment.NODE_ENV === 'production') {
      throw new Error('VIDEO_PROVIDER=mock chỉ dùng cho kiểm thử, không bật ở môi trường chạy thật');
    }
    return { provider, apiUrl: '', clientUrl: 'mock://video', apiKey: 'mock', apiSecret: 'mock-video-secret' };
  }
  if (provider !== 'livekit' && provider !== 'livekit-cloud') {
    throw new Error(`VIDEO_PROVIDER không hỗ trợ: ${provider}`);
  }
  const missing = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'].filter((name) => !environment[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Thiếu biến môi trường ${missing.join(', ')} khi VIDEO_PROVIDER=${provider}`);
  }
  const apiUrl = (environment.LIVEKIT_URL as string).trim();
  return {
    provider,
    apiUrl,
    clientUrl: environment.LIVEKIT_PUBLIC_URL?.trim() || apiUrl.replace(/^http/, 'ws'),
    apiKey: (environment.LIVEKIT_API_KEY as string).trim(),
    apiSecret: (environment.LIVEKIT_API_SECRET as string).trim(),
  };
}

function readRequired(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Thiếu biến môi trường ${name}`);
  }
  return value;
}

export function readApiConfiguration(environment: NodeJS.ProcessEnv = process.env): ApiConfiguration {
  const secretsKey = readKey32('MARKET_SECRETS_KEY', environment.MARKET_SECRETS_KEY);
  if (!secretsKey) {
    throw new Error('Thiếu biến môi trường MARKET_SECRETS_KEY');
  }
  return {
    port: Number(environment.PORT ?? 3300),
    databaseUrl: readRequired(environment, 'DATABASE_URL'),
    marketHost: environment.MARKET_HOST?.trim().toLowerCase() || null,
    objectStorage: environment.S3_ENDPOINT?.trim()
      ? {
          endpoint: readRequired(environment, 'S3_ENDPOINT'),
          region: environment.S3_REGION ?? 'us-east-1',
          bucket: readRequired(environment, 'S3_BUCKET'),
          accessKeyId: readRequired(environment, 'S3_ACCESS_KEY_ID'),
          secretAccessKey: readRequired(environment, 'S3_SECRET_ACCESS_KEY'),
        }
      : null,
    video: readVideoConfiguration(environment),
    marketIdentityProviders: readProviderDefinitions(environment, 'MARKET_IDENTITY'),
    marketFilesKey: readKey32('MARKET_FILES_KEY', environment.MARKET_FILES_KEY),
    marketSecretsKey: secretsKey,
    marketJobIntervalSeconds: environment.MARKET_JOB_INTERVAL_SECONDS?.trim()
      ? Number(environment.MARKET_JOB_INTERVAL_SECONDS)
      : 300,
    trustProxy: environment.TRUST_PROXY,
  };
}
