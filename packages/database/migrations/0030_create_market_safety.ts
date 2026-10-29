import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// An toàn trẻ em và kiểm duyệt ở chợ gia sư (DT-27 phần 27i, YCTD-259; tài liệu 47 mục 19.2, 19.5). Claude tự chọn theo ủy quyền của
// Eric ngày 2026-10-11:
// - tin nhắn chợ chỉ có luồng giữa phụ huynh và gia sư (không có luồng gia sư với trẻ); chữ đã che thông tin liên lạc ngoài lưu ở `body`,
//   chữ gốc chỉ lưu khi có che (`original_body`) để nhân viên kiểm duyệt xem làm bằng chứng;
// - báo cáo vi phạm có loại, mức độ, hạn xử lý theo mức, người nhận xử lý, quyết định có lý do, một lần kháng nghị do nhân viên khác xét;
// - tạm khóa gia sư là dòng riêng (bật, gỡ có người và lý do), không đổi trạng thái tài khoản để gia sư vẫn đăng nhập xem và kháng nghị;
// - ghi hình buổi có trẻ vị thành niên là bắt buộc (phụ huynh đồng ý khi đặt), bản ghi giữ 30 ngày, giữ lâu hơn khi có tranh chấp, báo cáo
//   hoặc tạm khóa đang mở; mỗi lượt xem có nhật ký; xuất hồ sơ cho cơ quan có thẩm quyền có nhật ký
export const migration: Migration = {
  async up(database) {
    await database.schema
      .alterTable('market_bookings')
      .addColumn('recording_required', 'boolean', (column) => column.notNull().defaultTo(false))
      .addColumn('recording_consented', 'boolean', (column) => column.notNull().defaultTo(false))
      .execute();

    await database.schema
      .createTable('market_message_threads')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('parent_account_id', 'uuid', (column) => column.notNull().references('market_accounts.id'))
      .addColumn('tutor_account_id', 'uuid', (column) => column.notNull().references('market_accounts.id'))
      .addColumn('flagged_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn('last_message_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addUniqueConstraint('market_message_threads_pair_unique', ['parent_account_id', 'tutor_account_id'])
      .execute();
    await database.schema
      .createTable('market_messages')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('thread_id', 'uuid', (column) =>
        column.notNull().references('market_message_threads.id').onDelete('cascade'),
      )
      .addColumn('author_account_id', 'uuid', (column) => column.notNull().references('market_accounts.id'))
      .addColumn('role', 'text', (column) => column.notNull())
      .addColumn('body', 'text', (column) => column.notNull())
      .addColumn('original_body', 'text')
      .addColumn('findings', 'jsonb', (column) => column.notNull().defaultTo(sql`'[]'::jsonb`))
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint('market_messages_role_check', sql`role in ('parent', 'tutor')`)
      .addCheckConstraint('market_messages_body_check', sql`length(body) between 1 and 4000`)
      .execute();
    await database.schema
      .createIndex('market_messages_thread_index')
      .on('market_messages')
      .columns(['thread_id', 'created_at'])
      .execute();

    await database.schema
      .createTable('market_reports')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('reporter_account_id', 'uuid', (column) => column.references('market_accounts.id'))
      .addColumn('subject_account_id', 'uuid', (column) => column.notNull().references('market_accounts.id'))
      .addColumn('target_kind', 'text', (column) => column.notNull())
      .addColumn('target_id', 'text')
      .addColumn('category', 'text', (column) => column.notNull())
      .addColumn('severity', 'text', (column) => column.notNull())
      .addColumn('description', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull().defaultTo('open'))
      .addColumn('due_at', 'timestamptz', (column) => column.notNull())
      .addColumn('assigned_to', 'text')
      .addColumn('decision', 'text')
      .addColumn('decision_note', 'text')
      .addColumn('decided_by', 'text')
      .addColumn('decided_at', 'timestamptz')
      .addColumn('appeal_reason', 'text')
      .addColumn('appealed_at', 'timestamptz')
      .addColumn('final_decision', 'text')
      .addColumn('final_note', 'text')
      .addColumn('final_decided_by', 'text')
      .addColumn('final_decided_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint(
        'market_reports_target_check',
        sql`target_kind in ('profile', 'message', 'session', 'review', 'system')`,
      )
      .addCheckConstraint(
        'market_reports_category_check',
        sql`category in ('child_safety', 'harassment', 'fraud', 'fee_evasion', 'wrong_content')`,
      )
      .addCheckConstraint('market_reports_severity_check', sql`severity in ('low', 'medium', 'high', 'critical')`)
      .addCheckConstraint('market_reports_status_check', sql`status in ('open', 'decided', 'appealed', 'final')`)
      .addCheckConstraint(
        'market_reports_decision_check',
        sql`(decision is null or decision in ('suspend', 'warn', 'dismiss')) and (final_decision is null or final_decision in ('suspend', 'warn', 'dismiss'))`,
      )
      .addCheckConstraint('market_reports_description_check', sql`length(description) between 1 and 4000`)
      .execute();
    await database.schema
      .createIndex('market_reports_subject_index')
      .on('market_reports')
      .column('subject_account_id')
      .execute();

    await database.schema
      .createTable('market_tutor_suspensions')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('tutor_account_id', 'uuid', (column) => column.notNull().references('market_accounts.id'))
      .addColumn('report_id', 'uuid', (column) => column.references('market_reports.id'))
      .addColumn('reason', 'text', (column) => column.notNull())
      .addColumn('started_by', 'text', (column) => column.notNull())
      .addColumn('started_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn('lifted_by', 'text')
      .addColumn('lifted_at', 'timestamptz')
      .addColumn('lift_note', 'text')
      .execute();
    // Mỗi gia sư một lần tạm khóa đang hiệu lực
    await sql`create unique index market_tutor_suspensions_active_unique on market_tutor_suspensions (tutor_account_id)
      where lifted_at is null`.execute(database);

    await database.schema
      .createTable('market_moderation_log')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('report_id', 'uuid', (column) => column.references('market_reports.id'))
      .addColumn('subject_account_id', 'uuid', (column) => column.references('market_accounts.id'))
      .addColumn('actor_type', 'text', (column) => column.notNull())
      .addColumn('actor_id', 'text')
      .addColumn('action', 'text', (column) => column.notNull())
      .addColumn('note', 'text')
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint('market_moderation_log_actor_check', sql`actor_type in ('account', 'operator', 'system')`)
      .execute();

    await database.schema
      .createTable('market_session_recordings')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('booking_id', 'uuid', (column) => column.notNull().unique().references('market_bookings.id'))
      .addColumn('room_name', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('egress_id', 'text')
      .addColumn('file_key', 'text', (column) => column.notNull())
      .addColumn('size_bytes', 'bigint')
      .addColumn('started_at', 'timestamptz', (column) => column.notNull())
      .addColumn('ended_at', 'timestamptz')
      .addColumn('retain_until', 'timestamptz')
      .addColumn('deleted_at', 'timestamptz')
      .addCheckConstraint(
        'market_session_recordings_status_check',
        sql`status in ('recording', 'processing', 'ready', 'failed', 'deleted')`,
      )
      .execute();
    await database.schema
      .createTable('market_recording_views')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('recording_id', 'uuid', (column) => column.notNull().references('market_session_recordings.id'))
      .addColumn('viewer_type', 'text', (column) => column.notNull())
      .addColumn('viewer_id', 'text', (column) => column.notNull())
      .addColumn('viewed_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint('market_recording_views_viewer_check', sql`viewer_type in ('account', 'operator')`)
      .execute();

    await database.schema
      .createTable('market_evidence_exports')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('report_id', 'uuid', (column) => column.notNull().references('market_reports.id'))
      .addColumn('operator_id', 'text', (column) => column.notNull())
      .addColumn('authority', 'text', (column) => column.notNull())
      .addColumn('request_reference', 'text', (column) => column.notNull())
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .execute();
  },
  async down(database) {
    await database.schema.dropTable('market_evidence_exports').execute();
    await database.schema.dropTable('market_recording_views').execute();
    await database.schema.dropTable('market_session_recordings').execute();
    await database.schema.dropTable('market_moderation_log').execute();
    await database.schema.dropTable('market_tutor_suspensions').execute();
    await database.schema.dropTable('market_reports').execute();
    await database.schema.dropTable('market_messages').execute();
    await database.schema.dropTable('market_message_threads').execute();
    await database.schema
      .alterTable('market_bookings')
      .dropColumn('recording_consented')
      .dropColumn('recording_required')
      .execute();
  },
};
