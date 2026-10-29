import type { ButtonHTMLAttributes } from 'react';

// Bốn loại nút: chính, phụ, chỉ chữ, phá hủy; mỗi màn hình chỉ một nút chính (TD-01)
export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-strong',
  secondary: 'border border-border-strong bg-card text-text hover:bg-selected',
  text: 'text-link hover:underline',
  danger: 'bg-danger text-white hover:opacity-90',
};

export interface ButtonProperties extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'secondary', className = '', type = 'button', ...properties }: ButtonProperties) {
  return (
    <button
      type={type}
      className={`rounded-lg px-4 py-2 text-label font-medium disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT_CLASSES[variant]} ${className}`}
      {...properties}
    />
  );
}
