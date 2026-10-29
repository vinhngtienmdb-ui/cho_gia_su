import type { ColumnType, Generated } from 'kysely';

// Phòng học video của chợ gia sư (DT-27 phần 27j, YCTD-362; marketplace 0040)
export type MarketRoomRole = 'host' | 'student' | 'guardian';

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

export interface MarketRecordingConsentsTable {
  id: Generated<string>;
  parent_account_id: string;
  child_id: string;
  tutor_account_id: string;
  child_confirmed: Generated<boolean>;
  consented_at: Generated<Date>;
  withdrawn_at: Nullable<Date>;
}

export interface MarketSessionRoomsTable {
  booking_id: string;
  opened_at: Date;
  closed_at: Nullable<Date>;
  confirmed_at: Nullable<Date>;
  confirmed_by: Nullable<'tutor' | 'auto'>;
  tutor_note: Nullable<string>;
  incident: Nullable<string>;
}

export interface MarketSessionParticipantsTable {
  id: Generated<string>;
  booking_id: string;
  identity: string;
  account_id: string;
  role: MarketRoomRole;
  display_name: string;
  requested_at: Generated<Date>;
  admitted_at: Nullable<Date>;
  removed_at: Nullable<Date>;
  can_speak: Generated<boolean>;
  can_share: Generated<boolean>;
}

export interface MarketSessionAttendanceTable {
  id: Generated<string>;
  booking_id: string;
  identity: string;
  role: MarketRoomRole;
  joined_at: Date;
  left_at: Nullable<Date>;
  source: 'app' | 'webhook';
}

declare module '../schema.js' {
  interface MarketplaceDatabase {
    market_recording_consents: MarketRecordingConsentsTable;
    market_session_rooms: MarketSessionRoomsTable;
    market_session_participants: MarketSessionParticipantsTable;
    market_session_attendance: MarketSessionAttendanceTable;
  }
}
