import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Req } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { MarketAdminRole, MarketplaceDatabase } from '@cho-gia-su/database';
import type { Request } from 'express';
import type { Kysely } from 'kysely';
import { API_CONFIGURATION, type ApiConfiguration } from '../common/configuration.js';
import { PublicEndpoint } from '../common/public-endpoint.js';
import type { RequestBody } from '../common/request-fields.js';
import {
  ApplicationError,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  readBearerToken,
  totpUri,
  unauthenticatedError,
  validationError,
  verifyTotp,
  type FieldError,
} from '../common/server.js';
import { ADMIN_ROLES, operatorRolesFor } from '../common/shared.js';
import { MarketContext } from '../market/market-context.js';
import { hashSessionToken, newSessionToken } from '../market/market-tokens.js';

// Tài khoản quản trị riêng của Chợ gia sư (YCTD-384, quyết định của Eric ngày 2026-10-30): thay nhân viên vận hành của nền tảng School
// Management. Đăng nhập bằng tên đăng nhập, mật khẩu và mã TOTP (hoặc một mã khôi phục dùng một lần); sai 5 lần khóa 15 phút; phiên 12
// giờ, lưu băm SHA-256 của mã phiên. Vai quan_tri tạo, khóa, mở tài khoản quản trị khác; khóa TOTP và mã khôi phục chỉ hiện một lần lúc tạo
export const ADMIN_SESSION_LIFETIME_MS = 12 * 3600 * 1000;
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
const LOCK_AFTER_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const TOTP_ISSUER = 'Chợ gia sư';
const LOGIN_PATTERN = /^[a-z0-9._-]{3,40}$/;

export interface NewAdmin {
  login: string;
  fullName: string;
  password: string;
  role: MarketAdminRole;
}

export interface CreatedAdmin {
  id: string;
  login: string;
  full_name: string;
  role: MarketAdminRole;
  totp_secret: string;
  totp_uri: string;
  recovery_codes: string[];
}

export function parseNewAdmin(body: RequestBody): NewAdmin {
  const errors: FieldError[] = [];
  const login = typeof body?.login === 'string' ? body.login.trim().toLowerCase() : '';
  if (!LOGIN_PATTERN.test(login)) {
    errors.push({
      field: 'login',
      message: 'Tên đăng nhập từ 3 đến 40 ký tự: chữ thường, số, dấu chấm, gạch ngang, gạch dưới',
    });
  }
  const fullName = typeof body?.full_name === 'string' ? body.full_name.trim() : '';
  if (fullName.length < 1 || fullName.length > 100) {
    errors.push({ field: 'full_name', message: 'Họ tên từ 1 đến 100 ký tự' });
  }
  const password = typeof body?.password === 'string' ? body.password : '';
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH || password.length > 200) {
    errors.push({ field: 'password', message: `Mật khẩu từ ${ADMIN_PASSWORD_MIN_LENGTH} đến 200 ký tự` });
  }
  const role = body?.role;
  if (typeof role !== 'string' || !(ADMIN_ROLES as readonly string[]).includes(role)) {
    errors.push({ field: 'role', message: 'Chọn vai trò quản trị' });
  }
  if (errors.length > 0) {
    throw validationError(errors);
  }
  return { login, fullName, password, role: role as MarketAdminRole };
}

// Tạo tài khoản quản trị kèm khóa TOTP và mã khôi phục; dùng chung cho điểm cuối của quản trị và lệnh tạo quản trị đầu tiên
export async function createAdmin(
  database: Kysely<MarketplaceDatabase>,
  secretsKey: Buffer,
  input: NewAdmin,
): Promise<CreatedAdmin> {
  const existing = await database
    .selectFrom('market_admins')
    .select('id')
    .where('login', '=', input.login)
    .executeTakeFirst();
  if (existing) {
    throw validationError([{ field: 'login', message: 'Tên đăng nhập đã có' }]);
  }
  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  const admin = await database.transaction().execute(async (transaction) => {
    const row = await transaction
      .insertInto('market_admins')
      .values({
        login: input.login,
        full_name: input.fullName,
        password_hash: await hash(input.password),
        totp_secret_encrypted: encryptSecret(secretsKey, secret),
        role: input.role,
        locked_until: null,
        last_login_at: null,
      })
      .returning(['id', 'login', 'full_name', 'role'])
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('market_admin_recovery_codes')
      .values(recoveryCodes.map((code) => ({ admin_id: row.id, code_hash: hashRecoveryCode(code), used_at: null })))
      .execute();
    return row;
  });
  return {
    ...admin,
    totp_secret: secret,
    totp_uri: totpUri(secret, admin.login, TOTP_ISSUER),
    recovery_codes: recoveryCodes,
  };
}

