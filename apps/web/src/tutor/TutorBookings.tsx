import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, FORM_CONTROL_CLASS, StatusBadge, type StatusTone } from '@cho-gia-su/ui';
import { errorText, marketRequest, RecordingPlayer, ReportForm } from '../client/index.js';
import { CARD_CLASS, money, when } from '../styles.js';
import { TeachingRoom } from './TeachingRoom.js';

// Buổi dạy và thu nhập của gia sư (DT-27 phần 27h, YCTD-258): buổi đã trả tiền, đánh dấu đã dạy sau giờ kết thúc, hủy (phụ huynh được
// hoàn đủ), trình bày khi có tranh chấp, khiếu nại lại quyết định; thu nhập đã giải ngân, đang chờ (sau hạn khiếu nại), hoa hồng của nền
// tảng. Thanh toán ở bản này là giả lập, không có tiền thật. Từ YCTD-361 (thiết kế duyệt ngày 2026-10-28) chia hai trang: Buổi dạy (thẻ
// từng buổi, chia nhóm) và Thu nhập (tóm tắt, bảng theo từng buổi)
const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  paid: { label: 'Đã trả tiền, chưa học', tone: 'success' },
  completed: { label: 'Đã dạy, chờ hết hạn khiếu nại', tone: 'info' },
  disputed: { label: 'Phụ huynh khiếu nại, tiền đang giữ', tone: 'danger' },
  disbursed: { label: 'Đã giải ngân', tone: 'neutral' },
  refunded: { label: 'Đã hoàn tiền cho phụ huynh', tone: 'neutral' },
  cancelled: { label: 'Đã hủy', tone: 'neutral' },
  expired: { label: 'Hết hạn giữ chỗ', tone: 'neutral' },
};
const GROUPS: Array<{ label: string; statuses: string[] }> = [
  { label: 'Sắp tới', statuses: ['paid'] },
  { label: 'Đã dạy, khiếu nại', statuses: ['completed', 'disputed'] },
  { label: 'Đã xong', statuses: ['disbursed', 'refunded', 'cancelled', 'expired'] },
];

export interface TutorBooking {
  id: string;
  child_name: string;
  subject: string;
  grade: number;
  starts_at: string;
  minutes: number;
  price: number;
  commission: number;
  status: string;
  released_amount: number | null;
  parent_id: string;
  recording_required: boolean;
}

export interface BookingsView {
  bookings: TutorBooking[];
  earnings: { released: number; pending: number; commission: number };
}

interface Dispute {
  status: string;
  reason: string;
  decision: string | null;
  decision_note: string | null;
  statements: Array<{ role: string; body: string; created_at: string }>;
}

export function useTutorBookings() {
  const [view, setView] = useState<BookingsView>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    marketRequest<BookingsView>('GET', '/tutor/bookings')
      .then((next) => {
        setError(undefined);
        setView(next);
      })
      .catch((caught: unknown) => setError(errorText(caught)));
  }, []);
  useEffect(load, [load]);
  return { view, error, setError, load };
}

function DisputeBox({ id, onChange }: { id: string; onChange: () => void }) {
  const [dispute, setDispute] = useState<Dispute>();
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    marketRequest<Dispute>('GET', `/tutor/bookings/${id}/dispute`)
      .then(setDispute)
      .catch(() => setDispute(undefined));
  }, [id]);
  useEffect(load, [load]);
  if (!dispute) return null;
  const send = (path: string, body: unknown) =>
    marketRequest('POST', path, body)
      .then(() => {
        setError(undefined);
        setText('');
        load();
        onChange();
      })
      .catch((caught: unknown) => setError(errorText(caught)));
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-danger/5 p-3" aria-label="Tranh chấp">
      <span>Phụ huynh khiếu nại: {dispute.reason}</span>
      {dispute.statements.map((item, index) => (
        <span key={index} className="text-label">
          {item.role === 'tutor' ? 'Bạn' : 'Phụ huynh'}: {item.body}
        </span>
      ))}
      {dispute.decision ? <span>Quyết định của nền tảng: {dispute.decision_note}</span> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {dispute.status === 'open' || dispute.status === 'appealed' ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-label font-medium">
            Trình bày của bạn
            <input className={FORM_CONTROL_CLASS} value={text} onChange={(event) => setText(event.target.value)} />
          </label>
          <Button onClick={() => void send(`/disputes/${id}/statements`, { body: text })}>Gửi trình bày</Button>
        </div>
      ) : null}
      {dispute.status === 'decided' ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-label font-medium">
            Lý do khiếu nại lại
            <input className={FORM_CONTROL_CLASS} value={text} onChange={(event) => setText(event.target.value)} />
          </label>
          <Button onClick={() => void send(`/disputes/${id}/appeal`, { reason: text })}>Khiếu nại lại</Button>
        </div>
      ) : null}
    </div>
  );
}

