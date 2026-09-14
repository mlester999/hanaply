'use client';

import { FormField, Textarea } from '@hanaply/ui';
import { useState } from 'react';

export interface SummaryFieldProps {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  hint?: string;
  minLength?: number;
  maxLength?: number;
  rows?: number;
}

/**
 * Controlled summary textarea with a live character counter. The counter is
 * referenced by the textarea instead of being announced on every keystroke.
 *
 * The field re-seeds from `defaultValue` while the member has not typed into it.
 * A save triggers `router.refresh()`, and the refreshed value can arrive after
 * this component has already mounted — on the onboarding wizard's "Back to links
 * and summary" step, for example, where a controlled field would otherwise keep
 * the empty prop it mounted with and show a saved summary as blank. Once the
 * member has typed, the incoming value is ignored so a late refresh can never
 * overwrite what they are writing.
 */
export function SummaryField({
  id,
  name,
  label,
  defaultValue,
  hint,
  minLength = 80,
  maxLength = 4_000,
  rows = 6,
}: SummaryFieldProps) {
  const [value, setValue] = useState(defaultValue);
  const [seeded, setSeeded] = useState(defaultValue);
  const [edited, setEdited] = useState(false);
  const count = value.trim().length;
  const enough = count >= minLength;

  // Adjusting state during render, not in an effect: React re-runs this
  // component immediately without committing the stale value, so the field
  // shows the refreshed summary without a flash and without a cascading render.
  if (!edited && defaultValue !== seeded) {
    setSeeded(defaultValue);
    setValue(defaultValue);
  }

  return (
    <>
      <FormField hint={hint} id={id} label={label}>
        <Textarea
          aria-describedby={`${id}-counter`}
          id={id}
          maxLength={maxLength}
          name={name}
          onChange={(event) => {
            setEdited(true);
            setValue(event.currentTarget.value);
          }}
          rows={rows}
          value={value}
        />
      </FormField>
      <p className={enough ? 'career-counter is-ready' : 'career-counter'} id={`${id}-counter`}>
        {count} of {maxLength} characters.{' '}
        {enough
          ? 'Long enough for match analysis to use.'
          : `${minLength - count} more characters are recommended.`}
      </p>
    </>
  );
}
