import { useCallback, useEffect, useState } from 'react';
import { AdminApiError } from './admin-api.js';

// Hàng chờ duyệt gia sư ở cổng nền tảng (DT-27 phần 27g, YCTD-257): hồ sơ chờ duyệt, giấy tờ chờ duyệt (bằng cấp, lý lịch tư pháp, đăng
// ký kinh doanh); xem tệp (máy chủ giải mã, ghi nhật ký mỗi lần xem); duyệt hoặc từ chối có lý do. Duyệt hồ sơ chỉ khi đủ điều kiện hiện
// công khai
const KIND_LABELS: Record<string, string> = {
  identity: 'Danh tính',
  degree: 'Bằng cấp',
  criminal_record: 'Lý lịch tư pháp',
  business_registration: 'Đăng ký kinh doanh',
};
const STATE_LABELS: Record<string, string> = {
  none: 'chưa nộp',
  pending: 'chờ duyệt',
  approved: 'đã duyệt',
  rejected: 'bị từ chối',
  expired: 'hết hiệu lực',
};

interface Queue {
  profiles: Array<{ id: string; display_name: string; updated_at: string }>;
  verifications: Array<{ id: string; display_name: string; kind: string; submitted_at: string }>;
}

interface TutorReview {
  id: string;
  display_name: string;
  profile: { headline: string; bio: string } | null;
  listing: {
    status: string;
    teaching_language: string;
    subjects: Array<{
      subject: string;
      school_level: string;
      grade_from: number;
      grade_to: number;
      content_kind: string;
      price_per_session: number;
    }>;
  };
  verifications: Array<{ kind: string; status: string; details: Record<string, string>; note: string | null }>;
  verification_state: Record<string, string>;
  documents: Array<{ id: string; kind: string; file_name: string }>;
  school_role: { school_name: string; is_public: boolean; subjects: string; grades: string } | null;
  approval_blockers: string[];
}

