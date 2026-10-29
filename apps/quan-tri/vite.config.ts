import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Ứng dụng quản trị Chợ gia sư (YCTD-384): gọi /api/v1/market/admin của máy chủ API riêng của chợ
const apiTarget = process.env.API_BASE_URL ?? 'http://127.0.0.1:3300';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5301,
    strictPort: true,
    proxy: {
      '/api/v1/market/admin': { target: apiTarget },
    },
  },
});
