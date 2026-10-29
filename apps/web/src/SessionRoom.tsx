import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, StatusBadge, VideoRoom, type VideoJoinInfo } from '@cho-gia-su/ui';
import { errorText, marketRequest } from './client/index.js';
import { CARD_CLASS, when } from './styles.js';

// Phòng học video của một buổi, phía phụ huynh và học sinh (DT-27 phần 27j, YCTD-362; thiết kế duyệt ngày 2026-10-28): chuẩn bị vào
// phòng (điều kiện, giờ mở phòng), đồng ý ghi hình theo gia sư (con từ đủ 7 tuổi cùng xác nhận; không đồng ý thì hủy buổi, hoàn đủ),
// chọn ai vào từ máy này, phòng chờ (hỏi lại máy chủ mỗi 5 giây), lớp video dùng VideoRoom của packages/ui, kết thúc buổi có điểm danh
interface RoomState {
  booking_id: string;
  subject: string;
  child_name: string;
  status: string;
  starts_at: string;
  ends_at: string;
  opens_at: string;
  window_open: boolean;
  recording_required: boolean;
  consent: { id: string; child_confirmed: boolean; consented_at: string } | null;
  child_must_confirm: boolean;
  tutor_opened: boolean;
  closed: boolean;
  no_show_allowed: boolean;
  timings: {
    opens_before_minutes: number;
    late_absent_minutes: number;
    tutor_no_show_minutes: number;
    full_attendance_percent: number;
  };
  attendance: Array<{
    identity: string;
    role: 'host' | 'student' | 'guardian';
    display_name: string;
    first_join: string | null;
    last_leave: string | null;
    rejoins: number;
    present_minutes: number;
    result: 'full' | 'partial' | 'late_absent' | 'absent' | null;
  }> | null;
  tutor_note: string | null;
}

// Máy chủ trả `status: 'waiting'` kèm `tutor_opened` khi chưa được vào, `status: 'ready'` kèm mã vào phòng khi đã được gia sư cho vào
type Entry = VideoJoinInfo & { tutor_opened?: boolean };

const RESULTS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  full: { label: 'Đủ buổi', tone: 'success' },
  partial: { label: 'Vào muộn hoặc về sớm', tone: 'warning' },
  late_absent: { label: 'Vào muộn, tính vắng', tone: 'danger' },
  absent: { label: 'Vắng', tone: 'danger' },
};
const ROLES = { host: 'gia sư', student: 'học sinh', guardian: 'cha mẹ (xem)' } as const;
const hour = (value: string | null) =>
  value
    ? new Date(value).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })
    : '—';

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 border-b border-border py-2 last:border-0">
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

