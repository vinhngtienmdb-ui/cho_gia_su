import { useCallback, useEffect, useState } from 'react';
import { AdminApiError } from './admin-api.js';

// Duyệt đánh giá gia sư ở cổng vận hành (YCTD-363; máy chủ YCTD-364): đánh giá của phụ huynh chờ duyệt rồi mới hiện ở trang gia sư.
// Nhân viên nền tảng hiện hoặc từ chối có lý do; số điện thoại, thư điện tử trong lời đánh giá đã bị che, bản gốc chỉ hiện ở đây
interface PendingReview {
  id: string;
  rating: number;
  body: string;
  original_body: string | null;
  created_at: string;
  tutor_name: string;
}

async function moderationCall<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/market/admin/reviews-moderation${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; details?: Array<{ message: string }> };
    };
    throw new AdminApiError(
      response.status,
      [payload.error?.message, ...(payload.error?.details ?? []).map((detail) => detail.message)]
        .filter(Boolean)
        .join('. ') || 'Không thực hiện được',
    );
  }
  return (await response.json()) as T;
}

function ReviewItem({ token, review, onDone }: { token: string; review: PendingReview; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = (decision: 'publish' | 'reject') => {
    setError(null);
    moderationCall(token, 'POST', `/${review.id}`, { decision, note })
      .then(onDone)
      .catch((caught: unknown) => setError(caught instanceof AdminApiError ? caught.message : 'Không thực hiện được'));
  };
  return (
    <li aria-label={`Đánh giá gia sư ${review.tutor_name}`}>
      <p>
        <strong>{review.tutor_name}</strong> · {review.rating}/5 · {new Date(review.created_at).toLocaleString('vi-VN')}
      </p>
      <blockquote>{review.body}</blockquote>
      {review.original_body && review.original_body !== review.body ? (
        <p>Bản gốc trước khi che thông tin liên hệ: {review.original_body}</p>
      ) : null}
      <label>
        Lý do (bắt buộc khi từ chối)
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} />
      </label>{' '}
      <button type="button" onClick={() => decide('publish')}>
        Hiện đánh giá
      </button>{' '}
      <button type="button" onClick={() => decide('reject')}>
        Từ chối
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </li>
  );
}

export function MarketReviewModeration({ token }: { token: string }) {
  const [reviews, setReviews] = useState<PendingReview[]>();
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    moderationCall<{ reviews: PendingReview[] }>(token, 'GET', '')
      .then((reply) => setReviews(reply.reviews))
      .catch((caught: unknown) =>
        setError(caught instanceof AdminApiError ? caught.message : 'Không đọc được đánh giá chờ duyệt'),
      );
  }, [token]);
  useEffect(load, [load]);
  return (
    <section aria-label="Đánh giá chờ duyệt">
      <h3>Đánh giá gia sư chờ duyệt</h3>
      {error ? <p role="alert">{error}</p> : null}
      {reviews && reviews.length === 0 ? <p>Không có đánh giá chờ duyệt.</p> : null}
      <ul>
        {(reviews ?? []).map((review) => (
          <ReviewItem key={review.id} token={token} review={review} onDone={load} />
        ))}
      </ul>
    </section>
  );
}
