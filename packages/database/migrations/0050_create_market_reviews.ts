import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// Đánh giá gia sư, đăng nhập định danh của phụ huynh, con đọc tin nhắn (YCTD-364; thiết kế Eric duyệt ngày 2026-10-28; tài liệu 47 mục
// 19.13). Claude tự chọn theo ủy quyền của Eric ngày 2026-10-11:
// - đánh giá (`market_reviews`): mỗi buổi đã dạy một đánh giá của phụ huynh của buổi; 1 đến 5 sao, bốn tiêu chí không bắt buộc, nhận xét
//   đã che thông tin liên lạc ngoài; chờ nhân viên nền tảng duyệt rồi mới hiện; gia sư trả lời một lần đánh giá đã hiện;
// - đăng nhập định danh của phụ huynh: lượt chuyển hướng có mục đích `link` (phụ huynh đang đăng nhập liên kết định danh);
// - con đọc tin nhắn (`market_children.reads_messages`): phụ huynh bật cho từng con; con chỉ đọc trên máy của phụ huynh, không gửi được
export const migration: Migration = {
  async up(database) {
    await database.schema
      .createTable('market_reviews')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('booking_id', 'uuid', (column) => column.notNull().unique().references('market_bookings.id'))
      .addColumn('parent_account_id', 'uuid', (column) => column.notNull().references('market_accounts.id'))
      .addColumn('tutor_account_id', 'uuid', (column) => column.notNull().references('market_accounts.id'))
      .addColumn('grade', 'smallint', (column) => column.notNull())
      .addColumn('rating', 'smallint', (column) => column.notNull())
      .addColumn('punctuality', 'smallint')
      .addColumn('clarity', 'smallint')
      .addColumn('progress', 'smallint')
      .addColumn('communication', 'smallint')
      .addColumn('body', 'text', (column) => column.notNull())
      .addColumn('original_body', 'text')
      .addColumn('status', 'text', (column) => column.notNull().defaultTo('pending'))
      .addColumn('moderation_note', 'text')
      .addColumn('moderated_by', 'text')
      .addColumn('moderated_at', 'timestamptz')
      .addColumn('reply_body', 'text')
      .addColumn('replied_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint('market_reviews_status_check', sql`status in ('pending', 'published', 'rejected')`)
      .addCheckConstraint(
        'market_reviews_scores_check',
        sql`rating between 1 and 5 and coalesce(punctuality, 1) between 1 and 5 and coalesce(clarity, 1) between 1 and 5 and coalesce(progress, 1) between 1 and 5 and coalesce(communication, 1) between 1 and 5`,
      )
      .execute();
    await database.schema
      .createIndex('market_reviews_tutor')
      .on('market_reviews')
      .columns(['tutor_account_id', 'status'])
      .execute();

    await sql`alter table market_oidc_requests drop constraint market_oidc_requests_purpose_check`.execute(database);
    await sql`alter table market_oidc_requests add constraint market_oidc_requests_purpose_check check (purpose in ('verify', 'login', 'link'))`.execute(
      database,
    );

    await database.schema
      .alterTable('market_children')
      .addColumn('reads_messages', 'boolean', (column) => column.notNull().defaultTo(false))
      .execute();
  },
  async down(database) {
    await database.schema.alterTable('market_children').dropColumn('reads_messages').execute();
    await sql`delete from market_oidc_requests where purpose = 'link'`.execute(database);
    await sql`alter table market_oidc_requests drop constraint market_oidc_requests_purpose_check`.execute(database);
    await sql`alter table market_oidc_requests add constraint market_oidc_requests_purpose_check check (purpose in ('verify', 'login'))`.execute(
      database,
    );
    await database.schema.dropTable('market_reviews').execute();
  },
};
