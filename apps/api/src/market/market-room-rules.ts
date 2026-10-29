import type { MarketRoomTimings } from '@cho-gia-su/database';

// Quy tắc thuần của phòng học video ở chợ gia sư (DT-27 phần 27j, YCTD-362; GD-164, quyết định của Eric ngày 2026-10-29). Mốc là cấu hình
// chợ ở cổng vận hành (`MarketRoomTimings`): mở phòng trước giờ học, vào muộn tính vắng, gia sư vắng, tỉ lệ có mặt để đủ buổi, tự xác
// nhận buổi
const MINUTE = 60_000;

export type AttendanceResult = 'full' | 'partial' | 'late_absent' | 'absent';

export interface AttendanceInterval {
  joined_at: Date;
  left_at: Date | null;
}

export function roomOpensAt(startsAt: Date, room: MarketRoomTimings): Date {
  return new Date(startsAt.getTime() - room.opensBeforeMinutes * MINUTE);
}

export function sessionEndsAt(startsAt: Date, minutes: number): Date {
  return new Date(startsAt.getTime() + minutes * MINUTE);
}

// Phòng vào được từ lúc mở (trước giờ học) đến hết giờ học
export function roomWindowOpen(startsAt: Date, minutes: number, now: Date, room: MarketRoomTimings): boolean {
  const time = now.getTime();
  return time >= roomOpensAt(startsAt, room).getTime() && time <= sessionEndsAt(startsAt, minutes).getTime();
}

// Điểm danh của một người: cộng các khoảng có mặt trong giờ học (bỏ phần trước giờ học, sau giờ kết thúc, phần trùng khi vào lại); khoảng
// chưa ra tính đến `until` (lúc đóng phòng hoặc bây giờ). Vào lần đầu muộn quá mốc thì tính vắng dù sau đó có mặt
export function attendanceOf(
  intervals: AttendanceInterval[],
  startsAt: Date,
  minutes: number,
  until: Date,
  room: MarketRoomTimings,
): { presentMinutes: number; firstJoin: Date | null; result: AttendanceResult } {
  const start = startsAt.getTime();
  const end = Math.min(sessionEndsAt(startsAt, minutes).getTime(), Math.max(until.getTime(), start));
  const clipped = intervals
    .map((row) => [Math.max(row.joined_at.getTime(), start), Math.min((row.left_at ?? until).getTime(), end)])
    .filter(([from, to]) => (to ?? 0) > (from ?? 0))
    .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0)) as Array<[number, number]>;
  let total = 0;
  let cursor = start;
  for (const [from, to] of clipped) {
    const begin = Math.max(from, cursor);
    if (to > begin) {
      total += to - begin;
      cursor = to;
    }
  }
  const firstJoin =
    intervals.length === 0 ? null : new Date(Math.min(...intervals.map((row) => row.joined_at.getTime())));
  const presentMinutes = Math.round(total / MINUTE);
  if (!firstJoin || total === 0) return { presentMinutes, firstJoin, result: 'absent' };
  if (firstJoin.getTime() > start + room.lateAbsentMinutes * MINUTE) {
    return { presentMinutes, firstJoin, result: 'late_absent' };
  }
  const full = total >= (minutes * MINUTE * room.fullAttendancePercent) / 100;
  return { presentMinutes, firstJoin, result: full ? 'full' : 'partial' };
}

// Phụ huynh báo gia sư vắng: gia sư chưa vào phòng lần nào, đã quá mốc sau giờ học, buổi chưa kết thúc
export function tutorNoShowAllowed(
  startsAt: Date,
  minutes: number,
  now: Date,
  tutorJoined: boolean,
  room: MarketRoomTimings,
): boolean {
  const time = now.getTime();
  return (
    !tutorJoined &&
    time >= startsAt.getTime() + room.tutorNoShowMinutes * MINUTE &&
    time <= sessionEndsAt(startsAt, minutes).getTime()
  );
}

// Gia sư không xác nhận đã dạy: hệ thống tự xác nhận sau mốc tính từ giờ kết thúc buổi
export function autoConfirmDue(startsAt: Date, minutes: number, now: Date, room: MarketRoomTimings): boolean {
  return now.getTime() >= sessionEndsAt(startsAt, minutes).getTime() + room.autoConfirmHours * 3_600_000;
}

// Định danh trong phòng video: vai và tài khoản; phụ huynh vào hộ con là `student`, vào xem là `guardian`
export function roomIdentity(role: 'host' | 'student' | 'guardian', accountId: string): string {
  return `${role}:${accountId}`;
}

export function parseRoomIdentity(
  identity: string,
): { role: 'host' | 'student' | 'guardian'; accountId: string } | null {
  const [role, accountId] = identity.split(':');
  if ((role === 'host' || role === 'student' || role === 'guardian') && accountId) return { role, accountId };
  return null;
}

// Con từ đủ 7 tuổi cùng xác nhận đồng ý ghi hình (Luật 91/2025 Điều 24, GD-164; cần luật sư xem lại trước khi mở thật). Chợ chỉ có năm
// sinh nên tính theo năm, nghiêng về hỏi con
export function childMustConfirm(birthYear: number, now: Date): boolean {
  const year = Number(new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 4));
  return year - birthYear >= 7;
}
