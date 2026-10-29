// Gọi máy chủ API của chợ gia sư (DT-27 phần 27f, YCTD-256): cùng tên miền của chợ nên không cần CORS; phiên là chuỗi ngẫu nhiên do máy
// chủ cấp, giữ ở sessionStorage của thẻ (đóng thẻ là đăng xuất trên máy đó)
const SESSION_KEY = 'cho-gia-su-phien';

export class MarketApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function readSession(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function writeSession(token: string | null): void {
  try {
    if (token) window.sessionStorage.setItem(SESSION_KEY, token);
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Trình duyệt chặn bộ nhớ của trang: phiên chỉ còn trong bộ nhớ
  }
}

export async function marketRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = readSession();
  const response = await fetch(`/api/v1/market${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let message = response.status === 404 ? 'Chợ gia sư chưa mở' : 'Không thực hiện được, vui lòng thử lại';
    try {
      const payload = (await response.json()) as { error?: { message?: string; details?: Array<{ message: string }> } };
      if (response.status !== 404) {
        message = [payload.error?.message, ...(payload.error?.details ?? []).map((detail) => detail.message)]
          .filter(Boolean)
          .join('. ');
      }
    } catch {
      // Phản hồi không phải JSON: giữ thông điệp mặc định
    }
    throw new MarketApiError(response.status, message);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

// Tải nội dung nhị phân có phiên (bản ghi buổi học, 27i): thẻ <video> không gửi được tiêu đề xác thực nên tải về bộ nhớ rồi phát
export async function marketBlob(path: string): Promise<Blob> {
  const token = readSession();
  const response = await fetch(`/api/v1/market${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (!response.ok) throw new MarketApiError(response.status, 'Không xem được bản ghi');
  return response.blob();
}

export function errorText(error: unknown): string {
  return error instanceof MarketApiError ? error.message : 'Không kết nối được tới máy chủ';
}

export interface LegalDocument {
  id: string;
  kind: 'terms' | 'privacy' | 'parent_consent' | 'tutor_terms';
  version: number;
  title: string;
}

export interface Site {
  name: string;
  real_payments: boolean;
  // Địa chỉ của ứng dụng chung cho phụ huynh và gia sư (YCTD-368); null khi nền tảng chưa đặt tên miền
  market_url: string | null;
  documents: LegalDocument[];
}

export interface Me {
  id: string;
  kind: 'parent' | 'tutor';
  display_name: string;
  status: 'pending' | 'active' | 'locked' | 'closed';
  email: string | null;
  phone: string | null;
  consents_needed: LegalDocument[];
}

export interface Child {
  id: string;
  display_name: string;
  birth_year: number;
  school_level: 'TH' | 'THCS' | 'THPT';
  grade: number;
  consent_current: boolean;
  // Con đọc tin nhắn khi phụ huynh cho (YCTD-364)
  reads_messages: boolean;
}
