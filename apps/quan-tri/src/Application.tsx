import { useState, type FormEvent } from 'react';
import { Alert, Button, FORM_CONTROL_CLASS } from '@cho-gia-su/ui';
import { AdminAccountsPage } from './AdminAccountsPage.js';
import {
  ADMIN_ROLE_LABELS,
  adminCan,
  AdminApiError,
  adminRequest,
  readAdminSession,
  writeAdminSession,
  type AdminSession,
} from './admin-api.js';
import { MarketPage } from './MarketPage.js';

// Ứng dụng quản trị Chợ gia sư (YCTD-393, quyết định của Eric ngày 2026-10-30): đăng nhập bằng tên đăng nhập, mật khẩu và mã TOTP (hoặc
// mã khôi phục); sau đăng nhập có trang Chợ gia sư (cấu hình, văn bản, duyệt hồ sơ, thanh toán, kiểm duyệt, an toàn theo vai) và trang
// Tài khoản quản trị (vai quản trị)
function LoginPage({ onSignedIn }: { onSignedIn: (session: AdminSession) => void }) {
  const [form, setForm] = useState({ login: '', password: '', code: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const reply = await adminRequest<{ access_token: string; admin: AdminSession['admin'] }>(
        null,
        'POST',
        '/auth/login',
        form,
      );
      onSignedIn({ accessToken: reply.access_token, admin: reply.admin });
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Không đăng nhập được');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 py-6">
      <form
        aria-label="Đăng nhập quản trị"
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm"
        onSubmit={(event) => void submit(event)}
      >
        <h1 className="text-page-title font-semibold">Quản trị Chợ gia sư</h1>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <label className="flex flex-col gap-1 text-label font-medium">
          Tên đăng nhập
          <input
            className={FORM_CONTROL_CLASS}
            autoComplete="username"
            value={form.login}
            onChange={(event) => setForm({ ...form, login: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-label font-medium">
          Mật khẩu
          <input
            className={FORM_CONTROL_CLASS}
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-label font-medium">
          Mã xác thực 6 số hoặc mã khôi phục
          <input
            className={FORM_CONTROL_CLASS}
            autoComplete="one-time-code"
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value })}
          />
        </label>
        <Button type="submit" variant="primary" disabled={busy}>
          Đăng nhập
        </Button>
      </form>
    </main>
  );
}

type Page = 'market' | 'admins';

export function Application() {
  const [session, setSession] = useState<AdminSession | null>(readAdminSession);
  const [page, setPage] = useState<Page>('market');

  const signIn = (next: AdminSession) => {
    writeAdminSession(next);
    setSession(next);
  };

  const signOut = async () => {
    if (session) {
      await adminRequest(session.accessToken, 'POST', '/auth/logout').catch(() => undefined);
    }
    writeAdminSession(null);
    setSession(null);
  };

  if (!session) {
    return <LoginPage onSignedIn={signIn} />;
  }
  const { admin, accessToken } = session;
  const pages: Array<[Page, string]> = [['market', 'Chợ gia sư']];
  if (adminCan(admin.role, 'admins.manage')) {
    pages.push(['admins', 'Tài khoản quản trị']);
  }
  return (
    <div className="min-h-screen bg-page">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-brand-strong px-4 py-3 text-white">
        <strong>Quản trị Chợ gia sư</strong>
        <nav aria-label="Trang quản trị" className="flex flex-wrap gap-2">
          {pages.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-current={page === key ? 'page' : undefined}
              className={`rounded-lg px-3 py-2 ${page === key ? 'bg-white/20 font-semibold' : 'hover:bg-white/10'}`}
              onClick={() => setPage(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className="flex items-center gap-3">
          {admin.full_name} · {ADMIN_ROLE_LABELS[admin.role]}
          <button type="button" className="rounded-lg px-3 py-2 hover:bg-white/10" onClick={() => void signOut()}>
            Đăng xuất
          </button>
        </span>
      </header>
      <main className="quan-tri mx-auto max-w-6xl px-4 py-6">
        {page === 'admins' ? (
          <AdminAccountsPage token={accessToken} currentId={admin.id} />
        ) : (
          <MarketPage accessToken={accessToken} role={admin.role} />
        )}
      </main>
    </div>
  );
}
