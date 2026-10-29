// Lớp dùng chung của các trang Chợ gia sư theo bản thiết kế Eric duyệt ngày 2026-10-28 (YCTD-360): thẻ nền trắng bo lớn trên nền kem,
// nhãn tròn, ô ảnh đại diện bằng chữ đầu tên (chợ không dùng ảnh người thật)
export const CARD_CLASS = 'rounded-2xl border border-border bg-card';

export function Initials({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((word) => word.slice(0, 1).toUpperCase())
    .join('');
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-selected font-semibold text-brand-strong ${
        size === 'lg' ? 'size-24 text-page-title' : 'size-16 text-section-title'
      }`}
    >
      {letters || '?'}
    </span>
  );
}

export const money = (value: number) => `${value.toLocaleString('vi-VN')} đồng`;
export const when = (value: string) => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
