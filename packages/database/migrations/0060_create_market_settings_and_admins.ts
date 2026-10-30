import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// Cấu hình chợ và tài khoản quản trị riêng (YCTD-393): thay khóa `market` của `platform_settings` và nhân viên vận hành của nền tảng
// School Management. Tài khoản quản trị đăng nhập bằng mật khẩu và mã TOTP; phiên lưu băm SHA-256 của mã phiên như phiên của chợ
export const migration: Migration = {
  async up(database) {
    await database.schema
      .createTable('market_settings')
      .addColumn('key', 'text', (column) => column.primaryKey())
      .addColumn('value', 'jsonb', (column) => column.notNull())
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .execute();

    await database.schema
      .createTable('market_admins')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('login', 'text', (column) => column.notNull().unique())
      .addColumn('full_name', 'text', (column) => column.notNull())
      .addColumn('password_hash', 'text', (column) => column.notNull())
      .addColumn('totp_secret_encrypted', 'text', (column) => column.notNull())
      .addColumn('totp_last_step', 'bigint')
      .addColumn('role', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull().defaultTo('active'))
      .addColumn('failed_login_count', 'integer', (column) => column.notNull().defaultTo(0))
      .addColumn('locked_until', 'timestamptz')
      .addColumn('last_login_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint('market_admins_login_check', sql`login ~ '^[a-z0-9._-]{3,40}$'`)
      .addCheckConstraint('market_admins_role_check', sql`role in ('quan_tri', 'ho_tro', 'ke_toan')`)
      .addCheckConstraint('market_admins_status_check', sql`status in ('active', 'disabled')`)
      .execute();

    await database.schema
      .createTable('market_admin_recovery_codes')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('admin_id', 'uuid', (column) => column.notNull().references('market_admins.id').onDelete('cascade'))
      .addColumn('code_hash', 'text', (column) => column.notNull())
      .addColumn('used_at', 'timestamptz')
      .execute();
    await database.schema
      .createIndex('market_admin_recovery_codes_admin_index')
      .on('market_admin_recovery_codes')
      .column('admin_id')
      .execute();

    await database.schema
      .createTable('market_admin_sessions')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('admin_id', 'uuid', (column) => column.notNull().references('market_admins.id').onDelete('cascade'))
      .addColumn('token_hash', 'text', (column) => column.notNull().unique())
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
      .addColumn('revoked_at', 'timestamptz')
      .execute();
  },
  async down(database) {
    await database.schema.dropTable('market_admin_sessions').execute();
    await database.schema.dropTable('market_admin_recovery_codes').execute();
    await database.schema.dropTable('market_admins').execute();
    await database.schema.dropTable('market_settings').execute();
  },
};
