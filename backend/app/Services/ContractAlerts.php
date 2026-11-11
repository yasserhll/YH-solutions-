<?php

namespace App\Services;

use App\Models\Contract;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Device notifications for the Contrats session: each contract is pushed ONCE
 * when it enters "bientôt" (10 days before the end) and once more when it is
 * "terminé", to every account that has the contrats session, the
 * contract's site and at least one device with notifications turned on.
 * `contracts.notified_state` remembers what was already sent.
 */
class ContractAlerts
{
    public function __construct(private WebPushService $push) {}

    private static bool $queued = false;

    /**
     * Sends the due alerts at the end of the current request / command
     * (after the response is sent), once however many contracts changed.
     */
    public static function soon(): void
    {
        if (self::$queued) {
            return;
        }
        self::$queued = true;
        app()->terminating(function () {
            self::$queued = false;
            app(self::class)->notifyDueSafely();
        });
    }

    /** Cheap to call often (the bell, on every page): at most every 15 s. */
    public function notifyDueThrottled(): void
    {
        if (Cache::add('contract-alerts-push', 1, 15)) {
            $this->notifyDueSafely();
        }
    }

    public function notifyDueSafely(): void
    {
        try {
            $this->notifyDue();
        } catch (\Throwable $e) {
            Log::error('Contract push alerts failed: '.$e->getMessage());
        }
    }

    /**
     * @return int number of contracts newly notified. Serialized by a lock so
     * two requests at the same moment can never send the same alert twice.
     */
    public function notifyDue(): int
    {
        // CIN / permis alerts (DocumentAlerts) ride along: same lock, same triggers.
        return Cache::lock('contract-alerts-send', 120)->block(30, fn () => $this->send() + app(DocumentAlerts::class)->send());
    }

    private function send(): int
    {
        // A contract moved back out of the alert window (end date corrected)
        // can be alerted again later.
        Contract::query()->inState('en_cours')->whereNotNull('notified_state')->update(['notified_state' => null]);

        $due = Contract::query()->inState('a_traiter')
            ->where(fn ($q) => $q->whereNull('notified_state')->orWhere('notified_state', 'bientot'))
            ->with('employee.site')
            ->withCddNumber()
            ->get()
            ->filter(fn (Contract $c) => $c->state !== $c->notified_state)
            ->values();

        if ($due->isEmpty()) {
            return 0;
        }

        $users = User::with('sites')->whereHas('pushSubscriptions')->get()->filter(fn (User $u) => $u->hasModule('contrats'));
        foreach ($users as $user) {
            $sites = $user->assignedSiteIds();
            $mine = $due->filter(fn (Contract $c) => in_array($c->employee?->site_id, $sites, true))->values();
            if ($mine->isNotEmpty()) {
                $this->push->sendToUsers([$user->id], $this->payload($mine));
            }
        }

        // Marked even when nobody was subscribed: a device switched on later
        // only receives the NEW alerts (the bell lists the older ones).
        foreach ($due->groupBy('state') as $state => $contracts) {
            Contract::whereIn('id', $contracts->pluck('id'))->update(['notified_state' => $state]);
        }

        return $due->count();
    }

    /** One notification per account: the contract itself, or a summary. */
    private function payload(Collection $contracts): array
    {
        $base = ['url' => '/contrats?state=a_traiter', 'tag' => 'contracts'];

        if ($contracts->count() === 1) {
            /** @var Contract $c */
            $c = $contracts->first();
            $label = $c->cdd_number && $c->cdd_number > 1 ? $c->cdd_number.'ème CDD' : '1er CDD';
            $end = $c->end_date->format('d/m/Y');
            $site = $c->employee?->site?->name;
            $auto = $c->auto_cdi && ($c->cdd_number ?? 1) >= 2;

            if ($c->state === 'termine') {
                return $base + [
                    'title' => 'Contrat terminé',
                    'body' => "{$c->employee?->full_name} · {$label} terminé le {$end}".($site ? " · {$site}" : '').'. Décision à prendre : renouveler, CDI ou sortie.',
                ];
            }

            $days = $c->days_left;
            $when = $days === 0 ? "aujourd'hui" : "dans {$days} jour".($days > 1 ? 's' : '');

            return $base + [
                'title' => 'Contrat bientôt terminé',
                'body' => "{$c->employee?->full_name} · {$label} se termine {$when} ({$end})".($site ? " · {$site}" : '').'.'
                    .($auto ? ' Passage automatique en CDI à la fin.' : ''),
            ];
        }

        $ended = $contracts->where('state', 'termine')->count();
        $soon = $contracts->count() - $ended;
        $names = $contracts->take(3)->map(fn ($c) => $c->employee?->full_name)->filter()->implode(', ');
        $others = $contracts->count() - min(3, $contracts->count());

        return $base + [
            'title' => $contracts->count().' contrats à traiter',
            'body' => collect([$ended ? "{$ended} terminé".($ended > 1 ? 's' : '') : null, $soon ? "{$soon} bientôt terminé".($soon > 1 ? 's' : '') : null])
                ->filter()->implode(' · ')
                .' — '.$names.($others > 0 ? " et {$others} autre".($others > 1 ? 's' : '') : '').'.',
        ];
    }
}
