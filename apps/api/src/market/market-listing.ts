import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MarketplaceDatabase } from '@cho-gia-su/database';
import { ApplicationError, validationError, type FieldError } from '../common/server.js';
import type { Request } from 'express';
import type { Kysely } from 'kysely';
import { decodeFileName, type UploadedPart } from '../common/content-files.js';
import { PublicEndpoint } from '../common/public-endpoint.js';
import { API_CONFIGURATION, type ApiConfiguration } from '../common/configuration.js';
import type { RequestBody } from '../common/request-fields.js';
import { FileStorage } from '../common/file-storage.js';
import { MarketAccountsService } from './market-accounts.js';
import { MarketContext, marketNotFound } from './market-context.js';
import { encryptFile, hasMarketStorage, marketFileKey, marketStorage } from './market-files.js';
import {
  badgesOf,
  criminalRecordIssueProblem,
  parseListing,
  submitBlockers,
  verificationState,
  type ListingInput,
  type VerificationKind,
  type VerificationRow,
} from './market-tutor-rules.js';

// Hồ sơ dạy, xác minh từng bậc, khai giáo viên đang dạy ở trường và báo cáo Mẫu 03 của gia sư (DT-27 phần 27g, YCTD-257; tài liệu 47 mục
// 19.5). Chỉ ở ứng dụng Gia sư. Claude tự chọn theo ủy quyền của Eric ngày 2026-10-11 (quy tắc ở market-tutor-rules.ts):
// - lưu hồ sơ đã duyệt thì hồ sơ về chờ duyệt (ẩn khỏi tìm kiếm đến khi duyệt lại) để giá, môn hiện công khai luôn đã qua duyệt;
// - nộp giấy tờ: bằng cấp (tên văn bằng, nơi cấp), phiếu lý lịch tư pháp (ngày cấp trong 6 tháng), đăng ký kinh doanh (số đăng ký); tệp
//   PDF, JPEG, PNG tối đa 10 MB, mã hóa trước khi vào kho tệp; nộp lại thì thay bản cũ và về chờ duyệt;
// - giáo viên đang dạy ở trường khai tên trường, công lập hay không, môn, lớp đang dạy (chợ không đọc dữ liệu trường; liên kết tài
//   khoản trường để hiện "đã xác minh" làm sau); báo cáo Mẫu 03 là bản để giáo viên nộp Hiệu trưởng trước khi bắt đầu dạy
const MAXIMUM_FILE_BYTES = 10 * 1024 * 1024;
const DOCUMENT_KINDS = new Set<VerificationKind>(['degree', 'criminal_record', 'business_registration']);

type Database = Kysely<MarketplaceDatabase>;

// Nhận diện định dạng theo các byte đầu, không tin phần mở rộng, không tin loại do trình duyệt khai
export function documentTypeOf(body: Buffer): string | null {
  if (body.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

export function vietnamToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
}

export async function readListing(database: Database, accountId: string): Promise<ListingInput & { status: string }> {
  const [profile, subjects, availability] = await Promise.all([
    database
      .selectFrom('market_tutor_profiles')
      .select(['status', 'teaching_language'])
      .where('account_id', '=', accountId)
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
        'package_sessions',
        'package_price',
      ])
      .where('account_id', '=', accountId)
      .orderBy('created_at')
      .execute(),
    database
      .selectFrom('market_tutor_availability')
      .select(['weekday', 'start_minute', 'end_minute'])
      .where('account_id', '=', accountId)
      .orderBy('weekday')
      .orderBy('start_minute')
      .execute(),
  ]);
  return {
    status: profile?.status ?? 'draft',
    teaching_language: profile?.teaching_language ?? 'Tiếng Việt',
    subjects,
    availability,
  };
}

export async function readVerifications(database: Database, accountId: string) {
  return database
    .selectFrom('market_tutor_verifications')
    .select(['kind', 'status', 'details', 'note', 'valid_until', 'submitted_at', 'decided_at', 'document_id'])
    .where('account_id', '=', accountId)
    .execute();
}

@Injectable()
export class MarketListingService {
  constructor(
    private readonly market: MarketContext,
    private readonly accounts: MarketAccountsService,
    private readonly files: FileStorage,
    @Inject(API_CONFIGURATION) private readonly configuration: ApiConfiguration,
  ) {}

