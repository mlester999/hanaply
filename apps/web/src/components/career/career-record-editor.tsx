'use client';

import type { CareerRecordKind } from '@hanaply/contracts';
import { Button, Dialog, FormField, Input, Textarea } from '@hanaply/ui';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  deleteCareerRecordAction,
  saveCareerRecordAction,
} from '@/app/(customer)/dashboard/career/actions';
import { CareerFeedback } from '@/components/career/career-feedback';
import { useCareerAction } from '@/components/career/use-career-action';
import { careerRecordSpecs, type CareerRecord, type CareerRecordField } from '@/lib/career-records';

function RecordField({
  field,
  idPrefix,
  defaultValue,
  error,
}: {
  field: CareerRecordField;
  idPrefix: string;
  defaultValue: string;
  error: string | undefined;
}) {
  const controlId = `${idPrefix}-${field.name}`;
  if (field.control === 'checkbox') {
    return (
      <label className="career-checkbox" htmlFor={controlId}>
        <input
          defaultChecked={defaultValue === 'on'}
          id={controlId}
          name={field.name}
          type="checkbox"
        />
        <span>{field.label}</span>
      </label>
    );
  }

  const options = field.options ?? [];
  return (
    <FormField
      error={error}
      hint={field.hint}
      id={controlId}
      label={field.label}
      required={field.required ?? false}
    >
      {field.control === 'textarea' ? (
        <Textarea
          defaultValue={defaultValue}
          id={controlId}
          maxLength={field.maxLength}
          name={field.name}
          rows={4}
        />
      ) : field.control === 'lines' ? (
        <Textarea
          defaultValue={defaultValue}
          id={controlId}
          maxLength={field.maxLength}
          name={field.name}
          rows={4}
          spellCheck={false}
        />
      ) : field.control === 'date' ? (
        <Input
          defaultValue={defaultValue}
          id={controlId}
          name={field.name}
          required={field.required}
          type="date"
        />
      ) : field.control === 'number' ? (
        <Input
          defaultValue={defaultValue}
          id={controlId}
          max={field.max}
          min={field.min}
          name={field.name}
          step={field.step}
          type="number"
        />
      ) : field.control === 'select' ? (
        <select
          className="h-input"
          defaultValue={defaultValue}
          id={controlId}
          name={field.name}
          required={field.required}
        >
          {field.clearable ? <option value="">Not set</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <Input
          defaultValue={defaultValue}
          id={controlId}
          maxLength={field.maxLength}
          name={field.name}
          placeholder={field.placeholder}
          required={field.required}
        />
      )}
    </FormField>
  );
}

export interface CareerRecordEditorProps {
  profileId: string;
  kind: CareerRecordKind;
  record?: CareerRecord | null;
  variant?: 'dialog' | 'inline';
  idPrefix: string;
  triggerLabel?: string;
  onSaved?: () => void;
}

/**
 * Creates or edits one structured career record. The field list comes from the
 * shared record spec, so the form always matches the contract schema for the
 * selected record kind.
 */
export function CareerRecordEditor({
  profileId,
  kind,
  record = null,
  variant = 'dialog',
  idPrefix,
  triggerLabel,
  onSaved,
}: CareerRecordEditorProps) {
  const spec = careerRecordSpecs[kind];
  const values = spec.values(record);
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { state, onSubmit, pending } = useCareerAction(saveCareerRecordAction, {
    onSuccess: () => {
      // A new record clears its form so the next one starts empty; an edit keeps
      // the saved values and simply closes the dialog.
      if (record === null) formRef.current?.reset();
      setOpen(false);
      if (onSaved) onSaved();
    },
  });
  const editing = record !== null;
  const submitLabel = editing ? 'Save changes' : spec.addLabel;

  const form = (
    <form className="career-record-form" onSubmit={onSubmit} ref={formRef}>
      <input name="profileId" type="hidden" value={profileId} />
      <input name="kind" type="hidden" value={kind} />
      {record ? <input name="recordId" type="hidden" value={record.value.id} /> : null}
      <div className="career-record-grid">
        {spec.fields.map((field) => (
          <RecordField
            defaultValue={values[field.name] ?? ''}
            error={state.fieldErrors[field.name]?.[0]}
            field={field}
            idPrefix={idPrefix}
            key={field.name}
          />
        ))}
      </div>
      <CareerFeedback
        errorTitle={`${spec.label} not saved`}
        state={state}
        successTitle={`${spec.label} saved`}
      />
      <div className="career-record-actions">
        <Button loading={pending} type="submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  );

  if (variant === 'inline') {
    return form;
  }

  return (
    <>
      <Dialog
        description={
          editing
            ? `Update this ${spec.singular} on your career profile.`
            : `Add a ${spec.singular}. You can edit or delete it later.`
        }
        onOpenChange={setOpen}
        open={open}
        title={editing ? `Edit ${spec.singular}` : spec.addLabel}
        trigger={
          <Button
            leadingIcon={
              editing ? (
                <Pencil aria-hidden="true" size={16} />
              ) : (
                <Plus aria-hidden="true" size={16} />
              )
            }
            size="sm"
            type="button"
            variant="secondary"
          >
            {triggerLabel ?? (editing ? 'Edit' : spec.addLabel)}
          </Button>
        }
      >
        {form}
      </Dialog>
      <p aria-live="polite" className="career-inline-note">
        {state.status === 'success' ? state.message : ''}
      </p>
    </>
  );
}

export function CareerRecordDeleteForm({
  profileId,
  kind,
  recordId,
  label,
}: {
  profileId: string;
  kind: CareerRecordKind;
  recordId: string;
  label: string;
}) {
  const { state, onSubmit, pending } = useCareerAction(deleteCareerRecordAction);
  return (
    <form className="career-record-delete" onSubmit={onSubmit}>
      <input name="profileId" type="hidden" value={profileId} />
      <input name="kind" type="hidden" value={kind} />
      <input name="recordId" type="hidden" value={recordId} />
      <Button
        aria-label={`Delete ${label}`}
        leadingIcon={<Trash2 aria-hidden="true" size={16} />}
        loading={pending}
        size="sm"
        type="submit"
        variant="quiet"
      >
        Delete
      </Button>
      <span aria-live="polite" className="career-inline-note">
        {state.status === 'error' ? state.message : ''}
      </span>
    </form>
  );
}
