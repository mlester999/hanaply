'use client';

import { Input } from '@hanaply/ui';
import { Check, Circle, Eye, EyeOff, X } from 'lucide-react';
import { useState, type InputHTMLAttributes } from 'react';

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  fieldLabel: string;
}

export function PasswordInput({ fieldLabel, className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const action = visible ? 'Hide' : 'Show';

  return (
    <div className="password-input-shell">
      <Input className={className} type={visible ? 'text' : 'password'} {...props} />
      <button
        aria-label={`${action} ${fieldLabel.toLowerCase()}`}
        aria-pressed={visible}
        className="password-visibility-toggle"
        onClick={() => {
          setVisible((value) => !value);
        }}
        type="button"
      >
        {visible ? <EyeOff aria-hidden="true" size={19} /> : <Eye aria-hidden="true" size={19} />}
      </button>
    </div>
  );
}

interface PasswordRequirementsProps {
  confirmation?: string;
  id: string;
  password: string;
  showMatch?: boolean;
}

export function PasswordRequirements({
  confirmation = '',
  id,
  password,
  showMatch = false,
}: PasswordRequirementsProps) {
  const visible = password.length > 0 || confirmation.length > 0;
  if (!visible) return null;

  const requirements = [
    { label: 'At least 10 characters', met: password.length >= 10 },
    { label: 'Includes a letter', met: /[A-Za-z]/u.test(password) },
    { label: 'Includes a number', met: /[0-9]/u.test(password) },
  ];

  if (showMatch) {
    requirements.push({
      label: 'Passwords match',
      met: confirmation.length > 0 && password === confirmation,
    });
  }

  return (
    <div aria-live="polite" className="password-requirements" id={id}>
      <span>Password requirements</span>
      <ul>
        {requirements.map((requirement) => {
          const waitingForConfirmation = requirement.label === 'Passwords match' && !confirmation;
          return (
            <li className={requirement.met ? 'is-met' : ''} key={requirement.label}>
              {requirement.met ? (
                <Check aria-hidden="true" size={15} />
              ) : waitingForConfirmation ? (
                <Circle aria-hidden="true" size={14} />
              ) : (
                <X aria-hidden="true" size={15} />
              )}
              <span>
                <span className="h-sr-only">
                  {requirement.met
                    ? 'Requirement met: '
                    : waitingForConfirmation
                      ? 'Waiting for: '
                      : 'Requirement not met: '}
                </span>
                {requirement.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
