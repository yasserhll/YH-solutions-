<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = [
        'name',
        'email',
        'password',
        'role',
        'is_active',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * Serialized as "site" (not the relation's own key) so every endpoint
     * that returns a raw User model agrees on the same field name the
     * frontend's User/AuthUser types expect. Only meaningful for a
     * single-site responsable — a multi-site one has no one "current" site
     * any more (see [[sites]]), so this is null for them and for a superadmin.
     */
    protected $appends = ['site'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean',
        ];
    }

    protected function site(): Attribute
    {
        return Attribute::make(get: fn () => $this->sites->count() === 1 ? $this->sites->first() : null);
    }

    /**
     * Every site this responsable is assigned to — usable simultaneously,
     * not one-at-a-time. A superadmin has no rows here; their access is
     * unrestricted regardless of this relation (see assignedSiteIds).
     */
    public function sites(): BelongsToMany
    {
        return $this->belongsToMany(Site::class, 'site_user');
    }

    public function isSuperAdmin(): bool
    {
        return $this->role === 'superadmin';
    }

    /**
     * Every site id this user may read/write. A superadmin's is unrestricted
     * (every site); a responsable's is exactly their assigned sites — this
     * is the set InteractsWithSites scopes every query and write to, so a
     * multi-site responsable (e.g. assigned to Bouchane + Mzinda) sees both
     * at once rather than one at a time.
     */
    public function assignedSiteIds(): array
    {
        if ($this->isSuperAdmin()) {
            return Site::pluck('id')->all();
        }

        return $this->sites->pluck('id')->all();
    }

    /**
     * Is this one of the sites the user is allowed to read/write? Used by
     * InteractsWithSites for every site-scoped check.
     */
    public function canAccessSite(int $siteId): bool
    {
        return $this->isSuperAdmin() || in_array($siteId, $this->assignedSiteIds(), true);
    }
}
