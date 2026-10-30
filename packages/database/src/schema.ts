import type { ColumnType, Generated } from 'kysely';

// Kiểu dữ liệu các bảng của cơ sở dữ liệu Chợ gia sư, khớp với tệp thay đổi cấu trúc ở migrations/. Nguồn gốc: cơ sở dữ liệu
// `marketplace` của School Management (DT-27 phần 27f, YCTD-256), tách thành sản phẩm riêng ngày 2026-10-30 (YCTD-393)
export type CreatedTimestamp = ColumnType<Date, Date | undefined, never>;
export type UpdatedTimestamp = ColumnType<Date, Date | undefined, Date>;

// Bảng theo từng phần nằm ở schema-parts/<phần>.ts: mỗi tệp thêm bảng vào MarketplaceDatabase bằng declare module
export type * from './schema-parts/dt-27g-xac-minh-gia-su.js';
export type * from './schema-parts/dt-27h-dat-buoi-thanh-toan.js';
export type * from './schema-parts/dt-27i-an-toan-tre-em.js';
export type * from './schema-parts/dt-27j-phong-hoc-video.js';
export type * from './schema-parts/yctd-364-danh-gia.js';
export type * from './schema-parts/yctd-365-goi-buoi.js';
export type * from './schema-parts/quan-tri.js';

export type MarketAccountKind = 'parent' | 'tutor';
export type MarketAccountStatus = 'pending' | 'active' | 'locked' | 'closed';
export type MarketLegalDocumentKind = 'terms' | 'privacy' | 'parent_consent' | 'tutor_terms';
export type MarketSchoolLevel = 'TH' | 'THCS' | 'THPT';

export interface MarketAccountsTable {
  id: Generated<string>;
  kind: MarketAccountKind;
  email: string | null;
  phone: string | null;
  password_hash: string | null;
  display_name: string;
  status: Generated<MarketAccountStatus>;
  failed_login_count: Generated<number>;
  locked_until: Date | null;
  verified_at: Date | null;
  last_login_at: Date | null;
  created_at: CreatedTimestamp;
  updated_at: UpdatedTimestamp;
}

export interface MarketVerificationCodesTable {
  id: Generated<string>;
  account_id: string;
  channel: 'email' | 'sms';
  purpose: 'verify' | 'reset';
  code_hash: string;
  attempts: Generated<number>;
  expires_at: Date;
  used_at: Date | null;
  created_at: CreatedTimestamp;
}

export interface MarketSessionsTable {
  id: Generated<string>;
  account_id: string;
  token_hash: string;
  created_at: CreatedTimestamp;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface MarketExternalIdentitiesTable {
  provider: string;
  subject: string;
  account_id: string;
  created_at: CreatedTimestamp;
}

export interface MarketLegalDocumentsTable {
  id: Generated<string>;
  kind: MarketLegalDocumentKind;
  version: number;
  title: string;
  body: string;
  published_by: string;
  published_at: CreatedTimestamp;
}

export interface MarketConsentsTable {
  id: Generated<string>;
  account_id: string;
  document_id: string;
  child_id: string | null;
  accepted_at: CreatedTimestamp;
  withdrawn_at: Date | null;
}

export interface MarketChildrenTable {
  id: Generated<string>;
  parent_account_id: string;
  display_name: string;
  birth_year: number;
  school_level: MarketSchoolLevel;
  grade: number;
  created_at: CreatedTimestamp;
  updated_at: UpdatedTimestamp;
}

// Trạng thái duyệt hồ sơ: 27f có nháp, chờ duyệt; 27g thêm đã duyệt, bị từ chối và các cột duyệt (marketplace 0010)
export type MarketTutorProfileStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface MarketTutorProfilesTable {
  account_id: string;
  headline: Generated<string>;
  bio: Generated<string>;
  status: Generated<MarketTutorProfileStatus>;
  teaching_language: Generated<string>;
  review_note: ColumnType<string | null, string | null | undefined, string | null>;
  reviewed_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  reviewed_by: ColumnType<string | null, string | null | undefined, string | null>;
  published_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  updated_at: UpdatedTimestamp;
}

export interface MarketProvidersTable {
  id: Generated<string>;
  owner_account_id: string;
  kind: 'individual' | 'organization';
  name: string;
  business_registration_no: string | null;
  created_at: CreatedTimestamp;
  updated_at: UpdatedTimestamp;
}

export interface MarketAuditLogTable {
  id: Generated<string>;
  actor_type: 'account' | 'operator' | 'system';
  actor_id: string | null;
  action: string;
  target: string | null;
  details: ColumnType<unknown, string | undefined, string>;
  created_at: CreatedTimestamp;
}

export interface MarketplaceDatabase {
  market_accounts: MarketAccountsTable;
  market_verification_codes: MarketVerificationCodesTable;
  market_sessions: MarketSessionsTable;
  market_external_identities: MarketExternalIdentitiesTable;
  market_legal_documents: MarketLegalDocumentsTable;
  market_consents: MarketConsentsTable;
  market_children: MarketChildrenTable;
  market_tutor_profiles: MarketTutorProfilesTable;
  market_providers: MarketProvidersTable;
  market_audit_log: MarketAuditLogTable;
}
