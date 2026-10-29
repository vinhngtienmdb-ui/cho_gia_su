import { useCallback, useEffect, useState } from 'react';
import { AdminApiError } from './admin-api.js';

// Kiểm duyệt và an toàn trẻ em của chợ gia sư ở cổng nền tảng (DT-27 phần 27i, YCTD-259): chỉ số an toàn, hàng chờ báo cáo theo hạn,
// chi tiết kèm bằng chứng (tin nhắn gốc trước khi che, buổi học, bản ghi), nhận xử lý, tạm khóa ngay, quyết định có lý do (kháng nghị
// do nhân viên khác xét), xuất hồ sơ cho cơ quan có thẩm quyền (ghi cơ quan, số văn bản), xem bản ghi (có nhật ký)
const CATEGORY_LABELS: Record<string, string> = {
  child_safety: 'An toàn trẻ em',
  harassment: 'Quấy rối',
  fraud: 'Gian lận',
  fee_evasion: 'Né hoa hồng',
  wrong_content: 'Nội dung sai',
};
const SEVERITY_LABELS: Record<string, string> = {
  low: 'thấp',
  medium: 'trung bình',
  high: 'cao',
  critical: 'nghiêm trọng',
};
const STATUS_LABELS: Record<string, string> = {
  open: 'chờ xử lý',
  decided: 'đã quyết định, trong hạn kháng nghị',
  appealed: 'kháng nghị, chờ nhân viên khác xét',
  final: 'đã chốt',
};

interface Overview {
  metrics: {
    open_reports: number;
    overdue_reports: number;
    critical_open: number;
    child_safety_open: number;
    active_suspensions: number;
    flagged_threads: number;
    stored_recordings: number;
  };
  reports: Array<{
    id: string;
    category: string;
    severity: string;
    status: string;
    due_at: string;
    subject_name: string;
    assigned_to: string | null;
  }>;
  suspensions: Array<{ id: string; tutor_name: string; reason: string; started_at: string }>;
}

interface ReportDetail {
  id: string;
  category: string;
  severity: string;
  status: string;
  description: string;
  due_at: string;
  subject_name: string;
  subject_kind: string | null;
  reporter_name: string;
  decision_note: string | null;
  appeal_reason: string | null;
  suspension: { reason: string } | null;
  evidence: {
    messages: Array<{ id: string; role: string; body: string; original_body: string | null }>;
    bookings: Array<{
      id: string;
      subject: string;
      child_name: string;
      starts_at: string;
      status: string;
      recording_status: string | null;
    }>;
  };
  log: Array<{ action: string; note: string | null; created_at: string }>;
}

