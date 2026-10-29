import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  effectiveSeverity,
  filterMessage,
  isMinor,
  recordingDeletable,
  recordingRetainUntil,
  reportDueAt,
  roomOpen,
  suspendsImmediately,
} from './market-safety-rules.js';

// Quy tắc thuần của an toàn trẻ em ở chợ gia sư (DT-27 phần 27i, YCTD-259), CT-27i-1
describe('quy tắc an toàn trẻ em ở chợ (27i)', () => {
  const now = new Date('2026-10-28T03:00:00Z');

  it('CT-27i-1: hạn xử lý theo mức, an toàn trẻ em không thấp hơn mức cao, nghiêm trọng thì tạm khóa ngay', () => {
    assert.equal(reportDueAt('critical', now).toISOString(), '2026-10-28T07:00:00.000Z');
    assert.equal(reportDueAt('high', now).toISOString(), '2026-10-29T03:00:00.000Z');
    assert.equal(reportDueAt('medium', now).toISOString(), '2026-10-31T03:00:00.000Z');
    assert.equal(reportDueAt('low', now).toISOString(), '2026-11-04T03:00:00.000Z');
    assert.equal(effectiveSeverity('child_safety', 'low'), 'high');
    assert.equal(effectiveSeverity('child_safety', 'critical'), 'critical');
    assert.equal(effectiveSeverity('fraud', 'low'), 'low');
    assert.equal(suspendsImmediately('critical'), true);
    assert.equal(suspendsImmediately('high'), false);
  });

  it('CT-27i-1: trẻ vị thành niên theo năm sinh (giờ Việt Nam), tính cả năm tròn 18', () => {
    assert.equal(isMinor(2014, now), true);
    assert.equal(isMinor(2008, now), true, 'sinh năm 2008 có thể chưa đủ 18 tuổi');
    assert.equal(isMinor(2007, now), false);
    // 31/12 lúc 18 giờ giờ quốc tế đã là năm mới ở Việt Nam
    assert.equal(isMinor(2008, new Date('2026-12-31T18:00:00Z')), false);
  });

  it('CT-27i-1: bản ghi giữ 30 ngày, giữ tiếp khi có bằng chứng đang mở; phòng mở từ 15 phút trước giờ học', () => {
    const until = recordingRetainUntil(now);
    assert.equal(until.toISOString(), '2026-11-27T03:00:00.000Z');
    assert.equal(recordingDeletable({ retainUntil: until, now, evidenceHold: false }), false);
    const later = new Date(until.getTime() + 1);
    assert.equal(recordingDeletable({ retainUntil: until, now: later, evidenceHold: false }), true);
    assert.equal(recordingDeletable({ retainUntil: until, now: later, evidenceHold: true }), false);
    const start = new Date('2026-10-28T11:00:00Z');
    assert.equal(roomOpen(start, 60, new Date('2026-10-28T10:44:00Z')), false);
    assert.equal(roomOpen(start, 60, new Date('2026-10-28T10:45:00Z')), true);
    assert.equal(roomOpen(start, 60, new Date('2026-10-28T12:00:00Z')), true);
    assert.equal(roomOpen(start, 60, new Date('2026-10-28T12:00:01Z')), false);
  });

  it('CT-27i-1: tin nhắn có số điện thoại, Zalo, thư điện tử bị che và có cảnh báo; tin bình thường giữ nguyên', () => {
    const plain = filterMessage('Con học tốt phần phân số rồi ạ');
    assert.equal(plain.original, null);
    assert.equal(plain.warning, null);
    const masked = filterMessage('Gọi em 0912 345 678 hoặc zalo minh.gs, mail gs@example.com nhé');
    assert.equal(masked.original, 'Gọi em 0912 345 678 hoặc zalo minh.gs, mail gs@example.com nhé');
    assert.doesNotMatch(masked.body, /0912|minh\.gs|example\.com/);
    assert.deepEqual(new Set(masked.findings.map((finding) => finding.kind)), new Set(['phone', 'social', 'email']));
    assert.match(masked.warning ?? '', /ngoài chợ/);
  });
});
