import { hash, verify } from '@node-rs/argon2';
import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Req } from '@nestjs/common';
import type { MarketLegalDocumentKind } from '@cho-gia-su/database';
import { ApplicationError, unauthenticatedError, validationError, type FieldError } from '../common/server.js';
import type { Request } from 'express';
import { PublicEndpoint } from '../common/public-endpoint.js';
import type { RequestBody } from '../common/request-fields.js';
import { MarketContext, marketNotFound, type MarketAccount } from './market-context.js';
import { MarketMessenger } from './market-messenger.js';
import {
  hashSessionToken,
  hashVerificationCode,
  MARKET_CODE_LIFETIME_MS,
  MARKET_CODE_MAX_ATTEMPTS,
  MARKET_SESSION_LIFETIME_MS,
  newSessionToken,
  newVerificationCode,
  sameHash,
} from './market-tokens.js';

// Tài khoản, đăng nhập và văn bản pháp lý của chợ gia sư (DT-27 phần 27f, YCTD-256; tài liệu 47 mục 19.5). Claude tự chọn theo ủy
// quyền của Eric ngày 2026-10-11:
// - đăng ký bằng thư điện tử hoặc số điện thoại, mật khẩu (tối thiểu 8 ký tự có chữ và số như BM-03), đồng ý phiên bản mới nhất của
//   điều khoản sử dụng, chính sách dữ liệu (gia sư thêm điều khoản của gia sư); tài khoản ở trạng thái chờ đến khi nhập mã 6 số gửi
//   tới thư điện tử hoặc số điện thoại (hạn 10 phút, tối đa 5 lần nhập sai mỗi mã);
// - đăng nhập sai 5 lần liên tiếp thì khóa 15 phút; không phân biệt "không có tài khoản" với "sai mật khẩu";
// - nền tảng đăng phiên bản mới của văn bản thì người dùng phải đồng ý lại trước khi dùng tiếp (`me` trả danh sách cần đồng ý);
// - đăng nhập bằng OIDC (bộ nối của DT-25) làm cùng phần xác minh danh tính của 27g; bảng market_external_identities đã có
const MINIMUM_PASSWORD_LENGTH = 8;
const LOCK_AFTER_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const RESEND_INTERVAL_MS = 60 * 1000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE = /^0\d{9}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REQUIRED_DOCUMENTS: Record<'parent' | 'tutor', MarketLegalDocumentKind[]> = {
  parent: ['terms', 'privacy'],
  tutor: ['terms', 'privacy', 'tutor_terms'],
};

export const DOCUMENT_KIND_LABELS: Record<MarketLegalDocumentKind, string> = {
  terms: 'Điều khoản sử dụng',
  privacy: 'Chính sách dữ liệu cá nhân',
  parent_consent: 'Đồng ý của cha mẹ cho hồ sơ con',
  tutor_terms: 'Điều khoản dành cho gia sư',
};

function text(body: RequestBody, field: string): string {
  const value = body?.[field];
  return typeof value === 'string' ? value.trim() : '';
}

// Số điện thoại Việt Nam dạng 0xxxxxxxxx; +84 đổi về 0
export function normalizePhone(value: string): string {
  const digits = value.replace(/[\s.-]/g, '');
  return digits.startsWith('+84') ? `0${digits.slice(3)}` : digits;
}

export function checkMarketPassword(password: string): FieldError[] {
  const errors: FieldError[] = [];
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    errors.push({ field: 'password', message: `Mật khẩu phải có ít nhất ${MINIMUM_PASSWORD_LENGTH} ký tự` });
  }
  if (!/\p{L}/u.test(password) || !/\p{Nd}/u.test(password)) {
    errors.push({ field: 'password', message: 'Mật khẩu phải có cả chữ và số' });
  }
  return errors;
}

@Injectable()
export class MarketAccountsService {
  private placeholder?: Promise<string>;

  constructor(
    private readonly market: MarketContext,
    private readonly messenger: MarketMessenger,
  ) {}

