import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// Tài khoản của chợ gia sư (DT-27 phần 27f, YCTD-256; tài liệu 47 mục 19.5): người dùng chợ không thuộc trường nào nên tài khoản nằm ở
// cơ sở dữ liệu `marketplace` riêng, không ở `identity` của trường. Claude tự chọn theo ủy quyền của Eric ngày 2026-10-11:
// - một tài khoản một vai (`parent` hoặc `tutor`); người vừa là phụ huynh vừa dạy thì mở hai tài khoản (thư điện tử khác nhau), để
//   quyền và dữ liệu của hai vai không trộn;
// - trẻ không có tài khoản (GD-135): hồ sơ con do phụ huynh tạo ở `market_children`;
// - đăng nhập bằng mật khẩu (băm argon2id như dịch vụ định danh) sau khi xác nhận thư điện tử hoặc số điện thoại bằng mã 6 số, hoặc
//   bằng OIDC (bộ nối của DT-25); tài khoản chỉ có OIDC thì không có mật khẩu;
// - phiên là chuỗi ngẫu nhiên, chỉ lưu băm SHA-256 (`market_sessions`), không dùng mã phiên ký của trường nên mã phiên của trường
//   không dùng được ở chợ và ngược lại
export const migration: Migration = {
  async up(database) {
    await database.schema
      .createTable('market_accounts')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('kind', 'text', (column) => column.notNull())
      .addColumn('email', 'text', (column) => column.unique())
      .addColumn('phone', 'text', (column) => column.unique())
      .addColumn('password_hash', 'text')
      .addColumn('display_name', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull().defaultTo('pending'))
      .addColumn('failed_login_count', 'integer', (column) => column.notNull().defaultTo(0))
      .addColumn('locked_until', 'timestamptz')
      .addColumn('verified_at', 'timestamptz')
      .addColumn('last_login_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint('market_accounts_kind_check', sql`kind in ('parent', 'tutor')`)
      .addCheckConstraint('market_accounts_status_check', sql`status in ('pending', 'active', 'locked', 'closed')`)
      .addCheckConstraint('market_accounts_email_check', sql`email is null or email = lower(email)`)
      .addCheckConstraint('market_accounts_display_name_check', sql`length(display_name) between 1 and 80`)
      .execute();

    await database.schema
      .createTable('market_verification_codes')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('account_id', 'uuid', (column) =>
        column.notNull().references('market_accounts.id').onDelete('cascade'),
      )
      .addColumn('channel', 'text', (column) => column.notNull())
      .addColumn('purpose', 'text', (column) => column.notNull())
      .addColumn('code_hash', 'text', (column) => column.notNull())
      .addColumn('attempts', 'smallint', (column) => column.notNull().defaultTo(0))
      .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
      .addColumn('used_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint('market_verification_codes_channel_check', sql`channel in ('email', 'sms')`)
      .addCheckConstraint('market_verification_codes_purpose_check', sql`purpose in ('verify', 'reset')`)
      .execute();
    await database.schema
      .createIndex('market_verification_codes_account_index')
      .on('market_verification_codes')
      .columns(['account_id', 'created_at'])
      .execute();

    await database.schema
      .createTable('market_sessions')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('account_id', 'uuid', (column) =>
        column.notNull().references('market_accounts.id').onDelete('cascade'),
      )
      .addColumn('token_hash', 'text', (column) => column.notNull().unique())
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
      .addColumn('revoked_at', 'timestamptz')
      .execute();

    await database.schema
      .createTable('market_external_identities')
      .addColumn('provider', 'text', (column) => column.notNull())
      .addColumn('subject', 'text', (column) => column.notNull())
      .addColumn('account_id', 'uuid', (column) =>
        column.notNull().references('market_accounts.id').onDelete('cascade'),
      )
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addPrimaryKeyConstraint('market_external_identities_pkey', ['provider', 'subject'])
      .execute();
  },
  async down(database) {
    await database.schema.dropTable('market_external_identities').execute();
    await database.schema.dropTable('market_sessions').execute();
    await database.schema.dropTable('market_verification_codes').execute();
    await database.schema.dropTable('market_accounts').execute();
  },
};