async function safetyCall<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/market/admin/safety${path}`, {
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

const failure = (caught: unknown) => (caught instanceof AdminApiError ? caught.message : 'Không thực hiện được');
const when = (value: string) => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

function Recording({ token, bookingId }: { token: string; bookingId: string }) {
  const [source, setSource] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    return () => {
      if (source) URL.revokeObjectURL(source);
    };
  }, [source]);
  if (source) {
    return (
      <video
        aria-label="Bản ghi buổi học"
        src={source}
        controls
        controlsList="nodownload"
        disablePictureInPicture
        onContextMenu={(event) => event.preventDefault()}
      />
    );
  }
  return (
    <>
      {error ? <span role="alert">{error}</span> : null}
      <button
        type="button"
        onClick={() =>
          void fetch(`/api/v1/market/admin/safety/recordings/${bookingId}`, {
            headers: { authorization: `Bearer ${token}` },
            cache: 'no-store',
          })
            .then(async (response) => {
              if (!response.ok) throw new AdminApiError(response.status, 'Không xem được bản ghi');
              setSource(URL.createObjectURL(await response.blob()));
            })
            .catch((caught: unknown) => setError(failure(caught)))
        }
      >
        Xem bản ghi
      </button>
    </>
  );
}

function ReportReview({ token, id, onDone }: { token: string; id: string; onDone: () => void }) {
  const [view, setView] = useState<ReportDetail>();
  const [form, setForm] = useState({ decision: 'suspend', note: '' });
  const [exportForm, setExportForm] = useState({ authority: '', request_reference: '' });
  const [exported, setExported] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    safetyCall<ReportDetail>(token, 'GET', `/reports/${id}`)
      .then((next) => {
        if (active) setView(next);
      })
      .catch((caught: unknown) => {
        if (active) setError(failure(caught));
      });
    return () => {
      active = false;
    };
  }, [token, id]);
  const act = (path: string, body?: unknown) =>
    safetyCall<ReportDetail>(token, 'POST', path, body)
      .then((next) => {
        setError(null);
        setView(next);
        onDone();
      })
      .catch((caught: unknown) => setError(failure(caught)));
  if (!view) return error ? <p role="alert">{error}</p> : <p>Đang tải…</p>;
  const waiting = view.status === 'open' || view.status === 'appealed';
  return (
    <section aria-label={`Báo cáo về ${view.subject_name}`}>
      <h4>
        {CATEGORY_LABELS[view.category] ?? view.category} – {view.subject_name} (mức{' '}
        {SEVERITY_LABELS[view.severity] ?? view.severity})
      </h4>
      {error ? <p role="alert">{error}</p> : null}
      <p>
        Trạng thái: {STATUS_LABELS[view.status] ?? view.status}; hạn xử lý {when(view.due_at)}; người báo:{' '}
        {view.reporter_name}
      </p>
      <p>Mô tả: {view.description}</p>
      {view.suspension ? <p>Đang tạm khóa: {view.suspension.reason}</p> : null}
      {view.decision_note ? <p>Quyết định lần đầu: {view.decision_note}</p> : null}
      {view.appeal_reason ? <p>Kháng nghị: {view.appeal_reason}</p> : null}
      <h5>Tin nhắn (chữ gốc trước khi che)</h5>
      <ul aria-label="Bằng chứng tin nhắn">
        {view.evidence.messages.map((message) => (
          <li key={message.id}>
            {message.role === 'parent' ? 'Phụ huynh' : 'Gia sư'}: {message.original_body ?? message.body}
            {message.original_body ? ' (đã che khi gửi)' : ''}
          </li>
        ))}
      </ul>
      <h5>Buổi học</h5>
      <ul aria-label="Bằng chứng buổi học">
        {view.evidence.bookings.map((booking) => (
          <li key={booking.id}>
            {booking.subject} – {booking.child_name}, {when(booking.starts_at)}, {booking.status}
            {booking.recording_status === 'ready' ? <Recording token={token} bookingId={booking.id} /> : null}
          </li>
        ))}
      </ul>
      <div>
        <button type="button" onClick={() => void act(`/reports/${id}/assign`)}>
          Nhận xử lý
        </button>
        {view.subject_kind === 'tutor' && !view.suspension ? (
          <button
            type="button"
            onClick={() => void act(`/reports/${id}/suspend`, { note: form.note || 'Tạm khóa trong lúc xét' })}
          >
            Tạm khóa ngay
          </button>
        ) : null}
      </div>
      {waiting ? (
        <form
          aria-label="Quyết định báo cáo"
          onSubmit={(event) => {
            event.preventDefault();
            void act(`/reports/${id}/decide`, form);
          }}
        >
          <label>
            Quyết định
            <select
              aria-label="Quyết định"
              value={form.decision}
              onChange={(event) => setForm({ ...form, decision: event.target.value })}
            >
              <option value="suspend">Tạm khóa</option>
              <option value="warn">Cảnh cáo</option>
              <option value="dismiss">Bác báo cáo</option>
            </select>
          </label>
          <label>
            Lý do quyết định
            <textarea rows={2} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
          </label>
          <button type="submit">Ghi quyết định</button>
        </form>
      ) : null}
      <form
        aria-label="Xuất hồ sơ cho cơ quan có thẩm quyền"
        onSubmit={(event) => {
          event.preventDefault();
          void safetyCall<{ exported_at: string }>(token, 'POST', `/reports/${id}/export`, exportForm)
            .then((result) => {
              setError(null);
              setExported(`Đã xuất hồ sơ lúc ${when(result.exported_at)} (có nhật ký)`);
            })
            .catch((caught: unknown) => setError(failure(caught)));
        }}
      >
        <label>
          Cơ quan yêu cầu
          <input
            value={exportForm.authority}
            onChange={(event) => setExportForm({ ...exportForm, authority: event.target.value })}
          />
        </label>
        <label>
          Số văn bản yêu cầu
          <input
            value={exportForm.request_reference}
            onChange={(event) => setExportForm({ ...exportForm, request_reference: event.target.value })}
          />
        </label>
        <button type="submit">Xuất hồ sơ</button>
        {exported ? <span role="status">{exported}</span> : null}
      </form>
      <h5>Nhật ký kiểm duyệt</h5>
      <ul aria-label="Nhật ký kiểm duyệt">
        {view.log.map((entry, index) => (
          <li key={index}>
            {when(entry.created_at)}: {entry.action}
            {entry.note ? ` – ${entry.note}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MarketSafety({ token }: { token: string }) {
  const [overview, setOverview] = useState<Overview>();
  const [open, setOpen] = useState<string>();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    safetyCall<Overview>(token, 'GET', '')
      .then(setOverview)
      .catch((caught: unknown) => setError(failure(caught)));
  }, [token]);
  useEffect(load, [load]);
  const metrics = overview?.metrics;
  return (
    <section aria-label="Kiểm duyệt và an toàn trẻ em của chợ">
      <h3>Kiểm duyệt và an toàn trẻ em</h3>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {metrics ? (
        <dl aria-label="Chỉ số an toàn">
          <dt>Báo cáo chờ xử lý</dt>
          <dd>{metrics.open_reports}</dd>
          <dt>Quá hạn</dt>
          <dd>{metrics.overdue_reports}</dd>
          <dt>Nghiêm trọng</dt>
          <dd>{metrics.critical_open}</dd>
          <dt>An toàn trẻ em</dt>
          <dd>{metrics.child_safety_open}</dd>
          <dt>Gia sư đang tạm khóa</dt>
          <dd>{metrics.active_suspensions}</dd>
          <dt>Luồng tin nhắn gắn cờ</dt>
          <dd>{metrics.flagged_threads}</dd>
          <dt>Bản ghi đang lưu</dt>
          <dd>{metrics.stored_recordings}</dd>
        </dl>
      ) : null}
      <button
        type="button"
        onClick={() =>
          void safetyCall<{ purged: number }>(token, 'POST', '/run-due')
            .then((result) => {
              setMessage(`Đã xóa ${result.purged} bản ghi hết hạn giữ`);
              load();
            })
            .catch((caught: unknown) => setError(failure(caught)))
        }
      >
        Xóa bản ghi hết hạn
      </button>
      <h4>Hàng chờ báo cáo</h4>
      {overview && overview.reports.length === 0 ? <p>Không có báo cáo đang xét.</p> : null}
      <ul aria-label="Hàng chờ báo cáo">
        {(overview?.reports ?? []).map((item) => (
          <li key={item.id}>
            {CATEGORY_LABELS[item.category] ?? item.category} – {item.subject_name}, mức{' '}
            {SEVERITY_LABELS[item.severity] ?? item.severity}, {STATUS_LABELS[item.status] ?? item.status}, hạn{' '}
            {when(item.due_at)}{' '}
            <button type="button" onClick={() => setOpen(item.id)}>
              Xem báo cáo về {item.subject_name}
            </button>
          </li>
        ))}
      </ul>
      {open ? <ReportReview key={open} token={token} id={open} onDone={load} /> : null}
      <h4>Gia sư đang tạm khóa</h4>
      <ul aria-label="Gia sư đang tạm khóa">
        {(overview?.suspensions ?? []).map((item) => (
          <li key={item.id}>
            {item.tutor_name}: {item.reason} (từ {when(item.started_at)})
          </li>
        ))}
      </ul>
    </section>
  );
}
