import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, FORM_CONTROL_CLASS, StatusBadge, type StatusTone } from '@cho-gia-su/ui';
import { errorText, marketRequest } from '../client/index.js';
import {
  STATUS_LABELS,
  uploadDocument,
  type Listing,
  type VerificationKind,
  type VerificationStatus,
} from './tutor-api.js';

// Các bước xác minh theo bản thiết kế duyệt ngày 2026-10-28 (YCTD-361): cột bước bên trái, biểu mẫu từng bước bên phải
const STEPS: Array<{ kind: VerificationKind; title: string; note: string }> = [
  { kind: 'identity', title: 'Danh tính, đủ 18 tuổi', note: 'Bắt buộc' },
  { kind: 'degree', title: 'Bằng cấp, chứng chỉ theo môn', note: 'Bắt buộc' },
  { kind: 'criminal_record', title: 'Phiếu lý lịch tư pháp', note: 'Bắt buộc, cấp trong 6 tháng' },
  {
    kind: 'business_registration',
    title: 'Đăng ký kinh doanh',
    note: 'Khi dạy môn chương trình phổ thông có thu tiền',
  },
];
const TONES: Record<VerificationStatus, StatusTone> = {
  none: 'neutral',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  expired: 'danger',
};
const CARD = 'rounded-2xl border border-border bg-card';

// Xác minh từng bậc của gia sư (DT-27 phần 27g, YCTD-257): danh tính qua nhà cung cấp định danh (chuyển sang trang của nhà cung cấp rồi
// quay về /xac-minh), bằng cấp, phiếu lý lịch tư pháp (cấp trong 6 tháng), đăng ký kinh doanh. Giấy tờ mã hóa ở máy chủ, chỉ nhân viên
// duyệt của nền tảng xem
const DOCUMENT_FIELDS: Record<
  Exclude<VerificationKind, 'identity'>,
  { title: string; fields: Array<{ name: string; label: string; type?: string }> }
> = {
  degree: {
    title: 'Bằng cấp',
    fields: [
      { name: 'title', label: 'Tên văn bằng, chứng chỉ' },
      { name: 'institution', label: 'Nơi cấp' },
    ],
  },
  criminal_record: {
    title: 'Phiếu lý lịch tư pháp',
    fields: [{ name: 'issued_on', label: 'Ngày cấp', type: 'date' }],
  },
  business_registration: {
    title: 'Đăng ký kinh doanh (bắt buộc khi dạy môn của chương trình phổ thông có thu tiền)',
    fields: [{ name: 'registration_no', label: 'Số đăng ký kinh doanh' }],
  },
};

