import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

function Wrapper({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span>}
    </label>
  );
}

const fieldClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-400 dark:disabled:bg-slate-900';

export function TextField({ label, error, ...props }: { label: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Wrapper label={label} error={error}>
      <input {...props} className={fieldClass} />
    </Wrapper>
  );
}

export function TextAreaField({ label, error, ...props }: { label: string; error?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Wrapper label={label} error={error}>
      <textarea {...props} rows={props.rows ?? 3} className={fieldClass} />
    </Wrapper>
  );
}

export function SelectField({
  label,
  error,
  children,
  ...props
}: { label: string; error?: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Wrapper label={label} error={error}>
      <select {...props} className={fieldClass}>
        {children}
      </select>
    </Wrapper>
  );
}
