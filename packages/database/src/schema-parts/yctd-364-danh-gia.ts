import type { ColumnType, Generated } from 'kysely';

// Đánh giá gia sư, con đọc tin nhắn (YCTD-364; marketplace 0050)
export type MarketReviewStatus = 'pending' | 'published' | 'rejected';

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

export interface MarketReviewsTable {
  id: Generated<string>;
  booking_id: string;
  parent_account_id: string;
  tutor_account_id: string;
  grade: number;
  rating: number;
  punctuality: Nullable<number>;
  clarity: Nullable<number>;
  progress: Nullable<number>;
  communication: Nullable<number>;
  body: string;
  original_body: Nullable<string>;
  status: Generated<MarketReviewStatus>;
  moderation_note: Nullable<string>;
  moderated_by: Nullable<string>;
  moderated_at: Nullable<Date>;
  reply_body: Nullable<string>;
  replied_at: Nullable<Date>;
  created_at: Generated<Date>;
}

declare module '../schema.js' {
  interface MarketplaceDatabase {
    market_reviews: MarketReviewsTable;
  }
}

// Con đọc tin nhắn khi phụ huynh cho (marketplace 0050): thêm cột vào bảng hồ sơ con của 27f
declare module '../schema.js' {
  interface MarketChildrenTable {
    reads_messages: Generated<boolean>;
  }
}
