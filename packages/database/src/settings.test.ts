import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readdirSync } from 'node:fs';
import { migrations } from '../migrations/index.js';
import { MarketSettingsError, parseMarketSettings, REAL_PAYMENTS_BLOCKED_MESSAGE } from './settings.js';

// Cấu hình chợ (DT-27 phần 27f, YCTD-256, CT-27f-1): thu tiền thật không bật được ở bản này. Bản tách (YCTD-393) bỏ công tắc bật chợ và
// tên miền khỏi cấu hình

describe('parseMarketSettings (CT-27f-1)', () => {
  test('mặc định: thu tiền thật tắt, hoa hồng để trống', () => {
    const settings = parseMarketSettings({});
    assert.equal(settings.realPaymentsEnabled, false);
    assert.equal(settings.defaultCommissionPercent, null);
    assert.equal(settings.recordRetentionDays, 30);
    assert.equal(settings.complaintWindowHours, 48);
  });

  test('bật thu tiền thật bị chặn kể cả khi mọi trường khác hợp lệ', () => {
    assert.throws(
      () => parseMarketSettings({ record_retention_days: 30, real_payments_enabled: true }),
      (error: unknown) =>
        error instanceof MarketSettingsError &&
        error.field === 'real_payments_enabled' &&
        error.message === REAL_PAYMENTS_BLOCKED_MESSAGE,
    );
  });

  test('từ chối hạn, tỷ lệ ngoài khoảng', () => {
    assert.throws(() => parseMarketSettings({ record_retention_days: 3 }), MarketSettingsError);
    assert.throws(() => parseMarketSettings({ complaint_window_hours: 0 }), MarketSettingsError);
    assert.throws(() => parseMarketSettings({ default_commission_percent: 80 }), MarketSettingsError);
    assert.equal(parseMarketSettings({ default_commission_percent: 12.345 }).defaultCommissionPercent, 12.35);
  });
});

describe('mốc phòng học video (YCTD-362, GD-164)', () => {
  test('mặc định theo quyết định của Eric ngày 2026-10-29', () => {
    assert.deepEqual(parseMarketSettings({}).room, {
      opensBeforeMinutes: 10,
      lateAbsentMinutes: 15,
      tutorNoShowMinutes: 10,
      fullAttendancePercent: 80,
      autoConfirmHours: 24,
    });
  });

  test('chỉnh được trong khoảng, ngoài khoảng bị từ chối', () => {
    const settings = parseMarketSettings({ room_opens_before_minutes: 5, full_attendance_percent: 90 });
    assert.equal(settings.room.opensBeforeMinutes, 5);
    assert.equal(settings.room.fullAttendancePercent, 90);
    assert.throws(
      () => parseMarketSettings({ full_attendance_percent: 30 }),
      (error: unknown) => error instanceof MarketSettingsError && error.field === 'full_attendance_percent',
    );
    assert.throws(() => parseMarketSettings({ auto_confirm_hours: 0 }), MarketSettingsError);
  });
});

describe('gói buổi (YCTD-365, GD-165)', () => {
  test('mặc định dùng trong 56 ngày, chỉnh được từ 7 đến 365 ngày', () => {
    assert.equal(parseMarketSettings({}).packageValidDays, 56);
    assert.equal(parseMarketSettings({ package_valid_days: 30 }).packageValidDays, 30);
    assert.throws(() => parseMarketSettings({ package_valid_days: 3 }), MarketSettingsError);
  });
});

describe('danh sách tệp thay đổi cấu trúc', () => {
  test('mọi tệp trong thư mục migrations đều có trong migrations/index.ts', () => {
    const folder = new URL('../migrations/', import.meta.url);
    const files = readdirSync(folder)
      .filter((name) => /^\d{4}_[a-z0-9_]+\.js$/.test(name))
      .map((name) => name.slice(0, -'.js'.length));
    assert.deepEqual(files.sort(), Object.keys(migrations).sort());
  });
});
