import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAdmin } from '@cho-gia-su/api/dist/admin/admin-accounts.js';
import { totpCode } from '@cho-gia-su/api/dist/common/totp.js';
import { createDatabase, type MarketAdminRole, type MarketplaceDatabase } from '@cho-gia-su/database';
import { expect, request as playwrightRequest, type BrowserContext, type Page } from '@playwright/test';
import { E2E_ADMIN_PORT, E2E_API_PORT, E2E_STATE_FILE, E2E_WEB_PORT } from '../e2e-environment.mjs';

// Phần dùng chung của các spec Chợ gia sư: địa chỉ ứng dụng, gọi API của chợ, dựng dữ liệu trong cơ sở dữ liệu kiểm thử, tài khoản quản
// trị đăng nhập bằng mã TOTP
export const API = `http://127.0.0.1:${E2E_API_PORT}`;
export const WEB_URL = `http://localhost:${E2E_WEB_PORT}`;
export const ADMIN_URL = `http://localhost:${E2E_ADMIN_PORT}`;

export type MarketDatabase = ReturnType<typeof createDatabase<MarketplaceDatabase>>;

interface RunState {
  databaseUrl: string;
  secretsKey: string;
}

function readState(): RunState {
  return JSON.parse(readFileSync(E2E_STATE_FILE, 'utf8')) as RunState;
}

export function openMarketDatabase(): MarketDatabase {
  return createDatabase<MarketplaceDatabase>(readState().databaseUrl, { max: 1 });
}

export async function marketCall(method: string, path: string, token?: string, data?: unknown) {
  const context = await playwrightRequest.newContext();
  try {
    const response = await context.fetch(`${API}/api/v1/market${path}`, {
      method,
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      ...(data === undefined ? {} : { data }),
    });
    return { status: response.status(), body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
  } finally {
    await context.dispose();
  }
}

// Mã xác nhận gửi vào hộp thư giả lập trong bộ nhớ máy chủ: đặt mã đã biết vào bản ghi mã mới nhất (cơ sở dữ liệu chỉ giữ băm)
export async function setKnownCode(database: MarketDatabase, email: string, code: string): Promise<void> {
  const account = await database
    .selectFrom('market_accounts')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  const latest = await database
    .selectFrom('market_verification_codes')
    .select('id')
    .where('account_id', '=', account.id)
    .orderBy('created_at', 'desc')
    .executeTakeFirstOrThrow();
  await database
    .updateTable('market_verification_codes')
    .set({ code_hash: createHash('sha256').update(`market-code:${account.id}:${code}`).digest('hex') })
    .where('id', '=', latest.id)
    .execute();
}

export interface AdminAccount {
  login: string;
  password: string;
  totpSecret: string;
}

// Tạo tài khoản quản trị giả. Mỗi mã TOTP chỉ dùng được một lần cho một tài khoản, nên mỗi lần đăng nhập (qua API hoặc ở ứng dụng quản
// trị) dùng một tài khoản riêng để không phải chờ sang bước thời gian sau
export async function createAdminAccount(
  database: MarketDatabase,
  fullName: string,
  role: MarketAdminRole = 'quan_tri',
): Promise<AdminAccount> {
  const login = `qt-e2e-${randomBytes(4).toString('hex')}`;
  const password = randomBytes(12).toString('base64url');
  const created = await createAdmin(database, Buffer.from(readState().secretsKey, 'base64'), {
    login,
    fullName,
    password,
    role,
  });
  return { login, password, totpSecret: created.totp_secret };
}

// Đăng nhập quản trị qua API; trả mã phiên quản trị
export async function adminToken(account: AdminAccount): Promise<string> {
  const reply = await marketCall('POST', '/admin/auth/login', undefined, {
    login: account.login,
    password: account.password,
    code: totpCode(account.totpSecret, new Date()),
  });
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);
  return reply.body.access_token as string;
}