async function reviewCall<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1/market/admin/reviews${path}`, {
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

function TutorDetail({ token, id, onDone }: { token: string; id: string; onDone: () => void }) {
  const [review, setReview] = useState<TutorReview>();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    reviewCall<TutorReview>(token, 'GET', `/tutors/${id}`)
      .then((next) => {
        if (active) setReview(next);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof AdminApiError ? caught.message : 'Không đọc được hồ sơ');
      });
    return () => {
      active = false;
    };
  }, [token, id]);

  const decide = (path: string, decision: 'approve' | 'reject') =>
    reviewCall<TutorReview>(token, 'POST', path, { decision, note })
      .then((next) => {
        setError(null);
        setNote('');
        setReview(next);
        onDone();
      })
      .catch((caught: unknown) => setError(caught instanceof AdminApiError ? caught.message : 'Không thực hiện được'));

  // Mở tệp trong thẻ mới: lấy bằng mã phiên rồi mở bản trong bộ nhớ, không để tệp trong đường dẫn có thể chia sẻ
  const openDocument = async (documentId: string) => {
    const response = await fetch(`/api/v1/market/admin/reviews/documents/${documentId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      setError('Không mở được tệp');
      return;
    }
    window.open(URL.createObjectURL(await response.blob()), '_blank', 'noopener');
  };

  if (!review) return error ? <p role="alert">{error}</p> : <p>Đang tải…</p>;
  const pendingKinds = review.verifications.filter((row) => row.status === 'pending' && row.kind !== 'identity');
  return (
    <section aria-label={`Duyệt gia sư ${review.display_name}`}>
      <h4>{review.display_name}</h4>
      {error ? <p role="alert">{error}</p> : null}
      <p>{review.profile?.headline}</p>
      <ul aria-label="Trạng thái xác minh">
        {Object.entries(review.verification_state).map(([kind, state]) => (
          <li key={kind}>
            {KIND_LABELS[kind]}: {STATE_LABELS[state] ?? state}
          </li>
        ))}
      </ul>
      {review.school_role ? (
        <p>
          Giáo viên đang dạy ở {review.school_role.school_name} (
          {review.school_role.is_public ? 'công lập' : 'ngoài công lập'}), môn {review.school_role.subjects}, lớp{' '}
          {review.school_role.grades}
        </p>
      ) : null}
      <table aria-label="Môn dạy của gia sư">
        <tbody>
          {review.listing.subjects.map((item, index) => (
            <tr key={index}>
              <td>{item.subject}</td>
              <td>
                {item.school_level} {item.grade_from}–{item.grade_to}
              </td>
              <td>{item.content_kind === 'curriculum' ? 'Chương trình phổ thông' : 'Năng khiếu, kỹ năng'}</td>
              <td>{item.price_per_session.toLocaleString('vi-VN')} đồng</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul aria-label="Giấy tờ">
        {review.documents.map((document) => (
          <li key={document.id}>
            {KIND_LABELS[document.kind]}: {document.file_name}{' '}
            <button type="button" onClick={() => void openDocument(document.id)}>
              Xem tệp {KIND_LABELS[document.kind]}
            </button>
          </li>
        ))}
      </ul>
      <label>
        Ghi chú, lý do (bắt buộc khi từ chối)
        <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {pendingKinds.map((row) => (
        <p key={row.kind}>
          {KIND_LABELS[row.kind]} ({Object.values(row.details).join(', ')}):{' '}
          <button
            type="button"
            onClick={() => void decide(`/tutors/${review.id}/verifications/${row.kind}`, 'approve')}
          >
            Duyệt {KIND_LABELS[row.kind]}
          </button>{' '}
          <button type="button" onClick={() => void decide(`/tutors/${review.id}/verifications/${row.kind}`, 'reject')}>
            Từ chối {KIND_LABELS[row.kind]}
          </button>
        </p>
      ))}
      {review.listing.status === 'submitted' ? (
        <div>
          {review.approval_blockers.length > 0 ? (
            <ul aria-label="Chưa duyệt hồ sơ được vì">
              {review.approval_blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            disabled={review.approval_blockers.length > 0}
            onClick={() => void decide(`/tutors/${review.id}/profile`, 'approve')}
          >
            Duyệt hồ sơ
          </button>{' '}
          <button type="button" onClick={() => void decide(`/tutors/${review.id}/profile`, 'reject')}>
            Từ chối hồ sơ
          </button>
        </div>
      ) : (
        <p>Hồ sơ: {review.listing.status}</p>
      )}
    </section>
  );
}

export function MarketReviews({ token }: { token: string }) {
  const [queue, setQueue] = useState<Queue>();
  const [open, setOpen] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    reviewCall<Queue>(token, 'GET', '')
      .then(setQueue)
      .catch((caught: unknown) =>
        setError(caught instanceof AdminApiError ? caught.message : 'Không đọc được hàng chờ'),
      );
  }, [token]);
  useEffect(load, [load]);
  const ids = [
    ...new Map([...(queue?.profiles ?? []), ...(queue?.verifications ?? [])].map((row) => [row.id, row.display_name])),
  ];
  return (
    <section aria-label="Hàng chờ duyệt gia sư">
      <h3>Hàng chờ duyệt gia sư</h3>
      {error ? <p role="alert">{error}</p> : null}
      {queue && ids.length === 0 ? <p>Không có hồ sơ, giấy tờ chờ duyệt.</p> : null}
      <ul>
        {ids.map(([id, name]) => (
          <li key={id}>
            {name} {queue?.profiles.some((row) => row.id === id) ? '(hồ sơ chờ duyệt) ' : ''}
            {queue?.verifications
              .filter((row) => row.id === id)
              .map((row) => KIND_LABELS[row.kind])
              .join(', ')}{' '}
            <button type="button" onClick={() => setOpen(id)}>
              Mở {name}
            </button>
          </li>
        ))}
      </ul>
      {open ? <TutorDetail key={open} token={token} id={open} onDone={load} /> : null}
    </section>
  );
}
