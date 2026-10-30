import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { adminCan, type AdminRole } from './admin-api.js';
import { MarketPayments } from './MarketPayments.js';
import { MarketSafety } from './MarketSafety.js';
import { MarketReviews } from './MarketReviews.js';
import { MarketReviewModeration } from './MarketReviewModeration.js';
import { AdminApiError } from './admin-api.js';

// Trang "Chợ gia sư" của ứng dụng quản trị (nguồn: trang cùng tên của cổng vận hành School Management, DT-27 phần 27f, YCTD-256; tách ở
// YCTD-393, bỏ công tắc bật chợ và tên miền): hạn giữ bản ghi (GD-132), hạn khiếu nại (GD-133), tỷ lệ hoa hồng mặc định (E-01, để trống
// khi chưa chốt), mốc phòng học video (GD-164), hạn dùng gói buổi (GD-165), đăng phiên bản mới của văn bản pháp lý, số tài khoản. Máy chủ
// thay ô không gửi bằng giá trị mặc định nên biểu mẫu luôn gửi đủ các ô. Thu tiền thật luôn tắt (chặn ở máy chủ đến khi xong E-01 đến
// E-07). Gọi máy chủ API ở /api/v1/market/admin
interface Overview {
  settings: {
    record_retention_days: number;
    complaint_window_hours: number;
    default_commission_percent: number | null;
    real_payments_enabled: false;
    package_valid_days: number;
  } & Record<TimingField, number>;
  documents: Array<{ id: string; kind: string; version: number; title: string; published_at: string }>;
  document_kinds: Record<string, string>;
  accounts: Array<{ kind: 'parent' | 'tutor'; status: string; count: number }>;
  children: number;
}

async function marketCall<T>(accessToken: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/market/admin${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let message = 'Không thực hiện được, vui lòng thử lại';
    try {
      const payload = (await response.json()) as { error?: { message?: string; details?: Array<{ message: string }> } };
      message =
        [payload.error?.message, ...(payload.error?.details ?? []).map((detail) => detail.message)]
          .filter(Boolean)
          .join('. ') || message;
    } catch {
      // Phản hồi không phải JSON: giữ thông điệp mặc định
    }
    throw new AdminApiError(response.status, message);
  }
  return (await response.json()) as T;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'chờ xác nhận',
  active: 'đang dùng',
  locked: 'đã khóa',
  closed: 'đã đóng',
};

// Mốc phòng học video (GD-164): tên ô ở máy chủ, nhãn, khoảng cho phép (khớp ROOM_TIMING_FIELDS của market-settings.ts)
const TIMING_FIELDS = [
  ['room_opens_before_minutes', 'Mở phòng trước giờ học (phút)', 0, 60],
  ['late_absent_minutes', 'Vào muộn quá số phút này thì tính vắng', 1, 60],
  ['tutor_no_show_minutes', 'Gia sư vắng quá số phút này thì phụ huynh báo được', 1, 60],
  ['full_attendance_percent', 'Có mặt từ tỉ lệ này thì đủ buổi (%)', 50, 100],
  ['auto_confirm_hours', 'Tự xác nhận buổi sau (giờ)', 1, 168],
] as const;
type TimingField = (typeof TIMING_FIELDS)[number][0];

