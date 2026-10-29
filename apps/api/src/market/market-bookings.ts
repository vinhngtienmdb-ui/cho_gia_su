import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { MarketplaceDatabase, MarketBookingStatus } from '@cho-gia-su/database';
import { ApplicationError, validationError, type FieldError } from '../common/server.js';
import type { Request } from 'express';
import { sql, type Kysely, type Transaction } from 'kysely';
import { randomUUID } from 'node:crypto';
import { PublicEndpoint } from '../common/public-endpoint.js';
import { API_CONFIGURATION, type ApiConfiguration } from '../common/configuration.js';
import type { RequestBody } from '../common/request-fields.js';
import { MarketAccountsService } from './market-accounts.js';
import {
  cancellationRefund,
  commissionFor,
  contentProblems,
  fitsAvailability,
  overlaps,
  pickCommissionRule,
  settlement,
  vietnamClock,
  type CommissionRule,
} from './market-booking-rules.js';
import { MarketContext, marketNotFound } from './market-context.js';
import { isMinor, notSuspended } from './market-safety-rules.js';
import { vietnamToday } from './market-listing.js';
import {
  MarketplacePaymentProvider,
  MockMarketplacePaymentProvider,
  PaymentEventError,
  type PaymentEvent,
} from './market-payment-provider.js';

// Đặt buổi, thanh toán giữ tiền, giải ngân, hoàn tiền, tranh chấp ở chợ gia sư (DT-27 phần 27h, YCTD-258; tài liệu 47 mục 19.5). Phụ
// huynh đặt ở Chợ gia sư, gia sư xem buổi và thu nhập ở ứng dụng Gia sư. Claude tự chọn theo ủy quyền của Eric ngày 2026-10-11:
// - đặt buổi lẻ ít nhất 2 giờ trước giờ học, trong 60 ngày tới, nằm trọn trong giờ trống của gia sư (giờ Việt Nam), không trùng buổi khác
//   của gia sư hoặc của con; giữ chỗ 30 phút chờ trả tiền, quá hạn thì nhả chỗ;
// - hồ sơ con phải còn đồng ý của cha mẹ; cấp, lớp của con phải thuộc môn đã chọn; không dạy thêm môn của chương trình cho học sinh
//   Tiểu học; gia sư đang dạy ở trường dạy môn của chương trình thì phụ huynh cam kết con không do gia sư dạy ở trường (chưa so khớp tự
//   động được vì chợ chưa có phân công của trường);
// - giá, hoa hồng chụp lại lúc đặt; hoa hồng theo quy tắc cấu hình (cụ thể nhất, ngày hiệu lực gần nhất), không có quy tắc thì theo tỷ lệ
//   mặc định của cấu hình chợ (để trống là 0, E-01);
// - gia sư đánh dấu đã dạy sau giờ kết thúc; giải ngân (trừ hoa hồng) khi hết hạn khiếu nại (GD-133) mà không có tranh chấp; điểm danh
//   bằng phòng video của 27a ở ngữ cảnh chợ làm sau (bản này dựa vào đánh dấu của gia sư và quyền khiếu nại của phụ huynh);
// - phụ huynh hủy theo GD-134 (trước 24 giờ hoàn đủ, trong 24 giờ hoàn 50%), gia sư hủy hoàn đủ;
// - tranh chấp mở trong hạn khiếu nại, tiền bị giữ; hai bên nộp trình bày; nhân viên nền tảng quyết định hoàn đủ, hoàn một phần hoặc giải
//   ngân, có lý do; một lần khiếu nại lại trong 7 ngày, do nhân viên khác xét;
// - thu tiền thật không bật được: nhà cung cấp chuyển tiền thật bị từ chối khi cấu hình chợ chưa bật (luôn tắt ở bản này)
const HOLD_MINUTES = 30;
const MINIMUM_LEAD_MS = 2 * 3_600_000;
const MAXIMUM_AHEAD_MS = 60 * 24 * 3_600_000;
const APPEAL_DAYS = 7;
const ACTIVE: MarketBookingStatus[] = ['held', 'paid', 'completed', 'disputed'];
const PACKAGE_REF_PREFIX = 'pkg:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Database = Kysely<MarketplaceDatabase>;
type Executor = Database | Transaction<MarketplaceDatabase>;

// Nhà cung cấp chuyển tiền thật chỉ dùng khi cấu hình chợ bật thu tiền thật (luôn tắt đến khi xong E-01 đến E-07)
export function assertProviderAllowed(
  provider: { realMoney: boolean; code: string },
  realPaymentsEnabled: boolean,
): void {
  if (provider.realMoney && !realPaymentsEnabled) {
    throw new ApplicationError(
      'ERR_CONFLICT',
      `Nhà cung cấp ${provider.code} chuyển tiền thật nhưng chợ chưa bật thu tiền thật (cần xong E-01 đến E-07)`,
    );
  }
}

function text(body: RequestBody, field: string, max: number, errors: FieldError[]): string {
  const value = typeof body?.[field] === 'string' ? (body[field] as string).trim() : '';
  if (value.length < 1 || value.length > max) {
    errors.push({ field, message: `Bắt buộc, tối đa ${max} ký tự` });
  }
  return value;
}

