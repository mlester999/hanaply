import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';

import { cn } from './utils.js';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

export function Badge({
  tone = 'neutral',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span className={cn('h-badge', `h-badge--${tone}`, className)} {...props}>
      <span aria-hidden="true" className="h-badge-dot" />
      {children}
    </span>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('h-card', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('h-card-header', className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('h-card-body', className)} {...props} />;
}

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title: ReactNode;
  icon?: ReactNode;
}

export function Alert({ tone = 'info', title, icon, children, className, ...props }: AlertProps) {
  return (
    <div
      className={cn('h-alert', `h-alert--${tone}`, className)}
      role={tone === 'danger' ? 'alert' : 'status'}
      {...props}
    >
      {icon ? <span className="h-alert-icon">{icon}</span> : null}
      <div>
        <strong>{title}</strong>
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('h-skeleton', className)} {...props} />;
}

export function LoadingIndicator({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="h-loading" role="status">
      <span aria-hidden="true" className="h-spinner" />
      <span>{label}</span>
    </span>
  );
}

export interface EmptyStateProps {
  eyebrow?: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({ eyebrow, title, description, action, icon }: EmptyStateProps) {
  return (
    <section className="h-empty-state">
      {icon ? <div className="h-empty-icon">{icon}</div> : null}
      {eyebrow ? <span className="h-eyebrow">{eyebrow}</span> : null}
      <h2>{title}</h2>
      <div className="h-empty-copy">{description}</div>
      {action ? <div className="h-empty-action">{action}</div> : null}
    </section>
  );
}

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="h-page-header">
      <div>
        {eyebrow ? <span className="h-eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <div className="h-page-description">{description}</div> : null}
      </div>
      {actions ? <div className="h-page-actions">{actions}</div> : null}
    </header>
  );
}

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    // A focusable labelled region lets keyboard users scroll wide tables without a pointer.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div aria-label="Scrollable table" className="h-table-scroll" role="region" tabIndex={0}>
      <table className={cn('h-table', className)} {...props} />
    </div>
  );
}

export function TableHeaderCell({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('h-table-header-cell', className)} scope="col" {...props} />;
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('h-table-cell', className)} {...props} />;
}
