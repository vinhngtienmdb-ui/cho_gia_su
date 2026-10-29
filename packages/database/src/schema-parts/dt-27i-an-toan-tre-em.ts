import type { ColumnType, Generated } from 'kysely';
import type { CreatedTimestamp } from '../schema.js';

// An toàn trẻ em và kiểm duyệt ở chợ gia sư (DT-27 phần 27i, YCTD-259; marketplace 0030)
export type MarketReportTarget = 'profile' | 'message' | 'session' | 'review' | 'system';
export type MarketReportCategory = 'child_safety' | 'harassment' | 'fraud' | 'fee_evasion' | 'wrong_content';
export type MarketReportSeverity = 'low' | 'medium' | 'high' | 'critical';
export type MarketReportDecision = 'suspend' | 'warn' | 'dismiss';
export type MarketRecordingStatus = 'recording' | 'processing' | 'ready' | 'failed' | 'deleted';

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

export interface MarketMessageThreadsTable {
  id: Generated<string>;
  parent_account_id: string;
  tutor_account_id: string;
  flagged_at: Nullable<Date>;
  created_at: CreatedTimestamp;
  last_message_at: ColumnType<Date, Date | undefined, Date>;
}

export interface MarketMessagesTable {
  id: Generated<string>;
  thread_id: string;
  author_account_id: string;
  role: 'parent' | 'tutor';
  body: string;
  original_body: Nullable<string>;
  findings: ColumnType<unknown, string | undefined, string>;
  created_at: CreatedTimestamp;
}

export interface MarketReportsTable {
  id: Generated<string>;
  reporter_account_id: string | null;
  subject_account_id: string;
  target_kind: MarketReportTarget;
  target_id: string | null;
  category: MarketReportCategory;
  severity: MarketReportSeverity;
  description: string;
  status: Generated<'open' | 'decided' | 'appealed' | 'final'>;
  due_at: Date;
  assigned_to: Nullable<string>;
  decision: Nullable<MarketReportDecision>;
  decision_note: Nullable<string>;
  decided_by: Nullable<string>;
  decided_at: Nullable<Date>;
  appeal_reason: Nullable<string>;
  appealed_at: Nullable<Date>;
  final_decision: Nullable<MarketReportDecision>;
  final_note: Nullable<string>;
  final_decided_by: Nullable<string>;
  final_decided_at: Nullable<Date>;
  created_at: CreatedTimestamp;
}

export interface MarketTutorSuspensionsTable {
  id: Generated<string>;
  tutor_account_id: string;
  report_id: string | null;
  reason: string;
  started_by: string;
  started_at: CreatedTimestamp;
  lifted_by: Nullable<string>;
  lifted_at: Nullable<Date>;
  lift_note: Nullable<string>;
}

export interface MarketModerationLogTable {
  id: Generated<string>;
  report_id: string | null;
  subject_account_id: string | null;
  actor_type: 'account' | 'operator' | 'system';
  actor_id: string | null;
  action: string;
  note: string | null;
  created_at: CreatedTimestamp;
}

export interface MarketSessionRecordingsTable {
  id: Generated<string>;
  booking_id: string;
  room_name: string;
  status: MarketRecordingStatus;
  egress_id: Nullable<string>;
  file_key: string;
  size_bytes: ColumnType<string | null, number | null | undefined, number | null>;
  started_at: Date;
  ended_at: Nullable<Date>;
  retain_until: Nullable<Date>;
  deleted_at: Nullable<Date>;
}

export interface MarketRecordingViewsTable {
  id: Generated<string>;
  recording_id: string;
  viewer_type: 'account' | 'operator';
  viewer_id: string;
  viewed_at: CreatedTimestamp;
}

export interface MarketEvidenceExportsTable {
  id: Generated<string>;
  report_id: string;
  operator_id: string;
  authority: string;
  request_reference: string;
  created_at: CreatedTimestamp;
}

declare module '../schema.js' {
  interface MarketplaceDatabase {
    market_message_threads: MarketMessageThreadsTable;
    market_messages: MarketMessagesTable;
    market_reports: MarketReportsTable;
    market_tutor_suspensions: MarketTutorSuspensionsTable;
    market_moderation_log: MarketModerationLogTable;
    market_session_recordings: MarketSessionRecordingsTable;
    market_recording_views: MarketRecordingViewsTable;
    market_evidence_exports: MarketEvidenceExportsTable;
  }
}
