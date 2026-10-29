import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// Hồ sơ gia sư và cơ sở dạy thêm ở mức tối thiểu (DT-27 phần 27f, YCTD-256): tên hiển thị, dòng giới thiệu, giới thiệu ngắn, trạng
// thái nháp; cơ sở dạy thêm là cá nhân hoặc tổ chức đứng tên (Thông tư 29/2024 khoản 1 Điều 6 khi có thu tiền), số đăng ký kinh doanh
// để trống được. Môn, cấp, giá, lịch, xác minh, trang công khai theo Mẫu 02 là của 27g (marketplace 0010 đến 0019)
export const migration: Migration = {
  async up(database) {
    await database.schema
      .createTable('market_tutor_profiles')
      .addColumn('account_id', 'uuid', (column) =>
        column.primaryKey().references('market_accounts.id').onDelete('cascade'),
      )
      .addColumn('headline', 'text', (column) => column.notNull().defaultTo(''))
      .addColumn('bio', 'text', (column) => column.notNull().defaultTo(''))
      .addColumn('status', 'text', (column) => column.notNull().defaultTo('draft'))
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint('market_tutor_profiles_status_check', sql`status in ('draft', 'submitted')`)
      .addCheckConstraint('market_tutor_profiles_headline_check', sql`length(headline) <= 120`)
      .addCheckConstraint('market_tutor_profiles_bio_check', sql`length(bio) <= 2000`)
      .execute();

    await database.schema
      .createTable('market_providers')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('owner_account_id', 'uuid', (column) =>
        column.notNull().unique().references('market_accounts.id').onDelete('cascade'),
      )
      .addColumn('kind', 'text', (column) => column.notNull())
      .addColumn('name', 'text', (column) => column.notNull())
      .addColumn('business_registration_no', 'text')
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint('market_providers_kind_check', sql`kind in ('individual', 'organization')`)
      .addCheckConstraint('market_providers_name_check', sql`length(name) between 1 and 200`)
      .execute();

    // Nhật ký của chợ: đăng ký, đăng nhập, đồng ý, rút đồng ý, liên kết trường, đổi văn bản pháp lý
    await database.schema
      .createTable('market_audit_log')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('actor_type', 'text', (column) => column.notNull())
      .addColumn('actor_id', 'text')
      .addColumn('action', 'text', (column) => column.notNull())
      .addColumn('target', 'text')
      .addColumn('details', 'jsonb', (column) => column.notNull().defaultTo(sql`'{}'::jsonb`))
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint('market_audit_log_actor_type_check', sql`actor_type in ('account', 'operator', 'system')`)
      .execute();
    await database.schema
      .createIndex('market_audit_log_created_index')
      .on('market_audit_log')
      .column('created_at')
      .execute();
  },
  async down(database) {
    await database.schema.dropTable('market_audit_log').execute();
    await database.schema.dropTable('market_providers').execute();
    await database.schema.dropTable('market_tutor_profiles').execute();
  },
};