@Injectable()
export class AdminAccountsService {
  constructor(
    private readonly market: MarketContext,
    @Inject(API_CONFIGURATION) private readonly configuration: ApiConfiguration,
  ) {}

  // Mã TOTP đúng (không dùng lại bước đã dùng) hoặc một mã khôi phục chưa dùng; đúng thì ghi lại để không dùng lại được
  private async checkSecondFactor(
    admin: { id: string; totp_secret_encrypted: string; totp_last_step: number | string | null },
    code: string,
  ): Promise<boolean> {
    const database = this.market.database;
    const secret = decryptSecret(this.configuration.marketSecretsKey, admin.totp_secret_encrypted);
    const lastStep = admin.totp_last_step === null ? null : Number(admin.totp_last_step);
    const step = verifyTotp(secret, code, this.market.now(), { lastUsedStep: lastStep });
    if (step !== null) {
      const updated = await database
        .updateTable('market_admins')
        .set({ totp_last_step: step })
        .where('id', '=', admin.id)
        .where((expression) =>
          expression.or([expression('totp_last_step', 'is', null), expression('totp_last_step', '<', step)]),
        )
        .executeTakeFirst();
      return Number(updated.numUpdatedRows) === 1;
    }
    const used = await database
      .updateTable('market_admin_recovery_codes')
      .set({ used_at: this.market.now() })
      .where('admin_id', '=', admin.id)
      .where('code_hash', '=', hashRecoveryCode(code))
      .where('used_at', 'is', null)
      .executeTakeFirst();
    return Number(used.numUpdatedRows) === 1;
  }

