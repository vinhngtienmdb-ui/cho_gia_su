import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, FORM_CONTROL_CLASS, StatusBadge } from '@cho-gia-su/ui';
import { ChangePasswordForm, DisplayNameForm, errorText, marketRequest, type Me } from '../client/index.js';
import { CARD_CLASS } from '../styles.js';

// Đánh giá của phụ huynh về gia sư và tài khoản của gia sư (YCTD-364; thiết kế duyệt ngày 2026-10-28): đánh giá chờ duyệt, đã hiện;
// gia sư trả lời một lần đánh giá đã hiện (nhân viên nền tảng duyệt trước khi hiện); đổi mật khẩu, sửa tên hiển thị
interface Review {
  id: string;
  grade: number;
  rating: number;
  body: string;
  status: 'pending' | 'published';
  reply_body: string | null;
  created_at: string;
}

function ReplyForm({ review, onDone }: { review: Review; onDone: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  return (
    <form
      aria-label="Trả lời đánh giá"
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void marketRequest('POST', `/tutor/reviews/${review.id}/reply`, { body: text })
          .then(onDone)
          .catch((caught: unknown) => setError(errorText(caught)));
      }}
    >
      <label className="flex min-w-0 flex-[1_1_320px] flex-col gap-1 text-label font-medium">
        Trả lời (một lần, hiện công khai dưới đánh giá)
        <input className={FORM_CONTROL_CLASS} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <Button type="submit">Gửi trả lời</Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </form>
  );
}

export function TutorReviews() {
  const [reviews, setReviews] = useState<Review[]>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    marketRequest<{ reviews: Review[] }>('GET', '/tutor/reviews')
      .then((view) => setReviews(view.reviews))
      .catch((caught: unknown) => setError(errorText(caught)));
  }, []);
  useEffect(load, [load]);
  return (
    <section aria-label="Đánh giá" className="flex flex-col gap-4">
      <div>
        <h2 className="text-page-title font-bold">Đánh giá</h2>
        <p className="text-text-secondary">
          Phụ huynh đánh giá sau buổi đã dạy. Đánh giá hiện ở trang của bạn sau khi nền tảng duyệt; bạn trả lời được một
          lần.
        </p>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {reviews && reviews.length === 0 ? <p className="text-text-secondary">Chưa có đánh giá nào.</p> : null}
      <ul className="flex flex-col gap-3">
        {(reviews ?? []).map((review) => (
          <li key={review.id} className={`${CARD_CLASS} flex flex-col gap-2 p-5`}>
            <div className="flex flex-wrap items-center gap-3">
              <strong>Phụ huynh học sinh lớp {review.grade}</strong>
              <span className="font-semibold text-warning">{review.rating} sao</span>
              <StatusBadge
                tone={review.status === 'published' ? 'success' : 'warning'}
                label={review.status === 'published' ? 'Đang hiện' : 'Chờ nền tảng duyệt'}
              />
            </div>
            {review.body ? <p className="whitespace-pre-wrap">{review.body}</p> : null}
            {review.reply_body ? (
              <p className="rounded-xl bg-page p-3">
                <span className="font-semibold">Bạn đã trả lời: </span>
                {review.reply_body}
              </p>
            ) : review.status === 'published' ? (
              <ReplyForm review={review} onDone={load} />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TutorAccount() {
  const [me, setMe] = useState<Me>();
  useEffect(() => {
    marketRequest<Me>('GET', '/me')
      .then(setMe)
      .catch(() => setMe(undefined));
  }, []);
  if (!me) return null;
  return (
    <section aria-label="Tài khoản" className={`${CARD_CLASS} flex flex-col gap-4 p-6`}>
      <h2 className="text-section-title font-semibold">Tài khoản</h2>
      <DisplayNameForm initial={me.display_name} />
      <div className="border-t border-border pt-4">
        <ChangePasswordForm />
      </div>
    </section>
  );
}
