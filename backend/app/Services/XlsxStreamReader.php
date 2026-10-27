<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Symfony\Component\HttpKernel\Exception\HttpException;
use XMLReader;
use ZipArchive;

/**
 * Minimal streaming .xlsx reader (zip + XMLReader), used by the Consommation
 * imports instead of PhpSpreadsheet: the citerne workbooks run to 2+ MB and
 * tens of thousands of pre-formatted rows, which PhpSpreadsheet loads fully
 * into memory (hundreds of MB, tens of seconds). This reads one row at a
 * time and only ever returns cached cell values — formulas are never
 * evaluated, which is exactly what we want since these files reference an
 * external workbook ("[1]Matricule!...") that isn't available here.
 */
class XlsxStreamReader
{
    protected ZipArchive $zip;

    /** @var string[] */
    protected array $sharedStrings = [];

    public function __construct(string $path)
    {
        $this->zip = new ZipArchive();
        if ($this->zip->open($path) !== true) {
            throw new HttpException(422, "Le fichier n'est pas un classeur Excel (.xlsx) valide : ouvrez-le dans Excel et enregistrez-le en « Classeur Excel (.xlsx) ».");
        }
        $this->loadSharedStrings();
    }

    public function __destruct()
    {
        @$this->zip->close();
    }

    /**
     * @return array<string, string> sheet name => path inside the zip, in workbook order
     */
    public function sheets(): array
    {
        $workbook = $this->zip->getFromName('xl/workbook.xml');
        $rels = $this->zip->getFromName('xl/_rels/workbook.xml.rels');
        if ($workbook === false || $rels === false) {
            throw new HttpException(422, 'Classeur Excel illisible.');
        }

        $targets = [];
        $relsXml = simplexml_load_string($rels);
        foreach ($relsXml->Relationship as $rel) {
            $target = ltrim((string) $rel['Target'], '/');
            $targets[(string) $rel['Id']] = str_starts_with($target, 'xl/') ? $target : 'xl/'.$target;
        }

        $sheets = [];
        $wbXml = simplexml_load_string($workbook);
        foreach ($wbXml->sheets->sheet as $sheet) {
            $rid = (string) $sheet->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships')['id'];
            if (isset($targets[$rid])) {
                $sheets[(string) $sheet['name']] = $targets[$rid];
            }
        }

        return $sheets;
    }

    /**
     * Yields [rowNumber, [columnLetter => value]] for every non-empty row.
     * Values are int|float|string|bool; empty/error cells are left out.
     *
     * @return \Generator<int, array{0: int, 1: array<string, mixed>}>
     */
    public function rows(string $sheetPath): \Generator
    {
        $stream = $this->zip->getStream($sheetPath);
        if ($stream === false) {
            throw new HttpException(422, 'Feuille Excel illisible.');
        }
        $xml = stream_get_contents($stream);
        fclose($stream);

        $reader = new XMLReader();
        $reader->XML($xml, null, LIBXML_NONET | LIBXML_COMPACT | LIBXML_PARSEHUGE);

        $rowNumber = 0;
        $cells = [];
        $inRow = false;

        while ($reader->read()) {
            if ($reader->nodeType === XMLReader::ELEMENT && $reader->localName === 'row') {
                $rowNumber = (int) $reader->getAttribute('r') ?: $rowNumber + 1;
                $cells = [];
                $inRow = true;
                if ($reader->isEmptyElement) {
                    $inRow = false;
                }
            } elseif ($inRow && $reader->nodeType === XMLReader::ELEMENT && $reader->localName === 'c') {
                $ref = (string) $reader->getAttribute('r');
                $type = (string) $reader->getAttribute('t');
                $column = preg_replace('/\d+/', '', $ref);
                if ($reader->isEmptyElement) {
                    continue;
                }
                $value = $this->readCellValue($reader, $type);
                if ($value !== null && $value !== '') {
                    $cells[$column] = $value;
                }
            } elseif ($inRow && $reader->nodeType === XMLReader::END_ELEMENT && $reader->localName === 'row') {
                $inRow = false;
                if ($cells) {
                    yield [$rowNumber, $cells];
                }
            }
        }
        $reader->close();
    }

