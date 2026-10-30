import type { Kysely } from 'kysely';
import type { MarketplaceDatabase } from './schema.js';

// Cấu hình chợ, lưu ở bảng `market_settings` khóa `market` (YCTD-393; ở School Management là `platform_settings` khóa `market`, DT-27
// phần 27f, YCTD-256). Bản tách bỏ công tắc bật chợ và tên miền: máy chủ API của sản phẩm chỉ phục vụ chợ. Giữ nguyên:
// - hạn giữ bản ghi (GD-132), hạn khiếu nại trước khi giải ngân (GD-133), tỷ lệ hoa hồng mặc định (E-01, để trống đến khi chốt);
// - **thu tiền thật luôn tắt**: lưu `real_payments_enabled = true` bị từ chối cho đến khi xong E-01 đến E-07 (luật sư, tổ chức có giấy
//   phép, pháp nhân). Bỏ chặn là một thay đổi mã có yêu cầu thay đổi riêng, không phải một công tắc;
// - mốc của phòng học video (YCTD-362, GD-164) và hạn dùng gói buổi (YCTD-365, GD-165), trang quản trị chỉnh được
export const MARKET_SETTINGS_KEY = 'market';

export interface MarketRoomTimings {
  opensBeforeMinutes: number;
  lateAbsentMinutes: number;
  tutorNoShowMinutes: number;
  fullAttendancePercent: number;
  autoConfirmHours: number;
}

export const DEFAULT_ROOM_TIMINGS: MarketRoomTimings = {
  opensBeforeMinutes: 10,
  lateAbsentMinutes: 15,
  tutorNoShowMinutes: 10,
  fullAttendancePercent: 80,
  autoConfirmHours: 24,
};

// Tên trường ở JSON lưu và ở API, cận dưới, cận trên, nhãn trong thông báo lỗi
const ROOM_TIMING_FIELDS: Array<[keyof MarketRoomTimings, string, number, number, string]> = [
  ['opensBeforeMinutes', 'room_opens_before_minutes', 0, 60, 'Mở phòng trước giờ học là số phút từ 0 đến 60'],
  ['lateAbsentMinutes', 'late_absent_minutes', 1, 60, 'Vào muộn tính vắng là số phút từ 1 đến 60'],
  ['tutorNoShowMinutes', 'tutor_no_show_minutes', 1, 60, 'Gia sư vắng là số phút từ 1 đến 60'],
  ['fullAttendancePercent', 'full_attendance_percent', 50, 100, 'Tỉ lệ có mặt để đủ buổi từ 50 đến 100 phần trăm'],
  ['autoConfirmHours', 'auto_confirm_hours', 1, 168, 'Tự xác nhận buổi sau số giờ từ 1 đến 168'],
];

export interface MarketSettings {
  recordRetentionDays: number;
  complaintWindowHours: number;
  defaultCommissionPercent: number | null;
  realPaymentsEnabled: false;
  room: MarketRoomTimings;
  packageValidDays: number;
}

export const DEFAULT_MARKET_SETTINGS: MarketSettings = {
  recordRetentionDays: 30,
  complaintWindowHours: 48,
  defaultCommissionPercent: null,
  realPaymentsEnabled: false,
  room: DEFAULT_ROOM_TIMINGS,
  packageValidDays: 56,
};

export const REAL_PAYMENTS_BLOCKED_MESSAGE =
  'Chưa bật được thu tiền thật ở chợ: cần xong E-01 đến E-07 (hoa hồng, tổ chức có giấy phép, luật sư, pháp nhân). Bản này chỉ chạy thanh toán giả lập';

export class MarketSettingsError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

function integerOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

export async function readMarketSettings(database: Kysely<MarketplaceDatabase>): Promise<MarketSettings> {
  const row = await database
    .selectFrom('market_settings')
    .select('value')
    .where('key', '=', MARKET_SETTINGS_KEY)
    .executeTakeFirst();
  const value = (row?.value ?? {}) as Record<string, unknown>;
  return {
    recordRetentionDays: integerOr(value.record_retention_days, DEFAULT_MARKET_SETTINGS.recordRetentionDays),
    complaintWindowHours: integerOr(value.complaint_window_hours, DEFAULT_MARKET_SETTINGS.complaintWindowHours),
    defaultCommissionPercent:
      typeof value.default_commission_percent === 'number' ? value.default_commission_percent : null,
    // Giá trị lưu ở cơ sở dữ liệu không mở được thu tiền thật: luôn đọc là tắt
    realPaymentsEnabled: false,
    room: Object.fromEntries(
      ROOM_TIMING_FIELDS.map(([key, field]) => [key, integerOr(value[field], DEFAULT_ROOM_TIMINGS[key])]),
    ) as unknown as MarketRoomTimings,
    packageValidDays: integerOr(value.package_valid_days, DEFAULT_MARKET_SETTINGS.packageValidDays),
  };
}

