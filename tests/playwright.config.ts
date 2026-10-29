import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { adminDatabaseUrl, replaceDatabaseName } from '@cho-gia-su/database';
import {
  E2E_ADMIN_PORT,
  E2E_API_PORT,
  E2E_DATABASE_NAME,
  E2E_DATABASE_ROLE,
  E2E_MARKET_HOST,
  E2E_MARKET_OIDC_CLIENT_ID,
  E2E_MARKET_OIDC_CODE,
  E2E_MARKET_OIDC_PORT,
  E2E_S3_BUCKET,
  E2E_WEB_PORT,
} from './e2e-environment.mjs';

// Kiểm thử giao diện của Chợ gia sư: máy chủ API, ứng dụng chợ (phụ huynh và gia sư), ứng dụng quản trị; cơ sở dữ liệu riêng do
// e2e/global-setup.ts dựng lại mỗi lần chạy. Chạy: pnpm --filter @cho-gia-su/tests e2e
// Tài khoản quản trị PostgreSQL và kho tệp S3 đọc từ tệp .env ở gốc kho (không đưa lên kho)
if (existsSync('../.env')) {
  process.loadEnvFile('../.env');
}

// Mật khẩu vai trò cơ sở dữ liệu, khóa mã hóa, bí mật của nhà cung cấp OIDC giả lập sinh ngẫu nhiên cho từng lần chạy. Tiến trình chạy
// kiểm thử nạp lại tệp cấu hình này và kế thừa biến môi trường của tiến trình chính nên chỉ sinh một lần
if (!process.env.E2E_RUN_DATABASE_PASSWORD) {
  process.env.E2E_RUN_DATABASE_PASSWORD = randomBytes(18).toString('base64url');
  process.env.E2E_RUN_SECRETS_KEY = randomBytes(32).toString('base64');
  process.env.E2E_RUN_FILES_KEY = randomBytes(32).toString('base64');
  process.env.E2E_RUN_OIDC_CLIENT_SECRET = randomBytes(16).toString('hex');
}
const databaseUrl = new URL(replaceDatabaseName(adminDatabaseUrl(), E2E_DATABASE_NAME));
databaseUrl.username = E2E_DATABASE_ROLE;
databaseUrl.password = process.env.E2E_RUN_DATABASE_PASSWORD;
process.env.E2E_RUN_DATABASE_URL = databaseUrl.toString();

const isContinuousIntegration = Boolean(process.env.CI);
const apiBaseUrl = `http://127.0.0.1:${E2E_API_PORT}`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isContinuousIntegration,
  retries: isContinuousIntegration ? 1 : 0,
  timeout: isContinuousIntegration ? 60_000 : 45_000,
  reporter: isContinuousIntegration ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Máy chủ chỉ kết nối cơ sở dữ liệu khi có yêu cầu đầu tiên, nên khởi động được trước bước dựng cơ sở dữ liệu
      command: 'node dist/main.js',
      cwd: '../apps/api',
      port: E2E_API_PORT,
      reuseExistingServer: false,
      env: {
        PORT: String(E2E_API_PORT),
        DATABASE_URL: process.env.E2E_RUN_DATABASE_URL ?? '',
        MARKET_HOST: E2E_MARKET_HOST,
        MARKET_SECRETS_KEY: process.env.E2E_RUN_SECRETS_KEY ?? '',
        MARKET_FILES_KEY: process.env.E2E_RUN_FILES_KEY ?? '',
        // Bộ giả lập lớp video (DT-27 phần 27a)
        VIDEO_PROVIDER: 'mock',
        // Việc định kỳ tắt: kiểm thử tự dời giờ buổi học và thao tác ở giao diện
        MARKET_JOB_INTERVAL_SECONDS: '0',
        S3_BUCKET: E2E_S3_BUCKET,
        // Xác minh danh tính gia sư bằng nhà cung cấp OIDC giả lập do spec 196 chạy (DT-27 phần 27g)
        MARKET_IDENTITY_PROVIDERS: JSON.stringify([
          {
            code: E2E_MARKET_OIDC_CODE,
            profile: 'oidc',
            display_name: 'Định danh giả lập',
            issuer: `http://127.0.0.1:${E2E_MARKET_OIDC_PORT}/oidc-gia-lap`,
            client_id: E2E_MARKET_OIDC_CLIENT_ID,
            birthdate_claim: 'birthdate',
            jwks_cooldown_seconds: 0,
          },
        ]),
        [`MARKET_IDENTITY_${E2E_MARKET_OIDC_CODE.toUpperCase().replaceAll('-', '_')}_CLIENT_SECRET`]:
          process.env.E2E_RUN_OIDC_CLIENT_SECRET ?? '',
      },
    },
    {
      command: `pnpm --filter @cho-gia-su/web exec vite --port ${E2E_WEB_PORT} --strictPort`,
      url: `http://localhost:${E2E_WEB_PORT}`,
      reuseExistingServer: false,
      env: { API_BASE_URL: apiBaseUrl },
    },
    {
      command: `pnpm --filter @cho-gia-su/quan-tri exec vite --port ${E2E_ADMIN_PORT} --strictPort`,
      url: `http://localhost:${E2E_ADMIN_PORT}`,
      reuseExistingServer: false,
      env: { API_BASE_URL: apiBaseUrl },
    },
  ],
});