    /** Excel serial date (1900 system) -> date, or a d/m/Y string. Null when out of a sane range. */
    public static function toDate(mixed $value): ?CarbonImmutable
    {
        if (is_int($value) || is_float($value)) {
            if ($value < 20000 || $value > 80000) {
                return null; // before ~1954 or after ~2119: a typo, not a date
            }

            return CarbonImmutable::create(1899, 12, 30)->addDays((int) floor($value));
        }
        if (is_string($value) && preg_match('#^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$#', trim($value), $m)) {
            $year = strlen($m[3]) === 2 ? 2000 + (int) $m[3] : (int) $m[3];
            if (checkdate((int) $m[2], (int) $m[1], $year)) {
                return CarbonImmutable::create($year, (int) $m[2], (int) $m[1]);
            }
        }
        if (is_string($value) && preg_match('#^(\d{4})-(\d{2})-(\d{2})#', trim($value), $m) && checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            return CarbonImmutable::create((int) $m[1], (int) $m[2], (int) $m[3]);
        }

        return null;
    }

    /** Excel time (fraction of a day, possibly with a date part) or "HH:MM" -> "HH:MM:SS". */
    public static function toTime(mixed $value): ?string
    {
        if (is_int($value) || is_float($value)) {
            $fraction = $value - floor($value);
            $seconds = (int) round($fraction * 86400) % 86400;

            return sprintf('%02d:%02d:%02d', intdiv($seconds, 3600), intdiv($seconds % 3600, 60), $seconds % 60);
        }
        if (is_string($value) && preg_match('/^(\d{1,2})[:hH](\d{2})(?::(\d{2}))?$/', trim($value), $m) && (int) $m[1] < 24) {
            return sprintf('%02d:%02d:%02d', $m[1], $m[2], $m[3] ?? 0);
        }

        return null;
    }

    /** A numeric cell, or a string holding a number ("5 724,3"). */
    public static function toNumber(mixed $value): ?float
    {
        if (is_int($value) || is_float($value)) {
            return (float) $value;
        }
        if (is_string($value)) {
            $clean = str_replace([' ', "\u{00A0}", ','], ['', '', '.'], trim($value));
            if (is_numeric($clean)) {
                return (float) $clean;
            }
        }

        return null;
    }

    protected function readCellValue(XMLReader $reader, string $type): mixed
    {
        $raw = null;
        $inline = '';
        $depth = $reader->depth;

        while ($reader->read()) {
            if ($reader->nodeType === XMLReader::END_ELEMENT && $reader->localName === 'c' && $reader->depth === $depth) {
                break;
            }
            if ($reader->nodeType === XMLReader::ELEMENT && $reader->localName === 'v') {
                $raw = $reader->readString();
            } elseif ($type === 'inlineStr' && $reader->nodeType === XMLReader::ELEMENT && $reader->localName === 't') {
                $inline .= $reader->readString();
            }
        }

        return match ($type) {
            's' => $raw === null ? null : ($this->sharedStrings[(int) $raw] ?? null),
            'inlineStr' => $inline,
            'str' => $raw,
            'b' => $raw === '1',
            'e' => null,
            default => $raw === null ? null : (str_contains($raw, '.') || stripos($raw, 'e') !== false ? (float) $raw : (int) $raw),
        };
    }

    protected function loadSharedStrings(): void
    {
        $xml = $this->zip->getFromName('xl/sharedStrings.xml');
        if ($xml === false) {
            return;
        }

        $reader = new XMLReader();
        $reader->XML($xml, null, LIBXML_NONET | LIBXML_COMPACT | LIBXML_PARSEHUGE);
        $current = null;
        $inPhonetic = false; // <rPh> runs are pronunciation hints, not part of the text
        while ($reader->read()) {
            if ($reader->localName === 'rPh' && ! $reader->isEmptyElement) {
                $inPhonetic = $reader->nodeType === XMLReader::ELEMENT;
            } elseif ($reader->nodeType === XMLReader::ELEMENT && $reader->localName === 'si') {
                $current = '';
                if ($reader->isEmptyElement) {
                    $this->sharedStrings[] = '';
                    $current = null;
                }
            } elseif ($current !== null && ! $inPhonetic && $reader->nodeType === XMLReader::ELEMENT && $reader->localName === 't') {
                $current .= $reader->readString();
            } elseif ($reader->nodeType === XMLReader::END_ELEMENT && $reader->localName === 'si') {
                $this->sharedStrings[] = $current;
                $current = null;
            }
        }
        $reader->close();
    }
}
