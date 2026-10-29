import { writeFileSync } from 'node:fs';
import { adminDatabaseUrl, dropDatabase, migrateToLatest, provisionDatabase } from '@cho-gia-su/database';
import { E2E_DATABASE_NAME, E2E_DATABASE_ROLE, E2E_STATE_FILE } from '../e2e-environment.mjs';

// Dựng cơ sở dữ liệu kiểm thử của Chợ gia sư: gỡ cơ sở dữ liệu và vai trò của lần chạy trước, tạo lại bằng mật khẩu của lần chạy
// (playwright.config.ts sinh), chạy tệp thay đổi cấu trúc; ghi chuỗi kết nối và khóa mã hóa vào tệp trạng thái không đưa lên kho để
// các spec dựng dữ liệu và tạo tài khoản quản trị
export default async function globalSetup(): Promise<void> {
  const adminUrl = adminDatabaseUrl();
  const rolePassword = process.env.E2E_RUN_DATABASE_PASSWORD;
  const secretsKey = process.env.E2E_RUN_SECRETS_KEY;
  if (!rolePassword || !secretsKey) {
    throw new Error('Thiếu khóa của lần chạy: chạy bằng pnpm --filter @cho-gia-su/tests e2e');
  }
  await dropDatabase(adminUrl, E2E_DATABASE_NAME, E2E_DATABASE_ROLE);
  const databaseUrl = await provisionDatabase({
    adminUrl,
    databaseName: E2E_DATABASE_NAME,
    roleName: E2E_DATABASE_ROLE,
    rolePassword,
  });
  const migration = await migrateToLatest(databaseUrl);
  if (migration.error) {
    throw migration.error;
  }
  writeFileSync(E2E_STATE_FILE, JSON.stringify({ databaseUrl, secretsKey }));
}
