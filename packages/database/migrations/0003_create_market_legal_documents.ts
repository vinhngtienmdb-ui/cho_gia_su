import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// Văn bản pháp lý có phiên bản và đồng ý theo phiên bản của chợ gia sư (DT-27 phần 27f, YCTD-256): điều khoản sử dụng, chính sách
// dữ liệu, đồng ý của cha mẹ cho hồ sơ con, điều khoản của gia sư. Nhân viên nền tảng đăng phiên bản mới ở cổng nền tảng; phiên bản đã
// đăng không sửa được. Mỗi lần đồng ý ghi một dòng (kèm hồ sơ con khi là đồng ý của cha mẹ cho con), rút lại thì ghi thời điểm rút
export const migration: Migration = {
  async up(database) {
    await database.schema
      .createTable('market_legal_documents')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('kind', 'text', (column) => column.notNull())
      .addColumn('version', 'integer', (column) => column.notNull())
      .addColumn('title', 'text', (column) => column.notNull())
      .addColumn('body', 'text', (column) => column.notNull())
      .addColumn('published_by', 'text', (column) => column.notNull())
      .addColumn('published_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint(
        'market_legal_documents_kind_check',
        sql`kind in ('terms', 'privacy', 'parent_consent', 'tutor_terms')`,
      )
      .addCheckConstraint('market_legal_documents_version_check', sql`version >= 1`)
      .addUniqueConstraint('market_legal_documents_kind_version_unique', ['kind', 'version'])
      .execute();

    await database.schema
      .createTable('market_consents')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('account_id', 'uuid', (column) =>
        column.notNull().references('market_accounts.id').onDelete('cascade'),
      )
      .addColumn('document_id', 'uuid', (column) => column.notNull().references('market_legal_documents.id'))
      // Hồ sơ con khi là đồng ý của cha mẹ cho con (tài liệu `parent_consent`); khóa ngoại thêm ở 0004 sau khi có bảng
      .addColumn('child_id', 'uuid')
      .addColumn('accepted_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn('withdrawn_at', 'timestamptz')
      .execute();
    await database.schema
      .createIndex('market_consents_account_index')
      .on('market_consents')
      .columns(['account_id', 'document_id'])
      .execute();
  },
  async down(database) {
    await database.schema.dropTable('market_consents').execute();
    await database.schema.dropTable('market_legal_documents').execute();
  },
};
