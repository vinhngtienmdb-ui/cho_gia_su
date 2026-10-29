import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Req } from '@nestjs/common';
import { ApplicationError, validationError, type FieldError } from '../common/server.js';
import { operatorRolesFor } from '../common/shared.js';
import type { Request } from 'express';
import { sql } from 'kysely';
import { PublicEndpoint } from '../common/public-endpoint.js';
import type { RequestBody } from '../common/request-fields.js';
import { MarketAccountsService } from './market-accounts.js';
import { MarketContext, marketNotFound } from './market-context.js';
import { filterMessage } from './market-safety-rules.js';

// Đánh giá gia sư và con đọc tin nhắn ở chợ (YCTD-364; thiết kế Eric duyệt ngày 2026-10-28; việc T-M2, T-M9 của rà soát giao diện).
// Claude tự chọn theo ủy quyền của Eric ngày 2026-10-11:
// - mỗi buổi đã dạy (đã xác nhận, đang chờ hoặc đã giải ngân) một đánh giá của phụ huynh của buổi; nhận xét che thông tin liên lạc ngoài
//   như tin nhắn; đánh giá chờ nhân viên nền tảng duyệt rồi mới hiện ở trang gia sư (bản vẽ đã duyệt), hiện với tên "Phụ huynh học sinh
//   lớp N", không có tên phụ huynh, tên con; gia sư trả lời một lần đánh giá đã hiện;
// - con đọc tin nhắn: phụ huynh bật cho từng con; con chỉ đọc các luồng tin của phụ huynh với gia sư đã dạy hoặc sắp dạy con, trên máy
//   của phụ huynh (phiên của phụ huynh), không có điểm cuối gửi tin cho con; không có kênh riêng giữa gia sư và trẻ (chính sách an toàn trẻ
//   em của chợ, 27i)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CRITERIA = ['punctuality', 'clarity', 'progress', 'communication'] as const;
const REVIEWABLE = ['completed', 'disbursed'] as const;

function score(value: unknown, field: string, required: boolean, errors: FieldError[]): number | null {
  if (value === undefined || value === null || value === '') {
    if (required) errors.push({ field, message: 'Chọn từ 1 đến 5 sao' });
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
    errors.push({ field, message: 'Điểm từ 1 đến 5' });
    return null;
  }
  return value;
}

@Injectable()
export class MarketReviewsService {
  constructor(
    private readonly market: MarketContext,
    private readonly accounts: MarketAccountsService,
  ) {}

  // ---------- Phụ huynh