  private async schoolRole(accountId: string) {
    return this.market.database
      .selectFrom('market_tutor_school_roles')
      .select(['school_name', 'is_public', 'subjects', 'grades', 'declared_at', 'form03_generated_at'])
      .where('account_id', '=', accountId)
      .executeTakeFirst();
  }

  async view(request: Request) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const database = this.market.database;
    const [listing, verifications, schoolRole, profile] = await Promise.all([
      readListing(database, account.id),
      readVerifications(database, account.id),
      this.schoolRole(account.id),
      database
        .selectFrom('market_tutor_profiles')
        .select(['review_note', 'reviewed_at', 'published_at'])
        .where('account_id', '=', account.id)
        .executeTakeFirst(),
    ]);
    const state = verificationState(verifications as VerificationRow[], vietnamToday(this.market.now()));
    return {
      ...listing,
      review_note: profile?.review_note ?? null,
      published_at: profile?.published_at ?? null,
      verifications: Object.fromEntries(
        verifications.map((row) => [
          row.kind,
          { status: state[row.kind], note: row.note, valid_until: row.valid_until, submitted_at: row.submitted_at },
        ]),
      ),
      verification_state: state,
      badges: badgesOf(state, Boolean(schoolRole)),
      school_role: schoolRole ?? null,
      submit_blockers: submitBlockers(listing, state),
      uploads_enabled: Boolean(this.configuration.marketFilesKey) && hasMarketStorage(this.files),
    };
  }

  async save(request: Request, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const role = await this.schoolRole(account.id);
    const { listing, errors } = parseListing(body ?? undefined, role?.is_public === true);
    if (errors.length > 0) {
      throw validationError(errors);
    }
    const now = this.market.now();
    await this.market.database.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('market_tutor_profiles')
        .select('status')
        .where('account_id', '=', account.id)
        .forUpdate()
        .executeTakeFirst();
      // Sửa hồ sơ đã duyệt hoặc bị từ chối: về chờ duyệt (đã duyệt) hoặc nháp (bị từ chối) để không hiện giá, môn chưa duyệt
      const status =
        current?.status === 'approved'
          ? 'submitted'
          : current?.status === 'rejected'
            ? 'draft'
            : (current?.status ?? 'draft');
      await trx
        .insertInto('market_tutor_profiles')
        .values({ account_id: account.id, teaching_language: listing.teaching_language, status, updated_at: now })
        .onConflict((conflict) =>
          conflict
            .column('account_id')
            .doUpdateSet({ teaching_language: listing.teaching_language, status, updated_at: now }),
        )
        .execute();
      await trx.deleteFrom('market_tutor_subjects').where('account_id', '=', account.id).execute();
      await trx.deleteFrom('market_tutor_availability').where('account_id', '=', account.id).execute();
      if (listing.subjects.length > 0) {
        await trx
          .insertInto('market_tutor_subjects')
          .values(listing.subjects.map((subject) => ({ account_id: account.id, ...subject })))
          .execute();
      }
      if (listing.availability.length > 0) {
        await trx
          .insertInto('market_tutor_availability')
          .values(listing.availability.map((slot) => ({ account_id: account.id, ...slot })))
          .execute();
      }
    });
    return this.view(request);
  }

  async submit(request: Request) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const database = this.market.database;
    const listing = await readListing(database, account.id);
    const state = verificationState(
      (await readVerifications(database, account.id)) as VerificationRow[],
      vietnamToday(this.market.now()),
    );
    const blockers = submitBlockers(listing, state);
    if (blockers.length > 0) {
      throw new ApplicationError('ERR_CONFLICT', blockers.join('; '));
    }
    if (listing.status === 'approved' || listing.status === 'submitted') {
      return this.view(request);
    }
    await database
      .updateTable('market_tutor_profiles')
      .set({ status: 'submitted', updated_at: this.market.now() })
      .where('account_id', '=', account.id)
      .execute();
    await this.market.audit({ actorType: 'account', actorId: account.id, action: 'profile.submit' });
    return this.view(request);
  }

  async upload(request: Request, kindInput: string, body: RequestBody, file: UploadedPart | undefined) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const kind = kindInput as VerificationKind;
    if (!DOCUMENT_KINDS.has(kind)) {
      throw marketNotFound();
    }
    const key = this.configuration.marketFilesKey;
    if (!key || !hasMarketStorage(this.files)) {
      throw new ApplicationError('ERR_CONFLICT', 'Chợ chưa bật nhận tệp giấy tờ');
    }
    const errors: FieldError[] = [];
    const contentType = file ? documentTypeOf(file.buffer) : null;
    if (!file || file.size === 0) {
      errors.push({ field: 'file', message: 'Chọn tệp PDF, JPEG hoặc PNG' });
    } else if (!contentType) {
      errors.push({ field: 'file', message: 'Chỉ nhận tệp PDF, JPEG hoặc PNG' });
    } else if (file.size > MAXIMUM_FILE_BYTES) {
      errors.push({ field: 'file', message: 'Tệp tối đa 10 MB' });
    }
    const text = (field: string, max: number) => {
      const value = typeof body?.[field] === 'string' ? (body[field] as string).trim() : '';
      if (value.length < 1 || value.length > max) {
        errors.push({ field, message: `Bắt buộc, tối đa ${max} ký tự` });
      }
      return value;
    };
    let details: Record<string, string> = {};
    if (kind === 'degree') {
      details = { title: text('title', 200), institution: text('institution', 200) };
    } else if (kind === 'criminal_record') {
      const issuedOn = text('issued_on', 10);
      const problem = criminalRecordIssueProblem(issuedOn, vietnamToday(this.market.now()));
      if (problem) errors.push({ field: 'issued_on', message: problem });
      details = { issued_on: issuedOn };
    } else {
      const number = text('registration_no', 20);
      if (number && !/^[0-9A-Za-z-]{6,20}$/.test(number)) {
        errors.push({ field: 'registration_no', message: 'Số đăng ký 6 đến 20 ký tự chữ, số' });
      }
      details = { registration_no: number };
    }
    if (errors.length > 0 || !file || !contentType) {
      throw validationError(errors);
    }
    const documentId = randomUUID();
    const fileKey = marketFileKey(account.id, documentId);
    await marketStorage(this.files).put(fileKey, encryptFile(key, file.buffer), 'application/octet-stream');
    const now = this.market.now();
    const previous = await this.market.database.transaction().execute(async (trx) => {
      const old = await trx
        .selectFrom('market_tutor_verifications')
        .innerJoin('market_tutor_documents', 'market_tutor_documents.id', 'market_tutor_verifications.document_id')
        .select(['market_tutor_documents.id', 'market_tutor_documents.file_key'])
        .where('market_tutor_verifications.account_id', '=', account.id)
        .where('market_tutor_verifications.kind', '=', kind)
        .executeTakeFirst();
      await trx
        .insertInto('market_tutor_documents')
        .values({
          id: documentId,
          account_id: account.id,
          kind: kind as 'degree' | 'criminal_record' | 'business_registration',
          file_key: fileKey,
          file_name: decodeFileName(file).slice(0, 200),
          content_type: contentType,
          size_bytes: file.size,
        })
        .execute();
      const values = {
        status: 'pending' as const,
        details: JSON.stringify(details),
        document_id: documentId,
        submitted_at: now,
        decided_at: null,
        decided_by: null,
        note: null,
        valid_until: null,
      };
      await trx
        .insertInto('market_tutor_verifications')
        .values({ account_id: account.id, kind, ...values })
        .onConflict((conflict) => conflict.columns(['account_id', 'kind']).doUpdateSet(values))
        .execute();
      if (old) {
        await trx.deleteFrom('market_tutor_documents').where('id', '=', old.id).execute();
      }
      return old;
    });
    if (previous) {
      await marketStorage(this.files)
        .delete(previous.file_key)
        .catch(() => undefined);
    }
    await this.market.audit({ actorType: 'account', actorId: account.id, action: 'verification.submit', target: kind });
    return this.view(request);
  }

  async declareSchool(request: Request, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const errors: FieldError[] = [];
    const text = (field: string, max: number) => {
      const value = typeof body?.[field] === 'string' ? (body[field] as string).trim() : '';
      if (value.length < 1 || value.length > max) errors.push({ field, message: `Bắt buộc, tối đa ${max} ký tự` });
      return value;
    };
    const schoolName = text('school_name', 200);
    const subjects = text('subjects', 200);
    const grades = text('grades', 100);
    if (typeof body?.is_public !== 'boolean') {
      errors.push({ field: 'is_public', message: 'Chọn trường công lập hay ngoài công lập' });
    }
    if (errors.length > 0) throw validationError(errors);
    const isPublic = body?.is_public === true;
    if (isPublic) {
      const curriculum = await this.market.database
        .selectFrom('market_tutor_subjects')
        .select('id')
        .where('account_id', '=', account.id)
        .where('content_kind', '=', 'curriculum')
        .executeTakeFirst();
      if (curriculum) {
        throw validationError([
          {
            field: 'is_public',
            message:
              'Giáo viên trường công lập không đứng tên dạy thêm có thu tiền môn của chương trình phổ thông: bỏ các môn đó khỏi hồ sơ trước',
          },
        ]);
      }
    }
    const now = this.market.now();
    const values = { school_name: schoolName, is_public: isPublic, subjects, grades, declared_at: now };
    await this.market.database
      .insertInto('market_tutor_school_roles')
      .values({ account_id: account.id, ...values })
      .onConflict((conflict) => conflict.column('account_id').doUpdateSet(values))
      .execute();
    await this.market.audit({ actorType: 'account', actorId: account.id, action: 'school-role.declare' });
    return this.view(request);
  }

  async withdrawSchool(request: Request) {
    const account = await this.accounts.requireReady(request, 'tutor');
    await this.market.database.deleteFrom('market_tutor_school_roles').where('account_id', '=', account.id).execute();
    return this.view(request);
  }

  // Nội dung báo cáo theo Mẫu 03 (Thông tư 29/2024 sửa bởi Thông tư 19/2026): giáo viên in, ký, nộp Hiệu trưởng trước khi bắt đầu dạy
  async form03(request: Request) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const database = this.market.database;
    const role = await this.schoolRole(account.id);
    if (!role) {
      throw new ApplicationError(
        'ERR_CONFLICT',
        'Chỉ giáo viên đang dạy ở trường khai ở mục Giáo viên đang dạy ở trường mới cần Mẫu 03',
      );
    }
    const [listing, provider] = await Promise.all([
      readListing(database, account.id),
      database
        .selectFrom('market_providers')
        .select(['kind', 'name', 'business_registration_no'])
        .where('owner_account_id', '=', account.id)
        .executeTakeFirst(),
    ]);
    const now = this.market.now();
    await database
      .updateTable('market_tutor_school_roles')
      .set({ form03_generated_at: now })
      .where('account_id', '=', account.id)
      .execute();
    return {
      generated_at: now.toISOString(),
      teacher_name: account.display_name,
      school_name: role.school_name,
      school_subjects: role.subjects,
      school_grades: role.grades,
      tutoring_subjects: listing.subjects.map((subject) => ({
        subject: subject.subject,
        school_level: subject.school_level,
        grades: `${subject.grade_from}–${subject.grade_to}`,
        content_kind: subject.content_kind,
      })),
      place: 'Trực tuyến qua Chợ gia sư (không có địa điểm dạy trực tiếp)',
      form: 'Trực tuyến',
      schedule: listing.availability,
      provider: provider ?? { kind: 'individual', name: account.display_name, business_registration_no: null },
      relationship: provider?.kind === 'organization' ? 'Người dạy của tổ chức đứng tên' : 'Tự đứng tên cá nhân',
    };
  }
}

@Controller('market/tutor')
@PublicEndpoint()
export class MarketListingController {
  constructor(private readonly listing: MarketListingService) {}

  @Get('listing')
  view(@Req() request: Request) {
    return this.listing.view(request);
  }

  @Put('listing')
  save(@Req() request: Request, @Body() body: RequestBody) {
    return this.listing.save(request, body);
  }

  @Post('listing/submit')
  @HttpCode(200)
  submit(@Req() request: Request) {
    return this.listing.submit(request);
  }

  @Post('verifications/:kind')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAXIMUM_FILE_BYTES + 1, files: 1 } }))
  upload(
    @Req() request: Request,
    @Param('kind') kind: string,
    @Body() body: RequestBody,
    @UploadedFile() file: UploadedPart | undefined,
  ) {
    return this.listing.upload(request, kind, body, file);
  }

  @Put('school-role')
  declareSchool(@Req() request: Request, @Body() body: RequestBody) {
    return this.listing.declareSchool(request, body);
  }

  @Delete('school-role')
  withdrawSchool(@Req() request: Request) {
    return this.listing.withdrawSchool(request);
  }

  @Get('form-03')
  form03(@Req() request: Request) {
    return this.listing.form03(request);
  }
}
