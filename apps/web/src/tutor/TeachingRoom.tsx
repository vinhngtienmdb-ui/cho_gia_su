import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  FORM_CONTROL_CLASS,
  StatusBadge,
  VideoHostPanel,
  VideoRoom,
  type VideoAdmission,
  type VideoJoinInfo,
} from '@cho-gia-su/ui';
import { errorText, marketRequest } from '../client/index.js';
import { CARD_CLASS, when } from '../styles.js';

// Phòng dạy video của một buổi, phía gia sư (DT-27 phần 27j, YCTD-362; thiết kế duyệt ngày 2026-10-28): điều kiện mở phòng, mở phòng
// (bắt đầu ghi hình với trẻ vị thành niên), lớp video (VideoRoom) và bảng của chủ phòng (VideoHostPanel: phòng chờ, cho vào, cho nói, cho
// chia sẻ màn hình, mời ra; không có nút dừng ghi với buổi bắt buộc ghi), kết thúc buổi, điểm danh tự động, xác nhận đã dạy kèm nhận xét
interface TutorRoomState {
  booking_id: string;
  subject: string;
  child_name: string;
  grade: number;
  status: string;
  starts_at: string;
  ends_at: string;
  opens_at: string;
  window_open: boolean;
  recording_required: boolean;
  consent_given: boolean;
  no_assignment_attested: boolean;
  opened: boolean;
  closed: boolean;
  recording: boolean;
  participants: Array<VideoAdmission & { removed_at: string | null; requested_at: string }>;
  attendance: Array<{
    identity: string;
    role: 'host' | 'student' | 'guardian';
    display_name: string;
    first_join: string | null;
    last_leave: string | null;
    rejoins: number;
    present_minutes: number;
    result: 'full' | 'partial' | 'late_absent' | 'absent' | null;
  }>;
  confirmed: { at: string; by: 'tutor' | 'auto' } | null;
  auto_confirm_at: string;
}