  // Phiên bản mới nhất của từng loại văn bản đã đăng
  async latestDocuments() {
    const rows = await this.market.database
      .selectFrom('market_legal_documents')
      .select(['id', 'kind', 'version', 'title', 'published_at'])
      .orderBy('kind')
      .orderBy('version', 'desc')
      .execute();
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latest.has(row.kind)) latest.set(row.kind, row);
    }
    return [...latest.values()];
  }

  async site(request: Request) {
    await this.market.assertMarketHost(request);
    const documents = await this.latestDocuments();
    // Một ứng dụng chung cho phụ huynh và gia sư (YCTD-368): chỉ còn địa chỉ của chợ; không kèm giao thức, theo giao thức của trang
    return {
      name: 'Chợ gia sư',
      market_url: this.market.host ? `//${this.market.host}/` : null,
      // Bản này chỉ chạy thanh toán giả lập (quyết định của Eric ngày 2026-10-28)
      real_payments: false,
      documents: documents.map((row) => ({ id: row.id, kind: row.kind, version: row.version, title: row.title })),
    };
  }

  async document(request: Request, kind: string) {
    await this.market.assertMarketHost(request);
    if (!(kind in DOCUMENT_KIND_LABELS)) {
      throw marketNotFound();
    }
    const row = await this.market.database
      .selectFrom('market_legal_documents')
      .select(['id', 'kind', 'version', 'title', 'body', 'published_at'])
      .where('kind', '=', kind as MarketLegalDocumentKind)
      .orderBy('version', 'desc')
      .executeTakeFirst();
    if (!row) {
      throw marketNotFound();
    }
    return row;
  }

  // Văn bản bắt buộc của vai mà tài khoản chưa đồng ý ở phiên bản mới nhất
  private async missingConsents(accountId: string, kind: 'parent' | 'tutor') {
    const latest = (await this.latestDocuments()).filter((row) => REQUIRED_DOCUMENTS[kind].includes(row.kind));
    if (latest.length === 0) return [];
    const accepted = await this.market.database
      .selectFrom('market_consents')
      .select('document_id')
      .where('account_id', '=', accountId)
      .where('withdrawn_at', 'is', null)
      .where(
        'document_id',
        'in',
        latest.map((row) => row.id),
      )
      .execute();
    const done = new Set(accepted.map((row) => row.document_id));
    return latest
      .filter((row) => !done.has(row.id))
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        version: row.version,
        title: row.title,
      }));
  }

  // Mở phiên cho tài khoản (đăng nhập mật khẩu; đăng nhập OIDC của 27g gọi từ MarketIdentityService)
  async openSession(accountId: string) {
    const token = newSessionToken();
    const expiresAt = new Date(this.market.now().getTime() + MARKET_SESSION_LIFETIME_MS);
    await this.market.database
      .insertInto('market_sessions')
      .values({ account_id: accountId, token_hash: hashSessionToken(token), expires_at: expiresAt })
      .execute();
    return { session_token: token, expires_at: expiresAt.toISOString() };
  }

  private async sendCode(account: { id: string; email: string | null; phone: string | null }) {
    const code = newVerificationCode();
    const channel = account.email ? 'email' : 'sms';
    await this.market.database
      .insertInto('market_verification_codes')
      .values({
        account_id: account.id,
        channel,
        purpose: 'verify',
        code_hash: hashVerificationCode(account.id, code),
        expires_at: new Date(this.market.now().getTime() + MARKET_CODE_LIFETIME_MS),
      })
      .execute();
    await this.messenger.send({
      channel,
      to: (account.email ?? account.phone) as string,
      text: `Mã xác nhận tài khoản Chợ gia sư của bạn là ${code}, hiệu lực 10 phút. Không chia sẻ mã này cho ai.`,
    });
    return channel;
  }

  async register(request: Request, body: RequestBody) {
    await this.market.assertMarketHost(request);
    const errors: FieldError[] = [];
    const kind = body?.kind;
    // Người đăng ký chọn loại tài khoản ở ứng dụng chung (YCTD-368); mỗi tài khoản một loại, không đổi về sau (GD-185)
    if (kind !== 'parent' && kind !== 'tutor') {
      errors.push({ field: 'kind', message: 'Chọn loại tài khoản: phụ huynh hoặc gia sư' });
    }
    const email = text(body, 'email').toLowerCase();
    const phone = normalizePhone(text(body, 'phone'));
    if (!email && !phone) {
      errors.push({ field: 'email', message: 'Nhập thư điện tử hoặc số điện thoại' });
    }
    if (email && !EMAIL.test(email)) {
      errors.push({ field: 'email', message: 'Thư điện tử không hợp lệ' });
    }
    if (phone && !PHONE.test(phone)) {
      errors.push({ field: 'phone', message: 'Số điện thoại gồm 10 chữ số, bắt đầu bằng 0' });
    }
    const displayName = text(body, 'display_name');
    if (displayName.length < 1 || displayName.length > 80) {
      errors.push({ field: 'display_name', message: 'Tên hiển thị từ 1 đến 80 ký tự' });
    }
    const password = typeof body?.password === 'string' ? body.password : '';
    errors.push(...checkMarketPassword(password));
    const accepted = Array.isArray(body?.accepted_document_ids)
      ? (body.accepted_document_ids as unknown[]).filter((id): id is string => typeof id === 'string' && UUID.test(id))
      : [];
    if (errors.length > 0) {
      throw validationError(errors);
    }
    const role = kind as 'parent' | 'tutor';
    const required = (await this.latestDocuments()).filter((row) => REQUIRED_DOCUMENTS[role].includes(row.kind));
    if (required.length < REQUIRED_DOCUMENTS[role].length) {
      throw new ApplicationError('ERR_CONFLICT', 'Chợ chưa đăng đủ văn bản pháp lý, chưa nhận đăng ký');
    }
    const missing = required.filter((row) => !accepted.includes(row.id));
    if (missing.length > 0) {
      throw validationError(
        missing.map((row) => ({
          field: 'accepted_document_ids',
          message: `Cần đồng ý: ${row.title} (phiên bản ${row.version})`,
        })),
      );
    }
    const database = this.market.database;
    const taken = await database
      .selectFrom('market_accounts')
      .select('id')
      .where((eb) => eb.or([...(email ? [eb('email', '=', email)] : []), ...(phone ? [eb('phone', '=', phone)] : [])]))
      .executeTakeFirst();
    if (taken) {
      throw validationError([
        { field: email ? 'email' : 'phone', message: 'Đã có tài khoản dùng thư điện tử hoặc số điện thoại này' },
      ]);
    }
    const passwordHash = await hash(password);
    const account = await database.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('market_accounts')
        .values({
          kind: role,
          email: email || null,
          phone: phone || null,
          password_hash: passwordHash,
          display_name: displayName,
          verified_at: null,
          locked_until: null,
          last_login_at: null,
        })
        .returning(['id', 'email', 'phone'])
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('market_consents')
        .values(required.map((document) => ({ account_id: row.id, document_id: document.id, child_id: null })))
        .execute();
      if (role === 'tutor') {
        await trx.insertInto('market_tutor_profiles').values({ account_id: row.id }).execute();
      }
      return row;
    });
    const channel = await this.sendCode(account);
    await this.market.audit({
      actorType: 'account',
      actorId: account.id,
      action: 'account.register',
      details: { kind: role, documents: required.map((row) => `${row.kind}@${row.version}`) },
    });
    return { ...(await this.openSession(account.id)), status: 'pending', code_sent_to: channel };
  }

  async verify(request: Request, body: RequestBody) {
    const account = await this.market.account(request, { allowPending: true });
    if (account.status === 'active') {
      return { status: 'active' };
    }
    const code = text(body, 'code');
    const row = await this.market.database
      .selectFrom('market_verification_codes')
      .select(['id', 'code_hash', 'attempts', 'expires_at'])
      .where('account_id', '=', account.id)
      .where('purpose', '=', 'verify')
      .where('used_at', 'is', null)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    const now = this.market.now();
    if (!row || row.expires_at.getTime() <= now.getTime() || row.attempts >= MARKET_CODE_MAX_ATTEMPTS) {
      throw validationError([{ field: 'code', message: 'Mã đã hết hạn hoặc nhập sai quá số lần, hãy lấy mã mới' }]);
    }
    if (!/^\d{6}$/.test(code) || !sameHash(row.code_hash, hashVerificationCode(account.id, code))) {
      await this.market.database
        .updateTable('market_verification_codes')
        .set((eb) => ({ attempts: eb('attempts', '+', 1) }))
        .where('id', '=', row.id)
        .execute();
      throw validationError([{ field: 'code', message: 'Mã xác nhận không đúng' }]);
    }
    await this.market.database.transaction().execute(async (trx) => {
      await trx.updateTable('market_verification_codes').set({ used_at: now }).where('id', '=', row.id).execute();
      await trx
        .updateTable('market_accounts')
        .set({ status: 'active', verified_at: now, updated_at: now })
        .where('id', '=', account.id)
        .execute();
    });
    await this.market.audit({ actorType: 'account', actorId: account.id, action: 'account.verify' });
    return { status: 'active' };
  }

  async resend(request: Request) {
    const account = await this.market.account(request, { allowPending: true });
    if (account.status === 'active') {
      throw new ApplicationError('ERR_CONFLICT', 'Tài khoản đã xác nhận');
    }
    const last = await this.market.database
      .selectFrom('market_verification_codes')
      .select('created_at')
      .where('account_id', '=', account.id)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (last && this.market.now().getTime() - last.created_at.getTime() < RESEND_INTERVAL_MS) {
      throw new ApplicationError('ERR_CONFLICT', 'Vui lòng chờ một phút rồi lấy mã mới');
    }
    const row = await this.market.database
      .selectFrom('market_accounts')
      .select(['id', 'email', 'phone'])
      .where('id', '=', account.id)
      .executeTakeFirstOrThrow();
    return { code_sent_to: await this.sendCode(row) };
  }

  async login(request: Request, body: RequestBody) {
    await this.market.assertMarketHost(request);
    const login = text(body, 'login');
    const password = typeof body?.password === 'string' ? body.password : '';
    const email = login.includes('@') ? login.toLowerCase() : null;
    const phone = email ? null : normalizePhone(login);
    const row = login
      ? await this.market.database
          .selectFrom('market_accounts')
          .select(['id', 'kind', 'password_hash', 'status', 'failed_login_count', 'locked_until'])
          .where(email ? 'email' : 'phone', '=', (email ?? phone) as string)
          .executeTakeFirst()
      : undefined;
    const now = this.market.now();
    if (row?.locked_until && row.locked_until.getTime() > now.getTime()) {
      throw new ApplicationError('ERR_FORBIDDEN', 'Tài khoản tạm khóa do đăng nhập sai nhiều lần, thử lại sau 15 phút');
    }
    this.placeholder ??= hash('mat-khau-gia-de-can-thoi-gian-1');
    const passwordHash = row?.password_hash ?? (await this.placeholder);
    const valid = await verify(passwordHash, password).catch(() => false);
    if (!row || !row.password_hash || !valid || row.status === 'closed') {
      if (row) {
        const failures = row.failed_login_count + 1;
        await this.market.database
          .updateTable('market_accounts')
          .set({
            failed_login_count: failures >= LOCK_AFTER_FAILURES ? 0 : failures,
            locked_until: failures >= LOCK_AFTER_FAILURES ? new Date(now.getTime() + LOCK_MS) : null,
          })
          .where('id', '=', row.id)
          .execute();
      }
      throw unauthenticatedError();
    }
    if (row.status === 'locked') {
      throw new ApplicationError('ERR_FORBIDDEN', 'Tài khoản đã bị khóa, liên hệ bộ phận hỗ trợ của chợ');
    }
    await this.market.database
      .updateTable('market_accounts')
      .set({ failed_login_count: 0, locked_until: null, last_login_at: now })
      .where('id', '=', row.id)
      .execute();
    await this.market.audit({ actorType: 'account', actorId: row.id, action: 'account.login' });
    return { ...(await this.openSession(row.id)), status: row.status };
  }

  async logout(request: Request) {
    await this.market.account(request, { allowPending: true });
    const token = (request.header('authorization') ?? '').split(' ')[1] ?? '';
    await this.market.database
      .updateTable('market_sessions')
      .set({ revoked_at: this.market.now() })
      .where('token_hash', '=', hashSessionToken(token))
      .execute();
  }

  async me(request: Request) {
    const account = await this.market.account(request, { allowPending: true });
    const row = await this.market.database
      .selectFrom('market_accounts')
      .select(['email', 'phone', 'verified_at', 'created_at'])
      .where('id', '=', account.id)
      .executeTakeFirstOrThrow();
    return {
      ...account,
      email: row.email,
      phone: row.phone,
      verified_at: row.verified_at,
      consents_needed: await this.missingConsents(account.id, account.kind),
    };
  }

  // Đồng ý phiên bản mới của văn bản bắt buộc
  async accept(request: Request, documentId: string) {
    const account = await this.market.account(request, { allowPending: true });
    const needed = await this.missingConsents(account.id, account.kind);
    if (!needed.some((row) => row.id === documentId)) {
      throw marketNotFound();
    }
    await this.market.database
      .insertInto('market_consents')
      .values({ account_id: account.id, document_id: documentId, child_id: null })
      .execute();
    await this.market.audit({
      actorType: 'account',
      actorId: account.id,
      action: 'consent.accept',
      target: documentId,
    });
    return { consents_needed: await this.missingConsents(account.id, account.kind) };
  }

  // Tài khoản đã đồng ý đủ văn bản hiện hành; dùng trước các việc của phụ huynh, gia sư
  async requireReady(request: Request, kind: 'parent' | 'tutor'): Promise<MarketAccount> {
    const account = await this.market.account(request);
    if (account.kind !== kind) {
      throw new ApplicationError(
        'ERR_FORBIDDEN',
        kind === 'parent' ? 'Chỉ tài khoản phụ huynh' : 'Chỉ tài khoản gia sư',
      );
    }
    if ((await this.missingConsents(account.id, account.kind)).length > 0) {
      throw new ApplicationError('ERR_CONFLICT', 'Cần đồng ý phiên bản mới của văn bản pháp lý trước khi dùng tiếp');
    }
    return account;
  }
}

