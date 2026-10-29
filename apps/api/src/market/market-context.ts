import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  createDatabase,
  readMarketSettings,
  type MarketAdminRole,
  type MarketplaceDatabase,
  type MarketSettings,
} from '@cho-gia-su/database';
import type { Request } from 'express';
import type { Kysely } from 'kysely';
import { API_CONFIGURATION, type ApiConfiguration } from '../common/configuration.js';
import { ApplicationError, Clock, readBearerToken, unauthenticatedError } from '../common/server.js';
import { hashSessionToken } from './market-tokens.js';

// Ngữ cảnh của chợ ở máy chủ API (nguồn: DT-27 phần 27f, YCTD-256 của School Management; tách thành sản phẩm riêng ở YCTD-384):
// - điểm cuối nằm ở `/api/v1/market/*`; máy chủ chỉ phục vụ chợ nên không còn kiểm tên miền, không còn công tắc bật chợ;
// - phiên của người dùng chợ là chuỗi ngẫu nhiên (bảng market_sessions); phiên quản trị là chuỗi ngẫu nhiên riêng (bảng
//   market_admin_sessions), cấp sau khi đăng nhập bằng mật khẩu và mã TOTP (admin-auth.ts)
export const MARKET_PATH_PREFIX = '/api/v1/market/';

export function marketNotFound(): ApplicationError {
  return new ApplicationError('ERR_NOT_FOUND', 'Không tìm thấy');
}

export interface MarketAccount {
  id: string;
  kind: 'parent' | 'tutor';
  display_name: string;
  status: 'pending' | 'active' | 'locked' | 'closed';
}

@Injectable()
export class MarketContext implements OnModuleDestroy {
  private connection: Kysely<MarketplaceDatabase> | null = null;

  constructor(
    @Inject(API_CONFIGURATION) private readonly configuration: ApiConfiguration,
    private readonly clock: Clock,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.connection?.destroy();
    this.connection = null;
  }

  get database(): Kysely<MarketplaceDatabase> {
    this.connection ??= createDatabase<MarketplaceDatabase>(this.configuration.databaseUrl, { max: 10 });
    return this.connection;
  }

  // Máy chủ luôn phục vụ chợ; giữ thuộc tính của bản gốc để việc định kỳ của các dịch vụ không phải sửa
  get available(): boolean {
    return true;
  }

  // Tên miền (kèm cổng nếu có) của ứng dụng chợ, ví dụ cho-gia-su.vn; dùng cho địa chỉ trả về sau đăng nhập OIDC
  get host(): string | null {
    return this.configuration.marketHost;
  }

  now(): Date {
    return this.clock.now();
  }

  settings(): Promise<MarketSettings> {
    return readMarketSettings(this.database);
  }

  // Giữ tên hàm của bản gốc để các dịch vụ chợ không phải sửa: bản tách luôn phục vụ, chỉ đọc cấu hình
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async assertMarketHost(request: Request): Promise<{ settings: MarketSettings }> {
    return { settings: await this.settings() };
  }

  // Phần quản trị: mã phiên quản trị còn hạn, tài khoản đang dùng, vai trò được làm việc này; trả mã người quản trị. roles không truyền
  // là chỉ vai quản trị
  async operator(request: Request, roles: readonly MarketAdminRole[] = ['quan_tri']): Promise<string> {
    const token = readBearerToken(request.header('authorization'));
    const row = await this.database
      .selectFrom('market_admin_sessions')
      .innerJoin('market_admins', 'market_admins.id', 'market_admin_sessions.admin_id')
      .select([
        'market_admins.id',
        'market_admins.role',
        'market_admins.status',
        'market_admin_sessions.expires_at',
        'market_admin_sessions.revoked_at',
      ])
      .where('market_admin_sessions.token_hash', '=', hashSessionToken(token))
      .executeTakeFirst();
    if (!row || row.revoked_at || row.expires_at.getTime() <= this.clock.now().getTime() || row.status !== 'active') {
      throw unauthenticatedError();
    }
    if (!roles.includes(row.role)) {
      throw new ApplicationError('ERR_FORBIDDEN', 'Vai trò quản trị của bạn không được làm thao tác này');
    }
    return row.id;
  }

  // Tài khoản của phiên chợ đang dùng; tài khoản chưa xác nhận chỉ gọi được điểm cuối cho phép trạng thái chờ. Phiên của cả hai vai dùng
  // chung một ứng dụng (YCTD-368); điểm cuối riêng của một vai kiểm loại tài khoản qua requireReady
  async account(request: Request, options: { allowPending?: boolean } = {}): Promise<MarketAccount> {
    const token = readBearerToken(request.header('authorization'));
    const row = await this.database
      .selectFrom('market_sessions')
      .innerJoin('market_accounts', 'market_accounts.id', 'market_sessions.account_id')
      .select([
        'market_accounts.id',
        'market_accounts.kind',
        'market_accounts.display_name',
        'market_accounts.status',
        'market_sessions.expires_at',
        'market_sessions.revoked_at',
      ])
      .where('market_sessions.token_hash', '=', hashSessionToken(token))
      .executeTakeFirst();
    if (!row || row.revoked_at || row.expires_at.getTime() <= this.clock.now().getTime()) {
      throw unauthenticatedError();
    }
    if (row.status === 'locked' || row.status === 'closed' || (row.status === 'pending' && !options.allowPending)) {
      throw new ApplicationError('ERR_FORBIDDEN', 'Tài khoản chưa xác nhận hoặc đã khóa');
    }
    return { id: row.id, kind: row.kind, display_name: row.display_name, status: row.status };
  }

  async audit(entry: {
    actorType: 'account' | 'operator' | 'system';
    actorId?: string | null;
    action: string;
    target?: string | null;
    details?: unknown;
  }): Promise<void> {
    await this.database
      .insertInto('market_audit_log')
      .values({
        actor_type: entry.actorType,
        actor_id: entry.actorId ?? null,
        action: entry.action,
        target: entry.target ?? null,
        details: JSON.stringify(entry.details ?? {}),
      })
      .execute();
  }
}
