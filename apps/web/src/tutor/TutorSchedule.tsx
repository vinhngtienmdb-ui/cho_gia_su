import { useState } from 'react';
import { Alert, Button } from '@cho-gia-su/ui';
import { useTutorBookings } from './TutorBookings.js';
import { CARD_CLASS } from '../styles.js';
import { minutesText, WEEKDAYS, type Listing } from './tutor-api.js';

// Lịch dạy dạng tuần (YCTD-361, thiết kế duyệt ngày 2026-10-28; trước đây buổi dạy chỉ là danh sách): bảy cột theo thứ, mỗi cột có giờ
// trống hằng tuần trong hồ sơ dạy và các buổi đã đặt của tuần đang xem (giờ Việt Nam). Sửa giờ trống ở trang Hồ sơ và môn dạy
const DAY_MS = 24 * 3_600_000;
const VIETNAM_OFFSET_MS = 7 * 3_600_000;

// Thứ Hai của tuần chứa thời điểm, tính theo giờ Việt Nam; trả mốc 00:00 giờ Việt Nam dưới dạng thời điểm UTC
function mondayOf(time: number): number {
  const local = new Date(time + VIETNAM_OFFSET_MS);
  const weekday = (local.getUTCDay() + 6) % 7;
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return midnight - weekday * DAY_MS - VIETNAM_OFFSET_MS;
}

const dayLabel = (time: number) =>
  new Date(time).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' });
const hourLabel = (value: string) =>
  new Date(value).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });

export function TutorSchedule({ listing, onEditAvailability }: { listing: Listing; onEditAvailability: () => void }) {
  const { view, error } = useTutorBookings();
  const [monday, setMonday] = useState(() => mondayOf(Date.now()));
  const bookings = (view?.bookings ?? []).filter(
    (booking) => booking.status !== 'cancelled' && booking.status !== 'expired',
  );
  return (
    <section aria-label="Lịch dạy" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-page-title font-bold">Lịch</h2>
          <p className="text-text-secondary">
            Giờ trống phụ huynh thấy và đặt được, cùng các buổi đã đặt. Giờ Việt Nam.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button aria-label="Tuần trước" onClick={() => setMonday(monday - 7 * DAY_MS)}>
            ‹
          </Button>
          <strong className="px-1">
            Tuần {dayLabel(monday)} – {dayLabel(monday + 6 * DAY_MS)}
          </strong>
          <Button aria-label="Tuần sau" onClick={() => setMonday(monday + 7 * DAY_MS)}>
            ›
          </Button>
          <Button onClick={() => setMonday(mondayOf(Date.now()))}>Tuần này</Button>
        </div>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className={`${CARD_CLASS} overflow-x-auto p-4`}>
        <ol className="grid min-w-[52rem] grid-cols-7 gap-2">
          {WEEKDAYS.slice(1).map((label, index) => {
            const start = monday + index * DAY_MS;
            const slots = listing.availability.filter((slot) => slot.weekday === index + 1);
            const booked = bookings.filter((booking) => {
              const time = new Date(booking.starts_at).getTime();
              return time >= start && time < start + DAY_MS;
            });
            return (
              <li key={label} aria-label={`${label} ${dayLabel(start)}`} className="flex flex-col gap-1.5">
                <strong className="text-center text-label">
                  {label}
                  <span className="block font-normal text-text-secondary">{dayLabel(start)}</span>
                </strong>
                {slots.map((slot) => (
                  <span
                    key={`trong-${slot.start_minute}`}
                    className="rounded-lg border border-dashed border-success/50 bg-success/10 px-2 py-1 text-label text-success"
                  >
                    Trống {minutesText(slot.start_minute)}–{minutesText(slot.end_minute)}
                  </span>
                ))}
                {booked.map((booking) => (
                  <span key={booking.id} className="rounded-lg bg-brand px-2 py-1 text-label text-white">
                    <strong>{hourLabel(booking.starts_at)}</strong> {booking.subject}
                    <span className="block">{booking.child_name}</span>
                  </span>
                ))}
                {slots.length === 0 && booked.length === 0 ? (
                  <span className="rounded-lg bg-page px-2 py-1 text-center text-label text-text-muted">
                    Không nhận
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onEditAvailability}>Sửa giờ trống</Button>
        <span className="text-label text-text-secondary">
          Giờ trống lưu cùng hồ sơ dạy; sửa hồ sơ đã duyệt thì hồ sơ về chờ duyệt.
        </span>
      </div>
    </section>
  );
}
