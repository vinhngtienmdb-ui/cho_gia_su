import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// Gói buổi ở chợ gia sư (YCTD-365, GD-165; quyết định của Eric ngày 2026-10-29, cấu hình chợ chỉnh được):
// - gia sư đặt gói cho từng môn (số buổi, giá cả gói) cùng hồ sơ dạy (`market_tutor_subjects.package_*`);
// - phụ huynh mua gói (`market_packages`): giữ chỗ 30 phút, trả một lần qua nhà cung cấp (bản này giả lập); gói dùng trong 8 tuần kể từ
//   lúc trả tiền; giá mỗi buổi của gói là giá gói chia số buổi (làm tròn xuống; phần dư hoàn khi gói kết thúc);
// - mỗi buổi đặt từ gói là một buổi (`market_bookings.package_id`) đã trả tiền, có dòng thanh toán riêng đang giữ, giải ngân riêng sau
//   hạn khiếu nại như buổi lẻ;
// - hết hạn thì hoàn phần buổi chưa học theo giá mỗi buổi của gói; hủy gói trước buổi đầu thì hoàn đủ; gia sư bị tạm khóa thì hoàn phần
//   còn lại
export const migration: Migration = {
  async up(database) {
    await database.schema
      .alterTable('market_tutor_subjects')
      .addColumn('package_sessions', 'smallint')
      .addColumn('package_price', 'integer')
      .execute();
    await sql`alter table market_tutor_subjects add constraint market_tutor_subjects_package_check check ((package_sessions is null and package_price is null) or (package_sessions between 2 and 50 and package_price > 0))`.execute(
      database,
    );

    await database.schema
      .createTable('market_packages')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('parent_account_id', 'uuid', (column) => column.notNull().references('market_accounts.id'))
      .addColumn('child_id', 'uuid', (column) => column.references('market_children.id').onDelete('set null'))
      .addColumn('child_name', 'text', (column) => column.notNull())
      .addColumn('tutor_account_id', 'uuid', (column) => column.notNull().references('market_accounts.id'))
      .addColumn('subject', 'text', (column) => column.notNull())
      .addColumn('school_level', 'text', (column) => column.notNull())
      .addColumn('grade', 'smallint', (column) => column.notNull())
      .addColumn('content_kind', 'text', (column) => column.notNull())
      .addColumn('session_minutes', 'smallint', (column) => column.notNull())
      .addColumn('sessions_total', 'smallint', (column) => column.notNull())
      .addColumn('price_total', 'integer', (column) => column.notNull())
      .addColumn('price_per_session', 'integer', (column) => column.notNull())
      .addColumn('commission_per_session', 'integer', (column) => column.notNull())
      .addColumn('no_assignment_attested', 'boolean', (column) => column.notNull().defaultTo(false))
      .addColumn('recording_required', 'boolean', (column) => column.notNull().defaultTo(false))
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('hold_expires_at', 'timestamptz', (column) => column.notNull())
      .addColumn('paid_at', 'timestamptz')
      .addColumn('expires_at', 'timestamptz')
      .addColumn('provider', 'text', (column) => column.notNull())
      .addColumn('provider_ref', 'text', (column) => column.notNull().unique())
      .addColumn('refunded_amount', 'integer', (column) => column.notNull().defaultTo(0))
      .addColumn('closed_reason', 'text')
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint(
        'market_packages_status_check',
        sql`status in ('held', 'paid', 'cancelled', 'expired', 'refunded', 'used_up')`,
      )
      .execute();
    await database.schema
      .createIndex('market_packages_parent')
      .on('market_packages')
      .column('parent_account_id')
      .execute();

    await database.schema
      .alterTable('market_bookings')
      .addColumn('package_id', 'uuid', (column) => column.references('market_packages.id'))
      .execute();
  },
  async down(database) {
    await database.schema.alterTable('market_bookings').dropColumn('package_id').execute();
    await database.schema.dropTable('market_packages').execute();
    await sql`alter table market_tutor_subjects drop constraint market_tutor_subjects_package_check`.execute(database);
    await database.schema
      .alterTable('market_tutor_subjects')
      .dropColumn('package_sessions')
      .dropColumn('package_price')
      .execute();
  },
};
