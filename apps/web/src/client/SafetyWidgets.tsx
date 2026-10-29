import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, FORM_CONTROL_CLASS } from '@cho-gia-su/ui';
import { errorText, marketBlob, marketRequest } from './market-api.js';

// Phần an toàn trẻ em dùng chung của Chợ gia sư và ứng dụng Gia sư (DT-27 phần 27i, YCTD-259): tin nhắn giữa phụ huynh và gia sư (thông
// tin liên lạc ngoài bị che, có cảnh báo), báo cáo vi phạm (kèm hướng dẫn Tổng đài 111), xem bản ghi buổi học (phát trực tiếp, không có
// nút tải)
export const SAFETY_HOTLINE =
  'Nếu trẻ đang gặp nguy hiểm, gọi ngay 113 hoặc Tổng đài quốc gia bảo vệ trẻ em 111 (miễn phí, 24 giờ).';

export const REPORT_CATEGORY_LABELS: Record<string, string> = {
  child_safety: 'An toàn trẻ em',
  harassment: 'Quấy rối, lời lẽ không phù hợp',
  fraud: 'Gian lận',
  fee_evasion: 'Rủ trao đổi, trả tiền ngoài chợ',
  wrong_content: 'Nội dung sai, hồ sơ không đúng',
};

export const REPORT_SEVERITY_LABELS: Record<string, string> = {
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  critical: 'Nghiêm trọng (xử lý trong 4 giờ)',
};

export const REPORT_DECISION_LABELS: Record<string, string> = {
  suspend: 'tạm khóa',
  warn: 'cảnh cáo',
  dismiss: 'bác báo cáo',
};

// Chính sách an toàn trẻ em (tóm tắt; văn bản đầy đủ là PL-19 trong hồ sơ pháp lý, luật sư của Eric rà trước khi mở chợ, E-08)
export function ChildSafetyPolicy() {
  return (
    <section
      aria-label="Chính sách an toàn trẻ em"
      className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-6"
    >
      <h2 className="text-section-title font-semibold">Chính sách an toàn trẻ em</h2>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        <li>Trẻ không tự đăng ký; mọi hồ sơ con do phụ huynh tạo và đồng ý.</li>
        <li>Tin nhắn chỉ giữa phụ huynh và gia sư; số điện thoại, thư điện tử, liên kết, mạng xã hội bị che.</li>
        <li>
          Mọi buổi học với trẻ dưới 18 tuổi đều được ghi hình; bản ghi giữ 30 ngày (lâu hơn khi có khiếu nại, báo cáo),
          chỉ phụ huynh, gia sư của buổi và nhân viên nền tảng xem, không tải xuống.
        </li>
        <li>
          Báo cáo vi phạm ở hồ sơ gia sư, tin nhắn, buổi học; báo cáo nghiêm trọng thì gia sư bị tạm khóa ngay, các buổi
          sắp tới được hủy và hoàn đủ tiền.
        </li>
        <li>{SAFETY_HOTLINE}</li>
      </ul>
    </section>
  );
}

interface ThreadSummary {
  id: string;
  other_name: string;
  last_message_at: string;
}

interface ThreadView {
  id: string;
  tutor_id: string;
  parent_name: string;
  tutor_name: string;
  can_send: boolean;
  notice: string | null;
  messages: Array<{ id: string; role: 'parent' | 'tutor'; body: string; created_at: string }>;
}

const when = (value: string) => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

export function MessageThread({ id, role }: { id: string; role: 'parent' | 'tutor' }) {
  const [view, setView] = useState<ThreadView>();
  const [text, setText] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    marketRequest<ThreadView>('GET', `/messages/threads/${id}`)
      .then(setView)
      .catch((caught: unknown) => setError(errorText(caught)));
  }, [id]);
  useEffect(load, [load]);
  if (!view) return error ? <Alert tone="danger">{error}</Alert> : null;
  const other = role === 'parent' ? view.tutor_name : view.parent_name;
  return (
    <section
      aria-label={`Tin nhắn với ${other}`}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5"
    >
      <h3 className="font-semibold">Tin nhắn với {other}</h3>
      <p className="text-label text-text-secondary">
        Tin nhắn trên chợ được lưu để bảo vệ trẻ; số điện thoại, thư điện tử, liên kết, mạng xã hội sẽ bị che.
      </p>
      {view.notice ? <Alert tone="warning">{view.notice}</Alert> : null}
      {warning ? <Alert tone="warning">{warning}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ul aria-label="Các tin nhắn" className="flex flex-col gap-2">
        {view.messages.map((message) => (
          <li
            key={message.id}
            className={`flex max-w-[80%] flex-col gap-0.5 ${message.role === role ? 'self-end items-end' : 'self-start'}`}
          >
            <span className="text-label text-text-secondary">
              <strong>{message.role === role ? 'Bạn' : other}</strong> ({when(message.created_at)}):
            </span>
            <span
              className={`rounded-2xl px-3 py-2 ${message.role === role ? 'bg-brand text-white' : 'bg-page text-text'}`}
            >
              {message.body}
            </span>
          </li>
        ))}
      </ul>
      {view.can_send ? (
        <form
          className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            marketRequest<{ thread: ThreadView; warning: string | null }>('POST', `/messages/threads/${id}`, {
              body: text,
            })
              .then((result) => {
                setError(undefined);
                setWarning(result.warning);
                setText('');
                setView(result.thread);
              })
              .catch((caught: unknown) => setError(errorText(caught)));
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-label font-medium">
            Nội dung
            <input className={FORM_CONTROL_CLASS} value={text} onChange={(event) => setText(event.target.value)} />
          </label>
          <Button type="submit" variant="primary">
            Gửi tin nhắn
          </Button>
        </form>
      ) : null}
    </section>
  );
}

