'use client';

import { Alert, Button, Dialog, FormField, Textarea } from '@hanaply/ui';
import { useActionState } from 'react';

import {
  type AdminUserActionState,
  restoreUserAction,
  revokeUserSessionsAction,
  suspendUserAction,
} from '@/app/admin/(protected)/users/[userId]/actions';

const initialState: AdminUserActionState = { status: 'idle', message: null };

interface ActionDialogProps {
  userId: string;
  action: (state: AdminUserActionState, formData: FormData) => Promise<AdminUserActionState>;
  title: string;
  description: string;
  confirmLabel: string;
  triggerLabel: string;
  danger?: boolean;
}

function ActionDialog({
  userId,
  action,
  title,
  description,
  confirmLabel,
  triggerLabel,
  danger = false,
}: ActionDialogProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const fieldId = `adminReason-${triggerLabel.replaceAll(' ', '-').toLowerCase()}`;
  return (
    <Dialog
      description={description}
      title={title}
      trigger={<Button variant={danger ? 'danger' : 'secondary'}>{triggerLabel}</Button>}
    >
      <form action={formAction} className="admin-confirmation-form">
        <input name="userId" type="hidden" value={userId} />
        {state.message ? (
          <Alert
            aria-live="polite"
            title={state.status === 'success' ? 'Action completed' : 'Action not completed'}
            tone={state.status === 'success' ? 'success' : 'danger'}
          >
            {state.message}
          </Alert>
        ) : null}
        <FormField
          hint="Required for the immutable audit trail. Use 10 to 500 characters."
          id={fieldId}
          label="Reason"
          required
        >
          <Textarea id={fieldId} maxLength={500} minLength={10} name="reason" required rows={5} />
        </FormField>
        <Button loading={pending} type="submit" variant={danger ? 'danger' : 'primary'}>
          {confirmLabel}
        </Button>
      </form>
    </Dialog>
  );
}

export interface AdminUserActionsProps {
  userId: string;
  accountStatus: string;
  canManageUsers: boolean;
  canManageSecurity: boolean;
  isCurrentAdministrator: boolean;
}

export function AdminUserActions({
  userId,
  accountStatus,
  canManageUsers,
  canManageSecurity,
  isCurrentAdministrator,
}: AdminUserActionsProps) {
  if (isCurrentAdministrator) {
    return (
      <Alert title="Self-protection is active" tone="info">
        Use a different authorized administrator for account-status or session operations on your
        own identity.
      </Alert>
    );
  }
  return (
    <div className="admin-user-actions">
      {canManageUsers && accountStatus === 'active' ? (
        <ActionDialog
          action={suspendUserAction}
          confirmLabel="Confirm Suspension"
          danger
          description="Protected access will be denied immediately. The reason and administrator identity are audited."
          title="Suspend this account?"
          triggerLabel="Suspend Account"
          userId={userId}
        />
      ) : null}
      {canManageUsers && accountStatus === 'suspended' ? (
        <ActionDialog
          action={restoreUserAction}
          confirmLabel="Confirm Restoration"
          description="Only a currently suspended account can be restored in Phase 1."
          title="Restore this account?"
          triggerLabel="Restore Account"
          userId={userId}
        />
      ) : null}
      {canManageUsers || canManageSecurity ? (
        <ActionDialog
          action={revokeUserSessionsAction}
          confirmLabel="Revoke All Sessions"
          danger
          description="Every active refresh session for this user will be removed. The user must sign in again."
          title="Revoke all user sessions?"
          triggerLabel="Revoke Sessions"
          userId={userId}
        />
      ) : null}
    </div>
  );
}
