import type { ColumnType, Generated } from 'kysely';
import type { CreatedTimestamp, UpdatedTimestamp } from '../schema.js';

// Cấu hình chợ và tài khoản quản trị riêng (YCTD-393; migrations 0060). Ở School Management cấu hình chợ nằm ở `platform_settings` khóa
// `market` và người quản trị là nhân viên vận hành của nền tảng; bản tách giữ cả hai trong cơ sở dữ liệu của chợ. Quyết định của Eric
// ngày 2026-10-30: tài khoản quản trị riêng, mật khẩu và TOTP bắt buộc, ứng dụng quản trị riêng
export type MarketAdminRole = 'quan_tri' | 'ho_tro' | 'ke_toan';
export type MarketAdminStatus = 'active' | 'disabled';

export interface MarketSettingsTable {
  key: string;
  value: ColumnType<unknown, string, string>;
  updated_at: UpdatedTimestamp;
}

export interface MarketAdminsTable {
  id: Generated<string>;
  login: string;
  full_name: string;
  password_hash: string;
  // Khóa TOTP mã hóa AES-256-GCM bằng MARKET_SECRETS_KEY
  totp_secret_encrypted: string;
  totp_last_step: ColumnType<number | null, number | null | undefined, number | null>;
  role: MarketAdminRole;
  status: Generated<MarketAdminStatus>;
  failed_login_count: Generated<number>;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: CreatedTimestamp;
  updated_at: UpdatedTimestamp;
}

export interface MarketAdminRecoveryCodesTable {
  id: Generated<string>;
  admin_id: string;
  code_hash: string;
  used_at: Date | null;
}

export interface MarketAdminSessionsTable {
  id: Generated<string>;
  admin_id: string;
  token_hash: string;
  created_at: CreatedTimestamp;
  expires_at: Date;
  revoked_at: Date | null;
}

declare module '../schema.js' {
  interface MarketplaceDatabase {
    market_settings: MarketSettingsTable;
    market_admins: MarketAdminsTable;
    market_admin_recovery_codes: MarketAdminRecoveryCodesTable;
    market_admin_sessions: MarketAdminSessionsTable;
  }
}
