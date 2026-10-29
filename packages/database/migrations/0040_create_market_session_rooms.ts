import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// Phòng học video của chợ gia sư (DT-27 phần 27j, YCTD-362; tài liệu 47 mục 19.12). Quyết định của Eric ngày 2026-10-29:
// - đồng ý ghi hình hỏi một lần cho mọi buổi của một con với một gia sư, rút lại được bất cứ lúc nào; con từ đủ 7 tuổi cùng xác nhận
//   (`market_recording_consents`, mỗi lần đồng ý một dòng, rút thì ghi `withdrawn_at`, không xóa);
// - phòng của một buổi (`market_session_rooms`): lúc gia sư mở, lúc đóng, gia sư xác nhận đã dạy hay hệ thống tự xác nhận sau hạn;
// - phòng chờ (`market_session_participants`): mỗi người của buổi một dòng theo định danh trong phòng video; gia sư cho vào, cho nói, cho
//   chia sẻ màn hình, mời ra; phụ huynh vào xem luôn tắt micro trừ khi gia sư cho nói;
// - nhật ký vào ra (`market_session_attendance`): mỗi lần vào một dòng, ra thì ghi `left_at`; điểm danh tính từ các khoảng có mặt
export const migration: Migration = {
  async up(database) {
    await database.schema
      .createTable('market_recording_consents')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('parent_account_id', 'uuid', (column) =>
        column.notNull().references('market_accounts.id').onDelete('cascade'),
      )
      .addColumn('child_id', 'uuid', (column) => column.notNull().references('market_children.id').onDelete('cascade'))
      .addColumn('tutor_account_id', 'uuid', (column) => column.notNull().references('market_accounts.id'))
      .addColumn('child_confirmed', 'boolean', (column) => column.notNull().defaultTo(false))
      .addColumn('consented_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn('withdrawn_at', 'timestamptz')
      .execute();
    await sql`create unique index market_recording_consents_active on market_recording_consents (child_id, tutor_account_id) where withdrawn_at is null`.execute(
      database,
    );

    await database.schema
      .createTable('market_session_rooms')
      .addColumn('booking_id', 'uuid', (column) => column.primaryKey().references('market_bookings.id'))
      .addColumn('opened_at', 'timestamptz', (column) => column.notNull())
      .addColumn('closed_at', 'timestamptz')
      .addColumn('confirmed_at', 'timestamptz')
      .addColumn('confirmed_by', 'text')
      .addColumn('tutor_note', 'text')
      .addColumn('incident', 'text')
      .addCheckConstraint('market_session_rooms_confirmed_by_check', sql`confirmed_by in ('tutor', 'auto')`)
      .execute();

    await database.schema
      .createTable('market_session_participants')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('booking_id', 'uuid', (column) => column.notNull().references('market_bookings.id'))
      .addColumn('identity', 'text', (column) => column.notNull())
      .addColumn('account_id', 'uuid', (column) => column.notNull().references('market_accounts.id'))
      .addColumn('role', 'text', (column) => column.notNull())
      .addColumn('display_name', 'text', (column) => column.notNull())
      .addColumn('requested_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn('admitted_at', 'timestamptz')
      .addColumn('removed_at', 'timestamptz')
      .addColumn('can_speak', 'boolean', (column) => column.notNull().defaultTo(false))
      .addColumn('can_share', 'boolean', (column) => column.notNull().defaultTo(false))
      .addCheckConstraint('market_session_participants_role_check', sql`role in ('host', 'student', 'guardian')`)
      .addUniqueConstraint('market_session_participants_identity', ['booking_id', 'identity'])
      .execute();

    await database.schema
      .createTable('market_session_attendance')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('booking_id', 'uuid', (column) => column.notNull().references('market_bookings.id'))
      .addColumn('identity', 'text', (column) => column.notNull())
      .addColumn('role', 'text', (column) => column.notNull())
      .addColumn('joined_at', 'timestamptz', (column) => column.notNull())
      .addColumn('left_at', 'timestamptz')
      .addColumn('source', 'text', (column) => column.notNull())
      .addCheckConstraint('market_session_attendance_role_check', sql`role in ('host', 'student', 'guardian')`)
      .addCheckConstraint('market_session_attendance_source_check', sql`source in ('app', 'webhook')`)
      .execute();
    await database.schema
      .createIndex('market_session_attendance_booking')
      .on('market_session_attendance')
      .columns(['booking_id', 'identity'])
      .execute();
  },
  async down(database) {
    await database.schema.dropTable('market_session_attendance').execute();
    await database.schema.dropTable('market_session_participants').execute();
    await database.schema.dropTable('market_session_rooms').execute();
    await database.schema.dropTable('market_recording_consents').execute();
  },
};
