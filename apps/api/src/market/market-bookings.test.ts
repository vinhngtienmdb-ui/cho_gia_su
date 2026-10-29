import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { MarketplaceDatabase } from '@cho-gia-su/database';
import type { Kysely } from 'kysely';
import { sendWithHost, startMarketApi, type MarketTestApi, type Reply } from '../test-support.js';
import { MarketContext } from './market-context.js';
import { MarketMessenger } from './market-messenger.js';
import { MarketplacePaymentProvider, type MockMarketplacePaymentProvider } from './market-payment-provider.js';

// Đặt buổi, thanh toán giả lập, giải ngân, hủy, tranh chấp ở chợ gia sư (DT-27 phần 27h, YCTD-258), CT-27h-2 đến CT-27h-6. Gia sư đã
// duyệt được dựng thẳng trong cơ sở dữ liệu chợ (luồng duyệt có kiểm thử riêng ở 27g); thời gian trôi bằng cách dời mốc giờ của buổi.
// Dữ liệu giả, nhà cung cấp thanh toán giả lập, không có tiền thật
const HOUR = 3_600_000;

describe('chợ gia sư: đặt buổi, thanh toán, tranh chấp (27h)', () => {
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

  async function registerParent(): Promise<{ token: string; childId: string; level: string }> {
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
    return { token, childId: child.body.id as string, level: 'THCS' };
  }

  // Gia sư đã duyệt: hồ sơ, môn, giờ trống cả tuần, danh tính và lý lịch tư pháp đã duyệt
  async function seedTutor(options: { schoolTeacher?: boolean } = {}) {
    const account = await database
      .insertInto('market_accounts')
      .values({
        kind: 'tutor',
        email: `gia-su-${Math.random().toString(36).slice(2, 10)}@example.test`,
        phone: null,
        password_hash: null,
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
    const subjects = await database
      .insertInto('market_tutor_subjects')
      .values([
        {
          account_id: account.id,
          subject: 'Toán',
          school_level: 'THCS',
          grade_from: 6,
          grade_to: 9,
          content_kind: 'curriculum',
          price_per_session: 200_000,
          session_minutes: 60,
        },
        {
          account_id: account.id,
          subject: 'Cờ vua',
          school_level: 'THCS',
          grade_from: 6,
          grade_to: 9,
          content_kind: 'enrichment',
          price_per_session: 150_000,
          session_minutes: 60,
        },
      ])
      .returning(['id', 'subject'])
      .execute();
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
    const nextYear = `${new Date().getFullYear() + 1}-12-31`;
    await database
      .insertInto('market_tutor_verifications')
      .values([
        {
          account_id: account.id,
          kind: 'identity',
          status: 'approved',
          details: '{}',
          document_id: null,
          decided_at: new Date(),
          decided_by: 'oidc',
          note: null,
          valid_until: null,
        },
        {
          account_id: account.id,
          kind: 'criminal_record',
          status: 'approved',
          details: '{}',
          document_id: null,
          decided_at: new Date(),
          decided_by: 'thu',
          note: null,
          valid_until: nextYear,
        },
      ])
      .execute();
    if (options.schoolTeacher) {
      await database
        .insertInto('market_tutor_school_roles')
        .values({ account_id: account.id, school_name: 'Trường giả', is_public: false, subjects: 'Toán', grades: '7A' })
        .execute();
    }
    // Đăng nhập gia sư bằng mật khẩu: đặt mật khẩu qua bảng (băm argon2id như máy chủ)
    const { hash } = await import('@node-rs/argon2');
    const email = (
      await database
        .selectFrom('market_accounts')
        .select('email')
        .where('id', '=', account.id)
        .executeTakeFirstOrThrow()
    ).email as string;
    await database
      .updateTable('market_accounts')
      .set({ password_hash: await hash('matkhau123') })
      .where('id', '=', account.id)
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
    return {
      id: account.id,
      token: login.body.session_token as string,
      math: subjects.find((row) => row.subject === 'Toán')?.id as string,
      chess: subjects.find((row) => row.subject === 'Cờ vua')?.id as string,
    };
  }

  // Giờ học tròn giờ, sau bây giờ một số giờ
  function slotIn(hours: number): string {
    const at = new Date(Date.now() + hours * HOUR);
    at.setUTCMinutes(0, 0, 0);
    return at.toISOString();
  }

  async function book(
    parent: { token: string; childId: string },
    tutor: { id: string },
    subjectId: string,
    hours: number,
    extra = {},
  ) {
    return call(
      'POST',
      '/bookings',
      {
        tutor_id: tutor.id,
        child_id: parent.childId,
        subject_id: subjectId,
        starts_at: slotIn(hours),
        recording_consented: true,
        ...extra,
      },
      parent.token,
    );
  }

  // Dời buổi về quá khứ để giả lập đã học
  async function moveToPast(bookingId: string, hoursAgo: number) {
    await database
      .updateTable('market_bookings')
      .set({ starts_at: new Date(Date.now() - hoursAgo * HOUR) })
      .where('id', '=', bookingId)
      .execute();
  }

  before(async () => {
    environment = await startMarketApi({
      label: 'db',
      configuration: {
        marketJobIntervalSeconds: 0,
      },
    });
    database = environment.api.get(MarketContext).database;
    provider = environment.api.get(MarketplacePaymentProvider) as MockMarketplacePaymentProvider;
    operators.push(await environment.adminToken('quan_tri'), await environment.adminToken('quan_tri'));
    for (const kind of ['terms', 'privacy', 'parent_consent', 'tutor_terms']) {
      const published = await admin('POST', '/documents', { kind, title: `Văn bản ${kind}`, body: 'Nội dung giả' });
      documents[kind] = published.body.id as string;
    }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    assert.equal(
      (await admin('POST', '/payments/commission-rules', { percent: 10, minimum: 0, effective_from: today })).status,
      200,
    );
  });

  after(async () => {
    await environment?.close();
  });

  it('CT-27h-2: đặt buổi, thanh toán giả lập, gia sư đánh dấu đã dạy, giải ngân trừ hoa hồng sau hạn khiếu nại', async () => {
    const parent = await registerParent();
    const tutor = await seedTutor();
    const created = await book(parent, tutor, tutor.chess, 72);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.status, 'held');
    assert.equal(created.body.commission, 15_000);
    assert.deepEqual(created.body.checkout, { kind: 'mock' });
    const id = created.body.id as string;
    // Trùng giờ với buổi đang giữ chỗ: từ chối
    assert.equal((await book(parent, tutor, tutor.math, 72)).status, 409);

    const paid = await call('POST', `/bookings/${id}/mock-pay`, {}, parent.token);
    assert.equal(paid.body.status, 'paid', JSON.stringify(paid.body));
    assert.equal(paid.body.payment_status, 'held');
    // Chưa đến giờ kết thúc thì chưa đánh dấu đã dạy
    assert.equal((await call('POST', `/tutor/bookings/${id}/complete`, {}, tutor.token)).status, 409);
    await moveToPast(id, 3);
    const completed = await call('POST', `/tutor/bookings/${id}/complete`, {}, tutor.token);
    assert.equal(completed.body.status, 'completed', JSON.stringify(completed.body));
    // Chưa hết hạn khiếu nại: chưa giải ngân
    assert.equal(((await admin('POST', '/payments/run-due')).body as { disbursed: number }).disbursed, 0);
    await database
      .updateTable('market_bookings')
      .set({ complaint_deadline: new Date(Date.now() - 1000) })
      .where('id', '=', id)
      .execute();
    assert.ok(((await admin('POST', '/payments/run-due')).body as { disbursed: number }).disbursed >= 1);
    const list = await call('GET', '/bookings', undefined, parent.token);
    const row = (list.body.bookings as Array<Record<string, unknown>>).find((item) => item.id === id);
    assert.equal(row?.status, 'disbursed');
    assert.equal(row?.released_amount, 135_000);
    assert.equal(row?.commission_taken, 15_000);
    const ref = provider.ledger.filter((entry) => entry.action === 'release').at(-1);
    assert.deepEqual([ref?.payout, ref?.commission], [135_000, 15_000]);
    const earnings = (await call('GET', '/tutor/bookings', undefined, tutor.token)).body.earnings as Record<
      string,
      number
    >;
    assert.equal(earnings.released, 135_000);
    // Phụ huynh không dùng được điểm cuối của gia sư (403 chỉ tài khoản gia sư)
    assert.equal((await call('GET', '/tutor/bookings', undefined, parent.token)).status, 403);
  });

  it('CT-27h-3: điều kiện đặt buổi: giờ trống, Tiểu học, cam kết của giáo viên đang dạy ở trường, đồng ý của cha mẹ, giữ chỗ quá hạn', async () => {
    const parent = await registerParent();
    const tutor = await seedTutor({ schoolTeacher: true });
    assert.equal((await book(parent, tutor, tutor.chess, 1)).status, 400, 'đặt trước ít nhất 2 giờ');
    // Trẻ dưới 18 tuổi: không đồng ý ghi hình thì không đặt được (27i)
    const noRecording = await book(parent, tutor, tutor.chess, 30, { recording_consented: false });
    assert.equal(noRecording.status, 400);
    assert.match(JSON.stringify(noRecording.body), /ghi hình/);
    const noAttest = await book(parent, tutor, tutor.math, 48);
    assert.equal(noAttest.status, 400);
    assert.match(JSON.stringify(noAttest.body), /cam kết/);
    assert.equal((await book(parent, tutor, tutor.math, 48, { no_assignment_attested: true })).status, 201);
    // Hồ sơ con Tiểu học không đặt được môn của chương trình (môn dựng sẵn cho Tiểu học)
    const primary = await database
      .insertInto('market_tutor_subjects')
      .values({
        account_id: tutor.id,
        subject: 'Toán lớp 4',
        school_level: 'TH',
        grade_from: 1,
        grade_to: 5,
        content_kind: 'curriculum',
        price_per_session: 100_000,
        session_minutes: 60,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await database
      .updateTable('market_children')
      .set({ school_level: 'TH', grade: 4 })
      .where('id', '=', parent.childId)
      .execute();
    const primaryReply = await book(parent, tutor, primary.id, 96, { no_assignment_attested: true });
    assert.equal(primaryReply.status, 400);
    assert.match(JSON.stringify(primaryReply.body), /Tiểu học/);
    await database
      .updateTable('market_children')
      .set({ school_level: 'THCS', grade: 7 })
      .where('id', '=', parent.childId)
      .execute();

    // Rút đồng ý của cha mẹ: không đặt được
    assert.equal((await call('POST', `/children/${parent.childId}/consent/withdraw`, {}, parent.token)).status, 200);
    assert.equal((await book(parent, tutor, tutor.chess, 120)).status, 400);
    await call(
      'POST',
      `/children/${parent.childId}/consent`,
      { consent_document_id: documents.parent_consent },
      parent.token,
    );

    // Giữ chỗ quá hạn: nhả chỗ; tiền về sau đó thì hoàn ngay
    const held = await book(parent, tutor, tutor.chess, 150);
    await database
      .updateTable('market_bookings')
      .set({ hold_expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', held.body.id as string)
      .execute();
    const late = await call('POST', `/bookings/${held.body.id as string}/mock-pay`, {}, parent.token);
    assert.equal(late.body.status, 'expired', JSON.stringify(late.body));
    assert.equal(late.body.refunded_amount, 150_000);
  });

  it('CT-27h-4: hủy theo GD-134: trước 24 giờ hoàn đủ, trong 24 giờ hoàn 50%, gia sư hủy hoàn đủ', async () => {
    const parent = await registerParent();
    const tutor = await seedTutor();
    const pay = async (hours: number) => {
      const created = await book(parent, tutor, tutor.chess, hours);
      await call('POST', `/bookings/${created.body.id as string}/mock-pay`, {}, parent.token);
      return created.body.id as string;
    };
    const early = await pay(72);
    const full = await call('POST', `/bookings/${early}/cancel`, { reason: 'Đổi lịch' }, parent.token);
    assert.equal(full.body.status, 'refunded');
    assert.equal(full.body.refunded_amount, 150_000);
    const late = await pay(20);
    const half = await call('POST', `/bookings/${late}/cancel`, {}, parent.token);
    assert.equal(half.body.status, 'cancelled');
    assert.equal(half.body.refunded_amount, 75_000);
    assert.equal(half.body.commission_taken, 7_500);
    const byTutor = await pay(30);
    const tutorCancel = await call('POST', `/tutor/bookings/${byTutor}/cancel`, { reason: 'Ốm' }, tutor.token);
    assert.equal(tutorCancel.body.refunded_amount, 150_000);
  });

  it('CT-27h-5: tranh chấp giữ tiền, hai bên trình bày, quyết định có lý do, khiếu nại lại do nhân viên khác xét', async () => {
    const parent = await registerParent();
    const tutor = await seedTutor();
    const created = await book(parent, tutor, tutor.math, 80);
    const id = created.body.id as string;
    await call('POST', `/bookings/${id}/mock-pay`, {}, parent.token);
    // Chưa đến giờ học thì chưa mở tranh chấp
    assert.equal((await call('POST', `/bookings/${id}/dispute`, { reason: 'x' }, parent.token)).status, 409);
    await moveToPast(id, 2);
    const opened = await call('POST', `/bookings/${id}/dispute`, { reason: 'Gia sư vào muộn 30 phút' }, parent.token);
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal((opened.body.booking as { status: string }).status, 'disputed');
    assert.ok(provider.ledger.some((entry) => entry.action === 'hold'));
    assert.equal((await call('POST', `/tutor/bookings/${id}/complete`, {}, tutor.token)).status, 409);
    assert.equal(
      (await call('POST', `/disputes/${id}/statements`, { body: 'Mạng chập chờn, đã bù giờ' }, tutor.token)).status,
      200,
    );
    assert.equal((await call('POST', `/disputes/${id}/statements`, { body: 'Không bù đủ' }, parent.token)).status, 200);
    // Thiếu lý do: từ chối; nhân viên một hoàn một phần
    assert.equal((await admin('POST', `/payments/disputes/${id}/decide`, { decision: 'release' })).status, 400);
    const decided = await admin('POST', `/payments/disputes/${id}/decide`, {
      decision: 'refund_partial',
      refund_amount: 50_000,
      note: 'Vào muộn nửa giờ',
    });
    assert.equal(decided.body.status, 'decided', JSON.stringify(decided.body));
    assert.equal((decided.body.statements as unknown[]).length, 2);
    // Gia sư khiếu nại lại; nhân viên một không xét lại được, nhân viên hai quyết định giải ngân
    assert.equal((await call('POST', `/disputes/${id}/appeal`, { reason: 'Đã bù đủ giờ' }, tutor.token)).status, 200);
    assert.equal(
      (await admin('POST', `/payments/disputes/${id}/decide`, { decision: 'release', note: 'Xét lại' }, 0)).status,
      403,
    );
    const final = await admin(
      'POST',
      `/payments/disputes/${id}/decide`,
      { decision: 'release', note: 'Có bằng chứng bù giờ' },
      1,
    );
    assert.equal(final.body.status, 'final', JSON.stringify(final.body));
    const booking = final.body.booking as Record<string, unknown>;
    assert.equal(booking.status, 'disbursed');
    assert.equal(booking.released_amount, 180_000);
    assert.equal(booking.commission_taken, 20_000);
    assert.ok(provider.ledger.some((entry) => entry.action === 'unhold'));
  });

  it('CT-27h-6: sự kiện của nhà cung cấp: sai chữ ký bị từ chối, nhận trùng chỉ xử lý một lần; thu tiền thật không bật được', async () => {
    const parent = await registerParent();
    const tutor = await seedTutor();
    const created = await book(parent, tutor, tutor.chess, 100);
    const payment = await database
      .selectFrom('market_payments')
      .select(['provider_ref', 'amount'])
      .where('booking_id', '=', created.body.id as string)
      .executeTakeFirstOrThrow();
    const signed = provider.signedEvent({
      eventId: `evt-${Date.now()}`,
      type: 'charge.succeeded',
      providerRef: payment.provider_ref,
      amount: payment.amount,
    });
    // Gửi sự kiện như nhà cung cấp: không có tên miền của chợ, chỉ có chữ ký
    const sendRaw = (signature: string) =>
      new Promise<number>((resolve, reject) => {
        const url = new URL(`${environment.apiOrigin}/api/v1/market/payments/webhooks/mock`);
        const payload = JSON.stringify(signed.body);
        const request = http.request(
          {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-market-signature': signature,
              'content-length': Buffer.byteLength(payload),
            },
          },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode ?? 0));
          },
        );
        request.on('error', reject);
        request.end(payload);
      });
    assert.equal(await sendRaw('sai-chu-ky'), 401);
    assert.equal(await sendRaw(signed.signature), 200);
    assert.equal(await sendRaw(signed.signature), 200);
    const events = await database
      .selectFrom('market_payment_events')
      .select('id')
      .where('provider_ref', '=', payment.provider_ref)
      .execute();
    assert.equal(events.length, 1);
    const list = await call('GET', '/bookings', undefined, parent.token);
    assert.equal(
      (list.body.bookings as Array<Record<string, unknown>>).find((row) => row.id === created.body.id)?.status,
      'paid',
    );
    // Thu tiền thật: cấu hình không bật được
    const blocked = await admin('PUT', '/settings', { real_payments_enabled: true });
    assert.equal(blocked.status, 400);
  });
});
