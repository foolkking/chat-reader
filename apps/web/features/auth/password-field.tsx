"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

export function PasswordField({
  id,
  name,
  label,
  value,
  onChange,
  autoComplete,
  maxLength = 1024,
  minLength,
  autoFocus,
  disabled,
  showLabel,
  hideLabel,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  maxLength?: number;
  minLength?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  showLabel: string;
  hideLabel: string;
}) {
  const [visible, setVisible] = useState(false);
  const actionLabel = visible ? hideLabel : showLabel;

  return (
    <div className="space-y-1.5 text-left">
      <label htmlFor={id} className="text-sm font-medium text-primary">{label}</label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
          minLength={minLength}
          maxLength={maxLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="input-base min-h-11 w-full px-3 pr-11"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
          className="btn-icon absolute right-1 top-1 flex h-9 w-9 items-center justify-center text-secondary"
          aria-label={actionLabel}
          title={actionLabel}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
