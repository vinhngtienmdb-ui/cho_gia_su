import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { createDatabase } from './connection.js';
import { migrateToLatest } from './migrate.js';
import { adminDatabaseUrl, dropDatabase, provisionDatabase } from './provision.js';

// Cơ sở dữ liệu cho kiểm thử: tên cơ sở dữ liệu và vai trò riêng của lần chạy, chạy tệp thay đổi cấu trúc bằng vai trò đó; gỡ cả hai
// khi xong
export interface MarketplaceTestDatabase {
  url: string;
  roleName: string;
  databaseName: string;
  close(): Promise<void>;
}

export async function startMarketplaceTestDatabase(label = 'test'): Promise<MarketplaceTestDatabase> {
  const suffix = randomBytes(4).toString('hex');
  const adminUrl = adminDatabaseUrl();
  const databaseName = `cho_gia_su_${label}_${suffix}`;
  const roleName = `cho_gia_su_${label}_${suffix}`;
  const url = await provisionDatabase({
    adminUrl,
    databaseName,
    roleName,
    rolePassword: randomBytes(18).toString('base64url'),
  });
  const { error } = await migrateToLatest(url);
  if (error) {
    await dropDatabase(adminUrl, databaseName, roleName);
    throw error;
  }
  return {
    url,
    roleName,
    databaseName,
    close: () => dropDatabase(adminUrl, databaseName, roleName),
  };
}

// Thử kết nối và chạy một câu lệnh bằng chuỗi kết nối
export async function canConnect(connectionString: string): Promise<boolean> {
  const database = createDatabase<unknown>(connectionString, { max: 1 });
  try {
    await sql`select 1`.execute(database);
    return true;
  } catch {
    return false;
  } finally {
    await database.destroy();
  }
}
