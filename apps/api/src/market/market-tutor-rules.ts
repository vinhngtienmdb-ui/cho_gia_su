// Quy tắc thuần của hồ sơ gia sư ở chợ (DT-27 phần 27g, YCTD-257): kiểm dữ liệu hồ sơ, trạng thái các bậc xác minh, điều kiện gửi duyệt,
// duyệt và hiện công khai. Không đọc cơ sở dữ liệu để kiểm thử đơn vị được (CT-27g-1)
export type SchoolLevel = 'TH' | 'THCS' | 'THPT';
export type ContentKind = 'curriculum' | 'enrichment';
export type VerificationKind = 'identity' | 'degree' | 'criminal_record' | 'business_registration';

export const LEVEL_GRADES: Record<SchoolLevel, [number, number]> = { TH: [1, 5], THCS: [6, 9], THPT: [10, 12] };
export const VERIFICATION_KINDS: VerificationKind[] = [
  'identity',
  'degree',
  'criminal_record',
  'business_registration',
];
// Phiếu lý lịch tư pháp cấp trong 6 tháng khi nộp, xác minh lại sau 12 tháng (GD-136)
export const CRIMINAL_RECORD_MAX_AGE_DAYS = 183;
export const CRIMINAL_RECORD_VALID_MONTHS = 12;
const MAXIMUM_SUBJECTS = 20;
const MAXIMUM_SLOTS = 42;

export interface SubjectInput {
  subject: string;
  school_level: SchoolLevel;
  grade_from: number;
  grade_to: number;
  content_kind: ContentKind;
  price_per_session: number;
  session_minutes: number;
  // Gói buổi (YCTD-365, GD-165): cả hai trống là không bán gói
  package_sessions: number | null;
  package_price: number | null;
}

export interface SlotInput {
  weekday: number;
  start_minute: number;
  end_minute: number;
}

export interface ListingInput {
  teaching_language: string;
  subjects: SubjectInput[];
  availability: SlotInput[];
}

export interface FieldProblem {
  field: string;
  message: string;
}

