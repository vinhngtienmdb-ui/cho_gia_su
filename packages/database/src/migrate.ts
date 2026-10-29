import { Migrator, type MigrationResultSet } from 'kysely/migration';
import { migrations } from '../migrations/index.js';
import { createDatabase } from './connection.js';

// Chạy các tệp thay đổi cấu trúc chưa chạy, trong một giao dịch; chạy lại nhiều lần không gây lỗi
export async function migrateToLatest(connectionString: string): Promise<MigrationResultSet> {
  const database = createDatabase<unknown>(connectionString, { max: 1 });
  try {
    const migrator = new Migrator({ db: database, provider: { getMigrations: async () => migrations } });
    return await migrator.migrateToLatest();
  } finally {
    await database.destroy();
  }
}
