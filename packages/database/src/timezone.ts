import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';

async function readDatabaseName(database: Kysely<unknown>): Promise<string> {
  const result = await sql<{ name: string }>`select current_database() as name`.execute(database);
  const databaseName = result.rows[0]?.name;
  if (!databaseName) {
    throw new Error('Không đọc được tên cơ sở dữ liệu');
  }
  return databaseName;
}

// Tài khoản chạy tệp thay đổi cấu trúc có phải chủ cơ sở dữ liệu (hoặc quản trị) không. Ở bố cục lược đồ (hồ sơ thử nghiệm của
// DT-SaaS) mỗi lược đồ chạy bằng vai trò riêng, không phải chủ cơ sở dữ liệu nên đặt giờ ở mức vai trò thay cho cơ sở dữ liệu
async function ownsDatabase(database: Kysely<unknown>): Promise<boolean> {
  const result = await sql<{ owns: boolean }>`
    select (
      pg_has_role(current_user, d.datdba, 'member')
      or coalesce((select rolsuper from pg_roles where rolname = current_user), false)
    ) as owns
    from pg_database d
    where d.datname = current_database()`.execute(database);
  return result.rows[0]?.owns === true;
}

// Mốc thời gian lưu theo giờ Việt Nam (16_CO_SO_DU_LIEU.md mục 1, quy ước 6)
export const setVietnamTimezone: Migration = {
  async up(database) {
    if (await ownsDatabase(database)) {
      const databaseName = await readDatabaseName(database);
      await sql`alter database ${sql.id(databaseName)} set timezone to ${sql.lit(VIETNAM_TIMEZONE)}`.execute(database);
      return;
    }
    await sql`alter role current_user set timezone to ${sql.lit(VIETNAM_TIMEZONE)}`.execute(database);
  },
  async down(database) {
    if (await ownsDatabase(database)) {
      const databaseName = await readDatabaseName(database);
      await sql`alter database ${sql.id(databaseName)} reset timezone`.execute(database);
      return;
    }
    await sql`alter role current_user reset timezone`.execute(database);
  },
};

export { VIETNAM_TIMEZONE };
