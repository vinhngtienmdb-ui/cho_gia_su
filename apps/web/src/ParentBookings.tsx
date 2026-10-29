import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, FORM_CONTROL_CLASS, StatusBadge, type StatusTone } from '@cho-gia-su/ui';
import { errorText, marketRequest, readSession, RecordingPlayer, ReportForm, type Child } from './client/index.js';
import { PackagesPanel } from './Packages.js';
import { ReviewPanel } from './ReviewForm.js';
import { SessionRoom } from './SessionRoom.js';
import { CARD_CLASS, money, when } from './styles.js';

// Đặt buổi và buổi học của con ở Chợ gia sư (DT-27 phần 27h, YCTD-258): chọn con, môn, giờ (giờ Việt Nam), trả tiền qua nhà cung cấp
// (bản này là thanh toán giả lập, không có tiền thật), hủy theo chính sách hủy, mở tranh chấp trong hạn khiếu nại, trình bày, khiếu nại lại.
// Bố cục theo bản thiết kế duyệt ngày 2026-10-28 (YCTD-360): thẻ đặt buổi có tóm tắt giá và hạn giữ chỗ; buổi học chia nhóm sắp tới, cần
// xử lý, đã xong; khung thanh toán giả lập ghi rõ không có tiền thật
const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  held: { label: 'Đang giữ chỗ, chờ trả tiền', tone: 'warning' },
  paid: { label: 'Đã trả tiền', tone: 'success' },
  completed: { label: 'Gia sư đã dạy, trong hạn khiếu nại', tone: 'info' },
  disputed: { label: 'Đang tranh chấp', tone: 'danger' },
  disbursed: { label: 'Đã hoàn tất', tone: 'neutral' },
  refunded: { label: 'Đã hoàn tiền', tone: 'neutral' },
  cancelled: { label: 'Đã hủy', tone: 'neutral' },
  expired: { label: 'Hết hạn giữ chỗ', tone: 'neutral' },
};
const DECISION_LABELS: Record<string, string> = {
  refund_full: 'hoàn đủ',
  refund_partial: 'hoàn một phần',
  release: 'giải ngân cho gia sư',
};
const GROUPS: Array<{ label: string; statuses: string[] }> = [
  { label: 'Sắp tới', statuses: ['held', 'paid'] },
  { label: 'Cần bạn xem', statuses: ['completed', 'disputed'] },
  { label: 'Đã xong', statuses: ['disbursed', 'refunded', 'cancelled', 'expired'] },
];

export interface BookableSubject {
  id: string;
  subject: string;
  school_level: string;
  grade_from: number;
  grade_to: number;
  content_kind: string;
  price_per_session: number;
  session_minutes: number;
  // Gói buổi (YCTD-365): trống là gia sư không bán gói cho môn này
  package_sessions?: number | null;
  package_price?: number | null;
}

interface Booking {
  id: string;
  tutor_id: string;
  tutor_name: string;
  child_name: string;
  subject: string;
  starts_at: string;
  minutes: number;
  price: number;
  status: string;
  // Buổi đặt từ gói (YCTD-365)
  package_id?: string | null;
  refunded_amount: number | null;
  dispute_status: string | null;
  decision: string | null;
  final_decision: string | null;
  decision_note: string | null;
  final_note: string | null;
}

// Ô ngày giờ của trình duyệt không có múi giờ: hiểu là giờ Việt Nam (UTC+7)
export function vietnamInputToIso(value: string): string {
  return new Date(`${value}:00+07:00`).toISOString();
}

