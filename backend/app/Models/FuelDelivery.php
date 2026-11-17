<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A delivery of gasoil into a citerne ("Entrées carburant"): typed by the
 * pompiste from the supplier's bon de livraison (origin 'app', its photos
 * hang on the citerne's ENTREE line `fuel_movement_id`), or a line of the
 * INVENTAIRE workbook (origin 'import'). The price (PU, montant HT) is what
 * the PMP and the purchase totals are computed from.
 */
class FuelDelivery extends Model
{
    protected $guarded = [];

    public const SUPPLIERS = ['AFRIQUIA', 'PETROM', 'VIVO ENERGY', 'LINK ENERGY', 'ANH', 'TRANSMEL'];

    /** Fields a pompiste never sees (prices are for the responsables). */
    public const PRICE_FIELDS = ['unit_price', 'amount', 'invoice_number', 'invoice_received'];

    protected function casts(): array
    {
        return [
            'date' => 'date:Y-m-d',
            'quantity' => 'float',
            'unit_price' => 'float',
            'amount' => 'float',
            'invoice_received' => 'boolean',
            'gauge_before_cm' => 'float',
            'gauge_before_l' => 'float',
            'gauge_after_cm' => 'float',
            'gauge_after_l' => 'float',
            'serie' => 'float',
        ];
    }

    public function site(): BelongsTo
    {
        return $this->belongsTo(Site::class);
    }

    public function tank(): BelongsTo
    {
        return $this->belongsTo(FuelTank::class, 'fuel_tank_id');
    }

    public function movement(): BelongsTo
    {
        return $this->belongsTo(FuelMovement::class, 'fuel_movement_id');
    }

    public function attachments(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(FuelDeliveryAttachment::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * Every delivery with a citerne is an ENTREE line of that citerne
     * (`fuel_movements`, origin 'livraison': date, Qte, Fournisseur), so
     * Détail citernes and its export show it. An inventory line already
     * written in the citerne's own Excel sheet (same quantity ±1 L, ±3 days)
     * is not added a second time.
     */
    public function syncMovement(): void
    {
        $movement = $this->fuel_movement_id ? FuelMovement::find($this->fuel_movement_id) : null;
        if (! $this->fuel_tank_id) {
            $movement?->delete();

            return;
        }

        if ($movement === null && $this->origin === 'import') {
            $inSheet = FuelMovement::where('fuel_tank_id', $this->fuel_tank_id)
                ->where('type', 'entry')->where('origin', 'import')
                ->whereBetween('date', [$this->date->copy()->subDays(3)->toDateString(), $this->date->copy()->addDays(3)->toDateString()])
                ->whereBetween('quantity', [$this->quantity - 1, $this->quantity + 1])
                ->exists();
            if ($inSheet) {
                return;
            }
        }

        $refs = array_filter([
            $this->delivery_note ? (str_starts_with(strtoupper($this->delivery_note), 'BL') ? $this->delivery_note : 'BL '.$this->delivery_note) : null,
            $this->order_number ? 'Cmd '.$this->order_number : null,
        ]);
        $tankSite = FuelTank::whereKey($this->fuel_tank_id)->value('site_id');
        $values = [
            'fuel_tank_id' => $this->fuel_tank_id,
            'site_id' => $tankSite ?? $this->site_id,
            'type' => 'entry',
            'origin' => 'livraison',
            'date' => $this->date->toDateString(),
            'time' => $this->time,
            'quantity' => $this->quantity,
            'supplier' => $this->supplier,
            'remark' => $refs ? mb_substr(implode(' · ', $refs), 0, 255) : null,
            'pompiste_name' => $this->pompiste_name,
        ];

        if ($movement) {
            $movement->update($values);

            return;
        }
        $movement = FuelMovement::create($values + ['created_by' => $this->created_by, 'created_at' => now()]);
        $this->forceFill(['fuel_movement_id' => $movement->id])->saveQuietly();
    }

    /** "P14495", "p 14495" and "P014495" are the same order. */
    public static function normalizeRef(?string $value): ?string
    {
        $value = strtoupper(preg_replace('/[\s\-\/.]+/', '', (string) $value));
        if ($value === '') {
            return null;
        }

        return preg_replace('/^([A-Z]*)0+(?=\d)/', '$1', $value);
    }

    /** "Afriquia", "VIVO" → the inventory's spelling. */
    public static function normalizeSupplier(?string $value): ?string
    {
        $value = mb_strtoupper(trim(preg_replace('/\s+/', ' ', (string) $value)));
        if ($value === '') {
            return null;
        }
        foreach (self::SUPPLIERS as $known) {
            if ($value === $known || str_starts_with($known, $value.' ') || str_starts_with($value, explode(' ', $known)[0])) {
                return $known;
            }
        }

        return $value;
    }
}