@Controller('market')
@PublicEndpoint()
export class MarketAccountsController {
  constructor(private readonly accounts: MarketAccountsService) {}

  @Get('public/site')
  site(@Req() request: Request) {
    return this.accounts.site(request);
  }

  @Get('public/documents/:kind')
  document(@Req() request: Request, @Param('kind') kind: string) {
    return this.accounts.document(request, kind);
  }

  @Post('auth/register')
  register(@Req() request: Request, @Body() body: RequestBody) {
    return this.accounts.register(request, body);
  }

  @Post('auth/verify')
  @HttpCode(200)
  verify(@Req() request: Request, @Body() body: RequestBody) {
    return this.accounts.verify(request, body);
  }

  @Post('auth/resend')
  @HttpCode(200)
  resend(@Req() request: Request) {
    return this.accounts.resend(request);
  }

  @Post('auth/login')
  @HttpCode(200)
  login(@Req() request: Request, @Body() body: RequestBody) {
    return this.accounts.login(request, body);
  }

  @Post('auth/logout')
  @HttpCode(204)
  logout(@Req() request: Request) {
    return this.accounts.logout(request);
  }

  @Get('me')
  me(@Req() request: Request) {
    return this.accounts.me(request);
  }

  @Post('me/consents/:documentId')
  @HttpCode(200)
  accept(@Req() request: Request, @Param('documentId') documentId: string) {
    return this.accounts.accept(request, documentId);
  }
}
