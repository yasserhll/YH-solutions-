import { type ButtonHTMLAttributes, forwardRef } from 'react';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
}

const variants: Record<Variant, string> = {
  primary:
    'bg-slate-900 text-white hover:bg-slate-800 focus-visible:outline-slate-900 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200',
  secondary:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:outline-slate-400 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ variant = 'primary', size = 'md', className, ...props }, ref) => (
  <button
    ref={ref}
    className={clsx(
      'inline-flex items-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
      size === 'md' ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-xs',
      variants[variant],
      className,
    )}
    {...props}
  />
));
Button.displayName = 'Button';