// Phần nào hiện theo vai trò quản trị (YCTD-323): cấu hình và văn bản chỉ quản trị, duyệt hồ sơ và kiểm duyệt cho hỗ trợ,
// thanh toán cho kế toán (bảng OPERATOR_PERMISSIONS)
export function MarketPage({ accessToken, role }: { accessToken: string; role: AdminRole }) {
  const canSettings = adminCan(role, 'market.settings');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [form, setForm] = useState({
    retention: '30',
    window: '48',
    commission: '',
    packageDays: '56',
    timings: {} as Record<TimingField, string>,
  });
  const [document, setDocument] = useState({ kind: 'terms', title: '', body: '' });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Đổ cấu hình từ máy chủ vào biểu mẫu: chỉ khi tải lần đầu (lần tải bị huỷ của StrictMode bỏ qua) và sau khi lưu, để lần tải về muộn
  // không ghi đè ô người quản trị vừa sửa
  const apply = useCallback((next: Overview) => {
    setOverview(next);
    setForm({
      retention: String(next.settings.record_retention_days),
      window: String(next.settings.complaint_window_hours),
      commission:
        next.settings.default_commission_percent === null ? '' : String(next.settings.default_commission_percent),
      packageDays: String(next.settings.package_valid_days),
      timings: Object.fromEntries(TIMING_FIELDS.map(([field]) => [field, String(next.settings[field])])) as Record<
        TimingField,
        string
      >,
    });
  }, []);

  const reload = useCallback(
    async () => apply(await marketCall<Overview>(accessToken, 'GET', '')),
    [accessToken, apply],
  );

  useEffect(() => {
    let active = true;
    marketCall<Overview>(accessToken, 'GET', '')
      .then((next) => {
        if (active) apply(next);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof AdminApiError ? caught.message : 'Không đọc được cấu hình chợ gia sư');
        }
      });
    return () => {
      active = false;
    };
  }, [accessToken, apply]);

  const run = async (work: () => Promise<string>) => {
    setError(null);
    setMessage(null);
    try {
      setMessage(await work());
      await reload();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Không thực hiện được');
    }
  };

  const saveSettings = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await marketCall(accessToken, 'PUT', '/settings', {
        record_retention_days: Number(form.retention),
        complaint_window_hours: Number(form.window),
        default_commission_percent: form.commission.trim() === '' ? null : Number(form.commission),
        package_valid_days: Number(form.packageDays),
        ...Object.fromEntries(TIMING_FIELDS.map(([field]) => [field, Number(form.timings[field])])),
      });
      return 'Đã lưu cấu hình chợ gia sư';
    });
  };

  const publish = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const published = await marketCall<{ version: number }>(accessToken, 'POST', '/documents', document);
      setDocument({ ...document, title: '', body: '' });
      return `Đã đăng phiên bản ${published.version}; người dùng phải đồng ý lại trước khi dùng tiếp`;
    });
  };

  const kinds = overview?.document_kinds ?? {};
  return (
    <section aria-label="Chợ gia sư">
      <h2>Chợ gia sư</h2>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <p>
        Thu tiền thật ở chợ: <strong>tắt</strong>. Bản này chỉ chạy thanh toán giả lập; bật thu tiền thật cần xong E-01
        đến E-07.
      </p>

      {overview && canSettings ? (
        <form aria-label="Cấu hình chợ gia sư" onSubmit={saveSettings}>
          <h3>Cấu hình</h3>
          <label>
            Hạn giữ bản ghi lớp video (ngày)
            <input
              type="number"
              min={7}
              max={365}
              value={form.retention}
              onChange={(event) => setForm({ ...form, retention: event.target.value })}
            />
          </label>
          <label>
            Hạn khiếu nại trước khi giải ngân (giờ)
            <input
              type="number"
              min={1}
              max={720}
              value={form.window}
              onChange={(event) => setForm({ ...form, window: event.target.value })}
            />
          </label>
          <label>
            Tỷ lệ hoa hồng mặc định (%), để trống khi chưa chốt
            <input
              type="number"
              min={0}
              max={50}
              step={0.01}
              value={form.commission}
              onChange={(event) => setForm({ ...form, commission: event.target.value })}
            />
          </label>
          <fieldset>
            <legend>Phòng học video (GD-164)</legend>
            {TIMING_FIELDS.map(([field, text, min, max]) => (
              <label key={field}>
                {text}
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={form.timings[field] ?? ''}
                  onChange={(event) => setForm({ ...form, timings: { ...form.timings, [field]: event.target.value } })}
                />
              </label>
            ))}
          </fieldset>
          <label>
            Hạn dùng gói buổi kể từ lúc trả tiền (ngày, GD-165)
            <input
              type="number"
              min={7}
              max={365}
              value={form.packageDays}
              onChange={(event) => setForm({ ...form, packageDays: event.target.value })}
            />
          </label>
          <button type="submit">Lưu cấu hình chợ</button>
        </form>
      ) : overview ? null : (
        <p>Đang tải cấu hình chợ…</p>
      )}

      {canSettings ? (
        <form aria-label="Đăng văn bản pháp lý của chợ" onSubmit={publish}>
          <h3>Văn bản pháp lý</h3>
          <label>
            Loại văn bản
            <select value={document.kind} onChange={(event) => setDocument({ ...document, kind: event.target.value })}>
              {Object.entries(kinds).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tiêu đề
            <input
              value={document.title}
              onChange={(event) => setDocument({ ...document, title: event.target.value })}
            />
          </label>
          <label>
            Nội dung
            <textarea
              rows={6}
              value={document.body}
              onChange={(event) => setDocument({ ...document, body: event.target.value })}
            />
          </label>
          <button type="submit">Đăng phiên bản mới</button>
        </form>
      ) : null}
      <table aria-label="Văn bản pháp lý đã đăng">
        <thead>
          <tr>
            <th>Loại</th>
            <th>Phiên bản</th>
            <th>Tiêu đề</th>
            <th>Ngày đăng</th>
          </tr>
        </thead>
        <tbody>
          {(overview?.documents ?? []).map((row) => (
            <tr key={row.id}>
              <td>{kinds[row.kind] ?? row.kind}</td>
              <td>{row.version}</td>
              <td>{row.title}</td>
              <td>{new Date(row.published_at).toLocaleDateString('vi-VN')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Tài khoản</h3>
      <ul aria-label="Số tài khoản của chợ">
        {(overview?.accounts ?? []).map((row) => (
          <li key={`${row.kind}-${row.status}`}>
            {row.kind === 'parent' ? 'Phụ huynh' : 'Gia sư'} {STATUS_LABELS[row.status] ?? row.status}: {row.count}
          </li>
        ))}
        <li>Hồ sơ con: {overview?.children ?? 0}</li>
      </ul>
      {adminCan(role, 'market.review') ? <MarketReviews token={accessToken} /> : null}
      {adminCan(role, 'market.payments') ? <MarketPayments token={accessToken} /> : null}
      {adminCan(role, 'market.safety') ? <MarketReviewModeration token={accessToken} /> : null}
      {adminCan(role, 'market.safety') ? <MarketSafety token={accessToken} /> : null}
    </section>
  );
}
