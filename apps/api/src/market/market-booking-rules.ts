// Quy tắc thuần của đặt buổi, hoa hồng, hoàn tiền, giải ngân ở chợ gia sư (DT-27 phần 27h, YCTD-258). Mọi số tiền là số nguyên đồng;
// không đọc cơ sở dữ liệu để kiểm thử đơn vị được (CT-27h-1)
export type ContentKind = 'curriculum' | 'enrichment';

export interface CommissionRule {
  content_kind: ContentKind | null;
  tutor_account_id: string | null;
  percent: number;
  minimum: number;
  effective_from: string;
}

// Quy tắc áp dụng: cụ thể nhất (theo gia sư, rồi theo loại nội dung, rồi chung), trong cùng mức lấy ngày hiệu lực gần nhất không sau
// ngày đặt. Không có quy tắc nào thì dùng tỷ lệ mặc định của cấu hình chợ (để trống là 0 cho đến khi Eric chốt, E-01)
export function pickCommissionRule(
  rules: CommissionRule[],
  input: { contentKind: ContentKind; tutorId: string; date: string },
): CommissionRule | null {
  const usable = rules.filter(
    (rule) =>
      rule.effective_from <= input.date &&
      (rule.tutor_account_id === null || rule.tutor_account_id === input.tutorId) &&
      (rule.content_kind === null || rule.content_kind === input.contentKind),
  );
  const score = (rule: CommissionRule) => (rule.tutor_account_id ? 2 : 0) + (rule.content_kind ? 1 : 0);
  usable.sort((a, b) => score(b) - score(a) || b.effective_from.localeCompare(a.effective_from));
  return usable[0] ?? null;
}

// Hoa hồng của một buổi: tỷ lệ phần trăm làm tròn đến đồng (nửa lên), không thấp hơn mức tối thiểu, không vượt giá buổi
export function commissionFor(
  price: number,
  rule: { percent: number; minimum: number } | null,
  fallbackPercent: number | null,
): number {
  const percent = rule?.percent ?? fallbackPercent ?? 0;
  const minimum = rule?.minimum ?? 0;
  const raw = Math.round((price * Math.round(percent * 100)) / 10_000);
  return Math.min(price, Math.max(raw, minimum));
}

export const FULL_REFUND_HOURS = 24;

// Hoàn tiền khi hủy buổi đã trả (GD-134): phụ huynh hủy trước giờ học từ 24 giờ trở lên hoàn đủ, trong 24 giờ hoàn 50%, sau giờ bắt đầu
// không hủy được (mở tranh chấp); gia sư hủy luôn hoàn đủ cho phụ huynh
export function cancellationRefund(
  price: number,
  startsAt: Date,
  now: Date,
  by: 'parent' | 'tutor',
): { refund: number; allowed: boolean; rule: string } {
  if (now.getTime() >= startsAt.getTime()) {
    return { refund: 0, allowed: false, rule: 'Buổi đã bắt đầu, không hủy được; có vấn đề thì mở tranh chấp' };
  }
  if (by === 'tutor') {
    return { refund: price, allowed: true, rule: 'Gia sư hủy: hoàn đủ' };
  }
  const hours = (startsAt.getTime() - now.getTime()) / 3_600_000;
  return hours >= FULL_REFUND_HOURS
    ? { refund: price, allowed: true, rule: 'Hủy trước 24 giờ: hoàn đủ' }
    : { refund: Math.round(price / 2), allowed: true, rule: 'Hủy trong 24 giờ: hoàn 50%' };
}

// Chia tiền khi kết thúc: phần hoàn cho phụ huynh, phần còn lại chia hoa hồng nền tảng theo tỷ lệ hoa hồng đã chốt lúc đặt và phần gia sư
export function settlement(
  amount: number,
  commission: number,
  refund: number,
): { refund: number; commission: number; payout: number } {
  const refunded = Math.max(0, Math.min(amount, refund));
  const gross = amount - refunded;
  const taken = amount === 0 ? 0 : Math.round((commission * gross) / amount);
  return { refund: refunded, commission: taken, payout: gross - taken };
}

export interface Slot {
  weekday: number;
  start_minute: number;
  end_minute: number;
}

// Giờ Việt Nam (UTC+7, không đổi giờ theo mùa) của một thời điểm: thứ (1 là Thứ Hai … 7 là Chủ nhật) và phút trong ngày
export function vietnamClock(at: Date): { weekday: number; minute: number; date: string } {
  const local = new Date(at.getTime() + 7 * 3_600_000);
  const day = local.getUTCDay();
  return {
    weekday: day === 0 ? 7 : day,
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
    date: local.toISOString().slice(0, 10),
  };
}

// Buổi nằm trọn trong một khung giờ trống của gia sư, cùng một ngày theo giờ Việt Nam
export function fitsAvailability(startsAt: Date, minutes: number, slots: Slot[]): boolean {
  const start = vietnamClock(startsAt);
  const end = start.minute + minutes;
  return slots.some(
    (slot) => slot.weekday === start.weekday && slot.start_minute <= start.minute && end <= slot.end_minute,
  );
}

export function overlaps(aStart: Date, aMinutes: number, bStart: Date, bMinutes: number): boolean {
  const a0 = aStart.getTime();
  const b0 = bStart.getTime();
  return a0 < b0 + bMinutes * 60_000 && b0 < a0 + aMinutes * 60_000;
}

export interface BookingProblem {
  field: string;
  message: string;
}

// Điều kiện nội dung của buổi (Thông tư 29/2024 khoản 1 Điều 4): không dạy thêm môn của chương trình phổ thông có thu tiền cho học sinh
// Tiểu học. Gia sư đang dạy ở trường dạy môn của chương trình thì phụ huynh phải cam kết con không do gia sư này dạy ở trường (khoản 2
// Điều 4) khi chưa so khớp được qua liên kết trường
export function contentProblems(input: {
  schoolLevel: 'TH' | 'THCS' | 'THPT';
  contentKind: ContentKind;
  tutorIsSchoolTeacher: boolean;
  attestedNoAssignment: boolean;
}): BookingProblem[] {
  const problems: BookingProblem[] = [];
  if (input.contentKind === 'curriculum' && input.schoolLevel === 'TH') {
    problems.push({
      field: 'subject',
      message: 'Không dạy thêm có thu tiền môn của chương trình phổ thông cho học sinh Tiểu học (Thông tư 29/2024)',
    });
  }
  if (input.contentKind === 'curriculum' && input.tutorIsSchoolTeacher && !input.attestedNoAssignment) {
    problems.push({
      field: 'no_assignment_attested',
      message: 'Gia sư đang dạy ở trường: cam kết con không học lớp do gia sư này được phân công dạy ở trường',
    });
  }
  return problems;
}