// Đăng nhập ứng dụng quản trị bằng tên đăng nhập, mật khẩu và mã TOTP (thay đăng nhập cổng vận hành nền tảng của School Management)
export async function signInAdmin(page: Page, account: AdminAccount): Promise<void> {
  await page.goto('/');
  const form = page.getByRole('form', { name: 'Đăng nhập quản trị' });
  await form.getByLabel('Tên đăng nhập').fill(account.login);
  await form.getByLabel('Mật khẩu').fill(account.password);
  await form.getByLabel('Mã xác thực 6 số hoặc mã khôi phục').fill(totpCode(account.totpSecret, new Date()));
  await form.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('navigation', { name: 'Trang quản trị' })).toBeVisible();
}

// Gia sư đã duyệt dựng thẳng trong cơ sở dữ liệu chợ (luồng duyệt ở spec 196): hồ sơ công khai, một môn, rảnh mọi giờ trong tuần,
// danh tính và lý lịch tư pháp đã duyệt; trả mã tài khoản và mã môn
export async function seedApprovedTutor(
  database: MarketDatabase,
  email: string,
  subject: { name: string; schoolLevel: 'THCS' | 'THPT'; gradeFrom: number; gradeTo: number },
): Promise<{ tutorId: string; subjectId: string }> {
  const tutor = await database
    .selectFrom('market_accounts')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  await database
    .updateTable('market_tutor_profiles')
    .set({ status: 'approved', published_at: new Date() })
    .where('account_id', '=', tutor.id)
    .execute();
  const inserted = await database
    .insertInto('market_tutor_subjects')
    .values({
      account_id: tutor.id,
      subject: subject.name,
      school_level: subject.schoolLevel,
      grade_from: subject.gradeFrom,
      grade_to: subject.gradeTo,
      content_kind: 'enrichment',
      price_per_session: 150_000,
      session_minutes: 60,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await database
    .insertInto('market_tutor_availability')
    .values(
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ account_id: tutor.id, weekday, start_minute: 0, end_minute: 1440 })),
    )
    .execute();
  await database
    .insertInto('market_tutor_verifications')
    .values(
      (['identity', 'criminal_record'] as const).map((kind) => ({
        account_id: tutor.id,
        kind,
        status: 'approved' as const,
        details: '{}',
        document_id: null,
        decided_at: new Date(),
        decided_by: 'e2e',
        note: null,
        valid_until: kind === 'criminal_record' ? `${new Date().getFullYear() + 1}-12-31` : null,
      })),
    )
    .execute();
  return { tutorId: tutor.id, subjectId: inserted.id };
}

// Đăng ký tài khoản chợ qua API, xác nhận bằng mã đã biết; trả mã phiên
export async function registerAccount(
  database: MarketDatabase,
  kind: 'parent' | 'tutor',
  email: string,
  name: string,
  documentIds: string[],
  code: string,
): Promise<string> {
  const registered = await marketCall('POST', '/auth/register', undefined, {
    kind,
    email,
    display_name: name,
    password: 'matkhau123',
    accepted_document_ids: documentIds,
  });
  expect(registered.status, JSON.stringify(registered.body)).toBe(201);
  const token = registered.body.session_token as string;
  await setKnownCode(database, email, code);
  expect((await marketCall('POST', '/auth/verify', token, { code })).status).toBe(200);
  return token;
}

// Quản trị đăng văn bản pháp lý qua API (tiêu đề `Văn bản <loại> <hậu tố>`); trả mã văn bản theo loại
export async function publishDocuments(token: string, kinds: string[], suffix: string) {
  const documents: Record<string, string> = {};
  for (const kind of kinds) {
    const published = await marketCall('POST', '/admin/documents', token, {
      kind,
      title: `Văn bản ${kind} ${suffix}`,
      body: 'Nội dung giả',
    });
    expect(published.status, JSON.stringify(published.body)).toBe(201);
    documents[kind] = published.body.id as string;
  }
  return documents;
}

// Phiên của tài khoản chợ đặt sẵn vào bộ nhớ của thẻ trước khi mở trang
export async function useMarketSession(context: BrowserContext, token: string): Promise<void> {
  await context.addInitScript({
    content: `window.sessionStorage.setItem('cho-gia-su-phien', ${JSON.stringify(token)});`,
  });
}
