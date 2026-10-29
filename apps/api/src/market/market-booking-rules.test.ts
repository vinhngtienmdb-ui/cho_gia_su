import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertProviderAllowed } from './market-bookings.js';
import {
  cancellationRefund,
  commissionFor,
  contentProblems,
  fitsAvailability,
  overlaps,
  pickCommissionRule,
  settlement,
  vietnamClock,
} from './market-booking-rules.js';
import { MockMarketplacePaymentProvider, PaymentEventError } from './market-payment-provider.js';

// Quy tắc đặt buổi, hoa hồng, hoàn tiền, giải ngân của chợ gia sư (DT-27 phần 27h, YCTD-258), CT-27h-1: hàm thuần, số nguyên đồng;
// nhà cung cấp tiền thật bị chặn khi chợ chưa bật thu tiền thật; sự kiện giả lập ký và kiểm chữ ký

describe('hoa hồng (CT-27h-1)', () => {
  const rules = [
    { content_kind: null, tutor_account_id: null, percent: 10, minimum: 0, effective_from: '2026-01-01' },
    { content_kind: null, tutor_account_id: null, percent: 12, minimum: 0, effective_from: '2026-10-01' },
    {
      content_kind: 'curriculum' as const,
      tutor_account_id: null,
      percent: 15,
      minimum: 20_000,
      effective_from: '2026-01-01',
    },
    { content_kind: null, tutor_account_id: 'gia-su-a', percent: 5, minimum: 0, effective_from: '2026-01-01' },
    { content_kind: null, tutor_account_id: null, percent: 20, minimum: 0, effective_from: '2027-01-01' },
  ];

  it('chọn quy tắc cụ thể nhất có hiệu lực; tỷ lệ chưa đến ngày không dùng', () => {
    assert.equal(
      pickCommissionRule(rules, { contentKind: 'enrichment', tutorId: 'x', date: '2026-10-28' })?.percent,
      12,
    );
    assert.equal(
      pickCommissionRule(rules, { contentKind: 'enrichment', tutorId: 'x', date: '2026-09-01' })?.percent,
      10,
    );
    assert.equal(
      pickCommissionRule(rules, { contentKind: 'curriculum', tutorId: 'x', date: '2026-10-28' })?.percent,
      15,
    );
    assert.equal(
      pickCommissionRule(rules, { contentKind: 'curriculum', tutorId: 'gia-su-a', date: '2026-10-28' })?.percent,
      5,
    );
    assert.equal(pickCommissionRule([], { contentKind: 'curriculum', tutorId: 'x', date: '2026-10-28' }), null);
  });

  it('làm tròn đến đồng, tối thiểu, không vượt giá; không có quy tắc thì theo tỷ lệ mặc định (để trống là 0)', () => {
    assert.equal(commissionFor(150_000, { percent: 12, minimum: 0 }, null), 18_000);
    assert.equal(commissionFor(100_001, { percent: 12.5, minimum: 0 }, null), 12_500);
    assert.equal(commissionFor(100_000, { percent: 15, minimum: 20_000 }, null), 20_000);
    assert.equal(commissionFor(10_000, { percent: 10, minimum: 20_000 }, null), 10_000);
    assert.equal(commissionFor(200_000, null, 8), 16_000);
    assert.equal(commissionFor(200_000, null, null), 0);
  });
});

