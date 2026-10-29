import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { MarketplaceDatabase } from '@cho-gia-su/database';
import { sql, type Kysely } from 'kysely';
import { FileStorage } from '../common/file-storage.js';
import { sendWithHost, startMarketApi, type MarketTestApi, type Reply } from '../test-support.js';
import { MockVideoProvider, VIDEO_PROVIDER } from '../common/video-provider.js';
import { MarketContext } from './market-context.js';
import { marketStorage } from './market-files.js';
import { MARKET_RATE_LIMITS, MarketRateLimiter } from './market-rate-limit.js';
import { MarketMessenger } from './market-messenger.js';
import { MarketplacePaymentProvider, type MockMarketplacePaymentProvider } from './market-payment-provider.js';

// An toàn trẻ em và kiểm duyệt ở chợ gia sư (DT-27 phần 27i, YCTD-259), CT-27i-2 đến CT-27i-5. Gia sư đã duyệt dựng thẳng trong cơ sở
// dữ liệu chợ như kiểm thử 27h; phòng video là bộ giả lập (dừng ghi trả ngay một tệp nhỏ). Dữ liệu giả, không có tiền thật
const HOUR = 3_600_000;

describe('chợ gia sư: an toàn trẻ em và kiểm duyệt (27i)', () => {
  let environment: MarketTestApi;
  let database: Kysely<MarketplaceDatabase>;
  let provider: MockMarketplacePaymentProvider;
  const operators: string[] = [];
  const documents: Record<string, string> = {};

  const call = (method: string, path: string, body?: unknown, token?: string): Promise<Reply> =>
    sendWithHost(environment.apiOrigin, {
      method,
      path: `/api/v1/market${path}`,
      ...(token ? { token } : {}),
      ...(body !== undefined ? { body } : {}),
    });
  const admin = (method: string, path: string, body?: unknown, operator = 0) =>
    call(method, `/admin${path}`, body, operators[operator]);

  // Tải nhị phân kèm tiêu đề phản hồi (bản ghi)
  function raw(path: string, token: string) {
    const url = new URL(`/api/v1/market${path}`, environment.apiOrigin);
    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const request = http.request(
        url,
        { method: 'GET', headers: { authorization: `Bearer ${token}` } },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }),
          );
        },
      );
      request.on('error', reject);
      request.end();
    });
  }

  async function registerParent(): Promise<{ id: string; token: string; childId: string; email: string }> {
    const email = `phu-huynh-${Math.random().toString(36).slice(2, 10)}@example.test`;
    const reply = await call('POST', '/auth/register', {
      kind: 'parent',
      email,
      display_name: 'Phụ huynh giả',
      password: 'matkhau123',
      accepted_document_ids: [documents.terms, documents.privacy],
    });
    const token = reply.body.session_token as string;
    const code = /(\d{6})/.exec(environment.api.get(MarketMessenger).lastTo(email)?.text ?? '')?.[1];
    assert.equal((await call('POST', '/auth/verify', { code }, token)).status, 200);
    const child = await call(
      'POST',
      '/children',
      {
        display_name: 'Bé Thử',
        birth_year: new Date().getFullYear() - 12,
        school_level: 'THCS',
        grade: 7,
        consent_document_id: documents.parent_consent,
      },
      token,
    );
    assert.equal(child.status, 201, JSON.stringify(child.body));
    const account = await database
      .selectFrom('market_accounts')
      .select('id')
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    return { id: account.id, token, childId: child.body.id as string, email };
  }

  async function seedTutor() {
    const email = `gia-su-${Math.random().toString(36).slice(2, 10)}@example.test`;
    const { hash } = await import('@node-rs/argon2');
    const account = await database
      .insertInto('market_accounts')
      .values({
        kind: 'tutor',
        email,
        phone: null,
        password_hash: await hash('matkhau123'),
        display_name: 'Gia sư dựng sẵn',
        status: 'active',
        verified_at: new Date(),
        locked_until: null,
        last_login_at: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await database
      .insertInto('market_tutor_profiles')
      .values({ account_id: account.id, status: 'approved', published_at: new Date() })
      .execute();
    const subject = await database
      .insertInto('market_tutor_subjects')
      .values({
        account_id: account.id,
        subject: 'Cờ vua',
        school_level: 'THCS',
        grade_from: 6,
        grade_to: 9,
        content_kind: 'enrichment',
        price_per_session: 150_000,
        session_minutes: 60,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await database
      .insertInto('market_tutor_availability')
      .values(
        [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          account_id: account.id,
          weekday,
          start_minute: 0,
          end_minute: 1440,
        })),
      )
      .execute();
    await database
      .insertInto('market_tutor_verifications')
      .values(
        (['identity', 'criminal_record'] as const).map((kind) => ({
          account_id: account.id,
          kind,
          status: 'approved' as const,
          details: '{}',
          document_id: null,
          decided_at: new Date(),
          decided_by: 'thu',
          note: null,
          valid_until: kind === 'criminal_record' ? `${new Date().getFullYear() + 1}-12-31` : null,
        })),
      )
      .execute();
    await database
      .insertInto('market_consents')
      .values(
        ['terms', 'privacy', 'tutor_terms'].map((kind) => ({
          account_id: account.id,
          document_id: documents[kind] as string,
          child_id: null,
        })),
      )
      .execute();
    const login = await call('POST', '/auth/login', { login: email, password: 'matkhau123' });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    return { id: account.id, token: login.body.session_token as string, subject: subject.id };
  }

  async function paidBooking(
    parent: { token: string; childId: string },
    tutor: { id: string; subject: string },
    hours: number,
  ) {
    const at = new Date(Date.now() + hours * HOUR);
    at.setUTCMinutes(0, 0, 0);
    const created = await call(
      'POST',
      '/bookings',
      {
        tutor_id: tutor.id,
        child_id: parent.childId,
        subject_id: tutor.subject,
        starts_at: at.toISOString(),
        recording_consented: true,
      },
      parent.token,
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.recording_required, true);
    const id = created.body.id as string;
    assert.equal((await call('POST', `/bookings/${id}/mock-pay`, {}, parent.token)).status, 200);
    return id;
  }

  before(async () => {
    environment = await startMarketApi({
      label: 'db',
      configuration: {
        marketJobIntervalSeconds: 0,
        marketFilesKey: Buffer.alloc(32, 7),
        video: {
          provider: 'mock',
          apiUrl: '',
          clientUrl: 'mock://video',
          apiKey: 'mock',
          apiSecret: 'mock-video-secret',
        },
      },
    });
    database = environment.api.get(MarketContext).database;
    provider = environment.api.get(MarketplacePaymentProvider) as MockMarketplacePaymentProvider;
    operators.push(await environment.adminToken('quan_tri'), await environment.adminToken('quan_tri'));
    for (const kind of ['terms', 'privacy', 'parent_consent', 'tutor_terms']) {
      const published = await admin('POST', '/documents', { kind, title: `Văn bản ${kind}`, body: 'Nội dung giả' });
      documents[kind] = published.body.id as string;
    }
  });

  after(async () => {
    await environment?.close();
  });

  it('CT-27i-2: tin nhắn chỉ giữa phụ huynh và gia sư, thông tin liên lạc ngoài bị che, lần thứ 3 gắn cờ và vào hàng chờ', async () => {
    const parent = await registerParent();
    const other = await registerParent();
    const tutor = await seedTutor();
    assert.equal(
      (await call('POST', '/messages/threads', { tutor_id: tutor.id }, tutor.token)).status,
      403,
      'gia sư không tự mở luồng',
    );
    const opened = await call('POST', '/messages/threads', { tutor_id: tutor.id }, parent.token);
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    const thread = opened.body.id as string;
    const normal = await call('POST', `/messages/threads/${thread}`, { body: 'Chào thầy' }, parent.token);
    assert.equal(normal.status, 201);
    assert.equal(normal.body.warning, null);
    const reply = await call(
      'POST',
      `/messages/threads/${thread}`,
      { body: 'Anh nhắn zalo 0912345678 cho nhanh' },
      tutor.token,
    );
    assert.equal(reply.status, 201);
    assert.match(String(reply.body.warning), /ngoài chợ/);
    const seen = await call('GET', `/messages/threads/${thread}`, undefined, parent.token);
    assert.doesNotMatch(JSON.stringify(seen.body), /0912345678/, 'phụ huynh chỉ thấy chữ đã che');
    assert.equal(
      (await call('GET', `/messages/threads/${thread}`, undefined, other.token)).status,
      404,
      'phụ huynh khác không xem được',
    );
    await call('POST', `/messages/threads/${thread}`, { body: 'mail gs@example.com' }, tutor.token);
    const third = await call('POST', `/messages/threads/${thread}`, { body: 'facebook.com/giasu' }, tutor.token);
    assert.equal(third.body.flagged, true);
    const overview = await admin('GET', '/safety');
    const reports = overview.body.reports as Array<{ id: string; category: string; subject_name: string }>;
    const flagged = reports.find((row) => row.category === 'fee_evasion');
    assert.ok(flagged, 'báo cáo né hoa hồng tự tạo');
    assert.ok((overview.body.metrics as { flagged_threads: number }).flagged_threads >= 1);
    const detail = await admin('GET', `/safety/reports/${flagged.id}`);
    assert.match(JSON.stringify(detail.body), /0912345678/, 'nhân viên kiểm duyệt xem được chữ gốc');
  });

  it('CT-27i-3: báo cáo nghiêm trọng tạm khóa gia sư ngay, giữ tiền; nhân viên xác nhận thì hủy buổi hoàn đủ, báo phụ huynh một lần', async () => {
    const parent = await registerParent();
    const other = await registerParent();
    const tutor = await seedTutor();
    const upcoming = await paidBooking(parent, tutor, 72);
    const taught = await paidBooking(other, tutor, 96);
    // Buổi của phụ huynh kia đã dạy, hết hạn khiếu nại: bình thường sẽ giải ngân
    await database
      .updateTable('market_bookings')
      .set({
        starts_at: new Date(Date.now() - 100 * HOUR),
        status: 'completed',
        complaint_deadline: new Date(Date.now() - HOUR),
      })
      .where('id', '=', taught)
      .execute();
    const report = await call(
      'POST',
      '/reports',
      {
        subject_id: tutor.id,
        target_kind: 'session',
        target_id: upcoming,
        category: 'child_safety',
        severity: 'critical',
        description: 'Gia sư đề nghị con gặp riêng',
      },
      parent.token,
    );
    assert.equal(report.status, 201, JSON.stringify(report.body));
    assert.equal(report.body.suspended, true);
    assert.match(String(report.body.hotline), /111/);
    const bookingOf = async () => {
      const bookings = await call('GET', '/bookings', undefined, parent.token);
      return (bookings.body.bookings as Array<{ id: string; status: string; refunded_amount: number }>).find(
        (row) => row.id === upcoming,
      );
    };
    // Hệ thống tự khóa chỉ giữ: chưa hủy buổi, chưa báo phụ huynh khác, chờ nhân viên xác nhận (YCTD-322)
    assert.equal((await bookingOf())?.status, 'paid');
    assert.doesNotMatch(environment.api.get(MarketMessenger).lastTo(other.email)?.text ?? '', /tạm ngừng hoạt động/);
    const confirmed = await admin('POST', `/safety/reports/${report.body.id as string}/suspend`, {
      note: 'Xác nhận tạm khóa trong lúc xét',
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const cancelled = await bookingOf();
    assert.equal(cancelled?.status, 'refunded');
    assert.equal(cancelled?.refunded_amount, 150_000);
    assert.ok(provider.ledger.some((entry) => entry.action === 'refund' && entry.amount === 150_000));
    // Quyết định tạm khóa sau đó không báo phụ huynh lần nữa
    await admin('POST', `/safety/reports/${report.body.id as string}/decide`, {
      decision: 'suspend',
      note: 'Có bằng chứng',
    });
    const notices = await database
      .selectFrom('market_moderation_log')
      .select('id')
      .where('subject_account_id', '=', tutor.id)
      .where('action', '=', 'tutor.suspend.notify')
      .execute();
    assert.equal(notices.length, 1);
    assert.equal((await call('GET', `/public/tutors/${tutor.id}`)).status, 404, 'ẩn khỏi chợ');
    const rebook = await call(
      'POST',
      '/bookings',
      {
        tutor_id: tutor.id,
        child_id: parent.childId,
        subject_id: tutor.subject,
        starts_at: new Date(Date.now() + 120 * HOUR).toISOString(),
        recording_consented: true,
      },
      parent.token,
    );
    assert.equal(rebook.status, 404, 'không đặt được gia sư đang tạm khóa');
    assert.match(environment.api.get(MarketMessenger).lastTo(other.email)?.text ?? '', /tạm ngừng hoạt động.*111/s);
    const safety = await call('GET', '/tutor/safety', undefined, tutor.token);
    assert.ok(safety.body.suspension, 'gia sư thấy mình đang bị tạm khóa');
    // Giữ tiền: không giải ngân buổi đã dạy trong lúc tạm khóa
    await admin('POST', '/payments/run-due');
    const held = await database
      .selectFrom('market_bookings')
      .select('status')
      .where('id', '=', taught)
      .executeTakeFirstOrThrow();
    assert.equal(held.status, 'completed');
  });

  it('CT-27i-7: báo cáo nghiêm trọng của phụ huynh chưa học với gia sư chỉ vào hàng chờ 4 giờ, không tạm khóa (YCTD-322)', async () => {
    const tutor = await seedTutor();
    const critical = (token: string) =>
      call(
        'POST',
        '/reports',
        {
          subject_id: tutor.id,
          target_kind: 'profile',
          category: 'harassment',
          severity: 'critical',
          description: 'Báo cáo thử',
        },
        token,
      );
    // Người lạ: không buổi, không tin nhắn
    const stranger = await registerParent();
    const queued = await critical(stranger.token);
    assert.equal(queued.status, 201, JSON.stringify(queued.body));
    assert.equal(queued.body.suspended, false);
    assert.equal(queued.body.severity, 'critical');
    assert.ok(new Date(queued.body.due_at as string).getTime() - Date.now() <= 4 * HOUR, 'hạn xử lý 4 giờ');
    assert.equal((await call('GET', `/public/tutors/${tutor.id}`)).status, 200, 'vẫn hiện ở chợ');
    // Tự mở luồng nhưng gia sư chưa trả lời, hoặc chỉ giữ chỗ chưa trả tiền: ai cũng tự tạo được nên không tính
    const opener = await registerParent();
    const thread = await call('POST', '/messages/threads', { tutor_id: tutor.id }, opener.token);
    assert.equal(thread.status, 201);
    await call('POST', `/messages/threads/${thread.body.id as string}`, { body: 'Chào thầy' }, opener.token);
    const unpaid = await call(
      'POST',
      '/bookings',
      {
        tutor_id: tutor.id,
        child_id: opener.childId,
        subject_id: tutor.subject,
        starts_at: new Date(Math.ceil((Date.now() + 80 * HOUR) / HOUR) * HOUR).toISOString(),
        recording_consented: true,
      },
      opener.token,
    );
    assert.equal(unpaid.status, 201, JSON.stringify(unpaid.body));
    assert.equal((await critical(opener.token)).body.suspended, false);
    assert.equal(
      await database
        .selectFrom('market_tutor_suspensions')
        .select('id')
        .where('tutor_account_id', '=', tutor.id)
        .executeTakeFirst(),
      undefined,
    );
    // Gia sư đã trả lời trong luồng: có quan hệ thật nên tạm khóa ngay
    await call('POST', `/messages/threads/${thread.body.id as string}`, { body: 'Chào anh' }, tutor.token);
    const related = await critical(opener.token);
    assert.equal(related.body.suspended, true);
    // Nhân viên bác thì gỡ khóa của hệ thống
    const dismissed = await admin('POST', `/safety/reports/${related.body.id as string}/decide`, {
      decision: 'dismiss',
      note: 'Không có căn cứ',
    });
    assert.equal(dismissed.status, 200, JSON.stringify(dismissed.body));
    assert.equal((await call('GET', `/public/tutors/${tutor.id}`)).status, 200);
  });

  it('CT-1526: phần quản trị chợ theo vai trò vận hành: hỗ trợ kiểm duyệt, kế toán xem thanh toán, cấu hình chỉ quản trị (YCTD-323)', async () => {
    const support = await environment.adminToken('ho_tro');
    const accountant = await environment.adminToken('ke_toan');
    const as = (token: string, method: string, path: string, body?: unknown) =>
      call(method, `/admin${path}`, body, token);
    assert.equal((await as(support, 'GET', '')).status, 200, 'mọi vai trò xem tổng quan chợ');
    assert.equal((await as(accountant, 'GET', '')).status, 200);
    assert.equal((await as(support, 'GET', '/safety')).status, 200);
    assert.equal((await as(accountant, 'GET', '/safety')).status, 403);
    assert.equal((await as(accountant, 'GET', '/payments')).status, 200);
    assert.equal((await as(support, 'GET', '/payments')).status, 403);
    assert.equal((await as(support, 'PUT', '/settings', { default_commission_percent: 10 })).status, 403);
    assert.equal((await as(accountant, 'PUT', '/settings', { default_commission_percent: 10 })).status, 403);
  });

  it('CT-27i-4: quyết định có lý do, kháng nghị do nhân viên khác xét, xuất hồ sơ cho cơ quan có nhật ký', async () => {
    const parent = await registerParent();
    const stranger = await registerParent();
    const tutor = await seedTutor();
    assert.equal(
      (
        await call(
          'POST',
          '/reports',
          {
            subject_id: stranger.id,
            target_kind: 'profile',
            category: 'harassment',
            severity: 'low',
            description: 'Dò tài khoản',
          },
          tutor.token,
        )
      ).status,
      404,
      'gia sư không báo phụ huynh chưa từng liên hệ',
    );
    const created = await call(
      'POST',
      '/reports',
      {
        subject_id: tutor.id,
        target_kind: 'profile',
        category: 'child_safety',
        severity: 'low',
        description: 'Hồ sơ có ảnh không phù hợp',
      },
      parent.token,
    );
    assert.equal(created.body.severity, 'high', 'an toàn trẻ em không thấp hơn mức cao');
    assert.equal(created.body.suspended, false);
    const id = created.body.id as string;
    assert.equal(
      (await admin('POST', `/safety/reports/${id}/decide`, { decision: 'dismiss' })).status,
      400,
      'cần lý do',
    );
    const first = await admin('POST', `/safety/reports/${id}/decide`, {
      decision: 'dismiss',
      note: 'Ảnh là ảnh lớp học bình thường',
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.status, 'decided');
    assert.equal(
      (await call('POST', `/reports/${id}/appeal`, { reason: 'Tôi muốn' }, tutor.token)).status,
      409,
      'gia sư không kháng nghị quyết định bác',
    );
    const appealed = await call(
      'POST',
      `/reports/${id}/appeal`,
      { reason: 'Ảnh có trẻ khác không được phép' },
      parent.token,
    );
    assert.equal(appealed.status, 200);
    assert.equal(
      (await admin('POST', `/safety/reports/${id}/decide`, { decision: 'suspend', note: 'Xét lại' }, 0)).status,
      403,
      'người quyết định lần đầu không xét kháng nghị',
    );
    const final = await admin(
      'POST',
      `/safety/reports/${id}/decide`,
      { decision: 'suspend', note: 'Ảnh có trẻ khác chưa có đồng ý' },
      1,
    );
    assert.equal(final.status, 200);
    assert.equal(final.body.status, 'final');
    assert.ok(final.body.suspension, 'tạm khóa theo quyết định cuối');
    assert.equal((await admin('POST', `/safety/reports/${id}/export`, { authority: 'Công an' })).status, 400);
    const exported = await admin('POST', `/safety/reports/${id}/export`, {
      authority: 'Công an quận giả',
      request_reference: '123/CV-GIA',
    });
    assert.equal(exported.status, 200);
    const exports = await database
      .selectFrom('market_evidence_exports')
      .select('request_reference')
      .where('report_id', '=', id)
      .execute();
    assert.deepEqual(
      exports.map((row) => row.request_reference),
      ['123/CV-GIA'],
    );
    const log = (final.body.log as Array<{ action: string }>).map((entry) => entry.action);
    assert.ok(log.includes('report.decide') && log.includes('report.appeal') && log.includes('report.final'));
  });

  it('CT-27i-5: buổi có trẻ vị thành niên chỉ mở khi đang ghi; bản ghi chỉ người của buổi và nhân viên xem, không tải, giữ 30 ngày', async () => {
    const parent = await registerParent();
    const other = await registerParent();
    const tutor = await seedTutor();
    const id = await paidBooking(parent, tutor, 48);
    assert.equal(
      (await call('POST', `/tutor/bookings/${id}/session/start`, undefined, tutor.token)).status,
      409,
      'chưa tới giờ mở phòng',
    );
    await database
      .updateTable('market_bookings')
      .set({ starts_at: new Date(Date.now() - 5 * 60_000) })
      .where('id', '=', id)
      .execute();
    assert.equal(
      (await call('POST', `/bookings/${id}/session/join`, undefined, parent.token)).status,
      409,
      'phụ huynh chỉ vào khi gia sư đã mở và đang ghi',
    );
    const started = await call('POST', `/tutor/bookings/${id}/session/start`, undefined, tutor.token);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.recording, true);
    // Phòng học video (YCTD-362): cần đồng ý ghi hình với gia sư (con từ đủ 7 tuổi cùng xác nhận), vào phòng chờ, gia sư cho vào
    assert.equal(
      (await call('POST', `/bookings/${id}/room/consent`, { parent_confirmed: true }, parent.token)).status,
      400,
      'con từ đủ 7 tuổi phải cùng xác nhận',
    );
    const consented = await call(
      'POST',
      `/bookings/${id}/room/consent`,
      { parent_confirmed: true, child_confirmed: true },
      parent.token,
    );
    assert.equal(consented.status, 200, JSON.stringify(consented.body));
    const waiting = await call('POST', `/bookings/${id}/session/join`, undefined, parent.token);
    assert.equal(waiting.status, 200);
    assert.equal(waiting.body.status, 'waiting');
    const admitted = await call(
      'POST',
      `/tutor/bookings/${id}/room/participants/student:${parent.id}`,
      { admit: true },
      tutor.token,
    );
    assert.equal(admitted.status, 200, JSON.stringify(admitted.body));
    const joined = await call('POST', `/bookings/${id}/session/join`, undefined, parent.token);
    assert.equal(joined.status, 200);
    assert.equal(joined.body.status, 'ready');
    assert.match(String(joined.body.token), /^mock\./);
    const ended = await call('POST', `/tutor/bookings/${id}/session/end`, undefined, tutor.token);
    assert.equal(ended.body.recording, 'ready');
    const stored = await database
      .selectFrom('market_session_recordings')
      .select(['file_key', 'retain_until', 'ended_at'])
      .where('booking_id', '=', id)
      .executeTakeFirstOrThrow();
    assert.equal(
      (stored.retain_until?.getTime() ?? 0) - (stored.ended_at?.getTime() ?? 0),
      30 * 24 * HOUR,
      'giữ 30 ngày',
    );
    const viewed = await raw(`/bookings/${id}/recording/stream`, parent.token);
    assert.equal(viewed.status, 200);
    assert.equal(viewed.headers['content-disposition'], 'inline');
    assert.equal(viewed.headers['cache-control'], 'no-store');
    assert.equal(viewed.body.toString(), 'ban ghi gia lap');
    assert.equal((await raw(`/tutor/bookings/${id}/recording/stream`, tutor.token)).status, 200);
    assert.equal((await raw(`/bookings/${id}/recording/stream`, other.token)).status, 404);
    assert.equal((await raw(`/admin/safety/recordings/${id}`, operators[0] as string)).status, 200);
    const views = await database
      .selectFrom('market_recording_views')
      .innerJoin('market_session_recordings', 'market_session_recordings.id', 'market_recording_views.recording_id')
      .select('market_recording_views.viewer_type')
      .where('market_session_recordings.booking_id', '=', id)
      .execute();
    assert.deepEqual(views.map((row) => row.viewer_type).sort(), ['account', 'account', 'operator']);
    // Hết hạn giữ nhưng buổi đang tranh chấp: giữ tiếp; hết tranh chấp thì xóa
    await database
      .updateTable('market_session_recordings')
      .set({ retain_until: new Date(Date.now() - HOUR) })
      .where('booking_id', '=', id)
      .execute();
    await database.updateTable('market_bookings').set({ status: 'disputed' }).where('id', '=', id).execute();
    assert.equal((await admin('POST', '/safety/run-due')).body.purged, 0);
    await database.updateTable('market_bookings').set({ status: 'disbursed' }).where('id', '=', id).execute();
    assert.equal((await admin('POST', '/safety/run-due')).body.purged, 1);
    assert.equal((await raw(`/bookings/${id}/recording/stream`, parent.token)).status, 404);
  });

  it('CT-1716: nhà cung cấp video báo ghi xong qua sự kiện gọi lại (như LiveKit): bản ghi được mã hóa, chuyển sang xem được, tệp thô bị xóa (YCTD-379)', async () => {
    const video = environment.api.get(VIDEO_PROVIDER) as MockVideoProvider;
    const storage = marketStorage(environment.api.get(FileStorage));
    const parent = await registerParent();
    const tutor = await seedTutor();
    const id = await paidBooking(parent, tutor, 48);
    await database
      .updateTable('market_bookings')
      .set({ starts_at: new Date(Date.now() - 5 * 60_000) })
      .where('id', '=', id)
      .execute();
    video.deferRecordingCompletion = true;
    try {
      const started = await call('POST', `/tutor/bookings/${id}/session/start`, undefined, tutor.token);
      assert.equal(started.status, 200, JSON.stringify(started.body));
      const ended = await call('POST', `/tutor/bookings/${id}/session/end`, undefined, tutor.token);
      assert.equal(ended.body.recording, 'processing');
    } finally {
      video.deferRecordingCompletion = false;
    }
    const recording = await database
      .selectFrom('market_session_recordings')
      .select(['egress_id', 'file_key'])
      .where('booking_id', '=', id)
      .executeTakeFirstOrThrow();
    // Bộ ghi của nhà cung cấp tải tệp thô lên kho tại khóa đã giao
    const contents = Buffer.from('ban ghi tu nha cung cap');
    await storage.put(recording.file_key, contents, 'video/mp4');
    const webhook = async (event: object) => {
      const body = JSON.stringify(event);
      const response = await fetch(`${environment.apiOrigin}/api/v1/video/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/webhook+json', authorization: `Mock ${video.signature(body)}` },
        body,
      });
      return response.status;
    };
    const finished = {
      kind: 'recording_ended',
      room: `market-${id}`,
      egress_id: recording.egress_id,
      succeeded: true,
      size_bytes: contents.length,
    };
    assert.equal(await webhook(finished), 200);
    const stored = await database
      .selectFrom('market_session_recordings')
      .select(['status', 'file_key', 'retain_until'])
      .where('booking_id', '=', id)
      .executeTakeFirstOrThrow();
    assert.equal(stored.status, 'ready');
    assert.ok(stored.retain_until);
    assert.notDeepEqual(await storage.get(stored.file_key), contents, 'tệp lưu đã mã hóa');
    if (stored.file_key !== recording.file_key) {
      await assert.rejects(storage.get(recording.file_key), 'tệp thô đã xóa');
    }
    const viewed = await raw(`/bookings/${id}/recording/stream`, parent.token);
    assert.equal(viewed.status, 200);
    assert.equal(viewed.body.toString(), contents.toString());
    // Sự kiện gửi lại không mã hóa lần nữa
    assert.equal(await webhook(finished), 200);
    assert.equal((await raw(`/bookings/${id}/recording/stream`, parent.token)).body.toString(), contents.toString());
  });

  it('CT-27j-2: phòng học video: gia sư vắng thì hoàn đủ; điểm danh khi kết thúc; gia sư không xác nhận thì tự xác nhận sau 24 giờ', async () => {
    const parent = await registerParent();
    const tutor = await seedTutor();
    // Gia sư không vào phòng: chưa quá 10 phút thì chưa báo được, quá 10 phút thì buổi hủy, hoàn đủ
    const absent = await paidBooking(parent, tutor, 48);
    await database
      .updateTable('market_bookings')
      .set({ starts_at: new Date(Date.now() - 5 * 60_000) })
      .where('id', '=', absent)
      .execute();
    assert.equal((await call('POST', `/bookings/${absent}/tutor-no-show`, {}, parent.token)).status, 409);
    await database
      .updateTable('market_bookings')
      .set({ starts_at: new Date(Date.now() - 11 * 60_000) })
      .where('id', '=', absent)
      .execute();
    const noShow = await call('POST', `/bookings/${absent}/tutor-no-show`, {}, parent.token);
    assert.equal(noShow.status, 200, JSON.stringify(noShow.body));
    assert.equal(noShow.body.status, 'refunded');

    // Buổi có gia sư mở phòng, con vào, kết thúc: điểm danh có gia sư và con
    const taught = await paidBooking(parent, tutor, 48);
    await database
      .updateTable('market_bookings')
      .set({ starts_at: new Date(Date.now() - 5 * 60_000) })
      .where('id', '=', taught)
      .execute();
    const room = await call('GET', `/bookings/${taught}/room`, undefined, parent.token);
    assert.equal(room.body.window_open, true);
    assert.equal(room.body.child_must_confirm, true);
    assert.equal(room.body.tutor_opened, false);
    assert.equal((await call('POST', `/tutor/bookings/${taught}/session/start`, {}, tutor.token)).status, 200);
    await call(
      'POST',
      `/bookings/${taught}/room/consent`,
      { parent_confirmed: true, child_confirmed: true },
      parent.token,
    );
    assert.equal(
      (await call('POST', `/bookings/${taught}/room/enter`, { as: 'guardian' }, parent.token)).body.status,
      'waiting',
    );
    const pending = await call('GET', `/tutor/bookings/${taught}/room`, undefined, tutor.token);
    assert.deepEqual(
      (pending.body.participants as Array<{ role: string }>).map((row) => row.role),
      ['guardian'],
      'phụ huynh vào xem đang ở phòng chờ',
    );
    await call(
      'POST',
      `/tutor/bookings/${taught}/room/participants/guardian:${parent.id}`,
      { admit: true },
      tutor.token,
    );
    const guardian = await call('POST', `/bookings/${taught}/room/enter`, { as: 'guardian' }, parent.token);
    assert.equal(guardian.body.status, 'ready');
    assert.equal(guardian.body.can_speak, false, 'phụ huynh vào xem tắt micro');
    assert.equal((await call('POST', `/tutor/bookings/${taught}/session/end`, {}, tutor.token)).status, 200);
    const after = await call('GET', `/bookings/${taught}/room`, undefined, parent.token);
    assert.equal(after.body.closed, true);
    const roles = (after.body.attendance as Array<{ role: string; result: string | null }>)
      .map((row) => row.role)
      .sort();
    assert.deepEqual(roles, ['guardian', 'host']);

    // Rút đồng ý: buổi sau với gia sư này phải đồng ý lại
    const consents = await call('GET', '/recording-consents', undefined, parent.token);
    const consentId = (consents.body.consents as Array<{ id: string }>)[0]?.id ?? '';
    assert.equal((await call('POST', `/recording-consents/${consentId}/withdraw`, {}, parent.token)).status, 200);
    assert.equal((await call('GET', `/bookings/${taught}/room`, undefined, parent.token)).body.consent, null);

    // Gia sư không xác nhận đã dạy: quá 24 giờ sau giờ kết thúc thì việc định kỳ tự xác nhận
    await database
      .updateTable('market_bookings')
      .set({ starts_at: new Date(Date.now() - 26 * HOUR) })
      .where('id', '=', taught)
      .execute();
    const due = await admin('POST', '/payments/run-due');
    assert.ok((due.body.autoConfirmed as number) >= 1, JSON.stringify(due.body));
    const confirmed = await database
      .selectFrom('market_session_rooms')
      .select('confirmed_by')
      .where('booking_id', '=', taught)
      .executeTakeFirstOrThrow();
    assert.equal(confirmed.confirmed_by, 'auto');
  });
  it('CT-364-1: đánh giá sau buổi chờ duyệt rồi mới hiện; gia sư trả lời một lần; sắp theo đánh giá; con đọc tin nhắn chỉ đọc', async () => {
    const parent = await registerParent();
    const tutor = await seedTutor();
    const id = await paidBooking(parent, tutor, 48);
    // Chưa dạy thì chưa đánh giá được
    assert.equal((await call('POST', `/bookings/${id}/review`, { rating: 5 }, parent.token)).status, 409);
    await database.updateTable('market_bookings').set({ status: 'completed' }).where('id', '=', id).execute();
    assert.equal((await call('POST', `/bookings/${id}/review`, { rating: 6 }, parent.token)).status, 400);
    const created = await call(
      'POST',
      `/bookings/${id}/review`,
      { rating: 5, clarity: 4, body: 'Cô dạy dễ hiểu, gọi cô số 0912 345 678' },
      parent.token,
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.status, 'pending');
    assert.ok(created.body.warning, 'số điện thoại bị che');
    assert.equal((await call('POST', `/bookings/${id}/review`, { rating: 4 }, parent.token)).status, 409);
    const hidden = await call('GET', `/public/reviews/${tutor.id}`);
    assert.equal((hidden.body.summary as { count: number }).count, 0, 'chưa duyệt thì chưa hiện');
    const queue = await admin('GET', '/reviews-moderation');
    const pending = (queue.body.reviews as Array<{ id: string; body: string }>).find(
      (row) => row.id === created.body.id,
    );
    assert.ok(pending && !pending.body.includes('0912'));
    assert.equal(
      (await admin('POST', `/reviews-moderation/${created.body.id as string}`, { decision: 'reject' })).status,
      400,
      'từ chối cần lý do',
    );
    assert.equal(
      (await admin('POST', `/reviews-moderation/${created.body.id as string}`, { decision: 'publish' })).status,
      200,
    );
    const shown = await call('GET', `/public/reviews/${tutor.id}`);
    assert.equal((shown.body.summary as { count: number }).count, 1);
    assert.equal((shown.body.summary as { average: number }).average, 5);
    const search = await call('GET', '/public/tutors?sort=rating_desc');
    const card = (search.body.tutors as Array<{ id: string; rating: { count: number } }>).find(
      (row) => row.id === tutor.id,
    );
    assert.equal(card?.rating.count, 1);
    const reviewId = created.body.id as string;
    assert.equal(
      (await call('POST', `/tutor/reviews/${reviewId}/reply`, { body: 'Cảm ơn phụ huynh' }, tutor.token)).status,
      200,
    );
    assert.equal(
      (await call('POST', `/tutor/reviews/${reviewId}/reply`, { body: 'Lần hai' }, tutor.token)).status,
      409,
    );

    // Con đọc tin nhắn: chưa bật thì không đọc được; bật rồi chỉ có luồng với gia sư đã dạy con, không có điểm cuối gửi
    const thread = await call('POST', '/messages/threads', { tutor_id: tutor.id }, parent.token);
    await call('POST', `/messages/threads/${thread.body.id as string}`, { body: 'Chào cô' }, parent.token);
    assert.equal((await call('GET', `/children/${parent.childId}/messages`, undefined, parent.token)).status, 403);
    assert.equal(
      (await call('POST', `/children/${parent.childId}/reads-messages`, { enabled: true }, parent.token)).status,
      200,
    );
    const read = await call('GET', `/children/${parent.childId}/messages`, undefined, parent.token);
    assert.equal(read.status, 200);
    const threads = read.body.threads as Array<{ messages: Array<{ body: string }> }>;
    assert.equal(threads.length, 1);
    assert.equal(threads[0]?.messages[0]?.body, 'Chào cô');
  });

  it('CT-364-2: quên mật khẩu đặt lại bằng mã, thu hồi phiên cũ; đổi mật khẩu cần mật khẩu hiện tại; sửa tên hiển thị', async () => {
    const parent = await registerParent();
    assert.equal(
      (await call('POST', '/auth/password/change', { current_password: 'sai', new_password: 'moi12345' }, parent.token))
        .status,
      400,
    );
    assert.equal(
      (
        await call(
          'POST',
          '/auth/password/change',
          { current_password: 'matkhau123', new_password: 'moi12345' },
          parent.token,
        )
      ).status,
      200,
    );
    assert.equal((await call('GET', '/me', undefined, parent.token)).status, 200, 'phiên đang dùng còn');
    // Quên mật khẩu: câu trả lời như nhau dù tài khoản không có
    assert.equal((await call('POST', '/auth/password/forgot', { login: 'khong-co@example.test' })).status, 200);
    assert.equal((await call('POST', '/auth/password/forgot', { login: parent.email })).status, 200);
    const code = /(\d{6})/.exec(environment.api.get(MarketMessenger).lastTo(parent.email)?.text ?? '')?.[1];
    assert.equal(
      (
        await call('POST', '/auth/password/reset', {
          login: parent.email,
          code: '000000' === code ? '111111' : '000000',
          new_password: 'datlai123',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call('POST', '/auth/password/reset', {
          login: parent.email,
          code,
          new_password: 'datlai123',
        })
      ).status,
      200,
    );
    assert.equal((await call('GET', '/me', undefined, parent.token)).status, 401, 'phiên cũ bị thu hồi');
    const login = await call('POST', '/auth/login', { login: parent.email, password: 'datlai123' });
    assert.equal(login.status, 200);
    const token = login.body.session_token as string;
    assert.equal((await call('POST', '/auth/password/confirm', { password: 'sai' }, token)).status, 401);
    assert.equal((await call('POST', '/auth/password/confirm', { password: 'datlai123' }, token)).status, 200);
    assert.equal((await call('PUT', '/me', { display_name: 'Mẹ của Bé' }, token)).status, 200);
    assert.equal((await call('GET', '/me', undefined, token)).body.display_name, 'Mẹ của Bé');
  });

  it('CT-1717: mã đặt lại mật khẩu: gửi đồng thời vẫn chỉ được 5 lần thử; lấy mã mới không làm mới số lần thử trong ngày; mã lưu bằng hàm băm chậm (YCTD-379)', async () => {
    environment.api.get(MarketRateLimiter).reset();
    const parent = await registerParent();
    const messenger = environment.api.get(MarketMessenger);
    const latestCode = () => /(\d{6})/.exec(messenger.lastTo(parent.email)?.text ?? '')?.[1] ?? '';
    const reset = (code: string) =>
      call('POST', '/auth/password/reset', { login: parent.email, code, new_password: 'datlai123' });
    const wrong = (code: string) => (code === '000000' ? '111111' : '000000');
    // Lùi thời điểm cấp mã để lấy mã mới không phải chờ 60 giây
    const ageCodes = () =>
      sql`update market_verification_codes set created_at = created_at - interval '2 minutes'
        where account_id = ${parent.id} and purpose = 'reset'`.execute(database);

    assert.equal((await call('POST', '/auth/password/forgot', { login: parent.email })).status, 200);
    const first = latestCode();
    const stored = await database
      .selectFrom('market_verification_codes')
      .select('code_hash')
      .where('account_id', '=', parent.id)
      .where('purpose', '=', 'reset')
      .executeTakeFirstOrThrow();
    assert.match(stored.code_hash, /^\$argon2/, 'mã lưu bằng argon2');

    // Gửi 8 lần sai đồng thời: chỉ 5 lần được so mã
    const replies = await Promise.all(Array.from({ length: 8 }, () => reset(wrong(first))));
    const compared = replies.filter((reply) => JSON.stringify(reply.body).includes('Mã không đúng')).length;
    assert.ok(compared <= 5, `số lần được so mã: ${compared}`);
    assert.equal((await reset(first)).status, 400, 'mã đúng cũng bị từ chối sau khi hết lượt');

    // Mã mới chỉ còn phần lượt thử còn lại trong ngày
    await ageCodes();
    assert.equal((await call('POST', '/auth/password/forgot', { login: parent.email })).status, 200);
    const second = latestCode();
    assert.notEqual(second, '');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await reset(wrong(second));
    }
    await ageCodes();
    const sentBefore = messenger.outbox.filter((message) => message.to === parent.email).length;
    assert.equal((await call('POST', '/auth/password/forgot', { login: parent.email })).status, 200);
    assert.equal(
      messenger.outbox.filter((message) => message.to === parent.email).length,
      sentBefore,
      'hết lượt thử trong ngày thì không cấp mã mới',
    );
    assert.equal((await reset(second)).status, 400);
    const login = await call('POST', '/auth/login', { login: parent.email, password: 'datlai123' });
    assert.notEqual(login.status, 200, 'mật khẩu không bị đổi');
  });

  it('CT-1718: điểm cuối của chợ giới hạn số yêu cầu theo địa chỉ mạng (YCTD-379)', async () => {
    const limiter = environment.api.get(MarketRateLimiter);
    limiter.reset();
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < MARKET_RATE_LIMITS.code.limit + 1; attempt += 1) {
        statuses.push(
          (
            await call('POST', '/auth/password/reset', {
              login: 'khong-co@example.test',
              code: '000000',
              new_password: 'datlai123',
            })
          ).status,
        );
      }
      assert.ok(statuses.slice(0, -1).every((status) => status === 400));
      assert.equal(statuses.at(-1), 429);
    } finally {
      limiter.reset();
    }
  });
  it('CT-365-1: gói buổi: mua, trả tiền giả lập, đặt buổi từ gói, hủy trả lượt, hết hạn hoàn phần chưa học (GD-165)', async () => {
    const parent = await registerParent();
    const tutor = await seedTutor();
    // Môn chưa bán gói thì không mua được
    const noPackage = await call(
      'POST',
      '/packages',
      { tutor_id: tutor.id, child_id: parent.childId, subject_id: tutor.subject, recording_consented: true },
      parent.token,
    );
    assert.equal(noPackage.status, 400);
    await database
      .updateTable('market_tutor_subjects')
      .set({ package_sessions: 3, package_price: 400_000 })
      .where('id', '=', tutor.subject)
      .execute();
    const created = await call(
      'POST',
      '/packages',
      { tutor_id: tutor.id, child_id: parent.childId, subject_id: tutor.subject, recording_consented: true },
      parent.token,
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.status, 'held');
    assert.equal(created.body.price_per_session, 133_333);
    const packageId = created.body.id as string;
    const paid = await call('POST', `/packages/${packageId}/mock-pay`, {}, parent.token);
    assert.equal(paid.body.status, 'paid', JSON.stringify(paid.body));
    const validDays =
      (new Date(paid.body.expires_at as string).getTime() - new Date(paid.body.paid_at as string).getTime()) /
      (24 * HOUR);
    assert.equal(validDays, 56, 'dùng trong 8 tuần');

    // Đặt buổi từ gói: đã trả tiền, giá mỗi buổi của gói
    const at = new Date(Date.now() + 72 * HOUR);
    at.setUTCMinutes(0, 0, 0);
    const first = await call('POST', '/bookings', { package_id: packageId, starts_at: at.toISOString() }, parent.token);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.status, 'paid');
    assert.equal(first.body.price, 133_333);
    // Gói đã có buổi: không hủy cả gói được
    assert.equal((await call('POST', `/packages/${packageId}/cancel`, {}, parent.token)).status, 409);
    // Hủy buổi trước 24 giờ: trả lượt về gói
    assert.equal((await call('POST', `/bookings/${first.body.id as string}/cancel`, {}, parent.token)).status, 200);
    let list = await call('GET', '/packages', undefined, parent.token);
    let pack = (list.body.packages as Array<{ id: string; sessions_used: number }>).find((row) => row.id === packageId);
    assert.equal(pack?.sessions_used, 0);

    // Dùng một buổi, rồi gói hết hạn: hoàn 2 buổi chưa học và phần dư làm tròn
    const second = await call(
      'POST',
      '/bookings',
      { package_id: packageId, starts_at: new Date(at.getTime() + 24 * HOUR).toISOString() },
      parent.token,
    );
    assert.equal(second.status, 201, JSON.stringify(second.body));
    await database
      .updateTable('market_packages')
      .set({ expires_at: new Date(Date.now() - HOUR) })
      .where('id', '=', packageId)
      .execute();
    const due = await admin('POST', '/payments/run-due');
    assert.ok((due.body.packagesExpired as number) >= 1, JSON.stringify(due.body));
    list = await call('GET', '/packages', undefined, parent.token);
    pack = (
      list.body.packages as Array<{ id: string; sessions_used: number; status: string; refunded_amount: number }>
    ).find((row) => row.id === packageId) as typeof pack & { status: string; refunded_amount: number };
    assert.equal((pack as unknown as { status: string }).status, 'expired');
    assert.equal((pack as unknown as { refunded_amount: number }).refunded_amount, 400_000 - 133_333);
  });

  it('CT-365-2: hủy gói trước buổi đầu thì hoàn đủ', async () => {
    const parent = await registerParent();
    const tutor = await seedTutor();
    await database
      .updateTable('market_tutor_subjects')
      .set({ package_sessions: 4, package_price: 500_000 })
      .where('id', '=', tutor.subject)
      .execute();
    const created = await call(
      'POST',
      '/packages',
      { tutor_id: tutor.id, child_id: parent.childId, subject_id: tutor.subject, recording_consented: true },
      parent.token,
    );
    const packageId = created.body.id as string;
    await call('POST', `/packages/${packageId}/mock-pay`, {}, parent.token);
    const cancelled = await call('POST', `/packages/${packageId}/cancel`, {}, parent.token);
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.status, 'cancelled');
    assert.equal(cancelled.body.refunded_amount, 500_000);
  });
});
