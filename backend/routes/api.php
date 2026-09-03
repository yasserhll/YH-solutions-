<?php

use App\Http\Controllers\Api\AssignmentController;
use App\Http\Controllers\Api\AttendanceController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CashAccountController;
use App\Http\Controllers\Api\CashTransactionController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\DepartmentController;
use App\Http\Controllers\Api\DisciplinaryWarningController;
use App\Http\Controllers\Api\EmployeeController;
use App\Http\Controllers\Api\EntryController;
use App\Http\Controllers\Api\ExitController;
use App\Http\Controllers\Api\LeaveController;
use App\Http\Controllers\Api\LeaveRequestController;
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

    Route::get('/dashboard', [DashboardController::class, 'index']);

    Route::get('/sites', [SiteController::class, 'index']);
    Route::get('/departments', [DepartmentController::class, 'index']);
    Route::get('/positions', [PositionController::class, 'index']);

    Route::apiResource('employees', EmployeeController::class);

    Route::get('/attendance/daily', [AttendanceController::class, 'daily']);
    Route::post('/attendance/bulk', [AttendanceController::class, 'bulkStore']);
    Route::apiResource('attendance', AttendanceController::class)->except(['show']);

    Route::patch('/leave-requests/{leaveRequest}/status', [LeaveRequestController::class, 'updateStatus']);
    Route::apiResource('leave-requests', LeaveRequestController::class)->except(['show']);

    Route::post('/leaves/{leave}/extensions', [LeaveController::class, 'extend']);
    Route::patch('/leaves/{leave}/status', [LeaveController::class, 'updateStatus']);
    Route::apiResource('leaves', LeaveController::class)->except(['show']);

    Route::apiResource('disciplinary-warnings', DisciplinaryWarningController::class)->except(['show']);
    Route::apiResource('suspensions', SuspensionController::class)->except(['show']);

    // A responsable can correct their own site's mistakes here too — only
    // the caisse (below) reserves edit/delete to the SuperAdmin.
    Route::apiResource('assignments', AssignmentController::class)->only(['index', 'store', 'update', 'destroy']);
    Route::apiResource('entries', EntryController::class)->only(['index', 'store', 'update', 'destroy']);
    Route::apiResource('exits', ExitController::class)->only(['index', 'store', 'update', 'destroy']);

    Route::apiResource('cash-transactions', CashTransactionController::class)->only(['index', 'store']);

    Route::get('/reports/attendance', [ReportController::class, 'attendance']);
    Route::get('/reports/leaves', [ReportController::class, 'leaves']);
    Route::get('/reports/sanctions', [ReportController::class, 'sanctions']);
    Route::get('/reports/movements', [ReportController::class, 'movements']);
    Route::get('/reports/cash', [ReportController::class, 'cash']);

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

        Route::get('/cash-account', [CashAccountController::class, 'show']);
        Route::put('/cash-account', [CashAccountController::class, 'update']);
        Route::apiResource('cash-transactions', CashTransactionController::class)->only(['update', 'destroy']);
    });
});
