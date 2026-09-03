import clsx from 'clsx';
import logo from '../../assets/logo.jpg';

export function Brand({ markClassName = 'h-9', textClassName = 'text-xl' }: { markClassName?: string; textClassName?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {/* The source image has a plain white background baked in, so it gets
          a permanent white chip rather than sitting bare on a dark sidebar. */}
      <span className="shrink-0 rounded-md bg-white p-0.5">
        <img src={logo} alt="YH" className={clsx('w-auto', markClassName)} />
      </span>
      <span className={clsx('truncate font-extrabold uppercase tracking-tight text-slate-900 dark:text-white', textClassName)}>
        Solutions
      </span>
    </div>
  );
}
