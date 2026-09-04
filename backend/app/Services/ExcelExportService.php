<?php

namespace App\Services;

use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Every export in the app goes through here so table styling (header
 * colour, borders, the streaming approach with no temp file on disk) stays
 * uniform: sky-blue bold header row, a full grid of borders around every
 * cell so it reads as an actual table rather than bare values, and an
 * optional yellow highlight for rows a $highlightRow callback flags (used
 * for "entrée"/recharge rows in the caisse export, so they stand out from
 * the site expenses at a glance).
 */
class ExcelExportService
{
    protected const HEADER_FILL = 'FF87CEEB';
    protected const HIGHLIGHT_FILL = 'FFFFFF00';

    /**
     * @param  string[]  $headers
     * @param  iterable<array<int, mixed>>  $rows  each row already flattened to scalars, same order as $headers
     * @param  (callable(array<int, mixed>): bool)|null  $highlightRow  when given, rows it returns true for get a yellow fill
     */
    public function stream(string $filename, array $headers, iterable $rows, ?callable $highlightRow = null): StreamedResponse
    {
        $spreadsheet = new Spreadsheet();
        $sheet = $spreadsheet->getActiveSheet();

        $sheet->fromArray($headers, null, 'A1');

        $rowNumber = 2;
        foreach ($rows as $row) {
            $sheet->fromArray(array_values($row), null, 'A' . $rowNumber);

            if ($highlightRow && $highlightRow($row)) {
                $sheet->getStyle('A' . $rowNumber . ':' . $sheet->getHighestColumn() . $rowNumber)
                    ->getFill()
                    ->setFillType(Fill::FILL_SOLID)
                    ->getStartColor()->setARGB(self::HIGHLIGHT_FILL);
            }

            $rowNumber++;
        }

        $lastColumn = $sheet->getHighestColumn();
        $lastRow = max($rowNumber - 1, 1);
        $fullRange = "A1:{$lastColumn}{$lastRow}";
        $headerRange = "A1:{$lastColumn}1";

        $sheet->getStyle($fullRange)->getBorders()->getAllBorders()->setBorderStyle(Border::BORDER_THIN);

        $headerStyle = $sheet->getStyle($headerRange);
        $headerStyle->getFont()->setBold(true);
        $headerStyle->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB(self::HEADER_FILL);
        $headerStyle->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);

        foreach (range('A', $lastColumn) as $column) {
            $sheet->getColumnDimension($column)->setAutoSize(true);
        }

        $writer = new Xlsx($spreadsheet);

        return new StreamedResponse(function () use ($writer) {
            $writer->save('php://output');
        }, 200, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            'Cache-Control' => 'no-store, no-cache, must-revalidate, private',
        ]);
    }
}
