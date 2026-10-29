import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, FORM_CONTROL_CLASS, StatusBadge, type StatusTone } from '@cho-gia-su/ui';
import { errorText, marketRequest } from './client/index.js';
import { vietnamInputToIso } from './ParentBookings.js';
import { CARD_CLASS, money } from './styles.js';

// Gói buổi của phụ huynh (YCTD-365, GD-165; thiết kế duyệt ngày 2026-10-28): trả tiền giả lập cho gói, đặt từng buổi từ gói, hủy gói trước
// buổi đầu (hoàn đủ); hết hạn dùng thì chợ tự hoàn phần buổi chưa học
interface PackageRow {
  id: string;
  tutor_name: string;
  child_name: string;
  subject: string;
  session_minutes: number;
  sessions_total: number;
  sessions_used: number;
  price_total: number;
  price_per_session: number;
  status: 'held' | 'paid' | 'cancelled' | 'expired' | 'refunded' | 'used_up';
  hold_expires_at: string;
  expires_at: string | null;
  refunded_amount: number;
  closed_reason: string | null;
}

const STATUS: Record<PackageRow['status'], { label: string; tone: StatusTone }> = {
  held: { label: 'Đang giữ chỗ, chờ trả tiền', tone: 'warning' },
  paid: { label: 'Đang dùng', tone: 'success' },
  cancelled: { label: 'Đã hủy', tone: 'neutral' },
  expired: { label: 'Hết hạn dùng', tone: 'neutral' },
  refunded: { label: 'Đã hoàn phần còn lại', tone: 'neutral' },
  used_up: { label: 'Đã dùng hết', tone: 'neutral' },
};
const date = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';

function BookFromPackage({ row, onBooked }: { row: PackageRow; onBooked: () => void }) {
  const [startsAt, setStartsAt] = useState('');
  const [error, setError] = useState<string>();
  return (
    <form
      aria-label={`Đặt buổi từ gói ${row.subject}`}
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void marketRequest('POST', '/bookings', {
          package_id: row.id,
          starts_at: startsAt ? vietnamInputToIso(startsAt) : '',
        })
          .then(() => {
            setError(undefined);
            setStartsAt('');
            onBooked();
          })
          .catch((caught: unknown) => setError(errorText(caught)));
      }}
    >
      <label className="flex min-w-0 flex-[1_1_220px] flex-col gap-1 text-label font-medium">
        Giờ buổi tiếp theo (giờ Việt Nam)
        <input
          className={FORM_CONTROL_CLASS}
          type="datetime-local"
          value={startsAt}
          onChange={(event) => setStartsAt(event.target.value)}
        />
      </label>
      <Button type="submit" variant="primary">
        Đặt buổi từ gói
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </form>
  );
}

export function PackagesPanel({ onChange }: { onChange: () => void }) {
  const [rows, setRows] = useState<PackageRow[]>([]);
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    marketRequest<{ packages: PackageRow[] }>('GET', '/packages')
      .then((view) => setRows(view.packages))
      .catch((caught: unknown) => setError(errorText(caught)));
  }, []);
  useEffect(load, [load]);
  const run = (work: Promise<unknown>) =>
    work
      .then(() => {
        setError(undefined);
        load();
        onChange();
      })
      .catch((caught: unknown) => setError(errorText(caught)));
  if (rows.length === 0 && !error) return null;
  return (
    <section aria-label="Gói buổi" className="flex flex-col gap-3">
      <h3 className="text-section-title font-semibold">Gói buổi</h3>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const status = STATUS[row.status];
          const percent = Math.round((row.sessions_used / row.sessions_total) * 100);
          return (
            <li
              key={row.id}
              aria-label={`Gói ${row.subject} với ${row.tutor_name}`}
              className={`${CARD_CLASS} flex flex-col gap-3 p-5`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-section-title">
                  {row.subject} với {row.tutor_name} – {row.child_name}
                </strong>
                <StatusBadge tone={status.tone} label={status.label} />
              </div>
              <div className="flex flex-col gap-1">
                <div
                  role="progressbar"
                  aria-label="Số buổi đã dùng"
                  aria-valuemin={0}
                  aria-valuemax={row.sessions_total}
                  aria-valuenow={row.sessions_used}
                  className="h-2.5 overflow-hidden rounded-full bg-page"
                >
                  <div className="h-full bg-brand" style={{ width: `${percent}%` }} />
                </div>
                <span className="text-label text-text-secondary">
                  Đã đặt {row.sessions_used} / {row.sessions_total} buổi · {money(row.price_per_session)} mỗi buổi ·{' '}
                  {row.status === 'paid' ? `dùng đến ${date(row.expires_at)}` : `tổng ${money(row.price_total)}`}
                  {row.refunded_amount > 0 ? ` · đã hoàn ${money(row.refunded_amount)}` : ''}
                </span>
              </div>
              {row.status === 'held' ? (
                <div className="flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning/5 p-4">
                  <span role="note" className="text-label text-warning">
                    Đây là thanh toán giả lập: không có tiền nào rời tài khoản của bạn.
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      onClick={() => void run(marketRequest('POST', `/packages/${row.id}/mock-pay`))}
                    >
                      Giả lập: đã trả gói
                    </Button>
                    <Button onClick={() => void run(marketRequest('POST', `/packages/${row.id}/cancel`))}>
                      Hủy gói
                    </Button>
                  </div>
                </div>
              ) : null}
              {row.status === 'paid' && row.sessions_used < row.sessions_total ? (
                <BookFromPackage row={row} onBooked={() => void run(Promise.resolve())} />
              ) : null}
              {row.status === 'paid' && row.sessions_used === 0 ? (
                <div>
                  <Button onClick={() => void run(marketRequest('POST', `/packages/${row.id}/cancel`))}>
                    Hủy gói (hoàn đủ)
                  </Button>
                </div>
              ) : null}
              {row.closed_reason ? <span className="text-label text-text-secondary">{row.closed_reason}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
