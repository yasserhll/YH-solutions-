import type { Contract } from '../types';

/** "1er CDD", "2ème CDD"… — which CDD of the employee this is. */
/** A 2nd (or later) CDD still open that will become a CDI by itself at its end. */
export function autoCdi(c: Pick<Contract, 'type' | 'cdd_number' | 'auto_cdi' | 'outcome'>) {
  return c.type === 'cdd' && !c.outcome && (c.cdd_number ?? 0) >= 2 && c.auto_cdi;
}

export function contractLabel(c: Pick<Contract, 'type' | 'cdd_number'>) {
  if (c.type === 'cdi') return 'CDI';
  if (!c.cdd_number) return 'CDD';
  return `${c.cdd_number === 1 ? '1er' : `${c.cdd_number}ème`} CDD`;
}
