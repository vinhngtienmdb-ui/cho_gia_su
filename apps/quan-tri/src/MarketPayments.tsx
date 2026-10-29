import { useCallback, useEffect, useState } from 'react';
import { AdminApiError } from './admin-api.js';

// Buổi học, thanh toán, tranh chấp, hoa hồng của chợ gia sư ở cổng nền tảng (DT-27 phần 27h, YCTD-258): danh sách buổi và tiền (thanh
// toán giả lập), tranh chấp chờ quyết định (hoàn đủ, hoàn một phần, giải ngân; có lý do; khiếu nại lại do nhân viên khác xét), chốt ngay
// quyết định lần đầu, quy tắc hoa hồng có ngày hiệu lực (tỷ lệ thật do Eric chốt, E-01), chạy ngay việc định kỳ
interface Overview {
  bookings: Array<{
    id: string;
    child_name: string;
    subject: string;
    starts_at: string;
    price: number;
    commission: number;
    status: string;
    tutor_name: string;
    payment_status: string | null;
    refunded_amount: number | null;
    released_amount: number | null;
    commission_taken: number | null;
  }>;
  disputes: Array<{
    booking_id: string;
    status: string;
    reason: string;
    subject: string;
    child_name: string;
    price: number;
  }>;
  commission_rules: Array<{
    id: string;
    content_kind: string | null;
    tutor_name: string | null;
    percent: number;
    minimum: number;
    effective_from: string;
  }>;
}

interface DisputeView {
  booking_id: string;
  status: string;
  reason: string;
  decision: string | null;
  decision_note: string | null;
  appeal_reason: string | null;
  statements: Array<{ role: string; body: string }>;
  booking: { price: number; tutor_name: string; child_name: string; subject: string };
}

const DISPUTE_LABELS: Record<string, string> = {
  open: 'chờ quyết định',
  decided: 'đã quyết định, trong hạn khiếu nại lại',
  appealed: 'khiếu nại lại, chờ nhân viên khác xét',
  final: 'đã chốt',
};

async function paymentsCall<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/market/admin/payments${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; details?: Array<{ message: string }> };
  };
  if (!response.ok) {
    throw new AdminApiError(
      response.status,
      [payload.error?.message, ...(payload.error?.details ?? []).map((detail) => detail.message)]
        .filter(Boolean)
        .join('. ') || 'Không thực hiện được',
    );
  }
  return payload as T;
}

function DisputeDecision({ token, id, onDone }: { token: string; id: string; onDone: () => void }) {
  const [view, setView] = useState<DisputeView>();
  const [form, setForm] = useState({ decision: 'refund_full', refund_amount: '', note: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    paymentsCall<DisputeView>(token, 'GET', `/disputes/${id}`)
      .then((next) => {
        if (active) setView(next);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof AdminApiError ? caught.message : 'Không đọc được tranh chấp');
      });
    return () => {
      active = false;
    };
  }, [token, id]);
  const act = (path: string, body?: unknown) =>
    paymentsCall<DisputeView>(token, 'POST', path, body)
      .then((next) => {
        setError(null);
        setView(next);
        onDone();
      })
      .catch((caught: unknown) => setError(caught instanceof AdminApiError ? caught.message : 'Không thực hiện được'));
  if (!view) return error ? <p role="alert">{error}</p> : <p>Đang tải…</p>;
  return (
    <section aria-label={`Tranh chấp buổi ${view.booking.subject}`}>
      <h4>
        {view.booking.subject} – {view.booking.child_name} với {view.booking.tutor_name} (
        {view.booking.price.toLocaleString('vi-VN')} đồng)
      </h4>
      {error ? <p role="alert">{error}</p> : null}
      <p>Trạng thái: {DISPUTE_LABELS[view.status] ?? view.status}</p>
      <p>Phụ huynh khiếu nại: {view.reason}</p>
      <ul aria-label="Trình bày">
        {view.statements.map((item, index) => (
          <li key={index}>
            {item.role === 'parent' ? 'Phụ huynh' : 'Gia sư'}: {item.body}
          </li>
        ))}
      </ul>
      {view.decision_note ? <p>Quyết định lần đầu: {view.decision_note}</p> : null}
      {view.appeal_reason ? <p>Khiếu nại lại: {view.appeal_reason}</p> : null}
      {view.status === 'open' || view.status === 'appealed' ? (
        <form
          aria-label="Quyết định tranh chấp"
          onSubmit={(event) => {
            event.preventDefault();
            void act(`/disputes/${id}/decide`, {
              decision: form.decision,
              note: form.note,
              ...(form.decision === 'refund_partial' ? { refund_amount: Number(form.refund_amount) } : {}),
            });
          }}
        >
          <label>
            Quyết định
            <select
              aria-label="Quyết định"
              value={form.decision}
              onChange={(event) => setForm({ ...form, decision: event.target.value })}
            >
              <option value="refund_full">Hoàn đủ cho phụ huynh</option>
              <option value="refund_partial">Hoàn một phần</option>
              <option value="release">Giải ngân cho gia sư</option>
            </select>
          </label>
          {form.decision === 'refund_partial' ? (
            <label>
              Số hoàn (đồng)
              <input
                type="number"
                value={form.refund_amount}
                onChange={(event) => setForm({ ...form, refund_amount: event.target.value })}
              />
            </label>
          ) : null}
          <label>
            Lý do quyết định
            <textarea rows={2} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
          </label>
          <button type="submit">Ghi quyết định</button>
        </form>
      ) : null}
      {view.status === 'decided' ? (
        <button type="button" onClick={() => void act(`/disputes/${id}/finalize`)}>
          Chốt quyết định và chuyển tiền
        </button>
      ) : null}
    </section>
  );
}

