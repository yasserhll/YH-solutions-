<?php

namespace App\Http\Controllers\Concerns;

use App\Models\Assignment;
use App\Models\Employee;
use App\Models\EmployeeExit;

/**
 * Undoing a departure is never just deleting the `exits` row: the employee
 * has to come back to "actif" with their exit_date cleared, AND the
 * assignment that was closed on that exact date has to reopen — otherwise
 * the Affectations page keeps showing them as gone.
 *
 * Shared deliberately by the two places a departure can be undone from —
 * ExitController (deleting a Sortie directly) and AttendanceController
 * (cancelling a mistaken "STC" pointage, which is what created the Sortie
 * in the first place). These two must never drift apart: a departure undone
 * from Pointage has to leave exactly the same state behind as one undone
 * from Entrées/Sorties.
 */
trait RevertsEmployeeDeparture
{
    protected function revertEmployeeDeparture(EmployeeExit $exit): void
    {
        if ($exit->employee_id && $exit->employee?->status === 'sorti') {
            $this->reopenCurrentAssignment($exit->employee, $exit->exit_date);
            $exit->employee->update(['status' => 'actif', 'exit_date' => null]);
        }

        $exit->delete();
    }

    /**
     * Undoes the assignment closing an exit performs — reopens the
     * assignment that was closed on that exact exit date, mirroring the
     * employee status revert above.
     */
    protected function reopenCurrentAssignment(Employee $employee, $exitDate): void
    {
        Assignment::where('employee_id', $employee->id)
            ->where('is_current', false)
            ->whereDate('end_date', $exitDate)
            ->orderByDesc('start_date')
            ->first()
            ?->update(['is_current' => true, 'end_date' => null]);
    }
}
