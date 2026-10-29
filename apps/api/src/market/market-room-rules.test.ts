import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_ROOM_TIMINGS } from '@cho-gia-su/database';
import {
  attendanceOf,
  autoConfirmDue,
  childMustConfirm,
  parseRoomIdentity,
  roomIdentity,
  roomWindowOpen,
  tutorNoShowAllowed,
} from './market-room-rules.js';

// Quy tắc thuần của phòng học video ở chợ (DT-27 phần 27j, YCTD-362, CT-27j-1): mốc mặc định 10, 15, 10 phút, 80%, 24 giờ (GD-164)
const MINUTE = 60_000;
const START = new Date('2026-11-02T12:00:00.000Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * MINUTE);
const room = DEFAULT_ROOM_TIMINGS;

describe('phòng học video của chợ (CT-27j-1)', () => {
  it('phòng mở từ 10 phút trước giờ học đến hết giờ', () => {
    assert.equal(roomWindowOpen(START, 60, at(-11), room), false);
    assert.equal(roomWindowOpen(START, 60, at(-10), room), true);
    assert.equal(roomWindowOpen(START, 60, at(60), room), true);
    assert.equal(roomWindowOpen(START, 60, at(61), room), false);
  });

  it('điểm danh: cộng khoảng trong giờ học, bỏ phần trùng; 80% là đủ buổi', () => {
    const full = attendanceOf(
      [
        { joined_at: at(-5), left_at: at(30) },
        { joined_at: at(25), left_at: at(50) },
      ],
      START,
      60,
      at(60),
      room,
    );
    assert.equal(full.presentMinutes, 50);
    assert.equal(full.result, 'full');
    const partial = attendanceOf([{ joined_at: at(0), left_at: at(40) }], START, 60, at(60), room);
    assert.equal(partial.result, 'partial');
  });

  it('vào lần đầu muộn quá 15 phút thì tính vắng; không vào thì vắng; chưa ra thì tính đến lúc đóng phòng', () => {
    assert.equal(attendanceOf([{ joined_at: at(16), left_at: null }], START, 60, at(60), room).result, 'late_absent');
    assert.equal(attendanceOf([], START, 60, at(60), room).result, 'absent');
    assert.equal(attendanceOf([{ joined_at: at(0), left_at: null }], START, 60, at(30), room).presentMinutes, 30);
  });

  it('phụ huynh báo gia sư vắng sau 10 phút khi gia sư chưa vào; gia sư đã vào thì không', () => {
    assert.equal(tutorNoShowAllowed(START, 60, at(9), false, room), false);
    assert.equal(tutorNoShowAllowed(START, 60, at(10), false, room), true);
    assert.equal(tutorNoShowAllowed(START, 60, at(10), true, room), false);
    assert.equal(tutorNoShowAllowed(START, 60, at(61), false, room), false);
  });

  it('tự xác nhận buổi sau 24 giờ kể từ giờ kết thúc', () => {
    assert.equal(autoConfirmDue(START, 60, at(60 + 24 * 60 - 1), room), false);
    assert.equal(autoConfirmDue(START, 60, at(60 + 24 * 60), room), true);
  });

  it('định danh trong phòng và con từ đủ 7 tuổi cùng xác nhận', () => {
    assert.deepEqual(parseRoomIdentity(roomIdentity('guardian', 'abc')), { role: 'guardian', accountId: 'abc' });
    assert.equal(parseRoomIdentity('khac:abc'), null);
    assert.equal(childMustConfirm(2019, START), true);
    assert.equal(childMustConfirm(2020, START), false);
  });
});
