import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

// Plugin Vite phục vụ service worker dùng chung ở `<base>sw.js` (DT-26 phần 26a, YCTD-231; thay plugin serviceWorkerRelease
// của 23b). Lúc phát triển trả mẫu với mã bản dựng 'phat-trien' và chỉ giữ trang; khi dựng phát ra dist/sw.js với mã bản dựng là
// biến APP_RELEASE nếu có, không thì băm tên các tệp dựng (tên có mã băm nội dung nên đổi nội dung là đổi mã), danh sách tệp
// .js, .css giữ sẵn khi cài. Mỗi ứng dụng một tiền tố bộ nhớ đệm để hai ứng dụng trên cùng tên miền không xóa nhầm của nhau
const TEMPLATE = fileURLToPath(new URL('../service-worker.js', import.meta.url));

export interface PwaServiceWorkerOptions {
  // Tiền tố tên bộ nhớ đệm, ví dụ 'cong-cu-lop-hoc-v-' (giáo viên, giữ tên của 23b), 'phu-huynh-v-'
  cachePrefix: string;
}

export function renderServiceWorker(
  template: string,
  cachePrefix: string,
  release: string,
  precache: string[],
): string {
  if (!/^[a-z0-9-]+$/.test(cachePrefix)) {
    throw new Error(`Tiền tố bộ nhớ đệm không hợp lệ: ${cachePrefix}`);
  }
  const quote = (value: string) => `'${value.replace(/[^a-zA-Z0-9._-]/g, '')}'`;
  return template
    .replace(/const VERSION = '[^']*';/, `const VERSION = ${quote(release)};`)
    .replace(
      /\/\* precache \*\/[\s\S]*?\/\* end-precache \*\//,
      `/* precache */ const PRECACHE = ${JSON.stringify(precache)}; /* end-precache */`,
    )
    .replace(
      /\/\* cache-prefix \*\/[\s\S]*?\/\* end-cache-prefix \*\//,
      `/* cache-prefix */ const CACHE_PREFIX = ${quote(cachePrefix)}; /* end-cache-prefix */`,
    );
}

export function pwaServiceWorker(options: PwaServiceWorkerOptions): Plugin {
  let base = '/';
  return {
    name: 'pwa-service-worker',
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== `${base}sw.js`) {
          next();
          return;
        }
        const source = renderServiceWorker(readFileSync(TEMPLATE, 'utf8'), options.cachePrefix, 'phat-trien', ['./']);
        response.setHeader('content-type', 'text/javascript; charset=utf-8');
        response.setHeader('cache-control', 'no-cache');
        response.end(source);
      });
    },
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).sort();
      const release =
        process.env.APP_RELEASE?.trim() || createHash('sha1').update(files.join('\n')).digest('hex').slice(0, 12);
      const precache = ['./', ...files.filter((name) => /\.(js|css)$/.test(name))];
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: renderServiceWorker(readFileSync(TEMPLATE, 'utf8'), options.cachePrefix, release, precache),
      });
    },
  };
}
