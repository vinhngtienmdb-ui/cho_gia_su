import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Req } from '@nestjs/common';
import { validationError, type FieldError } from '../common/server.js';
import type { Request } from 'express';
import { PublicEndpoint } from '../common/public-endpoint.js';
import type { RequestBody } from '../common/request-fields.js';
import { MarketBookingsService } from './market-bookings.js';
import { MarketContext, marketNotFound } from './market-context.js';
import { operatorRolesFor } from '../common/shared.js';

// Thanh toán, tranh chấp, quy tắc hoa hồng ở cổng nền tảng (DT-27 phần 27h, YCTD-258): danh sách buổi và tiền, tranh chấp chờ quyết
// định, quyết định có lý do (khiếu nại lại do nhân viên khác xét), quy tắc hoa hồng là dữ liệu có ngày hiệu lực (tỷ lệ thật Eric chốt,
// E-01), chạy ngay việc định kỳ (nhả chỗ, giải ngân, chốt quyết định). Mã phiên vận hành, tên miền cổng nền tảng
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class MarketPaymentsAdminService {
  constructor(
    private readonly market: MarketContext,
    private readonly bookings: MarketBookingsService,
  ) {}

  async overview(request: Request) {
    await this.market.operator(request, operatorRolesFor('market.payments'));
    const database = this.market.database;
    const [bookings, disputes, rules] = await Promise.all([
      database
        .selectFrom('market_bookings')
        .innerJoin('market_accounts as tutor', 'tutor.id', 'market_bookings.tutor_account_id')
        .leftJoin('market_payments', 'market_payments.booking_id', 'market_bookings.id')
        .select([
          'market_bookings.id',
          'market_bookings.child_name',
          'market_bookings.subject',
          'market_bookings.starts_at',
          'market_bookings.price',
          'market_bookings.commission',
          'market_bookings.status',
          'tutor.display_name as tutor_name',
          'market_payments.provider',
          'market_payments.status as payment_status',
          'market_payments.refunded_amount',
          'market_payments.released_amount',
          'market_payments.commission_taken',
        ])
        .orderBy('market_bookings.created_at', 'desc')
        .limit(100)
        .execute(),
      database
        .selectFrom('market_disputes')
        .innerJoin('market_bookings', 'market_bookings.id', 'market_disputes.booking_id')
        .select([
          'market_disputes.booking_id',
          'market_disputes.status',
          'market_disputes.reason',
          'market_disputes.decided_by',
          'market_disputes.created_at',
          'market_bookings.subject',
          'market_bookings.child_name',
          'market_bookings.price',
        ])
        .where('market_disputes.status', 'in', ['open', 'appealed', 'decided'])
        .orderBy('market_disputes.created_at')
        .execute(),
      database
        .selectFrom('market_commission_rules')
        .leftJoin('market_accounts', 'market_accounts.id', 'market_commission_rules.tutor_account_id')
        .select([
          'market_commission_rules.id',
          'market_commission_rules.content_kind',
          'market_commission_rules.tutor_account_id',
          'market_accounts.display_name as tutor_name',
          'market_commission_rules.percent',
          'market_commission_rules.minimum',
          'market_commission_rules.effective_from',
        ])
        .orderBy('market_commission_rules.effective_from', 'desc')
        .execute(),
    ]);
    return {
      bookings,
      disputes,
      commission_rules: rules.map((rule) => ({ ...rule, percent: Number(rule.percent) })),
    };
  }

  async dispute(request: Request, id: string) {
    await this.market.operator(request, operatorRolesFor('market.payments'));
    if (!UUID.test(id)) throw marketNotFound();
    return this.bookings.disputeView(id);
  }

  async decide(request: Request, id: string, body: RequestBody) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.payments'));
    return this.bookings.decide(operatorId, id, body);
  }

  // Chốt ngay quyết định lần đầu (hai bên không khiếu nại lại) để chuyển tiền trước hạn 7 ngày
  async finalize(request: Request, id: string) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.payments'));
    if (!UUID.test(id)) throw marketNotFound();
    await this.bookings.finalizeDecided(operatorId, id);
    return this.bookings.disputeView(id);
  }

  async addRule(request: Request, body: RequestBody) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.payments'));
    const errors: FieldError[] = [];
    const kind = body?.content_kind ?? null;
    if (kind !== null && kind !== 'curriculum' && kind !== 'enrichment') {
      errors.push({ field: 'content_kind', message: 'Loại nội dung là curriculum, enrichment hoặc để trống' });
    }
    const tutorId = body?.tutor_account_id ?? null;
    if (tutorId !== null && (typeof tutorId !== 'string' || !UUID.test(tutorId))) {
      errors.push({ field: 'tutor_account_id', message: 'Mã gia sư không hợp lệ' });
    }
    const percent = body?.percent;
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 50) {
      errors.push({ field: 'percent', message: 'Tỷ lệ từ 0 đến 50 phần trăm' });
    }
    const minimum = body?.minimum ?? 0;
    if (typeof minimum !== 'number' || !Number.isInteger(minimum) || minimum < 0 || minimum > 10_000_000) {
      errors.push({ field: 'minimum', message: 'Mức tối thiểu là số nguyên đồng từ 0' });
    }
    const effectiveFrom = typeof body?.effective_from === 'string' ? body.effective_from : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      errors.push({ field: 'effective_from', message: 'Ngày hiệu lực dạng năm-tháng-ngày' });
    }
    if (errors.length > 0) throw validationError(errors);
    await this.market.database
      .insertInto('market_commission_rules')
      .values({
        content_kind: kind as 'curriculum' | 'enrichment' | null,
        tutor_account_id: tutorId as string | null,
        percent: Math.round((percent as number) * 100) / 100,
        minimum: minimum as number,
        effective_from: effectiveFrom,
        created_by: operatorId,
      })
      .execute();
    await this.market.audit({
      actorType: 'operator',
      actorId: operatorId,
      action: 'commission-rule.add',
      details: { content_kind: kind, tutor_account_id: tutorId, percent, minimum, effective_from: effectiveFrom },
    });
    return this.overview(request);
  }

  async runDue(request: Request) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.payments'));
    const result = await this.bookings.runDue();
    await this.market.audit({ actorType: 'operator', actorId: operatorId, action: 'jobs.run', details: result });
    return result;
  }
}

@Controller('market/admin/payments')
@PublicEndpoint()
export class MarketPaymentsAdminController {
  constructor(private readonly payments: MarketPaymentsAdminService) {}

  @Get()
  overview(@Req() request: Request) {
    return this.payments.overview(request);
  }

  @Get('disputes/:id')
  dispute(@Req() request: Request, @Param('id') id: string) {
    return this.payments.dispute(request, id);
  }

  @Post('disputes/:id/decide')
  @HttpCode(200)
  decide(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.payments.decide(request, id, body);
  }

  @Post('disputes/:id/finalize')
  @HttpCode(200)
  finalize(@Req() request: Request, @Param('id') id: string) {
    return this.payments.finalize(request, id);
  }

  @Post('commission-rules')
  @HttpCode(200)
  addRule(@Req() request: Request, @Body() body: RequestBody) {
    return this.payments.addRule(request, body);
  }

  @Post('run-due')
  @HttpCode(200)
  runDue(@Req() request: Request) {
    return this.payments.runDue(request);
  }
}
