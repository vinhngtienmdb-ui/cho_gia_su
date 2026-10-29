import { useState, type FormEvent } from 'react';
import { Alert, Button, FORM_CONTROL_CLASS } from '@cho-gia-su/ui';
import { errorText, marketRequest, type Site } from './market-api.js';

// Đăng ký, xác nhận mã, đăng nhập của chợ gia sư (DT-27 phần 27f): đăng ký phải tích đồng ý từng văn bản bắt buộc của vai (phiên bản
// mới nhất); tài khoản chờ xác nhận đến khi nhập mã 6 số gửi tới thư điện tử hoặc số điện thoại. Ứng dụng chung (YCTD-368): người đăng
// ký chọn loại tài khoản; mỗi tài khoản một loại (GD-185), ai cần cả hai vai thì đăng ký thêm bằng thư điện tử hoặc số điện thoại khác
const REQUIRED: Record<'parent' | 'tutor', string[]> = {
  parent: ['terms', 'privacy'],
  tutor: ['terms', 'privacy', 'tutor_terms'],
};

const KIND_OPTIONS: Array<{ kind: 'parent' | 'tutor'; label: string }> = [
  { kind: 'parent', label: 'Phụ huynh tìm gia sư cho con' },
  { kind: 'tutor', label: 'Gia sư, kể cả giáo viên dạy kèm ngoài trường' },
];

export function RegisterForm({
  initialKind = 'parent',
  site,
  onRegistered,
  onOpenDocument,
}: {
  initialKind?: 'parent' | 'tutor';
  site: Site;
  onRegistered: (token: string) => void;
  onOpenDocument: (kind: string) => void;
}) {
  const [kind, setKind] = useState(initialKind);
  const [form, setForm] = useState({
    contact: '',
    display_name: '',
    password: '',
  });
  const [accepted, setAccepted] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const documents = site.documents.filter((row) => REQUIRED[kind].includes(row.kind));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const contact = form.contact.trim();
    marketRequest<{ session_token: string }>('POST', '/auth/register', {
      kind,
      ...(contact.includes('@') ? { email: contact } : { phone: contact }),
      display_name: form.display_name,
      password: form.password,
      accepted_document_ids: accepted,
    })
      .then((result) => onRegistered(result.session_token))
      .catch((caught: unknown) => setError(errorText(caught)));
  };

  return (
    <form aria-label="Đăng ký tài khoản chợ gia sư" className="flex flex-col gap-2" onSubmit={submit}>
      <h2 className="text-section-title font-semibold">Đăng ký</h2>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <fieldset className="flex flex-col gap-1">
        <legend>Bạn đăng ký với tư cách</legend>
        {KIND_OPTIONS.map((option) => (
          <label key={option.kind} className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="loai-tai-khoan"
              checked={kind === option.kind}
              onChange={() => {
                setKind(option.kind);
                setAccepted([]);
              }}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col">
        Thư điện tử hoặc số điện thoại
        <input
          className={FORM_CONTROL_CLASS}
          value={form.contact}
          onChange={(event) => setForm({ ...form, contact: event.target.value })}
        />
      </label>
      <label className="flex flex-col">
        Tên hiển thị
        <input
          className={FORM_CONTROL_CLASS}
          value={form.display_name}
          onChange={(event) => setForm({ ...form, display_name: event.target.value })}
        />
      </label>
      <label className="flex flex-col">
        Mật khẩu (ít nhất 8 ký tự, có chữ và số)
        <input
          className={FORM_CONTROL_CLASS}
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
        />
      </label>
      {documents.map((row) => (
        <div key={row.id} className="flex flex-wrap items-center gap-2">
          <label>
            <input
              type="checkbox"
              checked={accepted.includes(row.id)}
              onChange={(event) =>
                setAccepted(event.target.checked ? [...accepted, row.id] : accepted.filter((id) => id !== row.id))
              }
            />{' '}
            Tôi đồng ý {row.title}
          </label>
          <button type="button" className="underline" onClick={() => onOpenDocument(row.kind)}>
            Đọc
          </button>
        </div>
      ))}
      <Button type="submit" variant="primary">
        Tạo tài khoản
      </Button>
    </form>
  );
}

export function VerifyForm({ onVerified }: { onVerified: () => void }) {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  return (
    <form
      aria-label="Xác nhận tài khoản"
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        marketRequest('POST', '/auth/verify', { code })
          .then(onVerified)
          .catch((caught: unknown) => setError(errorText(caught)));
      }}
    >
      <h2 className="text-section-title font-semibold">Xác nhận tài khoản</h2>
      <p>Nhập mã 6 số đã gửi tới thư điện tử hoặc số điện thoại của bạn (hiệu lực 10 phút).</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}
      <label className="flex flex-col">
        Mã xác nhận
        <input
          className={FORM_CONTROL_CLASS}
          inputMode="numeric"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          Xác nhận
        </Button>
        <Button
          onClick={() =>
            void marketRequest('POST', '/auth/resend')
              .then(() => setMessage('Đã gửi mã mới'))
              .catch((caught: unknown) => setError(errorText(caught)))
          }
        >
          Gửi lại mã
        </Button>
      </div>
    </form>
  );
}

export function LoginForm({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  return (
    <form
      aria-label="Đăng nhập chợ gia sư"
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        marketRequest<{ session_token: string }>('POST', '/auth/login', { login, password })
          .then((result) => onSignedIn(result.session_token))
          .catch((caught: unknown) => setError(errorText(caught)));
      }}
    >
      <h2 className="text-section-title font-semibold">Đăng nhập</h2>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <label className="flex flex-col">
        Thư điện tử hoặc số điện thoại
        <input className={FORM_CONTROL_CLASS} value={login} onChange={(event) => setLogin(event.target.value)} />
      </label>
      <label className="flex flex-col">
        Mật khẩu
        <input
          className={FORM_CONTROL_CLASS}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <Button type="submit" variant="primary">
        Đăng nhập
      </Button>
    </form>
  );
}