// Phòng học của buổi (27i): nút mở phòng dạy (TeachingRoom: điều kiện, lớp video, phòng chờ, điểm danh, xác nhận, YCTD-362), xem bản
// ghi, báo cáo phụ huynh
function SessionRoom({ booking, onOpen }: { booking: TutorBooking; onOpen: () => void }) {
  const [recording, setRecording] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  useEffect(() => {
    marketRequest<{ status: string | null }>('GET', `/tutor/bookings/${booking.id}/recording`)
      .then((result) => setRecording(result.status))
      .catch(() => undefined);
  }, [booking.id]);
  return (
    <div className="flex flex-col gap-2">
      {booking.recording_required ? (
        <span className="text-label text-text-secondary">Buổi học với trẻ dưới 18 tuổi: luôn ghi hình.</span>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {booking.status === 'paid' || booking.status === 'completed' ? (
          <Button variant={booking.status === 'paid' ? 'primary' : 'secondary'} onClick={onOpen}>
            {booking.status === 'paid' ? 'Mở phòng học' : 'Xem điểm danh buổi dạy'}
          </Button>
        ) : null}
        {booking.status !== 'expired' ? (
          <Button variant="text" className="text-danger" onClick={() => setReporting(true)}>
            Báo cáo phụ huynh
          </Button>
        ) : null}
      </div>
      {recording === 'ready' ? (
        <RecordingPlayer
          path={`/tutor/bookings/${booking.id}/recording/stream`}
          label={`Bản ghi buổi ${booking.subject}`}
        />
      ) : null}
      {reporting ? (
        <ReportForm subjectId={booking.parent_id} subjectName="phụ huynh" targetKind="session" targetId={booking.id} />
      ) : null}
    </div>
  );
}

function DateBlock({ value, active }: { value: string; active: boolean }) {
  const date = new Date(value);
  const day = date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' });
  const hour = date.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });
  return (
    <div
      aria-hidden="true"
      className={`flex size-20 shrink-0 flex-col items-center justify-center rounded-2xl ${
        active ? 'bg-brand text-white' : 'bg-page text-text-secondary'
      }`}
    >
      <span className="text-label">{day}</span>
      <strong className="text-section-title">{hour}</strong>
    </div>
  );
}

