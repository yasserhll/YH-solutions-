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

    /**
     * Replica of the company's "Tableau récapitulatif des absences" template
     * (one sheet per month, named "MM-YYYY"): navy title bar merged over
     * C2:F2, red bold headers on row 4, data from row 5 starting in column B,
     * a bold Total row, hair borders, no gridlines, Calibri 11 — values and
     * column widths copied from the reference .xlsx, not eyeballed.
     *
     * @param  array<int, array{matricule: ?string, name: string, days: int, justified: string, observation: string}>  $rows
     */
    public function streamAbsenceRecap(string $filename, string $periodLabel, array $rows): StreamedResponse
    {
        $spreadsheet = new Spreadsheet();
        $spreadsheet->getDefaultStyle()->getFont()->setName('Calibri')->setSize(11);
        $sheet = $spreadsheet->getActiveSheet();
        $sheet->setTitle($periodLabel);
        $sheet->setShowGridlines(false);

        foreach (['B' => 13.5546875, 'C' => 13.5546875, 'D' => 17.21875, 'E' => 24.33203125, 'F' => 16.88671875, 'G' => 29.6640625] as $column => $width) {
            $sheet->getColumnDimension($column)->setWidth($width);
        }

        $sheet->setCellValue('C2', "Tableau récapitulatif des absences {$periodLabel}");
        $sheet->mergeCells('C2:F2');
        $sheet->getRowDimension(2)->setRowHeight(15.6);
        $title = $sheet->getStyle('C2:F2');
        $title->getFont()->setBold(true)->setSize(12)->setColor(new Color('FFFFFFFF'));
        $title->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB('FF203864');
        $title->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);

        $sheet->fromArray(['N°', 'Matricule', 'Salarié', 'Nombre de jours d’absence', 'Absences justifiées', 'Observation'], null, 'B4');
        $header = $sheet->getStyle('B4:G4');
        $header->getFont()->setBold(true)->setColor(new Color('FFFF0000'));
        $header->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);

        $row = 5;
        $total = 0;
        foreach (array_values($rows) as $index => $line) {
            $sheet->setCellValue("B{$row}", $index + 1);
            $sheet->setCellValueExplicit("C{$row}", (string) ($line['matricule'] ?? ''), \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
            $sheet->setCellValue("D{$row}", $line['name']);
            $sheet->setCellValue("E{$row}", $line['days']);
            $sheet->setCellValue("F{$row}", $line['justified']);
            $sheet->setCellValue("G{$row}", $line['observation']);
            $total += $line['days'];
            $row++;
        }

        $sheet->setCellValue("B{$row}", 'Total');
        $sheet->setCellValue("E{$row}", $total);
        $sheet->setCellValue("F{$row}", '-');
        $sheet->getStyle("B{$row}:G{$row}")->getFont()->setBold(true);

        $sheet->getStyle("B4:G{$row}")->getBorders()->getAllBorders()->setBorderStyle(Border::BORDER_HAIR);
        $sheet->getStyle("D5:D{$row}")->getAlignment()->setWrapText(true);
        $sheet->getStyle("G5:G{$row}")->getAlignment()->setWrapText(true);

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

    /**
     * Replica of the company's own "global.xlsx" (sheet "GLOBAL %"): same
     * 11 columns A→K, same header colours (D9F2D0 green, CFE2F3 blue on
     * Parcours/Consommation), fonts, widths, number formats, and the same
     * live formulas — Parcours = E−F, Consommation = H/G for a km vehicle or
     * H/G/100 for an hour-metered engine, shown as 0.00% exactly like the
     * original — so the exported file can be edited like the hand-made one.
     * Styles are applied per column range (never per cell) so 10k+ rows stay fast.
     *
     * @param  array<int, array<string, mixed>>  $rows  FuelGlobalController::shape() rows, oldest first
     */
    public function streamFuelGlobal(string $filename, array $rows): StreamedResponse
    {
        $spreadsheet = new Spreadsheet();
        $sheet = $spreadsheet->getActiveSheet();
        $sheet->setTitle('GLOBAL %');
        $sheet->setShowGridlines(false);
        $spreadsheet->getDefaultStyle()->getFont()->setName('Calibri')->setSize(11);

        $sheet->fromArray(['Date', 'Heure', 'Code', 'Immatriculation', 'Compteur fin', 'Compteur début', 'Parcours', 'Litre', 'Consommation', 'Remarque', 'Affectation'], null, 'A1');

        $data = [];
        $line = 2;
        foreach ($rows as $r) {
            $hasCounters = $r['odometer'] !== null && $r['previous_odometer'] !== null;
            $divisor = $r['unit'] === 'km' ? '' : '/100';
            $data[] = [
                $r['date'] ? \PhpOffice\PhpSpreadsheet\Shared\Date::stringToExcel($r['date']) : null,
                $r['time'] ? $this->timeFraction($r['time']) : null,
                $r['code'] !== null && ctype_digit($r['code']) ? (int) $r['code'] : $r['code'],
                $r['matricule'] ?? '',
                $r['odometer'],
                $r['previous_odometer'],
                $hasCounters ? "=+E{$line}-F{$line}" : null,
                $r['quantity'],
                $hasCounters ? "=IFERROR(IF(G{$line}>0,H{$line}/G{$line}{$divisor},\"\"),\"\")" : null,
                $r['remark'] ?? '',
                $r['tank'],
            ];
            $line++;
        }
        if ($data) {
            $sheet->fromArray($data, null, 'A2', true);
        }
        $last = max($line - 1, 1);

        $thin = ['borders' => ['allBorders' => ['borderStyle' => Border::BORDER_THIN]]];
        $green = ['fillType' => Fill::FILL_SOLID, 'startColor' => ['argb' => 'FFD9F2D0']];
        $blue = ['fillType' => Fill::FILL_SOLID, 'startColor' => ['argb' => 'FFCFE2F3']];

        $sheet->getStyle('A1:K1')->applyFromArray($thin + [
            'font' => ['bold' => true],
            'fill' => $green,
            'alignment' => ['horizontal' => Alignment::HORIZONTAL_CENTER, 'vertical' => Alignment::VERTICAL_CENTER, 'wrapText' => true],
        ]);
        $sheet->getStyle('E1:F1')->getFont()->setSize(10);
        $sheet->getStyle('G1')->getFill()->applyFromArray($blue);
        $sheet->getStyle('I1')->getFill()->applyFromArray($blue);

        if ($last >= 2) {
            $sheet->getStyle("A2:K{$last}")->applyFromArray($thin + [
                'alignment' => ['horizontal' => Alignment::HORIZONTAL_CENTER, 'vertical' => Alignment::VERTICAL_CENTER],
            ]);
            $gothic = ['font' => ['name' => 'Century Gothic', 'color' => ['argb' => 'FF3A3838']]];
            $sheet->getStyle("A2:A{$last}")->applyFromArray($gothic)->getNumberFormat()->setFormatCode('d/m/yyyy');
            $sheet->getStyle("D2:D{$last}")->applyFromArray($gothic);
            $sheet->getStyle("B2:B{$last}")->getNumberFormat()->setFormatCode('h:mm:ss AM/PM');
            $sheet->getStyle("G2:G{$last}")->applyFromArray(['font' => ['name' => 'Aptos Narrow'], 'fill' => $blue]);
            $sheet->getStyle("I2:I{$last}")->applyFromArray(['font' => ['name' => 'Aptos Narrow'], 'fill' => $blue])->getNumberFormat()->setFormatCode('0.00%');
            $sheet->getStyle("J2:J{$last}")->getFont()->setName('Aptos Narrow');
            $sheet->getStyle("K2:K{$last}")->getFont()->setName('Arial');
        }

        foreach (['A' => 12.89, 'B' => 12.66, 'C' => 25.11, 'D' => 26.89, 'E' => 10.33, 'F' => 9.11, 'G' => 9.0, 'H' => 11.78, 'I' => 11.11, 'J' => 33.0, 'K' => 17.44] as $column => $width) {
            $sheet->getColumnDimension($column)->setWidth($width);
        }
        $sheet->getRowDimension(1)->setRowHeight(27);
        $sheet->setAutoFilter("A1:K{$last}");
        $sheet->freezePane('A2');

        $writer = new Xlsx($spreadsheet);
        $writer->setPreCalculateFormulas(false); // Excel recalculates on open; computing 20k formulas here would only slow the download

        return new StreamedResponse(function () use ($writer) {
            $writer->save('php://output');
        }, 200, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
            'Cache-Control' => 'no-store, no-cache, must-revalidate, private',
        ]);
    }

    /**
     * Consommation > Rapport: a replica of the company's own "RAPPORT GSL
     * MM-YYYY.xlsx" — one sheet per day ("27-08"), title bar "CONSOMMATION
     * JOURNALIERE DE GASOIL dd/mm/yyyy - SITE", a CAMIONS block (CHAUFFEURS
     * équipe 1/2, Code, Litrage, %, Heure, Activite) then an ENGINS block
     * (CONDUCTEURS, …, L / h …), each with its Total, then the day's TOTAL.
     * A vehicle refuelled twice in the day gets two lines with its drivers,
     * code and activité merged across them, like the original. Fonts, sizes,
     * fills (theme colours resolved to RGB), borders and widths are copied
     * from the reference file.
     *
     * @param  array<int, array>  $reports  FuelReportService::build() results, one per day
     */
    public function streamFuelDailyReports(string $filename, string $siteName, array $reports): StreamedResponse
    {
        $spreadsheet = new Spreadsheet();
        $spreadsheet->removeSheetByIndex(0);
        $spreadsheet->getDefaultStyle()->getFont()->setName('Aptos Narrow')->setSize(11);

        foreach ($reports as $report) {
            $sheet = $spreadsheet->createSheet();
            $sheet->setTitle(\Illuminate\Support\Carbon::parse($report['date'])->format('d-m'));
            $this->fillFuelDailyReport($sheet, $siteName, $report);
        }
        $spreadsheet->setActiveSheetIndex(0);

        // Store each Total's value in the file next to its formula: without it,
        // anything that doesn't recalculate (Excel's protected view on a
        // downloaded file, phone/WhatsApp/Drive previews) shows empty totals.
        // Only three formulas per day, so this costs nothing.
        $writer = new Xlsx($spreadsheet);

        return new StreamedResponse(function () use ($writer) {
            $writer->save('php://output');
        }, 200, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
            'Cache-Control' => 'no-store, no-cache, must-revalidate, private',
        ]);
    }

    private function fillFuelDailyReport(Worksheet $sheet, string $siteName, array $report): void
    {
        $medium = ['borders' => ['allBorders' => ['borderStyle' => Border::BORDER_MEDIUM]]];
        $center = ['alignment' => ['horizontal' => Alignment::HORIZONTAL_CENTER, 'vertical' => Alignment::VERTICAL_CENTER, 'wrapText' => true]];
        $fill = fn (string $rgb) => ['fill' => ['fillType' => Fill::FILL_SOLID, 'startColor' => ['argb' => 'FF'.$rgb]]];
        $font = fn (string $name, float $size, string $color = '000000') => ['font' => ['name' => $name, 'size' => $size, 'bold' => true, 'color' => ['argb' => 'FF'.$color]]];
        $navy = '0B1E31';   // theme dk2, darker 25%
        $green = 'B4E5A2';  // theme accent6, lighter 60%

        foreach (['A' => 11.44, 'B' => 10.22, 'C' => 8.44, 'D' => 43.89, 'E' => 52.66, 'F' => 21.78, 'G' => 15.78, 'H' => 13.78, 'I' => 11.78, 'J' => 44.33] as $column => $width) {
            $sheet->getColumnDimension($column)->setWidth($width);
        }
        $sheet->getSheetView()->setZoomScale(74);

        $title = 'CONSOMMATION JOURNALIERE DE GASOIL '.\Illuminate\Support\Carbon::parse($report['date'])->format('d/m/Y').'  - '.mb_strtoupper($siteName);
        $sheet->setCellValue('D2', $title)->mergeCells('D2:J2');
        $sheet->getStyle('D2:J2')->applyFromArray($medium + $center + $fill($green) + $font('Century Schoolbook', 22));
        $sheet->getRowDimension(2)->setRowHeight(28.2);

        $row = 4;
        $totalRows = [];
        $blocks = [
            ['vehicles' => $report['camions'], 'people' => 'CHAUFFEURS', 'code' => 'Code', 'ratio' => '%', 'activity' => 'Activite', 'size' => 18, 'litresFill' => 'FFFFFF'],
            ['vehicles' => $report['engins'], 'people' => 'CONDUCTEURS', 'code' => 'Code ', 'ratio' => 'L / h', 'activity' => 'Activité', 'size' => 16, 'litresFill' => 'F2F2F2'],
        ];

        foreach ($blocks as $block) {
            // Two-line header: CHAUFFEURS over EQUIPE 1 / EQUIPE 2, the other titles merged over both lines.
            $sheet->setCellValue("D{$row}", $block['people'])->mergeCells("D{$row}:E{$row}");
            $sheet->setCellValue('D'.($row + 1), 'EQUIPE 1')->setCellValue('E'.($row + 1), 'EQUIPE 2');
            foreach (['F' => $block['code'], 'G' => 'Litrage', 'H' => $block['ratio'], 'I' => 'Heure', 'J' => $block['activity']] as $column => $label) {
                $sheet->setCellValue("{$column}{$row}", $label)->mergeCells("{$column}{$row}:{$column}".($row + 1));
            }
            $sheet->getStyle("D{$row}:J".($row + 1))->applyFromArray($medium + $center + $fill($navy) + $font('Century Schoolbook', 16, 'F2F2F2'));
            $sheet->getStyle("D{$row}")->applyFromArray($font('Aptos Narrow', 18, 'F2F2F2'));
            $sheet->getRowDimension($row)->setRowHeight(24);
            $sheet->getRowDimension($row + 1)->setRowHeight(21);
            $row += 2;

            $first = $row;
            foreach ($block['vehicles'] as $vehicle) {
                $start = $row;
                foreach ($vehicle['refuels'] as $refuel) {
                    $sheet->setCellValue("G{$row}", $refuel['quantity']);
                    $sheet->setCellValue("H{$row}", $refuel['ratio'] ?? '-');
                    $sheet->setCellValue("I{$row}", $refuel['hours'] ?? ($refuel['no_counter'] ? 'CP' : '-'));
                    $sheet->getRowDimension($row)->setRowHeight(24);
                    $row++;
                }
                $end = $row - 1;
                $sheet->setCellValue("D{$start}", $vehicle['driver_1'] ?? '-');
                $sheet->setCellValue("E{$start}", $vehicle['driver_2'] ?? '-');
                $sheet->setCellValueExplicit("F{$start}", $vehicle['label'], \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
                $sheet->setCellValue("J{$start}", $vehicle['activity'] ?? '-');
                if ($end > $start) {
                    foreach (['D', 'E', 'F', 'J'] as $column) {
                        $sheet->mergeCells("{$column}{$start}:{$column}{$end}");
                    }
                }
            }
            $last = $row - 1;

            if ($last >= $first) {
                $sheet->getStyle("D{$first}:J{$last}")->applyFromArray($medium + $center);
                $sheet->getStyle("D{$first}:F{$last}")->applyFromArray($fill('FFFFFF') + $font('Calibri', 18));
                $sheet->getStyle("G{$first}:G{$last}")->applyFromArray($fill($block['litresFill']) + $font('Aptos Narrow', $block['size']));
                $sheet->getStyle("H{$first}:I{$last}")->applyFromArray($font('Aptos Narrow', $block['size']));
                $sheet->getStyle("H{$first}:H{$last}")->getNumberFormat()->setFormatCode('0.00%');
                $sheet->getStyle("J{$first}:J{$last}")->applyFromArray($font('Aptos Narrow', 16));
            }

            $sheet->setCellValue("D{$row}", 'Total')->mergeCells("D{$row}:F{$row}");
            $sheet->setCellValue("G{$row}", $last >= $first ? "=+SUM(G{$first}:G{$last})" : 0)->mergeCells("G{$row}:J{$row}");
            $sheet->getStyle("D{$row}:J{$row}")->applyFromArray($medium + $center + $font('Aptos Narrow', 22));
            $sheet->getStyle("D{$row}:F{$row}")->applyFromArray($fill($green));
            $sheet->getStyle("G{$row}:J{$row}")->applyFromArray($fill('FFC000'));
            $sheet->getRowDimension($row)->setRowHeight(28);
            $totalRows[] = $row;
            $row += 2;
        }

        // Day TOTAL (camions + engins), two lines high like the original.
        $sheet->setCellValue("D{$row}", 'TOTAL')->mergeCells("D{$row}:F".($row + 1));
        $sheet->setCellValue("G{$row}", '=G'.$totalRows[1].'+G'.$totalRows[0])->mergeCells("G{$row}:J".($row + 1));
        $sheet->getStyle("D{$row}:J".($row + 1))->applyFromArray($medium + $center + $font('Aptos Narrow', 24));
        $sheet->getStyle("D{$row}:F".($row + 1))->applyFromArray($fill($navy) + $font('Aptos Narrow', 24, 'F2F2F2'));
        $sheet->getStyle("G{$row}:J".($row + 1))->applyFromArray($fill('FF0000'));
    }

    /** "14:02:00" -> 0.5847… (Excel time = fraction of a day) */
    private function timeFraction(string $time): float
    {
        [$h, $m, $s] = array_map('intval', explode(':', $time) + [0, 0, 0]);

        return ($h * 3600 + $m * 60 + $s) / 86400;
    }
}
