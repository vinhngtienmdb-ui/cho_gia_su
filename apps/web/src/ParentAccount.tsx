import { useEffect, useState } from 'react';
import { Alert, Button, FORM_CONTROL_CLASS } from '@cho-gia-su/ui';
import {
  ChangePasswordForm,
  DisplayNameForm,
  errorText,
  marketRequest,
  writeSession,
  type Me,
} from './client/index.js';
import { CARD_CLASS } from './styles.js';

// Tài khoản phụ huynh ở Chợ gia sư (YCTD-364; thiết kế duyệt ngày 2026-10-28; việc T-M5, T-M6, T-M9 của rà soát giao diện): thông tin
// tài khoản, tên hiển thị, đổi mật khẩu, liên kết và đăng nhập bằng tài khoản định danh (bộ nối OIDC của DT-25, cùng cách gắn lượt chuyển
// hướng với trình duyệt của PR 242), chế độ con đọc tin nhắn (chỉ đọc, thoát phải nhập mật khẩu phụ huynh)
// Ứng dụng chung (YCTD-368): đăng nhập bằng định danh và liên kết của phụ huynh quay về /dinh-danh, xác minh danh tính của gia sư quay
// về /xac-minh (giữ đường dẫn của ứng dụng Gia sư cũ để liên kết đã đăng ký ở nhà cung cấp vẫn dùng được qua chuyển hướng tên miền)
export const IDENTITY_RETURN_PATH = '/dinh-danh';
export const VERIFY_RETURN_PATH = '/xac-minh';
const RETURN_PATHS = [IDENTITY_RETURN_PATH, VERIFY_RETURN_PATH];

interface Provider {
  code: string;
  display_name: string;
}

function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([]);
  useEffect(() => {
    marketRequest<Provider[]>('GET', '/identity/providers')
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);
  return providers;
}

function startIdentity(provider: string, purpose: 'login' | 'link') {
  return marketRequest<{ authorization_url: string }>('POST', '/identity/start', {
    provider,
    purpose,
    return_url: `${window.location.origin}${IDENTITY_RETURN_PATH}`,
  }).then((result) => window.location.assign(result.authorization_url));
}

// Quay về từ nhà cung cấp định danh: gửi mã và state cho máy chủ; đăng nhập thì giữ phiên mới, liên kết thì báo đã liên kết, xác minh
// của gia sư thì báo kết quả và mở trang Xác minh
export function useIdentityReturn(): { pending: boolean; message?: string; error?: string } {
  const [pending, setPending] = useState(RETURN_PATHS.includes(window.location.pathname));
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const path = window.location.pathname;
    if (!RETURN_PATHS.includes(path)) return;
    const query = new URLSearchParams(window.location.search);
    const code = query.get('code');
    const state = query.get('state');
    window.history.replaceState(null, '', path === VERIFY_RETURN_PATH ? '/#xac-minh' : '/');
    if (!code || !state) {
      setError(query.get('error_description') ?? 'Nhà cung cấp định danh không trả kết quả');
      setPending(false);
      return;
    }
    marketRequest<{ session_token?: string; status: string; note?: string | null }>('POST', '/identity/complete', {
      code,
      state,
    })
      .then((result) => {
        if (result.session_token) writeSession(result.session_token);
        else if (result.status === 'linked') setMessage('Đã liên kết tài khoản định danh');
        else if (result.status === 'approved') setMessage('Đã xác minh danh tính');
        else setError(result.note ?? 'Chưa xác minh được danh tính');
      })
      .catch((caught: unknown) => setError(errorText(caught)))
      .finally(() => setPending(false));
  }, []);
  return { pending, message, error };
}

export function IdentityLogin() {
  const providers = useProviders();
  const [error, setError] = useState<string>();
  if (providers.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {providers.map((provider) => (
        <Button
          key={provider.code}
          onClick={() =>
            void startIdentity(provider.code, 'login').catch((caught: unknown) => setError(errorText(caught)))
          }
        >
          Đăng nhập bằng {provider.display_name}
        </Button>
      ))}
      <p className="text-label text-text-secondary">
        Phụ huynh dùng được khi đã liên kết định danh ở trang Hồ sơ con, mục tài khoản; gia sư dùng được khi đã xác minh
        danh tính.
      </p>
    </div>
  );
}

