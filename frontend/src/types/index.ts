/**
 * `hse` and `responsable_hse` are restricted to ONLY the HSE module (see
 * backend EnsureHseModuleAccess/BlockHseModuleRoles) — everything else in
 * the app is off-limits to them, and conversely a plain `responsable` never
 * sees the HSE module. `hse` files the daily report; `responsable_hse`
 * reviews/controls every report on their assigned site(s).
 */
export type Role = 'superadmin' | 'responsable' | 'hse' | 'responsable_hse';

export interface Site {
  id: number;
  name: string;
  slug: string;
}

export interface Department {
  id: number;
  name: string;
}

export interface Position {
  id: number;
  name: string;
}

export interface Holiday {
  id: number;
  date: string;
  name: string;
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  /** Only set when this user has exactly one assigned site — null otherwise (multi-site or superadmin). */
  site: Site | null;
  /** Every site assigned to this user, usable simultaneously — a superadmin gets []. */
  sites: Site[];
}

export interface User extends AuthUser {
  is_active: boolean;
}

export type EmployeeStatus = 'actif' | 'sorti';

export interface Employee {
  id: number;
  full_name: string;
  site_id: number;
  department_id: number | null;
  position_id: number | null;
  establishment: string | null;
  entry_date: string | null;
  exit_date: string | null;
  status: EmployeeStatus;
  phone: string | null;
  notes: string | null;
  site?: Site;
  department?: Department | null;
  position?: Position | null;
  attendances?: Attendance[];
  leave_requests?: LeaveRequest[];
  leaves?: Leave[];
  illnesses?: Illness[];
  disciplinary_warnings?: DisciplinaryWarning[];
  suspensions?: Suspension[];
  assignments?: Assignment[];
  overtime_entries?: OvertimeEntry[];
  overtime_months?: OvertimeMonth[];
  entries?: Entry[];
  exits?: Exit[];
}

export type AttendanceStatus = 'present' | 'absent';
export type AbsenceCause = 'maladie' | 'autorisee' | 'non_autorisee' | 'conge' | 'mise_a_pied' | 'stc';

export interface Attendance {
  /** null on a Rapports row synthesized from an active Maladie/Congé/Mise à pied period (see `auto`) — nothing to edit/delete for it. */
  id: number | null;
  employee_id?: number;
  site_id?: number;
  date: string;
  status: AttendanceStatus;
  absence_cause: AbsenceCause | null;
  description: string | null;
  employee?: Employee;
  site?: Site;
  /** True when this row wasn't keyed in but derived from an active Illness/Leave/Suspension period. */
  auto?: boolean;
}

export interface DailyAttendanceRow {
  employee_id: number;
  full_name: string;
  site: string;
  date: string;
  attendance_id: number | null;
  status: AttendanceStatus;
  absence_cause: AbsenceCause | null;
  description: string | null;
  /** True when Maladie/Congé/Mise à pied is auto-applied from an active period — no manual action possible on this row. */
  auto: boolean;
}

/** A declared Maladie period — Pointage derives "Absent - Maladie" from this for every day in [start_date, end_date], see AttendanceAutomation backend-side. */
export interface Illness {
  id: number;
  employee_id: number;
  site_id: number;
  start_date: string;
  end_date: string;
  description: string | null;
  employee?: Employee;
  site?: Site;
}

export type DayType = 'normal' | 'sunday' | 'holiday';

export interface DailyAttendanceSheet {
  day_type: DayType;
  holiday_id: number | null;
  holiday_name: string | null;
  rows: DailyAttendanceRow[];
}

export type LeaveRequestStatus = 'en_attente' | 'acceptee' | 'refusee' | 'annulee';

export interface LeaveRequest {
  id: number;
  employee_id: number;
  site_id: number;
  request_date: string;
  desired_start_date: string;
  duration_days: number;
  reason: string | null;
  status: LeaveRequestStatus;
  employee?: Employee;
  site?: Site;
}

export type LeaveStatus = 'en_cours' | 'termine';

export interface LeaveExtension {
  id: number;
  leave_id: number;
  extra_days: number;
  reason: string | null;
  previous_end_date: string;
  new_end_date: string;
}

