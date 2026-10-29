import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ADMIN_ROLE_LABELS, AdminApiError, adminRequest, type AdminRole } from './admin-api.js';

// Tài khoản quản trị (YCTD-384): vai quản trị tạo tài khoản mới (khóa TOTP và mã khôi phục hiện một lần, giao cho người dùng tài khoản),
// khóa, mở tài khoản. Không tự khóa tài khoản của mình (máy chủ chặn)
interface AdminRow {
  id: string;
  login: string;
  full_name: string;
  role: AdminRole;
  status: 'active' | 'disabled';
  last_login_at: string | null;
}

interface Created {
  login: string;
  totp_secret: string;
  totp_uri: string;
  recovery_codes: string[];
}

export function AdminAccountsPage({ token, currentId }: { token: string; currentId: string }) {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [form, setForm] = useState({ login: '', full_name: '', password: '', role: 'ho_tro' as AdminRole });
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => setRows(await adminRequest<AdminRow[]>(token, 'GET', '/accounts')), [token]);

  useEffect(() => {
    reload().catch((caught: unknown) =>
      setError(caught instanceof AdminApiError ? caught.message : 'Không đọc được danh sách'),
    );
  }, [reload]);

  const run = async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
      await reload();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : 'Không thực hiện được');
    }
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      setCreated(await adminRequest<Created>(token, 'POST', '/accounts', form));
      setForm({ login: '', full_name: '', password: '', role: 'ho_tro' });
    });
  };

  return (
    <section aria-label="Tài khoản quản trị">
      <h2>Tài khoản quản trị</h2>
      {error ? <p role="alert">{error}</p> : null}
      {created ? (
        <div role="status">
          <p>
            Đã tạo <strong>{created.login}</strong>. Thông tin dưới chỉ hiện một lần: giao cho người dùng tài khoản.
          </p>
          <p>
            Khóa TOTP (nhập vào ứng dụng xác thực): <code>{created.totp_secret}</code>
          </p>
          <p>
            Mã khôi phục, mỗi mã dùng một lần: <code>{created.recovery_codes.join(' ')}</code>
          </p>
        </div>
      ) : null}
      <form aria-label="Tạo tài khoản quản trị" onSubmit={create}>
        <h3>Tạo tài khoản</h3>
        <label>
          Tên đăng nhập
          <input value={form.login} onChange={(event) => setForm({ ...form, login: event.target.value })} />
        </label>
        <label>
          Họ tên
          <input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} />
        </label>
        <label>
          Mật khẩu ban đầu (từ 12 ký tự)
          <input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
        </label>
        <label>
          Vai trò
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as AdminRole })}>
            {Object.entries(ADMIN_ROLE_LABELS).map(([role, label]) => (
              <option key={role} value={role}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Tạo tài khoản</button>
      </form>
      <table aria-label="Danh sách tài khoản quản trị">
        <thead>
          <tr>
            <th>Tên đăng nhập</th>
            <th>Họ tên</th>
            <th>Vai trò</th>
            <th>Trạng thái</th>
            <th>Đăng nhập gần nhất</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.login}</td>
              <td>{row.full_name}</td>
              <td>{ADMIN_ROLE_LABELS[row.role]}</td>
              <td>{row.status === 'active' ? 'Đang dùng' : 'Đã khóa'}</td>
              <td>{row.last_login_at ? new Date(row.last_login_at).toLocaleString('vi-VN') : 'Chưa'}</td>
              <td>
                {row.id === currentId ? null : (
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        await adminRequest(
                          token,
                          'POST',
                          `/accounts/${row.id}/${row.status === 'active' ? 'disable' : 'enable'}`,
                        );
                      })
                    }
                  >
                    {row.status === 'active' ? 'Khóa' : 'Mở khóa'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
