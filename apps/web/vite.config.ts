import { pwaServiceWorker } from '@cho-gia-su/pwa/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Ứng dụng Chợ gia sư, chung cho phụ huynh và gia sư (nguồn: apps/market của School Management, tách ở YCTD-384). Mọi điểm cuối nằm ở
// /api/v1/market của máy chủ API riêng của chợ
const apiTarget = process.env.API_BASE_URL ?? 'http://127.0.0.1:3300';
const base = process.env.APP_BASE_PATH?.trim() || '/';

export default defineConfig({
  base,
  // Service worker, tiền tố bộ nhớ đệm riêng của Chợ gia sư
  plugins: [react(), tailwindcss(), pwaServiceWorker({ cachePrefix: 'cho-gia-su-v-' })],
  server: {
    port: 5300,
    strictPort: true,
    proxy: {
      '/api/v1/market': { target: apiTarget },
    },
  },
});
