import { useState } from 'react';
import { Alert, Button, FORM_CONTROL_CLASS } from '@cho-gia-su/ui';
import { errorText, marketRequest } from './market-api.js';

// Mật khẩu và tên hiển thị của tài khoản chợ (YCTD-364; việc T-M5 của rà soát giao diện), dùng chung cho Chợ gia sư và ứng dụng Gia sư:
// quên mật khẩu (lấy mã 6 số rồi đặt mật khẩu mới), đổi mật khẩu khi đang đăng nhập, sửa tên hiển thị
const LABEL = 'flex flex-col gap-1 text-label font-medium';

export function ForgotPasswordForm({ onDone }: { onDone: () => void }) {
  const [login, setLogin] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  return (
    <form
      aria-label="Đặt lại mật khẩu"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!sent) {
          void marketRequest('POST', '/auth/password/forgot', { login })
            .then(() => {
              setError(undefined);
              setSent(true);
            })
            .catch((caught: unknown) => setError(errorText(caught)));
          return;
        }
        void marketRequest('POST', '/auth/password/reset', { login, code, new_password: password })
          .then(() => {
            setError(undefined);
            setDone(true);
          })
          .catch((caught: unknown) => setError(errorText(caught)));
      }}
    >
      <h2 className="text-section-title font-semibold">Đặt lại mật khẩu</h2>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {done ? (
        <>
          <Alert tone="success">Đã đặt mật khẩu mới. Mọi phiên đăng nhập cũ đã bị đăng xuất.</Alert>
          <Button variant="primary" onClick={onDone}>
            Về trang đăng nhập
          </Button>
        </>
      ) : (
        <>
          <label className={LABEL}>
            Thư điện tử hoặc số điện thoại đã đăng ký
            <input className={FORM_CONTROL_CLASS} value={login} onChange={(event) => setLogin(event.target.value)} />
          </label>
          {sent ? (
            <>
              <p className="text-label text-text-secondary">
                Nếu tài khoản tồn tại, mã 6 số đã được gửi tới thư điện tử hoặc số điện thoại (hiệu lực 10 phút).
              </p>
              <label className={LABEL}>
                Mã đặt lại
                <input
                  className={FORM_CONTROL_CLASS}
                  inputMode="numeric"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <label className={LABEL}>
                Mật khẩu mới (ít nhất 8 ký tự, có chữ và số)
                <input
                  className={FORM_CONTROL_CLASS}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary">
              {sent ? 'Đặt mật khẩu mới' : 'Gửi mã đặt lại'}
            </Button>
            <Button onClick={onDone}>Quay lại đăng nhập</Button>
          </div>
        </>
      )}
    </form>
  );
}

export function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  return (
    <form
      aria-label="Đổi mật khẩu"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void marketRequest('POST', '/auth/password/change', { current_password: current, new_password: next })
          .then(() => {
            setError(undefined);
            setCurrent('');
            setNext('');
            setMessage('Đã đổi mật khẩu. Các máy khác đã bị đăng xuất.');
          })
          .catch((caught: unknown) => setError(errorText(caught)));
      }}
    >
      <h3 className="font-semibold">Đổi mật khẩu</h3>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          Mật khẩu hiện tại
          <input
            className={FORM_CONTROL_CLASS}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </label>
        <label className={LABEL}>
          Mật khẩu mới
          <input
            className={FORM_CONTROL_CLASS}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </label>
      </div>
      <div>
        <Button type="submit">Đổi mật khẩu</Button>
      </div>
    </form>
  );
}

export function DisplayNameForm({ initial }: { initial: string }) {
  const [name, setName] = useState(initial);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  return (
    <form
      aria-label="Tên hiển thị"
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void marketRequest('PUT', '/me', { display_name: name })
          .then(() => {
            setError(undefined);
            setMessage('Đã lưu tên hiển thị');
          })
          .catch((caught: unknown) => setError(errorText(caught)));
      }}
    >
      <label className={`${LABEL} min-w-0 flex-[1_1_240px]`}>
        Tên hiển thị
        <input className={FORM_CONTROL_CLASS} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <Button type="submit">Lưu tên</Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}
    </form>
  );
}
