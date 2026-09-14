'use client';

import type { AdminDedupCandidates } from '@hanaply/contracts';
import { Alert, Button, Dialog, FormField, Textarea } from '@hanaply/ui';
import { useActionState } from 'react';

import {
  type AdminDedupActionState,
  resolveDedupCandidateAction,
} from '@/app/admin/(protected)/deduplication/actions';

const initialState: AdminDedupActionState = { status: 'idle', message: null };

type Candidate = AdminDedupCandidates['items'][number];

interface ResolveDialogProps {
  candidate: Candidate;
  resolution: 'merged' | 'kept_separate';
  title: string;
  description: string;
  warning: string;
  confirmLabel: string;
  triggerLabel: string;
  danger?: boolean;
}

function ResolveDialog({
  candidate,
  resolution,
  title,
  description,
  warning,
  confirmLabel,
  triggerLabel,
  danger = false,
}: ResolveDialogProps) {
  const [state, formAction, pending] = useActionState(resolveDedupCandidateAction, initialState);
  const fieldId = `dedupReason-${candidate.id}-${resolution}`;
  return (
    <Dialog
      description={description}
      title={title}
      trigger={<Button variant={danger ? 'danger' : 'secondary'}>{triggerLabel}</Button>}
    >
      <form action={formAction} className="admin-confirmation-form">
        <input name="candidateId" type="hidden" value={candidate.id} />
        <input name="resolution" type="hidden" value={resolution} />
        <Alert
          title={resolution === 'merged' ? 'What merging does' : 'What keeping separate does'}
          tone={danger ? 'danger' : 'info'}
        >
          {warning}
        </Alert>
        {state.message ? (
          <Alert
            aria-live="polite"
            title={state.status === 'success' ? 'Decision recorded' : 'Decision not recorded'}
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
          <Textarea id={fieldId} maxLength={500} minLength={10} name="reason" required rows={4} />
        </FormField>
        <Button loading={pending} type="submit" variant={danger ? 'danger' : 'primary'}>
          {confirmLabel}
        </Button>
      </form>
    </Dialog>
  );
}

export function AdminDedupActions({
  candidate,
  canResolve,
}: {
  candidate: Candidate;
  canResolve: boolean;
}) {
  if (!canResolve) {
    return (
      <Alert title="Read-only queue" tone="info">
        The jobs.moderate permission is required to resolve a duplication candidate.
      </Alert>
    );
  }
  if (candidate.resolution) {
    return (
      <Alert title="Already resolved" tone="info">
        This pair was recorded as {candidate.resolution.replaceAll('_', ' ')}. The decision is kept
        in the audit trail and cannot be reversed from this queue.
      </Alert>
    );
  }
  return (
    <div className="admin-user-actions">
      <ResolveDialog
        candidate={candidate}
        confirmLabel="Confirm Merge"
        danger
        description={`Merge “${candidate.duplicateTitle}” (${candidate.duplicateCompany}) into “${candidate.jobTitle}” (${candidate.jobCompany}).`}
        resolution="merged"
        title="Merge the duplicate into the first record?"
        triggerLabel="Merge into the first record"
        warning={`Merging re-points every source record from “${candidate.duplicateTitle}” onto “${candidate.jobTitle}”, marks the duplicate job as a duplicate, and settles every other open pair that named it. Nothing is deleted: source records keep their provider attribution and payload checksums, so the merge stays reversible by inspection.`}
      />
      <ResolveDialog
        candidate={candidate}
        confirmLabel="Keep Separate"
        description={`Record that “${candidate.jobTitle}” and “${candidate.duplicateTitle}” are genuinely different postings.`}
        resolution="kept_separate"
        title="Keep these two records separate?"
        triggerLabel="Keep separate"
        warning="Keeping the pair separate records the decision and closes it in this queue. Neither job is changed, and the two postings stay independently visible."
      />
    </div>
  );
}
