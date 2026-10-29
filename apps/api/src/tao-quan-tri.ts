import { createDatabase, type MarketplaceDatabase } from '@cho-gia-su/database';
import { createAdmin, parseNewAdmin } from './admin/admin-accounts.js';
import { readKey32 } from './common/configuration.js';
import { ApplicationError } from './common/server.js';

// Lệnh tạo tài khoản quản trị (dùng cho tài khoản đầu tiên; sau đó vai quan_tri tạo thêm ở ứng dụng quản trị):
//   pnpm --filter @cho-gia-su/api tao-quan-tri -- --login <tên> --name "<họ tên>" [--role quan_tri|ho_tro|ke_toan]
// Mật khẩu đọc từ biến môi trường QUAN_TRI_MAT_KHAU (không truyền trên dòng lệnh để không lưu vào lịch sử lệnh). Khóa TOTP và mã khôi
// phục in ra một lần: nhập khóa vào ứng dụng xác thực, cất mã khôi phục
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const databaseUrl = process.env.DATABASE_URL?.trim();
const secretsKey = readKey32('MARKET_SECRETS_KEY', process.env.MARKET_SECRETS_KEY);
if (!databaseUrl || !secretsKey) {
  console.error('Thiếu DATABASE_URL hoặc MARKET_SECRETS_KEY');
  process.exit(1);
}
const database = createDatabase<MarketplaceDatabase>(databaseUrl, { max: 1 });
try {
  const created = await createAdmin(
    database,
    secretsKey,
    parseNewAdmin({
      login: argument('login'),
      full_name: argument('name'),
      role: argument('role') ?? 'quan_tri',
      password: process.env.QUAN_TRI_MAT_KHAU,
    }),
  );
  console.log(`Đã tạo tài khoản quản trị ${created.login} (${created.role})`);
  console.log(`Khóa TOTP: ${created.totp_secret}`);
  console.log(`Địa chỉ cho ứng dụng xác thực: ${created.totp_uri}`);
  console.log(`Mã khôi phục (mỗi mã dùng một lần): ${created.recovery_codes.join(' ')}`);
} catch (error) {
  if (error instanceof ApplicationError) {
    console.error(error.message, JSON.stringify(error.details));
  } else {
    console.error(error);
  }
  process.exitCode = 1;
} finally {
  await database.destroy();
}
