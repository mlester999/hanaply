'use client';

import type { AdminJobDetail } from '@hanaply/contracts';
import { Alert, Button, Card, FormField, Textarea } from '@hanaply/ui';
import { useActionState, useState } from 'react';

import {
  type AdminJobStatusActionState,
  setJobStatusAction,
} from '@/app/admin/(protected)/jobs/[jobId]/actions';

const initialState: AdminJobStatusActionState = { status: 'idle', message: null };

const statusOptions = [
  { value: 'active', label: 'Active — visible on every customer feed' },
  { value: 'rejected', label: 'Rejected — removed from every customer feed' },
  { value: 'closed', label: 'Closed — no longer accepting applications' },
  { value: 'expired', label: 'Expired — past its freshness window' },
] as const;

export function AdminJobStatusControl({
  job,
  canModerate,
}: {
  job: AdminJobDetail;
  canModerate: boolean;
}) {
  const [state, formAction, pending] = useActionState(setJobStatusAction, initialState);
  const [status, setStatus] = useState<string>(job.status);
  if (!canModerate) {
    return (
      <Card className="admin-detail-card">
        <Alert title="Read-only job record" tone="info">
          The jobs.moderate permission is required to change this posting&rsquo;s status.
        </Alert>
      </Card>
    );
  }
  return (
    <Card className="admin-detail-card admin-job-status-card">
      <div className="admin-detail-heading">
        <h2>Moderation status</h2>
      </div>
      <p className="admin-section-copy">
        The current status is <strong>{job.status.replaceAll('_', ' ')}</strong>.
      </p>
      {status === 'rejected' ? (
        <Alert title="Rejecting removes this posting from every customer feed" tone="danger">
          A rejected posting stops being eligible for every customer surface, including the job
          radar, saved lists, and application packs. This is recorded in the audit trail with your
          reason and identity.
        </Alert>
      ) : null}
      <form action={formAction} className="admin-confirmation-form">
        <input name="jobId" type="hidden" value={job.id} />
        {state.message ? (
          <Alert
            aria-live="polite"
            title={state.status === 'success' ? 'Status updated' : 'Status not updated'}
            tone={state.status === 'success' ? 'success' : 'danger'}
          >
            {state.message}
          </Alert>
        ) : null}
        <FormField id="adminJobStatusSelect" label="New status" required>
          <select
            className="h-input"
            id="adminJobStatusSelect"
            name="status"
            onChange={(event) => {
              setStatus(event.target.value);
            }}
            required
            value={status}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          hint="Required for the immutable audit trail. Use 10 to 500 characters."
          id="adminJobStatusReason"
          label="Reason"
          required
        >
          <Textarea
            id="adminJobStatusReason"
            maxLength={500}
            minLength={10}
            name="reason"
            required
            rows={4}
          />
        </FormField>
        <Button
          loading={pending}
          type="submit"
          variant={status === 'rejected' ? 'danger' : 'primary'}
        >
          Change Status
        </Button>
      </form>
    </Card>
  );
}
