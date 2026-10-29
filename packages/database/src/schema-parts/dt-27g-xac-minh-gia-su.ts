import type { ColumnType, Generated } from 'kysely';
import type { CreatedTimestamp, MarketSchoolLevel } from '../schema.js';

// Hồ sơ gia sư, xác minh từng bậc, khai giáo viên đang dạy ở trường, lượt OIDC của chợ (DT-27 phần 27g, YCTD-257; marketplace 0010)
export type MarketContentKind = 'curriculum' | 'enrichment';
export type MarketVerificationKind = 'identity' | 'degree' | 'criminal_record' | 'business_registration';
export type MarketVerificationStatus = 'pending' | 'approved' | 'rejected';
export type MarketTutorDocumentKind = 'degree' | 'criminal_record' | 'business_registration';

export interface MarketTutorSubjectsTable {
  id: Generated<string>;
  account_id: string;
  subject: string;
  school_level: MarketSchoolLevel;
  grade_from: number;
  grade_to: number;
  content_kind: MarketContentKind;
  price_per_session: number;
  session_minutes: number;
  created_at: CreatedTimestamp;
}

export interface MarketTutorAvailabilityTable {
  id: Generated<string>;
  account_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
}

export interface MarketTutorDocumentsTable {
  id: Generated<string>;
  account_id: string;
  kind: MarketTutorDocumentKind;
  file_key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: CreatedTimestamp;
}

export interface MarketTutorVerificationsTable {
  account_id: string;
  kind: MarketVerificationKind;
  status: MarketVerificationStatus;
  details: ColumnType<Record<string, unknown>, string | undefined, string>;
  document_id: string | null;
  submitted_at: ColumnType<Date, Date | undefined, Date>;
  decided_at: Date | null;
  decided_by: string | null;
  note: string | null;
  valid_until: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface MarketTutorSchoolRolesTable {
  account_id: string;
  school_name: string;
  is_public: boolean;
  subjects: string;
  grades: string;
  declared_at: ColumnType<Date, Date | undefined, Date>;
  form03_generated_at: Date | null;
}

export interface MarketOidcRequestsTable {
  state_hash: string;
  // 'link': phụ huynh liên kết định danh (YCTD-364, marketplace 0050)
  purpose: 'verify' | 'login' | 'link';
  provider: string;
  account_id: string | null;
  nonce: string;
  code_verifier: string;
  redirect_uri: string;
  expires_at: Date;
  used_at: Date | null;
}

declare module '../schema.js' {
  interface MarketplaceDatabase {
    market_tutor_subjects: MarketTutorSubjectsTable;
    market_tutor_availability: MarketTutorAvailabilityTable;
    market_tutor_documents: MarketTutorDocumentsTable;
    market_tutor_verifications: MarketTutorVerificationsTable;
    market_tutor_school_roles: MarketTutorSchoolRolesTable;
    market_oidc_requests: MarketOidcRequestsTable;
  }
}
