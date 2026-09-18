<?php

namespace App\Services;

use Carbon\Carbon;

/**
 * The overtime "month" is a PAYROLL period running 27 -> 26, never the
 * calendar month (1st -> end of month) — a hard business rule, not an
 * approximation. A period is identified by its END date, always the 26th of
 * some month: the period 27 August -> 26 September is identified by the
 * date 2026-09-26 (this is exactly what OvertimeMonth.month stores). A
 * declaration made ON the 26th belongs to the period ending that same day;
 * one made on the 27th already belongs to the NEXT period (ending the 26th
 * of the following month). Every overtime date computation goes through
 * here so the 27-26 rule is never reimplemented or drifted elsewhere.
 */
class OvertimePayPeriod
{
    /** The period (identified by its end date) that $date falls into. */
    public static function endForDate(Carbon $date): Carbon
    {
        $end = $date->copy()->startOfDay()->day(26);

        return $date->day <= 26 ? $end : $end->addMonthNoOverflow();
    }

    /** The first day (the 27th of the previous month) of the period ending on $periodEnd. */
    public static function startForEnd(Carbon $periodEnd): Carbon
    {
        return $periodEnd->copy()->subMonthNoOverflow()->day(27);
    }

    /**
     * [start, end] bounds for the period whose end date falls in calendar
     * month $ym ("Y-m") — used to resolve a `?month=YYYY-MM` filter, which
     * always refers to a period by the month it CLOSES in.
     */
    public static function boundsForYearMonth(string $ym): array
    {
        $end = Carbon::parse($ym.'-26');

        return [self::startForEnd($end), $end];
    }
}