export function MarketPayments({ token }: { token: string }) {
  const [overview, setOverview] = useState<Overview>();
  const [open, setOpen] = useState<string>();
  const [rule, setRule] = useState({ content_kind: '', percent: '10', minimum: '0', effective_from: '' });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    paymentsCall<Overview>(token, 'GET', '')
      .then(setOverview)
      .catch((caught: unknown) =>
        setError(caught instanceof AdminApiError ? caught.message : 'Không đọc được thanh toán'),
      );
  }, [token]);
  useEffect(load, [load]);

  return (
    <section aria-label="Buổi học và thanh toán của chợ">
      <h3>Buổi học và thanh toán (giả lập)</h3>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        onClick={() =>
          void paymentsCall<{ expired: number; disbursed: number; finalized: number }>(token, 'POST', '/run-due')
            .then((result) => {
              setMessage(
                `Nhả ${result.expired} chỗ giữ, giải ngân ${result.disbursed} buổi, chốt ${result.finalized} quyết định`,
              );
              load();
            })
            .catch((caught: unknown) =>
              setError(caught instanceof AdminApiError ? caught.message : 'Không thực hiện được'),
            )
        }
      >
        Chạy giải ngân đến hạn
      </button>

      <h4>Quy tắc hoa hồng</h4>
      <table aria-label="Quy tắc hoa hồng">
        <tbody>
          {(overview?.commission_rules ?? []).map((item) => (
            <tr key={item.id}>
              <td>{item.content_kind ?? 'mọi nội dung'}</td>
              <td>{item.tutor_name ?? 'mọi gia sư'}</td>
              <td>{item.percent}%</td>
              <td>tối thiểu {item.minimum.toLocaleString('vi-VN')} đồng</td>
              <td>từ {String(item.effective_from).slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        aria-label="Thêm quy tắc hoa hồng"
        onSubmit={(event) => {
          event.preventDefault();
          void paymentsCall<Overview>(token, 'POST', '/commission-rules', {
            content_kind: rule.content_kind || null,
            percent: Number(rule.percent),
            minimum: Number(rule.minimum),
            effective_from: rule.effective_from,
          })
            .then((next) => {
              setError(null);
              setMessage('Đã thêm quy tắc hoa hồng');
              setOverview(next);
            })
            .catch((caught: unknown) =>
              setError(caught instanceof AdminApiError ? caught.message : 'Không thực hiện được'),
            );
        }}
      >
        <label>
          Loại nội dung
          <select
            value={rule.content_kind}
            onChange={(event) => setRule({ ...rule, content_kind: event.target.value })}
          >
            <option value="">Mọi nội dung</option>
            <option value="curriculum">Môn của chương trình phổ thông</option>
            <option value="enrichment">Năng khiếu, kỹ năng</option>
          </select>
        </label>
        <label>
          Tỷ lệ (%)
          <input
            type="number"
            step={0.01}
            value={rule.percent}
            onChange={(event) => setRule({ ...rule, percent: event.target.value })}
          />
        </label>
        <label>
          Tối thiểu (đồng)
          <input
            type="number"
            value={rule.minimum}
            onChange={(event) => setRule({ ...rule, minimum: event.target.value })}
          />
        </label>
        <label>
          Hiệu lực từ
          <input
            type="date"
            value={rule.effective_from}
            onChange={(event) => setRule({ ...rule, effective_from: event.target.value })}
          />
        </label>
        <button type="submit">Thêm quy tắc</button>
      </form>

      <h4>Tranh chấp</h4>
      {overview && overview.disputes.length === 0 ? <p>Không có tranh chấp đang xét.</p> : null}
      <ul aria-label="Tranh chấp đang xét">
        {(overview?.disputes ?? []).map((item) => (
          <li key={item.booking_id}>
            {item.subject} – {item.child_name}: {DISPUTE_LABELS[item.status] ?? item.status}{' '}
            <button type="button" onClick={() => setOpen(item.booking_id)}>
              Xem tranh chấp {item.subject}
            </button>
          </li>
        ))}
      </ul>
      {open ? <DisputeDecision key={open} token={token} id={open} onDone={load} /> : null}

      <h4>Buổi học gần đây</h4>
      <table aria-label="Buổi học gần đây">
        <thead>
          <tr>
            <th>Buổi</th>
            <th>Gia sư</th>
            <th>Giá</th>
            <th>Trạng thái</th>
            <th>Hoàn</th>
            <th>Gia sư nhận</th>
            <th>Hoa hồng</th>
          </tr>
        </thead>
        <tbody>
          {(overview?.bookings ?? []).map((item) => (
            <tr key={item.id}>
              <td>
                {item.subject} – {item.child_name}
              </td>
              <td>{item.tutor_name}</td>
              <td>{item.price.toLocaleString('vi-VN')}</td>
              <td>{item.status}</td>
              <td>{(item.refunded_amount ?? 0).toLocaleString('vi-VN')}</td>
              <td>{(item.released_amount ?? 0).toLocaleString('vi-VN')}</td>
              <td>{(item.commission_taken ?? 0).toLocaleString('vi-VN')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
