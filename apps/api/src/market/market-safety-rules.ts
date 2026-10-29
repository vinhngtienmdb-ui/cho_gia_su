import type { MarketReportCategory, MarketReportSeverity } from '@cho-gia-su/database';
import { scanContactInfo, type ContactFinding } from '../common/contact-filter.js';
import { sql } from 'kysely';

// Quy tắc thuần của an toàn trẻ em ở chợ gia sư (DT-27 phần 27i, YCTD-259; tài liệu 47 mục 19.2, 19.5). Claude tự chọn theo ủy quyền
// của Eric ngày 2026-10-11; các mốc là giả định làm cấu hình được sau (19.11)
export const REPORT_CATEGORIES: readonly MarketReportCategory[] = [
  'child_safety',
  'harassment',
  'fraud',
  'fee_evasion',
  'wrong_content',
];
export const REPORT_SEVERITIES: readonly MarketReportSeverity[] = ['low', 'medium', 'high', 'critical'];

// Hạn xử lý theo mức: nghiêm trọng 4 giờ, cao 24 giờ, trung bình 3 ngày, thấp 7 ngày
const DUE_HOURS: Record<MarketReportSeverity, number> = { critical: 4, high: 24, medium: 72, low: 168 };

export function reportDueAt(severity: MarketReportSeverity, now: Date): Date {
  return new Date(now.getTime() + DUE_HOURS[severity] * 3_600_000);
}

// Báo cáo về an toàn trẻ em không thấp hơn mức cao: người báo chọn thấp vẫn vào hàng chờ 24 giờ
export function effectiveSeverity(
  category: MarketReportCategory,
  severity: MarketReportSeverity,
): MarketReportSeverity {
  if (category === 'child_safety' && (severity === 'low' || severity === 'medium')) return 'high';
  return severity;
}

// Tạm khóa ngay khi báo cáo mức nghiêm trọng, không chờ nhân viên xét (tài liệu 47 mục 19.5, 27i)
export function suspendsImmediately(severity: MarketReportSeverity): boolean {
  return severity === 'critical';
}

// Điều kiện "gia sư không đang bị tạm khóa" cho truy vấn tìm gia sư, đặt buổi, giải ngân
export function notSuspended(column: string) {
  return sql<boolean>`not exists (select 1 from market_tutor_suspensions where market_tutor_suspensions.tutor_account_id = ${sql.ref(column)} and market_tutor_suspensions.lifted_at is null)`;
}

// Trẻ vị thành niên theo năm sinh (chợ chỉ có năm sinh): chênh lệch năm đến 18 vẫn tính là chưa đủ 18 tuổi để không bỏ sót
export function isMinor(birthYear: number, now: Date): boolean {
  const year = Number(new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 4));
  return year - birthYear <= 18;
}

// Bản ghi giữ 30 ngày sau buổi (cùng hạn của 23e); có tranh chấp, báo cáo hoặc tạm khóa đang mở thì giữ tiếp
export const RECORDING_RETENTION_DAYS = 30;

export function recordingRetainUntil(endedAt: Date): Date {
  return new Date(endedAt.getTime() + RECORDING_RETENTION_DAYS * 24 * 3_600_000);
}

export function recordingDeletable(input: { retainUntil: Date | null; now: Date; evidenceHold: boolean }): boolean {
  return input.retainUntil !== null && input.retainUntil.getTime() <= input.now.getTime() && !input.evidenceHold;
}

// Phòng mở từ 15 phút trước giờ học đến hết giờ học
export const ROOM_OPENS_BEFORE_MS = 15 * 60_000;

export function roomOpen(startsAt: Date, minutes: number, now: Date): boolean {
  const time = now.getTime();
  return time >= startsAt.getTime() - ROOM_OPENS_BEFORE_MS && time <= startsAt.getTime() + minutes * 60_000;
}

// Lần gửi thông tin liên lạc ngoài thứ mấy thì gắn cờ luồng và tạo báo cáo né hoa hồng
export const CONTACT_STRIKE_LIMIT = 3;

export interface FilteredMessage {
  body: string;
  original: string | null;
  findings: ContactFinding[];
  warning: string | null;
}

// Che số điện thoại, thư điện tử, liên kết, tài khoản mạng xã hội bằng hàm thuần của 28e; trả lời cảnh báo cho người gửi
export function filterMessage(text: string): FilteredMessage {
  const { masked, findings } = scanContactInfo(text);
  if (findings.length === 0) return { body: text, original: null, findings, warning: null };
  return {
    body: masked,
    original: text,
    findings,
    warning:
      'Tin nhắn có thông tin liên lạc ngoài chợ nên đã bị che. Trao đổi và thanh toán ngoài chợ không được bảo vệ (không có ghi hình, không hoàn tiền); gửi nhiều lần sẽ bị chuyển kiểm duyệt.',
  };
}