function IdentityLink() {
  const providers = useProviders();
  const [linked, setLinked] = useState<Array<{ provider: string; display_name: string; linked_at: string }>>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    marketRequest<{ identities: typeof linked }>('GET', '/identity/linked')
      .then((view) => setLinked(view.identities))
      .catch(() => setLinked([]));
  }, []);
  if (providers.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 className="font-semibold">Đăng nhập bằng tài khoản định danh</h3>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {providers.map((provider) => {
        const row = linked.find((item) => item.provider === provider.code);
        return (
          <div key={provider.code} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">
              {provider.display_name}:{' '}
              <strong>
                {row ? `đã liên kết ngày ${new Date(row.linked_at).toLocaleDateString('vi-VN')}` : 'chưa liên kết'}
              </strong>
            </span>
            {row ? null : (
              <Button
                onClick={() =>
                  void startIdentity(provider.code, 'link').catch((caught: unknown) => setError(errorText(caught)))
                }
              >
                Liên kết {provider.display_name}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ParentAccount() {
  const [me, setMe] = useState<Me>();
  useEffect(() => {
    marketRequest<Me>('GET', '/me')
      .then(setMe)
      .catch(() => setMe(undefined));
  }, []);
  if (!me) return null;
  return (
    <section aria-label="Thông tin tài khoản" className={`${CARD_CLASS} flex flex-col gap-4 p-6`}>
      <h2 className="text-section-title font-semibold">Thông tin tài khoản</h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
        <dt className="text-text-secondary">Thư điện tử</dt>
        <dd>{me.email ?? 'Chưa khai'}</dd>
        <dt className="text-text-secondary">Số điện thoại</dt>
        <dd>{me.phone ?? 'Chưa khai'}</dd>
      </dl>
      <DisplayNameForm initial={me.display_name} />
      <div className="border-t border-border pt-4">
        <ChangePasswordForm />
      </div>
      <IdentityLink />
    </section>
  );
}

interface ChildThreads {
  child_name: string;
  threads: Array<{
    id: string;
    tutor_name: string;
    messages: Array<{ role: 'parent' | 'tutor'; body: string; created_at: string }>;
  }>;
}

// Chế độ con đọc tin nhắn: phủ cả màn hình, chỉ đọc, không có ô gửi; thoát phải nhập lại mật khẩu của phụ huynh
export function ChildReadMode({ childId, onExit }: { childId: string; onExit: () => void }) {
  const [view, setView] = useState<ChildThreads>();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  useEffect(() => {
    marketRequest<ChildThreads>('GET', `/children/${childId}/messages`)
      .then(setView)
      .catch((caught: unknown) => setError(errorText(caught)));
  }, [childId]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Chế độ con đọc tin nhắn"
      className="fixed inset-0 z-50 flex flex-col gap-4 overflow-y-auto bg-page p-4 sm:p-8"
    >
      <h2 className="text-page-title font-bold">Tin nhắn với gia sư{view ? ` · ${view.child_name}` : ''}</h2>
      <p className="text-text-secondary">Con chỉ đọc. Bố mẹ thấy mọi tin nhắn; con không nhắn riêng với gia sư.</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {view && view.threads.length === 0 ? <p>Chưa có tin nhắn với gia sư của con.</p> : null}
      {(view?.threads ?? []).map((thread) => (
        <section
          key={thread.id}
          aria-label={`Tin nhắn với ${thread.tutor_name}`}
          className={`${CARD_CLASS} flex flex-col gap-2 p-5`}
        >
          <h3 className="font-semibold">{thread.tutor_name}</h3>
          <ul className="flex flex-col gap-2">
            {thread.messages.map((message, index) => (
              <li key={index} className="flex flex-col">
                <span className="text-label text-text-secondary">
                  {message.role === 'tutor' ? thread.tutor_name : 'Bố mẹ'} ·{' '}
                  {new Date(message.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                </span>
                <span>{message.body}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <form
        aria-label="Thoát chế độ con đọc tin nhắn"
        className={`${CARD_CLASS} mt-auto flex flex-wrap items-end gap-2 p-4`}
        onSubmit={(event) => {
          event.preventDefault();
          void marketRequest('POST', '/auth/password/confirm', { password })
            .then(onExit)
            .catch(() => setError('Mật khẩu của phụ huynh không đúng'));
        }}
      >
        <label className="flex min-w-0 flex-[1_1_240px] flex-col gap-1 text-label font-medium">
          Mật khẩu của phụ huynh để thoát
          <input
            className={FORM_CONTROL_CLASS}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <Button type="submit" variant="primary">
          Thoát
        </Button>
      </form>
    </div>
  );
}
