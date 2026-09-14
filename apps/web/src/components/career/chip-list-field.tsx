'use client';

import { Button, FormField, Input } from '@hanaply/ui';
import { X } from 'lucide-react';
import { useState } from 'react';

export interface ChipListFieldProps {
  /** Repeated hidden inputs are posted under this name. */
  name: string;
  id: string;
  label: string;
  hint?: string;
  placeholder?: string;
  maxItems: number;
  maxLength: number;
  initialValues: readonly string[];
  emptyMessage: string;
  addLabel?: string;
}

/**
 * A chip list backed by repeated hidden inputs, so the submitted FormData is
 * exactly the list the owner sees. Removing the last chip clears the field on
 * the server because the key is always present when the step is saved.
 */
export function ChipListField({
  name,
  id,
  label,
  hint,
  placeholder,
  maxItems,
  maxLength,
  initialValues,
  emptyMessage,
  addLabel = 'Add',
}: ChipListFieldProps) {
  const [values, setValues] = useState<readonly string[]>(initialValues);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  function add() {
    const value = draft.trim();
    if (value === '') {
      setNotice('Type a value before adding it.');
      return;
    }
    if (value.length > maxLength) {
      setNotice(`Keep each value to ${maxLength} characters or fewer.`);
      return;
    }
    if (values.length >= maxItems) {
      setNotice(`You can add up to ${maxItems} values here.`);
      return;
    }
    if (values.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      setNotice('That value is already in the list.');
      return;
    }
    setValues([...values, value]);
    setDraft('');
    setNotice(null);
  }

  function remove(value: string) {
    setValues(values.filter((existing) => existing !== value));
    setNotice(null);
  }

  return (
    <FormField
      hint={hint ?? `Up to ${maxItems} values, ${maxLength} characters each.`}
      id={id}
      label={label}
    >
      <div className="career-chips">
        <div className="career-chip-add">
          <Input
            aria-describedby={`${id}-notice`}
            id={id}
            maxLength={maxLength}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
            value={draft}
          />
          <Button onClick={add} size="sm" type="button" variant="secondary">
            {addLabel}
          </Button>
        </div>
        {values.length > 0 ? (
          <ul className="career-chip-items">
            {values.map((value) => (
              <li key={value}>
                <span>{value}</span>
                <button
                  aria-label={`Remove ${value}`}
                  className="career-chip-remove"
                  onClick={() => {
                    remove(value);
                  }}
                  type="button"
                >
                  <X aria-hidden="true" size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="career-chip-empty">{emptyMessage}</p>
        )}
        {values.map((value) => (
          <input key={`${name}-${value}`} name={name} type="hidden" value={value} />
        ))}
        <p aria-live="polite" className="career-chip-notice" id={`${id}-notice`}>
          {notice}
        </p>
      </div>
    </FormField>
  );
}
