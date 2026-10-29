import { Controller, Get, Injectable, Param, Query, Req } from '@nestjs/common';
import type { MarketplaceDatabase } from '@cho-gia-su/database';
import { validationError } from '../common/server.js';
import type { Request } from 'express';
import { sql, type Kysely } from 'kysely';
import { PublicEndpoint } from '../common/public-endpoint.js';
import { MarketContext, marketNotFound } from './market-context.js';
import { vietnamToday } from './market-listing.js';
import { notSuspended } from './market-safety-rules.js';
import { badgesOf, verificationState, type VerificationRow } from './market-tutor-rules.js';

// Tìm gia sư và trang công khai của gia sư theo Mẫu 02 (DT-27 phần 27g, YCTD-257; tài liệu 47 mục 19.5; Thông tư 29/2024 sửa bởi Thông
// tư 19/2026: cơ sở dạy thêm công khai môn, thời lượng theo khối lớp, địa điểm, hình thức, thời gian, người dạy, mức thu). Ở tên miền
// của chợ (ứng dụng phụ huynh), không cần đăng nhập. Claude tự chọn theo ủy quyền của Eric ngày 2026-10-11:
// - chỉ hiện gia sư có hồ sơ đã duyệt, danh tính đã xác minh, phiếu lý lịch tư pháp đã duyệt còn hiệu lực, tài khoản đang dùng;
// - không trả thư điện tử, số điện thoại, địa chỉ của gia sư, không trả giấy tờ; chỉ trả huy hiệu theo bậc xác minh;
// - lọc theo môn, cấp, khối, loại nội dung, giá tối đa, thứ có giờ trống; sắp xếp theo giá thấp nhất, giá cao nhất, mới duyệt, đánh giá cao trước
//   (đánh giá sau buổi học đã duyệt, YCTD-364)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 20;

type Database = Kysely<MarketplaceDatabase>;

function visibleTutors(database: Database, today: string) {
  return database
    .selectFrom('market_tutor_profiles')
    .innerJoin('market_accounts', 'market_accounts.id', 'market_tutor_profiles.account_id')
    .where('market_tutor_profiles.status', '=', 'approved')
    .where('market_accounts.status', '=', 'active')
    .where(notSuspended('market_tutor_profiles.account_id'))
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('market_tutor_verifications as identity')
          .select('identity.account_id')
          .whereRef('identity.account_id', '=', 'market_tutor_profiles.account_id')
          .where('identity.kind', '=', 'identity')
          .where('identity.status', '=', 'approved'),
      ),
    )
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('market_tutor_verifications as record')
          .select('record.account_id')
          .whereRef('record.account_id', '=', 'market_tutor_profiles.account_id')
          .where('record.kind', '=', 'criminal_record')
          .where('record.status', '=', 'approved')
          .where('record.valid_until', '>=', today),
      ),
    );
}

function optionalInteger(value: string | undefined, field: string, min: number, max: number): number | null {
  if (value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw validationError([{ field, message: `Số nguyên từ ${min} đến ${max}` }]);
  }
  return number;
}

@Injectable()
export class MarketPublicService {
  constructor(private readonly market: MarketContext) {}

  // Tìm gia sư, trang gia sư là phần công khai của ứng dụng chung (YCTD-368): ai mở tên miền của chợ cũng xem được, kể cả chưa đăng nhập
  private async assertParentApp(request: Request) {
    await this.market.assertMarketHost(request);
  }

  private async badges(database: Database, accountIds: string[], today: string) {
    if (accountIds.length === 0) return new Map<string, ReturnType<typeof badgesOf>>();
    const [verifications, roles] = await Promise.all([
      database
        .selectFrom('market_tutor_verifications')
        .select(['account_id', 'kind', 'status', 'valid_until'])
        .where('account_id', 'in', accountIds)
        .execute(),
      database
        .selectFrom('market_tutor_school_roles')
        .select('account_id')
        .where('account_id', 'in', accountIds)
        .execute(),
    ]);
    return new Map(
      accountIds.map((id) => [
        id,
        badgesOf(
          verificationState(verifications.filter((row) => row.account_id === id) as VerificationRow[], today),
          roles.some((row) => row.account_id === id),
        ),
      ]),
    );
  }

