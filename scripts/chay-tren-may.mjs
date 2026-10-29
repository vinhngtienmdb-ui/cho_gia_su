// Chạy Chợ gia sư trên máy bằng một lệnh (`pnpm dev`): máy chủ API (cổng 3300, bản đã dựng ở apps/api/dist), ứng dụng chợ (5300) và ứng
// dụng quản trị (5301) bằng máy chủ phát triển vite. Cần chạy trước: `pnpm environment:start`, `pnpm build`, `pnpm cai-dat-tren-may`.
// Dừng bằng Ctrl+C: dừng cả ba tiến trình
import { spawn } from 'node:child_process';

const PROCESSES = [
  ['api', ['--filter', '@cho-gia-su/api', 'start']],
  ['web', ['--filter', '@cho-gia-su/web', 'dev']],
  ['quan-tri', ['--filter', '@cho-gia-su/quan-tri', 'dev']],
];

const children = PROCESSES.map(([name, args]) => {
  const child = spawn('pnpm', args, { shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (stream) => (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) stream.write(`[${name}] ${line}\n`);
    }
  };
  child.stdout.on('data', prefix(process.stdout));
  child.stderr.on('data', prefix(process.stderr));
  child.on('exit', (code) => {
    console.log(`[${name}] dừng (mã ${code ?? 'tín hiệu'})`);
    stop();
  });
  return child;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log(
  'Chợ gia sư: API http://127.0.0.1:3300, ứng dụng chợ http://localhost:5300, quản trị http://localhost:5301',
);