describe('hủy, chia tiền, giờ học, nội dung (CT-27h-1)', () => {
  const start = new Date('2026-11-02T11:00:00Z');

  it('chính sách hủy GD-134: trước 24 giờ hoàn đủ, trong 24 giờ hoàn 50%, gia sư hủy hoàn đủ, đã bắt đầu thì không hủy', () => {
    assert.equal(cancellationRefund(200_000, start, new Date('2026-11-01T10:00:00Z'), 'parent').refund, 200_000);
    assert.equal(cancellationRefund(200_000, start, new Date('2026-11-01T12:00:00Z'), 'parent').refund, 100_000);
    assert.equal(cancellationRefund(200_000, start, new Date('2026-11-02T10:00:00Z'), 'tutor').refund, 200_000);
    assert.equal(cancellationRefund(200_000, start, new Date('2026-11-02T11:00:00Z'), 'parent').allowed, false);
  });

  it('chia tiền: phần hoàn, hoa hồng theo phần còn lại, phần gia sư; tổng bằng số đã thu', () => {
    assert.deepEqual(settlement(200_000, 20_000, 0), { refund: 0, commission: 20_000, payout: 180_000 });
    assert.deepEqual(settlement(200_000, 20_000, 200_000), { refund: 200_000, commission: 0, payout: 0 });
    const half = settlement(200_000, 20_000, 100_000);
    assert.deepEqual(half, { refund: 100_000, commission: 10_000, payout: 90_000 });
    const odd = settlement(150_001, 18_000, 33_333);
    assert.equal(odd.refund + odd.commission + odd.payout, 150_001);
  });

  it('giờ Việt Nam, giờ trống, trùng giờ', () => {
    // 11:00 UTC thứ Hai = 18:00 thứ Hai giờ Việt Nam
    assert.deepEqual(vietnamClock(start), { weekday: 1, minute: 18 * 60, date: '2026-11-02' });
    const slots = [{ weekday: 1, start_minute: 18 * 60, end_minute: 20 * 60 }];
    assert.equal(fitsAvailability(start, 60, slots), true);
    assert.equal(fitsAvailability(start, 150, slots), false);
    assert.equal(fitsAvailability(new Date('2026-11-03T11:00:00Z'), 60, slots), false);
    assert.equal(overlaps(start, 60, new Date('2026-11-02T11:30:00Z'), 60), true);
    assert.equal(overlaps(start, 60, new Date('2026-11-02T12:00:00Z'), 60), false);
  });

  it('Tiểu học không học thêm môn của chương trình; gia sư đang dạy ở trường cần cam kết', () => {
    assert.match(
      contentProblems({
        schoolLevel: 'TH',
        contentKind: 'curriculum',
        tutorIsSchoolTeacher: false,
        attestedNoAssignment: false,
      })[0]?.message ?? '',
      /Tiểu học/,
    );
    assert.equal(
      contentProblems({
        schoolLevel: 'TH',
        contentKind: 'enrichment',
        tutorIsSchoolTeacher: false,
        attestedNoAssignment: false,
      }).length,
      0,
    );
    assert.equal(
      contentProblems({
        schoolLevel: 'THCS',
        contentKind: 'curriculum',
        tutorIsSchoolTeacher: true,
        attestedNoAssignment: false,
      })[0]?.field,
      'no_assignment_attested',
    );
    assert.equal(
      contentProblems({
        schoolLevel: 'THCS',
        contentKind: 'curriculum',
        tutorIsSchoolTeacher: true,
        attestedNoAssignment: true,
      }).length,
      0,
    );
  });
});

describe('nhà cung cấp thanh toán (CT-27h-1)', () => {
  it('nhà cung cấp tiền thật bị chặn khi chợ chưa bật thu tiền thật; bộ giả lập dùng được', () => {
    assert.throws(
      () => assertProviderAllowed({ realMoney: true, code: 'ngan-hang-that' }, false),
      /chưa bật thu tiền thật/,
    );
    assert.doesNotThrow(() => assertProviderAllowed({ realMoney: false, code: 'mock' }, false));
  });

  it('sự kiện giả lập: đúng chữ ký thì đọc được, sửa số tiền hoặc chữ ký thì bị từ chối', () => {
    const provider = new MockMarketplacePaymentProvider('bi-mat-thu');
    const signed = provider.signedEvent({
      eventId: 'e1',
      type: 'charge.succeeded',
      providerRef: 'mock_1',
      amount: 150_000,
    });
    assert.equal(provider.verifyEvent(signed.body, signed.signature).amount, 150_000);
    assert.throws(() => provider.verifyEvent({ ...signed.body, amount: 1 }, signed.signature), PaymentEventError);
    assert.throws(() => provider.verifyEvent(signed.body, 'sai'), PaymentEventError);
    const other = new MockMarketplacePaymentProvider('bi-mat-khac');
    assert.throws(() => other.verifyEvent(signed.body, signed.signature), PaymentEventError);
  });
});
