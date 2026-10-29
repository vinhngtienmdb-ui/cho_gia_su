import { registerServiceWorker } from '@cho-gia-su/pwa';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MarketApplication } from './MarketApplication.js';
import './index.css';

// Ứng dụng web cài được (DT-26 phần 26a; ứng dụng Gia sư đã có từ YCTD-262, giữ khi gộp ở YCTD-368): manifest tĩnh của Chợ gia sư
// (không theo trường), service worker giữ vỏ ứng dụng, không bao giờ giữ lời gọi /api
void registerServiceWorker({ base: import.meta.env.BASE_URL, cachePrefix: 'cho-gia-su-v-' });

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Không tìm thấy phần tử gốc');
}

createRoot(rootElement).render(
  <StrictMode>
    <MarketApplication />
  </StrictMode>,
);
