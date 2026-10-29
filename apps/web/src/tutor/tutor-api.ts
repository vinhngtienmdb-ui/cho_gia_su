import { MarketApiError, readSession } from '../client/index.js';

// Kiểu dữ liệu và lời gọi riêng của ứng dụng Gia sư (DT-27 phần 27g, YCTD-257)
export type VerificationKind = 'identity' | 'degree' | 'criminal_record' | 'business_registration';
export type VerificationStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'expired';

export interface Subject {
  subject: string;
  school_level: 'TH' | 'THCS' | 'THPT';
  grade_from: number;
  grade_to: number;
  content_kind: 'curriculum' | 'enrichment';
  price_per_session: number;
  session_minutes: number;
  // Gói buổi (YCTD-365): trống cả hai là không bán gói
  package_sessions: number | null;
  package_price: number | null;
}

export interface Slot {
  weekday: number;
  start_minute: number;
  end_minute: number;
}

export interface Listing {
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  teaching_language: string;
  subjects: Subject[];
  availability: Slot[];
  review_note: string | null;
  verifications: Partial<
    Record<VerificationKind, { status: VerificationStatus; note: string | null; valid_until: string | null }>
  >;
  verification_state: Record<VerificationKind, VerificationStatus>;
  school_role: { school_name: string; is_public: boolean; subjects: string; grades: string } | null;
  submit_blockers: string[];
  uploads_enabled: boolean;
}

export const STATUS_LABELS: Record<VerificationStatus, string> = {
  none: 'Chưa nộp',
  pending: 'Đang chờ duyệt',
  approved: 'Đã xác minh',
  rejected: 'Bị từ chối',
  expired: 'Hết hiệu lực, nộp lại',
};

export const LISTING_STATUS_LABELS: Record<Listing['status'], string> = {
  draft: 'Nháp',
  submitted: 'Đang chờ nền tảng duyệt',
  approved: 'Đã duyệt, đang hiện ở Chợ gia sư',
  rejected: 'Bị từ chối',
};

export const WEEKDAYS = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];

export function minutesText(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function parseTime(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

// Gửi giấy tờ (biểu mẫu nhiều phần): không đặt content-type để trình duyệt tự ghi ranh giới
export async function uploadDocument(kind: VerificationKind, form: FormData): Promise<Listing> {
  const token = readSession();
  const response = await fetch(`/api/v1/market/tutor/verifications/${kind}`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; details?: Array<{ message: string }> };
  };
  if (!response.ok) {
    throw new MarketApiError(
      response.status,
      [payload.error?.message, ...(payload.error?.details ?? []).map((detail) => detail.message)]
        .filter(Boolean)
        .join('. ') || 'Không gửi được giấy tờ',
    );
  }
  return payload as unknown as Listing;
}
