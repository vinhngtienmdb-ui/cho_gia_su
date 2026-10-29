import { Body, Controller, Get, Injectable, Put, Req } from '@nestjs/common';
import { validationError, type FieldError } from '../common/server.js';
import type { Request } from 'express';
import { PublicEndpoint } from '../common/public-endpoint.js';
import type { RequestBody } from '../common/request-fields.js';
import { MarketAccountsService } from './market-accounts.js';
import { MarketContext } from './market-context.js';

// Hồ sơ gia sư và cơ sở dạy thêm ở mức tối thiểu (DT-27 phần 27f, YCTD-256): dòng giới thiệu, giới thiệu ngắn; cơ sở dạy thêm là cá
// nhân hoặc tổ chức đứng tên, số đăng ký kinh doanh để trống được (bắt buộc với `curriculum` có thu tiền là việc của 27g khi gia sư
// khai loại nội dung). Hồ sơ chưa hiện công khai: trang công khai theo Mẫu 02, xác minh, tìm kiếm là của 27g
@Injectable()
export class MarketTutorsService {
  constructor(
    private readonly market: MarketContext,
    private readonly accounts: MarketAccountsService,
  ) {}

  async profile(request: Request) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const database = this.market.database;
    const [profile, provider] = await Promise.all([
      database
        .selectFrom('market_tutor_profiles')
        .select(['headline', 'bio', 'status', 'updated_at'])
        .where('account_id', '=', account.id)
        .executeTakeFirst(),
      database
        .selectFrom('market_providers')
        .select(['id', 'kind', 'name', 'business_registration_no'])
        .where('owner_account_id', '=', account.id)
        .executeTakeFirst(),
    ]);
    return {
      display_name: account.display_name,
      profile: profile ?? { headline: '', bio: '', status: 'draft', updated_at: null },
      provider: provider ?? null,
    };
  }

  async saveProfile(request: Request, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const errors: FieldError[] = [];
    const headline = typeof body?.headline === 'string' ? body.headline.trim() : '';
    const bio = typeof body?.bio === 'string' ? body.bio.trim() : '';
    if (headline.length > 120) errors.push({ field: 'headline', message: 'Dòng giới thiệu tối đa 120 ký tự' });
    if (bio.length > 2000) errors.push({ field: 'bio', message: 'Giới thiệu tối đa 2000 ký tự' });
    if (errors.length > 0) throw validationError(errors);
    const now = this.market.now();
    await this.market.database
      .insertInto('market_tutor_profiles')
      .values({ account_id: account.id, headline, bio, updated_at: now })
      .onConflict((conflict) => conflict.column('account_id').doUpdateSet({ headline, bio, updated_at: now }))
      .execute();
    return this.profile(request);
  }

  async saveProvider(request: Request, body: RequestBody) {
    const account = await this.accounts.requireReady(request, 'tutor');
    const errors: FieldError[] = [];
    const kind = body?.kind;
    if (kind !== 'individual' && kind !== 'organization') {
      errors.push({ field: 'kind', message: 'Chọn cá nhân hoặc tổ chức đứng tên' });
    }
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 200) errors.push({ field: 'name', message: 'Tên cơ sở từ 1 đến 200 ký tự' });
    const registration = typeof body?.business_registration_no === 'string' ? body.business_registration_no.trim() : '';
    if (registration && !/^[0-9A-Za-z-]{6,20}$/.test(registration)) {
      errors.push({ field: 'business_registration_no', message: 'Số đăng ký kinh doanh 6 đến 20 ký tự chữ, số' });
    }
    if (errors.length > 0) throw validationError(errors);
    const values = {
      kind: kind as 'individual' | 'organization',
      name,
      business_registration_no: registration || null,
      updated_at: this.market.now(),
    };
    await this.market.database
      .insertInto('market_providers')
      .values({ owner_account_id: account.id, ...values })
      .onConflict((conflict) => conflict.column('owner_account_id').doUpdateSet(values))
      .execute();
    return this.profile(request);
  }
}

@Controller('market/tutor')
@PublicEndpoint()
export class MarketTutorController {
  constructor(private readonly tutors: MarketTutorsService) {}

  @Get('profile')
  profile(@Req() request: Request) {
    return this.tutors.profile(request);
  }

  @Put('profile')
  saveProfile(@Req() request: Request, @Body() body: RequestBody) {
    return this.tutors.saveProfile(request, body);
  }

  @Put('provider')
  saveProvider(@Req() request: Request, @Body() body: RequestBody) {
    return this.tutors.saveProvider(request, body);
  }
}
