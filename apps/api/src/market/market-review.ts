import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Req, Res } from '@nestjs/common';
import { ApplicationError, validationError } from '../common/server.js';
import type { Request, Response } from 'express';
import { sendStoredFile } from '../common/content-files.js';
import { PublicEndpoint } from '../common/public-endpoint.js';
import { API_CONFIGURATION, type ApiConfiguration } from '../common/configuration.js';
import type { RequestBody } from '../common/request-fields.js';
import { FileStorage } from '../common/file-storage.js';
import { MarketContext, marketNotFound } from './market-context.js';
import { decryptFile, marketStorage } from './market-files.js';
import { readListing, readVerifications, vietnamToday } from './market-listing.js';
import {
  addMonths,
  approvalBlockers,
  CRIMINAL_RECORD_VALID_MONTHS,
  verificationState,
  type VerificationKind,
  type VerificationRow,
} from './market-tutor-rules.js';
import { operatorRolesFor } from '../common/shared.js';

// Hàng chờ duyệt gia sư của nhân viên nền tảng (DT-27 phần 27g, YCTD-257; tài liệu 47 mục 19.5 "hàng chờ duyệt của nhân viên nền tảng có
// nhật ký; tệp giấy tờ lưu mã hóa, chỉ nhân viên duyệt xem"). Ở cổng nền tảng, mã phiên vận hành. Mỗi lần xem tệp, mỗi quyết định ghi nhật
// ký của chợ. Duyệt hồ sơ chỉ khi đủ điều kiện hiện công khai (danh tính, lý lịch tư pháp còn hiệu lực, đăng ký kinh doanh nếu có môn
// `curriculum`); từ chối phải có lý do
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVIEWED_KINDS = new Set<VerificationKind>(['degree', 'criminal_record', 'business_registration']);

function decisionOf(body: RequestBody): { approve: boolean; note: string | null } {
  const decision = body?.decision;
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if (decision !== 'approve' && decision !== 'reject') {
    throw validationError([{ field: 'decision', message: 'Chọn duyệt hoặc từ chối' }]);
  }
  if (decision === 'reject' && (note.length < 1 || note.length > 1000)) {
    throw validationError([{ field: 'note', message: 'Từ chối cần lý do (tối đa 1000 ký tự)' }]);
  }
  return { approve: decision === 'approve', note: note || null };
}

@Injectable()
export class MarketReviewService {
  constructor(
    private readonly market: MarketContext,
    private readonly files: FileStorage,
    @Inject(API_CONFIGURATION) private readonly configuration: ApiConfiguration,
  ) {}

  async queue(request: Request) {
    await this.market.operator(request, operatorRolesFor('market.review'));
    const database = this.market.database;
    const [profiles, verifications] = await Promise.all([
      database
        .selectFrom('market_tutor_profiles')
        .innerJoin('market_accounts', 'market_accounts.id', 'market_tutor_profiles.account_id')
        .select(['market_accounts.id', 'market_accounts.display_name', 'market_tutor_profiles.updated_at'])
        .where('market_tutor_profiles.status', '=', 'submitted')
        .orderBy('market_tutor_profiles.updated_at')
        .execute(),
      database
        .selectFrom('market_tutor_verifications')
        .innerJoin('market_accounts', 'market_accounts.id', 'market_tutor_verifications.account_id')
        .select([
          'market_accounts.id',
          'market_accounts.display_name',
          'market_tutor_verifications.kind',
          'market_tutor_verifications.submitted_at',
        ])
        .where('market_tutor_verifications.status', '=', 'pending')
        .orderBy('market_tutor_verifications.submitted_at')
        .execute(),
    ]);
    return { profiles, verifications };
  }

  private async tutorId(id: string): Promise<string> {
    const row = UUID.test(id)
      ? await this.market.database
          .selectFrom('market_accounts')
          .select('id')
          .where('id', '=', id)
          .where('kind', '=', 'tutor')
          .executeTakeFirst()
      : undefined;
    if (!row) throw marketNotFound();
    return row.id;
  }

  async tutor(request: Request, id: string) {
    await this.market.operator(request, operatorRolesFor('market.review'));
    const accountId = await this.tutorId(id);
    const database = this.market.database;
    const [account, profile, listing, verifications, documents, schoolRole, provider] = await Promise.all([
      database
        .selectFrom('market_accounts')
        .select(['display_name', 'status', 'created_at'])
        .where('id', '=', accountId)
        .executeTakeFirstOrThrow(),
      database
        .selectFrom('market_tutor_profiles')
        .select(['headline', 'bio', 'review_note', 'reviewed_at'])
        .where('account_id', '=', accountId)
        .executeTakeFirst(),
      readListing(database, accountId),
      readVerifications(database, accountId),
      database
        .selectFrom('market_tutor_documents')
        .select(['id', 'kind', 'file_name', 'content_type', 'size_bytes', 'uploaded_at'])
        .where('account_id', '=', accountId)
        .execute(),
      database
        .selectFrom('market_tutor_school_roles')
        .select(['school_name', 'is_public', 'subjects', 'grades', 'form03_generated_at'])
        .where('account_id', '=', accountId)
        .executeTakeFirst(),
      database
        .selectFrom('market_providers')
        .select(['kind', 'name', 'business_registration_no'])
        .where('owner_account_id', '=', accountId)
        .executeTakeFirst(),
    ]);
    const state = verificationState(verifications as VerificationRow[], vietnamToday(this.market.now()));
    return {
      id: accountId,
      ...account,
      profile: profile ?? null,
      listing,
      verifications,
      verification_state: state,
      documents,
      school_role: schoolRole ?? null,
      provider: provider ?? null,
      approval_blockers: approvalBlockers(listing, state),
    };
  }

