export type Role = 'superadmin' | 'responsable';

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

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  site: Site | null;
}

export interface User extends AuthUser {
  is_active: boolean;
  site_id: number | null;
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
  disciplinary_warnings?: DisciplinaryWarning[];
  suspensions?: Suspension[];
  assignments?: Assignment[];
}

export type AttendanceStatus = 'present' | 'absent';
export type AbsenceCause = 'maladie' | 'autorisee' | 'non_autorisee' | 'justifie' | 'conge';

export interface Attendance {
  id: number;
  employee_id: number;
  site_id: number;
  date: string;
  status: AttendanceStatus;
  absence_cause: AbsenceCause | null;
  description: string | null;
  employee?: Employee;
  site?: Site;
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

export type CashTransactionType = 'expense' | 'entry';

export interface CashTransaction {
  id: number;
  cash_account_id: number;
  site_id: number | null;
  type: CashTransactionType;
  date: string;
  beneficiary: string | null;
  description: string | null;
  amount: string;
  running_balance?: string;
  site?: Site;
  creator?: { id: number; name: string } | null;
}

export interface CashAccountSummary {
  initial_balance: number;
  total_entries: number;
  total_expenses: number;
  current_balance: number;
  operations_count: number;
}

/** Singleton: the one company-wide caisse (see backend CashAccount::singleton). */
export interface CashAccount {
  id: number;
  initial_balance: string;
  allow_negative_balance: boolean;
  summary: CashAccountSummary;
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
    absent_justifie: number;
    absent_conge: number;
  };
  leaves: {
    pending: number;
    accepted: number;
    in_progress: number;
    completed: number;
  };
  sanctions: {
    warnings: number;
    suspensions: number;
  };
  cash: {
    current_balance: number | null;
    expenses_today: number;
    expenses_month: number;
    total_expenses: number;
    recent_operations: CashTransaction[];
  };
}