// Kiểm và chuẩn hóa dữ liệu nhập ở trang quản trị; lỗi đầu tiên ném MarketSettingsError
export function parseMarketSettings(body: Record<string, unknown> | undefined): MarketSettings {
  if (body?.real_payments_enabled === true) {
    throw new MarketSettingsError('real_payments_enabled', REAL_PAYMENTS_BLOCKED_MESSAGE);
  }
  const retention = body?.record_retention_days ?? DEFAULT_MARKET_SETTINGS.recordRetentionDays;
  if (typeof retention !== 'number' || !Number.isInteger(retention) || retention < 7 || retention > 365) {
    throw new MarketSettingsError('record_retention_days', 'Hạn giữ bản ghi là số ngày từ 7 đến 365');
  }
  const window = body?.complaint_window_hours ?? DEFAULT_MARKET_SETTINGS.complaintWindowHours;
  if (typeof window !== 'number' || !Number.isInteger(window) || window < 1 || window > 720) {
    throw new MarketSettingsError('complaint_window_hours', 'Hạn khiếu nại là số giờ từ 1 đến 720');
  }
  const commission = body?.default_commission_percent ?? null;
  if (
    commission !== null &&
    (typeof commission !== 'number' || !Number.isFinite(commission) || commission < 0 || commission > 50)
  ) {
    throw new MarketSettingsError(
      'default_commission_percent',
      'Tỷ lệ hoa hồng từ 0 đến 50 phần trăm, để trống khi chưa chốt',
    );
  }
  const room = { ...DEFAULT_ROOM_TIMINGS };
  for (const [key, field, min, max, message] of ROOM_TIMING_FIELDS) {
    const input = body?.[field] ?? DEFAULT_ROOM_TIMINGS[key];
    if (typeof input !== 'number' || !Number.isInteger(input) || input < min || input > max) {
      throw new MarketSettingsError(field, message);
    }
    room[key] = input;
  }
  const packageDays = body?.package_valid_days ?? DEFAULT_MARKET_SETTINGS.packageValidDays;
  if (typeof packageDays !== 'number' || !Number.isInteger(packageDays) || packageDays < 7 || packageDays > 365) {
    throw new MarketSettingsError('package_valid_days', 'Hạn dùng gói buổi là số ngày từ 7 đến 365');
  }
  return {
    recordRetentionDays: retention,
    complaintWindowHours: window,
    defaultCommissionPercent: commission === null ? null : Math.round(commission * 100) / 100,
    realPaymentsEnabled: false,
    room,
    packageValidDays: packageDays,
  };
}

export async function saveMarketSettings(
  database: Kysely<MarketplaceDatabase>,
  settings: MarketSettings,
  adminId: string,
): Promise<MarketSettings> {
  const value = JSON.stringify({
    record_retention_days: settings.recordRetentionDays,
    complaint_window_hours: settings.complaintWindowHours,
    default_commission_percent: settings.defaultCommissionPercent,
    real_payments_enabled: false,
    ...roomTimingsJson(settings.room),
    package_valid_days: settings.packageValidDays,
  });
  await database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto('market_settings')
      .values({ key: MARKET_SETTINGS_KEY, value })
      .onConflict((conflict) => conflict.column('key').doUpdateSet({ value, updated_at: new Date() }))
      .execute();
    await transaction
      .insertInto('market_audit_log')
      .values({
        actor_type: 'operator',
        actor_id: adminId,
        action: 'market.settings-update',
        target: null,
        details: value,
      })
      .execute();
  });
  return settings;
}

// Mốc phòng học dưới dạng tên trường của JSON lưu và của API trang quản trị
export function roomTimingsJson(room: MarketRoomTimings): Record<string, number> {
  return Object.fromEntries(ROOM_TIMING_FIELDS.map(([key, field]) => [field, room[key]]));
}
