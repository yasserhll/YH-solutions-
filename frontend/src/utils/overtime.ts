export function hoursLabel(h: string | number) {
  const n = Number(h);
  return `${Number.isInteger(n) ? n : n.toFixed(2)} h`;
}

// `month` is the PAYROLL period's end date (always the 26th) — the period
// itself runs from the 27th of the previous month to that date (see
// OvertimePayPeriod backend-side), never the calendar month. Label the full
// range rather than just "septembre 2026" so that 27-26 rule stays visible
// everywhere this shows up, not just in a code comment.
export function periodLabel(month: string) {
  const end = new Date(month);
  const start = new Date(end);
  start.setMonth(start.getMonth() - 1);
  start.setDate(27);
  const startLabel = start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const endLabel = end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${startLabel} – ${endLabel}`;
}
