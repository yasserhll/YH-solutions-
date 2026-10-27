<?php

namespace App\Http\Controllers\Concerns;

use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;

/**
 * Every Consommation import (citernes, matriculation, affectation) goes
 * through here so a server-side limit never fails silently: on a fresh
 * server PHP accepts 2 Mo uploads by default (upload_max_filesize) and 8 Mo
 * per request (post_max_size), while "mobile 1.xlsx" alone is 2.3 Mo — the
 * upload is then dropped by PHP before Laravel sees it, and the user only
 * saw a vague failure. Each case now gets a message naming the real limit.
 *
 * The type check is on the .xlsx extension, not on the MIME type guessed
 * by the server's libmagic (which, depending on its version, can report a
 * perfectly valid workbook as application/zip and reject it); the stream
 * reader then opens the file itself and errors clearly if it isn't one.
 */
trait ReceivesExcelUpload
{
    protected function excelUpload(Request $request): UploadedFile
    {
        // Big citerne files (~50 000 pre-formatted rows) + the consumption
        // recalculation can exceed a small shared-hosting default.
        @set_time_limit(300);
        if ($this->bytes((string) ini_get('memory_limit')) < 512 * 1024 * 1024 && ini_get('memory_limit') !== '-1') {
            @ini_set('memory_limit', '512M');
        }

        foreach (['ZipArchive' => 'zip', 'XMLReader' => 'xmlreader'] as $class => $extension) {
            abort_unless(class_exists($class), 500, "L'extension PHP « {$extension} » n'est pas installée sur le serveur : impossible de lire un fichier Excel. Installez-la (ex. apt install php-{$extension}) puis redémarrez PHP.");
        }

        $file = $request->file('file');
        $length = (int) $request->server('CONTENT_LENGTH');
        $postMax = $this->bytes((string) ini_get('post_max_size'));
        if (! $file && $postMax > 0 && $length > $postMax) {
            abort(422, sprintf('Le fichier (%s) dépasse la limite du serveur : post_max_size = %s. Augmentez post_max_size et upload_max_filesize dans php.ini (ex. 50M).', $this->mo($length), ini_get('post_max_size')));
        }
        if ($file && ! $file->isValid()) {
            abort(422, match ($file->getError()) {
                UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => sprintf('« %s » (%s) dépasse la limite du serveur : upload_max_filesize = %s. Augmentez upload_max_filesize et post_max_size dans php.ini (ex. 50M).', $file->getClientOriginalName(), $this->mo($length), ini_get('upload_max_filesize')),
                UPLOAD_ERR_PARTIAL => "L'envoi de « {$file->getClientOriginalName()} » a été interrompu. Réessayez.",
                UPLOAD_ERR_NO_TMP_DIR, UPLOAD_ERR_CANT_WRITE => "Le serveur ne peut pas enregistrer le fichier reçu (dossier temporaire PHP absent ou non accessible en écriture).",
                default => "L'envoi de « {$file->getClientOriginalName()} » a échoué : ".$file->getErrorMessage(),
            });
        }

        $request->validate(
            ['file' => ['required', 'file', 'extensions:xlsx', 'max:51200']],
            [
                'file.required' => 'Aucun fichier reçu.',
                'file.extensions' => 'Seuls les fichiers Excel .xlsx sont acceptés (enregistrez le fichier au format « Classeur Excel (.xlsx) »).',
                'file.max' => 'Le fichier dépasse 50 Mo.',
            ]
        );

        return $request->file('file');
    }

    /** "2M" / "512M" / "1G" / "8388608" -> bytes */
    private function bytes(string $value): int
    {
        $value = trim($value);
        $number = (int) $value;

        return match (strtoupper(substr($value, -1))) {
            'G' => $number * 1024 ** 3,
            'M' => $number * 1024 ** 2,
            'K' => $number * 1024,
            default => $number,
        };
    }

    private function mo(int $bytes): string
    {
        return number_format($bytes / 1024 / 1024, 1, ',', ' ').' Mo';
    }
}