  async login(body: RequestBody) {
    const login = typeof body?.login === 'string' ? body.login.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!login || !password || !code) {
      throw validationError([{ field: 'login', message: 'Nhập tên đăng nhập, mật khẩu và mã xác thực' }]);
    }
    const database = this.market.database;
    const now = this.market.now();
    const admin = await database
      .selectFrom('market_admins')
      .select([
        'id',
        'login',
        'full_name',
        'role',
        'status',
        'password_hash',
        'totp_secret_encrypted',
        'totp_last_step',
        'failed_login_count',
        'locked_until',
      ])
      .where('login', '=', login)
      .executeTakeFirst();
    if (admin?.locked_until && admin.locked_until.getTime() > now.getTime()) {
      throw new ApplicationError('ERR_FORBIDDEN', 'Tài khoản tạm khóa do đăng nhập sai nhiều lần, thử lại sau 15 phút');
    }
    const passwordOk = admin ? await verify(admin.password_hash, password) : false;
    const secondOk = admin && passwordOk ? await this.checkSecondFactor(admin, code) : false;
    if (!admin || !passwordOk || !secondOk || admin.status !== 'active') {
      if (admin) {
        const failures = admin.failed_login_count + 1;
        await database
          .updateTable('market_admins')
          .set({
            failed_login_count: failures >= LOCK_AFTER_FAILURES ? 0 : failures,
            locked_until: failures >= LOCK_AFTER_FAILURES ? new Date(now.getTime() + LOCK_MS) : null,
          })
          .where('id', '=', admin.id)
          .execute();
      }
      throw unauthenticatedError('Tên đăng nhập, mật khẩu hoặc mã xác thực không đúng');
    }
    const token = newSessionToken();
    await database
      .insertInto('market_admin_sessions')
      .values({
        admin_id: admin.id,
        token_hash: hashSessionToken(token),
        expires_at: new Date(now.getTime() + ADMIN_SESSION_LIFETIME_MS),
        revoked_at: null,
      })
      .execute();
    await database
      .updateTable('market_admins')
      .set({ failed_login_count: 0, locked_until: null, last_login_at: now })
      .where('id', '=', admin.id)
      .execute();
    await this.market.audit({ actorType: 'operator', actorId: admin.id, action: 'admin.login' });
    return {
      access_token: token,
      admin: { id: admin.id, login: admin.login, full_name: admin.full_name, role: admin.role },
    };
  }

  async logout(request: Request) {
    const token = readBearerToken(request.header('authorization'));
    await this.market.database
      .updateTable('market_admin_sessions')
      .set({ revoked_at: this.market.now() })
      .where('token_hash', '=', hashSessionToken(token))
      .where('revoked_at', 'is', null)
      .execute();
  }

  async me(request: Request) {
    const id = await this.market.operator(request, operatorRolesFor('market.view'));
    return this.market.database
      .selectFrom('market_admins')
      .select(['id', 'login', 'full_name', 'role'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }

  async changePassword(request: Request, body: RequestBody) {
    const id = await this.market.operator(request, operatorRolesFor('market.view'));
    const current = typeof body?.current_password === 'string' ? body.current_password : '';
    const next = typeof body?.new_password === 'string' ? body.new_password : '';
    if (next.length < ADMIN_PASSWORD_MIN_LENGTH || next.length > 200) {
      throw validationError([
        { field: 'new_password', message: `Mật khẩu mới từ ${ADMIN_PASSWORD_MIN_LENGTH} đến 200 ký tự` },
      ]);
    }
    const row = await this.market.database
      .selectFrom('market_admins')
      .select('password_hash')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    if (!(await verify(row.password_hash, current))) {
      throw validationError([{ field: 'current_password', message: 'Mật khẩu hiện tại không đúng' }]);
    }
    await this.market.database
      .updateTable('market_admins')
      .set({ password_hash: await hash(next), updated_at: this.market.now() })
      .where('id', '=', id)
      .execute();
    await this.market.audit({ actorType: 'operator', actorId: id, action: 'admin.password-change' });
  }

  async list(request: Request) {
    await this.market.operator(request, operatorRolesFor('admins.manage'));
    return this.market.database
      .selectFrom('market_admins')
      .select(['id', 'login', 'full_name', 'role', 'status', 'last_login_at', 'created_at'])
      .orderBy('login')
      .execute();
  }

  async create(request: Request, body: RequestBody) {
    const actorId = await this.market.operator(request, operatorRolesFor('admins.manage'));
    const created = await createAdmin(this.market.database, this.configuration.marketSecretsKey, parseNewAdmin(body));
    await this.market.audit({
      actorType: 'operator',
      actorId,
      action: 'admin.create',
      target: created.id,
      details: { login: created.login, role: created.role },
    });
    return created;
  }

  async setStatus(request: Request, adminId: string, status: 'active' | 'disabled') {
    const actorId = await this.market.operator(request, operatorRolesFor('admins.manage'));
    if (actorId === adminId) {
      throw new ApplicationError('ERR_CONFLICT', 'Không tự khóa tài khoản của mình');
    }
    const database = this.market.database;
    const updated = await database
      .updateTable('market_admins')
      .set({ status, updated_at: this.market.now() })
      .where('id', '=', adminId)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) !== 1) {
      throw new ApplicationError('ERR_NOT_FOUND', 'Không tìm thấy tài khoản quản trị');
    }
    if (status === 'disabled') {
      await database
        .updateTable('market_admin_sessions')
        .set({ revoked_at: this.market.now() })
        .where('admin_id', '=', adminId)
        .where('revoked_at', 'is', null)
        .execute();
    }
    await this.market.audit({ actorType: 'operator', actorId, action: `admin.${status}`, target: adminId });
    return { id: adminId, status };
  }
}

@Controller('market/admin/auth')
@PublicEndpoint()
export class AdminAuthController {
  constructor(private readonly admins: AdminAccountsService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: RequestBody) {
    return this.admins.login(body);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Req() request: Request) {
    return this.admins.logout(request);
  }

  @Get('me')
  me(@Req() request: Request) {
    return this.admins.me(request);
  }

  @Post('password')
  @HttpCode(204)
  changePassword(@Req() request: Request, @Body() body: RequestBody) {
    return this.admins.changePassword(request, body);
  }
}

@Controller('market/admin/accounts')
@PublicEndpoint()
export class AdminAccountsController {
  constructor(private readonly admins: AdminAccountsService) {}

  @Get()
  list(@Req() request: Request) {
    return this.admins.list(request);
  }

  @Post()
  create(@Req() request: Request, @Body() body: RequestBody) {
    return this.admins.create(request, body);
  }

  @Post(':id/disable')
  @HttpCode(200)
  disable(@Req() request: Request, @Param('id') id: string) {
    return this.admins.setStatus(request, id, 'disabled');
  }

  @Post(':id/enable')
  @HttpCode(200)
  enable(@Req() request: Request, @Param('id') id: string) {
    return this.admins.setStatus(request, id, 'active');
  }
}
