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
        'modules',
        'is_active',
    ];

    /**
     * Every session (module) an account can be given, in sidebar order.
     * Each one gates its own API routes (`module:<key>` middleware,
     * EnsureModuleAccess) and its own pages/sidebar entry on the frontend.
     */
    public const MODULES = [
        'dashboard', 'pointage', 'conges', 'sanctions', 'hse', 'mouvements', 'affectations',
        'heures_sup', 'caisse', 'consommation', 'personnel', 'rapports', 'historique',
    ];

    /**
     * What each role gets when no custom list was chosen (users.modules null)
     * — exactly the access every role had before per-account sessions existed.
     */
    public const ROLE_MODULES = [
        'responsable' => ['dashboard', 'pointage', 'conges', 'sanctions', 'mouvements', 'affectations', 'heures_sup', 'caisse', 'consommation', 'personnel', 'rapports', 'historique'],
        'responsable_hse' => ['pointage', 'conges', 'sanctions', 'hse', 'mouvements', 'affectations'],
        'hse' => ['hse'],
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
    protected $appends = ['site', 'allowed_modules'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean',
            'modules' => 'array',
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

    /**
     * The sessions this account can actually use: a SuperAdmin always has
     * every one (full control, never restricted); anyone else gets the list a
     * SuperAdmin picked for them, or their role's default when none was.
     *
     * @return array<int, string>
     */
    public function allowedModules(): array
    {
        if ($this->isSuperAdmin()) {
            return self::MODULES;
        }

        $modules = $this->modules ?? self::ROLE_MODULES[$this->role] ?? [];

        return array_values(array_intersect(self::MODULES, $modules));
    }

    public function hasModule(string $module): bool
    {
        return in_array($module, $this->allowedModules(), true);
    }

    /** Serialized as `allowed_modules` (the method name allowedModules() is taken by the helper above). */
    public function getAllowedModulesAttribute(): array
    {
        return $this->allowedModules();
    }

    public function isSuperAdmin(): bool
    {
        return $this->role === 'superadmin';
    }

    public function isHse(): bool
    {
        return $this->role === 'hse';
    }

    public function isResponsableHse(): bool
    {
        return $this->role === 'responsable_hse';
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