const RESULTS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  full: { label: 'Đủ buổi', tone: 'success' },
  partial: { label: 'Vào muộn hoặc về sớm', tone: 'warning' },
  late_absent: { label: 'Vào muộn, tính vắng', tone: 'danger' },
  absent: { label: 'Vắng', tone: 'danger' },
};
const ROLES = { host: 'bạn, gia sư', student: 'học sinh', guardian: 'cha mẹ (xem)' } as const;
const INCIDENTS = [
  { value: 'none', label: 'Không có' },
  { value: 'student_absent', label: 'Học sinh vắng' },
  { value: 'network', label: 'Mạng chập chờn, buổi bị ngắn' },
  { value: 'report', label: 'Có điều cần báo nền tảng' },
];
const hour = (value: string | null) =>
  value
    ? new Date(value).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })
    : '—';

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 border-b border-border py-3 last:border-0">
      <span
        aria-hidden="true"
        className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-label font-bold ${
          ok ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
        }`}
      >
        {ok ? '✓' : '!'}
      </span>
      <span>
        <span className="sr-only">{ok ? 'Đạt: ' : 'Chưa đạt: '}</span>
        {children}
      </span>
    </li>
  );
}

function AttendanceTable({ state }: { state: TutorRoomState }) {
  return (
    <div className="overflow-x-auto">
      <table aria-label="Điểm danh tự động" className="w-full min-w-[36rem] text-label">
        <thead>
          <tr className="border-b border-border text-left text-text-secondary">
            <th className="py-2 pr-2 font-semibold">Người dự</th>
            <th className="py-2 pr-2 font-semibold">Vào lúc</th>
            <th className="py-2 pr-2 font-semibold">Ra lúc</th>
            <th className="py-2 pr-2 font-semibold">Có mặt</th>
            <th className="py-2 font-semibold">Kết quả</th>
          </tr>
        </thead>
        <tbody>
          {state.attendance.map((row) => (
            <tr key={row.identity} className="border-b border-border last:border-0">
              <td className="py-2 pr-2 font-medium">
                {row.display_name} · {ROLES[row.role]}
              </td>
              <td className="py-2 pr-2">{hour(row.first_join)}</td>
              <td className="py-2 pr-2">{hour(row.last_leave)}</td>
              <td className="py-2 pr-2">
                {row.present_minutes} phút{row.rejoins > 0 ? ` · vào lại ${row.rejoins} lần` : ''}
              </td>
              <td className="py-2">
                {row.result ? (
                  <StatusBadge
                    tone={RESULTS[row.result]?.tone ?? 'warning'}
                    label={RESULTS[row.result]?.label ?? row.result}
                  />
                ) : (
                  'Không tính'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfirmForm({ state, onDone }: { state: TutorRoomState; onDone: (next: TutorRoomState) => void }) {
  const [note, setNote] = useState('');
  const [incident, setIncident] = useState('none');
  const [error, setError] = useState<string>();
  const ended = Date.now() >= new Date(state.ends_at).getTime();
  return (
    <form
      aria-label="Xác nhận buổi dạy"
      className={`${CARD_CLASS} flex flex-col gap-3 p-5`}
      onSubmit={(event) => {
        event.preventDefault();
        marketRequest<TutorRoomState>('POST', `/tutor/bookings/${state.booking_id}/room/confirm`, { note, incident })
          .then(onDone)
          .catch((caught: unknown) => setError(errorText(caught)));
      }}
    >
      <h3 className="text-section-title font-semibold">Nhận xét gửi phụ huynh</h3>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <label className="flex flex-col gap-1 text-label font-medium">
        Nội dung đã học, bài về nhà
        <textarea
          className={FORM_CONTROL_CLASS}
          rows={4}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-label font-medium">
        Có sự cố trong buổi?
        <select className={FORM_CONTROL_CLASS} value={incident} onChange={(event) => setIncident(event.target.value)}>
          {INCIDENTS.map((row) => (
            <option key={row.value} value={row.value}>
              {row.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-label text-text-secondary">
        {ended
          ? `Không xác nhận thì hệ thống tự xác nhận lúc ${when(state.auto_confirm_at)} theo điểm danh.`
          : `Xác nhận được sau giờ kết thúc buổi (${hour(state.ends_at)}).`}
      </p>
      <div>
        <Button type="submit" variant="primary" disabled={!ended}>
          Xác nhận đã dạy
        </Button>
      </div>
    </form>
  );
}

export function TeachingRoom({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const [state, setState] = useState<TutorRoomState>();
  const [join, setJoin] = useState<VideoJoinInfo>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    marketRequest<TutorRoomState>('GET', `/tutor/bookings/${bookingId}/room`)
      .then((next) => {
        setError(undefined);
        setState(next);
      })
      .catch((caught: unknown) => setError(errorText(caught)));
  }, [bookingId]);
  useEffect(load, [load]);
  // Đang dạy: tải lại phòng chờ mỗi 5 giây
  useEffect(() => {
    if (!join) return undefined;
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [join, load]);

  const act = (work: Promise<unknown>) => work.then(load).catch((caught: unknown) => setError(errorText(caught)));
  const open = () =>
    void marketRequest<VideoJoinInfo>('POST', `/tutor/bookings/${bookingId}/session/start`)
      .then((next) => {
        setError(undefined);
        setJoin(next);
        load();
      })
      .catch((caught: unknown) => setError(errorText(caught)));
  const end = () =>
    void marketRequest('POST', `/tutor/bookings/${bookingId}/session/end`)
      .then(() => {
        setJoin(undefined);
        load();
      })
      .catch((caught: unknown) => setError(errorText(caught)));

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-page-title font-bold">
          {state ? `${state.subject} · ${state.child_name} · lớp ${state.grade}` : 'Phòng dạy'}
        </h2>
        {state ? (
          <p className="text-text-secondary">
            {when(state.starts_at)} đến {hour(state.ends_at)}
          </p>
        ) : null}
      </div>
      {join ? null : (
        <Button variant="text" onClick={onClose}>
          Quay lại Buổi dạy
        </Button>
      )}
    </div>
  );

  if (!state) {
    return (
      <section aria-label="Phòng dạy" className="flex flex-col gap-4">
        {header}
        {error ? <Alert tone="danger">{error}</Alert> : <p>Đang tải…</p>}
      </section>
    );
  }

  if (join) {
    const admissions = state.participants.filter((row) => !row.removed_at);
    return (
      <section aria-label="Phòng dạy" className="flex flex-col gap-4">
        {header}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-[999_1_560px]">
            <VideoRoom join={join} onLeave={end} roleLabel="Gia sư" />
          </div>
          <div className="w-full max-w-sm flex-[1_1_300px]">
            <VideoHostPanel
              admissions={admissions}
              recording={state.recording}
              recordingLocked={state.recording_required}
              minutesLeft={null}
              onParticipant={(identity, change) =>
                void act(
                  marketRequest(
                    'POST',
                    `/tutor/bookings/${bookingId}/room/participants/${encodeURIComponent(identity)}`,
                    change,
                  ),
                )
              }
              onRecording={() => undefined}
              onEnd={end}
            />
          </div>
        </div>
      </section>
    );
  }

  if (state.closed || state.confirmed) {
    return (
      <section aria-label="Phòng dạy" className="flex flex-col gap-4">
        {header}
        {state.confirmed ? (
          <Alert tone="success">
            {state.confirmed.by === 'auto' ? 'Hệ thống đã tự xác nhận buổi dạy' : 'Bạn đã xác nhận buổi dạy'} lúc{' '}
            {when(state.confirmed.at)}. Phụ huynh còn thời hạn khiếu nại trước khi giải ngân (giả lập).
          </Alert>
        ) : (
          <Alert tone="success">Đã kết thúc buổi. Ghi hình đã dừng.</Alert>
        )}
        <div className={`${CARD_CLASS} flex flex-col gap-3 p-5`}>
          <h3 className="text-section-title font-semibold">Điểm danh tự động</h3>
          <AttendanceTable state={state} />
          <p className="text-label text-text-secondary">
            Phụ huynh thấy cùng bảng này. Rớt mạng rồi vào lại được cộng dồn.
          </p>
        </div>
        {state.status === 'paid' && !state.confirmed ? <ConfirmForm state={state} onDone={setState} /> : null}
      </section>
    );
  }

  return (
    <section aria-label="Phòng dạy" className="flex flex-col gap-4">
      {header}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className={`${CARD_CLASS} flex flex-col gap-2 p-5`}>
        <h3 className="text-section-title font-semibold">Điều kiện mở phòng</h3>
        <ul aria-label="Điều kiện mở phòng">
          <Check ok={state.status === 'paid'}>Phụ huynh đã trả tiền (giả lập)</Check>
          {state.recording_required ? (
            <Check ok={state.consent_given}>
              {state.consent_given
                ? 'Phụ huynh đã đồng ý ghi hình'
                : 'Phụ huynh chưa đồng ý ghi hình: bạn mở phòng được, học sinh chỉ vào được sau khi phụ huynh đồng ý'}
            </Check>
          ) : null}
          <Check ok={state.window_open}>Phòng mở được từ {hour(state.opens_at)} đến hết giờ học</Check>
        </ul>
        {state.recording_required ? (
          <p className="text-label text-text-secondary">Buổi với trẻ dưới 18 tuổi luôn ghi hình, không tắt được.</p>
        ) : null}
        <div>
          <Button variant="primary" disabled={!state.window_open || state.status !== 'paid'} onClick={open}>
            Mở phòng dạy
          </Button>
        </div>
      </div>
      {state.opened ? (
        <div className={`${CARD_CLASS} flex flex-col gap-3 p-5`}>
          <h3 className="text-section-title font-semibold">Điểm danh đến lúc này</h3>
          <AttendanceTable state={state} />
          {Date.now() >= new Date(state.ends_at).getTime() ? <ConfirmForm state={state} onDone={setState} /> : null}
        </div>
      ) : null}
    </section>
  );
}
