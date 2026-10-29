import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Optional,
  Param,
  Post,
  Req,
  Res,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { MarketplaceDatabase, MarketReportDecision, MarketReportTarget } from '@cho-gia-su/database';
import { ApplicationError, validationError, type FieldError } from '../common/server.js';
import { operatorRolesFor, videoGrantsFor } from '../common/shared.js';
import type { Request, Response } from 'express';
import type { Kysely, Transaction } from 'kysely';
import { PublicEndpoint } from '../common/public-endpoint.js';
import { API_CONFIGURATION, type ApiConfiguration } from '../common/configuration.js';
import type { RequestBody } from '../common/request-fields.js';
import { FileStorage } from '../common/file-storage.js';
import { VIDEO_PROVIDER, type VideoRoomProvider } from '../common/video-provider.js';
import { MarketAccountsService } from './market-accounts.js';
import { MarketBookingsService } from './market-bookings.js';
import { MarketContext, marketNotFound, type MarketAccount } from './market-context.js';
import { decryptFile, encryptFile, hasMarketStorage, marketStorage } from './market-files.js';
import { MarketMessenger } from './market-messenger.js';
import { roomWindowOpen } from './market-room-rules.js';
import { MarketRoomsService } from './market-rooms.js';
import {
  CONTACT_STRIKE_LIMIT,
  effectiveSeverity,
  filterMessage,
  recordingDeletable,
  recordingRetainUntil,
  REPORT_CATEGORIES,
  REPORT_SEVERITIES,
  reportDueAt,
  suspendsImmediately,
} from './market-safety-rules.js';

// An toàn trẻ em và kiểm duyệt ở chợ gia sư (DT-27 phần 27i, YCTD-259; tài liệu 47 mục 19.2, 19.5). Claude tự chọn theo ủy quyền của
// Eric ngày 2026-10-11:
// - tin nhắn: chỉ có luồng phụ huynh với gia sư, phụ huynh mở luồng; thông tin liên lạc ngoài bị che bằng hàm thuần của 28e, người gửi
//   được cảnh báo; lần thứ 3 thì gắn cờ luồng và tự tạo báo cáo né hoa hồng; gia sư đang bị tạm khóa không nhắn được;
// - báo cáo vi phạm: phụ huynh báo gia sư (hồ sơ, tin nhắn, buổi học, đánh giá), gia sư báo phụ huynh đã có buổi hoặc tin nhắn với mình;
//   an toàn trẻ em không thấp hơn mức cao; mức nghiêm trọng từ phụ huynh đã học với gia sư thì tạm khóa gia sư ngay (ẩn, chặn đặt buổi,
//   giữ tiền chưa giải ngân), nhân viên xác nhận mới hủy mọi buổi sắp tới (hoàn đủ) và báo phụ huynh có buổi với gia sư (YCTD-322);
//   mọi trả lời có hướng dẫn gọi Tổng đài 111;
// - kiểm duyệt: hàng chờ theo hạn, nhận xử lý, quyết định (tạm khóa, cảnh cáo, bác) có lý do; một lần kháng nghị trong 7 ngày (gia sư
//   kháng nghị tạm khóa, cảnh cáo; người báo kháng nghị bác), nhân viên khác xét; nhật ký kiểm duyệt; xuất hồ sơ cho cơ quan có thẩm
//   quyền phải ghi cơ quan và số văn bản yêu cầu, có nhật ký;
// - ghi hình: buổi có trẻ vị thành niên chỉ mở phòng khi bắt đầu ghi được (có bộ nối video, kho tệp, khóa mã hóa của chợ); phụ huynh chỉ
//   vào phòng khi đang ghi; bản ghi mã hóa bằng khóa của chợ, giữ 30 ngày, giữ tiếp khi có tranh chấp, báo cáo hoặc tạm khóa đang mở;
//   chỉ phụ huynh, gia sư của buổi và nhân viên nền tảng xem, phát trực tiếp không cho tải, mỗi lượt xem có nhật ký
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPEAL_DAYS = 7;
const REPORT_TARGETS: readonly MarketReportTarget[] = ['profile', 'message', 'session', 'review'];
const DECISIONS: readonly MarketReportDecision[] = ['suspend', 'warn', 'dismiss'];
const HOTLINE =
  'Nếu trẻ đang gặp nguy hiểm, gọi ngay 113 (công an) hoặc Tổng đài quốc gia bảo vệ trẻ em 111 (miễn phí, 24 giờ). Chợ gia sư sẽ phối hợp với cơ quan có thẩm quyền khi có yêu cầu.';

type Database = Kysely<MarketplaceDatabase>;
type Executor = Database | Transaction<MarketplaceDatabase>;

function text(body: RequestBody, field: string, max: number, errors: FieldError[]): string {
  const value = typeof body?.[field] === 'string' ? (body[field] as string).trim() : '';
  if (value.length < 1 || value.length > max) {
    errors.push({ field, message: `Bắt buộc, tối đa ${max} ký tự` });
  }
  return value;
}

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

