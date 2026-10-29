import { sql } from 'kysely';
import { createDatabase } from './connection.js';

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export function assertIdentifier(value: string, what: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${what} không hợp lệ: ${value}`);
  }
}

export function replaceDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export interface ProvisionDatabaseRequest {
  adminUrl: string;
  databaseName: string;
  roleName: string;
  rolePassword: string;
}

// Tạo vai trò đăng nhập và cơ sở dữ liệu do vai trò đó sở hữu, chỉ vai trò đó (và quản trị) kết nối được; trả chuỗi kết nối bằng vai
// trò. Chạy lại khi đã có thì giữ nguyên dữ liệu, chỉ đặt lại mật khẩu
export async function provisionDatabase(request: ProvisionDatabaseRequest): Promise<string> {
  const { roleName } = request;
  assertIdentifier(roleName, 'Tên vai trò');
  assertIdentifier(request.databaseName, 'Tên cơ sở dữ liệu');
  const admin = createDatabase<unknown>(request.adminUrl, { max: 1 });
  try {
    const role = await sql<{
      exists: boolean;
    }>`select exists(select 1 from pg_roles where rolname = ${roleName}) as exists`.execute(admin);
    if (role.rows[0]?.exists) {
      await sql`alter role ${sql.id(roleName)} login password ${sql.lit(request.rolePassword)}`.execute(admin);
    } else {
      await sql`create role ${sql.id(roleName)} login password ${sql.lit(request.rolePassword)} nocreatedb nocreaterole nosuperuser`.execute(
        admin,
      );
    }
    const database = await sql<{
      exists: boolean;
    }>`select exists(select 1 from pg_database where datname = ${request.databaseName}) as exists`.execute(admin);
    if (!database.rows[0]?.exists) {
      await sql`create database ${sql.id(request.databaseName)} owner ${sql.id(roleName)}`.execute(admin);
    }
    await sql`revoke connect on database ${sql.id(request.databaseName)} from public`.execute(admin);
    await sql`grant connect on database ${sql.id(request.databaseName)} to ${sql.id(roleName)}`.execute(admin);
  } finally {
    await admin.destroy();
  }
  const url = new URL(replaceDatabaseName(request.adminUrl, request.databaseName));
  url.username = roleName;
  url.password = request.rolePassword;
  return url.toString();
}

export async function dropDatabase(adminUrl: string, databaseName: string, roleName?: string): Promise<void> {
  assertIdentifier(databaseName, 'Tên cơ sở dữ liệu');
  const admin = createDatabase<unknown>(adminUrl, { max: 1 });
  try {
    await sql`drop database if exists ${sql.id(databaseName)} with (force)`.execute(admin);
    if (roleName) {
      assertIdentifier(roleName, 'Tên vai trò');
      await sql`drop role if exists ${sql.id(roleName)}`.execute(admin);
    }
  } finally {
    await admin.destroy();
  }
}

// Tài khoản quản trị PostgreSQL để dựng và gỡ cơ sở dữ liệu (cài đặt trên máy, kiểm thử). Lấy từ ADMIN_DATABASE_URL, hoặc ghép từ
// PGPASSWORD (CI) hoặc POSTGRES_PASSWORD (.env phát triển); không đặt mật khẩu trong mã
export function adminDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.ADMIN_DATABASE_URL?.trim();
  if (explicit) {
    return explicit;
  }
  const password = env.PGPASSWORD ?? env.POSTGRES_PASSWORD;
  if (!password) {
    throw new Error('Thiếu ADMIN_DATABASE_URL, PGPASSWORD hoặc POSTGRES_PASSWORD');
  }
  const user = env.POSTGRES_USER ?? 'postgres';
  const host = env.PGHOST ?? '127.0.0.1';
  const port = env.PGPORT ?? '5442';
  return `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/postgres`;
}
