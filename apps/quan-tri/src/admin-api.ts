// Gọi máy chủ API của chợ từ ứng dụng quản trị, phiên quản trị lưu ở sessionStorage (đóng thẻ là thoát), vai trò quản trị
export type AdminRole = 'quan_tri' | 'ho_tro' | 'ke_toan';

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  quan_tri: 'Quản trị',
  ho_tro: 'Hỗ trợ',
  ke_toan: 'Kế toán',
};

export interface AdminProfile {
  id: string;
  login: string;
  full_name: string;
  role: AdminRole;
}

export interface AdminSession {
  accessToken: string;
  admin: AdminProfile;
}

// Việc từng vai được làm, khớp ADMIN_PERMISSIONS ở máy chủ (apps/api/src/common/shared.ts)
const PERMISSIONS = {
  'market.view': ['quan_tri', 'ho_tro', 'ke_toan'],
  'market.settings': ['quan_tri'],
  'market.review': ['quan_tri', 'ho_tro'],
  'market.safety': ['quan_tri', 'ho_tro'],
  'market.payments': ['quan_tri', 'ke_toan'],
  'admins.manage': ['quan_tri'],
} as const satisfies Record<string, readonly AdminRole[]>;

export function adminCan(role: AdminRole, capability: keyof typeof PERMISSIONS): boolean {
  return (PERMISSIONS[capability] as readonly AdminRole[]).includes(role);
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SESSION_KEY = 'cho-gia-su-quan-tri';

export function readAdminSession(): AdminSession | null {
  try {
    const text = sessionStorage.getItem(SESSION_KEY);
    return text ? (JSON.parse(text) as AdminSession) : null;
  } catch {
    return null;
  }
}

export function writeAdminSession(session: AdminSession | null): void {
  if (session) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

export async function adminRequest<T>(token: string | null, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/market/admin${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let message = 'Không thực hiện được, vui lòng thử lại';
    try {
      const payload = (await response.json()) as { error?: { message?: string; details?: Array<{ message: string }> } };
      message =
        [payload.error?.message, ...(payload.error?.details ?? []).map((detail) => detail.message)]
          .filter(Boolean)
          .join('. ') || message;
    } catch {
      // Phản hồi không phải JSON: giữ thông điệp mặc định
    }
    throw new AdminApiError(response.status, message);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
