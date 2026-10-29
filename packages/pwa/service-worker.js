/* global self, caches, fetch, URL */
// Service worker dùng chung của ứng dụng giáo viên và phụ huynh (DT-26 phần 26a, YCTD-231; gom từ DT-23 phần 23b, YCTD-212,
// GD-108). Giữ vỏ ứng dụng (trang, tệp dựng) để mở được khi mất mạng sau lần tải đầu; KHÔNG bao giờ giữ lời gọi /api (dữ liệu,
// điểm, học bạ, học phí vẫn cần mạng). Gặp mạng thì lấy bản mới nhất và cập nhật bộ nhớ đệm, mất mạng mới dùng bản đã giữ.
// Plugin `pwaServiceWorker` (src/vite.ts) phục vụ tệp này ở `<base>sw.js` và thay ba dòng đánh dấu bên dưới: tiền tố bộ nhớ đệm
// của từng ứng dụng, mã bản dựng và danh sách tệp dựng (lúc phát triển mã bản dựng là 'phat-trien', chỉ giữ trang)
const VERSION = 'phat-trien';
/* precache */ const PRECACHE = ['./']; /* end-precache */
/* cache-prefix */ const CACHE_PREFIX = 'ung-dung-v-'; /* end-cache-prefix */
const CACHE = `${CACHE_PREFIX}${VERSION}`;
// Bộ nhớ đệm chỉ giữ tệp tĩnh cùng nguồn của vỏ ứng dụng nên bỏ qua Vary khi tra: máy chủ trả Vary: Origin (máy chủ phát triển
// vite luôn trả) thì tệp đã lưu không kèm Origin (lưu lúc làm ấm) không khớp yêu cầu mô-đun kèm Origin và trang không mở được
// khi mất mạng (lỗi chập chờn của e2e 151)
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  // Không tự giành quyền ngay: bản mới chờ giáo viên đồng ý tải lại (SKIP_WAITING), trừ lần cài đầu tiên
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        PRECACHE.map(async (path) => {
          try {
            const response = await fetch(new URL(path, self.registration.scope), { cache: 'reload' });
            if (response.ok) {
              await cache.put(new URL(path, self.registration.scope), response);
            }
          } catch {
            // Tệp không tải được lúc cài thì lần mở có mạng sau sẽ lưu
          }
        }),
      );
      if (!self.registration.active) {
        await self.skipWaiting();
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(CACHE_PREFIX) && name !== CACHE) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
  // Trang gửi danh sách tệp đã tải trước khi service worker kiểm soát trang để lưu thêm
  if (message?.type === 'CACHE_URLS' && Array.isArray(message.urls)) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE);
        for (const url of message.urls) {
          try {
            const target = new URL(url, self.location.origin);
            if (target.origin !== self.location.origin || target.pathname.includes('/api/')) {
              continue;
            }
            if (!(await cache.match(target, MATCH))) {
              const response = await fetch(target);
              if (response.ok) {
                await cache.put(target, response);
              }
            }
          } catch {
            // bỏ qua tệp không lưu được
          }
        }
      })(),
    );
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      void cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const hit = await cache.match(request, MATCH);
    if (hit) {
      return hit;
    }
    if (request.mode === 'navigate') {
      const shell = await cache.match(new URL('./', self.registration.scope), MATCH);
      if (shell) {
        return shell;
      }
    }
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) {
    return;
  }
  event.respondWith(networkFirst(request));
});
