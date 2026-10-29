import { migrateToLatest } from './migrate.js';

// Lệnh `pnpm database:migrate`: chạy tệp thay đổi cấu trúc trên DATABASE_URL
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error('Thiếu DATABASE_URL');
  process.exit(1);
}
const { error, results } = await migrateToLatest(connectionString);
for (const result of results ?? []) {
  console.log(`${result.migrationName} ${result.status}`);
}
if (error) {
  console.error('Chạy tệp thay đổi cấu trúc thất bại', error);
  process.exitCode = 1;
} else {
  console.log('Cơ sở dữ liệu đã ở phiên bản cấu trúc mới nhất');
}