  async document(request: Request, id: string, response: Response) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.review'));
    const key = this.configuration.marketFilesKey;
    const row = UUID.test(id)
      ? await this.market.database
          .selectFrom('market_tutor_documents')
          .select(['id', 'account_id', 'kind', 'file_key', 'file_name', 'content_type'])
          .where('id', '=', id)
          .executeTakeFirst()
      : undefined;
    if (!row || !key) throw marketNotFound();
    const body = decryptFile(key, await marketStorage(this.files).get(row.file_key));
    await this.market.audit({
      actorType: 'operator',
      actorId: operatorId,
      action: 'document.view',
      target: row.id,
      details: { account_id: row.account_id, kind: row.kind },
    });
    sendStoredFile(response, row, body);
  }

  async decideVerification(request: Request, id: string, kindInput: string, body: RequestBody) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.review'));
    const accountId = await this.tutorId(id);
    const kind = kindInput as VerificationKind;
    if (!REVIEWED_KINDS.has(kind)) throw marketNotFound();
    const { approve, note } = decisionOf(body);
    const now = this.market.now();
    const today = vietnamToday(now);
    const updated = await this.market.database
      .updateTable('market_tutor_verifications')
      .set({
        status: approve ? 'approved' : 'rejected',
        decided_at: now,
        decided_by: operatorId,
        note,
        valid_until: approve && kind === 'criminal_record' ? addMonths(today, CRIMINAL_RECORD_VALID_MONTHS) : null,
      })
      .where('account_id', '=', accountId)
      .where('kind', '=', kind)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 0) {
      throw new ApplicationError('ERR_CONFLICT', 'Không có giấy tờ đang chờ duyệt ở bậc này');
    }
    await this.market.audit({
      actorType: 'operator',
      actorId: operatorId,
      action: approve ? 'verification.approve' : 'verification.reject',
      target: accountId,
      details: { kind, note },
    });
    return this.tutor(request, accountId);
  }

  async decideProfile(request: Request, id: string, body: RequestBody) {
    const operatorId = await this.market.operator(request, operatorRolesFor('market.review'));
    const accountId = await this.tutorId(id);
    const { approve, note } = decisionOf(body);
    const database = this.market.database;
    const listing = await readListing(database, accountId);
    if (listing.status !== 'submitted') {
      throw new ApplicationError('ERR_CONFLICT', 'Hồ sơ không ở trạng thái chờ duyệt');
    }
    if (approve) {
      const state = verificationState(
        (await readVerifications(database, accountId)) as VerificationRow[],
        vietnamToday(this.market.now()),
      );
      const blockers = approvalBlockers(listing, state);
      if (blockers.length > 0) {
        throw new ApplicationError('ERR_CONFLICT', blockers.join('; '));
      }
    }
    const now = this.market.now();
    await database
      .updateTable('market_tutor_profiles')
      .set({
        status: approve ? 'approved' : 'rejected',
        review_note: note,
        reviewed_at: now,
        reviewed_by: operatorId,
        ...(approve ? { published_at: now } : {}),
      })
      .where('account_id', '=', accountId)
      .execute();
    await this.market.audit({
      actorType: 'operator',
      actorId: operatorId,
      action: approve ? 'profile.approve' : 'profile.reject',
      target: accountId,
      details: { note },
    });
    return this.tutor(request, accountId);
  }
}

@Controller('market/admin/reviews')
@PublicEndpoint()
export class MarketReviewController {
  constructor(private readonly reviews: MarketReviewService) {}

  @Get()
  queue(@Req() request: Request) {
    return this.reviews.queue(request);
  }

  @Get('tutors/:id')
  tutor(@Req() request: Request, @Param('id') id: string) {
    return this.reviews.tutor(request, id);
  }

  @Get('documents/:id')
  async document(@Req() request: Request, @Param('id') id: string, @Res() response: Response) {
    await this.reviews.document(request, id, response);
  }

  @Post('tutors/:id/profile')
  @HttpCode(200)
  decideProfile(@Req() request: Request, @Param('id') id: string, @Body() body: RequestBody) {
    return this.reviews.decideProfile(request, id, body);
  }

  @Post('tutors/:id/verifications/:kind')
  @HttpCode(200)
  decideVerification(
    @Req() request: Request,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() body: RequestBody,
  ) {
    return this.reviews.decideVerification(request, id, kind, body);
  }
}