export function BookingForm({
  tutorId,
  tutorName,
  subjects,
  schoolTeacher,
  onBooked,
}: {
  tutorId: string;
  tutorName: string;
  subjects: BookableSubject[];
  schoolTeacher: boolean;
  onBooked?: () => void;
}) {
  const [children, setChildren] = useState<Child[]>([]);
  const [form, setForm] = useState({
    child_id: '',
    subject_id: subjects[0]?.id ?? '',
    starts_at: '',
    attest: false,
    recording: false,
  });
  const [booked, setBooked] = useState<Booking>();
  const [mode, setMode] = useState<'single' | 'package'>('single');
  const [packageBought, setPackageBought] = useState<{ sessions_total: number; price_total: number }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!readSession()) return;
    marketRequest<{ children: Child[] }>('GET', '/children')
      .then((view) => {
        setChildren(view.children);
        setForm((current) => ({ ...current, child_id: view.children[0]?.id ?? '' }));
      })
      .catch(() => setChildren([]));
  }, []);
  const shell = `${CARD_CLASS} flex flex-col gap-3 p-5`;
  if (!readSession()) {
    return (
      <section aria-label="Đặt buổi học" className={shell}>
        <h3 className="text-section-title font-semibold">Đặt buổi học</h3>
        <p className="text-text-secondary">Đăng nhập tài khoản phụ huynh để đặt buổi.</p>
      </section>
    );
  }
  if (children.length === 0) {
    return (
      <section aria-label="Đặt buổi học" className={shell}>
        <h3 className="text-section-title font-semibold">Đặt buổi học</h3>
        <p className="text-text-secondary">Thêm hồ sơ con trước khi đặt buổi.</p>
      </section>
    );
  }
  const subject = subjects.find((item) => item.id === form.subject_id);
  const needsAttest = schoolTeacher && subject?.content_kind === 'curriculum';
  const hasPackage = Boolean(subject?.package_sessions && subject.package_price);
  const buyingPackage = hasPackage && mode === 'package';
  return (
    <form
      aria-label={`Đặt buổi với ${tutorName}`}
      className={shell}
      onSubmit={(event) => {
        event.preventDefault();
        if (buyingPackage) {
          marketRequest<{ sessions_total: number; price_total: number }>('POST', '/packages', {
            tutor_id: tutorId,
            child_id: form.child_id,
            subject_id: form.subject_id,
            no_assignment_attested: form.attest,
            recording_consented: form.recording,
          })
            .then((result) => {
              setError(undefined);
              setPackageBought(result);
            })
            .catch((caught: unknown) => setError(errorText(caught)));
          return;
        }
        marketRequest<Booking>('POST', '/bookings', {
          tutor_id: tutorId,
          child_id: form.child_id,
          subject_id: form.subject_id,
          starts_at: form.starts_at ? vietnamInputToIso(form.starts_at) : '',
          no_assignment_attested: form.attest,
          recording_consented: form.recording,
        })
          .then((result) => {
            setError(undefined);
            setBooked(result);
          })
          .catch((caught: unknown) => setError(errorText(caught)));
      }}
    >
      <h3 className="text-section-title font-semibold">Đặt buổi học</h3>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {packageBought ? (
        <div className="flex flex-col gap-2">
          <Alert tone="success">
            Đã giữ chỗ gói {packageBought.sessions_total} buổi, {money(packageBought.price_total)}. Trả tiền giả lập ở
            mục Buổi học của con trong 30 phút, rồi đặt từng buổi từ gói.
          </Alert>
          {onBooked ? (
            <Button variant="primary" onClick={onBooked}>
              Sang thanh toán giả lập
            </Button>
          ) : null}
        </div>
      ) : null}
      {booked ? (
        <div className="flex flex-col gap-2">
          <Alert tone="success">
            Đã giữ chỗ buổi {booked.subject} lúc {when(booked.starts_at)}, {money(booked.price)}. Trả tiền ở mục Buổi
            học của con trong 30 phút.
          </Alert>
          {onBooked ? (
            <Button variant="primary" onClick={onBooked}>
              Sang thanh toán giả lập
            </Button>
          ) : null}
        </div>
      ) : null}
      <label className="flex flex-col gap-1 text-label font-medium">
        Con
        <select
          className={FORM_CONTROL_CLASS}
          value={form.child_id}
          onChange={(event) => setForm({ ...form, child_id: event.target.value })}
        >
          {children.map((child) => (
            <option key={child.id} value={child.id}>
              {child.display_name} (lớp {child.grade})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-label font-medium">
        Môn
        <select
          className={FORM_CONTROL_CLASS}
          value={form.subject_id}
          onChange={(event) => setForm({ ...form, subject_id: event.target.value })}
        >
          {subjects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.subject} – {money(item.price_per_session)}/{item.session_minutes} phút
            </option>
          ))}
        </select>
      </label>
      {hasPackage && subject ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-label font-semibold">Đặt theo</legend>
          <label
            className={`flex items-center gap-2 rounded-xl border p-3 ${mode === 'single' ? 'border-2 border-brand' : 'border-border'}`}
          >
            <input type="radio" name="dat-theo" checked={mode === 'single'} onChange={() => setMode('single')} />
            <span className="flex-1">Buổi lẻ</span>
            <strong>{money(subject.price_per_session)}</strong>
          </label>
          <label
            className={`flex items-center gap-2 rounded-xl border p-3 ${mode === 'package' ? 'border-2 border-brand' : 'border-border'}`}
          >
            <input type="radio" name="dat-theo" checked={mode === 'package'} onChange={() => setMode('package')} />
            <span className="flex-1">Gói {subject.package_sessions} buổi</span>
            <strong>{money(subject.package_price ?? 0)}</strong>
          </label>
        </fieldset>
      ) : null}
      {buyingPackage ? (
        <p className="text-label text-text-secondary">
          Gói dùng trong thời hạn của chợ (mặc định 8 tuần) kể từ lúc trả tiền. Hết hạn thì hoàn phần buổi chưa học; hủy
          gói trước buổi đầu thì hoàn đủ. Trả tiền xong thì đặt từng buổi ở mục Buổi học của con.
        </p>
      ) : (
        <label className="flex flex-col gap-1 text-label font-medium">
          Giờ học (giờ Việt Nam)
          <input
            className={FORM_CONTROL_CLASS}
            type="datetime-local"
            value={form.starts_at}
            onChange={(event) => setForm({ ...form, starts_at: event.target.value })}
          />
        </label>
      )}
      {needsAttest ? (
        <label className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-label">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.attest}
            onChange={(event) => setForm({ ...form, attest: event.target.checked })}
          />
          <span>Tôi cam kết con không học lớp do gia sư này được phân công dạy ở trường</span>
        </label>
      ) : null}
      <label className="flex items-start gap-2 text-label">
        <input
          type="checkbox"
          className="mt-1"
          checked={form.recording}
          onChange={(event) => setForm({ ...form, recording: event.target.checked })}
        />
        <span>
          Tôi đồng ý buổi học được ghi hình (bắt buộc với trẻ dưới 18 tuổi; bản ghi giữ 30 ngày, chỉ phụ huynh, gia sư
          của buổi và nhân viên nền tảng xem được, không tải xuống)
        </span>
      </label>
      {subject ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-border pt-3 text-label">
          <dt className="text-text-secondary">Học phí buổi</dt>
          <dd>{money(subject.price_per_session)}</dd>
          <dt className="text-text-secondary">Thời lượng</dt>
          <dd>{subject.session_minutes} phút</dd>
        </dl>
      ) : null}
      <p className="rounded-lg bg-warning/10 p-3 text-label text-warning">
        Giữ chỗ 30 phút. Chưa trả trong thời gian này thì chỗ được nhả.
      </p>
      <Button type="submit" variant="primary">
        {buyingPackage ? 'Giữ chỗ gói buổi' : 'Giữ chỗ buổi học'}
      </Button>
    </form>
  );
}