  async create(request: Request, bookingId: string, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'parent');
    if (!UUID.test(bookingId)) throw marketNotFound();
    const booking = await this.market.database
      .selectFrom('market_bookings')
      .select(['id', 'tutor_account_id', 'grade', 'status'])
      .where('id', '=', bookingId)
      .where('parent_account_id', '=', account.id)
      .executeTakeFirst();
    if (!booking) throw marketNotFound();
    if (!(REVIEWABLE as readonly string[]).includes(booking.status)) {
      throw new ApplicationError('ERR_CONFLICT', 'Chỉ đánh giá được buổi gia sư đã dạy');
    }
    const errors: FieldError[] = [];
    const rating = score(body?.rating, 'rating', true, errors);
    const criteria = Object.fromEntries(CRITERIA.map((field) => [field, score(body?.[field], field, false, errors)]));
    const raw = typeof body?.body === 'string' ? body.body.trim() : '';
    if (raw.length > 2000) errors.push({ field: 'body', message: 'Nhận xét tối đa 2000 ký tự' });
    if (errors.length > 0) throw validationError(errors);
    const filtered = filterMessage(raw);
    const created = await this.market.database
      .insertInto('market_reviews')
      .values({
        booking_id: booking.id,
        parent_account_id: account.id,
        tutor_account_id: booking.tutor_account_id,
        grade: booking.grade,
        rating: rating as number,
        ...criteria,
        body: filtered.body,
        original_body: filtered.original,
      })
      .onConflict((conflict) => conflict.column('booking_id').doNothing())
      .returning(['id', 'status'])
      .executeTakeFirst();
    if (!created) throw new ApplicationError('ERR_CONFLICT', 'Buổi này đã có đánh giá');
    await this.market.audit({ actorType: 'account', actorId: account.id, action: 'review.create', target: created.id });
    return { id: created.id, status: created.status, warning: filtered.warning };
  }

  async mine(request: Request, bookingId: string) {
    const account = await this.accounts.requireReady(request, 'parent');
    if (!UUID.test(bookingId)) throw marketNotFound();
    const row = await this.market.database
      .selectFrom('market_reviews')
      .select(['id', 'rating', 'body', 'status', 'reply_body', 'created_at'])
      .where('booking_id', '=', bookingId)
      .where('parent_account_id', '=', account.id)
      .executeTakeFirst();
    return { review: row ?? null };
  }

  // ---------- Công khai: đánh giá đã hiện của một gia sư và điểm trung bình
  async publicReviews(request: Request, tutorId: string) {
    await this.market.assertMarketHost(request);
    if (!UUID.test(tutorId)) throw marketNotFound();
    const database = this.market.database;
    const [summary, rows] = await Promise.all([
      database
        .selectFrom('market_reviews')
        .select([
          sql<number>`count(*)::int`.as('count'),
          sql<string | null>`round(avg(rating), 1)::text`.as('average'),
          sql<string | null>`round(avg(punctuality), 1)::text`.as('punctuality'),
          sql<string | null>`round(avg(clarity), 1)::text`.as('clarity'),
          sql<string | null>`round(avg(progress), 1)::text`.as('progress'),
          sql<string | null>`round(avg(communication), 1)::text`.as('communication'),
        ])
        .where('tutor_account_id', '=', tutorId)
        .where('status', '=', 'published')
        .executeTakeFirstOrThrow(),
      database
        .selectFrom('market_reviews')
        .select(['id', 'grade', 'rating', 'body', 'reply_body', 'replied_at', 'created_at'])
        .where('tutor_account_id', '=', tutorId)
        .where('status', '=', 'published')
        .orderBy('created_at', 'desc')
        .limit(50)
        .execute(),
    ]);
    const number = (value: string | null) => (value === null ? null : Number(value));
    return {
      summary: {
        count: summary.count,
        average: number(summary.average),
        punctuality: number(summary.punctuality),
        clarity: number(summary.clarity),
        progress: number(summary.progress),
        communication: number(summary.communication),
      },
      reviews: rows,
    };
  }

  // ---------- Gia sư

  async tutorReviews(request: Request) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const rows = await this.market.database
      .selectFrom('market_reviews')
      .select(['id', 'grade', 'rating', 'body', 'status', 'reply_body', 'replied_at', 'created_at'])
      .where('tutor_account_id', '=', account.id)
      .where('status', '!=', 'rejected')
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();
    return { reviews: rows };
  }

  async reply(request: Request, id: string, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'tutor');
    if (!UUID.test(id)) throw marketNotFound();
    const raw = typeof body?.body === 'string' ? body.body.trim() : '';
    if (raw.length < 1 || raw.length > 1000) {
      throw validationError([{ field: 'body', message: 'Trả lời từ 1 đến 1000 ký tự' }]);
    }
    const filtered = filterMessage(raw);
    const updated = await this.market.database
      .updateTable('market_reviews')
      .set({ reply_body: filtered.body, replied_at: this.market.now() })
      .where('id', '=', id)
      .where('tutor_account_id', '=', account.id)
      .where('status', '=', 'published')
      .where('reply_body', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!updated) throw new ApplicationError('ERR_CONFLICT', 'Chỉ trả lời một lần đánh giá đã hiện');
    await this.market.audit({ actorType: 'account', actorId: account.id, action: 'review.reply', target: id });
    return { replied: true, warning: filtered.warning };
  }

  // ---------- Nhân viên nền tảng: hàng chờ duyệt đánh giá (giao diện ở cổng vận hành làm cùng YCTD-363); kiểm duyệt nên cùng vai trò với
  // kiểm duyệt chợ (quản trị, hỗ trợ; YCTD-323)

  async pending(request: Request) {
    await this.market.operator(request, operatorRolesFor('market.safety'));
    const rows = await this.market.database
      .selectFrom('market_reviews')
      .innerJoin('market_accounts as tutor', 'tutor.id', 'market_reviews.tutor_account_id')
      .select([
        'market_reviews.id',
        'market_reviews.rating',
        'market_reviews.body',
        'market_reviews.original_body',
        'market_reviews.created_at',
        'tutor.display_name as tutor_name',
      ])
      .where('market_reviews.status', '=', 'pending')
      .orderBy('market_reviews.created_at')
      .limit(200)
      .execute();
    return { reviews: rows };
  }

  async decide(request: Request, id: string, body: RequestBody) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.safety'));
    if (!UUID.test(id)) throw marketNotFound();
    const decision = body?.decision === 'publish' ? 'published' : body?.decision === 'reject' ? 'rejected' : null;
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 1000) : '';
    if (!decision) throw validationError([{ field: 'decision', message: 'Chọn hiện hoặc từ chối' }]);
    if (decision === 'rejected' && !note) {
      throw validationError([{ field: 'note', message: 'Từ chối cần ghi lý do' }]);
    }
    const updated = await this.market.database
      .updateTable('market_reviews')
      .set({
        status: decision,
        moderation_note: note || null,
        moderated_by: operatorId,
        moderated_at: this.market.now(),
      })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .returning('id')
      .executeTakeFirst();
    if (!updated) throw new ApplicationError('ERR_CONFLICT', 'Đánh giá đã được xử lý');
    await this.market.audit({ actorType: 'operator', actorId: operatorId, action: `review.${decision}`, target: id });
    return { id, status: decision };
  }

  // ---------- Con đọc tin nhắn

  async setChildReads(request: Request, childId: string, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'parent');
    if (!UUID.test(childId)) throw marketNotFound();
    const enabled = body?.enabled === true;
    const updated = await this.market.database
      .updateTable('market_children')
      .set({ reads_messages: enabled, updated_at: this.market.now() })
      .where('id', '=', childId)
      .where('parent_account_id', '=', account.id)
      .returning('id')
      .executeTakeFirst();
    if (!updated) throw marketNotFound();
    await this.market.audit({
      actorType: 'account',
      actorId: account.id,
      action: enabled ? 'child.reads-messages-on' : 'child.reads-messages-off',
      target: childId,
    });
    return { reads_messages: enabled };
  }

  // Các luồng tin của phụ huynh với gia sư có buổi với con này; chỉ đọc
  async childMessages(request: Request, childId: string) {
    const account = await this.accounts.requireReady(request, 'parent');
    if (!UUID.test(childId)) throw marketNotFound();
    const database = this.market.database;
    const child = await database
      .selectFrom('market_children')
      .select(['id', 'display_name', 'reads_messages'])
      .where('id', '=', childId)
      .where('parent_account_id', '=', account.id)
      .executeTakeFirst();
    if (!child) throw marketNotFound();
    if (!child.reads_messages) throw new ApplicationError('ERR_FORBIDDEN', 'Phụ huynh chưa cho con đọc tin nhắn');
    const threads = await database
      .selectFrom('market_message_threads')
      .innerJoin('market_accounts as tutor', 'tutor.id', 'market_message_threads.tutor_account_id')
      .select(['market_message_threads.id', 'tutor.display_name as tutor_name'])
      .where('market_message_threads.parent_account_id', '=', account.id)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('market_bookings')
            .select('market_bookings.id')
            .whereRef('market_bookings.tutor_account_id', '=', 'market_message_threads.tutor_account_id')
            .where('market_bookings.child_id', '=', childId),
        ),
      )
      .orderBy('market_message_threads.last_message_at', 'desc')
      .execute();
    const messages =
      threads.length === 0
        ? []
        : await database
            .selectFrom('market_messages')
            .select(['thread_id', 'role', 'body', 'created_at'])
            .where(
              'thread_id',
              'in',
              threads.map((thread) => thread.id),
            )
            .orderBy('created_at')
            .execute();
    await this.market.audit({
      actorType: 'account',
      actorId: account.id,
      action: 'child.read-messages',
      target: childId,
    });
    return {
      child_name: child.display_name,
      threads: threads.map((thread) => ({
        ...thread,
        messages: messages.filter((message) => message.thread_id === thread.id),
      })),
    };
  }
}

