<?php

use App\Http\Controllers\Api\AssignmentController;
use App\Http\Controllers\Api\AttendanceController;
use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CashAccountController;
use App\Http\Controllers\Api\CashTransactionController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\DepartmentController;
use App\Http\Controllers\Api\DisciplinaryWarningController;
use App\Http\Controllers\Api\EmployeeController;
use App\Http\Controllers\Api\EntryController;
use App\Http\Controllers\Api\ExitController;
use App\Http\Controllers\Api\HolidayController;
use App\Http\Controllers\Api\HseReportController;
use App\Http\Controllers\Api\HseUserController;
use App\Http\Controllers\Api\IllnessController;
use App\Http\Controllers\Api\LeaveController;
use App\Http\Controllers\Api\LeaveRequestController;
use App\Http\Controllers\Api\OvertimeEntryController;
use App\Http\Controllers\Api\OvertimeMonthController;
use App\Http\Controllers\Api\PositionController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\SiteController;
use App\Http\Controllers\Api\SuspensionController;
use App\Http\Controllers\Api\UserController;
use Illuminate\Support\Facades\Route;

Route::post('/login', [AuthController::class, 'login']);

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/me', [AuthController::class, 'me']);

    // The HSE module: only `hse`, `responsable_hse`, and a SuperAdmin ever
    // reach it (see EnsureHseModuleAccess) — a plain `responsable` gets a 403,
    // exactly the mirror of `hse`/`responsable_hse` being blocked from
    // everything below by BlockHseModuleRoles.
    Route::middleware('hse.access')->group(function () {
        Route::get('/hse-dashboard', [HseReportController::class, 'dashboard']);
        Route::apiResource('hse-reports', HseReportController::class)->only(['index', 'store', 'update', 'destroy']);
        Route::get('/hse-reports/{hseReport}/export-pdf', [HseReportController::class, 'exportPdf']);
        Route::get('/hse-reports/{hseReport}/export-excel', [HseReportController::class, 'exportExcel']);
        Route::apiResource('hse-users', HseUserController::class)->only(['index', 'store', 'update', 'destroy'])->parameters(['hse-users' => 'hseUser']);
    });

    // A `responsable_hse` also gets safety-oversight access to these five
    // modules (Pointage, Congés, Sanctions, Entrées/Sorties, Affectations) —
    // scoped to their own sites exactly like a regular responsable, via the
    // same InteractsWithSites machinery every controller here already uses.
    // An `hse` (animateur) account is still blocked from all of it — it
    // stays confined to strictly the HSE module above. This is deliberately
    // narrower than `hse.block` below, which blocks BOTH hse roles.
    Route::middleware('hse.block-animateur')->group(function () {
        // Reference data an `hse.access`-adjacent Congés/Sanctions/Mouvements/
        // Affectations form needs (EmployeeSelect, dept/position dropdowns,
        // the Pointage holiday toggle) — read-only here; writing them (or any
        // other Employee field) stays behind `hse.block` below.
        Route::get('/employees', [EmployeeController::class, 'index']);
        Route::get('/departments', [DepartmentController::class, 'index']);
        Route::get('/positions', [PositionController::class, 'index']);
        Route::get('/holidays', [HolidayController::class, 'index']);
        Route::post('/holidays', [HolidayController::class, 'store']);
        Route::put('/holidays/{holiday}', [HolidayController::class, 'update']);
        Route::delete('/holidays/{holiday}', [HolidayController::class, 'destroy']);

        Route::get('/attendance/daily', [AttendanceController::class, 'daily']);
        Route::post('/attendance/bulk', [AttendanceController::class, 'bulkStore']);
        Route::apiResource('attendance', AttendanceController::class)->except(['show']);

        Route::patch('/leave-requests/{leaveRequest}/status', [LeaveRequestController::class, 'updateStatus']);
        Route::apiResource('leave-requests', LeaveRequestController::class)->except(['show']);

        Route::post('/leaves/{leave}/extensions', [LeaveController::class, 'extend']);
        Route::apiResource('leaves', LeaveController::class)->except(['show'])->parameters(['leaves' => 'leave']);

        Route::apiResource('disciplinary-warnings', DisciplinaryWarningController::class)->except(['show']);
        Route::apiResource('suspensions', SuspensionController::class)->except(['show']);
        Route::apiResource('illnesses', IllnessController::class)->only(['index', 'store', 'update', 'destroy']);

        Route::apiResource('assignments', AssignmentController::class)->only(['index', 'store', 'update', 'destroy']);
        Route::apiResource('entries', EntryController::class)->only(['index', 'store', 'update', 'destroy']);
        Route::apiResource('exits', ExitController::class)->only(['index', 'store', 'update', 'destroy']);
    });

    // Everything below is off-limits to BOTH `hse` and `responsable_hse` —
    // they are restricted to the HSE module plus the five modules above.
    Route::middleware('hse.block')->group(function () {
        Route::get('/dashboard', [DashboardController::class, 'index']);

        Route::get('/sites', [SiteController::class, 'index']);
        // Writing to an employee (or listing every field on it, via show/
        // store/update/destroy) stays here — only the read-only index above
        // is shared with a responsable_hse.
        Route::apiResource('employees', EmployeeController::class)->except(['index']);
        Route::post('/employees/{employee}/transfer-site', [EmployeeController::class, 'transferSite']);

        Route::apiResource('cash-transactions', CashTransactionController::class)->only(['index', 'store']);
        Route::get('/cash-account', [CashAccountController::class, 'show']);

        Route::apiResource('overtime-entries', OvertimeEntryController::class)->only(['index', 'store', 'update', 'destroy']);
        Route::get('/overtime-months', [OvertimeMonthController::class, 'index']);

        Route::get('/reports/attendance', [ReportController::class, 'attendance']);
        Route::get('/reports/leaves', [ReportController::class, 'leaves']);
        Route::get('/reports/sanctions', [ReportController::class, 'sanctions']);
        Route::get('/reports/movements', [ReportController::class, 'movements']);
        Route::get('/reports/cash', [ReportController::class, 'cash']);
        Route::get('/reports/overtime', [ReportController::class, 'overtime']);

        Route::get('/reports/attendance/export', [ReportController::class, 'exportAttendance']);
        Route::get('/reports/leaves/export', [ReportController::class, 'exportLeaves']);
        Route::get('/reports/sanctions/export', [ReportController::class, 'exportSanctions']);
        Route::get('/reports/movements/export', [ReportController::class, 'exportMovements']);
        Route::get('/reports/cash/export', [ReportController::class, 'exportCash']);
        Route::get('/reports/overtime/export', [ReportController::class, 'exportOvertime']);

        Route::get('/audit-logs', [AuditLogController::class, 'index']);

        Route::middleware('superadmin')->group(function () {
            Route::post('/sites', [SiteController::class, 'store']);
            Route::put('/sites/{site}', [SiteController::class, 'update']);
            Route::delete('/sites/{site}', [SiteController::class, 'destroy']);

            Route::post('/departments', [DepartmentController::class, 'store']);
            Route::put('/departments/{department}', [DepartmentController::class, 'update']);
            Route::delete('/departments/{department}', [DepartmentController::class, 'destroy']);

            Route::post('/positions', [PositionController::class, 'store']);
            Route::put('/positions/{position}', [PositionController::class, 'update']);
            Route::delete('/positions/{position}', [PositionController::class, 'destroy']);

            Route::apiResource('users', UserController::class)->except(['show']);

            Route::put('/cash-account', [CashAccountController::class, 'update']);
            Route::apiResource('cash-transactions', CashTransactionController::class)->only(['update', 'destroy']);
        });
    });
});
