import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// Hồ sơ gia sư, xác minh từng bậc, khai giáo viên đang dạy ở trường (DT-27 phần 27g, YCTD-257; tài liệu 47 mục 19.5). Claude tự chọn theo
// ủy quyền của Eric ngày 2026-10-11:
// - hồ sơ: môn theo cấp và khối, loại nội dung (`curriculum` là môn của chương trình phổ thông, `enrichment` là năng khiếu, kỹ năng, ngoại
//   ngữ tăng cường…), giá mỗi buổi (đồng), thời lượng buổi, lịch trống theo tuần, ngôn ngữ dạy; trạng thái nháp → chờ duyệt → đã duyệt
//   hoặc bị từ chối; sửa hồ sơ đã duyệt thì về chờ duyệt;
// - xác minh bốn bậc: danh tính (OIDC của DT-25, đủ 18 tuổi, duyệt tự động), bằng cấp, phiếu lý lịch tư pháp (cấp trong 6 tháng, hiệu lực
//   12 tháng, GD-136), đăng ký kinh doanh (bắt buộc với nội dung `curriculum`); ba bậc sau do nhân viên nền tảng duyệt, có nhật ký;
// - tệp giấy tờ mã hóa AES-256-GCM bằng khóa của chợ trước khi vào kho tệp, chỉ nhân viên duyệt tải được (có nhật ký);
// - giáo viên đang dạy ở trường khai trường, môn, lớp; giáo viên trường công lập không có môn `curriculum` (Thông tư 29/2024 khoản 3
//   Điều 4); dựng báo cáo Mẫu 03 gửi Hiệu trưởng;
// - lượt chuyển hướng OIDC giữ ở cơ sở dữ liệu chợ (máy chủ API không có Redis riêng của chợ), chỉ lưu băm của state
export const migration: Migration = {
  async up(database) {
    await sql`alter table market_tutor_profiles drop constraint market_tutor_profiles_status_check`.execute(database);
    await database.schema
      .alterTable('market_tutor_profiles')
      .addColumn('teaching_language', 'text', (column) => column.notNull().defaultTo('Tiếng Việt'))
      .addColumn('review_note', 'text')
      .addColumn('reviewed_at', 'timestamptz')
      .addColumn('reviewed_by', 'text')
      .addColumn('published_at', 'timestamptz')
      .execute();
    await sql`alter table market_tutor_profiles add constraint market_tutor_profiles_status_check
      check (status in ('draft', 'submitted', 'approved', 'rejected'))`.execute(database);

    await database.schema
      .createTable('market_tutor_subjects')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('account_id', 'uuid', (column) =>
        column.notNull().references('market_tutor_profiles.account_id').onDelete('cascade'),
      )
      .addColumn('subject', 'text', (column) => column.notNull())
      .addColumn('school_level', 'text', (column) => column.notNull())
      .addColumn('grade_from', 'smallint', (column) => column.notNull())
      .addColumn('grade_to', 'smallint', (column) => column.notNull())
      .addColumn('content_kind', 'text', (column) => column.notNull())
      .addColumn('price_per_session', 'integer', (column) => column.notNull())
      .addColumn('session_minutes', 'smallint', (column) => column.notNull())
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint('market_tutor_subjects_subject_check', sql`length(subject) between 1 and 60`)
      .addCheckConstraint('market_tutor_subjects_level_check', sql`school_level in ('TH', 'THCS', 'THPT')`)
      .addCheckConstraint(
        'market_tutor_subjects_grades_check',
        sql`grade_from between 1 and 12 and grade_to between grade_from and 12`,
      )
      .addCheckConstraint('market_tutor_subjects_kind_check', sql`content_kind in ('curriculum', 'enrichment')`)
      .addCheckConstraint('market_tutor_subjects_price_check', sql`price_per_session between 0 and 10000000`)
      .addCheckConstraint('market_tutor_subjects_minutes_check', sql`session_minutes between 30 and 180`)
      .execute();
    await database.schema
      .createIndex('market_tutor_subjects_account_index')
      .on('market_tutor_subjects')
      .column('account_id')
      .execute();

    await database.schema
      .createTable('market_tutor_availability')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('account_id', 'uuid', (column) =>
        column.notNull().references('market_tutor_profiles.account_id').onDelete('cascade'),
      )
      .addColumn('weekday', 'smallint', (column) => column.notNull())
      .addColumn('start_minute', 'smallint', (column) => column.notNull())
      .addColumn('end_minute', 'smallint', (column) => column.notNull())
      .addCheckConstraint('market_tutor_availability_weekday_check', sql`weekday between 1 and 7`)
      .addCheckConstraint(
        'market_tutor_availability_minutes_check',
        sql`start_minute between 0 and 1439 and end_minute between start_minute + 30 and 1440`,
      )
      .execute();

    await database.schema
      .createTable('market_tutor_documents')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('account_id', 'uuid', (column) =>
        column.notNull().references('market_accounts.id').onDelete('cascade'),
      )
      .addColumn('kind', 'text', (column) => column.notNull())
      .addColumn('file_key', 'text', (column) => column.notNull().unique())
      .addColumn('file_name', 'text', (column) => column.notNull())
      .addColumn('content_type', 'text', (column) => column.notNull())
      .addColumn('size_bytes', 'integer', (column) => column.notNull())
      .addColumn('uploaded_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint(
        'market_tutor_documents_kind_check',
        sql`kind in ('degree', 'criminal_record', 'business_registration')`,
      )
      .execute();

    await database.schema
      .createTable('market_tutor_verifications')
      .addColumn('account_id', 'uuid', (column) =>
        column.notNull().references('market_accounts.id').onDelete('cascade'),
      )
      .addColumn('kind', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('details', 'jsonb', (column) => column.notNull().defaultTo(sql`'{}'::jsonb`))
      .addColumn('document_id', 'uuid', (column) => column.references('market_tutor_documents.id').onDelete('set null'))
      .addColumn('submitted_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn('decided_at', 'timestamptz')
      .addColumn('decided_by', 'text')
      .addColumn('note', 'text')
      .addColumn('valid_until', 'date')
      .addPrimaryKeyConstraint('market_tutor_verifications_pkey', ['account_id', 'kind'])
      .addCheckConstraint(
        'market_tutor_verifications_kind_check',
        sql`kind in ('identity', 'degree', 'criminal_record', 'business_registration')`,
      )
      .addCheckConstraint('market_tutor_verifications_status_check', sql`status in ('pending', 'approved', 'rejected')`)
      .execute();

    await database.schema
      .createTable('market_tutor_school_roles')
      .addColumn('account_id', 'uuid', (column) =>
        column.primaryKey().references('market_tutor_profiles.account_id').onDelete('cascade'),
      )
      .addColumn('school_name', 'text', (column) => column.notNull())
      .addColumn('is_public', 'boolean', (column) => column.notNull())
      .addColumn('subjects', 'text', (column) => column.notNull())
      .addColumn('grades', 'text', (column) => column.notNull())
      .addColumn('declared_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn('form03_generated_at', 'timestamptz')
      .addCheckConstraint('market_tutor_school_roles_name_check', sql`length(school_name) between 1 and 200`)
      .execute();

    await database.schema
      .createTable('market_oidc_requests')
      .addColumn('state_hash', 'text', (column) => column.primaryKey())
      .addColumn('purpose', 'text', (column) => column.notNull())
      .addColumn('provider', 'text', (column) => column.notNull())
      .addColumn('account_id', 'uuid', (column) => column.references('market_accounts.id').onDelete('cascade'))
      .addColumn('nonce', 'text', (column) => column.notNull())
      .addColumn('code_verifier', 'text', (column) => column.notNull())
      .addColumn('redirect_uri', 'text', (column) => column.notNull())
      .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
      .addColumn('used_at', 'timestamptz')
      .addCheckConstraint('market_oidc_requests_purpose_check', sql`purpose in ('verify', 'login')`)
      .execute();
  },
  async down(database) {
    await database.schema.dropTable('market_oidc_requests').execute();
    await database.schema.dropTable('market_tutor_school_roles').execute();
    await database.schema.dropTable('market_tutor_verifications').execute();
    await database.schema.dropTable('market_tutor_documents').execute();
    await database.schema.dropTable('market_tutor_availability').execute();
    await database.schema.dropTable('market_tutor_subjects').execute();
    await sql`alter table market_tutor_profiles drop constraint market_tutor_profiles_status_check`.execute(database);
    await database.schema
      .alterTable('market_tutor_profiles')
      .dropColumn('published_at')
      .dropColumn('reviewed_by')
      .dropColumn('reviewed_at')
      .dropColumn('review_note')
      .dropColumn('teaching_language')
      .execute();
    await sql`alter table market_tutor_profiles add constraint market_tutor_profiles_status_check
      check (status in ('draft', 'submitted'))`.execute(database);
  },
};
