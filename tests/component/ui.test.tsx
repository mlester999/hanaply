// @vitest-environment jsdom

import '../setup-dom.js';

import { Button, Dialog, DropdownMenu, Switch, Tabs } from '@hanaply/ui';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

describe('accessible UI primitives', () => {
  it('communicates loading state and prevents duplicate button actions', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: /save/iu });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('opens a dialog from the keyboard, closes with Escape, and restores focus', async () => {
    const user = userEvent.setup();
    render(
      <Dialog trigger={<button type="button">Open details</button>} title="Account details">
        <button type="button">Inside action</button>
      </Dialog>,
    );
    const trigger = screen.getByRole('button', { name: 'Open details' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Account details' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('changes tabs with arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <Tabs
        defaultValue="profile"
        label="Settings"
        items={[
          { value: 'profile', label: 'Profile', content: 'Profile content' },
          { value: 'security', label: 'Security', content: 'Security content' },
        ]}
      />,
    );
    screen.getByRole('tab', { name: 'Profile' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Security' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByText('Security content')).toBeVisible();
  });

  it('toggles a switch with the keyboard', async () => {
    const user = userEvent.setup();
    render(<Switch label="Email alerts" />);
    const control = screen.getByRole('switch', { name: 'Email alerts' });
    control.focus();
    await user.keyboard(' ');
    expect(control).toHaveAttribute('data-state', 'checked');
  });

  it('operates menus without a pointer', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DropdownMenu
        label="Account menu"
        trigger={<button type="button">Account</button>}
        items={[{ label: 'Sign out', onSelect }]}
      />,
    );
    screen.getByRole('button', { name: 'Account menu' }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
