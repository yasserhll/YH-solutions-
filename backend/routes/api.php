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
use App\Http\Controllers\Api\FuelGlobalController;
use App\Http\Controllers\Api\FuelTankController;
use App\Http\Controllers\Api\FuelMovementController;
use App\Http\Controllers\Api\FuelReportController;
use App\Http\Controllers\Api\FuelVehicleController;
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

    // Every route below is gated by the session (module) it belongs to —
    // `module:<key>` (EnsureModuleAccess), never by role. Which sessions an
    // account has is User::allowedModules(): everything for a SuperAdmin,
    // otherwise the list a SuperAdmin picked in Utilisateurs, or the role's
    // default (User::ROLE_MODULES — a plain responsable gets no HSE, an hse
    // animateur gets only HSE). Site-scoping (InteractsWithSites) still
    // applies inside every controller, on top of this.

    // Reference data the forms of many sessions need (site switcher,
    // department/position dropdowns) — names only, open to any account.
    Route::get('/sites', [SiteController::class, 'index']);
    Route::get('/departments', [DepartmentController::class, 'index']);
    Route::get('/positions', [PositionController::class, 'index']);

    // EmployeeSelect (Congés/Sanctions/Mouvements/Affectations/Heures sup.
    // forms) searches employees — any session that picks an employee.
    Route::get('/employees', [EmployeeController::class, 'index'])
        ->middleware('module:pointage,conges,sanctions,mouvements,affectations,heures_sup,personnel');

    Route::get('/dashboard', [DashboardController::class, 'index'])->middleware('module:dashboard');

    Route::middleware('module:hse')->group(function () {
        Route::get('/hse-dashboard', [HseReportController::class, 'dashboard']);
        Route::apiResource('hse-reports', HseReportController::class)->only(['index', 'store', 'update', 'destroy']);
        Route::get('/hse-reports/{hseReport}/export-pdf', [HseReportController::class, 'exportPdf']);
        Route::get('/hse-reports/{hseReport}/export-excel', [HseReportController::class, 'exportExcel']);
        // Managing animateur accounts: responsable_hse / SuperAdmin only (HseUserController::ensureManager).
        Route::apiResource('hse-users', HseUserController::class)->only(['index', 'store', 'update', 'destroy'])->parameters(['hse-users' => 'hseUser']);
    });

    Route::middleware('module:pointage')->group(function () {
        Route::get('/holidays', [HolidayController::class, 'index']);
        Route::post('/holidays', [HolidayController::class, 'store']);
        Route::put('/holidays/{holiday}', [HolidayController::class, 'update']);
        Route::delete('/holidays/{holiday}', [HolidayController::class, 'destroy']);

        Route::get('/attendance/daily', [AttendanceController::class, 'daily']);
        Route::post('/attendance/bulk', [AttendanceController::class, 'bulkStore']);
        Route::apiResource('attendance', AttendanceController::class)->except(['show']);
        Route::apiResource('illnesses', IllnessController::class)->only(['index', 'store', 'update', 'destroy']);

        Route::get('/reports/attendance', [ReportController::class, 'attendance']);
        Route::get('/reports/attendance/export', [ReportController::class, 'exportAttendance']);
        Route::get('/reports/attendance/recap-export', [ReportController::class, 'exportAttendanceRecap']);
    });

    Route::middleware('module:conges')->group(function () {
        Route::patch('/leave-requests/{leaveRequest}/status', [LeaveRequestController::class, 'updateStatus']);
        Route::apiResource('leave-requests', LeaveRequestController::class)->except(['show']);
        Route::post('/leaves/{leave}/extensions', [LeaveController::class, 'extend']);
        Route::apiResource('leaves', LeaveController::class)->except(['show'])->parameters(['leaves' => 'leave']);

        Route::get('/reports/leaves', [ReportController::class, 'leaves']);
        Route::get('/reports/leaves/export', [ReportController::class, 'exportLeaves']);
    });

    Route::middleware('module:sanctions')->group(function () {
        Route::apiResource('disciplinary-warnings', DisciplinaryWarningController::class)->except(['show']);
        Route::apiResource('suspensions', SuspensionController::class)->except(['show']);

        Route::get('/reports/sanctions', [ReportController::class, 'sanctions']);
        Route::get('/reports/sanctions/export', [ReportController::class, 'exportSanctions']);
    });

    Route::middleware('module:mouvements')->group(function () {
        Route::apiResource('entries', EntryController::class)->only(['index', 'store', 'update', 'destroy']);
        Route::apiResource('exits', ExitController::class)->only(['index', 'store', 'update', 'destroy']);

        Route::get('/reports/movements', [ReportController::class, 'movements']);
        Route::get('/reports/movements/export', [ReportController::class, 'exportMovements']);
    });

    Route::apiResource('assignments', AssignmentController::class)->only(['index', 'store', 'update', 'destroy'])
        ->middleware('module:affectations');

    Route::middleware('module:heures_sup')->group(function () {
        Route::apiResource('overtime-entries', OvertimeEntryController::class)->only(['index', 'store', 'update', 'destroy']);
        Route::get('/overtime-months', [OvertimeMonthController::class, 'index']);

        Route::get('/reports/overtime', [ReportController::class, 'overtime']);
        Route::get('/reports/overtime/export', [ReportController::class, 'exportOvertime']);
    });

    Route::middleware('module:caisse')->group(function () {
        Route::apiResource('cash-transactions', CashTransactionController::class)->only(['index', 'store']);
        Route::get('/cash-account', [CashAccountController::class, 'show']);

        Route::get('/reports/cash', [ReportController::class, 'cash']);
        Route::get('/reports/cash/export', [ReportController::class, 'exportCash']);
    });

    Route::middleware('module:personnel')->group(function () {
        Route::apiResource('employees', EmployeeController::class)->except(['index']);
        Route::post('/employees/{employee}/transfer-site', [EmployeeController::class, 'transferSite']);
    });

    Route::get('/audit-logs', [AuditLogController::class, 'index'])->middleware('module:historique');

    // Consommation (fuel): Matriculation (company-wide lookup), Citernes
    // (Excel imports, site-scoped) and the automatically-built Global view.
    Route::middleware('module:consommation')->group(function () {
        Route::get('/fuel/global', [FuelGlobalController::class, 'index']);
        Route::get('/fuel/global/export', [FuelGlobalController::class, 'export']);
        Route::get('/fuel/tanks', [FuelTankController::class, 'index']);
        Route::post('/fuel/tanks/import', [FuelTankController::class, 'import']);
        Route::delete('/fuel/tanks/{fuelTank}', [FuelTankController::class, 'destroy']);
        Route::get('/fuel/movements', [FuelTankController::class, 'movements']);
        Route::post('/fuel/movements', [FuelMovementController::class, 'store']);
        Route::put('/fuel/movements/{fuelMovement}', [FuelMovementController::class, 'update']);
        Route::delete('/fuel/movements/{fuelMovement}', [FuelMovementController::class, 'destroy']);
        Route::get('/fuel/report', [FuelReportController::class, 'show']);
        Route::put('/fuel/report/lines', [FuelReportController::class, 'saveLine']);
        Route::get('/fuel/report/export', [FuelReportController::class, 'export']);
        Route::get('/fuel/assignments', [FuelReportController::class, 'assignments']);
        Route::post('/fuel/assignments', [FuelReportController::class, 'storeAssignment']);
        Route::post('/fuel/assignments/import', [FuelReportController::class, 'importAssignments']);
        Route::put('/fuel/assignments/{fuelAssignment}', [FuelReportController::class, 'updateAssignment']);
        Route::delete('/fuel/assignments/{fuelAssignment}', [FuelReportController::class, 'destroyAssignment']);
        Route::post('/fuel/vehicles/import', [FuelVehicleController::class, 'import']);
        Route::apiResource('fuel/vehicles', FuelVehicleController::class)->only(['index', 'store', 'update', 'destroy'])->parameters(['vehicles' => 'fuelVehicle']);
    });

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

        // Sessions catalogue + each role's default, for the Utilisateurs form.
        Route::get('/users/modules', [UserController::class, 'modules']);
        Route::apiResource('users', UserController::class)->except(['show']);

        Route::put('/cash-account', [CashAccountController::class, 'update']);
        Route::apiResource('cash-transactions', CashTransactionController::class)->only(['update', 'destroy']);
    });
});