@Injectable()
export class MarketSafetyService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MarketSafetyService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly market: MarketContext,
    private readonly accounts: MarketAccountsService,
    private readonly bookings: MarketBookingsService,
    private readonly messenger: MarketMessenger,
    private readonly files: FileStorage,
    @Inject(API_CONFIGURATION) private readonly configuration: ApiConfiguration,
    private readonly rooms: MarketRoomsService,
    @Optional() @Inject(VIDEO_PROVIDER) private readonly video: VideoRoomProvider | null = null,
  ) {
    rooms.onRecordingEnded((recording, at) => this.finishRecording(recording, at));
  }

  // Xóa bản ghi hết hạn giữ theo chu kỳ việc định kỳ của chợ (MARKET_JOB_INTERVAL_SECONDS)
  onApplicationBootstrap(): void {
    const seconds = this.configuration.marketJobIntervalSeconds ?? 300;
    if (!this.market.available || seconds <= 0) return;
    this.timer = setInterval(() => {
      void this.purgeRecordings().catch(() => undefined);
    }, seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async ready(request: Request): Promise<MarketAccount> {
    const account = await this.market.account(request);
    return this.accounts.requireReady(request, account.kind === 'tutor' ? 'tutor' : 'parent');
  }

  private async activeSuspension(executor: Executor, tutorId: string) {
    return executor
      .selectFrom('market_tutor_suspensions')
      .select(['id', 'reason', 'started_at', 'report_id'])
      .where('tutor_account_id', '=', tutorId)
      .where('lifted_at', 'is', null)
      .executeTakeFirst();
  }

  private async log(
    executor: Executor,
    entry: {
      reportId?: string | null;
      subjectId?: string | null;
      actorType: 'account' | 'operator' | 'system';
      actorId?: string | null;
      action: string;
      note?: string | null;
    },
  ) {
    await executor
      .insertInto('market_moderation_log')
      .values({
        report_id: entry.reportId ?? null,
        subject_account_id: entry.subjectId ?? null,
        actor_type: entry.actorType,
        actor_id: entry.actorId ?? null,
        action: entry.action,
        note: entry.note ?? null,
      })
      .execute();
  }

  // ---------- Tin nhắn

  async threads(request: Request) {
    const account = await this.ready(request);
    const field = account.kind === 'tutor' ? 'tutor_account_id' : 'parent_account_id';
    const other = account.kind === 'tutor' ? 'parent_account_id' : 'tutor_account_id';
    const rows = await this.market.database
      .selectFrom('market_message_threads')
      .innerJoin('market_accounts as other', 'other.id', `market_message_threads.${other}`)
      .select([
        'market_message_threads.id',
        'market_message_threads.tutor_account_id',
        'market_message_threads.last_message_at',
        'other.display_name as other_name',
      ])
      .where(`market_message_threads.${field}`, '=', account.id)
      .orderBy('market_message_threads.last_message_at', 'desc')
      .limit(100)
      .execute();
    return { threads: rows };
  }

  async openThread(request: Request, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'parent');
    const tutorId = typeof body?.tutor_id === 'string' && UUID.test(body.tutor_id) ? body.tutor_id : '';
    const database = this.market.database;
    const tutor = tutorId
      ? await database
          .selectFrom('market_tutor_profiles')
          .innerJoin('market_accounts', 'market_accounts.id', 'market_tutor_profiles.account_id')
          .select('market_accounts.id')
          .where('market_tutor_profiles.account_id', '=', tutorId)
          .where('market_tutor_profiles.status', '=', 'approved')
          .where('market_accounts.status', '=', 'active')
          .executeTakeFirst()
      : undefined;
    if (!tutor || (await this.activeSuspension(database, tutorId))) throw marketNotFound();
    await database
      .insertInto('market_message_threads')
      .values({ parent_account_id: account.id, tutor_account_id: tutorId })
      .onConflict((conflict) => conflict.columns(['parent_account_id', 'tutor_account_id']).doNothing())
      .execute();
    const thread = await database
      .selectFrom('market_message_threads')
      .select('id')
      .where('parent_account_id', '=', account.id)
      .where('tutor_account_id', '=', tutorId)
      .executeTakeFirstOrThrow();
    return this.threadView(account, thread.id);
  }

  private async memberThread(account: MarketAccount, id: string) {
    const thread = UUID.test(id)
      ? await this.market.database
          .selectFrom('market_message_threads')
          .selectAll()
          .where('id', '=', id)
          .where(account.kind === 'tutor' ? 'tutor_account_id' : 'parent_account_id', '=', account.id)
          .executeTakeFirst()
      : undefined;
    if (!thread) throw marketNotFound();
    return thread;
  }

  private async threadView(account: MarketAccount, id: string) {
    const thread = await this.memberThread(account, id);
    const database = this.market.database;
    const [messages, people, suspension] = await Promise.all([
      database
        .selectFrom('market_messages')
        .select(['id', 'role', 'body', 'created_at'])
        .where('thread_id', '=', thread.id)
        .orderBy('created_at', 'asc')
        .limit(500)
        .execute(),
      database
        .selectFrom('market_accounts')
        .select(['id', 'display_name'])
        .where('id', 'in', [thread.parent_account_id, thread.tutor_account_id])
        .execute(),
      this.activeSuspension(database, thread.tutor_account_id),
    ]);
    const name = (accountId: string) => people.find((person) => person.id === accountId)?.display_name ?? '';
    return {
      id: thread.id,
      tutor_id: thread.tutor_account_id,
      parent_name: name(thread.parent_account_id),
      tutor_name: name(thread.tutor_account_id),
      can_send: !suspension,
      notice: suspension ? 'Gia sư đang tạm ngừng hoạt động trên chợ; không gửi tin nhắn được.' : null,
      messages,
    };
  }

  async thread(request: Request, id: string) {
    return this.threadView(await this.ready(request), id);
  }

  async send(request: Request, id: string, body: RequestBody) {
    const account = await this.ready(request);
    const errors: FieldError[] = [];
    const content = text(body, 'body', 4000, errors);
    if (errors.length > 0) throw validationError(errors);
    const thread = await this.memberThread(account, id);
    const database = this.market.database;
    if (await this.activeSuspension(database, thread.tutor_account_id)) {
      throw new ApplicationError('ERR_CONFLICT', 'Gia sư đang tạm ngừng hoạt động trên chợ; không gửi tin nhắn được');
    }
    const filtered = filterMessage(content);
    const now = this.market.now();
    const role = account.kind === 'tutor' ? 'tutor' : 'parent';
    let flagged = false;
    await database.transaction().execute(async (trx) => {
      await trx
        .insertInto('market_messages')
        .values({
          thread_id: thread.id,
          author_account_id: account.id,
          role,
          body: filtered.body,
          original_body: filtered.original,
          findings: JSON.stringify(filtered.findings.map((finding) => finding.kind)),
        })
        .execute();
      await trx
        .updateTable('market_message_threads')
        .set({ last_message_at: now })
        .where('id', '=', thread.id)
        .execute();
      if (filtered.original === null) return;
      // Đếm số tin có thông tin liên lạc ngoài của người gửi trong luồng; đủ ngưỡng thì gắn cờ và chuyển kiểm duyệt một lần
      const strikes = await trx
        .selectFrom('market_messages')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('thread_id', '=', thread.id)
        .where('author_account_id', '=', account.id)
        .where('original_body', 'is not', null)
        .executeTakeFirstOrThrow();
      if (Number(strikes.count) < CONTACT_STRIKE_LIMIT || thread.flagged_at) return;
      const marked = await trx
        .updateTable('market_message_threads')
        .set({ flagged_at: now })
        .where('id', '=', thread.id)
        .where('flagged_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (!marked) return;
      flagged = true;
      const report = await trx
        .insertInto('market_reports')
        .values({
          reporter_account_id: null,
          subject_account_id: account.id,
          target_kind: 'message',
          target_id: thread.id,
          category: 'fee_evasion',
          severity: 'medium',
          description: `Hệ thống: ${CONTACT_STRIKE_LIMIT} tin nhắn có thông tin liên lạc ngoài chợ trong một luồng`,
          due_at: reportDueAt('medium', now),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.log(trx, {
        reportId: report.id,
        subjectId: account.id,
        actorType: 'system',
        action: 'thread.flag',
        note: 'Gửi thông tin liên lạc ngoài nhiều lần',
      });
    });
    return {
      thread: await this.threadView(account, thread.id),
      warning: filtered.warning,
      flagged,
    };
  }

  // ---------- Báo cáo vi phạm

  async createReport(request: Request, body: RequestBody) {
    const account = await this.ready(request);
    const errors: FieldError[] = [];
    const category = pick(body?.category, REPORT_CATEGORIES);
    const chosen = pick(body?.severity, REPORT_SEVERITIES);
    const targetKind = pick(body?.target_kind, REPORT_TARGETS);
    const subjectId = typeof body?.subject_id === 'string' && UUID.test(body.subject_id) ? body.subject_id : '';
    const targetId = typeof body?.target_id === 'string' ? body.target_id.trim().slice(0, 100) : '';
    const description = text(body, 'description', 4000, errors);
    if (!category) errors.push({ field: 'category', message: 'Chọn loại vi phạm' });
    if (!chosen) errors.push({ field: 'severity', message: 'Chọn mức độ' });
    if (!targetKind) errors.push({ field: 'target_kind', message: 'Chọn nơi xảy ra' });
    if (!subjectId) errors.push({ field: 'subject_id', message: 'Chọn người bị báo cáo' });
    if (errors.length > 0 || !category || !chosen || !targetKind) throw validationError(errors);
    const database = this.market.database;
    const subject = await database
      .selectFrom('market_accounts')
      .select(['id', 'kind'])
      .where('id', '=', subjectId)
      .executeTakeFirst();
    if (!subject || subject.kind === account.kind) throw marketNotFound();
    // Gia sư chỉ báo phụ huynh đã có buổi hoặc tin nhắn với mình (không dò tài khoản phụ huynh khác)
    if (account.kind === 'tutor') {
      const [booking, thread] = await Promise.all([
        database
          .selectFrom('market_bookings')
          .select('id')
          .where('tutor_account_id', '=', account.id)
          .where('parent_account_id', '=', subjectId)
          .executeTakeFirst(),
        database
          .selectFrom('market_message_threads')
          .select('id')
          .where('tutor_account_id', '=', account.id)
          .where('parent_account_id', '=', subjectId)
          .executeTakeFirst(),
      ]);
      if (!booking && !thread) throw marketNotFound();
    }
    const severity = effectiveSeverity(category, chosen);
    const now = this.market.now();
    const report = await database
      .insertInto('market_reports')
      .values({
        reporter_account_id: account.id,
        subject_account_id: subjectId,
        target_kind: targetKind,
        target_id: targetId || null,
        category,
        severity,
        description,
        due_at: reportDueAt(severity, now),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.log(database, {
      reportId: report.id,
      subjectId,
      actorType: 'account',
      actorId: account.id,
      action: 'report.create',
      note: `${category}, ${severity}`,
    });
    // Mức nghiêm trọng chỉ tạm khóa ngay khi người báo thực sự đã học với gia sư (YCTD-322); không thì vào hàng chờ 4 giờ như mọi báo cáo
    // nghiêm trọng. Tạm khóa tự động chỉ ẩn gia sư, chặn đặt buổi, giữ tiền; hủy buổi và báo phụ huynh chờ nhân viên xác nhận
    let suspended = false;
    if (
      subject.kind === 'tutor' &&
      suspendsImmediately(severity) &&
      (await this.studiedWith(database, account.id, subjectId))
    ) {
      suspended = await this.suspend(subjectId, report.id, { type: 'system', id: null }, 'Báo cáo mức nghiêm trọng');
    }
    return { id: report.id, severity, due_at: reportDueAt(severity, now), suspended, hotline: HOTLINE };
  }

  // Phụ huynh đã thực sự học với gia sư: có buổi đã nhận tiền (kể cả đã xong, đã hoàn, đã hủy sau khi trả), hoặc luồng tin nhắn gia sư
  // đã trả lời. Luồng chỉ phụ huynh nhắn và buổi giữ chỗ chưa trả tiền thì ai cũng tự tạo được nên không tính
  private async studiedWith(executor: Executor, parentId: string, tutorId: string): Promise<boolean> {
    const [booking, reply] = await Promise.all([
      executor
        .selectFrom('market_bookings')
        .innerJoin('market_payments', 'market_payments.booking_id', 'market_bookings.id')
        .select('market_bookings.id')
        .where('market_bookings.tutor_account_id', '=', tutorId)
        .where('market_bookings.parent_account_id', '=', parentId)
        .where('market_payments.status', 'not in', ['pending', 'failed'])
        .executeTakeFirst(),
      executor
        .selectFrom('market_messages')
        .innerJoin('market_message_threads', 'market_message_threads.id', 'market_messages.thread_id')
        .select('market_messages.id')
        .where('market_message_threads.tutor_account_id', '=', tutorId)
        .where('market_message_threads.parent_account_id', '=', parentId)
        .where('market_messages.author_account_id', '=', tutorId)
        .executeTakeFirst(),
    ]);
    return Boolean(booking || reply);
  }

  async myReports(request: Request) {
    const account = await this.ready(request);
    const rows = await this.market.database
      .selectFrom('market_reports')
      .innerJoin('market_accounts as subject', 'subject.id', 'market_reports.subject_account_id')
      .select([
        'market_reports.id',
        'market_reports.category',
        'market_reports.severity',
        'market_reports.status',
        'market_reports.decision',
        'market_reports.decision_note',
        'market_reports.final_decision',
        'market_reports.decided_at',
        'market_reports.created_at',
        'subject.display_name as subject_name',
      ])
      .where('market_reports.reporter_account_id', '=', account.id)
      .orderBy('market_reports.created_at', 'desc')
      .limit(100)
      .execute();
    return { reports: rows, hotline: HOTLINE };
  }

  // Gia sư xem tình trạng tạm khóa và các quyết định về mình (kháng nghị được trong 7 ngày)
  async tutorSafety(request: Request) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const database = this.market.database;
    const [suspension, reports] = await Promise.all([
      this.activeSuspension(database, account.id),
      database
        .selectFrom('market_reports')
        .select([
          'id',
          'category',
          'severity',
          'status',
          'decision',
          'decision_note',
          'decided_at',
          'final_decision',
          'final_note',
          'created_at',
        ])
        .where('subject_account_id', '=', account.id)
        .where('status', '!=', 'open')
        .orderBy('created_at', 'desc')
        .limit(50)
        .execute(),
    ]);
    return {
      suspension: suspension ?? null,
      reports: reports.map((row) => ({ ...row, can_appeal: this.canAppeal(row, true) })),
    };
  }

  private canAppeal(
    row: { status: string; decision: MarketReportDecision | null; decided_at: Date | null },
    asSubject: boolean,
  ): boolean {
    if (row.status !== 'decided' || !row.decided_at || !row.decision) return false;
    if (this.market.now().getTime() > row.decided_at.getTime() + APPEAL_DAYS * 24 * 3_600_000) return false;
    return asSubject ? row.decision !== 'dismiss' : row.decision === 'dismiss';
  }

  async appeal(request: Request, id: string, body: RequestBody) {
    const account = await this.ready(request);
    const errors: FieldError[] = [];
    const reason = text(body, 'reason', 2000, errors);
    if (errors.length > 0) throw validationError(errors);
    const database = this.market.database;
    const report = UUID.test(id)
      ? await database.selectFrom('market_reports').selectAll().where('id', '=', id).executeTakeFirst()
      : undefined;
    const asSubject = report?.subject_account_id === account.id;
    const asReporter = report?.reporter_account_id === account.id;
    if (!report || (!asSubject && !asReporter)) throw marketNotFound();
    if (!this.canAppeal(report, asSubject)) {
      throw new ApplicationError(
        'ERR_CONFLICT',
        'Không kháng nghị được quyết định này (đã quá 7 ngày hoặc đã kháng nghị)',
      );
    }
    await database
      .updateTable('market_reports')
      .set({ status: 'appealed', appeal_reason: reason, appealed_at: this.market.now() })
      .where('id', '=', report.id)
      .where('status', '=', 'decided')
      .execute();
    await this.log(database, {
      reportId: report.id,
      subjectId: report.subject_account_id,
      actorType: 'account',
      actorId: account.id,
      action: 'report.appeal',
      note: reason,
    });
    return { id: report.id, status: 'appealed' };
  }

  // ---------- Tạm khóa gia sư

  // Tạm khóa: chặn hiện công khai, đặt buổi, nhắn tin, giải ngân. Nhân viên tạm khóa (hoặc quyết định tạm khóa sau khi hệ thống đã tự
  // khóa) thì hủy buổi sắp tới (hoàn đủ) và báo phụ huynh có buổi với gia sư, một lần cho mỗi lần khóa; hệ thống tự khóa thì chỉ giữ,
  // chờ nhân viên xác nhận (YCTD-322). Trả false khi gia sư đã đang bị tạm khóa
  private async suspend(
    tutorId: string,
    reportId: string | null,
    actor: { type: 'operator' | 'system'; id: string | null },
    reason: string,
  ): Promise<boolean> {
    const database = this.market.database;
    const created = await database
      .insertInto('market_tutor_suspensions')
      .values({ tutor_account_id: tutorId, report_id: reportId, reason, started_by: actor.id ?? 'system' })
      .onConflict((conflict) => conflict.column('tutor_account_id').where('lifted_at', 'is', null).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (created) {
      await this.log(database, {
        reportId,
        subjectId: tutorId,
        actorType: actor.type,
        actorId: actor.id,
        action: 'tutor.suspend',
        note: actor.type === 'system' ? `${reason}; chờ nhân viên xác nhận mới hủy buổi, báo phụ huynh` : reason,
      });
    }
    if (actor.type === 'system') return Boolean(created);
    const active = await this.activeSuspension(database, tutorId);
    const notified = active
      ? await database
          .selectFrom('market_moderation_log')
          .select('id')
          .where('subject_account_id', '=', tutorId)
          .where('action', '=', 'tutor.suspend.notify')
          .where('created_at', '>=', active.started_at)
          .executeTakeFirst()
      : undefined;
    if (!active || notified) return Boolean(created);
    const cancelled = await this.bookings.cancelForSuspension(
      tutorId,
      'Gia sư tạm ngừng hoạt động trên chợ; hoàn đủ tiền',
    );
    const parents = await database
      .selectFrom('market_bookings')
      .innerJoin('market_accounts', 'market_accounts.id', 'market_bookings.parent_account_id')
      .select(['market_accounts.id', 'market_accounts.email', 'market_accounts.phone'])
      .distinct()
      .where('market_bookings.tutor_account_id', '=', tutorId)
      .where('market_bookings.status', 'not in', ['held', 'expired'])
      .execute();
    for (const parent of parents) {
      const own = cancelled.filter((booking) => booking.parent_account_id === parent.id).length;
      const to = parent.email ?? parent.phone;
      if (!to) continue;
      await this.messenger.send({
        channel: parent.email ? 'email' : 'sms',
        to,
        text: [
          'Chợ gia sư: một gia sư con bạn từng học hoặc đã đặt đang tạm ngừng hoạt động trong lúc nền tảng xem xét một báo cáo.',
          own > 0 ? `${own} buổi sắp tới đã được hủy và hoàn đủ tiền.` : '',
          'Nếu con bạn có điều gì bất thường, hãy báo trên Chợ gia sư.',
          HOTLINE,
        ]
          .filter(Boolean)
          .join(' '),
      });
    }
    await this.log(database, {
      reportId,
      subjectId: tutorId,
      actorType: 'system',
      action: 'tutor.suspend.notify',
      note: `Hủy ${cancelled.length} buổi, báo ${parents.length} phụ huynh`,
    });
    return Boolean(created);
  }

  private async lift(tutorId: string, operatorId: string, note: string, reportId: string | null) {
    const database = this.market.database;
    const lifted = await database
      .updateTable('market_tutor_suspensions')
      .set({ lifted_at: this.market.now(), lifted_by: operatorId, lift_note: note })
      .where('tutor_account_id', '=', tutorId)
      .where('lifted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (lifted) {
      await this.log(database, {
        reportId,
        subjectId: tutorId,
        actorType: 'operator',
        actorId: operatorId,
        action: 'tutor.lift',
        note,
      });
    }
  }

  // ---------- Phòng học và ghi hình

  private async bookingFor(account: MarketAccount, id: string) {
    const booking = UUID.test(id)
      ? await this.market.database
          .selectFrom('market_bookings')
          .selectAll()
          .where('id', '=', id)
          .where(account.kind === 'tutor' ? 'tutor_account_id' : 'parent_account_id', '=', account.id)
          .executeTakeFirst()
      : undefined;
    if (!booking) throw marketNotFound();
    return booking;
  }

  private recordingFor(bookingId: string) {
    return this.market.database
      .selectFrom('market_session_recordings')
      .selectAll()
      .where('booking_id', '=', bookingId)
      .executeTakeFirst();
  }

  // Gia sư mở phòng: buổi đã trả tiền, trong giờ mở phòng (mốc ở cấu hình chợ, mặc định 10 phút trước giờ học, YCTD-362); buổi có trẻ
  // vị thành niên phải bắt đầu ghi được, không thì không mở. Trả thông tin vào phòng của chủ phòng (phòng chờ, điểm danh ở market-rooms)
  async startSession(request: Request, id: string) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const booking = await this.bookingFor(account, id);
    const now = this.market.now();
    const timings = (await this.market.settings()).room;
    if (booking.status !== 'paid' || !roomWindowOpen(booking.starts_at, booking.minutes, now, timings)) {
      throw new ApplicationError(
        'ERR_CONFLICT',
        `Phòng chỉ mở cho buổi đã trả tiền, từ ${timings.opensBeforeMinutes} phút trước giờ học đến hết giờ`,
      );
    }
    if (await this.activeSuspension(this.market.database, account.id)) {
      throw new ApplicationError('ERR_FORBIDDEN', 'Tài khoản đang tạm khóa');
    }
    const video = this.video;
    if (!video) throw new ApplicationError('ERR_CONFLICT', 'Phòng video chưa bật ở bản triển khai này');
    const roomName = `market-${booking.id}`;
    let recording = await this.recordingFor(booking.id);
    if (booking.recording_required && recording?.status !== 'recording') {
      if (!this.configuration.marketFilesKey || !hasMarketStorage(this.files)) {
        throw new ApplicationError(
          'ERR_CONFLICT',
          'Buổi học với trẻ dưới 18 tuổi phải ghi hình nhưng kho lưu bản ghi chưa bật; chưa mở phòng được',
        );
      }
      if (recording) {
        throw new ApplicationError('ERR_CONFLICT', 'Buổi đã ghi hình xong; không mở lại phòng');
      }
    }
    await video.createRoom(roomName, { maxParticipants: 3 });
    if (booking.recording_required && !recording) {
      const fileKey = `marketplace/recordings/${booking.id}`;
      const started = await video.startRecording(roomName, fileKey);
      recording = await this.market.database
        .insertInto('market_session_recordings')
        .values({
          booking_id: booking.id,
          room_name: roomName,
          status: 'recording',
          egress_id: started.egressId,
          file_key: fileKey,
          started_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.market.audit({
        actorType: 'account',
        actorId: account.id,
        action: 'recording.start',
        target: booking.id,
      });
    }
    const host = await this.rooms.opened(booking, account);
    const token = await video.issueToken({
      roomName,
      identity: host.identity,
      displayName: account.display_name,
      grants: videoGrantsFor('host'),
    });
    const recordingOn = recording?.status === 'recording';
    return {
      ...this.rooms.hostJoinInfo(booking, host, token, recordingOn),
      room: roomName,
      client_url: video.clientUrl,
    };
  }

  // Phụ huynh (con học trên máy của phụ huynh) vào phòng: chuyển sang phòng chờ của market-rooms (YCTD-362): cần đồng ý ghi hình với
  // buổi bắt buộc ghi, gia sư đã mở và đang ghi, gia sư cho vào; chưa đủ thì trả `status: 'waiting'`
  async joinSession(request: Request, id: string) {
    return this.rooms.enter(request, id, { as: 'student' });
  }

  // Gia sư kết thúc phòng: dừng ghi; nhà cung cấp trả tệp ngay thì mã hóa, lưu, đặt hạn giữ 30 ngày
  async endSession(request: Request, id: string) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const booking = await this.bookingFor(account, id);
    const video = this.video;
    if (!video) throw new ApplicationError('ERR_CONFLICT', 'Phòng video chưa bật ở bản triển khai này');
    const recording = await this.recordingFor(booking.id);
    const now = this.market.now();
    if (recording?.status === 'recording' && recording.egress_id) {
      const stopped = await video.stopRecording(recording.egress_id);
      const key = this.configuration.marketFilesKey;
      if (stopped.completed?.contents && key) {
        await marketStorage(this.files).put(
          recording.file_key,
          encryptFile(key, stopped.completed.contents),
          'application/octet-stream',
        );
      }
      await this.market.database
        .updateTable('market_session_recordings')
        .set({
          status: stopped.completed ? 'ready' : 'processing',
          size_bytes: stopped.completed?.sizeBytes ?? null,
          ended_at: now,
          retain_until: recordingRetainUntil(now),
        })
        .where('id', '=', recording.id)
        // Sự kiện ghi xong của nhà cung cấp có thể tới trước (finishRecording): không ghi đè trạng thái đã chốt
        .where('status', '=', 'recording')
        .execute();
      await this.market.audit({
        actorType: 'account',
        actorId: account.id,
        action: 'recording.stop',
        target: booking.id,
      });
    }
    await video.endRoom(`market-${booking.id}`);
    await this.rooms.closed(booking.id);
    return { recording: (await this.recordingFor(booking.id))?.status ?? null };
  }

  // Nhà cung cấp video báo ghi xong (LiveKit gửi sự kiện sau khi dừng ghi; tệp thô đã ở kho tại khóa đã giao): mã hóa sang khóa mới, xóa
  // tệp thô, bản ghi xem được; ghi lỗi hoặc không đọc được tệp thì đặt `failed`. Sự kiện gửi lại thì bỏ qua (YCTD-379)
  async finishRecording(
    result: { egressId: string; succeeded: boolean; sizeBytes: number },
    at: Date,
  ): Promise<boolean> {
    const recording = await this.market.database
      .selectFrom('market_session_recordings')
      .select(['id', 'booking_id', 'file_key', 'ended_at', 'retain_until'])
      .where('egress_id', '=', result.egressId)
      .where('status', 'in', ['recording', 'processing'])
      .executeTakeFirst();
    if (!recording) return false;
    const key = this.configuration.marketFilesKey;
    const storage = marketStorage(this.files);
    const encryptedKey = `${recording.file_key}.enc`;
    let stored: { sizeBytes: number } | null = null;
    if (result.succeeded && key && hasMarketStorage(this.files)) {
      try {
        const contents = await storage.get(recording.file_key);
        await storage.put(encryptedKey, encryptFile(key, contents), 'application/octet-stream');
        stored = { sizeBytes: contents.length };
      } catch (error) {
        this.logger.error(
          `Không mã hóa được bản ghi của buổi ${recording.booking_id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    const endedAt = recording.ended_at ?? at;
    const updated = await this.market.database
      .updateTable('market_session_recordings')
      .set({
        status: stored ? 'ready' : 'failed',
        ...(stored ? { file_key: encryptedKey, size_bytes: stored.sizeBytes } : {}),
        ended_at: endedAt,
        retain_until: recording.retain_until ?? recordingRetainUntil(endedAt),
      })
      .where('id', '=', recording.id)
      .where('status', 'in', ['recording', 'processing'])
      .returning('id')
      .executeTakeFirst();
    if (!updated) return true;
    if (stored) {
      await storage.delete(recording.file_key);
    }
    await this.market.audit({
      actorType: 'system',
      action: stored ? 'recording.ready' : 'recording.failed',
      target: recording.booking_id,
    });
    return true;
  }

  async recordingStatus(request: Request, id: string) {
    const account = await this.ready(request);
    const booking = await this.bookingFor(account, id);
    const recording = await this.recordingFor(booking.id);
    return {
      recording_required: booking.recording_required,
      status: recording?.status ?? null,
      retain_until: recording?.retain_until ?? null,
    };
  }

  async streamForAccount(request: Request, id: string, response: Response) {
    const account = await this.ready(request);
    const booking = await this.bookingFor(account, id);
    await this.stream(booking.id, { type: 'account', id: account.id }, response);
  }

  // Phát bản ghi để xem trực tiếp, không cho tải (inline, không lưu đệm); mỗi lượt xem ghi nhật ký
  private async stream(bookingId: string, viewer: { type: 'account' | 'operator'; id: string }, response: Response) {
    const recording = await this.recordingFor(bookingId);
    const key = this.configuration.marketFilesKey;
    if (!recording || recording.status !== 'ready' || !key) throw marketNotFound();
    const body = decryptFile(key, await marketStorage(this.files).get(recording.file_key));
    await this.market.database
      .insertInto('market_recording_views')
      .values({ recording_id: recording.id, viewer_type: viewer.type, viewer_id: viewer.id })
      .execute();
    response.setHeader('Content-Type', 'video/mp4');
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(body);
  }

  // Xóa bản ghi hết hạn giữ; giữ tiếp khi buổi đang tranh chấp, có báo cáo chưa chốt về một trong hai bên, hoặc gia sư đang tạm khóa
  async purgeRecordings(): Promise<number> {
    if (!this.market.available) return 0;
    const database = this.market.database;
    const now = this.market.now();
    const due = await database
      .selectFrom('market_session_recordings')
      .innerJoin('market_bookings', 'market_bookings.id', 'market_session_recordings.booking_id')
      .select([
        'market_session_recordings.id',
        'market_session_recordings.file_key',
        'market_session_recordings.retain_until',
        'market_bookings.status as booking_status',
        'market_bookings.parent_account_id',
        'market_bookings.tutor_account_id',
      ])
      .where('market_session_recordings.status', 'in', ['ready', 'processing', 'failed'])
      .where('market_session_recordings.retain_until', '<=', now)
      .execute();
    let purged = 0;
    for (const row of due) {
      const [report, suspension] = await Promise.all([
        database
          .selectFrom('market_reports')
          .select('id')
          .where('subject_account_id', 'in', [row.parent_account_id, row.tutor_account_id])
          .where('status', '!=', 'final')
          .where((eb) => eb.or([eb('status', '!=', 'decided'), eb('decision', '!=', 'dismiss')]))
          .executeTakeFirst(),
        this.activeSuspension(database, row.tutor_account_id),
      ]);
      const evidenceHold = row.booking_status === 'disputed' || Boolean(report) || Boolean(suspension);
      if (!recordingDeletable({ retainUntil: row.retain_until, now, evidenceHold })) continue;
      await marketStorage(this.files)
        .delete(row.file_key)
        .catch(() => undefined);
      await database
        .updateTable('market_session_recordings')
        .set({ status: 'deleted', deleted_at: now })
        .where('id', '=', row.id)
        .execute();
      await this.market.audit({ actorType: 'system', action: 'recording.purge', target: row.id });
      purged += 1;
    }
    return purged;
  }

  // ---------- Nhân viên nền tảng

  async adminOverview(request: Request) {
    await this.market.operator(request, operatorRolesFor('market.safety'));
    const database = this.market.database;
    const now = this.market.now();
    const [reports, suspensions, flagged, recordings] = await Promise.all([
      database
        .selectFrom('market_reports')
        .innerJoin('market_accounts as subject', 'subject.id', 'market_reports.subject_account_id')
        .select([
          'market_reports.id',
          'market_reports.category',
          'market_reports.severity',
          'market_reports.status',
          'market_reports.due_at',
          'market_reports.assigned_to',
          'market_reports.target_kind',
          'market_reports.created_at',
          'subject.display_name as subject_name',
          'subject.kind as subject_kind',
        ])
        .where('market_reports.status', 'in', ['open', 'appealed', 'decided'])
        .orderBy('market_reports.due_at', 'asc')
        .limit(200)
        .execute(),
      database
        .selectFrom('market_tutor_suspensions')
        .innerJoin('market_accounts', 'market_accounts.id', 'market_tutor_suspensions.tutor_account_id')
        .select([
          'market_tutor_suspensions.id',
          'market_tutor_suspensions.tutor_account_id',
          'market_tutor_suspensions.reason',
          'market_tutor_suspensions.started_at',
          'market_tutor_suspensions.report_id',
          'market_accounts.display_name as tutor_name',
        ])
        .where('market_tutor_suspensions.lifted_at', 'is', null)
        .execute(),
      database
        .selectFrom('market_message_threads')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('flagged_at', 'is not', null)
        .executeTakeFirstOrThrow(),
      database
        .selectFrom('market_session_recordings')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('status', '=', 'ready')
        .executeTakeFirstOrThrow(),
    ]);
    const waiting = reports.filter((row) => row.status === 'open' || row.status === 'appealed');
    return {
      metrics: {
        open_reports: waiting.length,
        overdue_reports: waiting.filter((row) => row.due_at.getTime() < now.getTime()).length,
        critical_open: waiting.filter((row) => row.severity === 'critical').length,
        child_safety_open: waiting.filter((row) => row.category === 'child_safety').length,
        active_suspensions: suspensions.length,
        flagged_threads: Number(flagged.count),
        stored_recordings: Number(recordings.count),
      },
      reports,
      suspensions,
    };
  }

  private async reportRow(id: string) {
    const report = UUID.test(id)
      ? await this.market.database.selectFrom('market_reports').selectAll().where('id', '=', id).executeTakeFirst()
      : undefined;
    if (!report) throw marketNotFound();
    return report;
  }

  // Chi tiết báo cáo kèm bằng chứng: tin nhắn giữa hai bên (cả chữ gốc trước khi che), buổi học và bản ghi, nhật ký kiểm duyệt
  private async reportDetail(id: string) {
    const report = await this.reportRow(id);
    const database = this.market.database;
    const people = [report.subject_account_id, report.reporter_account_id].filter((value): value is string =>
      Boolean(value),
    );
    const accounts = await database
      .selectFrom('market_accounts')
      .select(['id', 'kind', 'display_name'])
      .where('id', 'in', people)
      .execute();
    const tutor = accounts.find((row) => row.kind === 'tutor');
    const parent = accounts.find((row) => row.kind === 'parent');
    const threadFilter = tutor && parent ? { tutor: tutor.id, parent: parent.id } : null;
    const [messages, bookings, log, suspension] = await Promise.all([
      report.target_kind === 'message' && report.target_id && UUID.test(report.target_id)
        ? this.evidenceMessages({ threadId: report.target_id })
        : threadFilter
          ? this.evidenceMessages(threadFilter)
          : Promise.resolve([]),
      tutor
        ? database
            .selectFrom('market_bookings')
            .leftJoin('market_session_recordings', 'market_session_recordings.booking_id', 'market_bookings.id')
            .select([
              'market_bookings.id',
              'market_bookings.child_name',
              'market_bookings.subject',
              'market_bookings.starts_at',
              'market_bookings.status',
              'market_bookings.recording_required',
              'market_session_recordings.status as recording_status',
              'market_session_recordings.retain_until',
            ])
            .where('market_bookings.tutor_account_id', '=', tutor.id)
            .$if(Boolean(parent), (query) => query.where('market_bookings.parent_account_id', '=', parent?.id ?? ''))
            .orderBy('market_bookings.starts_at', 'desc')
            .limit(50)
            .execute()
        : Promise.resolve([]),
      database
        .selectFrom('market_moderation_log')
        .select(['actor_type', 'actor_id', 'action', 'note', 'created_at'])
        .where((eb) =>
          eb.or([eb('report_id', '=', report.id), eb('subject_account_id', '=', report.subject_account_id)]),
        )
        .orderBy('created_at', 'asc')
        .limit(200)
        .execute(),
      this.activeSuspension(database, report.subject_account_id),
    ]);
    return {
      ...report,
      subject_name: accounts.find((row) => row.id === report.subject_account_id)?.display_name ?? '',
      subject_kind: accounts.find((row) => row.id === report.subject_account_id)?.kind ?? null,
      reporter_name: report.reporter_account_id
        ? (accounts.find((row) => row.id === report.reporter_account_id)?.display_name ?? '')
        : 'Hệ thống',
      suspension: suspension ?? null,
      evidence: { messages, bookings },
      log,
    };
  }

  private async evidenceMessages(filter: { threadId: string } | { tutor: string; parent: string }) {
    let query = this.market.database
      .selectFrom('market_messages')
      .innerJoin('market_message_threads', 'market_message_threads.id', 'market_messages.thread_id')
      .select([
        'market_messages.id',
        'market_messages.thread_id',
        'market_messages.role',
        'market_messages.body',
        'market_messages.original_body',
        'market_messages.created_at',
      ]);
    query =
      'threadId' in filter
        ? query.where('market_message_threads.id', '=', filter.threadId)
        : query
            .where('market_message_threads.tutor_account_id', '=', filter.tutor)
            .where('market_message_threads.parent_account_id', '=', filter.parent);
    return query.orderBy('market_messages.created_at', 'asc').limit(500).execute();
  }

  async adminReport(request: Request, id: string) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.safety'));
    const detail = await this.reportDetail(id);
    await this.market.audit({ actorType: 'operator', actorId: operatorId, action: 'report.view', target: id });
    return detail;
  }

  async assign(request: Request, id: string) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.safety'));
    const report = await this.reportRow(id);
    await this.market.database
      .updateTable('market_reports')
      .set({ assigned_to: operatorId })
      .where('id', '=', report.id)
      .execute();
    await this.log(this.market.database, {
      reportId: report.id,
      subjectId: report.subject_account_id,
      actorType: 'operator',
      actorId: operatorId,
      action: 'report.assign',
    });
    return this.reportDetail(id);
  }

  // Quyết định: lần đầu khi đang mở; xét lại khi đã kháng nghị, phải là nhân viên khác người quyết định lần đầu. Tạm khóa thì khóa gia sư
  // (nếu chưa); cảnh cáo hoặc bác thì gỡ khóa đang có
  async decide(request: Request, id: string, body: RequestBody) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.safety'));
    const errors: FieldError[] = [];
    const decision = pick(body?.decision, DECISIONS);
    const note = text(body, 'note', 2000, errors);
    if (!decision) errors.push({ field: 'decision', message: 'Chọn tạm khóa, cảnh cáo hoặc bác' });
    if (errors.length > 0 || !decision) throw validationError(errors);
    const report = await this.reportRow(id);
    const database = this.market.database;
    const now = this.market.now();
    if (report.status === 'open') {
      await database
        .updateTable('market_reports')
        .set({
          status: 'decided',
          decision,
          decision_note: note,
          decided_by: operatorId,
          decided_at: now,
          assigned_to: report.assigned_to ?? operatorId,
        })
        .where('id', '=', report.id)
        .where('status', '=', 'open')
        .execute();
    } else if (report.status === 'appealed') {
      if (report.decided_by === operatorId) {
        throw new ApplicationError('ERR_FORBIDDEN', 'Kháng nghị phải do nhân viên khác người quyết định lần đầu xét');
      }
      await database
        .updateTable('market_reports')
        .set({
          status: 'final',
          final_decision: decision,
          final_note: note,
          final_decided_by: operatorId,
          final_decided_at: now,
        })
        .where('id', '=', report.id)
        .where('status', '=', 'appealed')
        .execute();
    } else {
      throw new ApplicationError('ERR_CONFLICT', 'Báo cáo đã có quyết định; chỉ xét lại khi có kháng nghị');
    }
    await this.log(database, {
      reportId: report.id,
      subjectId: report.subject_account_id,
      actorType: 'operator',
      actorId: operatorId,
      action: report.status === 'open' ? 'report.decide' : 'report.final',
      note: `${decision}: ${note}`,
    });
    const subject = await database
      .selectFrom('market_accounts')
      .select('kind')
      .where('id', '=', report.subject_account_id)
      .executeTakeFirstOrThrow();
    if (subject.kind === 'tutor') {
      if (decision === 'suspend') {
        await this.suspend(report.subject_account_id, report.id, { type: 'operator', id: operatorId }, note);
      } else {
        await this.lift(report.subject_account_id, operatorId, note, report.id);
      }
    }
    return this.reportDetail(id);
  }

  // Tạm khóa ngay trong lúc xét (không cần chờ quyết định)
  async suspendNow(request: Request, id: string, body: RequestBody) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.safety'));
    const errors: FieldError[] = [];
    const note = text(body, 'note', 2000, errors);
    if (errors.length > 0) throw validationError(errors);
    const report = await this.reportRow(id);
    const subject = await this.market.database
      .selectFrom('market_accounts')
      .select('kind')
      .where('id', '=', report.subject_account_id)
      .executeTakeFirstOrThrow();
    if (subject.kind !== 'tutor') throw new ApplicationError('ERR_CONFLICT', 'Chỉ tạm khóa được gia sư');
    await this.suspend(report.subject_account_id, report.id, { type: 'operator', id: operatorId }, note);
    return this.reportDetail(id);
  }

  // Xuất hồ sơ cho cơ quan có thẩm quyền: phải ghi cơ quan và số văn bản yêu cầu; có nhật ký. Bản ghi hình không nằm trong tệp xuất
  // (bàn giao theo thủ tục riêng của cơ quan, E-08)
  async exportEvidence(request: Request, id: string, body: RequestBody) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.safety'));
    const errors: FieldError[] = [];
    const authority = text(body, 'authority', 300, errors);
    const reference = text(body, 'request_reference', 200, errors);
    if (errors.length > 0) throw validationError(errors);
    const detail = await this.reportDetail(id);
    await this.market.database
      .insertInto('market_evidence_exports')
      .values({ report_id: detail.id, operator_id: operatorId, authority, request_reference: reference })
      .execute();
    await this.log(this.market.database, {
      reportId: detail.id,
      subjectId: detail.subject_account_id,
      actorType: 'operator',
      actorId: operatorId,
      action: 'evidence.export',
      note: `${authority}, ${reference}`,
    });
    return {
      exported_at: this.market.now(),
      exported_by: operatorId,
      authority,
      request_reference: reference,
      report: detail,
    };
  }

  async streamForOperator(request: Request, bookingId: string, response: Response) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.safety'));
    if (!UUID.test(bookingId)) throw marketNotFound();
    await this.stream(bookingId, { type: 'operator', id: operatorId }, response);
  }

  async runDue(request: Request) {
    await this.market.operator(request, operatorRolesFor('market.safety'));
    return { purged: await this.purgeRecordings() };
  }
}

@Controller('market')
@PublicEndpoint()
export class MarketSafetyController {
  constructor(private readonly safety: MarketSafetyService) {}

  @Get('messages/threads')
  threads(@Req() request: Request) {
    return this.safety.threads(request);
  }

  @Post('messages/threads')
  openThread(@Req() request: Request, @Body() body: RequestBody) {
    return this.safety.openThread(request, body);
  }

  @Get('messages/threads/:id')
  thread(@Req() request: Request, @Param('id') id: string) {
    return this.safety.thread(request, id);
  }

  @Post('messages/threads/:id')
  send(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.safety.send(request, id, body);
  }

  @Post('reports')
  createReport(@Req() request: Request, @Body() body: RequestBody) {
    return this.safety.createReport(request, body);
  }

  @Get('reports')
  myReports(@Req() request: Request) {
    return this.safety.myReports(request);
  }

  @Post('reports/:id/appeal')
  @HttpCode(200)
  appeal(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.safety.appeal(request, id, body);
  }

  @Get('tutor/safety')
  tutorSafety(@Req() request: Request) {
    return this.safety.tutorSafety(request);
  }

  @Post('tutor/bookings/:id/session/start')
  @HttpCode(200)
  startSession(@Req() request: Request, @Param('id') id: string) {
    return this.safety.startSession(request, id);
  }

  @Post('tutor/bookings/:id/session/end')
  @HttpCode(200)
  endSession(@Req() request: Request, @Param('id') id: string) {
    return this.safety.endSession(request, id);
  }

  @Post('bookings/:id/session/join')
  @HttpCode(200)
  joinSession(@Req() request: Request, @Param('id') id: string) {
    return this.safety.joinSession(request, id);
  }

  @Get('bookings/:id/recording')
  recordingStatus(@Req() request: Request, @Param('id') id: string) {
    return this.safety.recordingStatus(request, id);
  }

  @Get('bookings/:id/recording/stream')
  async stream(@Req() request: Request, @Param('id') id: string, @Res() response: Response) {
    await this.safety.streamForAccount(request, id, response);
  }

  @Get('tutor/bookings/:id/recording')
  tutorRecordingStatus(@Req() request: Request, @Param('id') id: string) {
    return this.safety.recordingStatus(request, id);
  }

  @Get('tutor/bookings/:id/recording/stream')
  async tutorStream(@Req() request: Request, @Param('id') id: string, @Res() response: Response) {
    await this.safety.streamForAccount(request, id, response);
  }
}

@Controller('market/admin/safety')
@PublicEndpoint()
export class MarketSafetyAdminController {
  constructor(private readonly safety: MarketSafetyService) {}

  @Get()
  overview(@Req() request: Request) {
    return this.safety.adminOverview(request);
  }

  @Get('reports/:id')
  report(@Req() request: Request, @Param('id') id: string) {
    return this.safety.adminReport(request, id);
  }

  @Post('reports/:id/assign')
  @HttpCode(200)
  assign(@Req() request: Request, @Param('id') id: string) {
    return this.safety.assign(request, id);
  }

  @Post('reports/:id/decide')
  @HttpCode(200)
  decide(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.safety.decide(request, id, body);
  }

  @Post('reports/:id/suspend')
  @HttpCode(200)
  suspend(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.safety.suspendNow(request, id, body);
  }

  @Post('reports/:id/export')
  @HttpCode(200)
  exportEvidence(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.safety.exportEvidence(request, id, body);
  }

  @Get('recordings/:bookingId')
  async recording(@Req() request: Request, @Param('bookingId') bookingId: string, @Res() response: Response) {
    await this.safety.streamForOperator(request, bookingId, response);
  }

  @Post('run-due')
  @HttpCode(200)
  runDue(@Req() request: Request) {
    return this.safety.runDue(request);
  }
}