// Khung thanh toán giả lập của một buổi đang giữ chỗ: nói rõ không có tiền thật, mã QR chỉ là chỗ đặt, nút giả lập trả thành công
function MockPayment({ booking, onPaid, onClose }: { booking: Booking; onPaid: () => void; onClose: () => void }) {
  const [error, setError] = useState<string>();
  return (
    <section
      aria-label={`Thanh toán giả lập buổi ${booking.subject}`}
      className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4"
    >
      <div role="note" className="flex flex-col gap-1 text-warning">
        <strong>Đây là thanh toán giả lập</strong>
        <span className="text-label">
          Chợ gia sư chưa thu tiền thật. Không có tiền nào rời tài khoản của bạn; khung này chỉ để chạy thử luồng đặt
          buổi.
        </span>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-4">
        <div
          role="img"
          aria-label="Chỗ đặt mã QR giả lập"
          className="flex size-32 items-center justify-center rounded-xl border-2 border-dashed border-border-strong bg-card text-center text-label text-text-secondary"
        >
          Mã QR giả lập
          <br />
          không quét được
        </div>
        <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-label">
          <dt className="text-text-secondary">Số tiền</dt>
          <dd className="font-semibold">{money(booking.price)}</dd>
          <dt className="text-text-secondary">Người nhận</dt>
          <dd>Bộ giả lập của chợ (không phải tài khoản thật)</dd>
        </dl>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() =>
            void marketRequest('POST', `/bookings/${booking.id}/mock-pay`)
              .then(onPaid)
              .catch((caught: unknown) => setError(errorText(caught)))
          }
        >
          Giả lập: đã trả thành công
        </Button>
        <Button onClick={onClose}>Để sau</Button>
      </div>
      <p className="text-label text-text-secondary">
        Tiền được giữ đến hết hạn khiếu nại sau buổi học, rồi mới giải ngân cho gia sư.
      </p>
    </section>
  );
}

