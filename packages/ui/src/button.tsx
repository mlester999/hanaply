import { cva, type VariantProps } from 'class-variance-authority';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from './utils.js';

const buttonVariants = cva('h-button', {
  variants: {
    variant: {
      primary: 'h-button--primary',
      secondary: 'h-button--secondary',
      quiet: 'h-button--quiet',
      danger: 'h-button--danger',
    },
    size: {
      sm: 'h-button--sm',
      md: 'h-button--md',
      lg: 'h-button--lg',
    },
    block: { true: 'h-button--block', false: '' },
  },
  defaultVariants: { variant: 'primary', size: 'md', block: false },
});

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariantProps {
  loading?: boolean;
  leadingIcon?: ReactNode;
}

export function Button({
  className,
  variant,
  size,
  block,
  loading = false,
  leadingIcon,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={loading ? true : disabled}
      type={type}
      {...props}
    >
      {loading ? <span aria-hidden="true" className="h-spinner h-spinner--small" /> : leadingIcon}
      <span>{children}</span>
      {loading ? <span className="h-sr-only">Loading</span> : null}
    </button>
  );
}

export interface LinkButtonProps
  extends AnchorHTMLAttributes<HTMLAnchorElement>, ButtonVariantProps {}

export function LinkButton({
  className,
  variant,
  size,
  block,
  children,
  ...props
}: LinkButtonProps) {
  return (
    <a className={cn(buttonVariants({ variant, size, block }), className)} {...props}>
      {children}
    </a>
  );
}
