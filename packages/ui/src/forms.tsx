'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Check, ChevronDown } from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from './utils.js';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('h-input', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('h-input h-textarea', className)} {...props} />;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends ComponentPropsWithoutRef<typeof SelectPrimitive.Root> {
  label: string;
  placeholder?: string;
  options: readonly SelectOption[];
  className?: string;
}

export function Select({ label, placeholder, options, className, ...props }: SelectProps) {
  return (
    <SelectPrimitive.Root {...props}>
      <SelectPrimitive.Trigger aria-label={label} className={cn('h-input h-select', className)}>
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon aria-hidden="true">
          <ChevronDown size={18} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="h-select-content" position="popper" sideOffset={6}>
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                className="h-select-item"
                key={option.value}
                value={option.value}
                {...(option.disabled === undefined ? {} : { disabled: option.disabled })}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator aria-hidden="true">
                  <Check size={16} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export interface CheckboxProps extends Omit<
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
  'children'
> {
  label: ReactNode;
}

export function Checkbox({ label, className, id, ...props }: CheckboxProps) {
  return (
    <label className="h-choice" htmlFor={id}>
      <CheckboxPrimitive.Root className={cn('h-checkbox', className)} id={id} {...props}>
        <CheckboxPrimitive.Indicator>
          <Check aria-hidden="true" size={16} strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span>{label}</span>
    </label>
  );
}

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
}

export interface RadioGroupProps extends ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root> {
  label: string;
  options: readonly RadioOption[];
}

export function RadioGroup({ label, options, ...props }: RadioGroupProps) {
  return (
    <fieldset className="h-radio-fieldset">
      <legend className="h-label">{label}</legend>
      <RadioGroupPrimitive.Root className="h-radio-group" {...props}>
        {options.map((option) => {
          const id = `radio-${option.value}`;
          return (
            <label className="h-radio-option" htmlFor={id} key={option.value}>
              <RadioGroupPrimitive.Item className="h-radio" id={id} value={option.value}>
                <RadioGroupPrimitive.Indicator className="h-radio-indicator" />
              </RadioGroupPrimitive.Item>
              <span>
                <strong>{option.label}</strong>
                {option.description ? <small>{option.description}</small> : null}
              </span>
            </label>
          );
        })}
      </RadioGroupPrimitive.Root>
    </fieldset>
  );
}

export interface SwitchProps extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  label: ReactNode;
  description?: ReactNode;
}

export function Switch({ label, description, id, ...props }: SwitchProps) {
  return (
    <label className="h-switch-row" htmlFor={id}>
      <span>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <SwitchPrimitive.Root className="h-switch" id={id} {...props}>
        <SwitchPrimitive.Thumb className="h-switch-thumb" />
      </SwitchPrimitive.Root>
    </label>
  );
}

export interface FormFieldProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
}

export function FormField({ id, label, hint, error, required, children }: FormFieldProps) {
  return (
    <div className="h-form-field">
      <label className="h-label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint && !error ? <div className="h-field-hint">{hint}</div> : null}
      {error ? (
        <div className="h-field-error" id={`${id}-error`} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