function ConsentForm({
  state,
  onDone,
  onDeclined,
}: {
  state: RoomState;
  onDone: (next: RoomState) => void;
  onDeclined: () => void;
}) {
  const [parent, setParent] = useState(false);
  const [child, setChild] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <section aria-label="Đồng ý ghi hình" className={`${CARD_CLASS} mx-auto flex w-full max-w-2xl flex-col gap-4 p-6`}>
      <h2 className="text-section-title font-bold">Buổi học của {state.child_name} được ghi hình</h2>
      <p className="text-text-secondary">
        Theo chính sách an toàn trẻ em của chợ, mọi buổi có trẻ dưới 18 tuổi đều ghi hình. Bạn đồng ý một lần cho mọi
        buổi của con với gia sư này, rút lại được bất cứ lúc nào ở trang Hồ sơ con.
      </p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-xl bg-page p-4 sm:grid-cols-[8rem_1fr]">
        <dt className="font-semibold">Ghi gì</dt>
        <dd>Hình, tiếng, bảng trắng, màn hình chia sẻ trong phòng.</dd>
        <dt className="font-semibold">Ai được xem</dt>
        <dd>Bạn, gia sư của buổi, nhân viên nền tảng khi xử lý tranh chấp hoặc báo cáo.</dd>
        <dt className="font-semibold">Giữ bao lâu</dt>
        <dd>Có hạn theo cấu hình của chợ rồi tự xóa; giữ lâu hơn khi có tranh chấp hoặc báo cáo.</dd>
      </dl>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          checked={parent}
          onChange={(event) => setParent(event.target.checked)}
        />
        <span>Tôi là cha, mẹ hoặc người giám hộ của {state.child_name} và đồng ý ghi hình như trên.</span>
      </label>
      {state.child_must_confirm ? (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={child}
            onChange={(event) => setChild(event.target.checked)}
          />
          <span>Tôi đã nói với con về việc ghi hình và con đồng ý (con từ đủ 7 tuổi).</span>
        </label>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          onClick={() =>
            void marketRequest('POST', `/bookings/${state.booking_id}/room/decline-recording`)
              .then(onDeclined)
              .catch((caught: unknown) => setError(errorText(caught)))
          }
        >
          Không đồng ý, hủy buổi (hoàn đủ)
        </Button>
        <Button
          variant="primary"
          disabled={!parent || (state.child_must_confirm && !child)}
          onClick={() =>
            void marketRequest<RoomState>('POST', `/bookings/${state.booking_id}/room/consent`, {
              parent_confirmed: parent,
              child_confirmed: child,
            })
              .then(onDone)
              .catch((caught: unknown) => setError(errorText(caught)))
          }
        >
          Đồng ý ghi hình
        </Button>
      </div>
    </section>
  );
}

function Attendance({ state }: { state: RoomState }) {
  return (
    <section aria-label="Kết thúc buổi" className="flex flex-col gap-4">
      <div className={`${CARD_CLASS} flex flex-col gap-3 p-5`}>
        <h2 className="text-section-title font-bold">Buổi học đã kết thúc</h2>
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
              {(state.attendance ?? []).map((row) => (
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
        <p className="text-label text-text-secondary">
          Rớt mạng rồi vào lại được cộng dồn. Có mặt từ {state.timings.full_attendance_percent}% thời lượng là đủ buổi;
          vào muộn quá {state.timings.late_absent_minutes} phút tính vắng.
        </p>
      </div>
      {state.tutor_note ? (
        <div className={`${CARD_CLASS} flex flex-col gap-1 p-5`}>
          <h3 className="font-semibold">Gia sư nhận xét buổi học</h3>
          <p className="whitespace-pre-wrap">{state.tutor_note}</p>
        </div>
      ) : null}
      <p className="text-text-secondary">Bản ghi, khiếu nại và báo cáo vi phạm của buổi ở trang Buổi học của con.</p>
    </section>
  );
}

export function SessionRoom({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const [state, setState] = useState<RoomState>();
  const [as, setAs] = useState<'student' | 'guardian'>('student');
  const [entry, setEntry] = useState<Entry>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    marketRequest<RoomState>('GET', `/bookings/${bookingId}/room`)
      .then((next) => {
        setError(undefined);
        setState(next);
      })
      .catch((caught: unknown) => setError(errorText(caught)));
  }, [bookingId]);
  useEffect(load, [load]);
  const enter = useCallback(
    () =>
      marketRequest<Entry>('POST', `/bookings/${bookingId}/room/enter`, { as })
        .then((next) => {
          setError(undefined);
          setEntry(next);
        })
        .catch((caught: unknown) => setError(errorText(caught))),
    [bookingId, as],
  );
  // Phòng chờ: hỏi lại mỗi 5 giây đến khi gia sư cho vào; trước giờ mở phòng thì tải lại trạng thái mỗi 30 giây
  useEffect(() => {
    if (entry?.status === 'waiting') {
      const timer = window.setInterval(() => void enter(), 5000);
      return () => window.clearInterval(timer);
    }
    if (state && !state.window_open && !state.closed) {
      const timer = window.setInterval(load, 30_000);
      return () => window.clearInterval(timer);
    }
    return undefined;
  }, [entry?.status, enter, state, load]);

  const leave = () =>
    void marketRequest('POST', `/bookings/${bookingId}/room/leave`, { as })
      .catch(() => undefined)
      .finally(() => {
        setEntry(undefined);
        load();
      });

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-page-title font-bold">{state ? `${state.subject} · ${state.child_name}` : 'Phòng học'}</h2>
        {state ? (
          <p className="text-text-secondary">
            {when(state.starts_at)} đến {hour(state.ends_at)}
          </p>
        ) : null}
      </div>
      <Button variant="text" onClick={entry?.status === 'ready' ? leave : onClose}>
        {entry?.status === 'ready' ? 'Rời phòng' : 'Quay lại Buổi học của con'}
      </Button>
    </div>
  );

  if (!state) {
    return (
      <section aria-label="Phòng học" className="flex flex-col gap-4">
        {header}
        {error ? <Alert tone="danger">{error}</Alert> : <p>Đang tải…</p>}
      </section>
    );
  }
  if (state.closed && state.attendance) {
    return (
      <section aria-label="Phòng học" className="flex flex-col gap-4">
        {header}
        <Attendance state={state} />
      </section>
    );
  }
  if (entry?.status === 'ready') {
    return (
      <section aria-label="Phòng học" className="flex flex-col gap-4">
        {header}
        <VideoRoom join={entry} onLeave={leave} />
      </section>
    );
  }
  if (state.recording_required && !state.consent && state.status === 'paid') {
    return (
      <section aria-label="Phòng học" className="flex flex-col gap-4">
        {header}
        <ConsentForm state={state} onDone={setState} onDeclined={onClose} />
      </section>
    );
  }
  if (entry?.status === 'waiting') {
    return (
      <section aria-label="Phòng học" className="flex flex-col gap-4">
        {header}
        <div
          aria-live="polite"
          className="mx-auto flex w-full max-w-xl flex-col gap-3 rounded-2xl bg-brand-strong p-6 text-white"
        >
          <h3 className="text-section-title font-bold">
            {entry.tutor_opened ? 'Đang chờ gia sư cho vào' : 'Gia sư chưa mở phòng'}
          </h3>
          <p>Giữ trang này mở; khi gia sư cho vào, lớp video tự hiện.</p>
          {state.recording_required ? <p>Buổi này được ghi hình.</p> : null}
          {state.no_show_allowed ? (
            <Button
              variant="danger"
              onClick={() =>
                void marketRequest('POST', `/bookings/${bookingId}/tutor-no-show`)
                  .then(onClose)
                  .catch((caught: unknown) => setError(errorText(caught)))
              }
            >
              Báo gia sư vắng (hoàn đủ tiền)
            </Button>
          ) : (
            <p className="text-label">
              Quá {state.timings.tutor_no_show_minutes} phút sau giờ học mà gia sư chưa vào, bạn báo "Gia sư vắng" để
              được hoàn đủ tiền.
            </p>
          )}
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </section>
    );
  }
  return (
    <section aria-label="Phòng học" className="flex flex-col gap-4">
      {header}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap items-start gap-6">
        <div className={`${CARD_CLASS} flex min-w-0 flex-[999_1_420px] flex-col gap-3 p-5`}>
          <h3 className="text-section-title font-semibold">Ai vào phòng từ máy này?</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label
              className={`flex items-start gap-2 rounded-xl border p-3 ${as === 'student' ? 'border-2 border-brand' : 'border-border'}`}
            >
              <input
                type="radio"
                name="vai"
                className="mt-1"
                checked={as === 'student'}
                onChange={() => setAs('student')}
              />
              <span className="flex flex-col">
                <strong>Con học</strong>
                <span className="text-label text-text-secondary">Con nói, xem bảng, viết bảng khi gia sư cho</span>
              </span>
            </label>
            <label
              className={`flex items-start gap-2 rounded-xl border p-3 ${as === 'guardian' ? 'border-2 border-brand' : 'border-border'}`}
            >
              <input
                type="radio"
                name="vai"
                className="mt-1"
                checked={as === 'guardian'}
                onChange={() => setAs('guardian')}
              />
              <span className="flex flex-col">
                <strong>Tôi vào xem</strong>
                <span className="text-label text-text-secondary">Cha mẹ (xem): tắt micro, trừ khi gia sư cho nói</span>
              </span>
            </label>
          </div>
          <p className="text-label text-text-secondary">
            Trình duyệt sẽ hỏi quyền dùng camera, micro khi vào lớp. Bị chặn thì bấm biểu tượng ổ khóa trên thanh địa
            chỉ.
          </p>
        </div>
        <aside className={`${CARD_CLASS} flex w-full max-w-sm flex-[1_1_300px] flex-col gap-2 p-5`}>
          <h3 className="text-section-title font-semibold">Điều kiện vào phòng</h3>
          <ul aria-label="Điều kiện vào phòng">
            <Check ok={state.status === 'paid'}>Buổi đã trả tiền (giả lập)</Check>
            {state.recording_required ? <Check ok={Boolean(state.consent)}>Đã đồng ý ghi hình cho con</Check> : null}
            <Check ok={state.window_open}>
              Phòng mở từ {hour(state.opens_at)} ({state.timings.opens_before_minutes} phút trước giờ học)
            </Check>
          </ul>
          <Button
            variant="primary"
            disabled={!state.window_open || state.status !== 'paid'}
            onClick={() => void enter()}
          >
            Vào phòng chờ
          </Button>
          {state.no_show_allowed ? (
            <Button
              variant="danger"
              onClick={() =>
                void marketRequest('POST', `/bookings/${bookingId}/tutor-no-show`)
                  .then(onClose)
                  .catch((caught: unknown) => setError(errorText(caught)))
              }
            >
              Báo gia sư vắng (hoàn đủ tiền)
            </Button>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
