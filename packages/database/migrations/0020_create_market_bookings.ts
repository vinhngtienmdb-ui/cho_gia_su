import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

// Đặt buổi, thanh toán giữ tiền, giải ngân, hoàn tiền, tranh chấp, hoa hồng của chợ gia sư (DT-27 phần 27h, YCTD-258; tài liệu 47 mục
// 19.5). Claude tự chọn theo ủy quyền của Eric ngày 2026-10-11 và quyết định ngày 2026-10-28 ("làm mã, tiền giả lập"):
// - buổi lẻ (gói buổi làm sau): giữ chỗ chờ trả tiền có hạn; giá, hoa hồng, môn chụp lại lúc đặt (gia sư sửa hồ sơ không đổi buổi đã đặt);
// - tiền nằm ở nhà cung cấp thanh toán (`provider`, bản này chỉ `mock`); bảng `market_payments` ghi lệnh thu có giữ, số đã hoàn, số đã giải
//   ngân, hoa hồng; sự kiện của nhà cung cấp ghi một lần theo mã sự kiện (`market_payment_events`) để nhận lại không xử lý hai lần;
// - tranh chấp: một buổi một tranh chấp, hai bên nộp trình bày, nhân viên nền tảng quyết định có lý do, một lần khiếu nại lại do người
//   khác xét;
// - quy tắc hoa hồng là dữ liệu (tỷ lệ phần trăm, tối thiểu, theo loại nội dung, theo gia sư, ngày hiệu lực); tỷ lệ thật do Eric chốt (E-01)
export const migration: Migration = {
  async up(database) {
    await database.schema
      .createTable('market_bookings')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('parent_account_id', 'uuid', (column) => column.notNull().references('market_accounts.id'))
      .addColumn('child_id', 'uuid', (column) => column.references('market_children.id').onDelete('set null'))
      .addColumn('child_name', 'text', (column) => column.notNull())
      .addColumn('tutor_account_id', 'uuid', (column) => column.notNull().references('market_accounts.id'))
      .addColumn('subject', 'text', (column) => column.notNull())
      .addColumn('school_level', 'text', (column) => column.notNull())
      .addColumn('grade', 'smallint', (column) => column.notNull())
      .addColumn('content_kind', 'text', (column) => column.notNull())
      .addColumn('starts_at', 'timestamptz', (column) => column.notNull())
      .addColumn('minutes', 'smallint', (column) => column.notNull())
      .addColumn('price', 'integer', (column) => column.notNull())
      .addColumn('commission', 'integer', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('hold_expires_at', 'timestamptz', (column) => column.notNull())
      .addColumn('no_assignment_attested', 'boolean', (column) => column.notNull().defaultTo(false))
      .addColumn('completed_at', 'timestamptz')
      .addColumn('complaint_deadline', 'timestamptz')
      .addColumn('cancelled_by', 'text')
      .addColumn('cancelled_at', 'timestamptz')
      .addColumn('cancel_reason', 'text')
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint(
        'market_bookings_status_check',
        sql`status in ('held', 'paid', 'completed', 'disputed', 'disbursed', 'refunded', 'cancelled', 'expired')`,
      )
      .addCheckConstraint('market_bookings_kind_check', sql`content_kind in ('curriculum', 'enrichment')`)
      .addCheckConstraint('market_bookings_level_check', sql`school_level in ('TH', 'THCS', 'THPT')`)
      .addCheckConstraint('market_bookings_minutes_check', sql`minutes between 30 and 180`)
      .addCheckConstraint('market_bookings_money_check', sql`price >= 0 and commission between 0 and price`)
      .addCheckConstraint(
        'market_bookings_cancelled_by_check',
        sql`cancelled_by is null or cancelled_by in ('parent', 'tutor', 'system')`,
      )
      .execute();
    await database.schema
      .createIndex('market_bookings_parent_index')
      .on('market_bookings')
      .column('parent_account_id')
      .execute();
    await database.schema
      .createIndex('market_bookings_tutor_time_index')
      .on('market_bookings')
      .columns(['tutor_account_id', 'starts_at'])
      .execute();

    await database.schema
      .createTable('market_payments')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('booking_id', 'uuid', (column) => column.notNull().unique().references('market_bookings.id'))
      .addColumn('provider', 'text', (column) => column.notNull())
      .addColumn('provider_ref', 'text', (column) => column.notNull().unique())
      .addColumn('amount', 'integer', (column) => column.notNull())
      .addColumn('commission', 'integer', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull())
      .addColumn('held_for_dispute', 'boolean', (column) => column.notNull().defaultTo(false))
      .addColumn('refunded_amount', 'integer', (column) => column.notNull().defaultTo(0))
      .addColumn('released_amount', 'integer', (column) => column.notNull().defaultTo(0))
      .addColumn('commission_taken', 'integer', (column) => column.notNull().defaultTo(0))
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint(
        'market_payments_status_check',
        sql`status in ('pending', 'held', 'released', 'refunded', 'settled', 'failed')`,
      )
      .addCheckConstraint(
        'market_payments_money_check',
        sql`refunded_amount + released_amount + commission_taken <= amount and refunded_amount >= 0 and released_amount >= 0 and commission_taken >= 0`,
      )
      .execute();

    await database.schema
      .createTable('market_payment_events')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('provider', 'text', (column) => column.notNull())
      .addColumn('event_id', 'text', (column) => column.notNull())
      .addColumn('type', 'text', (column) => column.notNull())
      .addColumn('provider_ref', 'text', (column) => column.notNull())
      .addColumn('payload', 'jsonb', (column) => column.notNull())
      .addColumn('received_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addUniqueConstraint('market_payment_events_unique', ['provider', 'event_id'])
      .execute();

    await database.schema
      .createTable('market_disputes')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('booking_id', 'uuid', (column) => column.notNull().unique().references('market_bookings.id'))
      .addColumn('reason', 'text', (column) => column.notNull())
      .addColumn('status', 'text', (column) => column.notNull().defaultTo('open'))
      .addColumn('decision', 'text')
      .addColumn('refund_amount', 'integer')
      .addColumn('decision_note', 'text')
      .addColumn('decided_by', 'text')
      .addColumn('decided_at', 'timestamptz')
      .addColumn('appeal_reason', 'text')
      .addColumn('appealed_by', 'text')
      .addColumn('appealed_at', 'timestamptz')
      .addColumn('final_decision', 'text')
      .addColumn('final_refund_amount', 'integer')
      .addColumn('final_note', 'text')
      .addColumn('final_decided_by', 'text')
      .addColumn('final_decided_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint('market_disputes_status_check', sql`status in ('open', 'decided', 'appealed', 'final')`)
      .addCheckConstraint(
        'market_disputes_decision_check',
        sql`(decision is null or decision in ('refund_full', 'refund_partial', 'release')) and (final_decision is null or final_decision in ('refund_full', 'refund_partial', 'release'))`,
      )
      .addCheckConstraint('market_disputes_reason_check', sql`length(reason) between 1 and 2000`)
      .execute();

    await database.schema
      .createTable('market_dispute_statements')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('dispute_id', 'uuid', (column) =>
        column.notNull().references('market_disputes.id').onDelete('cascade'),
      )
      .addColumn('author_account_id', 'uuid', (column) => column.notNull().references('market_accounts.id'))
      .addColumn('role', 'text', (column) => column.notNull())
      .addColumn('body', 'text', (column) => column.notNull())
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint('market_dispute_statements_role_check', sql`role in ('parent', 'tutor')`)
      .addCheckConstraint('market_dispute_statements_body_check', sql`length(body) between 1 and 4000`)
      .execute();

    await database.schema
      .createTable('market_commission_rules')
      .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('content_kind', 'text')
      .addColumn('tutor_account_id', 'uuid', (column) => column.references('market_accounts.id').onDelete('cascade'))
      .addColumn('percent', 'numeric(5, 2)', (column) => column.notNull())
      .addColumn('minimum', 'integer', (column) => column.notNull().defaultTo(0))
      .addColumn('effective_from', 'date', (column) => column.notNull())
      .addColumn('created_by', 'text', (column) => column.notNull())
      .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
      .addCheckConstraint(
        'market_commission_rules_kind_check',
        sql`content_kind is null or content_kind in ('curriculum', 'enrichment')`,
      )
      .addCheckConstraint('market_commission_rules_percent_check', sql`percent between 0 and 50`)
      .addCheckConstraint('market_commission_rules_minimum_check', sql`minimum between 0 and 10000000`)
      .execute();
  },
  async down(database) {
    await database.schema.dropTable('market_commission_rules').execute();
    await database.schema.dropTable('market_dispute_statements').execute();
    await database.schema.dropTable('market_disputes').execute();
    await database.schema.dropTable('market_payment_events').execute();
    await database.schema.dropTable('market_payments').execute();
    await database.schema.dropTable('market_bookings').execute();
  },
};
