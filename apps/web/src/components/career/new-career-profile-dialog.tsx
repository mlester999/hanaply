'use client';

import { Button, Dialog, FormField, Input } from '@hanaply/ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { createCareerProfileAction } from '@/app/(customer)/dashboard/career/actions';
import { CareerFeedback } from '@/components/career/career-feedback';
import { useCareerAction } from '@/components/career/use-career-action';
import { careerLevelOptions } from '@/lib/career';

/**
 * Creates an additional career profile inside the plan limit. The API refuses
 * the request when the limit is reached and its explanation is shown verbatim.
 */
export function NewCareerProfileDialog({ remaining }: { remaining: number }) {
  const [open, setOpen] = useState(false);
  const { state, onSubmit, pending } = useCareerAction(createCareerProfileAction, {
    onSuccess: () => {
      setOpen(false);
    },
  });

  return (
    <>
      <Dialog
        description="A profile holds one search direction: its own target roles, records, and verified facts."
        onOpenChange={setOpen}
        open={open}
        title="New career profile"
        trigger={
          <Button leadingIcon={<Plus aria-hidden="true" size={18} />} type="button">
            New profile
          </Button>
        }
      >
        <form className="career-form" onSubmit={onSubmit}>
          <FormField
            hint={`Your plan allows ${remaining} more ${remaining === 1 ? 'profile' : 'profiles'}.`}
            id="newCareerProfileName"
            label="Profile name"
            required
          >
            <Input
              defaultValue="Secondary search"
              id="newCareerProfileName"
              maxLength={120}
              name="name"
              required
            />
          </FormField>
          <FormField id="newCareerProfileRole" label="Current role title">
            <Input
              id="newCareerProfileRole"
              maxLength={160}
              name="currentRoleTitle"
              placeholder="Example: Data Analyst"
            />
          </FormField>
          <FormField id="newCareerProfileLevel" label="Career level">
            <select
              className="h-input"
              defaultValue=""
              id="newCareerProfileLevel"
              name="careerLevel"
            >
              <option value="">Not set</option>
              {careerLevelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            hint="Leave empty if you do not want a separate target list yet."
            id="newCareerProfileTargets"
            label="Target roles"
          >
            <Input
              id="newCareerProfileTargets"
              maxLength={120}
              name="targetRoleTitles"
              placeholder="Example: Analytics Engineer"
            />
          </FormField>
          <CareerFeedback
            errorTitle="Profile not created"
            state={state}
            successTitle="Profile created"
          />
          <div className="career-form-actions">
            <Button loading={pending} type="submit">
              Create profile
            </Button>
          </div>
        </form>
      </Dialog>
      <p aria-live="polite" className="career-inline-note">
        {state.status === 'success' ? state.message : ''}
      </p>
    </>
  );
}