function integer(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

// Kiểm và chuẩn hóa hồ sơ; giáo viên trường công lập không có môn `curriculum` (Thông tư 29/2024 khoản 3 Điều 4)
export function parseListing(
  body: Record<string, unknown> | undefined,
  publicSchoolTeacher: boolean,
): { listing: ListingInput; errors: FieldProblem[] } {
  const errors: FieldProblem[] = [];
  const language = typeof body?.teaching_language === 'string' ? body.teaching_language.trim() : 'Tiếng Việt';
  if (language.length < 1 || language.length > 40) {
    errors.push({ field: 'teaching_language', message: 'Ngôn ngữ dạy từ 1 đến 40 ký tự' });
  }
  const rawSubjects = Array.isArray(body?.subjects) ? (body.subjects as unknown[]) : [];
  if (rawSubjects.length > MAXIMUM_SUBJECTS) {
    errors.push({ field: 'subjects', message: `Tối đa ${MAXIMUM_SUBJECTS} môn` });
  }
  const subjects: SubjectInput[] = [];
  rawSubjects.slice(0, MAXIMUM_SUBJECTS).forEach((raw, index) => {
    const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const field = `subjects.${index}`;
    const subject = typeof item.subject === 'string' ? item.subject.trim() : '';
    const level = item.school_level as SchoolLevel;
    const range = LEVEL_GRADES[level];
    const gradeFrom = range ? integer(item.grade_from, range[0], range[1]) : null;
    const gradeTo = range ? integer(item.grade_to, range[0], range[1]) : null;
    const kind = item.content_kind;
    const price = integer(item.price_per_session, 0, 10_000_000);
    const minutes = integer(item.session_minutes, 30, 180);
    const wantsPackage =
      (item.package_sessions !== undefined && item.package_sessions !== null && item.package_sessions !== '') ||
      (item.package_price !== undefined && item.package_price !== null && item.package_price !== '');
    const packageSessions = wantsPackage ? integer(item.package_sessions, 2, 50) : null;
    const packagePrice = wantsPackage ? integer(item.package_price, 1, 100_000_000) : null;
    if (wantsPackage && (packageSessions === null || packagePrice === null)) {
      errors.push({
        field,
        message: 'Gói buổi từ 2 đến 50 buổi, giá cả gói lớn hơn 0; để trống cả hai nếu không bán gói',
      });
    }
    if (subject.length < 1 || subject.length > 60) errors.push({ field, message: 'Tên môn từ 1 đến 60 ký tự' });
    if (!range) errors.push({ field, message: 'Chọn cấp học' });
    if (range && (gradeFrom === null || gradeTo === null || gradeTo < gradeFrom)) {
      errors.push({ field, message: `Khối từ ${range[0]} đến ${range[1]}, khối đầu không lớn hơn khối cuối` });
    }
    if (kind !== 'curriculum' && kind !== 'enrichment') errors.push({ field, message: 'Chọn loại nội dung' });
    if (kind === 'curriculum' && publicSchoolTeacher) {
      errors.push({
        field,
        message:
          'Giáo viên trường công lập không đứng tên dạy thêm có thu tiền môn của chương trình phổ thông (Thông tư 29/2024)',
      });
    }
    // Không dạy thêm có thu tiền môn của chương trình phổ thông cho học sinh Tiểu học (Thông tư 29/2024 khoản 1 Điều 4; DT-27 phần 27h)
    if (kind === 'curriculum' && level === 'TH') {
      errors.push({
        field,
        message: 'Không dạy thêm môn của chương trình phổ thông cho học sinh Tiểu học (Thông tư 29/2024)',
      });
    }
    if (price === null) errors.push({ field, message: 'Giá mỗi buổi từ 0 đến 10 000 000 đồng' });
    if (minutes === null) errors.push({ field, message: 'Thời lượng buổi từ 30 đến 180 phút' });
    if (
      range &&
      gradeFrom !== null &&
      gradeTo !== null &&
      (kind === 'curriculum' || kind === 'enrichment') &&
      price !== null &&
      minutes !== null
    ) {
      subjects.push({
        subject,
        school_level: level,
        grade_from: gradeFrom,
        grade_to: gradeTo,
        content_kind: kind,
        price_per_session: price,
        session_minutes: minutes,
        package_sessions: packageSessions,
        package_price: packagePrice,
      });
    }
  });
  const rawSlots = Array.isArray(body?.availability) ? (body.availability as unknown[]) : [];
  if (rawSlots.length > MAXIMUM_SLOTS) {
    errors.push({ field: 'availability', message: `Tối đa ${MAXIMUM_SLOTS} khung giờ` });
  }
  const availability: SlotInput[] = [];
  rawSlots.slice(0, MAXIMUM_SLOTS).forEach((raw, index) => {
    const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const weekday = integer(item.weekday, 1, 7);
    const start = integer(item.start_minute, 0, 1439);
    const end = integer(item.end_minute, 30, 1440);
    if (weekday === null || start === null || end === null || end < start + 30) {
      errors.push({ field: `availability.${index}`, message: 'Thứ từ 1 đến 7, khung giờ dài ít nhất 30 phút' });
      return;
    }
    availability.push({ weekday, start_minute: start, end_minute: end });
  });
  for (let i = 0; i < availability.length; i += 1) {
    for (let j = i + 1; j < availability.length; j += 1) {
      const a = availability[i] as SlotInput;
      const b = availability[j] as SlotInput;
      if (a.weekday === b.weekday && a.start_minute < b.end_minute && b.start_minute < a.end_minute) {
        errors.push({ field: `availability.${j}`, message: 'Khung giờ trùng nhau trong cùng một thứ' });
      }
    }
  }
  return { listing: { teaching_language: language, subjects, availability }, errors };
}

export interface VerificationRow {
  kind: VerificationKind;
  status: 'pending' | 'approved' | 'rejected';
  valid_until: string | null;
}

export type VerificationState = Record<VerificationKind, 'none' | 'pending' | 'approved' | 'rejected' | 'expired'>;

// Trạng thái từng bậc; bậc đã duyệt mà quá hạn hiệu lực (lý lịch tư pháp) là hết hạn
export function verificationState(rows: VerificationRow[], today: string): VerificationState {
  const state: VerificationState = {
    identity: 'none',
    degree: 'none',
    criminal_record: 'none',
    business_registration: 'none',
  };
  for (const row of rows) {
    state[row.kind] =
      row.status === 'approved' && row.valid_until !== null && row.valid_until < today ? 'expired' : row.status;
  }
  return state;
}

// Ngày cấp phiếu lý lịch tư pháp hợp lệ: dạng yyyy-mm-dd, không ở tương lai, không quá 6 tháng
export function criminalRecordIssueProblem(issuedOn: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn) || Number.isNaN(Date.parse(`${issuedOn}T00:00:00Z`))) {
    return 'Ngày cấp dạng năm-tháng-ngày';
  }
  if (issuedOn > today) {
    return 'Ngày cấp không ở tương lai';
  }
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${issuedOn}T00:00:00Z`)) / 86_400_000;
  return age > CRIMINAL_RECORD_MAX_AGE_DAYS ? 'Phiếu lý lịch tư pháp phải cấp trong vòng 6 tháng' : null;
}

export function addMonths(date: string, months: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}

// Điều kiện gửi hồ sơ cho nhân viên nền tảng duyệt
export function submitBlockers(listing: ListingInput, state: VerificationState): string[] {
  const blockers: string[] = [];
  if (state.identity !== 'approved') blockers.push('Xác minh danh tính trước khi gửi duyệt');
  if (listing.subjects.length === 0) blockers.push('Thêm ít nhất một môn dạy');
  if (listing.availability.length === 0) blockers.push('Thêm ít nhất một khung giờ trống');
  if (
    listing.subjects.some((subject) => subject.content_kind === 'curriculum') &&
    state.business_registration === 'none'
  ) {
    blockers.push('Môn của chương trình phổ thông có thu tiền cần nộp đăng ký kinh doanh');
  }
  return blockers;
}

// Điều kiện nhân viên nền tảng duyệt hồ sơ, cũng là điều kiện hiện công khai
export function approvalBlockers(listing: ListingInput, state: VerificationState): string[] {
  const blockers: string[] = [];
  if (state.identity !== 'approved') blockers.push('Chưa xác minh danh tính');
  if (state.criminal_record !== 'approved') blockers.push('Chưa duyệt phiếu lý lịch tư pháp còn hiệu lực');
  if (
    listing.subjects.some((subject) => subject.content_kind === 'curriculum') &&
    state.business_registration !== 'approved'
  ) {
    blockers.push('Có môn của chương trình phổ thông nhưng chưa duyệt đăng ký kinh doanh');
  }
  if (listing.subjects.length === 0) blockers.push('Chưa có môn dạy');
  return blockers;
}

export interface Badges {
  identity: boolean;
  degree: boolean;
  criminal_record: boolean;
  business_registration: boolean;
  school_teacher: boolean;
}

export function badgesOf(state: VerificationState, schoolTeacher: boolean): Badges {
  return {
    identity: state.identity === 'approved',
    degree: state.degree === 'approved',
    criminal_record: state.criminal_record === 'approved',
    business_registration: state.business_registration === 'approved',
    school_teacher: schoolTeacher,
  };
}
