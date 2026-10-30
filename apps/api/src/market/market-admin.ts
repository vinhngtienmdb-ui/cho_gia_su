import { Body, Controller, Get, Injectable, Post, Put, Req } from '@nestjs/common';
import {
  MarketSettingsError,
  parseMarketSettings,
  roomTimingsJson,
  saveMarketSettings,
  type MarketLegalDocumentKind,
  type MarketSettings,
} from '@cho-gia-su/database';
import { validationError, type FieldError } from '../common/server.js';
import type { Request } from 'express';
import { sql } from 'kysely';
import { PublicEndpoint } from '../common/public-endpoint.js';
import type { RequestBody } from '../common/request-fields.js';
import { DOCUMENT_KIND_LABELS } from './market-accounts.js';
import { MarketContext } from './market-context.js';
import { operatorRolesFor } from '../common/shared.js';

// Cấu hình chợ ở ứng dụng quản trị (DT-27 phần 27f, YCTD-256; tách sản phẩm ở YCTD-393): hạn giữ bản ghi, hạn khiếu nại, tỷ lệ hoa
// hồng mặc định (dữ liệu cho 27h), đăng phiên bản mới của văn bản pháp lý, số liệu tổng. Cần mã phiên quản trị. Thu tiền thật không bật
// được (packages/database/src/settings.ts)
function view(settings: MarketSettings) {
  return {
    record_retention_days: settings.recordRetentionDays,
    complaint_window_hours: settings.complaintWindowHours,
    default_commission_percent: settings.defaultCommissionPercent,
    real_payments_enabled: settings.realPaymentsEnabled,
    // Mốc phòng học video (YCTD-362)
    ...roomTimingsJson(settings.room),
    // Hạn dùng gói buổi (YCTD-365)
    package_valid_days: settings.packageValidDays,
  };
}

@Injectable()
export class MarketAdminService {
  constructor(private readonly market: MarketContext) {}

  async overview(request: Request) {
    await this.market.operator(request, operatorRolesFor('market.view'));
    const database = this.market.database;
    const [settings, documents, accounts, children] = await Promise.all([
      this.market.settings(),
      database
        .selectFrom('market_legal_documents')
        .select(['id', 'kind', 'version', 'title', 'published_at'])
        .orderBy('kind')
        .orderBy('version', 'desc')
        .execute(),
      database
        .selectFrom('market_accounts')
        .select(['kind', 'status', sql<string>`count(*)`.as('count')])
        .groupBy(['kind', 'status'])
        .execute(),
      database
        .selectFrom('market_children')
        .select(sql<string>`count(*)`.as('count'))
        .executeTakeFirstOrThrow(),
    ]);
    return {
      settings: view(settings),
      documents,
      document_kinds: DOCUMENT_KIND_LABELS,
      accounts: accounts.map((row) => ({ kind: row.kind, status: row.status, count: Number(row.count) })),
      children: Number(children.count),
    };
  }

  async saveSettings(request: Request, body: RequestBody) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.settings'));
    let settings: MarketSettings;
    try {
      settings = parseMarketSettings(body ?? undefined);
    } catch (error) {
      if (error instanceof MarketSettingsError) {
        throw validationError([{ field: error.field, message: error.message }]);
      }
      throw error;
    }
    await saveMarketSettings(this.market.database, settings, operatorId);
    return this.overview(request);
  }

  // Đăng phiên bản mới (số phiên bản tăng một); phiên bản đã đăng không sửa, không xóa
  async publish(request: Request, body: RequestBody) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.settings'));
    const errors: FieldError[] = [];
    const kind = body?.kind;
    if (typeof kind !== 'string' || !(kind in DOCUMENT_KIND_LABELS)) {
      errors.push({ field: 'kind', message: 'Chọn loại văn bản' });
    }
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const content = typeof body?.body === 'string' ? body.body.trim() : '';
    if (title.length < 1 || title.length > 200) errors.push({ field: 'title', message: 'Tiêu đề từ 1 đến 200 ký tự' });
    if (content.length < 1 || content.length > 100_000) {
      errors.push({ field: 'body', message: 'Nội dung từ 1 đến 100 000 ký tự' });
    }
    if (errors.length > 0) throw validationError(errors);
    const document = await this.market.database.transaction().execute(async (trx) => {
      const last = await trx
        .selectFrom('market_legal_documents')
        .select('version')
        .where('kind', '=', kind as MarketLegalDocumentKind)
        .orderBy('version', 'desc')
        .forUpdate()
        .executeTakeFirst();
      return trx
        .insertInto('market_legal_documents')
        .values({
          kind: kind as MarketLegalDocumentKind,
          version: (last?.version ?? 0) + 1,
          title,
          body: content,
          published_by: operatorId,
        })
        .returning(['id', 'kind', 'version', 'title', 'published_at'])
        .executeTakeFirstOrThrow();
    });
    await this.market.audit({
      actorType: 'operator',
      actorId: operatorId,
      action: 'document.publish',
      target: document.id,
      details: { kind: document.kind, version: document.version },
    });
    return document;
  }
}

@Controller('market/admin')
@PublicEndpoint()
export class MarketAdminController {
  constructor(private readonly admin: MarketAdminService) {}

  @Get()
  overview(@Req() request: Request) {
    return this.admin.overview(request);
  }

  @Put('settings')
  saveSettings(@Req() request: Request, @Body() body: RequestBody) {
    return this.admin.saveSettings(request, body);
  }

  @Post('documents')
  publish(@Req() request: Request, @Body() body: RequestBody) {
    return this.admin.publish(request, body);
  }
}
