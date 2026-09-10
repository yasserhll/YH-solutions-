<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
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
        'active_site_id',
        'is_active',
    ];

    protected $hidden = [
        'password',
        'remember_token',
        'active_site_id',
        'activeSite',
    ];

    /**
     * Serialized as "site" (not the relation's own "active_site" key) so
     * every endpoint that returns a raw User model — not just AuthController,
     * which builds this shape by hand — agrees on the same field name the
     * frontend's User/AuthUser types expect.
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
        return Attribute::make(get: fn () => $this->activeSite);
    }

    /**
     * Every site this responsable is assigned to. A superadmin has no rows
     * here — their access is unrestricted regardless of this relation.
     */
    public function sites(): BelongsToMany
    {
        return $this->belongsToMany(Site::class, 'site_user');
    }

    /**
     * The one site a responsable is currently working in. All site-scoped
     * reads/writes for a responsable are forced onto this site, never onto
     * their other assigned sites, until they switch it — see
     * InteractsWithSites, which is the only place besides the switch-site
     * endpoint that's allowed to rely on this for authorization.
     */
    public function activeSite(): BelongsTo
    {
        return $this->belongsTo(Site::class, 'active_site_id');
    }

    public function isSuperAdmin(): bool
    {
        return $this->role === 'superadmin';
    }

    /**
     * Is this the site the user is currently working in? Used to gate every
     * site-scoped read/write — deliberately narrower than "is this site
     * assigned to the user" (see hasSiteAssigned), so a multi-site
     * responsable can't act on a site they haven't switched to.
     */
    public function canAccessSite(int $siteId): bool
    {
        return $this->isSuperAdmin() || $this->active_site_id === $siteId;
    }

    /**
     * Is this one of the sites the user is allowed to switch their active
     * site to? Used only by the active-site switch endpoint.
     */
    public function hasSiteAssigned(int $siteId): bool
    {
        return $this->isSuperAdmin() || $this->sites()->where('sites.id', $siteId)->exists();
    }
}
