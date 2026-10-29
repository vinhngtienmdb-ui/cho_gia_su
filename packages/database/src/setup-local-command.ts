import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { migrateToLatest } from './migrate.js';
import { adminDatabaseUrl, provisionDatabase } from './provision.js';

// Lệnh `pnpm cai-dat-tren-may`: tạo vai trò `cho_gia_su_service` và cơ sở dữ liệu `cho_gia_su` trên PostgreSQL của docker-compose (cổng
// 5442), ghi DATABASE_URL vào tệp .env ở gốc kho, chạy tệp thay đổi cấu trúc. Chạy lại được: giữ dữ liệu, đặt lại mật khẩu của vai trò
const ENV_FILE = new URL('../../../../.env', import.meta.url);

const url = await provisionDatabase({
  adminUrl: adminDatabaseUrl(),
  databaseName: 'cho_gia_su',
  roleName: 'cho_gia_su_service',
  rolePassword: randomBytes(18).toString('base64url'),
});
const text = readFileSync(ENV_FILE, 'utf8');
const line = `DATABASE_URL=${url}`;
writeFileSync(
  ENV_FILE,
  /^DATABASE_URL=.*$/m.test(text) ? text.replace(/^DATABASE_URL=.*$/m, line) : `${text}\n${line}\n`,
);
const { error, results } = await migrateToLatest(url);
for (const result of results ?? []) {
  console.log(`${result.migrationName} ${result.status}`);
}
if (error) {
  console.error('Chạy tệp thay đổi cấu trúc thất bại', error);
  process.exitCode = 1;
} else {
  console.log('Đã tạo cơ sở dữ liệu cho_gia_su và ghi DATABASE_URL vào .env');
}
