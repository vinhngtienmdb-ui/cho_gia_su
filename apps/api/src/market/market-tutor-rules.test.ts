import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addMonths,
  approvalBlockers,
  criminalRecordIssueProblem,
  parseListing,
  submitBlockers,
  verificationState,
  type ListingInput,
} from './market-tutor-rules.js';

// Quy tắc hồ sơ gia sư ở chợ (DT-27 phần 27g, YCTD-257), CT-27g-1: kiểm hồ sơ, chặn môn `curriculum` của giáo viên công lập, trạng thái
// xác minh có hạn, điều kiện gửi duyệt và duyệt

const SUBJECT = {
  subject: 'Toán',
  school_level: 'THCS',
  grade_from: 6,
  grade_to: 9,
  content_kind: 'curriculum',
  price_per_session: 200_000,
  session_minutes: 60,
};
const SLOT = { weekday: 2, start_minute: 18 * 60, end_minute: 20 * 60 };

describe('parseListing (CT-27g-1)', () => {
  it('nhận hồ sơ hợp lệ', () => {
    const { listing, errors } = parseListing({ subjects: [SUBJECT], availability: [SLOT] }, false);
    assert.deepEqual(errors, []);
    assert.equal(listing.subjects.length, 1);
    assert.equal(listing.teaching_language, 'Tiếng Việt');
  });

  it('giáo viên trường công lập không có môn của chương trình phổ thông', () => {
    const { errors } = parseListing({ subjects: [SUBJECT], availability: [SLOT] }, true);
    assert.match(errors[0]?.message ?? '', /Thông tư 29/);
    assert.deepEqual(
      parseListing({ subjects: [{ ...SUBJECT, content_kind: 'enrichment' }], availability: [SLOT] }, true).errors,
      [],
    );
  });

  it('từ chối khối ngoài cấp, giá, thời lượng ngoài khoảng, khung giờ trùng hoặc quá ngắn', () => {
    assert.ok(parseListing({ subjects: [{ ...SUBJECT, grade_to: 10 }] }, false).errors.length > 0);
    assert.ok(parseListing({ subjects: [{ ...SUBJECT, price_per_session: -1 }] }, false).errors.length > 0);
    assert.ok(parseListing({ subjects: [{ ...SUBJECT, session_minutes: 20 }] }, false).errors.length > 0);
    assert.ok(
      parseListing({ availability: [{ ...SLOT, end_minute: SLOT.start_minute + 15 }] }, false).errors.length > 0,
    );
    const overlap = parseListing(
      { availability: [SLOT, { ...SLOT, start_minute: 19 * 60, end_minute: 21 * 60 }] },
      false,
    );
    assert.match(overlap.errors[0]?.message ?? '', /trùng/);
  });
});

describe('xác minh và điều kiện duyệt (CT-27g-1)', () => {
  it('lý lịch tư pháp quá hạn hiệu lực là hết hạn; ngày cấp phải trong 6 tháng', () => {
    const state = verificationState(
      [
        { kind: 'identity', status: 'approved', valid_until: null },
        { kind: 'criminal_record', status: 'approved', valid_until: '2026-01-01' },
      ],
      '2026-10-28',
    );
    assert.equal(state.identity, 'approved');
    assert.equal(state.criminal_record, 'expired');
    assert.equal(state.degree, 'none');
    assert.equal(criminalRecordIssueProblem('2026-09-01', '2026-10-28'), null);
    assert.match(criminalRecordIssueProblem('2026-01-01', '2026-10-28') ?? '', /6 tháng/);
    assert.match(criminalRecordIssueProblem('2026-11-01', '2026-10-28') ?? '', /tương lai/);
    assert.equal(addMonths('2026-10-28', 12), '2027-10-28');
  });

  it('gửi duyệt cần danh tính, môn, giờ trống, đăng ký kinh doanh khi có môn của chương trình', () => {
    const listing: ListingInput = parseListing({ subjects: [SUBJECT], availability: [SLOT] }, false).listing;
    const none = verificationState([], '2026-10-28');
    assert.equal(submitBlockers(listing, none).length, 2);
    const verified = verificationState([{ kind: 'identity', status: 'approved', valid_until: null }], '2026-10-28');
    assert.deepEqual(submitBlockers(listing, verified), [
      'Môn của chương trình phổ thông có thu tiền cần nộp đăng ký kinh doanh',
    ]);
    const all = verificationState(
      [
        { kind: 'identity', status: 'approved', valid_until: null },
        { kind: 'criminal_record', status: 'approved', valid_until: '2027-10-28' },
        { kind: 'business_registration', status: 'pending', valid_until: null },
      ],
      '2026-10-28',
    );
    assert.deepEqual(submitBlockers(listing, all), []);
    assert.deepEqual(approvalBlockers(listing, all), [
      'Có môn của chương trình phổ thông nhưng chưa duyệt đăng ký kinh doanh',
    ]);
  });
});