function DisputePanel({ booking, onChange }: { booking: Booking; onChange: () => void }) {
  const [reason, setReason] = useState('');
  const [statement, setStatement] = useState('');
  const [error, setError] = useState<string>();
  const run = (work: Promise<unknown>) =>
    work
      .then(() => {
        setError(undefined);
        setReason('');
        setStatement('');
        onChange();
      })
      .catch((caught: unknown) => setError(errorText(caught)));
  return (
    <div className="flex flex-col gap-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {(booking.status === 'paid' || booking.status === 'completed') &&
      new Date(booking.starts_at).getTime() <= Date.now() ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-label font-medium">
            Lý do khiếu nại
            <input className={FORM_CONTROL_CLASS} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <Button onClick={() => void run(marketRequest('POST', `/bookings/${booking.id}/dispute`, { reason }))}>
            Mở tranh chấp
          </Button>
        </div>
      ) : null}
      {booking.dispute_status === 'open' || booking.dispute_status === 'appealed' ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-label font-medium">
            Trình bày thêm
            <input
              className={FORM_CONTROL_CLASS}
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
            />
          </label>
          <Button
            onClick={() => void run(marketRequest('POST', `/disputes/${booking.id}/statements`, { body: statement }))}
          >
            Gửi trình bày
          </Button>
        </div>
      ) : null}
      {booking.dispute_status === 'decided' ? (
        <div className="flex flex-wrap items-end gap-2">
          <span>
            Quyết định: {DECISION_LABELS[booking.decision ?? ''] ?? booking.decision} – {booking.decision_note}
          </span>
          <label className="flex flex-col gap-1 text-label font-medium">
            Lý do khiếu nại lại
            <input className={FORM_CONTROL_CLASS} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <Button onClick={() => void run(marketRequest('POST', `/disputes/${booking.id}/appeal`, { reason }))}>
            Khiếu nại lại
          </Button>
        </div>
      ) : null}
      {booking.dispute_status === 'final' ? (
        <span>
          Quyết định cuối: {DECISION_LABELS[booking.final_decision ?? booking.decision ?? ''] ?? ''} –{' '}
          {booking.final_note ?? booking.decision_note}
        </span>
      ) : null}
    </div>
  );
}

