'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

import { cn } from './utils.js';

export interface TabsItem {
  value: string;
  label: ReactNode;
  content: ReactNode;
}

export interface TabsProps extends Omit<TabsPrimitive.TabsProps, 'children'> {
  items: readonly TabsItem[];
  label: string;
}

export function Tabs({ items, label, ...props }: TabsProps) {
  return (
    <TabsPrimitive.Root {...props}>
      <TabsPrimitive.List aria-label={label} className="h-tabs-list">
        {items.map((item) => (
          <TabsPrimitive.Trigger className="h-tabs-trigger" key={item.value} value={item.value}>
            {item.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((item) => (
        <TabsPrimitive.Content className="h-tabs-content" key={item.value} value={item.value}>
          {item.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

export interface DropdownItem {
  label: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
}

export interface DropdownMenuProps {
  trigger: ReactNode;
  label: string;
  items: readonly DropdownItem[];
}

export function DropdownMenu({ trigger, label, items }: DropdownMenuProps) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger aria-label={label} asChild>
        {trigger}
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content className="h-menu" sideOffset={6}>
          {items.map((item, index) => {
            const key = typeof item.label === 'string' ? item.label : `item-${index}`;
            return (
              <DropdownMenuPrimitive.Item
                className="h-menu-item"
                key={key}
                {...(item.disabled === undefined ? {} : { disabled: item.disabled })}
                {...(item.onSelect === undefined ? {} : { onSelect: item.onSelect })}
              >
                {item.label}
              </DropdownMenuPrimitive.Item>
            );
          })}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

export interface NavigationItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  active?: boolean;
  icon?: ReactNode;
}

export function NavigationItem({
  active,
  icon,
  children,
  className,
  ...props
}: NavigationItemProps) {
  return (
    <a
      aria-current={active ? 'page' : undefined}
      className={cn('h-nav-item', active && 'h-nav-item--active', className)}
      {...props}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <span>{children}</span>
    </a>
  );
}
