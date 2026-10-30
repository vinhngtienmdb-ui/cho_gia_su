import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createDatabase, MARKET_SETTINGS_KEY, type MarketplaceDatabase } from '@cho-gia-su/database';
import type { Kysely } from 'kysely';
import { sendWithHost, startMarketApi, type MarketTestApi, type Reply } from '../test-support.js';
import { MarketMessenger } from './market-messenger.js';

// Nền chợ gia sư (DT-27 phần 27f, YCTD-256), kịch bản CT-27f-2, CT-27f-4, CT-27f-5: cấu hình ở trang quản trị với thu tiền thật bị chặn,
// tài khoản phụ huynh và hồ sơ con có đồng ý theo phiên bản, tài khoản gia sư. Bản tách (YCTD-393) bỏ phần cách ly với trường và liên
// kết với trường. Dữ liệu giả, không gọi dịch vụ thật
describe('chợ gia sư: nền (27f)', () => {
  let environment: MarketTestApi;
  let database: Kysely<MarketplaceDatabase>;
  let adminToken = '';
  const documents: Record<string, string> = {};

  const marketCall = (method: string, path: string, body?: unknown, token?: string): Promise<Reply> =>
    sendWithHost(environment.apiOrigin, {
      method,
      path: `/api/v1/market${path}`,
      ...(token ? { token } : {}),
      ...(body !== undefined ? { body } : {}),
    });
  const admin = (method: string, path: string, body?: unknown) => marketCall(method, `/admin${path}`, body, adminToken);

  async function register(kind: 'parent' | 'tutor', email: string, extra: string[] = []) {
    const accepted = [documents.terms, documents.privacy, ...extra];
    const reply = await marketCall('POST', '/auth/register', {
      kind,
      email,
      display_name: kind === 'parent' ? 'Phụ huynh giả' : 'Gia sư giả',
      password: 'matkhau123',
      accepted_document_ids: accepted,
    });
    assert.equal(reply.status, 201, JSON.stringify(reply.body));
    const token = reply.body.session_token as string;
    const message = environment.api.get(MarketMessenger).lastTo(email);
    const code = /(\d{6})/.exec(message?.text ?? '')?.[1];
    assert.ok(code, 'đã gửi mã xác nhận vào hộp thư giả lập');
    const verified = await marketCall('POST', '/auth/verify', { code }, token);
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    return token;
  }

  before(async () => {
    environment = await startMarketApi({ label: 'cho' });
    database = createDatabase<MarketplaceDatabase>(environment.databaseUrl, { max: 1 });
    adminToken = await environment.adminToken('quan_tri');
  });

  after(async () => {
    await database?.destroy();
    await environment?.close();
  });

  it('CT-27f-2: cấu hình ở trang quản trị, thu tiền thật bị chặn', async () => {
    const overview = await admin('GET', '');
    assert.equal(overview.status, 200, JSON.stringify(overview.body));
    assert.equal((overview.body.settings as { real_payments_enabled: boolean }).real_payments_enabled, false);

    const blocked = await admin('PUT', '/settings', { real_payments_enabled: true });
    assert.equal(blocked.status, 400, JSON.stringify(blocked.body));
    assert.match(JSON.stringify(blocked.body), /E-01 đến E-07/);
    const saved = await admin('PUT', '/settings', { default_commission_percent: 10 });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const settings = saved.body.settings as Record<string, unknown>;
    assert.equal(settings.real_payments_enabled, false);
    // Ghi thẳng giá trị bật vào cơ sở dữ liệu cũng không mở được
    const stored = await database
      .selectFrom('market_settings')
      .select('value')
      .where('key', '=', MARKET_SETTINGS_KEY)
      .executeTakeFirstOrThrow();
    await database
      .updateTable('market_settings')
      .set({ value: JSON.stringify({ ...(stored.value as object), real_payments_enabled: true }) })
      .where('key', '=', MARKET_SETTINGS_KEY)
      .execute();
    const reread = await admin('GET', '');
    assert.equal((reread.body.settings as { real_payments_enabled: boolean }).real_payments_enabled, false);

    for (const kind of ['terms', 'privacy', 'parent_consent', 'tutor_terms']) {
      const published = await admin('POST', '/documents', {
        kind,
        title: `Văn bản ${kind}`,
        body: `Nội dung giả của ${kind}`,
      });
      assert.equal(published.status, 201, JSON.stringify(published.body));
      assert.equal(published.body.version, 1);
      documents[kind] = published.body.id as string;
    }
    const site = await marketCall('GET', '/public/site');
    assert.equal(site.status, 200, JSON.stringify(site.body));
    assert.equal(site.body.real_payments, false);
    assert.equal((site.body.documents as unknown[]).length, 4);
  });

  it('CT-27f-4: phụ huynh: đồng ý theo phiên bản, mã xác nhận, hồ sơ con tối thiểu, rút đồng ý', async () => {
    const email = `phu-huynh-${Date.now()}@example.test`;
    // Thiếu đồng ý văn bản bắt buộc thì không đăng ký được
    const missing = await marketCall('POST', '/auth/register', {
      kind: 'parent',
      email,
      display_name: 'Phụ huynh giả',
      password: 'matkhau123',
      accepted_document_ids: [documents.terms],
    });
    assert.equal(missing.status, 400);
    const pending = await marketCall('POST', '/auth/register', {
      kind: 'parent',
      email: `cho-xac-nhan-${email}`,
      display_name: 'Chưa xác nhận',
      password: 'matkhau123',
      accepted_document_ids: [documents.terms, documents.privacy],
    });
    const pendingToken = pending.body.session_token as string;
    assert.equal((await marketCall('GET', '/children', undefined, pendingToken)).status, 403);
    assert.equal((await marketCall('POST', '/auth/verify', { code: '000000' }, pendingToken)).status, 400);

    const token = await register('parent', email);
    const me = await marketCall('GET', '/me', undefined, token);
    assert.equal(me.body.status, 'active');
    assert.deepEqual(me.body.consents_needed, []);

    // Hồ sơ con cần đồng ý của cha mẹ; Tiểu học chỉ lớp 1 đến 5
    const child = { display_name: 'Bé An', birth_year: new Date().getFullYear() - 12, school_level: 'THCS', grade: 7 };
    assert.equal((await marketCall('POST', '/children', child, token)).status, 400);
    assert.equal(
      (
        await marketCall(
          'POST',
          '/children',
          { ...child, school_level: 'TH', consent_document_id: documents.parent_consent },
          token,
        )
      ).status,
      400,
    );
    const created = await marketCall(
      'POST',
      '/children',
      { ...child, consent_document_id: documents.parent_consent },
      token,
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const childId = created.body.id as string;
    let list = await marketCall('GET', '/children', undefined, token);
    const row = (list.body.children as Array<Record<string, unknown>>)[0];
    assert.equal(row?.consent_current, true);
    assert.deepEqual(Object.keys(row ?? {}).sort(), [
      'birth_year',
      'consent_current',
      'created_at',
      'display_name',
      'grade',
      'id',
      'reads_messages',
      'school_level',
    ]);
    assert.equal((await marketCall('POST', `/children/${childId}/consent/withdraw`, {}, token)).status, 200);
    list = await marketCall('GET', '/children', undefined, token);
    assert.equal((list.body.children as Array<Record<string, unknown>>)[0]?.consent_current, false);

    // Hồ sơ con của phụ huynh khác: 404
    const other = await register('parent', `phu-huynh-khac-${Date.now()}@example.test`);
    assert.equal((await marketCall('PUT', `/children/${childId}`, child, other)).status, 404);
    assert.equal((await marketCall('DELETE', `/children/${childId}`, undefined, token)).status, 204);
  });

  it('CT-27f-5: gia sư: thêm điều khoản của gia sư, hồ sơ và cơ sở dạy thêm tối thiểu; phiên bản văn bản mới cần đồng ý lại', async () => {
    const email = `gia-su-${Date.now()}@example.test`;
    // Ứng dụng chung (YCTD-368): người đăng ký chọn loại tài khoản; loại khác phụ huynh, gia sư bị từ chối
    const otherKind = await marketCall('POST', '/auth/register', {
      kind: 'teacher',
      email,
      display_name: 'Gia sư giả',
      password: 'matkhau123',
      accepted_document_ids: [documents.terms, documents.privacy, documents.tutor_terms],
    });
    assert.equal(otherKind.status, 400, JSON.stringify(otherKind.body));
    const noTutorTerms = await marketCall('POST', '/auth/register', {
      kind: 'tutor',
      email,
      display_name: 'Gia sư giả',
      password: 'matkhau123',
      accepted_document_ids: [documents.terms, documents.privacy],
    });
    assert.equal(noTutorTerms.status, 400);
    const token = await register('tutor', email, [documents.tutor_terms as string]);
    assert.equal((await marketCall('GET', '/children', undefined, token)).status, 403);
    // Phụ huynh đăng ký trước khi nền tảng đăng điều khoản phiên bản 2 bên dưới (dùng ở phần kiểm quyền theo loại tài khoản, YCTD-368)
    const parentToken = await register('parent', `phu-huynh-368-${Date.now()}@example.test`);
    // Mỗi tài khoản một loại (GD-185, E-11 phương án a): thư điện tử của gia sư không đăng ký thêm được tài khoản phụ huynh (CT-1744)
    const sameEmail = await marketCall('POST', '/auth/register', {
      kind: 'parent',
      email,
      display_name: 'Phụ huynh trùng thư',
      password: 'matkhau123',
      accepted_document_ids: [documents.terms, documents.privacy],
    });
    assert.equal(sameEmail.status, 400, JSON.stringify(sameEmail.body));
    assert.match(JSON.stringify(sameEmail.body), /Đã có tài khoản dùng thư điện tử hoặc số điện thoại này/);
    const profile = await marketCall(
      'PUT',
      '/tutor/profile',
      { headline: 'Dạy Toán THCS', bio: 'Giới thiệu giả' },
      token,
    );
    assert.equal(profile.status, 200, JSON.stringify(profile.body));
    const provider = await marketCall('PUT', '/tutor/provider', { kind: 'individual', name: 'Gia sư giả' }, token);
    assert.equal(provider.status, 200, JSON.stringify(provider.body));
    assert.equal((provider.body.provider as { business_registration_no: unknown }).business_registration_no, null);

    // Nền tảng đăng điều khoản phiên bản 2: phải đồng ý lại mới dùng tiếp
    const v2 = await admin('POST', '/documents', {
      kind: 'terms',
      title: 'Điều khoản sửa đổi',
      body: 'Nội dung giả 2',
    });
    assert.equal(v2.body.version, 2);
    assert.equal((await marketCall('GET', '/tutor/profile', undefined, token)).status, 409);
    const me = await marketCall('GET', '/me', undefined, token);
    assert.deepEqual(
      (me.body.consents_needed as Array<{ id: string }>).map((row) => row.id),
      [v2.body.id],
    );
    assert.equal((await marketCall('POST', `/me/consents/${v2.body.id as string}`, {}, token)).status, 200);
    assert.equal((await marketCall('GET', '/tutor/profile', undefined, token)).status, 200);

    // Ứng dụng chung (YCTD-368, CT-368-1): /me báo loại tài khoản để ứng dụng hiện đúng bộ màn
    const meTutor = await marketCall('GET', '/me', undefined, token);
    assert.equal(meTutor.status, 200, JSON.stringify(meTutor.body));
    assert.equal(meTutor.body.kind, 'tutor');
    // Quyền theo loại tài khoản ở từng điểm cuối: gia sư không gọi được điểm cuối của phụ huynh và ngược lại
    assert.equal((await marketCall('GET', '/children', undefined, token)).status, 403);
    // requireReady xét loại tài khoản trước văn bản cần đồng ý: phụ huynh chưa đồng ý phiên bản 2 vẫn nhận 403, không phải 409
    assert.equal((await marketCall('GET', '/tutor/profile', undefined, parentToken)).status, 403);
    assert.equal((await marketCall('GET', '/me', undefined, parentToken)).body.kind, 'parent');

    // Đăng nhập lại; sai mật khẩu 5 lần thì khóa 15 phút
    assert.equal((await marketCall('POST', '/auth/login', { login: email, password: 'matkhau123' })).status, 200);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await marketCall('POST', '/auth/login', { login: email, password: 'sai12345' })).status, 401);
    }
    assert.equal((await marketCall('POST', '/auth/login', { login: email, password: 'matkhau123' })).status, 403);
  });
});
