import { createHash } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Injectable, Post, Req, Res } from '@nestjs/common';
import { ApplicationError, validationError } from '../common/server.js';
import {
  IdentityProviderError,
  newAuthorizationParameters,
  OidcIdentityProvider,
  type ExternalIdentityResult,
  type ExternalProviderDefinition,
} from '../common/external-identity/index.js';
import { API_VERSION_PREFIX } from '../common/shared.js';
import type { Request, Response } from 'express';
import { PublicEndpoint } from '../common/public-endpoint.js';
import { API_CONFIGURATION, type ApiConfiguration } from '../common/configuration.js';
import type { RequestBody } from '../common/request-fields.js';
import { MarketAccountsService } from './market-accounts.js';
import { MarketContext } from './market-context.js';

// Xác minh danh tính gia sư và đăng nhập bằng OIDC ở chợ gia sư (DT-27 phần 27g, YCTD-257; tài liệu 47 mục 19.2 "xác minh lý lịch gia
// sư ở chợ mở", 19.5). Dùng bộ nối OIDC của DT-25 (chuyển sang packages/server). Claude tự chọn theo ủy quyền của Eric ngày 2026-10-11:
// - chỉ ứng dụng Gia sư dùng (tên miền của ứng dụng Gia sư); nhà cung cấp khai ở MARKET_IDENTITY_PROVIDERS, ứng dụng đăng ký ở nhà
//   cung cấp là của chợ;
// - địa chỉ quay về do ứng dụng gửi nhưng phải là `/xac-minh` trên đúng tên miền của ứng dụng Gia sư (nhà cung cấp cũng kiểm);
// - lượt chuyển hướng lưu ở cơ sở dữ liệu chợ, hạn 10 phút, dùng một lần, chỉ lưu băm của state;
// - xác minh: nhà cung cấp phải trả ngày sinh và đủ 18 tuổi; một người (mã đối tượng của nhà cung cấp) chỉ gắn một tài khoản gia sư;
//   chợ chỉ lưu băm của mã đối tượng, không lưu ngày sinh, chỉ lưu "đủ 18 tuổi";
// - đăng nhập: chỉ tài khoản gia sư đã xác minh danh tính bằng đúng nhà cung cấp đó; không tự tạo tài khoản
// - lượt chuyển hướng gắn với trình duyệt đã bắt đầu (YCTD-322): lúc bắt đầu đặt cookie httpOnly chứa state, lúc hoàn tất phải khớp;
//   xác minh còn phải có phiên của đúng tài khoản đã bắt đầu
// - phụ huynh (YCTD-364, thiết kế Eric duyệt ngày 2026-10-28; việc T-M6): ở Chợ gia sư, phụ huynh đang đăng nhập liên kết tài khoản định
//   danh (`link`, quay về `/dinh-danh`), sau đó đăng nhập bằng định danh đó; liên kết cũng phải có phiên của đúng tài khoản đã bắt đầu.
//   Liên kết của phụ huynh không phải xác minh gia sư, không ghi kết quả xác minh
// - ứng dụng chung (YCTD-368): mọi lượt quay về tên miền của chợ; xác minh gia sư quay về `/xac-minh`, đăng nhập và liên kết quay về
//   `/dinh-danh`. Đăng nhập bằng định danh mở phiên cho tài khoản đã gắn định danh đó, loại nào cũng được
const REQUEST_LIFETIME_MS = 10 * 60 * 1000;
const RETURN_PATHS = { verify: '/xac-minh', link: '/dinh-danh', login: '/dinh-danh' } as const;
const ADULT_AGE = 18;
// Tiền tố __Secure-: trình duyệt chỉ nhận cookie có Secure từ trang an toàn, tên miền anh em không đặt đè được
const STATE_COOKIE = '__Secure-market_oidc_state';
const STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  // Lax: ứng dụng gọi hoàn tất cùng nguồn gốc sau khi nhà cung cấp chuyển về /xac-minh nên vẫn gửi; trang khác không gửi được
  sameSite: 'lax',
  path: `${API_VERSION_PREFIX}/market/identity`,
} as const;

