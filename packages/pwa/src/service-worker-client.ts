// Đăng ký, cập nhật, gỡ service worker dùng chung (DT-26 phần 26a, YCTD-231; gom từ classroom-offline.ts của 23b). Service
// worker chỉ giữ vỏ ứng dụng (trang, tệp dựng); mọi lời gọi /api đi thẳng ra mạng. Bản mới được tải nền rồi hỏi người dùng tải
// lại (không tự thay giữa chừng); mỗi lần quay lại ứng dụng và mỗi 30 phút kiểm tra bản mới một lần
const UPDATE_CHECK_MILLISECONDS = 30 * 60_000;

export interface ServiceWorkerOptions {
  // Đường dẫn gốc của ứng dụng (import.meta.env.BASE_URL), service worker ở `<base>sw.js`, phạm vi `<base>`
  base: string;
  // Cùng tiền tố đã khai ở plugin pwaServiceWorker; dùng khi gỡ để chỉ xóa bộ nhớ đệm của ứng dụng này
  cachePrefix: string;
}

type UpdateListener = (available: boolean) => void;
const listeners = new Set<UpdateListener>();
let updateAvailable = false;
let waitingWorker: ServiceWorker | null = null;
let updateTimer: ReturnType<typeof setInterval> | undefined;

function setUpdateAvailable(worker: ServiceWorker | null) {
  waitingWorker = worker;
  updateAvailable = worker !== null;
  listeners.forEach((listener) => listener(updateAvailable));
}

export function onUpdateAvailable(listener: UpdateListener): () => void {
  listeners.add(listener);
  listener(updateAvailable);
  return () => {
    listeners.delete(listener);
  };
}

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

// Tệp trang đã tải trước khi service worker kiểm soát trang (lần mở đầu): gửi cho service worker lưu để lần sau mở được khi
// mất mạng, không phải chờ tải lại một lần
function warmCache(worker: ServiceWorker | null | undefined) {
  if (!worker) {
    return;
  }
  const urls = [
    location.href,
    ...performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.startsWith(location.origin) && !name.includes('/api/')),
  ];
  worker.postMessage({ type: 'CACHE_URLS', urls });
}

export async function registerServiceWorker(options: ServiceWorkerOptions): Promise<void> {
  if (!serviceWorkerSupported()) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register(`${options.base}sw.js`, { scope: options.base });
    // Có bản mới đã cài xong, đang chờ: hỏi người dùng tải lại
    if (registration.waiting && navigator.serviceWorker.controller) {
      setUpdateAvailable(registration.waiting);
    }
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          setUpdateAvailable(installing);
        }
      });
    });
    if (updateTimer === undefined) {
      const check = () => {
        void registration.update().catch(() => undefined);
      };
      updateTimer = setInterval(check, UPDATE_CHECK_MILLISECONDS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          check();
        }
      });
    }
    const ready = await navigator.serviceWorker.ready;
    warmCache(ready.active);
  } catch {
    // Trình duyệt không cho đăng ký (chế độ riêng tư, địa chỉ không an toàn): ứng dụng vẫn chạy khi có mạng
  }
}

// Xóa bộ nhớ đệm của ứng dụng này (theo tiền tố); không đụng bộ nhớ đệm của ứng dụng khác trên cùng tên miền
export async function clearCaches(cachePrefix: string): Promise<void> {
  if (typeof caches === 'undefined') {
    return;
  }
  for (const name of await caches.keys()) {
    if (name.startsWith(cachePrefix)) {
      await caches.delete(name);
    }
  }
}

// Gỡ service worker của phạm vi này và xóa bộ nhớ đệm của vỏ ứng dụng (trường tắt ngoại tuyến của 23b)
export async function unregisterServiceWorker(options: ServiceWorkerOptions): Promise<void> {
  if (!serviceWorkerSupported()) {
    return;
  }
  try {
    for (const registration of await navigator.serviceWorker.getRegistrations()) {
      if (registration.scope === new URL(options.base, location.origin).href) {
        await registration.unregister();
      }
    }
    await clearCaches(options.cachePrefix);
  } catch {
    // bỏ qua
  }
  if (updateTimer !== undefined) {
    clearInterval(updateTimer);
    updateTimer = undefined;
  }
  setUpdateAvailable(null);
}

// Người dùng bấm tải lại: bản chờ nhận quyền rồi trang tải lại một lần
export function applyUpdate(): void {
  if (!waitingWorker) {
    location.reload();
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}
