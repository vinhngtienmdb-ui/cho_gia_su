import { useEffect, useState } from 'react';
import { Alert, Button, StatusBadge } from '@cho-gia-su/ui';
import { errorText, marketRequest } from './client/index.js';

// Đánh giá sau buổi của phụ huynh (YCTD-364; thiết kế duyệt ngày 2026-10-28): 1 đến 5 sao, bốn tiêu chí không bắt buộc, nhận xét; được
// duyệt trước khi hiện; mỗi buổi một đánh giá. Có điều không an toàn thì dùng báo cáo vi phạm, không chỉ ghi ở đây
const CRITERIA = [
  { key: 'punctuality', label: 'Đúng giờ' },
  { key: 'clarity', label: 'Giảng dễ hiểu' },
  { key: 'progress', label: 'Con tiến bộ' },
  { key: 'communication', label: 'Trao đổi với phụ huynh' },
] as const;
const STATUS = {
  pending: { label: 'Đang chờ duyệt', tone: 'warning' },
  published: { label: 'Đã hiện ở trang gia sư', tone: 'success' },
  rejected: { label: 'Không được duyệt', tone: 'neutral' },
} as const;

interface MyReview {
  id: string;
  rating: number;
  body: string;
  status: keyof typeof STATUS;
  reply_body: string | null;
}

function Scale({ name, value, onChange }: { name: string; value: number; onChange: (next: number) => void }) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-1">
      {[1, 2, 3, 4, 5].map((option) => (
        <label
          key={option}
          className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border ${
            value === option ? 'border-brand bg-brand text-white' : 'border-border-strong bg-card'
          }`}
        >
          <input
            type="radio"
            className="sr-only"
            name={name}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          {option}
        </label>
      ))}
    </div>
  );
}

export function ReviewPanel({ bookingId, tutorName }: { bookingId: string; tutorName: string }) {
  const [existing, setExisting] = useState<MyReview | null>();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [criteria, setCriteria] = useState<Record<string, number>>({});
  const [body, setBody] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    marketRequest<{ review: MyReview | null }>('GET', `/bookings/${bookingId}/review`)
      .then((view) => setExisting(view.review))
      .catch(() => setExisting(null));
  }, [bookingId]);
  if (existing === undefined) return null;
  if (existing) {
    const status = STATUS[existing.status];
    return (
      <div className="flex flex-wrap items-center gap-2 text-label">
        <span>Bạn đã đánh giá {existing.rating} sao.</span>
        <StatusBadge tone={status.tone} label={status.label} />
        {existing.reply_body ? <span>Gia sư trả lời: {existing.reply_body}</span> : null}
        {warning ? <Alert tone="warning">{warning}</Alert> : null}
      </div>
    );
  }
  if (!open) {
    return (
      <div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          Đánh giá buổi học
        </Button>
      </div>
    );
  }
  return (
    <form
      aria-label={`Đánh giá buổi học với ${tutorName}`}
      className="flex flex-col gap-3 rounded-xl border border-border bg-page p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void marketRequest<{ id: string; status: MyReview['status']; warning: string | null }>(
          'POST',
          `/bookings/${bookingId}/review`,
          { rating, ...criteria, body },
        )
          .then((result) => {
            setError(undefined);
            setWarning(result.warning);
            setExisting({ id: result.id, rating, body, status: result.status, reply_body: null });
          })
          .catch((caught: unknown) => setError(errorText(caught)));
      }}
    >
      <h3 className="font-semibold">Nhìn chung, bạn hài lòng đến đâu?</h3>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Scale name="Số sao" value={rating} onChange={setRating} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-label font-semibold">Chi tiết (không bắt buộc)</legend>
        {CRITERIA.map((item) => (
          <div key={item.key} className="flex flex-wrap items-center justify-between gap-2">
            <span>{item.label}</span>
            <Scale
              name={item.label}
              value={criteria[item.key] ?? 0}
              onChange={(next) => setCriteria({ ...criteria, [item.key]: next })}
            />
          </div>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-label font-medium">
        Nhận xét
        <textarea
          className="rounded-lg border border-border-strong bg-card p-3"
          rows={4}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <span className="font-normal text-text-secondary">
          Không ghi tên đầy đủ, trường, số điện thoại của con. Đánh giá hiện với tên "Phụ huynh học sinh lớp N".
        </span>
      </label>
      <p role="note" className="rounded-lg bg-danger/10 p-3 text-label text-danger">
        Có điều làm con không an toàn? Dùng nút "Báo cáo vi phạm" của buổi để nền tảng xử lý ngay và giữ bằng chứng.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={rating === 0}>
          Gửi đánh giá
        </Button>
        <Button onClick={() => setOpen(false)}>Để sau</Button>
      </div>
    </form>
  );
}