// Phòng học, bản ghi, báo cáo vi phạm của một buổi (27i): nút vào phòng mở trang phòng học video (SessionRoom, YCTD-362)
function SessionPanel({ booking, onEnter }: { booking: Booking; onEnter: () => void }) {
  const [recording, setRecording] = useState<{ recording_required: boolean; status: string | null }>();
  const [reporting, setReporting] = useState(false);
  useEffect(() => {
    if (booking.status === 'held' || booking.status === 'expired') return;
    marketRequest<{ recording_required: boolean; status: string | null }>('GET', `/bookings/${booking.id}/recording`)
      .then(setRecording)
      .catch(() => setRecording(undefined));
  }, [booking.id, booking.status]);
  return (
    <div className="flex flex-col gap-2">
      {recording?.recording_required ? (
        <span className="text-label text-text-secondary">Buổi học được ghi hình để bảo vệ trẻ.</span>
      ) : null}
      {booking.status === 'paid' || booking.status === 'completed' ? (
        <div>
          <Button variant={booking.status === 'paid' ? 'primary' : 'secondary'} onClick={onEnter}>
            {booking.status === 'paid' ? 'Vào phòng học' : 'Xem điểm danh buổi học'}
          </Button>
        </div>
      ) : null}
      {recording?.status === 'ready' ? (
        <RecordingPlayer path={`/bookings/${booking.id}/recording/stream`} label={`Bản ghi buổi ${booking.subject}`} />
      ) : null}
      {booking.status !== 'held' && booking.status !== 'expired' ? (
        reporting ? (
          <ReportForm
            subjectId={booking.tutor_id}
            subjectName={booking.tutor_name}
            targetKind="session"
            targetId={booking.id}
          />
        ) : (
          <div>
            <Button variant="text" className="text-danger" onClick={() => setReporting(true)}>
              Báo cáo vi phạm
            </Button>
          </div>
        )
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

export function ParentBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [paying, setPaying] = useState<string>();
  const [roomFor, setRoomFor] = useState<string>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    marketRequest<{ bookings: Booking[] }>('GET', '/bookings')
      .then((view) => setBookings(view.bookings))
      .catch((caught: unknown) => setError(errorText(caught)));
  }, []);
  useEffect(load, [load]);
  const run = (work: Promise<unknown>) =>
    work
      .then(() => {
        setError(undefined);
        load();
      })
      .catch((caught: unknown) => setError(errorText(caught)));
  if (roomFor) {
    return (
      <SessionRoom
        bookingId={roomFor}
        onClose={() => {
          setRoomFor(undefined);
          load();
        }}
      />
    );
  }
  return (
    <section aria-label="Buổi học của con" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-page-title font-bold">Buổi học của con</h2>
          <p className="text-text-secondary">Trả tiền giả lập, vào phòng học, xem bản ghi, khiếu nại.</p>
        </div>
        <Button onClick={load}>Tải lại</Button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <PackagesPanel onChange={load} />
      {bookings.length === 0 ? <p className="text-text-secondary">Chưa có buổi học nào.</p> : null}
      {GROUPS.map((group) => {
        const rows = bookings.filter((booking) => group.statuses.includes(booking.status));
        if (rows.length === 0) return null;
        return (
          <div key={group.label} className="flex flex-col gap-3">
            <h3 className="text-section-title font-semibold">{group.label}</h3>
            <ul className="flex flex-col gap-3">
              {rows.map((booking) => {
                const status = STATUS[booking.status];
                return (
                  <li
                    key={booking.id}
                    aria-label={`Buổi ${booking.subject} ${when(booking.starts_at)}`}
                    className={`${CARD_CLASS} flex flex-col gap-3 p-5`}
                  >
                    <div className="flex flex-wrap items-center gap-4">
                      <DateBlock value={booking.starts_at} active={booking.status === 'paid'} />
                      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-section-title">
                            {booking.subject} với {booking.tutor_name} – {booking.child_name}
                          </strong>
                          {booking.package_id ? <StatusBadge tone="info" label="Buổi trong gói" /> : null}
                          <StatusBadge
                            tone={status?.tone ?? 'neutral'}
                            label={`${status?.label ?? booking.status}${
                              booking.refunded_amount ? ` (đã hoàn ${money(booking.refunded_amount)})` : ''
                            }`}
                          />
                        </div>
                        <span className="text-text-secondary">
                          {when(booking.starts_at)}, {booking.minutes} phút, {money(booking.price)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {booking.status === 'held' && paying !== booking.id ? (
                          <Button variant="primary" onClick={() => setPaying(booking.id)}>
                            Thanh toán giả lập
                          </Button>
                        ) : null}
                        {booking.status === 'held' || booking.status === 'paid' ? (
                          <Button onClick={() => void run(marketRequest('POST', `/bookings/${booking.id}/cancel`, {}))}>
                            Hủy buổi
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {booking.status === 'held' && paying === booking.id ? (
                      <MockPayment
                        booking={booking}
                        onPaid={() => {
                          setPaying(undefined);
                          setError(undefined);
                          load();
                        }}
                        onClose={() => setPaying(undefined)}
                      />
                    ) : null}
                    <DisputePanel booking={booking} onChange={load} />
                    <SessionPanel booking={booking} onEnter={() => setRoomFor(booking.id)} />
                    {booking.status === 'completed' || booking.status === 'disbursed' ? (
                      <ReviewPanel bookingId={booking.id} tutorName={booking.tutor_name} />
                    ) : null}
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
