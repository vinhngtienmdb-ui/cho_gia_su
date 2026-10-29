import { useEffect, useState } from 'react';
import { Alert, Button, FORM_CONTROL_CLASS } from '@cho-gia-su/ui';
import { errorText, marketRequest } from '../client/index.js';

// Khu gia sư của chợ (DT-27 phần 27f): hồ sơ tối thiểu (dòng giới thiệu, giới thiệu ngắn) và cơ sở dạy thêm đứng tên. Môn, cấp, giá, lịch,
// xác minh danh tính, lý lịch tư pháp, trang công khai theo Mẫu 02 làm ở 27g
interface TutorView {
  display_name: string;
  profile: { headline: string; bio: string; status: string };
  provider: { kind: 'individual' | 'organization'; name: string; business_registration_no: string | null } | null;
}

export function TutorArea() {
  const [profile, setProfile] = useState({ headline: '', bio: '' });
  const [provider, setProvider] = useState({ kind: 'individual', name: '', business_registration_no: '' });
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const apply = (view: TutorView) => {
    setProfile({ headline: view.profile.headline, bio: view.profile.bio });
    setProvider({
      kind: view.provider?.kind ?? 'individual',
      name: view.provider?.name ?? view.display_name,
      business_registration_no: view.provider?.business_registration_no ?? '',
    });
  };
  useEffect(() => {
    marketRequest<TutorView>('GET', '/tutor/profile')
      .then(apply)
      .catch((caught: unknown) => setError(errorText(caught)));
  }, []);
  const save = (path: string, body: unknown, done: string) =>
    marketRequest<TutorView>('PUT', path, body)
      .then((view) => {
        apply(view);
        setError(undefined);
        setMessage(done);
      })
      .catch((caught: unknown) => setError(errorText(caught)));

  return (
    <section aria-label="Hồ sơ gia sư" className="rounded-2xl border border-border bg-card flex flex-col gap-4 p-6">
      <h2 className="text-section-title font-semibold">Giới thiệu và cơ sở dạy thêm</h2>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}
      <p className="text-label text-text-secondary">
        Không ghi số điện thoại, mạng xã hội, liên kết ngoài. Hồ sơ chỉ hiện ở Chợ gia sư khi đã xác minh và nền tảng
        duyệt.
      </p>
      <form
        aria-label="Giới thiệu gia sư"
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save('/tutor/profile', profile, 'Đã lưu giới thiệu');
        }}
      >
        <label className="flex flex-col gap-1 text-label font-medium">
          Dòng giới thiệu
          <input
            className={FORM_CONTROL_CLASS}
            value={profile.headline}
            onChange={(event) => setProfile({ ...profile, headline: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-label font-medium">
          Giới thiệu ngắn
          <textarea
            className={FORM_CONTROL_CLASS}
            rows={4}
            value={profile.bio}
            onChange={(event) => setProfile({ ...profile, bio: event.target.value })}
          />
        </label>
        <Button type="submit" variant="primary">
          Lưu giới thiệu
        </Button>
      </form>
      <form
        aria-label="Cơ sở dạy thêm"
        className="flex flex-col gap-3 border-t border-border pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save('/tutor/provider', provider, 'Đã lưu cơ sở dạy thêm');
        }}
      >
        <h3 className="font-semibold">Cơ sở dạy thêm đứng tên</h3>
        <label className="flex flex-col gap-1 text-label font-medium">
          Loại
          <select
            className={FORM_CONTROL_CLASS}
            value={provider.kind}
            onChange={(event) => setProvider({ ...provider, kind: event.target.value })}
          >
            <option value="individual">Cá nhân</option>
            <option value="organization">Tổ chức</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-label font-medium">
          Tên cơ sở
          <input
            className={FORM_CONTROL_CLASS}
            value={provider.name}
            onChange={(event) => setProvider({ ...provider, name: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-label font-medium">
          Số đăng ký kinh doanh (nếu có)
          <input
            className={FORM_CONTROL_CLASS}
            value={provider.business_registration_no}
            onChange={(event) => setProvider({ ...provider, business_registration_no: event.target.value })}
          />
        </label>
        <Button type="submit">Lưu cơ sở dạy thêm</Button>
      </form>
    </section>
  );
}
