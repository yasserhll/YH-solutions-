<?php

namespace App\Services;

use App\Models\HseReport;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;
use PhpOffice\PhpSpreadsheet\Style\Color;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;
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
        return $this->streamSheets($filename, [
            ['title' => null, 'headers' => $headers, 'rows' => $rows, 'highlight' => $highlightRow],
        ]);
    }

    /**
     * Same table styling as stream(), but one worksheet (tab) per entry —
     * for a report that naturally has two related tables (e.g. overtime
     * declarations + the per-period summary derived from them).
     *
     * @param  array<int, array{title: ?string, headers: string[], rows: iterable<array<int, mixed>>, highlight?: ?callable}>  $sheets
     */
    public function streamSheets(string $filename, array $sheets): StreamedResponse
    {
        $spreadsheet = new Spreadsheet();

        foreach (array_values($sheets) as $index => $definition) {
            $sheet = $index === 0 ? $spreadsheet->getActiveSheet() : $spreadsheet->createSheet();
            if (! empty($definition['title'])) {
                $sheet->setTitle(mb_substr($definition['title'], 0, 31));
            }
            $this->fillTable($sheet, $definition['headers'], $definition['rows'], $definition['highlight'] ?? null);
        }
        $spreadsheet->setActiveSheetIndex(0);

        $writer = new Xlsx($spreadsheet);

        return new StreamedResponse(function () use ($writer) {
            $writer->save('php://output');
        }, 200, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            'Cache-Control' => 'no-store, no-cache, must-revalidate, private',
        ]);
    }

    private function fillTable(Worksheet $sheet, array $headers, iterable $rows, ?callable $highlightRow): void
    {
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

        // Header stays visible while scrolling a long export.
        $sheet->freezePane('A2');

        foreach (range('A', $lastColumn) as $column) {
            $sheet->getColumnDimension($column)->setAutoSize(true);
        }
    }

    /**
     * A printable/shareable replica of the paper "RAPPORT JOURNALIER HSE"
     * form (réf. RJ-HSE-TRP-02) — a form layout (merged label/value cells,
     * the same background colours as the original) rather than the flat
     * header+rows table `stream()` above produces, since this exports ONE
     * record as a form, not a list. Colours are pulled straight from the
     * reference .docx's cell shading so this stays a faithful reproduction,
     * not an approximation: F2F2F2/C9C9C9 (grey), 92D050 (green), FFD966
     * (gold), 8EAADB (blue), AEAAAA (grey), FFFF00 (yellow), 002060 (navy).
     */
    public function streamHseReportForm(HseReport $report, string $filename): StreamedResponse
    {
        $spreadsheet = new Spreadsheet();
        $sheet = $spreadsheet->getActiveSheet();
        $sheet->getColumnDimension('A')->setWidth(28);
        $sheet->getColumnDimension('B')->setWidth(22);
        $sheet->getColumnDimension('C')->setWidth(28);
        $sheet->getColumnDimension('D')->setWidth(22);

        $row = 1;
        $sheet->setCellValue("A{$row}", 'RAPPORT JOURNALIER HSE');
        $sheet->mergeCells("A{$row}:D{$row}");
        $sheet->getStyle("A{$row}")->getFont()->setBold(true)->setSize(14);
        $sheet->getStyle("A{$row}")->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);
        $row++;
        $sheet->setCellValue("A{$row}", 'Référence : RJ-HSE-TRP-02   Version : B   Date : 23/02/2026   Page 1 sur 1');
        $sheet->mergeCells("A{$row}:D{$row}");
        $sheet->getStyle("A{$row}")->getFont()->setSize(8)->setItalic(true);
        $row += 2;

        $percent = fn (?string $value) => $value !== null ? rtrim(rtrim(number_format((float) $value, 2), '0'), '.').'%' : '-';

        $fullRow = function (string $label, $value, ?string $fill = null) use ($sheet, &$row) {
            $sheet->setCellValue("A{$row}", $label);
            $sheet->setCellValue("B{$row}", $value);
            $sheet->mergeCells("B{$row}:D{$row}");
            $this->styleFormLabel($sheet, "A{$row}", $fill);
            $row++;
        };

        $splitRow = function (string $label1, $value1, string $label2, $value2, ?string $fill = null) use ($sheet, &$row) {
            $sheet->setCellValue("A{$row}", $label1);
            $sheet->setCellValue("B{$row}", $value1);
            $sheet->setCellValue("C{$row}", $label2);
            $sheet->setCellValue("D{$row}", $value2);
            $this->styleFormLabel($sheet, "A{$row}", $fill);
            $this->styleFormLabel($sheet, "C{$row}", $fill);
            $row++;
        };

        $fullRow('Date :', $report->report_date->format('d/m/Y'), 'F2F2F2');
        $fullRow('Nom et prénom animateur HSE :', $report->creator?->name, 'F2F2F2');
        $fullRow('Projet/Site :', $report->site?->name, 'F2F2F2');
        $fullRow('Activités réalisées :', $report->activities, 'C9C9C9');
        $fullRow('Nombre SPA :', $report->spa_count, '92D050');
        $fullRow("Sujet(s) abordé(s) (Sensibilisations / formations / minute de sécurité) :", $report->topics_covered, '92D050');
        $fullRow('Nombre des participants :', $report->participants_count, '92D050');
        $fullRow('Nombre des sanctions', $report->sanctions_count, 'FFD966');
        $fullRow('Nombre des situations dangereuses', $report->dangerous_situations_count, 'FFD966');
        $fullRow('Équipements inspectés :', $report->equipment_inspected, '8EAADB');
        $fullRow('État général :', ($report->general_state === 'conforme' ? 'Conforme' : 'Non conforme'), '8EAADB');
        $fullRow('SOR : (Minimum de 4 SORs à remonter)', $report->sor_notes ?: '-', 'AEAAAA');
        $fullRow('Actions préventives/correctives :', $report->corrective_actions ?: '-', 'AEAAAA');

        $sheet->setCellValue("A{$row}", 'Résultats des indicateurs clés de performance (KPI)');
        $sheet->mergeCells("A{$row}:B{$row}");
        $sheet->setCellValue("C{$row}", 'Résultats');
        $sheet->setCellValue("D{$row}", 'Commentaires');
        $this->styleFormLabel($sheet, "A{$row}", 'F2F2F2');
        $this->styleFormLabel($sheet, "C{$row}", 'F2F2F2');
        $this->styleFormLabel($sheet, "D{$row}", 'F2F2F2');
        $row++;

        $kpiRow = function (string $label, $count, ?string $comment) use ($sheet, &$row) {
            $sheet->setCellValue("A{$row}", $label);
            $sheet->mergeCells("A{$row}:B{$row}");
            $sheet->setCellValue("C{$row}", $count);
            $sheet->setCellValue("D{$row}", $comment ?: '-');
            $this->styleFormLabel($sheet, "A{$row}", 'FFFF00');
            $row++;
        };
        $kpiRow("1- Nbre d'incidents :", $report->incidents_count, $report->incidents_comment);
        $kpiRow("2- Nbre d'accidents :", $report->accidents_count, $report->accidents_comment);
        $kpiRow('3- Impact environnemental :', $report->environmental_impact_count, $report->environmental_impact_comment);

        $splitRow("Nombre d'effectifs de Shift :", $report->shift_headcount ?? '-', "Nombre d'heures travaillées :", $report->hours_worked ?? '-', '92D050');
        $splitRow('Taux de participation aux Sensibilisations HSE :', $percent($report->sensitization_participation_rate), 'Taux de clôture des actions correctives :', $percent($report->corrective_actions_closure_rate), '92D050');
        $splitRow('Nombre de non-conformités :', $report->non_conformities_count, 'Inductions HSE :', $report->inductions_count, '92D050');
        $splitRow('Nombre des Visites inspections / Audits :', $report->audits_count, "Nombre des Exercices d'évacuation d'urgence :", $report->evacuation_drills_count, '92D050');

        $sheet->setCellValue("A{$row}", 'Signature animateur HSE :');
        $sheet->mergeCells("A{$row}:D{$row}");
        $sheet->getStyle("A{$row}")->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB('FF002060');
        $sheet->getStyle("A{$row}")->getFont()->setColor(new Color('FFFFFFFF'))->setBold(true);
        $lastRow = $row;

        $sheet->getStyle("A1:D{$lastRow}")->getAlignment()->setWrapText(true)->setVertical(Alignment::VERTICAL_CENTER);
        $sheet->getStyle("A3:D{$lastRow}")->getBorders()->getAllBorders()->setBorderStyle(Border::BORDER_THIN);

        $writer = new Xlsx($spreadsheet);

        return new StreamedResponse(function () use ($writer) {
            $writer->save('php://output');
        }, 200, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
            'Cache-Control' => 'no-store, no-cache, must-revalidate, private',
        ]);
    }

    private function styleFormLabel(Worksheet $sheet, string $cell, ?string $fill): void
    {
        $sheet->getStyle($cell)->getFont()->setBold(true);
        if ($fill) {
            $sheet->getStyle($cell)->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB('FF'.$fill);
        }
    }
}
