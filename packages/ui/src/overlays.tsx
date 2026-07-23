'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from './utils.js';

export interface DialogProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Root> {
  trigger: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  variant?: 'dialog' | 'drawer';
  contentClassName?: string;
}

export function Dialog({
  trigger,
  title,
  description,
  children,
  footer,
  variant = 'dialog',
  contentClassName,
  ...props
}: DialogProps) {
  return (
    <DialogPrimitive.Root {...props}>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="h-dialog-overlay" />
        <DialogPrimitive.Content
          className={cn(
            'h-dialog-content',
            variant === 'drawer' && 'h-dialog-content--drawer',
            contentClassName,
          )}
        >
          <div className="h-dialog-header">
            <div>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description>{description}</DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close aria-label="Close" className="h-icon-button">
              <X aria-hidden="true" size={20} />
            </DialogPrimitive.Close>
          </div>
          <div className="h-dialog-body">{children}</div>
          {footer ? <div className="h-dialog-footer">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Drawer(props: Omit<DialogProps, 'variant'>) {
  return <Dialog {...props} variant="drawer" />;
}

export interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  side?: ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['side'];
}

export function Tooltip({ label, children, side = 'top' }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content className="h-tooltip" side={side} sideOffset={6}>
            {label}
            <TooltipPrimitive.Arrow className="h-tooltip-arrow" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
