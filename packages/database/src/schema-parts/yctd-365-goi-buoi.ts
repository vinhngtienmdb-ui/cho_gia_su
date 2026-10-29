import type { ColumnType, Generated } from 'kysely';

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

// Gói buổi (YCTD-365, GD-165; marketplace 0051)
export type MarketPackageStatus = 'held' | 'paid' | 'cancelled' | 'expired' | 'refunded' | 'used_up';

export interface MarketPackagesTable {
  id: Generated<string>;
  parent_account_id: string;
  child_id: string | null;
  child_name: string;
  tutor_account_id: string;
  subject: string;
  school_level: 'TH' | 'THCS' | 'THPT';
  grade: number;
  content_kind: 'curriculum' | 'enrichment';
  session_minutes: number;
  sessions_total: number;
  price_total: number;
  price_per_session: number;
  commission_per_session: number;
  no_assignment_attested: Generated<boolean>;
  recording_required: Generated<boolean>;
  status: MarketPackageStatus;
  hold_expires_at: Date;
  paid_at: Nullable<Date>;
  expires_at: Nullable<Date>;
  provider: string;
  provider_ref: string;
  refunded_amount: Generated<number>;
  closed_reason: Nullable<string>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

declare module '../schema.js' {
  interface MarketplaceDatabase {
    market_packages: MarketPackagesTable;
  }
}

declare module './dt-27g-xac-minh-gia-su.js' {
  interface MarketTutorSubjectsTable {
    package_sessions: Nullable<number>;
    package_price: Nullable<number>;
  }
}

declare module './dt-27h-dat-buoi-thanh-toan.js' {
  interface MarketBookingsTable {
    package_id: Nullable<string>;
  }
}