  async search(request: Request, query: Record<string, string | undefined>) {
    await this.assertParentApp(request);
    const database = this.market.database;
    const today = vietnamToday(this.market.now());
    const level = query.school_level;
    if (level !== undefined && level !== '' && level !== 'TH' && level !== 'THCS' && level !== 'THPT') {
      throw validationError([{ field: 'school_level', message: 'Cấp học là TH, THCS hoặc THPT' }]);
    }
    const kind = query.content_kind;
    if (kind !== undefined && kind !== '' && kind !== 'curriculum' && kind !== 'enrichment') {
      throw validationError([{ field: 'content_kind', message: 'Loại nội dung là curriculum hoặc enrichment' }]);
    }
    const grade = optionalInteger(query.grade, 'grade', 1, 12);
    const maxPrice = optionalInteger(query.max_price, 'max_price', 0, 10_000_000);
    const weekday = optionalInteger(query.weekday, 'weekday', 1, 7);
    const subject = (query.subject ?? '').trim().slice(0, 60);
    const sort =
      query.sort === 'price_desc' || query.sort === 'newest' || query.sort === 'rating_desc' ? query.sort : 'price_asc';
    // Điểm đánh giá đã hiện (YCTD-364): trung bình và số đánh giá, để hiện ở thẻ và sắp "đánh giá cao trước"
    const ratings = database
      .selectFrom('market_reviews')
      .select([
        'tutor_account_id',
        sql<string>`round(avg(rating), 1)::text`.as('rating_average'),
        sql<number>`count(*)::int`.as('rating_count'),
      ])
      .where('status', '=', 'published')
      .groupBy('tutor_account_id');
    // Môn khớp điều kiện lọc; gia sư hiện khi có ít nhất một môn khớp
    let matching = database
      .selectFrom('market_tutor_subjects')
      .select(['account_id', sql<string>`min(price_per_session)`.as('min_price')])
      .groupBy('account_id');
    if (subject) matching = matching.where('subject', 'ilike', `%${subject.replace(/[%_\\]/g, '\\$&')}%`);
    if (level) matching = matching.where('school_level', '=', level as 'TH' | 'THCS' | 'THPT');
    if (grade !== null) matching = matching.where('grade_from', '<=', grade).where('grade_to', '>=', grade);
    if (kind) matching = matching.where('content_kind', '=', kind as 'curriculum' | 'enrichment');
    if (maxPrice !== null) matching = matching.where('price_per_session', '<=', maxPrice);
    let tutors = visibleTutors(database, today)
      .innerJoin(matching.as('matching'), 'matching.account_id', 'market_tutor_profiles.account_id')
      .leftJoin(ratings.as('ratings'), 'ratings.tutor_account_id', 'market_tutor_profiles.account_id')
      .select([
        'ratings.rating_average',
        'ratings.rating_count',
        'market_accounts.id',
        'market_accounts.display_name',
        'market_tutor_profiles.headline',
        'market_tutor_profiles.teaching_language',
        'market_tutor_profiles.published_at',
        'matching.min_price',
      ]);
    if (weekday !== null) {
      tutors = tutors.where((eb) =>
        eb.exists(
          eb
            .selectFrom('market_tutor_availability')
            .select('market_tutor_availability.account_id')
            .whereRef('market_tutor_availability.account_id', '=', 'market_tutor_profiles.account_id')
            .where('market_tutor_availability.weekday', '=', weekday),
        ),
      );
    }
    tutors =
      sort === 'newest'
        ? tutors.orderBy('market_tutor_profiles.published_at', 'desc')
        : sort === 'rating_desc'
          ? tutors
              .orderBy(sql`coalesce(ratings.rating_average::numeric, 0)`, 'desc')
              .orderBy(sql`coalesce(ratings.rating_count, 0)`, 'desc')
          : tutors.orderBy(sql`min_price::int`, sort === 'price_desc' ? 'desc' : 'asc');
    const rows = await tutors.orderBy('market_accounts.id').limit(PAGE_SIZE).execute();
    const ids = rows.map((row) => row.id);
    const [subjects, badges] = await Promise.all([
      ids.length
        ? database
            .selectFrom('market_tutor_subjects')
            .select([
              'account_id',
              'subject',
              'school_level',
              'grade_from',
              'grade_to',
              'content_kind',
              'price_per_session',
              'package_sessions',
              'package_price',
            ])
            .where('account_id', 'in', ids)
            .execute()
        : [],
      this.badges(database, ids, today),
    ]);
    return {
      tutors: rows.map((row) => ({
        id: row.id,
        display_name: row.display_name,
        headline: row.headline,
        teaching_language: row.teaching_language,
        min_price: Number(row.min_price),
        rating: {
          average: row.rating_average === null ? null : Number(row.rating_average),
          count: row.rating_count ?? 0,
        },
        subjects: subjects
          .filter((item) => item.account_id === row.id)
          .map((item) => ({
            subject: item.subject,
            school_level: item.school_level,
            grade_from: item.grade_from,
            grade_to: item.grade_to,
            content_kind: item.content_kind,
            price_per_session: item.price_per_session,
            package_sessions: item.package_sessions,
            package_price: item.package_price,
          })),
        badges: badges.get(row.id),
      })),
    };
  }

