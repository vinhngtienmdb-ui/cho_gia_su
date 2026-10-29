import type { ReactNode } from 'react';

// Khối thông báo trong trang, luôn kèm chữ, không chỉ dùng màu (mục 7 của 15_HE_THONG_THIET_KE.md)
export type AlertTone = 'danger' | 'warning' | 'info' | 'success';

const TONE_CLASSES: Record<AlertTone, string> = {
  danger: 'border-danger/30 bg-danger/10 text-danger',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  info: 'border-info/30 bg-info/10 text-info',
  success: 'border-success/30 bg-success/10 text-success',
};

export function Alert({ tone, children }: { tone: AlertTone; children: ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-label font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </div>
  );
}
