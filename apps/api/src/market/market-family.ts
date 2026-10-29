import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, Put, Req } from '@nestjs/common';
import type { MarketSchoolLevel } from '@cho-gia-su/database';
import { ApplicationError, validationError, type FieldError } from '../common/server.js';
import type { Request } from 'express';
import { PublicEndpoint } from '../common/public-endpoint.js';
import type { RequestBody } from '../common/request-fields.js';
import { MarketAccountsService } from './market-accounts.js';
import { MarketContext, marketNotFound } from './market-context.js';

// Hồ sơ con do phụ huynh tạo ở chợ gia sư (DT-27 phần 27f, YCTD-256; tài liệu 47 mục 19.3 "trẻ em trước", GD-135). Claude tự chọn theo
// ủy quyền của Eric ngày 2026-10-11:
// - chỉ tên hiển thị (không cần tên thật), năm sinh, cấp học, lớp; không có số định danh, ảnh, ngày sinh đầy đủ;
// - tạo hồ sơ con cần đồng ý phiên bản mới nhất của "Đồng ý của cha mẹ cho hồ sơ con" (ghi theo từng con); rút đồng ý thì hồ sơ con
//   bị khóa dùng (27h không đặt buổi được) đến khi đồng ý lại, xóa hồ sơ thì xóa luôn đồng ý;
// - Tiểu học chỉ lớp 1 đến 5, Trung học cơ sở 6 đến 9, Trung học phổ thông 10 đến 12 (chặn dạy thêm `curriculum` cho Tiểu học ở 27h
//   dựa vào cấp này);
// - bản tách khỏi School Management (YCTD-384) bỏ liên kết hồ sơ con với trường: chợ không liên hệ với hệ thống trường
const LEVEL_GRADES: Record<MarketSchoolLevel, [number, number]> = { TH: [1, 5], THCS: [6, 9], THPT: [10, 12] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ChildInput {
  display_name: string;
  birth_year: number;
  school_level: MarketSchoolLevel;
  grade: number;
}

export function parseChild(body: RequestBody, year: number): ChildInput {
  const errors: FieldError[] = [];
  const name = typeof body?.display_name === 'string' ? body.display_name.trim() : '';
  if (name.length < 1 || name.length > 40) {
    errors.push({ field: 'display_name', message: 'Tên hiển thị của con từ 1 đến 40 ký tự (không cần tên thật)' });
  }
  const birthYear = body?.birth_year;
  if (typeof birthYear !== 'number' || !Number.isInteger(birthYear) || birthYear < year - 19 || birthYear > year - 5) {
    errors.push({ field: 'birth_year', message: `Năm sinh từ ${year - 19} đến ${year - 5}` });
  }
  const level = body?.school_level;
  if (level !== 'TH' && level !== 'THCS' && level !== 'THPT') {
    errors.push({ field: 'school_level', message: 'Chọn cấp học' });
  }
  const grade = body?.grade;
  const range = LEVEL_GRADES[level as MarketSchoolLevel];
  if (typeof grade !== 'number' || !Number.isInteger(grade) || !range || grade < range[0] || grade > range[1]) {
    errors.push({ field: 'grade', message: range ? `Lớp từ ${range[0]} đến ${range[1]}` : 'Chọn lớp' });
  }
  if (errors.length > 0) {
    throw validationError(errors);
  }
  return {
    display_name: name,
    birth_year: birthYear as number,
    school_level: level as MarketSchoolLevel,
    grade: grade as number,
  };
}

@Injectable()
export class MarketFamilyService {
  constructor(
    private readonly market: MarketContext,
    private readonly accounts: MarketAccountsService,
  ) {}

  private async latestParentConsent() {
    return this.market.database
      .selectFrom('market_legal_documents')
      .select(['id', 'version', 'title'])
      .where('kind', '=', 'parent_consent')
      .orderBy('version', 'desc')
      .executeTakeFirst();
  }

  async list(request: Request) {
    const account = await this.accounts.requireReady(request, 'parent');
    const database = this.market.database;
    const children = await database
      .selectFrom('market_children')
      .select(['id', 'display_name', 'birth_year', 'school_level', 'grade', 'reads_messages', 'created_at'])
      .where('parent_account_id', '=', account.id)
      .orderBy('created_at')
      .execute();
    const ids = children.map((child) => child.id);
    const consent = await this.latestParentConsent();
    const consents = ids.length
      ? await database
          .selectFrom('market_consents')
          .select(['child_id', 'document_id'])
          .where('child_id', 'in', ids)
          .where('withdrawn_at', 'is', null)
          .execute()
      : [];
    return {
      parent_consent: consent ?? null,
      children: children.map((child) => ({
        ...child,
        consent_current: Boolean(
          consent && consents.some((row) => row.child_id === child.id && row.document_id === consent.id),
        ),
      })),
    };
  }

  private async ownChild(accountId: string, childId: string) {
    const row = UUID.test(childId)
      ? await this.market.database
          .selectFrom('market_children')
          .select(['id', 'school_level', 'grade'])
          .where('id', '=', childId)
          .where('parent_account_id', '=', accountId)
          .executeTakeFirst()
      : undefined;
    if (!row) {
      throw marketNotFound();
    }
    return row;
  }

  private async requireConsentDocument(body: RequestBody) {
    const consent = await this.latestParentConsent();
    if (!consent) {
      throw new ApplicationError('ERR_CONFLICT', 'Chợ chưa đăng văn bản đồng ý của cha mẹ, chưa tạo được hồ sơ con');
    }
    if (body?.consent_document_id !== consent.id) {
      throw validationError([
        { field: 'consent_document_id', message: `Cần đồng ý: ${consent.title} (phiên bản ${consent.version})` },
      ]);
    }
    return consent;
  }

  async create(request: Request, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'parent');
    const input = parseChild(body, this.market.now().getFullYear());
    const consent = await this.requireConsentDocument(body);
    const child = await this.market.database.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('market_children')
        .values({ parent_account_id: account.id, ...input })
        .returning(['id', 'display_name', 'birth_year', 'school_level', 'grade'])
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('market_consents')
        .values({ account_id: account.id, document_id: consent.id, child_id: row.id })
        .execute();
      return row;
    });
    await this.market.audit({
      actorType: 'account',
      actorId: account.id,
      action: 'child.create',
      target: child.id,
      details: { consent: `parent_consent@${consent.version}` },
    });
    return child;
  }

  async update(request: Request, childId: string, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'parent');
    await this.ownChild(account.id, childId);
    const input = parseChild(body, this.market.now().getFullYear());
    return this.market.database
      .updateTable('market_children')
      .set({ ...input, updated_at: this.market.now() })
      .where('id', '=', childId)
      .returning(['id', 'display_name', 'birth_year', 'school_level', 'grade'])
      .executeTakeFirstOrThrow();
  }

  async remove(request: Request, childId: string) {
    const account = await this.accounts.requireReady(request, 'parent');
    await this.ownChild(account.id, childId);
    await this.market.database.deleteFrom('market_children').where('id', '=', childId).execute();
    await this.market.audit({ actorType: 'account', actorId: account.id, action: 'child.delete', target: childId });
  }

  // Đồng ý lại (sau khi rút, hoặc khi có phiên bản mới) và rút đồng ý cho một con
  async consent(request: Request, childId: string, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'parent');
    await this.ownChild(account.id, childId);
    const consent = await this.requireConsentDocument(body);
    await this.market.database
      .insertInto('market_consents')
      .values({ account_id: account.id, document_id: consent.id, child_id: childId })
      .execute();
    await this.market.audit({ actorType: 'account', actorId: account.id, action: 'child.consent', target: childId });
    return { consent_current: true };
  }

  async withdraw(request: Request, childId: string) {
    const account = await this.accounts.requireReady(request, 'parent');
    await this.ownChild(account.id, childId);
    await this.market.database
      .updateTable('market_consents')
      .set({ withdrawn_at: this.market.now() })
      .where('child_id', '=', childId)
      .where('withdrawn_at', 'is', null)
      .execute();
    await this.market.audit({
      actorType: 'account',
      actorId: account.id,
      action: 'child.consent-withdraw',
      target: childId,
    });
    return { consent_current: false };
  }
}

@Controller('market/children')
@PublicEndpoint()
export class MarketChildrenController {
  constructor(private readonly family: MarketFamilyService) {}

  @Get()
  list(@Req() request: Request) {
    return this.family.list(request);
  }

  @Post()
  create(@Req() request: Request, @Body() body: RequestBody) {
    return this.family.create(request, body);
  }

  @Put(':id')
  update(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.family.update(request, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() request: Request, @Param('id') id: string) {
    return this.family.remove(request, id);
  }

  @Post(':id/consent')
  @HttpCode(200)
  consent(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.family.consent(request, id, body);
  }

  @Post(':id/consent/withdraw')
  @HttpCode(200)
  withdraw(@Req() request: Request, @Param('id') id: string) {
    return this.family.withdraw(request, id);
  }
}
