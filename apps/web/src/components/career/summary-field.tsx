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
  const count = value.trim().length;
  const enough = count >= minLength;

  return (
    <>
      <FormField hint={hint} id={id} label={label}>
        <Textarea
          aria-describedby={`${id}-counter`}
          id={id}
          maxLength={maxLength}
          name={name}
          onChange={(event) => {
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
