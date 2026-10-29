# 13. Công nghệ sử dụng

| Lớp | Công nghệ |
|---|---|
| Ngôn ngữ, môi trường | TypeScript 6, Node.js 24, pnpm 10 (monorepo) |
| Máy chủ API | NestJS 11 (Express), Kysely 0.29, pg, @node-rs/argon2, jose (OIDC), livekit-server-sdk, @aws-sdk/client-s3 |
| Giao diện | React 19, Vite 8, Tailwind CSS 4, livekit-client |
| Cơ sở dữ liệu | PostgreSQL 17 |
| Kho tệp | Tương thích S3 (SeaweedFS khi chạy trên máy) |
| Kiểm thử | node:test (máy chủ, gói), Playwright (đầu cuối) |
| Chất lượng | ESLint 10, typescript-eslint, Prettier 3 |
| Tích hợp liên tục | GitHub Actions (`.github/workflows/ci.yml`) |