export function MessageInbox({ role }: { role: 'parent' | 'tutor' }) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [open, setOpen] = useState<string>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    marketRequest<{ threads: ThreadSummary[] }>('GET', '/messages/threads')
      .then((view) => setThreads(view.threads))
      .catch((caught: unknown) => setError(errorText(caught)));
  }, []);
  useEffect(load, [load]);
  return (
    <section aria-label="Tin nhắn" className="flex flex-col gap-3">
      <div>
        <h2 className="text-page-title font-bold">Tin nhắn</h2>
        <p className="text-text-secondary">
          {role === 'parent'
            ? 'Tin nhắn chỉ giữa bạn và gia sư; con không nhắn riêng với gia sư.'
            : 'Bạn chỉ nhắn với phụ huynh; học sinh không nhắn riêng với bạn.'}
        </p>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap items-start gap-4">
        <ul
          aria-label="Hộp thư"
          className="flex w-full max-w-xs flex-[1_1_240px] flex-col overflow-hidden rounded-2xl border border-border bg-card"
        >
          {threads.length === 0 ? <li className="p-4 text-text-secondary">Chưa có tin nhắn.</li> : null}
          {threads.map((thread) => (
            <li key={thread.id} className="border-b border-border last:border-0">
              <button
                type="button"
                aria-current={open === thread.id ? 'true' : undefined}
                className={`flex min-h-14 w-full flex-col items-start px-4 py-2 text-left ${
                  open === thread.id ? 'bg-selected' : 'hover:bg-page'
                }`}
                onClick={() => setOpen(thread.id)}
              >
                <span className="font-semibold">Mở tin nhắn với {thread.other_name}</span>
                <span className="text-label text-text-secondary">{when(thread.last_message_at)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-[999_1_420px]">
          {open ? <MessageThread key={open} id={open} role={role} /> : null}
        </div>
      </div>
    </section>
  );
}

export function ReportForm({
  subjectId,
  subjectName,
  targetKind,
  targetId,
}: {
  subjectId: string;
  subjectName: string;
  targetKind: 'profile' | 'message' | 'session' | 'review';
  targetId?: string;
}) {
  const [form, setForm] = useState({ category: 'child_safety', severity: 'high', description: '' });
  const [sent, setSent] = useState<{ suspended: boolean; hotline: string }>();
  const [error, setError] = useState<string>();
  return (
    <form
      aria-label={`Báo cáo vi phạm ${subjectName}`}
      className="flex flex-col gap-2 rounded-2xl border border-danger/30 bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        marketRequest<{ suspended: boolean; hotline: string }>('POST', '/reports', {
          subject_id: subjectId,
          target_kind: targetKind,
          ...(targetId ? { target_id: targetId } : {}),
          ...form,
        })
          .then((result) => {
            setError(undefined);
            setSent(result);
            setForm({ ...form, description: '' });
          })
          .catch((caught: unknown) => setError(errorText(caught)));
      }}
    >
      <h3 className="font-semibold">Báo cáo vi phạm</h3>
      <p role="note" className="rounded-lg bg-danger/10 p-3 text-label font-medium text-danger">
        {SAFETY_HOTLINE}
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {sent ? (
        <Alert tone="success">
          Đã gửi báo cáo. Nhân viên nền tảng sẽ xem xét trong thời hạn theo mức độ.
          {sent.suspended ? ' Gia sư đã bị tạm khóa trong lúc xem xét.' : ''}
        </Alert>
      ) : null}
      <label className="flex flex-col">
        Loại vi phạm
        <select
          aria-label="Loại vi phạm"
          className={FORM_CONTROL_CLASS}
          value={form.category}
          onChange={(event) => setForm({ ...form, category: event.target.value })}
        >
          {Object.entries(REPORT_CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col">
        Mức độ
        <select
          aria-label="Mức độ"
          className={FORM_CONTROL_CLASS}
          value={form.severity}
          onChange={(event) => setForm({ ...form, severity: event.target.value })}
        >
          {Object.entries(REPORT_SEVERITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col">
        Mô tả sự việc
        <textarea
          className={FORM_CONTROL_CLASS}
          rows={3}
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
      </label>
      <Button type="submit" variant="primary">
        Gửi báo cáo
      </Button>
    </form>
  );
}

// Phát bản ghi: tải về bộ nhớ của thẻ rồi phát, không có nút tải, không có ảnh trong ảnh; đóng là giải phóng
export function RecordingPlayer({ path, label }: { path: string; label: string }) {
  const [source, setSource] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    return () => {
      if (source) URL.revokeObjectURL(source);
    };
  }, [source]);
  if (source) {
    return (
      <video
        aria-label={label}
        src={source}
        controls
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture
        onContextMenu={(event) => event.preventDefault()}
        className="max-w-full"
      />
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button
        onClick={() =>
          void marketBlob(path)
            .then((blob) => setSource(URL.createObjectURL(blob)))
            .catch((caught: unknown) => setError(errorText(caught)))
        }
      >
        Xem bản ghi
      </Button>
    </div>
  );
}
