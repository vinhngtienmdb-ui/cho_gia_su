// Nhãn trạng thái: nền nhạt cùng tông, chữ đậm cùng màu, luôn kèm chữ (TD-06)
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-info/10 text-info',
  neutral: 'bg-neutral/10 text-neutral',
};

export function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-label font-semibold ${TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}