  // Trang công khai theo Mẫu 02: chỉ gia sư đang hiện ở tìm kiếm; gia sư khác 404 như không tồn tại
  async detail(request: Request, id: string) {
    await this.assertParentApp(request);
    const database = this.market.database;
    const today = vietnamToday(this.market.now());
    const row = UUID.test(id)
      ? await visibleTutors(database, today)
          .select([
            'market_accounts.id',
            'market_accounts.display_name',
            'market_tutor_profiles.headline',
            'market_tutor_profiles.bio',
            'market_tutor_profiles.teaching_language',
            'market_tutor_profiles.published_at',
          ])
          .where('market_accounts.id', '=', id)
          .executeTakeFirst()
      : undefined;
    if (!row) throw marketNotFound();
    const [subjects, availability, provider, badges] = await Promise.all([
      database
        .selectFrom('market_tutor_subjects')
        .select([
          // Mã môn để đặt buổi (DT-27 phần 27h)
          'id',
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
        .where('account_id', '=', row.id)
        .orderBy('created_at')
        .execute(),
      database
        .selectFrom('market_tutor_availability')
        .select(['weekday', 'start_minute', 'end_minute'])
        .where('account_id', '=', row.id)
        .orderBy('weekday')
        .orderBy('start_minute')
        .execute(),
      database
        .selectFrom('market_providers')
        .select(['kind', 'name', 'business_registration_no'])
        .where('owner_account_id', '=', row.id)
        .executeTakeFirst(),
      this.badges(database, [row.id], today),
    ]);
    return {
      ...row,
      subjects,
      availability,
      badges: badges.get(row.id),
      // Thông tin công khai của cơ sở dạy thêm theo Mẫu 02
      form02: {
        provider_name: provider?.name ?? row.display_name,
        provider_kind: provider?.kind ?? 'individual',
        business_registration_no: provider?.business_registration_no ?? null,
        place: 'Trực tuyến qua Chợ gia sư',
        form: 'Trực tuyến (lớp video có phụ huynh theo dõi)',
        teachers: [row.display_name],
        subjects: subjects.map((item) => ({
          subject: item.subject,
          school_level: item.school_level,
          grades: `${item.grade_from}–${item.grade_to}`,
          content_kind: item.content_kind,
          session_minutes: item.session_minutes,
          price_per_session: item.price_per_session,
          package_sessions: item.package_sessions,
          package_price: item.package_price,
        })),
        schedule: availability,
      },
    };
  }
}

@Controller('market/public/tutors')
@PublicEndpoint()
export class MarketPublicController {
  constructor(private readonly tutors: MarketPublicService) {}

  @Get()
  search(@Req() request: Request, @Query() query: Record<string, string | undefined>) {
    return this.tutors.search(request, query);
  }

  @Get(':id')
  detail(@Req() request: Request, @Param('id') id: string) {
    return this.tutors.detail(request, id);
  }
}