export function TutorVerification({ listing, onChange }: { listing: Listing; onChange: (next: Listing) => void }) {
  const [providers, setProviders] = useState<Array<{ code: string; display_name: string }>>([]);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    marketRequest<Array<{ code: string; display_name: string }>>('GET', '/identity/providers')
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  const verifyIdentity = (provider: string) => {
    marketRequest<{ authorization_url: string }>('POST', '/identity/start', {
      provider,
      purpose: 'verify',
      return_url: `${window.location.origin}/xac-minh`,
    })
      .then((result) => window.location.assign(result.authorization_url))
      .catch((caught: unknown) => setError(errorText(caught)));
  };

  const submitDocument = (kind: Exclude<VerificationKind, 'identity'>) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    uploadDocument(kind, form)
      .then((next) => {
        setError(undefined);
        setMessage(`Đã nộp ${DOCUMENT_FIELDS[kind].title.toLowerCase()}, chờ nền tảng duyệt`);
        onChange(next);
      })
      .catch((caught: unknown) => setError(errorText(caught)));
  };

  const state = listing.verification_state;
  return (
    <section aria-label="Xác minh gia sư" className="flex flex-col gap-4">
      <div>
        <h2 className="text-page-title font-bold">Xác minh để nhận học sinh</h2>
        <p className="text-text-secondary">
          Hồ sơ chỉ hiện ở chợ khi xong các bước bắt buộc và nền tảng duyệt. Giấy tờ chỉ nhân viên duyệt của nền tảng
          xem; phụ huynh chỉ thấy huy hiệu.
        </p>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}
      <div className="flex flex-wrap items-start gap-5">
        <ol
          aria-label="Các bước xác minh"
          className={`${CARD} flex w-full max-w-sm flex-[1_1_260px] flex-col px-5 py-2`}
        >
          {STEPS.map((step, index) => (
            <li key={step.kind} className="flex items-start gap-3 border-b border-border py-3 last:border-0">
              <span
                aria-hidden="true"
                className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full font-semibold ${
                  state[step.kind] === 'approved' ? 'bg-success/10 text-success' : 'bg-page text-text-secondary'
                }`}
              >
                {state[step.kind] === 'approved' ? '✓' : index + 1}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <strong>{step.title}</strong>
                <span className="text-label text-text-secondary">{step.note}</span>
                <StatusBadge tone={TONES[state[step.kind]]} label={STATUS_LABELS[state[step.kind]]} />
              </span>
            </li>
          ))}
        </ol>
        <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-4">
          <section className={`${CARD} flex flex-col gap-3 p-6`} aria-label="Danh tính">
            <h3 className="text-section-title font-semibold">Danh tính (đủ 18 tuổi)</h3>
            <p className="text-label text-text-secondary">
              Đăng nhập bằng tài khoản định danh để nền tảng biết bạn là ai và đủ 18 tuổi. Nền tảng nhận họ tên, ngày
              sinh, kết quả xác thực; số định danh không hiện cho ai.
            </p>
            <p>
              Trạng thái: <strong>{STATUS_LABELS[state.identity]}</strong>
              {listing.verifications.identity?.note ? ` – ${listing.verifications.identity.note}` : ''}
            </p>
            {state.identity !== 'approved' ? (
              providers.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {providers.map((provider) => (
                    <Button key={provider.code} variant="primary" onClick={() => verifyIdentity(provider.code)}>
                      Xác minh bằng {provider.display_name}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-text-secondary">Nền tảng chưa khai nhà cung cấp định danh.</p>
              )
            ) : null}
          </section>
          {(Object.keys(DOCUMENT_FIELDS) as Array<Exclude<VerificationKind, 'identity'>>).map((kind) => (
            <form
              key={kind}
              aria-label={DOCUMENT_FIELDS[kind].title}
              className={`${CARD} flex flex-col gap-3 p-6`}
              onSubmit={submitDocument(kind)}
            >
              <h3 className="text-section-title font-semibold">{DOCUMENT_FIELDS[kind].title}</h3>
              <p>
                Trạng thái: <strong>{STATUS_LABELS[state[kind]]}</strong>
                {listing.verifications[kind]?.note ? ` – ${listing.verifications[kind]?.note}` : ''}
                {listing.verifications[kind]?.valid_until
                  ? ` (hiệu lực đến ${listing.verifications[kind]?.valid_until})`
                  : ''}
              </p>
              {listing.uploads_enabled ? (
                <>
                  {DOCUMENT_FIELDS[kind].fields.map((field) => (
                    <label key={field.name} className="flex flex-col gap-1 text-label font-medium">
                      {field.label}
                      <input className={FORM_CONTROL_CLASS} name={field.name} type={field.type ?? 'text'} required />
                    </label>
                  ))}
                  <label className="flex flex-col gap-1 text-label font-medium">
                    Tệp (PDF, JPEG, PNG, tối đa 10 MB)
                    <input
                      className={FORM_CONTROL_CLASS}
                      name="file"
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      required
                    />
                  </label>
                  <Button type="submit">Nộp {DOCUMENT_FIELDS[kind].title.split(' (')[0]?.toLowerCase()}</Button>
                </>
              ) : (
                <p className="text-text-secondary">Nền tảng chưa bật nhận tệp giấy tờ.</p>
              )}
            </form>
          ))}
        </div>
      </div>
    </section>
  );
}
