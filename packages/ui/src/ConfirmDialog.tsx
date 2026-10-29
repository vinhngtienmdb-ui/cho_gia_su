import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button.js';
import { DIALOG_NARROW_FULL_SCREEN_CLASS } from './dialog.js';

// Hộp thoại xác nhận bắt buộc với hành động không hoàn tác được, có mô tả hậu quả (TD-07)
export interface ConfirmDialogProperties {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProperties) {
  const dialogReference = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogReference.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogReference}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className={`m-auto w-full max-w-md rounded-xl border border-border bg-card p-6 text-text shadow-lg backdrop:bg-text/40 ${DIALOG_NARROW_FULL_SCREEN_CLASS}`}
    >
      <h2 className="text-section-title font-semibold">{title}</h2>
      <div className="mt-3 text-content text-text-secondary">{children}</div>
      <div className="mt-6 flex justify-end gap-3">
        <Button onClick={onCancel} disabled={busy}>
          Hủy
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