function readStateCookie(request: Request): string {
  for (const part of (request.header('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === STATE_COOKIE) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return '';
}

function staleRequest(): never {
  throw validationError([{ field: 'state', message: 'Lượt xác minh đã hết hạn hoặc đã dùng, hãy bắt đầu lại' }]);
}

function hashState(state: string): string {
  return createHash('sha256').update(`market-oidc-state:${state}`).digest('hex');
}

export function hashSubject(provider: string, subject: string): string {
  return createHash('sha256').update(`market-oidc-subject:${provider}:${subject}`).digest('hex');
}

@Injectable()
export class MarketIdentityService {
  private readonly providers = new Map<string, OidcIdentityProvider>();

  constructor(
    private readonly market: MarketContext,
    private readonly accounts: MarketAccountsService,
    @Inject(API_CONFIGURATION) private readonly configuration: ApiConfiguration,
  ) {}

  // Chỉ nhà cung cấp trả ngày sinh (khai `birthdate_claim`) mới xác nhận được đủ 18 tuổi
  private definitions(): ExternalProviderDefinition[] {
    return (this.configuration.marketIdentityProviders ?? []).filter((item) => item.birthdateClaim);
  }

  private provider(code: string): OidcIdentityProvider {
    const definition = this.definitions().find((item) => item.code === code);
    if (!definition?.clientId) {
      throw validationError([{ field: 'provider', message: 'Nhà cung cấp định danh chưa được nền tảng khai' }]);
    }
    let provider = this.providers.get(code);
    if (!provider) {
      provider = new OidcIdentityProvider(definition, {
        clientId: definition.clientId,
        clientSecret: definition.clientSecret,
      });
      this.providers.set(code, provider);
    }
    return provider;
  }

  async list(request: Request) {
    await this.market.assertMarketHost(request);
    return this.definitions()
      .filter((item) => item.clientId)
      .map((item) => ({ code: item.code, display_name: item.displayName }));
  }

  private returnUrl(raw: unknown, host: string | null, purpose: keyof typeof RETURN_PATHS): string {
    const path = RETURN_PATHS[purpose];
    let url: URL;
    try {
      url = new URL(typeof raw === 'string' ? raw : '');
    } catch {
      throw validationError([{ field: 'return_url', message: 'Địa chỉ quay về không hợp lệ' }]);
    }
    if (
      !host ||
      // MARKET_HOST có thể kèm cổng (localhost:5300) hoặc chỉ tên miền (bản gốc so tên miền, bỏ qua cổng)
      (url.host !== host && url.hostname !== host) ||
      url.pathname !== path ||
      (url.protocol !== 'https:' && url.protocol !== 'http:')
    ) {
      throw validationError([
        { field: 'return_url', message: 'Địa chỉ quay về phải là trang định danh của ứng dụng đang dùng' },
      ]);
    }
    return `${url.origin}${path}`;
  }

  async start(request: Request, body: RequestBody, response: Response) {
    await this.market.assertMarketHost(request);
    // Đăng nhập không cần phiên; có phiên thì theo loại tài khoản: gia sư xác minh, phụ huynh liên kết
    const account = body?.purpose === 'login' ? null : await this.market.account(request);
    const purpose = !account ? 'login' : account.kind === 'tutor' ? 'verify' : 'link';
    const accountId = account?.id ?? null;
    const code = typeof body?.provider === 'string' ? body.provider : '';
    const provider = this.provider(code);
    const parameters = newAuthorizationParameters(this.returnUrl(body?.return_url, this.market.host, purpose));
    await this.market.database
      .insertInto('market_oidc_requests')
      .values({
        state_hash: hashState(parameters.state),
        purpose,
        provider: code,
        account_id: accountId,
        nonce: parameters.nonce,
        code_verifier: parameters.codeVerifier,
        redirect_uri: parameters.redirectUri,
        expires_at: new Date(this.market.now().getTime() + REQUEST_LIFETIME_MS),
        used_at: null,
      })
      .execute();
    response.cookie(STATE_COOKIE, parameters.state, { ...STATE_COOKIE_OPTIONS, maxAge: REQUEST_LIFETIME_MS });
    try {
      return { authorization_url: await provider.authorizationUrl(parameters) };
    } catch (error) {
      if (error instanceof IdentityProviderError) {
        throw new ApplicationError('ERR_CONFLICT', 'Không kết nối được nhà cung cấp định danh, thử lại sau');
      }
      throw error;
    }
  }

  async complete(request: Request, body: RequestBody, response: Response) {
    await this.market.assertMarketHost(request);
    const state = typeof body?.state === 'string' ? body.state : '';
    const code = typeof body?.code === 'string' ? body.code : '';
    // Trình duyệt hoàn tất phải là trình duyệt đã bắt đầu (cookie không có hoặc khác thì không dùng lượt này)
    const bound = readStateCookie(request);
    response.clearCookie(STATE_COOKIE, STATE_COOKIE_OPTIONS);
    if (!state || bound !== state) staleRequest();
    const now = this.market.now();
    const row = state
      ? await this.market.database
          .updateTable('market_oidc_requests')
          .set({ used_at: now })
          .where('state_hash', '=', hashState(state))
          .where('used_at', 'is', null)
          .where('expires_at', '>', now)
          .returningAll()
          .executeTakeFirst()
      : undefined;
    if (!row || !code) staleRequest();
    // Kết quả xác minh chỉ ghi cho tài khoản đang đăng nhập, đúng tài khoản đã bắt đầu
    if (row.purpose !== 'login' && (await this.market.account(request)).id !== row.account_id) staleRequest();
    let identity: ExternalIdentityResult;
    try {
      identity = await this.provider(row.provider).exchange(
        code,
        { state, nonce: row.nonce, codeVerifier: row.code_verifier, redirectUri: row.redirect_uri },
        now,
      );
    } catch (error) {
      if (error instanceof IdentityProviderError) {
        throw validationError([{ field: 'code', message: 'Nhà cung cấp định danh không xác nhận được, hãy thử lại' }]);
      }
      throw error;
    }
    const subject = hashSubject(row.provider, identity.subject);
    if (row.purpose === 'login') {
      return this.login(row.provider, subject);
    }
    if (row.purpose === 'link') {
      return this.link(row.account_id as string, row.provider, subject);
    }
    return this.verify(row.account_id as string, row.provider, subject, identity);
  }

  // Phụ huynh liên kết định danh: một định danh chỉ gắn một tài khoản
  private async link(accountId: string, provider: string, subject: string) {
    const other = await this.market.database
      .selectFrom('market_external_identities')
      .select('account_id')
      .where('provider', '=', provider)
      .where('subject', '=', subject)
      .executeTakeFirst();
    if (other && other.account_id !== accountId) {
      throw new ApplicationError('ERR_CONFLICT', 'Định danh này đã liên kết với một tài khoản khác');
    }
    await this.market.database
      .insertInto('market_external_identities')
      .values({ provider, subject, account_id: accountId })
      .onConflict((conflict) => conflict.columns(['provider', 'subject']).doNothing())
      .execute();
    await this.market.audit({
      actorType: 'account',
      actorId: accountId,
      action: 'account.identity-link',
      target: provider,
    });
    return { kind: 'link', status: 'linked', note: null };
  }

  // Định danh đã liên kết của tài khoản đang đăng nhập (trang tài khoản phụ huynh)
  async linked(request: Request) {
    const account = await this.market.account(request);
    const rows = await this.market.database
      .selectFrom('market_external_identities')
      .select(['provider', 'created_at'])
      .where('account_id', '=', account.id)
      .execute();
    return {
      identities: rows.map((row) => ({
        provider: row.provider,
        display_name: this.definitions().find((item) => item.code === row.provider)?.displayName ?? row.provider,
        linked_at: row.created_at,
      })),
    };
  }

  private async login(provider: string, subject: string) {
    const linked = await this.market.database
      .selectFrom('market_external_identities')
      .innerJoin('market_accounts', 'market_accounts.id', 'market_external_identities.account_id')
      .select(['market_accounts.id', 'market_accounts.kind', 'market_accounts.status'])
      .where('market_external_identities.provider', '=', provider)
      .where('market_external_identities.subject', '=', subject)
      .executeTakeFirst();
    if (!linked || linked.status !== 'active') {
      throw new ApplicationError(
        'ERR_FORBIDDEN',
        'Chưa có tài khoản nào gắn định danh này; đăng nhập bằng mật khẩu rồi liên kết (phụ huynh) hoặc xác minh danh tính (gia sư)',
      );
    }
    await this.market.audit({
      actorType: 'account',
      actorId: linked.id,
      action: 'account.login-oidc',
      target: provider,
    });
    return { ...(await this.accounts.openSession(linked.id)), status: 'active' };
  }

  private async verify(accountId: string, provider: string, subject: string, identity: ExternalIdentityResult) {
    const database = this.market.database;
    const reject = async (note: string) => {
      await database
        .insertInto('market_tutor_verifications')
        .values({
          account_id: accountId,
          kind: 'identity',
          status: 'rejected',
          details: JSON.stringify({ provider }),
          document_id: null,
          decided_at: this.market.now(),
          decided_by: 'oidc',
          note,
          valid_until: null,
        })
        .onConflict((conflict) =>
          conflict.columns(['account_id', 'kind']).doUpdateSet({
            status: 'rejected',
            details: JSON.stringify({ provider }),
            submitted_at: this.market.now(),
            decided_at: this.market.now(),
            decided_by: 'oidc',
            note,
          }),
        )
        .execute();
      await this.market.audit({
        actorType: 'account',
        actorId: accountId,
        action: 'verification.identity-reject',
        details: { note },
      });
      return { kind: 'identity', status: 'rejected', note };
    };
    if (identity.ageYears === null) {
      return reject('Nhà cung cấp không trả ngày sinh nên chưa xác nhận được đủ 18 tuổi');
    }
    if (identity.ageYears < ADULT_AGE) {
      return reject('Gia sư ở chợ phải đủ 18 tuổi');
    }
    const other = await database
      .selectFrom('market_external_identities')
      .select('account_id')
      .where('provider', '=', provider)
      .where('subject', '=', subject)
      .executeTakeFirst();
    if (other && other.account_id !== accountId) {
      return reject('Định danh này đã xác minh cho một tài khoản gia sư khác');
    }
    const now = this.market.now();
    await database.transaction().execute(async (trx) => {
      await trx
        .insertInto('market_external_identities')
        .values({ provider, subject, account_id: accountId })
        .onConflict((conflict) => conflict.columns(['provider', 'subject']).doNothing())
        .execute();
      const details = JSON.stringify({ provider, adult: true, assurance: identity.assurance });
      await trx
        .insertInto('market_tutor_verifications')
        .values({
          account_id: accountId,
          kind: 'identity',
          status: 'approved',
          details,
          document_id: null,
          decided_at: now,
          decided_by: 'oidc',
          note: null,
          valid_until: null,
        })
        .onConflict((conflict) =>
          conflict.columns(['account_id', 'kind']).doUpdateSet({
            status: 'approved',
            details,
            submitted_at: now,
            decided_at: now,
            decided_by: 'oidc',
            note: null,
          }),
        )
        .execute();
    });
    await this.market.audit({
      actorType: 'account',
      actorId: accountId,
      action: 'verification.identity-approve',
      target: provider,
    });
    return { kind: 'identity', status: 'approved', note: null };
  }
}

@Controller('market/identity')
@PublicEndpoint()
export class MarketIdentityController {
  constructor(private readonly identity: MarketIdentityService) {}

  @Get('providers')
  list(@Req() request: Request) {
    return this.identity.list(request);
  }

  @Get('linked')
  linked(@Req() request: Request) {
    return this.identity.linked(request);
  }

  @Post('start')
  @HttpCode(200)
  start(@Req() request: Request, @Body() body: RequestBody, @Res({ passthrough: true }) response: Response) {
    return this.identity.start(request, body, response);
  }

  @Post('complete')
  @HttpCode(200)
  complete(@Req() request: Request, @Body() body: RequestBody, @Res({ passthrough: true }) response: Response) {
    return this.identity.complete(request, body, response);
  }
}