export interface Leave {
  id: number;
  employee_id: number;
  site_id: number;
  leave_request_id: number | null;
  start_date: string;
  duration_days: number;
  end_date: string;
  reason: string | null;
  status: LeaveStatus;
  employee?: Employee;
  site?: Site;
  extensions?: LeaveExtension[];
}

export interface DisciplinaryWarning {
  id: number;
  employee_id: number;
  site_id: number;
  date: string;
  reason: string;
  description: string | null;
  employee?: Employee;
  site?: Site;
}

export interface Suspension {
  id: number;
  employee_id: number;
  site_id: number;
  date: string;
  reason: string;
  description: string | null;
  duration_days: number;
  start_date: string;
  end_date: string;
  employee?: Employee;
  site?: Site;
}

export type HseGeneralState = 'conforme' | 'non_conforme';

/** Mirrors the paper "RAPPORT JOURNALIER HSE" form (réf. RJ-HSE-TRP-02) field for field. */
export interface HseReport {
  id: number;
  site_id: number;
  report_date: string;
  activities: string;
  spa_count: number;
  topics_covered: string | null;
  participants_count: number;
  sanctions_count: number;
  dangerous_situations_count: number;
  equipment_inspected: string | null;
  general_state: HseGeneralState;
  sor_notes: string | null;
  corrective_actions: string | null;
  incidents_count: number;
  incidents_comment: string | null;
  accidents_count: number;
  accidents_comment: string | null;
  environmental_impact_count: number;
  environmental_impact_comment: string | null;
  shift_headcount: number | null;
  hours_worked: string | null;
  sensitization_participation_rate: string | null;
  corrective_actions_closure_rate: string | null;
  non_conformities_count: number;
  inductions_count: number;
  audits_count: number;
  evacuation_drills_count: number;
  created_by: number | null;
  site?: Site;
  creator?: { id: number; name: string } | null;
}

export interface HseDashboardTotals {
  reports_count: number;
  incidents_count: number;
  accidents_count: number;
  environmental_impact_count: number;
  sanctions_count: number;
  dangerous_situations_count: number;
  non_conformities_count: number;
  inductions_count: number;
  audits_count: number;
  evacuation_drills_count: number;
  avg_sensitization_participation_rate: number | null;
  avg_corrective_actions_closure_rate: number | null;
}

export interface HseDashboardTrendPoint {
  date: string;
  reports_count: number;
  incidents_count: number;
  accidents_count: number;
  dangerous_situations_count: number;
}

export interface HseDashboardSiteComparison {
  site_id: number;
  site_name: string | null;
  reports_count: number;
  incidents_count: number;
  accidents_count: number;
  dangerous_situations_count: number;
  non_conformities_count: number;
}

export interface HseDashboardData {
  date_from: string;
  date_to: string;
  totals: HseDashboardTotals;
  general_state_breakdown: { conforme: number; non_conforme: number };
  trend: HseDashboardTrendPoint[];
  by_site: HseDashboardSiteComparison[];
  recent_reports: HseReport[];
}

/** A single "heures supplémentaires" declaration — the raw input. See OvertimeMonth for the derived per-month ledger. */
export interface OvertimeEntry {
  id: number;
  employee_id: number;
  site_id: number;
  date: string;
  hours: string;
  remark: string | null;
  created_by: number | null;
  employee?: Employee;
  site?: Site;
  creator?: { id: number; name: string } | null;
}

/**
 * One row per employee per calendar month — derived from OvertimeEntry by
 * the backend (8h = 1 payable day, the remainder always carries to the next
 * month). Read-only: `is_paid` is computed server-side from `month` vs.
 * today (paid automatically once the calendar moves past that month) —
 * there is no action to toggle it.
 */
export interface OvertimeMonth {
  id: number;
  employee_id: number;
  site_id: number;
  month: string;
  carried_hours: string;
  declared_hours: string;
  total_hours: string;
  days_earned: number;
  remaining_hours: string;
  is_paid: boolean;
  employee?: Employee;
  site?: Site;
}