export function TutorBookings() {
  const { view, error, setError, load } = useTutorBookings();
  const [roomFor, setRoomFor] = useState<string>();
  const run = (work: Promise<unknown>) =>
    work
      .then(() => {
        setError(undefined);
        load();
      })
      .catch((caught: unknown) => setError(errorText(caught)));
  const bookings = view?.bookings ?? [];
  if (roomFor) {
    return (
      <TeachingRoom
        bookingId={roomFor}
        onClose={() => {
          setRoomFor(undefined);
          load();
        }}
      />
    );
  }
  return (
    <section aria-label="Buổi dạy" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-page-title font-bold">Buổi dạy</h2>
          <p className="text-text-secondary">
            Buổi với trẻ dưới 18 tuổi luôn ghi hình. Phòng mở trước giờ học theo cấu hình của chợ (mặc định 10 phút).
          </p>
        </div>
        <Button onClick={load}>Tải lại</Button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {view && bookings.length === 0 ? <p className="text-text-secondary">Chưa có buổi dạy nào.</p> : null}
      {GROUPS.map((group) => {
        const rows = bookings.filter((booking) => group.statuses.includes(booking.status));
        if (rows.length === 0) return null;
        return (
          <div key={group.label} className="flex flex-col gap-3">
            <h3 className="text-section-title font-semibold">{group.label}</h3>
            <ul className="flex flex-col gap-3">
              {rows.map((booking) => {
                const ended = new Date(booking.starts_at).getTime() + booking.minutes * 60_000 <= Date.now();
                const status = STATUS[booking.status];
                return (
                  <li
                    key={booking.id}
                    aria-label={`Buổi dạy ${booking.subject} ${when(booking.starts_at)}`}
                    className={`${CARD_CLASS} flex flex-col gap-3 p-5`}
                  >
                    <div className="flex flex-wrap items-center gap-4">
                      <DateBlock value={booking.starts_at} active={booking.status === 'paid' && !ended} />
                      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-section-title">
                            {booking.subject} – {booking.child_name} (lớp {booking.grade})
                          </strong>
                          <StatusBadge tone={status?.tone ?? 'neutral'} label={status?.label ?? booking.status} />
                        </div>
                        <span className="text-text-secondary">
                          {when(booking.starts_at)}, {booking.minutes} phút, {money(booking.price)} (hoa hồng{' '}
                          {money(booking.commission)})
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {booking.status === 'paid' && ended ? (
                          <Button
                            variant="primary"
                            onClick={() => void run(marketRequest('POST', `/tutor/bookings/${booking.id}/complete`))}
                          >
                            Đánh dấu đã dạy
                          </Button>
                        ) : null}
                        {booking.status === 'paid' && !ended ? (
                          <Button
                            onClick={() => void run(marketRequest('POST', `/tutor/bookings/${booking.id}/cancel`, {}))}
                          >
                            Hủy buổi
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {booking.status === 'disputed' ||
                    booking.status === 'disbursed' ||
                    booking.status === 'refunded' ? (
                      <DisputeBox id={booking.id} onChange={load} />
                    ) : null}
                    <SessionRoom booking={booking} onOpen={() => setRoomFor(booking.id)} />
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

// Thực nhận của một buổi: số đã giải ngân, hoặc học phí trừ hoa hồng khi còn chờ giải ngân
function netOf(booking: TutorBooking): number | null {
  if (booking.released_amount !== null) return booking.released_amount;
  if (booking.status === 'paid' || booking.status === 'completed' || booking.status === 'disputed') {
    return booking.price - booking.commission;
  }
  return null;
}

export function TutorEarnings() {
  const { view, error, load } = useTutorBookings();
  const rows = (view?.bookings ?? []).filter((booking) => booking.status !== 'expired');
  return (
    <section aria-label="Thu nhập" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-page-title font-bold">Thu nhập</h2>
          <p className="text-text-secondary">
            Tiền mỗi buổi được giữ đến hết hạn khiếu nại, rồi giải ngân sau khi trừ hoa hồng nền tảng.
          </p>
        </div>
        <Button onClick={load}>Tải lại</Button>
      </div>
      <p role="note" className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-warning">
        <strong>Giải ngân giả lập.</strong> Số liệu chạy theo luồng thật nhưng chưa có tiền thật nào được chuyển vào tài
        khoản của bạn.
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {view ? (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className={`${CARD_CLASS} flex flex-col gap-1 p-5`}>
            <dt className="text-label text-text-secondary">Đã giải ngân</dt>
            <dd className="text-page-title font-semibold text-success">{money(view.earnings.released)}</dd>
          </div>
          <div className={`${CARD_CLASS} flex flex-col gap-1 p-5`}>
            <dt className="text-label text-text-secondary">Đang chờ, sau hạn khiếu nại</dt>
            <dd className="text-page-title font-semibold">{money(view.earnings.pending)}</dd>
          </div>
          <div className={`${CARD_CLASS} flex flex-col gap-1 p-5`}>
            <dt className="text-label text-text-secondary">Hoa hồng nền tảng đã thu</dt>
            <dd className="text-page-title font-semibold">{money(view.earnings.commission)}</dd>
          </div>
        </dl>
      ) : null}
      <div className={`${CARD_CLASS} overflow-x-auto p-4`}>
        <table aria-label="Thu nhập theo từng buổi" className="w-full min-w-[44rem] text-label">
          <thead>
            <tr className="border-b border-border text-left text-text-secondary">
              <th className="py-2 pr-2 font-semibold">Buổi</th>
              <th className="py-2 pr-2 font-semibold">Học phí</th>
              <th className="py-2 pr-2 font-semibold">Hoa hồng</th>
              <th className="py-2 pr-2 font-semibold">Thực nhận</th>
              <th className="py-2 font-semibold">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-3 text-text-secondary">
                  Chưa có buổi nào.
                </td>
              </tr>
            ) : null}
            {rows.map((booking) => {
              const net = netOf(booking);
              const status = STATUS[booking.status];
              return (
                <tr key={booking.id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-2">
                    <div className="font-medium">
                      {booking.subject} – {booking.child_name}
                    </div>
                    <div className="text-text-secondary">{when(booking.starts_at)}</div>
                  </td>
                  <td className="py-2 pr-2">{money(booking.price)}</td>
                  <td className="py-2 pr-2">{money(booking.commission)}</td>
                  <td className="py-2 pr-2 font-semibold">
                    {net === null ? '—' : money(net)}
                    {net !== null && booking.released_amount === null ? (
                      <span className="block font-normal text-text-secondary">dự kiến</span>
                    ) : null}
                  </td>
                  <td className="py-2">
                    <StatusBadge tone={status?.tone ?? 'neutral'} label={status?.label ?? booking.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