@Injectable()
export class MarketBookingsService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly market: MarketContext,
    private readonly accounts: MarketAccountsService,
    private readonly provider: MarketplacePaymentProvider,
    @Inject(API_CONFIGURATION) private readonly configuration: ApiConfiguration,
  ) {}

  // Việc định kỳ của chợ: nhả chỗ giữ quá hạn, giải ngân buổi hết hạn khiếu nại (MARKET_JOB_INTERVAL_SECONDS, mặc định 300; 0 là tắt)
  onApplicationBootstrap(): void {
    const seconds = this.configuration.marketJobIntervalSeconds ?? 300;
    if (!this.market.available || seconds <= 0) return;
    this.timer = setInterval(() => {
      void this.runDue().catch(() => undefined);
    }, seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async assertPaymentsAllowed() {
    const settings = await this.market.settings();
    assertProviderAllowed(this.provider, settings.realPaymentsEnabled);
    return settings;
  }

  // ---------- Phụ huynh

  async create(request: Request, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'parent');
    const settings = await this.assertPaymentsAllowed();
    // Buổi đặt từ gói đã trả tiền (YCTD-365): không thu tiền thêm
    if (body?.package_id !== undefined) return this.createFromPackage(account, body);
    const database = this.market.database;
    const errors: FieldError[] = [];
    const tutorId = typeof body?.tutor_id === 'string' && UUID.test(body.tutor_id) ? body.tutor_id : '';
    const childId = typeof body?.child_id === 'string' && UUID.test(body.child_id) ? body.child_id : '';
    const subjectId = typeof body?.subject_id === 'string' && UUID.test(body.subject_id) ? body.subject_id : '';
    const startsAt = typeof body?.starts_at === 'string' ? new Date(body.starts_at) : new Date(Number.NaN);
    const attested = body?.no_assignment_attested === true;
    const recordingConsented = body?.recording_consented === true;
    if (!tutorId) errors.push({ field: 'tutor_id', message: 'Chọn gia sư' });
    if (!childId) errors.push({ field: 'child_id', message: 'Chọn hồ sơ con' });
    if (!subjectId) errors.push({ field: 'subject_id', message: 'Chọn môn' });
    if (Number.isNaN(startsAt.getTime())) errors.push({ field: 'starts_at', message: 'Chọn giờ học' });
    if (errors.length > 0) throw validationError(errors);
    const now = this.market.now();
    if (startsAt.getTime() < now.getTime() + MINIMUM_LEAD_MS || startsAt.getTime() > now.getTime() + MAXIMUM_AHEAD_MS) {
      throw validationError([{ field: 'starts_at', message: 'Đặt trước ít nhất 2 giờ, trong vòng 60 ngày tới' }]);
    }
    const [child, consent, subject, tutor, role, slots] = await Promise.all([
      database
        .selectFrom('market_children')
        .select(['id', 'display_name', 'school_level', 'grade', 'birth_year'])
        .where('id', '=', childId)
        .where('parent_account_id', '=', account.id)
        .executeTakeFirst(),
      database
        .selectFrom('market_consents')
        .innerJoin('market_legal_documents', 'market_legal_documents.id', 'market_consents.document_id')
        .select('market_consents.id')
        .where('market_consents.child_id', '=', childId)
        .where('market_consents.withdrawn_at', 'is', null)
        .where('market_legal_documents.kind', '=', 'parent_consent')
        .executeTakeFirst(),
      database
        .selectFrom('market_tutor_subjects')
        .select([
          'subject',
          'school_level',
          'grade_from',
          'grade_to',
          'content_kind',
          'price_per_session',
          'session_minutes',
        ])
        .where('id', '=', subjectId)
        .where('account_id', '=', tutorId)
        .executeTakeFirst(),
      this.visibleTutor(database, tutorId),
      database
        .selectFrom('market_tutor_school_roles')
        .select('account_id')
        .where('account_id', '=', tutorId)
        .executeTakeFirst(),
      database
        .selectFrom('market_tutor_availability')
        .select(['weekday', 'start_minute', 'end_minute'])
        .where('account_id', '=', tutorId)
        .execute(),
    ]);
    if (!child) throw validationError([{ field: 'child_id', message: 'Không tìm thấy hồ sơ con' }]);
    if (!consent) {
      throw validationError([
        { field: 'child_id', message: 'Hồ sơ con chưa có đồng ý của cha mẹ; đồng ý lại trước khi đặt buổi' },
      ]);
    }
    if (!tutor || !subject) throw marketNotFound();
    if (
      child.school_level !== subject.school_level ||
      child.grade < subject.grade_from ||
      child.grade > subject.grade_to
    ) {
      throw validationError([{ field: 'subject_id', message: 'Môn này không dạy cấp, lớp của con' }]);
    }
    const problems = contentProblems({
      schoolLevel: child.school_level,
      contentKind: subject.content_kind,
      tutorIsSchoolTeacher: Boolean(role),
      attestedNoAssignment: attested,
    });
    if (problems.length > 0) throw validationError(problems);
    // Buổi có trẻ vị thành niên luôn ghi hình (27i, tài liệu 47 mục 19.2); không đồng ý thì không đặt được
    const recordingRequired = isMinor(child.birth_year, now);
    if (recordingRequired && !recordingConsented) {
      throw validationError([
        {
          field: 'recording_consented',
          message: 'Buổi học với trẻ dưới 18 tuổi luôn được ghi hình để bảo vệ trẻ; đồng ý ghi hình để đặt buổi',
        },
      ]);
    }
    if (!fitsAvailability(startsAt, subject.session_minutes, slots)) {
      throw validationError([
        { field: 'starts_at', message: 'Giờ học không nằm trong giờ trống của gia sư (giờ Việt Nam)' },
      ]);
    }
    const rules = (await database
      .selectFrom('market_commission_rules')
      .select(['content_kind', 'tutor_account_id', 'percent', 'minimum', 'effective_from'])
      .execute()) as unknown as Array<Omit<CommissionRule, 'percent'> & { percent: string }>;
    const rule = pickCommissionRule(
      rules.map((item) => ({
        ...item,
        percent: Number(item.percent),
        effective_from: String(item.effective_from).slice(0, 10),
      })),
      { contentKind: subject.content_kind, tutorId, date: vietnamClock(now).date },
    );
    const commission = commissionFor(subject.price_per_session, rule, settings.defaultCommissionPercent);
    const booking = await database.transaction().execute(async (trx) => {
      await this.expireHolds(trx, now);
      // Khóa theo gia sư để hai lượt đặt cùng lúc không cùng giữ một giờ
      await sql`select pg_advisory_xact_lock(hashtext(${tutorId}))`.execute(trx);
      const busy = await trx
        .selectFrom('market_bookings')
        .select(['starts_at', 'minutes', 'tutor_account_id', 'child_id'])
        .where('status', 'in', ACTIVE)
        .where((eb) => eb.or([eb('tutor_account_id', '=', tutorId), eb('child_id', '=', childId)]))
        .where('starts_at', '>', new Date(startsAt.getTime() - 4 * 3_600_000))
        .where('starts_at', '<', new Date(startsAt.getTime() + 4 * 3_600_000))
        .execute();
      if (busy.some((row) => overlaps(startsAt, subject.session_minutes, row.starts_at, row.minutes))) {
        throw new ApplicationError('ERR_CONFLICT', 'Giờ này gia sư hoặc con đã có buổi khác');
      }
      return trx
        .insertInto('market_bookings')
        .values({
          parent_account_id: account.id,
          child_id: child.id,
          child_name: child.display_name,
          tutor_account_id: tutorId,
          subject: subject.subject,
          school_level: subject.school_level,
          grade: child.grade,
          content_kind: subject.content_kind,
          starts_at: startsAt,
          minutes: subject.session_minutes,
          price: subject.price_per_session,
          commission,
          status: 'held',
          hold_expires_at: new Date(now.getTime() + HOLD_MINUTES * 60_000),
          no_assignment_attested: attested,
          recording_required: recordingRequired,
          recording_consented: recordingRequired && recordingConsented,
        })
        .returning(['id', 'price'])
        .executeTakeFirstOrThrow();
    });
    const charge = await this.provider.createHeldCharge({
      reference: booking.id,
      amount: booking.price,
      description: `Buổi học ${subject.subject} với gia sư ${tutor.display_name}`,
    });
    await database
      .insertInto('market_payments')
      .values({
        booking_id: booking.id,
        provider: this.provider.code,
        provider_ref: charge.providerRef,
        amount: booking.price,
        commission,
        status: 'pending',
      })
      .execute();
    await this.market.audit({
      actorType: 'account',
      actorId: account.id,
      action: 'booking.create',
      target: booking.id,
    });
    return { ...(await this.bookingView(booking.id)), checkout: charge.checkout };
  }

  private visibleTutor(database: Database, tutorId: string) {
    const today = vietnamToday(this.market.now());
    return database
      .selectFrom('market_tutor_profiles')
      .innerJoin('market_accounts', 'market_accounts.id', 'market_tutor_profiles.account_id')
      .select(['market_accounts.id', 'market_accounts.display_name'])
      .where('market_tutor_profiles.account_id', '=', tutorId)
      .where('market_tutor_profiles.status', '=', 'approved')
      .where('market_accounts.status', '=', 'active')
      .where(notSuspended('market_tutor_profiles.account_id'))
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('market_tutor_verifications')
            .select('market_tutor_verifications.account_id')
            .whereRef('market_tutor_verifications.account_id', '=', 'market_tutor_profiles.account_id')
            .where('market_tutor_verifications.kind', '=', 'criminal_record')
            .where('market_tutor_verifications.status', '=', 'approved')
            .where('market_tutor_verifications.valid_until', '>=', today),
        ),
      )
      .executeTakeFirst();
  }

  private async bookingView(id: string) {
    const row = await this.market.database
      .selectFrom('market_bookings')
      .innerJoin('market_accounts as tutor', 'tutor.id', 'market_bookings.tutor_account_id')
      .leftJoin('market_payments', 'market_payments.booking_id', 'market_bookings.id')
      .leftJoin('market_disputes', 'market_disputes.booking_id', 'market_bookings.id')
      .select([
        'market_bookings.id',
        'market_bookings.child_name',
        'market_bookings.package_id',
        'market_bookings.subject',
        'market_bookings.school_level',
        'market_bookings.grade',
        'market_bookings.content_kind',
        'market_bookings.starts_at',
        'market_bookings.minutes',
        'market_bookings.price',
        'market_bookings.commission',
        'market_bookings.status',
        'market_bookings.hold_expires_at',
        'market_bookings.complaint_deadline',
        'market_bookings.cancelled_by',
        'market_bookings.cancel_reason',
        'market_bookings.recording_required',
        'tutor.display_name as tutor_name',
        'market_bookings.tutor_account_id as tutor_id',
        'market_payments.status as payment_status',
        'market_payments.refunded_amount',
        'market_payments.released_amount',
        'market_payments.commission_taken',
        'market_disputes.status as dispute_status',
        'market_disputes.decision',
        'market_disputes.final_decision',
        'market_disputes.decision_note',
        'market_disputes.final_note',
      ])
      .where('market_bookings.id', '=', id)
      .executeTakeFirstOrThrow();
    return row;
  }

  async listForParent(request: Request) {
    const account = await this.accounts.requireReady(request, 'parent');
    await this.expireHolds(this.market.database, this.market.now());
    const ids = await this.market.database
      .selectFrom('market_bookings')
      .select('id')
      .where('parent_account_id', '=', account.id)
      .orderBy('starts_at', 'desc')
      .limit(100)
      .execute();
    return { bookings: await Promise.all(ids.map((row) => this.bookingView(row.id))) };
  }

  private async ownBooking(
    executor: Executor,
    id: string,
    field: 'parent_account_id' | 'tutor_account_id',
    accountId: string,
  ) {
    const row = UUID.test(id)
      ? await executor
          .selectFrom('market_bookings')
          .selectAll()
          .where('id', '=', id)
          .where(field, '=', accountId)
          .forUpdate()
          .executeTakeFirst()
      : undefined;
    if (!row) throw marketNotFound();
    return row;
  }

  // Thanh toán giả lập: chỉ khi nhà cung cấp là `mock`; tạo sự kiện "đã thu" có chữ ký rồi xử lý như sự kiện từ nhà cung cấp
  async mockPay(request: Request, id: string) {
    const account = await this.accounts.requireReady(request, 'parent');
    if (!(this.provider instanceof MockMarketplacePaymentProvider)) throw marketNotFound();
    const booking = await this.ownBooking(this.market.database, id, 'parent_account_id', account.id);
    const payment = await this.market.database
      .selectFrom('market_payments')
      .select(['provider_ref', 'amount'])
      .where('booking_id', '=', booking.id)
      .executeTakeFirstOrThrow();
    const signed = this.provider.signedEvent({
      eventId: `mock_evt_${randomUUID()}`,
      type: 'charge.succeeded',
      providerRef: payment.provider_ref,
      amount: payment.amount,
    });
    await this.handleWebhook(this.provider.code, signed.body, signed.signature);
    return this.bookingView(booking.id);
  }

  // Sự kiện của nhà cung cấp: kiểm chữ ký, ghi một lần theo mã sự kiện, đã thu đủ thì xác nhận buổi; thu sau khi chỗ đã nhả thì hoàn ngay
  async handleWebhook(providerCode: string, body: unknown, signature: string | undefined) {
    if (!this.market.available || providerCode !== this.provider.code) throw marketNotFound();
    let event: PaymentEvent;
    try {
      event = this.provider.verifyEvent(body, signature);
    } catch (error) {
      if (error instanceof PaymentEventError) {
        throw new ApplicationError('ERR_UNAUTHENTICATED', error.message);
      }
      throw error;
    }
    const now = this.market.now();
    const outcome = await this.market.database.transaction().execute(async (trx) => {
      const recorded = await trx
        .insertInto('market_payment_events')
        .values({
          provider: providerCode,
          event_id: event.eventId,
          type: event.type,
          provider_ref: event.providerRef,
          payload: JSON.stringify(body),
        })
        .onConflict((conflict) => conflict.columns(['provider', 'event_id']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!recorded) return { duplicate: true as const };
      const payment = await trx
        .selectFrom('market_payments')
        .innerJoin('market_bookings', 'market_bookings.id', 'market_payments.booking_id')
        .select([
          'market_payments.id',
          'market_payments.amount',
          'market_payments.status',
          'market_payments.provider_ref',
          'market_bookings.id as booking_id',
          'market_bookings.status as booking_status',
          'market_bookings.hold_expires_at',
        ])
        .where('market_payments.provider_ref', '=', event.providerRef)
        .forUpdate()
        .executeTakeFirst();
      // Mã tham chiếu không phải của buổi lẻ: có thể là của gói buổi (YCTD-365)
      if (!payment) return { duplicate: false as const, refundLate: await this.packagePaid(trx, event, now) };
      if (payment.status !== 'pending') return { duplicate: false as const, refundLate: null };
      if (event.type === 'charge.failed' || event.amount !== payment.amount) {
        await trx
          .updateTable('market_payments')
          .set({ status: 'failed', updated_at: now })
          .where('id', '=', payment.id)
          .execute();
        return { duplicate: false as const, refundLate: null };
      }
      if (payment.booking_status !== 'held' || payment.hold_expires_at.getTime() <= now.getTime()) {
        // Chỗ đã nhả hoặc buổi đã hủy: tiền về thì hoàn đủ
        await trx
          .updateTable('market_payments')
          .set({ status: 'settled', refunded_amount: payment.amount, updated_at: now })
          .where('id', '=', payment.id)
          .execute();
        await trx
          .updateTable('market_bookings')
          .set({ status: payment.booking_status === 'held' ? 'expired' : payment.booking_status, updated_at: now })
          .where('id', '=', payment.booking_id)
          .execute();
        return { duplicate: false as const, refundLate: { providerRef: payment.provider_ref, amount: payment.amount } };
      }
      await trx
        .updateTable('market_payments')
        .set({ status: 'held', updated_at: now })
        .where('id', '=', payment.id)
        .execute();
      await trx
        .updateTable('market_bookings')
        .set({ status: 'paid', updated_at: now })
        .where('id', '=', payment.booking_id)
        .execute();
      return { duplicate: false as const, refundLate: null };
    });
    if (!outcome.duplicate && outcome.refundLate) {
      await this.provider.refund(outcome.refundLate);
    }
    return { received: true };
  }

  async cancelByParent(request: Request, id: string, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'parent');
    return this.cancel(id, 'parent', 'parent_account_id', account.id, body);
  }

  async cancelByTutor(request: Request, id: string, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'tutor');
    return this.cancel(id, 'tutor', 'tutor_account_id', account.id, body);
  }

  // Tạm khóa gia sư (27i): hủy mọi buổi sắp tới của gia sư, phụ huynh được hoàn đủ như khi gia sư hủy; trả danh sách buổi đã hủy
  async cancelForSuspension(tutorId: string, reason: string) {
    const upcoming = await this.market.database
      .selectFrom('market_bookings')
      .select(['id', 'parent_account_id', 'subject', 'starts_at'])
      .where('tutor_account_id', '=', tutorId)
      .where('status', 'in', ['held', 'paid'])
      .where('starts_at', '>', this.market.now())
      .execute();
    for (const booking of upcoming) {
      await this.cancel(booking.id, 'system', 'tutor_account_id', tutorId, { reason });
    }
    // Gói đang dùng của gia sư: hoàn phần còn lại (YCTD-365, GD-165)
    await this.refundPackagesForSuspension(tutorId);
    return upcoming;
  }

  // Phòng học video (YCTD-362, GD-164): gia sư vắng (phụ huynh báo khi gia sư chưa vào phòng quá mốc), hoặc phụ huynh không đồng ý ghi
  // hình buổi có trẻ vị thành niên: hủy và hoàn đủ
  async cancelForTutorNoShow(id: string, parentId: string) {
    return this.cancel(id, 'system', 'parent_account_id', parentId, {}, 'Gia sư vắng: hoàn đủ');
  }

  async cancelForRecordingDeclined(id: string, parentId: string) {
    return this.cancel(id, 'parent', 'parent_account_id', parentId, {}, 'Phụ huynh không đồng ý ghi hình: hoàn đủ');
  }

  private async cancel(
    id: string,
    by: 'parent' | 'tutor' | 'system',
    field: 'parent_account_id' | 'tutor_account_id',
    accountId: string,
    body: RequestBody,
    // Hoàn đủ theo quy tắc riêng (gia sư vắng, không đồng ý ghi hình), kể cả khi buổi đã tới giờ; null thì theo chính sách hủy
    fullRefundRule: string | null = null,
  ) {
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    const now = this.market.now();
    const result = await this.market.database.transaction().execute(async (trx) => {
      const booking = await this.ownBooking(trx, id, field, accountId);
      if (booking.status === 'held') {
        if (by === 'tutor')
          throw new ApplicationError('ERR_CONFLICT', 'Buổi chưa trả tiền; phụ huynh sẽ tự hủy hoặc chỗ tự nhả');
        await trx
          .updateTable('market_bookings')
          .set({
            status: 'cancelled',
            cancelled_by: by,
            cancelled_at: now,
            cancel_reason: reason || null,
            updated_at: now,
          })
          .where('id', '=', booking.id)
          .execute();
        await trx
          .updateTable('market_payments')
          .set({ status: 'failed', updated_at: now })
          .where('booking_id', '=', booking.id)
          .execute();
        return null;
      }
      if (booking.status !== 'paid') {
        throw new ApplicationError('ERR_CONFLICT', 'Chỉ hủy được buổi đã trả tiền và chưa học');
      }
      // Buổi của gói (YCTD-365): hủy thì trả lượt về gói, không chuyển tiền; phụ huynh hủy trong 24 giờ trước giờ học thì không trả lượt
      // nên không cho hủy (gia sư hủy, gia sư vắng, tạm khóa, không đồng ý ghi hình vẫn trả lượt)
      if (booking.package_id) {
        if (by === 'parent' && !fullRefundRule) {
          const policy = cancellationRefund(booking.price, booking.starts_at, now, 'parent');
          if (!policy.allowed || policy.refund < booking.price) {
            throw new ApplicationError('ERR_CONFLICT', 'Buổi trong gói chỉ hủy được trước giờ học 24 giờ');
          }
        }
        await trx
          .updateTable('market_payments')
          .set({ status: 'settled', updated_at: now })
          .where('booking_id', '=', booking.id)
          .execute();
        await trx
          .updateTable('market_bookings')
          .set({
            status: 'cancelled',
            cancelled_by: by,
            cancelled_at: now,
            cancel_reason: [fullRefundRule ?? 'Trả lượt về gói', reason].filter(Boolean).join('. '),
            updated_at: now,
          })
          .where('id', '=', booking.id)
          .execute();
        return null;
      }
      const policy = fullRefundRule
        ? { refund: booking.price, allowed: true, rule: fullRefundRule }
        : cancellationRefund(booking.price, booking.starts_at, now, by === 'parent' ? 'parent' : 'tutor');
      if (!policy.allowed) throw new ApplicationError('ERR_CONFLICT', policy.rule);
      const split = settlement(booking.price, booking.commission, policy.refund);
      const payment = await trx
        .updateTable('market_payments')
        .set({
          status: 'settled',
          refunded_amount: split.refund,
          released_amount: split.payout,
          commission_taken: split.commission,
          updated_at: now,
        })
        .where('booking_id', '=', booking.id)
        .returning('provider_ref')
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('market_bookings')
        .set({
          status: split.refund === booking.price ? 'refunded' : 'cancelled',
          cancelled_by: by,
          cancelled_at: now,
          cancel_reason: [policy.rule, reason].filter(Boolean).join('. '),
          updated_at: now,
        })
        .where('id', '=', booking.id)
        .execute();
      return { providerRef: payment.provider_ref, split };
    });
    if (result) {
      if (result.split.refund > 0)
        await this.refundFunds({ providerRef: result.providerRef, amount: result.split.refund });
      if (result.split.payout + result.split.commission > 0) {
        await this.releaseFunds({
          providerRef: result.providerRef,
          payout: result.split.payout,
          commission: result.split.commission,
        });
      }
    }
    await this.market.audit({
      actorType: by === 'system' ? 'system' : 'account',
      ...(by === 'system' ? {} : { actorId: accountId }),
      action: 'booking.cancel',
      target: id,
      details: { by },
    });
    return this.bookingView(id);
  }

  async openDispute(request: Request, id: string, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'parent');
    const errors: FieldError[] = [];
    const reason = text(body, 'reason', 2000, errors);
    if (errors.length > 0) throw validationError(errors);
    const now = this.market.now();
    const settings = await this.market.settings();
    const providerRef = await this.market.database.transaction().execute(async (trx) => {
      const booking = await this.ownBooking(trx, id, 'parent_account_id', account.id);
      const end = booking.starts_at.getTime() + booking.minutes * 60_000;
      const deadline = booking.complaint_deadline?.getTime() ?? end + settings.complaintWindowHours * 3_600_000;
      if (
        (booking.status !== 'paid' && booking.status !== 'completed') ||
        now.getTime() < booking.starts_at.getTime()
      ) {
        throw new ApplicationError('ERR_CONFLICT', 'Chỉ mở tranh chấp cho buổi đã trả tiền, từ giờ bắt đầu học');
      }
      if (now.getTime() > deadline) throw new ApplicationError('ERR_CONFLICT', 'Đã hết hạn khiếu nại của buổi này');
      await trx.insertInto('market_disputes').values({ booking_id: booking.id, reason }).execute();
      await trx
        .updateTable('market_bookings')
        .set({ status: 'disputed', updated_at: now })
        .where('id', '=', booking.id)
        .execute();
      const payment = await trx
        .updateTable('market_payments')
        .set({ held_for_dispute: true, updated_at: now })
        .where('booking_id', '=', booking.id)
        .returning('provider_ref')
        .executeTakeFirstOrThrow();
      return payment.provider_ref;
    });
    await this.disputeHoldFunds({ providerRef, held: true });
    await this.market.audit({ actorType: 'account', actorId: account.id, action: 'dispute.open', target: id });
    return this.disputeView(id);
  }

  // Trình bày của phụ huynh (Chợ gia sư) hoặc gia sư (ứng dụng Gia sư) cho tranh chấp đang mở hoặc đang xét lại
  async addStatement(request: Request, id: string, body: RequestBody) {
    const account = await this.market.account(request);
    const field = account.kind === 'parent' ? 'parent_account_id' : 'tutor_account_id';
    const errors: FieldError[] = [];
    const statement = text(body, 'body', 4000, errors);
    if (errors.length > 0) throw validationError(errors);
    const booking = await this.ownBooking(this.market.database, id, field, account.id);
    const dispute = await this.market.database
      .selectFrom('market_disputes')
      .select(['id', 'status'])
      .where('booking_id', '=', booking.id)
      .executeTakeFirst();
    if (!dispute || (dispute.status !== 'open' && dispute.status !== 'appealed')) {
      throw new ApplicationError('ERR_CONFLICT', 'Không có tranh chấp đang xét cho buổi này');
    }
    await this.market.database
      .insertInto('market_dispute_statements')
      .values({ dispute_id: dispute.id, author_account_id: account.id, role: account.kind, body: statement })
      .execute();
    return this.disputeView(id);
  }

  async appeal(request: Request, id: string, body: RequestBody) {
    const account = await this.market.account(request);
    const field = account.kind === 'parent' ? 'parent_account_id' : 'tutor_account_id';
    const errors: FieldError[] = [];
    const reason = text(body, 'reason', 2000, errors);
    if (errors.length > 0) throw validationError(errors);
    const now = this.market.now();
    const booking = await this.ownBooking(this.market.database, id, field, account.id);
    const updated = await this.market.database
      .updateTable('market_disputes')
      .set({ status: 'appealed', appeal_reason: reason, appealed_by: account.kind, appealed_at: now })
      .where('booking_id', '=', booking.id)
      .where('status', '=', 'decided')
      .where('decided_at', '>', new Date(now.getTime() - APPEAL_DAYS * 24 * 3_600_000))
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 0) {
      throw new ApplicationError('ERR_CONFLICT', 'Chỉ khiếu nại lại một lần, trong 7 ngày sau quyết định');
    }
    await this.market.audit({ actorType: 'account', actorId: account.id, action: 'dispute.appeal', target: id });
    return this.disputeView(id);
  }

  async disputeView(id: string) {
    const dispute = await this.market.database
      .selectFrom('market_disputes')
      .selectAll()
      .where('booking_id', '=', id)
      .executeTakeFirst();
    if (!dispute) throw marketNotFound();
    const statements = await this.market.database
      .selectFrom('market_dispute_statements')
      .select(['role', 'body', 'created_at'])
      .where('dispute_id', '=', dispute.id)
      .orderBy('created_at')
      .execute();
    return { ...dispute, booking: await this.bookingView(id), statements };
  }

  async parentDispute(request: Request, id: string) {
    const account = await this.accounts.requireReady(request, 'parent');
    await this.ownBooking(this.market.database, id, 'parent_account_id', account.id);
    return this.disputeView(id);
  }

  async tutorDispute(request: Request, id: string) {
    const account = await this.accounts.requireReady(request, 'tutor');
    await this.ownBooking(this.market.database, id, 'tutor_account_id', account.id);
    return this.disputeView(id);
  }

  // ---------- Gia sư

  async listForTutor(request: Request) {
    const account = await this.accounts.requireReady(request, 'tutor');
    await this.expireHolds(this.market.database, this.market.now());
    const rows = await this.market.database
      .selectFrom('market_bookings')
      .leftJoin('market_payments', 'market_payments.booking_id', 'market_bookings.id')
      .select([
        'market_bookings.id',
        'market_bookings.child_name',
        'market_bookings.package_id',
        'market_bookings.subject',
        'market_bookings.grade',
        'market_bookings.starts_at',
        'market_bookings.minutes',
        'market_bookings.price',
        'market_bookings.commission',
        'market_bookings.status',
        'market_bookings.complaint_deadline',
        'market_bookings.parent_account_id as parent_id',
        'market_bookings.recording_required',
        'market_payments.released_amount',
        'market_payments.commission_taken',
      ])
      .where('market_bookings.tutor_account_id', '=', account.id)
      .where('market_bookings.status', '!=', 'held')
      .orderBy('market_bookings.starts_at', 'desc')
      .limit(200)
      .execute();
    const earnings = {
      released: rows.reduce((sum, row) => sum + (row.released_amount ?? 0), 0),
      commission: rows.reduce((sum, row) => sum + (row.commission_taken ?? 0), 0),
      pending: rows
        .filter((row) => row.status === 'paid' || row.status === 'completed' || row.status === 'disputed')
        .reduce((sum, row) => sum + row.price - row.commission, 0),
    };
    return { bookings: rows, earnings };
  }

  async complete(request: Request, id: string) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const settings = await this.market.settings();
    const now = this.market.now();
    await this.market.database.transaction().execute(async (trx) => {
      const booking = await this.ownBooking(trx, id, 'tutor_account_id', account.id);
      const end = booking.starts_at.getTime() + booking.minutes * 60_000;
      if (booking.status !== 'paid' || now.getTime() < end) {
        throw new ApplicationError('ERR_CONFLICT', 'Chỉ đánh dấu đã dạy buổi đã trả tiền, sau giờ kết thúc');
      }
      await trx
        .updateTable('market_bookings')
        .set({
          status: 'completed',
          completed_at: now,
          complaint_deadline: new Date(Math.max(now.getTime(), end) + settings.complaintWindowHours * 3_600_000),
          updated_at: now,
        })
        .where('id', '=', booking.id)
        .execute();
    });
    await this.market.audit({ actorType: 'account', actorId: account.id, action: 'booking.complete', target: id });
    return this.bookingView(id);
  }

  // ---------- Gói buổi (YCTD-365, GD-165; quyết định của Eric ngày 2026-10-29)
  // Mua gói: một lần trả cho cả gói (giữ chỗ 30 phút như buổi lẻ, bản này giả lập). Mỗi buổi đặt từ gói là một buổi đã trả tiền có dòng
  // thanh toán riêng đang giữ (mã tham chiếu `pkg:<gói>:<buổi>`, khi chuyển tiền đổi về lệnh thu của gói), giải ngân riêng sau hạn khiếu
  // nại. Hết hạn dùng (mặc định 8 tuần): hoàn phần buổi chưa học theo giá mỗi buổi của gói và phần dư làm tròn. Hủy gói trước buổi đầu:
  // hoàn đủ. Gia sư bị tạm khóa: hoàn phần còn lại

  // Lệnh thu của nhà cung cấp cho một dòng thanh toán: buổi của gói dùng lệnh thu của gói
  private async chargeRef(providerRef: string): Promise<string> {
    if (!providerRef.startsWith(PACKAGE_REF_PREFIX)) return providerRef;
    const packageId = providerRef.slice(PACKAGE_REF_PREFIX.length).split(':')[0] ?? '';
    const row = await this.market.database
      .selectFrom('market_packages')
      .select('provider_ref')
      .where('id', '=', packageId)
      .executeTakeFirst();
    return row?.provider_ref ?? providerRef;
  }

  private async releaseFunds(input: { providerRef: string; payout: number; commission: number }) {
    await this.provider.release({ ...input, providerRef: await this.chargeRef(input.providerRef) });
  }

  private async refundFunds(input: { providerRef: string; amount: number }) {
    await this.provider.refund({ ...input, providerRef: await this.chargeRef(input.providerRef) });
  }

  private async disputeHoldFunds(input: { providerRef: string; held: boolean }) {
    await this.provider.setDisputeHold({ ...input, providerRef: await this.chargeRef(input.providerRef) });
  }

  // Số buổi đã dùng của gói: buổi đặt từ gói chưa bị hủy trả lượt
  private async usedSessions(executor: Executor, packageId: string): Promise<number> {
    const row = await executor
      .selectFrom('market_bookings')
      .select(sql<number>`count(*)::int`.as('used'))
      .where('package_id', '=', packageId)
      .where('status', 'not in', ['cancelled', 'expired'])
      .executeTakeFirstOrThrow();
    return row.used;
  }

  private async packageView(id: string) {
    const row = await this.market.database
      .selectFrom('market_packages')
      .innerJoin('market_accounts as tutor', 'tutor.id', 'market_packages.tutor_account_id')
      .select([
        'market_packages.id',
        'market_packages.tutor_account_id as tutor_id',
        'tutor.display_name as tutor_name',
        'market_packages.child_id',
        'market_packages.child_name',
        'market_packages.subject',
        'market_packages.session_minutes',
        'market_packages.sessions_total',
        'market_packages.price_total',
        'market_packages.price_per_session',
        'market_packages.status',
        'market_packages.hold_expires_at',
        'market_packages.paid_at',
        'market_packages.expires_at',
        'market_packages.refunded_amount',
        'market_packages.closed_reason',
      ])
      .where('market_packages.id', '=', id)
      .executeTakeFirstOrThrow();
    return { ...row, sessions_used: await this.usedSessions(this.market.database, id) };
  }

  async createPackage(request: Request, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'parent');
    const settings = await this.assertPaymentsAllowed();
    const database = this.market.database;
    const tutorId = typeof body?.tutor_id === 'string' && UUID.test(body.tutor_id) ? body.tutor_id : '';
    const childId = typeof body?.child_id === 'string' && UUID.test(body.child_id) ? body.child_id : '';
    const subjectId = typeof body?.subject_id === 'string' && UUID.test(body.subject_id) ? body.subject_id : '';
    const attested = body?.no_assignment_attested === true;
    const recordingConsented = body?.recording_consented === true;
    const errors: FieldError[] = [];
    if (!tutorId) errors.push({ field: 'tutor_id', message: 'Chọn gia sư' });
    if (!childId) errors.push({ field: 'child_id', message: 'Chọn hồ sơ con' });
    if (!subjectId) errors.push({ field: 'subject_id', message: 'Chọn môn' });
    if (errors.length > 0) throw validationError(errors);
    const now = this.market.now();
    const [child, consent, subject, tutor, role] = await Promise.all([
      database
        .selectFrom('market_children')
        .select(['id', 'display_name', 'school_level', 'grade', 'birth_year'])
        .where('id', '=', childId)
        .where('parent_account_id', '=', account.id)
        .executeTakeFirst(),
      database
        .selectFrom('market_consents')
        .innerJoin('market_legal_documents', 'market_legal_documents.id', 'market_consents.document_id')
        .select('market_consents.id')
        .where('market_consents.child_id', '=', childId)
        .where('market_consents.withdrawn_at', 'is', null)
        .where('market_legal_documents.kind', '=', 'parent_consent')
        .executeTakeFirst(),
      database
        .selectFrom('market_tutor_subjects')
        .select([
          'subject',
          'school_level',
          'grade_from',
          'grade_to',
          'content_kind',
          'session_minutes',
          'package_sessions',
          'package_price',
        ])
        .where('id', '=', subjectId)
        .where('account_id', '=', tutorId)
        .executeTakeFirst(),
      this.visibleTutor(database, tutorId),
      database
        .selectFrom('market_tutor_school_roles')
        .select('account_id')
        .where('account_id', '=', tutorId)
        .executeTakeFirst(),
    ]);
    if (!child) throw validationError([{ field: 'child_id', message: 'Không tìm thấy hồ sơ con' }]);
    if (!consent) {
      throw validationError([
        { field: 'child_id', message: 'Hồ sơ con chưa có đồng ý của cha mẹ; đồng ý lại trước khi mua gói' },
      ]);
    }
    if (!tutor || !subject) throw marketNotFound();
    if (!subject.package_sessions || !subject.package_price) {
      throw validationError([{ field: 'subject_id', message: 'Gia sư không bán gói cho môn này' }]);
    }
    if (
      child.school_level !== subject.school_level ||
      child.grade < subject.grade_from ||
      child.grade > subject.grade_to
    ) {
      throw validationError([{ field: 'subject_id', message: 'Môn này không dạy cấp, lớp của con' }]);
    }
    const problems = contentProblems({
      schoolLevel: child.school_level,
      contentKind: subject.content_kind,
      tutorIsSchoolTeacher: Boolean(role),
      attestedNoAssignment: attested,
    });
    if (problems.length > 0) throw validationError(problems);
    const recordingRequired = isMinor(child.birth_year, now);
    if (recordingRequired && !recordingConsented) {
      throw validationError([
        {
          field: 'recording_consented',
          message: 'Buổi học với trẻ dưới 18 tuổi luôn được ghi hình để bảo vệ trẻ; đồng ý ghi hình để mua gói',
        },
      ]);
    }
    const perSession = Math.floor(subject.package_price / subject.package_sessions);
    const rules = (await database
      .selectFrom('market_commission_rules')
      .select(['content_kind', 'tutor_account_id', 'percent', 'minimum', 'effective_from'])
      .execute()) as unknown as Array<Omit<CommissionRule, 'percent'> & { percent: string }>;
    const rule = pickCommissionRule(
      rules.map((item) => ({
        ...item,
        percent: Number(item.percent),
        effective_from: String(item.effective_from).slice(0, 10),
      })),
      { contentKind: subject.content_kind, tutorId, date: vietnamClock(now).date },
    );
    const commission = commissionFor(perSession, rule, settings.defaultCommissionPercent);
    const id = randomUUID();
    const charge = await this.provider.createHeldCharge({
      reference: id,
      amount: subject.package_price,
      description: `Gói ${subject.package_sessions} buổi ${subject.subject} với gia sư ${tutor.display_name}`,
    });
    await database
      .insertInto('market_packages')
      .values({
        id,
        parent_account_id: account.id,
        child_id: child.id,
        child_name: child.display_name,
        tutor_account_id: tutorId,
        subject: subject.subject,
        school_level: subject.school_level,
        grade: child.grade,
        content_kind: subject.content_kind,
        session_minutes: subject.session_minutes,
        sessions_total: subject.package_sessions,
        price_total: subject.package_price,
        price_per_session: perSession,
        commission_per_session: commission,
        no_assignment_attested: attested,
        recording_required: recordingRequired,
        status: 'held',
        hold_expires_at: new Date(now.getTime() + HOLD_MINUTES * 60_000),
        provider: this.provider.code,
        provider_ref: charge.providerRef,
      })
      .execute();
    await this.market.audit({ actorType: 'account', actorId: account.id, action: 'package.create', target: id });
    return { ...(await this.packageView(id)), checkout: charge.checkout };
  }

  async listPackages(request: Request) {
    const account = await this.accounts.requireReady(request, 'parent');
    const rows = await this.market.database
      .selectFrom('market_packages')
      .select('id')
      .where('parent_account_id', '=', account.id)
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();
    return { packages: await Promise.all(rows.map((row) => this.packageView(row.id))) };
  }

  async mockPayPackage(request: Request, id: string) {
    const account = await this.accounts.requireReady(request, 'parent');
    if (!(this.provider instanceof MockMarketplacePaymentProvider) || !UUID.test(id)) throw marketNotFound();
    const row = await this.market.database
      .selectFrom('market_packages')
      .select(['provider_ref', 'price_total'])
      .where('id', '=', id)
      .where('parent_account_id', '=', account.id)
      .executeTakeFirst();
    if (!row) throw marketNotFound();
    const signed = this.provider.signedEvent({
      eventId: `mock_evt_${randomUUID()}`,
      type: 'charge.succeeded',
      providerRef: row.provider_ref,
      amount: row.price_total,
    });
    await this.handleWebhook(this.provider.code, signed.body, signed.signature);
    return this.packageView(id);
  }

  // Sự kiện thanh toán của gói (gọi từ handleWebhook khi mã tham chiếu không phải của buổi lẻ)
  private async packagePaid(
    trx: Transaction<MarketplaceDatabase>,
    event: PaymentEvent,
    now: Date,
  ): Promise<{ providerRef: string; amount: number } | null> {
    const row = await trx
      .selectFrom('market_packages')
      .select(['id', 'status', 'price_total', 'provider_ref', 'hold_expires_at'])
      .where('provider_ref', '=', event.providerRef)
      .forUpdate()
      .executeTakeFirst();
    if (!row || row.status !== 'held') return null;
    if (event.type === 'charge.failed' || event.amount !== row.price_total) {
      await trx
        .updateTable('market_packages')
        .set({ status: 'cancelled', closed_reason: 'Thanh toán không thành công', updated_at: now })
        .where('id', '=', row.id)
        .execute();
      return null;
    }
    if (row.hold_expires_at.getTime() <= now.getTime()) {
      await trx
        .updateTable('market_packages')
        .set({
          status: 'refunded',
          refunded_amount: row.price_total,
          closed_reason: 'Tiền về sau khi hết giữ chỗ: hoàn đủ',
          updated_at: now,
        })
        .where('id', '=', row.id)
        .execute();
      return { providerRef: row.provider_ref, amount: row.price_total };
    }
    const settings = await this.market.settings();
    await trx
      .updateTable('market_packages')
      .set({
        status: 'paid',
        paid_at: now,
        expires_at: new Date(now.getTime() + settings.packageValidDays * 24 * 3_600_000),
        updated_at: now,
      })
      .where('id', '=', row.id)
      .execute();
    return null;
  }

  // Đặt một buổi từ gói đã trả tiền: cùng gia sư, cùng con, cùng môn; còn lượt, chưa hết hạn
  private async createFromPackage(account: { id: string }, body: RequestBody) {
    const database = this.market.database;
    const packageId = typeof body?.package_id === 'string' && UUID.test(body.package_id) ? body.package_id : '';
    const startsAt = typeof body?.starts_at === 'string' ? new Date(body.starts_at) : new Date(Number.NaN);
    if (Number.isNaN(startsAt.getTime())) throw validationError([{ field: 'starts_at', message: 'Chọn giờ học' }]);
    const now = this.market.now();
    const pack = packageId
      ? await database
          .selectFrom('market_packages')
          .selectAll()
          .where('id', '=', packageId)
          .where('parent_account_id', '=', account.id)
          .executeTakeFirst()
      : undefined;
    if (!pack) throw marketNotFound();
    if (pack.status !== 'paid' || !pack.expires_at || pack.expires_at.getTime() <= now.getTime()) {
      throw new ApplicationError('ERR_CONFLICT', 'Gói chưa trả tiền hoặc đã hết hạn dùng');
    }
    if (!pack.child_id) throw new ApplicationError('ERR_CONFLICT', 'Hồ sơ con của gói đã bị xóa');
    if (startsAt.getTime() < now.getTime() + MINIMUM_LEAD_MS || startsAt.getTime() > pack.expires_at.getTime()) {
      throw validationError([{ field: 'starts_at', message: 'Đặt trước ít nhất 2 giờ, trước khi gói hết hạn dùng' }]);
    }
    if (!(await this.visibleTutor(database, pack.tutor_account_id))) {
      throw new ApplicationError('ERR_CONFLICT', 'Gia sư đang tạm ngừng hoạt động trên chợ');
    }
    const slots = await database
      .selectFrom('market_tutor_availability')
      .select(['weekday', 'start_minute', 'end_minute'])
      .where('account_id', '=', pack.tutor_account_id)
      .execute();
    if (!fitsAvailability(startsAt, pack.session_minutes, slots)) {
      throw validationError([
        { field: 'starts_at', message: 'Giờ học không nằm trong giờ trống của gia sư (giờ Việt Nam)' },
      ]);
    }
    const booking = await database.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${pack.tutor_account_id}))`.execute(trx);
      await sql`select pg_advisory_xact_lock(hashtext(${pack.id}))`.execute(trx);
      if ((await this.usedSessions(trx, pack.id)) >= pack.sessions_total) {
        throw new ApplicationError('ERR_CONFLICT', 'Gói đã dùng hết số buổi');
      }
      const busy = await trx
        .selectFrom('market_bookings')
        .select(['starts_at', 'minutes'])
        .where('status', 'in', ACTIVE)
        .where((eb) =>
          eb.or([eb('tutor_account_id', '=', pack.tutor_account_id), eb('child_id', '=', pack.child_id as string)]),
        )
        .where('starts_at', '>', new Date(startsAt.getTime() - 4 * 3_600_000))
        .where('starts_at', '<', new Date(startsAt.getTime() + 4 * 3_600_000))
        .execute();
      if (busy.some((row) => overlaps(startsAt, pack.session_minutes, row.starts_at, row.minutes))) {
        throw new ApplicationError('ERR_CONFLICT', 'Giờ này gia sư hoặc con đã có buổi khác');
      }
      const created = await trx
        .insertInto('market_bookings')
        .values({
          parent_account_id: account.id,
          child_id: pack.child_id,
          child_name: pack.child_name,
          tutor_account_id: pack.tutor_account_id,
          subject: pack.subject,
          school_level: pack.school_level,
          grade: pack.grade,
          content_kind: pack.content_kind,
          starts_at: startsAt,
          minutes: pack.session_minutes,
          price: pack.price_per_session,
          commission: pack.commission_per_session,
          status: 'paid',
          hold_expires_at: now,
          no_assignment_attested: pack.no_assignment_attested,
          recording_required: pack.recording_required,
          recording_consented: pack.recording_required,
          package_id: pack.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('market_payments')
        .values({
          booking_id: created.id,
          provider: pack.provider,
          provider_ref: `${PACKAGE_REF_PREFIX}${pack.id}:${created.id}`,
          amount: pack.price_per_session,
          commission: pack.commission_per_session,
          status: 'held',
        })
        .execute();
      return created;
    });
    await this.market.audit({
      actorType: 'account',
      actorId: account.id,
      action: 'booking.create-from-package',
      target: booking.id,
      details: { package: pack.id },
    });
    return this.bookingView(booking.id);
  }

  // Kết thúc gói: hoàn phần buổi chưa học theo giá mỗi buổi của gói và phần dư làm tròn (hết hạn, tạm khóa gia sư), hoặc hoàn đủ khi
  // chưa dùng buổi nào (phụ huynh hủy gói)
  private async closePackage(
    packageId: string,
    status: 'cancelled' | 'expired' | 'refunded',
    reason: string,
    onlyIfUnused: boolean,
  ): Promise<number | null> {
    const now = this.market.now();
    const result = await this.market.database.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${packageId}))`.execute(trx);
      const pack = await trx
        .selectFrom('market_packages')
        .select(['id', 'status', 'sessions_total', 'price_total', 'price_per_session', 'provider_ref'])
        .where('id', '=', packageId)
        .forUpdate()
        .executeTakeFirst();
      if (pack?.status !== 'paid') return null;
      const used = await this.usedSessions(trx, packageId);
      if (onlyIfUnused && used > 0) {
        throw new ApplicationError('ERR_CONFLICT', 'Gói đã có buổi; chỉ hủy gói được trước buổi đầu');
      }
      const refund = pack.price_total - used * pack.price_per_session;
      await trx
        .updateTable('market_packages')
        .set({
          status: refund === 0 ? 'used_up' : status,
          refunded_amount: refund,
          closed_reason: reason,
          updated_at: now,
        })
        .where('id', '=', packageId)
        .execute();
      return { providerRef: pack.provider_ref, refund };
    });
    if (result && result.refund > 0) {
      await this.provider.refund({ providerRef: result.providerRef, amount: result.refund });
    }
    if (result) {
      await this.market.audit({
        actorType: 'system',
        action: `package.${status}`,
        target: packageId,
        details: { refund: result.refund, reason },
      });
    }
    return result?.refund ?? null;
  }

  async cancelPackage(request: Request, id: string) {
    const account = await this.accounts.requireReady(request, 'parent');
    if (!UUID.test(id)) throw marketNotFound();
    const pack = await this.market.database
      .selectFrom('market_packages')
      .select(['id', 'status'])
      .where('id', '=', id)
      .where('parent_account_id', '=', account.id)
      .executeTakeFirst();
    if (!pack) throw marketNotFound();
    if (pack.status === 'held') {
      await this.market.database
        .updateTable('market_packages')
        .set({ status: 'cancelled', closed_reason: 'Phụ huynh hủy trước khi trả tiền', updated_at: this.market.now() })
        .where('id', '=', id)
        .execute();
      return this.packageView(id);
    }
    const refund = await this.closePackage(id, 'cancelled', 'Phụ huynh hủy gói trước buổi đầu: hoàn đủ', true);
    if (refund === null) throw new ApplicationError('ERR_CONFLICT', 'Gói không còn hủy được');
    return this.packageView(id);
  }

  // Việc định kỳ: nhả gói giữ chỗ quá hạn chưa trả; gói hết hạn dùng thì hoàn phần chưa học
  private async runPackagesDue(now: Date): Promise<{ packagesExpired: number }> {
    const database = this.market.database;
    await database
      .updateTable('market_packages')
      .set({ status: 'cancelled', closed_reason: 'Hết giữ chỗ, chưa trả tiền', updated_at: now })
      .where('status', '=', 'held')
      .where('hold_expires_at', '<=', now)
      .execute();
    const due = await database
      .selectFrom('market_packages')
      .select('id')
      .where('status', '=', 'paid')
      .where('expires_at', '<=', now)
      .execute();
    for (const row of due) {
      await this.closePackage(row.id, 'expired', 'Hết hạn dùng: hoàn phần buổi chưa học', false);
    }
    return { packagesExpired: due.length };
  }

  // Gia sư bị tạm khóa (27i): gói đang dùng được hoàn phần còn lại
  async refundPackagesForSuspension(tutorId: string) {
    const rows = await this.market.database
      .selectFrom('market_packages')
      .select('id')
      .where('tutor_account_id', '=', tutorId)
      .where('status', '=', 'paid')
      .execute();
    for (const row of rows) {
      await this.closePackage(row.id, 'refunded', 'Gia sư bị tạm khóa: hoàn phần còn lại', false);
    }
    return rows.length;
  }

  // ---------- Việc định kỳ, quyết định tranh chấp (gọi từ quản trị)

  async expireHolds(executor: Executor, now: Date): Promise<number> {
    const expired = await executor
      .updateTable('market_bookings')
      .set({ status: 'expired', updated_at: now })
      .where('status', '=', 'held')
      .where('hold_expires_at', '<=', now)
      .returning('id')
      .execute();
    if (expired.length > 0) {
      await executor
        .updateTable('market_payments')
        .set({ status: 'failed', updated_at: now })
        .where(
          'booking_id',
          'in',
          expired.map((row) => row.id),
        )
        .where('status', '=', 'pending')
        .execute();
    }
    return expired.length;
  }

  // Giải ngân buổi đã dạy, hết hạn khiếu nại, không có tranh chấp
  async runDue(): Promise<{
    expired: number;
    autoConfirmed: number;
    packagesExpired: number;
    disbursed: number;
    finalized: number;
  }> {
    if (!this.market.available) return { expired: 0, autoConfirmed: 0, packagesExpired: 0, disbursed: 0, finalized: 0 };
    const now = this.market.now();
    const database = this.market.database;
    const expired = await this.expireHolds(database, now);
    const autoConfirmed = await this.autoConfirm(now);
    const { packagesExpired } = await this.runPackagesDue(now);
    const due = await database
      .selectFrom('market_bookings')
      .select('id')
      .where('status', '=', 'completed')
      .where('complaint_deadline', '<=', now)
      // Gia sư đang bị tạm khóa (27i): giữ tiền đến khi nhân viên kiểm duyệt gỡ khóa
      .where(notSuspended('market_bookings.tutor_account_id'))
      .execute();
    let disbursed = 0;
    for (const { id } of due) {
      const result = await database.transaction().execute(async (trx) => {
        const booking = await trx
          .selectFrom('market_bookings')
          .select(['id', 'price', 'commission', 'status'])
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (booking?.status !== 'completed') return null;
        const split = settlement(booking.price, booking.commission, 0);
        const payment = await trx
          .updateTable('market_payments')
          .set({
            status: 'settled',
            released_amount: split.payout,
            commission_taken: split.commission,
            updated_at: now,
          })
          .where('booking_id', '=', id)
          .where('status', '=', 'held')
          .returning('provider_ref')
          .executeTakeFirst();
        if (!payment) return null;
        await trx
          .updateTable('market_bookings')
          .set({ status: 'disbursed', updated_at: now })
          .where('id', '=', id)
          .execute();
        return { providerRef: payment.provider_ref, split };
      });
      if (result) {
        await this.releaseFunds({
          providerRef: result.providerRef,
          payout: result.split.payout,
          commission: result.split.commission,
        });
        await this.market.audit({ actorType: 'system', action: 'booking.disburse', target: id, details: result.split });
        disbursed += 1;
      }
    }
    const finalized = await this.finalizeDecided(null);
    return { expired, autoConfirmed, packagesExpired, disbursed, finalized };
  }

  // Gia sư không xác nhận đã dạy (phòng học video, YCTD-362, GD-164): quá mốc sau giờ kết thúc thì hệ thống tự xác nhận; hạn khiếu nại
  // của phụ huynh tính từ lúc tự xác nhận
  private async autoConfirm(now: Date): Promise<number> {
    const settings = await this.market.settings();
    const hours = settings.room.autoConfirmHours;
    const due = await this.market.database
      .updateTable('market_bookings')
      .set({
        status: 'completed',
        completed_at: now,
        complaint_deadline: new Date(now.getTime() + settings.complaintWindowHours * 3_600_000),
        updated_at: now,
      })
      .where('status', '=', 'paid')
      .where(sql<boolean>`starts_at + make_interval(mins => minutes) + make_interval(hours => ${hours}) <= ${now}`)
      .returning(['id', 'starts_at', 'minutes'])
      .execute();
    for (const booking of due) {
      await this.market.database
        .insertInto('market_session_rooms')
        .values({
          booking_id: booking.id,
          opened_at: booking.starts_at,
          closed_at: new Date(booking.starts_at.getTime() + booking.minutes * 60_000),
          confirmed_at: now,
          confirmed_by: 'auto',
        })
        .onConflict((conflict) =>
          conflict.column('booking_id').doUpdateSet({ confirmed_at: now, confirmed_by: 'auto' }),
        )
        .execute();
      await this.market.audit({ actorType: 'system', action: 'booking.auto-confirm', target: booking.id });
    }
    return due.length;
  }

  // Quyết định tranh chấp: lần đầu (đang mở) hoặc xét lại (đã khiếu nại lại, phải là nhân viên khác người quyết định lần đầu)
  async decide(operatorId: string, id: string, body: RequestBody) {
    const decision = body?.decision;
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    if (decision !== 'refund_full' && decision !== 'refund_partial' && decision !== 'release') {
      throw validationError([{ field: 'decision', message: 'Chọn hoàn đủ, hoàn một phần hoặc giải ngân' }]);
    }
    if (note.length < 1 || note.length > 2000) {
      throw validationError([{ field: 'note', message: 'Quyết định cần lý do (tối đa 2000 ký tự)' }]);
    }
    const now = this.market.now();
    const result = await this.market.database.transaction().execute(async (trx) => {
      const dispute = UUID.test(id)
        ? await trx
            .selectFrom('market_disputes')
            .selectAll()
            .where('booking_id', '=', id)
            .forUpdate()
            .executeTakeFirst()
        : undefined;
      if (!dispute) throw marketNotFound();
      if (dispute.status !== 'open' && dispute.status !== 'appealed') {
        throw new ApplicationError('ERR_CONFLICT', 'Tranh chấp không ở trạng thái chờ quyết định');
      }
      if (dispute.status === 'appealed' && dispute.decided_by === operatorId) {
        throw new ApplicationError(
          'ERR_FORBIDDEN',
          'Khiếu nại lại phải do nhân viên khác người đã quyết định lần đầu xét',
        );
      }
      const booking = await trx
        .selectFrom('market_bookings')
        .select(['id', 'price', 'commission'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      let refund = decision === 'refund_full' ? booking.price : 0;
      if (decision === 'refund_partial') {
        const amount = body?.refund_amount;
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount >= booking.price) {
          throw validationError([{ field: 'refund_amount', message: `Số hoàn từ 1 đến ${booking.price - 1} đồng` }]);
        }
        refund = amount;
      }
      if (dispute.status === 'open') {
        await trx
          .updateTable('market_disputes')
          .set({
            status: 'decided',
            decision,
            refund_amount: refund,
            decision_note: note,
            decided_by: operatorId,
            decided_at: now,
          })
          .where('id', '=', dispute.id)
          .execute();
        // Quyết định lần đầu chưa chuyển tiền: tiền vẫn giữ đến hết hạn khiếu nại lại hoặc đến khi xét lại
        return { final: false as const };
      }
      await trx
        .updateTable('market_disputes')
        .set({
          status: 'final',
          final_decision: decision,
          final_refund_amount: refund,
          final_note: note,
          final_decided_by: operatorId,
          final_decided_at: now,
        })
        .where('id', '=', dispute.id)
        .execute();
      return { final: true as const, refund };
    });
    await this.market.audit({
      actorType: 'operator',
      actorId: operatorId,
      action: 'dispute.decide',
      target: id,
      details: { decision, note },
    });
    if (result.final) {
      await this.settleDispute(id, result.refund);
    }
    return this.disputeView(id);
  }

  // Quyết định lần đầu thành chung cuộc khi hết 7 ngày không khiếu nại lại; nhân viên cũng chốt ngay khi hai bên đồng ý
  async finalizeDecided(operatorId: string | null, id?: string): Promise<number> {
    const now = this.market.now();
    let query = this.market.database
      .selectFrom('market_disputes')
      .select(['booking_id', 'refund_amount'])
      .where('status', '=', 'decided');
    query = id
      ? query.where('booking_id', '=', id)
      : query.where('decided_at', '<=', new Date(now.getTime() - APPEAL_DAYS * 24 * 3_600_000));
    const rows = await query.execute();
    for (const row of rows) {
      await this.market.database
        .updateTable('market_disputes')
        .set({ status: 'final', final_decided_by: operatorId ?? 'system', final_decided_at: now })
        .where('booking_id', '=', row.booking_id)
        .where('status', '=', 'decided')
        .execute();
      await this.settleDispute(row.booking_id, row.refund_amount ?? 0);
    }
    return rows.length;
  }

  private async settleDispute(id: string, refund: number) {
    const now = this.market.now();
    const result = await this.market.database.transaction().execute(async (trx) => {
      const booking = await trx
        .selectFrom('market_bookings')
        .select(['id', 'price', 'commission', 'status'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (booking.status !== 'disputed') return null;
      const split = settlement(booking.price, booking.commission, refund);
      const payment = await trx
        .updateTable('market_payments')
        .set({
          status: 'settled',
          held_for_dispute: false,
          refunded_amount: split.refund,
          released_amount: split.payout,
          commission_taken: split.commission,
          updated_at: now,
        })
        .where('booking_id', '=', id)
        .returning('provider_ref')
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('market_bookings')
        .set({ status: split.refund === booking.price ? 'refunded' : 'disbursed', updated_at: now })
        .where('id', '=', id)
        .execute();
      return { providerRef: payment.provider_ref, split };
    });
    if (!result) return;
    await this.disputeHoldFunds({ providerRef: result.providerRef, held: false });
    if (result.split.refund > 0)
      await this.refundFunds({ providerRef: result.providerRef, amount: result.split.refund });
    if (result.split.payout + result.split.commission > 0) {
      await this.releaseFunds({
        providerRef: result.providerRef,
        payout: result.split.payout,
        commission: result.split.commission,
      });
    }
  }
}

@Controller('market')
@PublicEndpoint()
export class MarketBookingsController {
  constructor(private readonly bookings: MarketBookingsService) {}

  @Post('bookings')
  create(@Req() request: Request, @Body() body: RequestBody) {
    return this.bookings.create(request, body);
  }

  @Get('bookings')
  list(@Req() request: Request) {
    return this.bookings.listForParent(request);
  }

  @Post('packages')
  createPackage(@Req() request: Request, @Body() body: RequestBody) {
    return this.bookings.createPackage(request, body);
  }

  @Get('packages')
  listPackages(@Req() request: Request) {
    return this.bookings.listPackages(request);
  }

  @Post('packages/:id/mock-pay')
  @HttpCode(200)
  mockPayPackage(@Req() request: Request, @Param('id') id: string) {
    return this.bookings.mockPayPackage(request, id);
  }

  @Post('packages/:id/cancel')
  @HttpCode(200)
  cancelPackage(@Req() request: Request, @Param('id') id: string) {
    return this.bookings.cancelPackage(request, id);
  }

  @Post('bookings/:id/mock-pay')
  @HttpCode(200)
  mockPay(@Req() request: Request, @Param('id') id: string) {
    return this.bookings.mockPay(request, id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  cancel(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.bookings.cancelByParent(request, id, body);
  }

  @Post('bookings/:id/dispute')
  @HttpCode(200)
  dispute(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.bookings.openDispute(request, id, body);
  }

  @Get('bookings/:id/dispute')
  parentDispute(@Req() request: Request, @Param('id') id: string) {
    return this.bookings.parentDispute(request, id);
  }

  @Post('disputes/:id/statements')
  @HttpCode(200)
  statement(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.bookings.addStatement(request, id, body);
  }

  @Post('disputes/:id/appeal')
  @HttpCode(200)
  appeal(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.bookings.appeal(request, id, body);
  }

  @Get('tutor/bookings')
  tutorList(@Req() request: Request) {
    return this.bookings.listForTutor(request);
  }

  @Post('tutor/bookings/:id/complete')
  @HttpCode(200)
  complete(@Req() request: Request, @Param('id') id: string) {
    return this.bookings.complete(request, id);
  }

  @Post('tutor/bookings/:id/cancel')
  @HttpCode(200)
  tutorCancel(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.bookings.cancelByTutor(request, id, body);
  }

  @Get('tutor/bookings/:id/dispute')
  tutorDispute(@Req() request: Request, @Param('id') id: string) {
    return this.bookings.tutorDispute(request, id);
  }

  // Sự kiện của nhà cung cấp thanh toán: không cần phiên, xác thực bằng chữ ký
  @Post('payments/webhooks/:provider')
  @HttpCode(200)
  webhook(
    @Param('provider') provider: string,
    @Body() body: RequestBody,
    @Headers('x-market-signature') signature: string | undefined,
  ) {
    return this.bookings.handleWebhook(provider, body, signature);
  }
}
