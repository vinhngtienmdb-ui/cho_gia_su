import type { ColumnType, Generated } from 'kysely';
import type { CreatedTimestamp, MarketSchoolLevel, UpdatedTimestamp } from '../schema.js';
import type { MarketContentKind } from './dt-27g-xac-minh-gia-su.js';

// Đặt buổi, thanh toán giữ tiền, tranh chấp, hoa hồng của chợ gia sư (DT-27 phần 27h, YCTD-258; marketplace 0020)
export type MarketBookingStatus =
  'held' | 'paid' | 'completed' | 'disputed' | 'disbursed' | 'refunded' | 'cancelled' | 'expired';
export type MarketPaymentStatus = 'pending' | 'held' | 'released' | 'refunded' | 'settled' | 'failed';
export type MarketDisputeDecision = 'refund_full' | 'refund_partial' | 'release';

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

export interface MarketBookingsTable {
  id: Generated<string>;
  parent_account_id: string;
  child_id: string | null;
  child_name: string;
  tutor_account_id: string;
  subject: string;
  school_level: MarketSchoolLevel;
  grade: number;
  content_kind: MarketContentKind;
  starts_at: Date;
  minutes: number;
  price: number;
  commission: number;
  status: MarketBookingStatus;
  hold_expires_at: Date;
  no_assignment_attested: Generated<boolean>;
  completed_at: Nullable<Date>;
  complaint_deadline: Nullable<Date>;
  cancelled_by: Nullable<'parent' | 'tutor' | 'system'>;
  cancelled_at: Nullable<Date>;
  cancel_reason: Nullable<string>;
  // Ghi hình bắt buộc với trẻ vị thành niên, đồng ý của phụ huynh khi đặt (27i, marketplace 0030)
  recording_required: Generated<boolean>;
  recording_consented: Generated<boolean>;
  created_at: CreatedTimestamp;
  updated_at: UpdatedTimestamp;
}

export interface MarketPaymentsTable {
  id: Generated<string>;
  booking_id: string;
  provider: string;
  provider_ref: string;
  amount: number;
  commission: number;
  status: MarketPaymentStatus;
  held_for_dispute: Generated<boolean>;
  refunded_amount: Generated<number>;
  released_amount: Generated<number>;
  commission_taken: Generated<number>;
  created_at: CreatedTimestamp;
  updated_at: UpdatedTimestamp;
}

export interface MarketPaymentEventsTable {
  id: Generated<string>;
  provider: string;
  event_id: string;
  type: string;
  provider_ref: string;
  payload: ColumnType<unknown, string, string>;
  received_at: CreatedTimestamp;
}

export interface MarketDisputesTable {
  id: Generated<string>;
  booking_id: string;
  reason: string;
  status: Generated<'open' | 'decided' | 'appealed' | 'final'>;
  decision: Nullable<MarketDisputeDecision>;
  refund_amount: Nullable<number>;
  decision_note: Nullable<string>;
  decided_by: Nullable<string>;
  decided_at: Nullable<Date>;
  appeal_reason: Nullable<string>;
  appealed_by: Nullable<string>;
  appealed_at: Nullable<Date>;
  final_decision: Nullable<MarketDisputeDecision>;
  final_refund_amount: Nullable<number>;
  final_note: Nullable<string>;
  final_decided_by: Nullable<string>;
  final_decided_at: Nullable<Date>;
  created_at: CreatedTimestamp;
}

export interface MarketDisputeStatementsTable {
  id: Generated<string>;
  dispute_id: string;
  author_account_id: string;
  role: 'parent' | 'tutor';
  body: string;
  created_at: CreatedTimestamp;
}

export interface MarketCommissionRulesTable {
  id: Generated<string>;
  content_kind: MarketContentKind | null;
  tutor_account_id: string | null;
  percent: ColumnType<string, string | number, string | number>;
  minimum: Generated<number>;
  effective_from: string;
  created_by: string;
  created_at: CreatedTimestamp;
}

declare module '../schema.js' {
  interface MarketplaceDatabase {
    market_bookings: MarketBookingsTable;
    market_payments: MarketPaymentsTable;
    market_payment_events: MarketPaymentEventsTable;
    market_disputes: MarketDisputesTable;
    market_dispute_statements: MarketDisputeStatementsTable;
    market_commission_rules: MarketCommissionRulesTable;
  }
}