export interface Assignment {
  id: number;
  employee_id: number;
  site_id: number;
  department_id: number | null;
  position_id: number | null;
  start_date: string;
  end_date: string | null;
  is_current: boolean;
  notes: string | null;
  employee?: Employee;
  site?: Site;
  department?: Department | null;
  position?: Position | null;
}

export interface Entry {
  id: number;
  employee_id: number | null;
  full_name: string;
  position_id: number | null;
  department_id: number | null;
  establishment: string | null;
  site_id: number;
  entry_date: string;
  employee?: Employee;
  site?: Site;
  department?: Department | null;
  position?: Position | null;
}

export interface Exit {
  id: number;
  employee_id: number | null;
  full_name: string;
  position_id: number | null;
  department_id: number | null;
  site_id: number;
  entry_date: string | null;
  exit_date: string;
  reason: string | null;
  employee?: Employee;
  site?: Site;
  department?: Department | null;
  position?: Position | null;
}

export type CashTransactionType = 'expense' | 'entry' | 'transfer';

export interface CashTransaction {
  id: number;
  cash_account_id: number;
  site_id: number | null;
  type: CashTransactionType;
  date: string;
  beneficiary: string | null;
  description: string | null;
  amount: string;
  /** The real master caisse balance after this row — SuperAdmin only. */
  running_balance?: string;
  /** A site's remaining spending limit after this row — null for `entry` rows. */
  site_running_balance?: string | null;
  site?: Site;
  creator?: { id: number; name: string } | null;
}

/**
 * One entry per cash POOL, not per site — two sites sharing one responsable's
 * common caisse (see backend SiteCashPool) collapse into a single entry here,
 * with `site_name` already joined ("Bouchane + Mzinda") and `site_ids`
 * listing every site in that pool.
 */
export interface CashAccountSiteSummary {
  site_id: number;
  site_ids: number[];
  site_name: string;
  balance: number;
}

export interface CashAccountSummary {
  initial_balance: number;
  total_entries: number;
  total_expenses: number;
  current_balance: number;
  sites: CashAccountSiteSummary[];
  operations_count: number;
}

/** SuperAdmin shape of GET /cash-account: the real master caisse + every site's remaining limit. */
export interface CashAccount {
  id: number;
  initial_balance: string;
  allow_negative_balance: boolean;
  summary: CashAccountSummary;
}

/**
 * Responsable shape of GET /cash-account: the remaining limit of every site
 * assigned to them — all of them at once for a multi-site responsable, never
 * another site's.
 */
export interface CashSiteBalance {
  sites: CashAccountSiteSummary[];
}

/**
 * One row per mutating action (Historique page, Paramètres) — a plain
 * activity feed entry. `description` is a ready-to-display French sentence
 * written once by the backend's AuditLogger, never reconstructed from
 * old_values/new_values on the frontend. `action` is `<module>.<verb>`
 * (e.g. `attendance.absent`, `leave.deleted`) — the module prefix is what
 * the Historique page's filter dropdown groups by.
 */
export interface AuditLog {
  id: number;
  user_id: number | null;
  site_id: number | null;
  action: string;
  description: string;
  created_at: string;
  user?: { id: number; name: string } | null;
  site?: Site | null;
}

export interface Paginated<T> {
  data: T[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

export interface DashboardData {
  personnel: {
    total: number;
    present_today: number;
    absent_today: number;
    leaves_in_progress: number;
    new_employees_30d: number;
    recent_exits_30d: number;
  };
  attendance: {
    present: number;
    absent_maladie: number;
    absent_autorisee: number;
    absent_non_autorisee: number;
    absent_mise_a_pied: number;
    absent_conge: number;
    absent_stc: number;
  };
  leaves: {
    pending: number;
    accepted: number;
    refused: number;
    cancelled: number;
    in_progress: number;
    completed: number;
  };
  sanctions: {
    warnings: number;
    suspensions: number;
  };
  cash: {
    current_balance: number | null;
    site_balances: CashAccountSiteSummary[] | null;
    expenses_today: number;
    expenses_month: number;
    total_expenses: number;
    recent_operations: CashTransaction[];
  };
}