@Controller('market')
@PublicEndpoint()
export class MarketReviewsController {
  constructor(private readonly reviews: MarketReviewsService) {}

  @Post('bookings/:id/review')
  create(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.reviews.create(request, id, body);
  }

  @Get('bookings/:id/review')
  mine(@Req() request: Request, @Param('id') id: string) {
    return this.reviews.mine(request, id);
  }

  @Get('public/reviews/:tutorId')
  publicReviews(@Req() request: Request, @Param('tutorId') tutorId: string) {
    return this.reviews.publicReviews(request, tutorId);
  }

  @Get('tutor/reviews')
  tutorReviews(@Req() request: Request) {
    return this.reviews.tutorReviews(request);
  }

  @Post('tutor/reviews/:id/reply')
  @HttpCode(200)
  reply(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.reviews.reply(request, id, body);
  }

  @Get('admin/reviews-moderation')
  pending(@Req() request: Request) {
    return this.reviews.pending(request);
  }

  @Post('admin/reviews-moderation/:id')
  @HttpCode(200)
  decide(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.reviews.decide(request, id, body);
  }

  @Post('children/:id/reads-messages')
  @HttpCode(200)
  setChildReads(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.reviews.setChildReads(request, id, body);
  }

  @Get('children/:id/messages')
  childMessages(@Req() request: Request, @Param('id') id: string) {
    return this.reviews.childMessages(request, id);
  }
}
