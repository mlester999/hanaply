'use client';

import type { CareerProfileDetail } from '@hanaply/contracts';
import { Alert, Button, Dialog } from '@hanaply/ui';
import { Star, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  deleteCareerProfileAction,
  setCareerProfileStatusAction,
  setPrimaryCareerProfileAction,
} from '@/app/(customer)/dashboard/career/actions';
import { CareerFeedback } from '@/components/career/career-feedback';
import { useCareerAction } from '@/components/career/use-career-action';
import { profileStatusOptions } from '@/lib/career';

/** Lifecycle controls: status, primary profile, and the destructive delete. */
export function CareerProfileActions({ profile }: { profile: CareerProfileDetail }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const status = useCareerAction(setCareerProfileStatusAction);
  const primary = useCareerAction(setPrimaryCareerProfileAction);
  const removal = useCareerAction(deleteCareerProfileAction);

  return (
    <div className="career-lifecycle">
      <form className="career-lifecycle-form" onSubmit={status.onSubmit}>
        <input name="profileId" type="hidden" value={profile.id} />
        <label className="h-label" htmlFor="careerProfileStatus">
          Profile status
        </label>
        <div className="career-lifecycle-row">
          <select
            className="h-input"
            defaultValue={profile.status}
            id="careerProfileStatus"
            name="status"
          >
            {profileStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button loading={status.pending} type="submit" variant="secondary">
            Update status
          </Button>
        </div>
        <p className="career-hint">
          Archived profiles stop being used for matching but keep every record.
        </p>
        <CareerFeedback
          errorTitle="Status not changed"
          state={status.state}
          successTitle="Status changed"
        />
      </form>

      <form className="career-lifecycle-form" onSubmit={primary.onSubmit}>
        <input name="profileId" type="hidden" value={profile.id} />
        <span className="h-label">Primary profile</span>
        {profile.isPrimary ? (
          <p className="career-hint">This is the primary career profile for your account.</p>
        ) : (
          <Button
            leadingIcon={<Star aria-hidden="true" size={16} />}
            loading={primary.pending}
            type="submit"
            variant="secondary"
          >
            Make primary
          </Button>
        )}
        <CareerFeedback
          errorTitle="Primary profile not changed"
          state={primary.state}
          successTitle="Primary profile changed"
        />
      </form>

      <div className="career-lifecycle-form">
        <span className="h-label">Delete profile</span>
        <Dialog
          description="This cannot be undone."
          onOpenChange={setDeleteOpen}
          open={deleteOpen}
          title="Delete this career profile?"
          trigger={
            <Button
              leadingIcon={<Trash2 aria-hidden="true" size={16} />}
              type="button"
              variant="danger"
            >
              Delete profile
            </Button>
          }
        >
          <form className="career-delete-form" onSubmit={removal.onSubmit}>
            <input name="profileId" type="hidden" value={profile.id} />
            <Alert title="Every record beneath this profile is deleted" tone="warning">
              Employment, education, certifications, links, skills, sub-careers, and the fact ledger
              for {profile.name} are removed. Uploaded documents stay in your document library.
            </Alert>
            <label className="career-choice">
              <input name="confirmDelete" type="checkbox" value="on" />
              <span>I understand this permanently deletes the profile and its records.</span>
            </label>
            <CareerFeedback
              errorTitle="Profile not deleted"
              state={removal.state}
              successTitle="Profile deleted"
            />
            <div className="career-form-actions">
              <Button
                leadingIcon={<Trash2 aria-hidden="true" size={16} />}
                loading={removal.pending}
                type="submit"
                variant="danger"
              >
                Delete profile permanently
              </Button>
            </div>
          </form>
        </Dialog>
      </div>
    </div>
  );
}
