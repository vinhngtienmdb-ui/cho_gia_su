import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

// Biểu mẫu theo mẫu của Sở (DT-15 phần 15c): nhập theo khối có tiêu đề, nhãn bên trái, ô nhập bên phải; màn hình hẹp thì
// nhãn nằm trên ô nhập. Ô nhập được gắn mã để nhãn trỏ tới, thông báo lỗi nằm dưới ô
export const FORM_CONTROL_CLASS =
  'w-full rounded-lg border border-border bg-card px-3 py-2 text-content text-text outline-none focus:border-border-strong focus:ring-2 focus:ring-selected disabled:bg-page disabled:text-text-secondary';

export function FormBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <legend className="px-1 text-content font-semibold text-text">{title}</legend>
      {children}
    </fieldset>
  );
}

const CONTROL_TAGS = ['input', 'select', 'textarea'];

type ControlProperties = { id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string };

export function FormRow({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  // Một ô nhập (input, select, textarea) hoặc nội dung chỉ đọc
  children: ReactNode;
}) {
  const generatedId = useId();
  const errorId = `${generatedId}-error`;
  const control =
    isValidElement<ControlProperties>(children) && CONTROL_TAGS.includes(children.type as string) ? children : null;
  const controlId = control?.props.id ?? generatedId;
  return (
    <div className="grid grid-cols-1 gap-1 md:grid-cols-[12rem_minmax(0,1fr)] md:items-center md:gap-3">
      {control ? (
        <label htmlFor={controlId} className="text-label font-medium text-text md:text-right">
          {label}
        </label>
      ) : (
        <span className="text-label font-medium text-text md:text-right">{label}</span>
      )}
      <div className="flex flex-col gap-1">
        {control
          ? cloneElement(control as ReactElement<ControlProperties>, {
              id: controlId,
              'aria-invalid': error ? true : undefined,
              'aria-describedby': error ? errorId : undefined,
            })
          : children}
        {error ? (
          <p id={errorId} className="text-label text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
