# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A professional HR & administrative management web app for a mining company (TransWin Mining) operating 4 sites: **Ben Guerir, Louta, Bouchane, Mzinda**. Two-role system: a **SuperAdmin** sees/manages everything across all sites; a **Responsable de site** is locked to exactly one site, both in the UI and (non-negotiably) in the backend.

Two separate apps in this repo, talking over a REST API:
- `backend/` — Laravel 11 API (PHP 8.2, MySQL, Sanctum token auth)
- `frontend/` — React 19 + TypeScript + Vite + Tailwind CSS v4

There is no root-level package manager — each app is built/run independently from its own directory.

## Commands

### Backend (`backend/`)
```
composer install
php artisan migrate            # run migrations (MySQL must be running — see below)
php artisan migrate:fresh --seed   # rebuild schema + demo data (4 sites, users, employees, cash ledgers...)
php artisan serve --port=8000  # dev server at http://127.0.0.1:8000
php artisan tinker             # REPL
```
No test suite exists yet (Pest/PHPUnit scaffolding from `laravel/laravel` is present but unused — add tests under `tests/Feature` when writing new endpoints, especially for site-scoping).

Database: MySQL via XAMPP (`C:\xampp\mysql\bin\mysql.exe`), database name `globalisation_app`, user `root` no password. Config lives in `backend/.env` (`DB_CONNECTION=mysql`).

### Frontend (`frontend/`)
```
npm install
npm run dev        # Vite dev server at http://localhost:5173, proxies /api and /sanctum to :8000
npm run build      # tsc -b && vite build — always run this after non-trivial changes, it catches type errors the editor won't
npm run lint
```
The Vite dev server proxies `/api/*` to the Laravel backend (see `vite.config.ts`), so the frontend always calls same-origin `/api/...` — no CORS dance needed in dev.

### Running both for manual testing
Start `php artisan serve --port=8000` in `backend/` and `npm run dev` in `frontend/`, then open `http://localhost:5173`. Demo logins (password `password` for all):
- `admin@transwin-mining.com` — SuperAdmin
- `responsable.ben-guerir@transwin-mining.com` (and `.louta`, `.bouchane`, `.mzinda`) — site responsables

## Architecture

### The one rule that matters: site-scoping is enforced server-side

A responsable must never see or write another site's data, even if the frontend is bypassed entirely. This is centralized in **`app/Http/Controllers/Concerns/InteractsWithSites.php`**, a trait used by every site-scoped controller:
- `resolveSiteId($request)` — for creates: forces a responsable onto their own `site_id`; requires a superadmin to supply one explicitly.
- `ensureSiteAccess($request, $siteId)` — aborts 403 if the given site doesn't belong to the current user.
- `scopeToSite($query, $request)` — for reads: forces `where site_id = user.site_id` for a responsable; for a superadmin, applies an *optional* `?site_id=` filter (used for the global site switcher).

Never trust `site_id` from the request body/query for a responsable — always resolve/verify it via this trait. New site-scoped resources should follow the same pattern rather than inventing per-controller checks.

`resolveSiteId()` throwing "Le site est obligatoire" for a SuperAdmin means the frontend form for that create endpoint forgot to send `site_id` — a real bug hit on `EntryFormModal`/`ExitFormModal` (`MovementsPage.tsx`): both forms only had an "Établissement" free-text field (a different, unrelated concept — a physical building/facility name stored on the employee, not the `site_id` foreign key that drives all the site-scoping) and no `Site` selector at all, so a SuperAdmin creating a new entry, or a manual (employee-not-in-database) exit, always failed since nothing in the payload could satisfy `resolveSiteId`. A responsable never needs this field (their site is forced automatically), so both forms now show a required `Site` `<select>` (populated from `useSites()`) only when `isSuperAdmin` and only on create — same pattern already used in `CashPage.tsx`'s `TransactionFormModal`. If you add another SuperAdmin-facing create form on a site-scoped resource, check it has an explicit Site field the same way rather than assuming "Établissement" or any other free-text field covers it.

Manual-mode `ExitFormModal` (used when "L'employé n'existe pas dans la base") also gained a `Fonction` (`position_id`) select, matching `EntryFormModal` — the backend (`ExitController@store`) already accepted `position_id` for a manual exit, the frontend form just never exposed it, so there was no way to record what role a since-departed, never-entered employee actually held.

Role check (SuperAdmin-only routes) is a separate concern: `app/Http/Middleware/EnsureSuperAdmin.php`, aliased as `superadmin` middleware, wraps the relevant route group in `routes/api.php`.

Auth is Sanctum **personal access tokens** (`Authorization: Bearer ...`), not the SPA cookie flow — simpler given the frontend and backend are separate apps talking over a proxy. Token issued by `AuthController@login`, stored in `localStorage` on the frontend, attached by an axios interceptor (`frontend/src/api/client.ts`).

### Domain model

Core tables (see `backend/database/migrations/2025_01_01_*`): `sites`, `departments`, `positions` (all reference/lookup tables), `employees`, `attendances`, `leave_requests` + `leaves` + `leave_extensions`, `disciplinary_warnings`, `suspensions`, `assignments`, `entries`, `exits`, `cash_accounts` + `cash_transactions`, `audit_logs` (defined, not yet wired into every controller — see `App\Services\AuditLogger` for the write helper).

Notable relationship: **Employee → Site / Department / Position**, with a running **Assignment** history (`is_current` flag) that's created/updated automatically whenever an employee is hired (`EntryController`) or reassigned (`AssignmentController`), so the UI never asks the user to re-enter data that's already on file.

`App\Models\EmployeeExit` — note the name. The migration/table is `exits`, but `Exit` is a reserved word in PHP and can't be a class name, hence `EmployeeExit` with `protected $table = 'exits'`.

### Attendance: marking present must fully clear the old absence

`AttendanceController@store`/`@update` null out both `absence_cause` *and* `description` when `status` flips to `present` — not just the cause. Easy to miss because `updateOrCreate($keys, $data)`/`$model->update($data)` only touch the keys actually present in `$data`; a field silently omitted from the payload keeps its old DB value instead of being cleared, which is exactly what happened before this was fixed (a "Marquer présent" left the previous absence's description visible). If you ever add another status-dependent field here, remember `$data` needs the field explicitly, not just left out.

`AttendancePage.tsx`'s daily sheet also lets a responsable/SuperAdmin re-open the absence modal on an already-absent row (the small pencil icon next to "Marquer présent") to correct the cause/description in place — e.g. someone marked "non autorisée" who later brings a doctor's note should become "maladie" directly, not via mark-present-then-mark-absent-again. The modal pre-fills from the existing row (`isCorrection` in `AbsenceModal`) when doing this.

The five `absence_cause` values are `maladie`, `autorisee`, `non_autorisee`, `justifie`, `conge` — `justifie` (added 2026-09-04) is deliberately distinct from `autorisee`: it's a separate bucket the user wanted for "justified" absences that isn't the same category as a pre-authorized one. It's an actual MySQL `enum` column, so adding a value needs a migration that runs `ALTER TABLE attendances MODIFY absence_cause ENUM(...)` (see `2026_09_04_000001_add_justifie_to_attendances_absence_cause.php`) — you can't just add it to the `Rule::in([...])` lists. Every place the cause list is duplicated must stay in sync when adding another one: `StoreAttendanceRequest`, both validation arrays in `AttendanceController` (`store`/`update` and `bulkStore`), `DashboardController`'s per-cause KPI counts, the frontend `AbsenceCause` type, `AttendancePage.tsx`'s `causeLabels` map and the `<select>` options, and `StatusBadge.tsx`'s `map`.

### A responsable can correct their own mistakes — except in the caisse

Everywhere except cash, a responsable has full CRUD on their own site's records, including `update`/`destroy` on `assignments`, `entries`, and `exits` (added after initially shipping those as create-only — a responsable needs to be able to fix a typo'd name/date/department without calling the SuperAdmin). Site-scoping (`ensureSiteAccess`) is still what gates it, same as everywhere else. Deleting an `exit` record reverts the linked employee back to `actif` and clears their `exit_date` rather than leaving them incorrectly flagged as gone — treat that as the expected "undo" behavior, not a bug. The **caisse is the one deliberate exception**: a responsable can only create (`store`) a declared expense; `update`/`destroy` on `cash-transactions` and everything on `cash-accounts` stay SuperAdmin-only (see the cash section below) — don't generalize the "let responsables fix their own mistakes" pattern to cash without being asked to.

### Cash: one company-wide caisse, reproduced exactly from the reference Excel

This is deliberately **not** "one balance per site" — it mirrors `Book1.xlsx` precisely: each site sheet lists only that site's declared purchases with no balance column at all, and only the "Admin" sheet carries a single running solde/reste across everything. So:

- `cash_accounts` is a **singleton** table (`CashAccount::singleton()` = `firstOrCreate([])`, always exactly one row) — there is no per-site account.
- `cash_transactions.site_id` is **nullable**: an `expense` (a site's declared purchase) always has a site; an `entry` (a recharge) never does — it funds the shared caisse, exactly like the site-less "Entree" rows in the Excel.
- A **responsable** can only create `type=expense` rows tied to their own site, can never create/see an `entry`, never sees the `running_balance` field at all, and can never update/delete anything. A **SuperAdmin** sees everything, including the running reste, and is the only one who can record an `entry`/recharge. This is enforced server-side in `CashTransactionController` (forces `type=expense` on a responsable's `store`, hard-filters `where type=expense` on every read for a responsable — not just in the singular `/cash-transactions` endpoint but also `DashboardController` and `ReportController@cash` — and strips `running_balance` via `makeHidden()`), and in `routes/api.php` (`/cash-account` and `cash-transactions.{update,destroy}` sit under the `superadmin` middleware group). The frontend (`CashPage.tsx`) mirrors this by hiding the balance KPIs, "Reste"/"Site"/"Actions" columns, settings, and type-selector for a responsable — but the backend restrictions are what actually matter, never re-add a frontend-only version of this rule.

### Cash ledger logic (`App\Services\CashLedgerService`)

`current_balance = initial_balance + entries − expenses`, computed as a running total across **all** transactions (all sites combined) ordered by `(date, id)` — this is what makes it match the Excel's single consolidated reste rather than a per-site figure.

Because a transaction can be edited or backdated (not just appended), every write (`create`/`update`/`delete`) calls `recalculate()`, which walks every transaction on the account in date order and rewrites `running_balance` on each. All arithmetic uses `bcadd`/`bcmul` on strings to avoid float rounding drift — don't switch this to plain float math.

**A declared expense is never blocked for exceeding the balance** — `CashLedgerService::create()` used to reject one with a 422 (unless a since-removed `allow_negative_balance` flag was set); that's gone deliberately. A responsable declaring a real purchase shouldn't be stopped by the caisse not having been topped up yet — the running balance just goes negative (shown in red in the UI) until the SuperAdmin records a recharge (`entry`). Don't reintroduce a balance check on write.

`CashAccount::currentBalance()` calls `->reorder()` before `->latest(...)` — the `transactions()` relation already has its own `orderBy('date')->orderBy('id')` baked in, and Eloquent's `orderBy`/`latest` calls **stack** rather than replace each other. Without `reorder()` first, the relation's ascending order wins and you silently get the *earliest* transaction's balance instead of the latest. This bit us once already; don't drop the `reorder()` call, and be wary of the same trap anywhere else that chains ordering onto a relation that predefines its own.

### Leave extensions never overwrite history

`Leave.end_date` is mutated on extension, but a `LeaveExtension` row is created first recording `previous_end_date` → `new_end_date` and the reason — the audit trail this produces is the point, not a byproduct. Follow the same pattern (append a history row, then update the denormalized "current" field) for any similar "this changes over time but we need the trail" feature.

### Layout: fixed sidebar, independent open/close per breakpoint

`DashboardLayout.tsx`'s `<aside>` is `fixed` (not part of document flow) so it never scrolls with page content — only `<main>` scrolls. Two separate booleans drive it: `mobileOpen` (overlay drawer, closed by default, only affects `<lg`) and `desktopOpen` (persistent column, open by default, only affects `lg:` and up, shifts `<main>`'s `margin-left` in sync). One header button (`PanelLeft` icon) flips both at once — only the one matching the current breakpoint has any visible effect, so a single control works everywhere. If you add another way to open/close the sidebar, flip both booleans together the same way, not just one.

The mobile drawer has its own close (X) button in the sidebar's own header, next to the `Brand` — the topbar's toggle button sits at roughly the same x/y as the drawer when it's open, and the drawer (`z-40`, fixed) renders on top of it, so without a control inside the drawer itself there is no visible way to close it on a phone (this happened once already — don't remove the in-drawer close button on the assumption the topbar toggle is enough).

The topbar is intentionally minimal — just the sidebar toggle and the SuperAdmin's site selector (or the responsable's fixed "Site: X" label). User identity, the theme toggle, and Déconnexion live in a footer block pinned to the bottom of the sidebar instead, below the nav. Keep it that way; don't drift user/session controls back into the header. A "Contacter le support" `mailto:` link (to Hallajiyasser@gmail.com) sits above the theme/logout row in that same footer — it's a plain link (opens the user's own mail client), not something the app sends on their behalf.

### Dark mode

Class-based, not OS-media-query-based, so the in-app toggle actually works regardless of system settings: `src/index.css` redefines the variant with `@custom-variant dark (&:where(.dark, .dark *));` (Tailwind v4 syntax), and `ThemeContext` (`src/contexts/ThemeContext.tsx`) toggles the `.dark` class on `<html>` plus persists the choice to `localStorage` (falling back to system preference only when nothing is stored yet). `index.html` has a tiny inline script that applies the stored/system theme to `<html>` before React mounts, so there's no flash-of-wrong-theme on load — if you ever touch that script, keep it in sync with `getInitialTheme()` in `ThemeContext.tsx`.

Every shared `components/ui/*` primitive and every page carries `dark:` variants (added in a bulk pass, then hand-verified). When adding new UI, follow the existing pairings rather than introducing new ones ad hoc: `bg-white` → `dark:bg-slate-900` (cards) or `dark:bg-slate-800` (inputs/hover surfaces), `border-slate-200` → `dark:border-slate-800`, `text-slate-900/800/700/600/500/400` → `dark:text-slate-100/200/300/400/400/500` respectively, colored badges/KPI icon chips use `dark:bg-{color}-500/15 dark:text-{color}-400` rather than the light `-100/-600` pair. One trap to know about: a class like `hover:text-slate-700` needs its dark override written as `dark:hover:text-slate-200` (hover-scoped) — writing plain `dark:text-slate-200` next to it looks similar but applies unconditionally in dark mode instead of only on hover, silently breaking the hover affordance. This exact mistake happened once already (from a careless bulk find/replace) and was fixed in the tab-underline components and the employee detail "Retour" link — don't reintroduce it.

### Branding

The logo is `frontend/src/assets/logo.jpg` (the "YH" mark, tightly cropped — a version with excess padding renders blurry/tiny at the small sizes used in the header, so always ask for a tightly-cropped source if the logo is swapped again), rendered via the `<Brand>` component (`components/ui/Brand.tsx`) which pairs it with a bold "SOLUTIONS" wordmark. Used on the login page and the sidebar header — update both call sites (or just the shared component) together. The same file is also `frontend/public/favicon.jpg`, referenced directly by `index.html`.

### PWA: installable, works offline for real

This is a genuine installable PWA (desktop and mobile — Chrome/Edge show an install prompt, iOS supports Add to Home Screen), not just a bookmark shortcut, via `vite-plugin-pwa` (`vite.config.ts`) generating a real Workbox service worker (`generateSW` mode) plus a web manifest.

- **App shell**: fully precached (JS/CSS/HTML/icons/manifest), so the app loads and navigates even with zero connectivity.
- **Every `GET /api/*`**: `NetworkFirst` with a 4s timeout (one rule, `api-get-cache`) — prefers a live network answer and only falls back to the last cached one when the network genuinely fails (offline/slow). This used to be `StaleWhileRevalidate` for lists, which was a real bug: SWR returns the *cached* response immediately even when online, so a refetch right after a mutation (mark present/absent, edit a record...) showed the pre-mutation data — it looked like the action "did nothing" until a manual page reload picked up the revalidated cache. Don't reintroduce SWR for `/api/*` GETs for this reason; if a route ever needs instant-from-cache behavior, that has to be a deliberate, narrow exception, not the default.
- **Writes** (`POST`/`PUT`/`PATCH`/`DELETE` to `/api/*`): `NetworkOnly` + a `BackgroundSyncPlugin` per method — a mutation made while offline (declare a purchase, mark an absence, submit a leave request...) is queued in IndexedDB and replayed automatically once connectivity returns, up to 24h. This is the "enter things without a connection" requirement. Note the caveat: a queued write's `axios` promise never resolves (the request is intercepted before it reaches the network) — the UI's optimistic-looking success isn't guaranteed until the queued request actually replays, so don't build anything that assumes a mutation's response arrives immediately when offline.
- Navigation requests fall back to the cached `/index.html` shell, but `/api/*` is excluded from that fallback (`navigateFallbackDenylist`) so an API 401 while offline can't be masked by a stale "you're logged in" HTML response.
- `src/components/PwaStatus.tsx` registers the service worker (manually, via `virtual:pwa-register`) and owns the two pieces of UI a PWA needs: a persistent offline banner (`navigator.onLine` + `online`/`offline` listeners) and a brief "updating..." toast right before the page auto-reloads onto a new version. Mount it once near the app root (already done in `App.tsx`) — don't duplicate the registration elsewhere.

**Updates are automatic (`registerType: 'autoUpdate'`), not prompt-and-wait — this is deliberate, not the library default.** `'prompt'` (the more common choice) leaves a shipped fix sitting inert on every already-open tab and already-installed device until someone happens to notice a toast and click it; for an internal tool that's edited constantly, that's worse than the alternative of an occasional automatic reload. `onNeedRefresh` in `PwaStatus.tsx` calls `updateSW(true)` immediately (no button), and `onRegisteredSW` polls `registration.update()` every 30 minutes so a long-lived tab (people leave this open all day) still picks up a new version without needing to navigate. Verified end-to-end: built, registered the old service worker, rebuilt with a changed file, triggered `registration.update()` on the still-open tab, and it picked up and rendered the new build with zero manual action. Don't revert this to `'prompt'` on the assumption it's "less disruptive" — it directly caused a real bug report (a shipped fix not visible until a manual full reload).
- Icons live in `public/icons/`, generated from `src/assets/logo.jpg` by `scripts/generate-icons.mjs` (uses `sharp`, a devDependency) — standard (64/192/512) plus a separately-padded maskable 512 (OS icon shapes crop up to ~20% off each edge) plus an Apple touch icon. **Re-run `node scripts/generate-icons.mjs` whenever the logo changes** — the PNGs are checked in, not generated at build time.
- App name is "Solution Administrative" (manifest `name`/`short_name`, `index.html` `<title>`, and the Apple-specific meta tags) — keep these three in sync if it's renamed again.
- Test with `npm run build && npx vite preview` rather than `npm run dev` when checking real offline/install behavior — `devOptions.enabled: true` makes the SW active in dev too, but the production `generateSW` output is what actually ships.

### Every API response is `Cache-Control: no-store` — don't remove this

`app/Http/Middleware/PreventApiCaching.php` is appended to the whole `api` middleware group (`bootstrap/app.php`) and stamps `Cache-Control: no-store, no-cache, must-revalidate, private` on every `/api/*` response. This isn't optional hardening — without it, the **browser's own HTTP cache** (a layer beneath both axios and the service worker, keyed by URL only, not by the `Authorization` header) can serve one account's response to a *different* account that logs in afterward on the same browser. This was caught for real: `GET /api/me` came back with the previous session's role after switching accounts, which silently drove the whole UI's role-based rendering (nav items, site selector) off the wrong identity. `/api/me` also gets an explicit `NetworkOnly` rule in `vite.config.ts`'s `runtimeCaching`, registered *before* the general GET rule — Workbox's own Cache Storage ignores response `Cache-Control` headers for its own caching decision, so the backend header alone doesn't stop the service worker from caching identity too; both layers need the fix.

If you ever add a second caching layer (a CDN, a reverse proxy) in front of this API, make sure it also respects `no-store` — don't assume the two existing safeguards cover it.

### Dashboard KPI cards link to their source

Every `KpiCard` on `DashboardPage.tsx` takes a `to` prop and renders as a `<Link>` when present (see `components/ui/KpiCard.tsx`) — clicking any number on the dashboard navigates straight to the page (and, where relevant, the specific tab) that produced it, rather than just to the page's default view. Tabbed pages (`LeavesPage`, `SanctionsPage`, `MovementsPage`) read/write their active tab through `?tab=<slug>` via the `useUrlTab` hook (`hooks/useUrlTab.ts`, slug = lowercased/accent-stripped label), so a dashboard link like `/sanctions?tab=mises-a-pied` opens directly on the right tab. When adding a new KPI card or a new tabbed page, wire it the same way — a bare count with no link is the thing to avoid here, not the exception.

### Frontend structure

```
src/
  api/client.ts          axios instance + 401 handling + apiErrorMessage() helper
  contexts/               AuthContext (token + current user), SiteFilterContext (SuperAdmin's global site switcher)
  hooks/                  useSiteParams() (turns SiteFilterContext into a `{site_id}` query param), useReferenceData (sites/departments/positions)
  components/ui/          DataTable, Modal, ConfirmDialog, StatusBadge, Field (Text/Select/TextArea), EmployeeSelect (async search-select), Pagination, KpiCard, PageHeader, States (Loading/Empty)
  layouts/DashboardLayout.tsx   sidebar + topbar; menu items filtered by role; SuperAdmin gets the site switcher, responsable gets a fixed "Site: X" label
  pages/                  one file per module (PersonnelPage, AttendancePage, LeavesPage, SanctionsPage, MovementsPage, AssignmentsPage, CashPage, UsersPage, ReportsPage, SettingsPage) + EmployeeDetailPage (tabbed fiche employé)
```

All data fetching goes through TanStack Query; every list page spreads `useSiteParams()` into its query params so the SuperAdmin's site switcher transparently filters everything without each page needing its own logic (the backend trait above is what actually enforces it — the frontend param is just UX, never trust it).

Reusable form pattern: a page-level list + a `*FormModal` function component colocated in the same file (not split into separate files) for create/edit, using a local `useState` form object and a `useMutation` that POSTs/PUTs then invalidates the relevant query key. Follow this pattern for new CRUD pages rather than introducing a form library — it's kept deliberately lightweight.

`EmployeeSelect` is the "select-with-search" component spec required for choosing an employee across Congés/Sanctions/Affectations/Sorties forms — it hits `GET /employees?search=...&status=actif` live rather than loading a full list.

### Excel export: every Rapports tab, plus Caisse, respects the same site-scoping as the screen

`ReportController` has an `export*` method next to each list method (`exportAttendance`/`exportLeaves`/`exportSanctions`/`exportMovements`/`exportCash`, routed at `/reports/{module}/export`), streaming an `.xlsx` via `App\Services\ExcelExportService` (a thin wrapper around `phpoffice/phpspreadsheet`, added for this — no other Excel package is installed). Each export method reuses the *exact same* query-building method as its list counterpart (`attendanceQuery()`, `leavesQuery()`, etc. — refactored out so the two can never drift), just swapping `paginate()` for `get()` since an export must contain every matching row, not one page. This means an export is scoped by `scopeToSite()` exactly like the on-screen table: a responsable always gets only their own site (their site name is baked into the exported filename, e.g. `pointage-louta.xlsx`) no matter what `?site_id=` they pass, a SuperAdmin with no site filter gets every site (`pointage-tous-sites.xlsx`), and a SuperAdmin with a site selected in the UI's site switcher gets only that site (`pointage-ben-guerir.xlsx`) — `exportSiteLabel()` derives this filename suffix from the same `site_id` query param `scopeToSite()` already trusts (or ignores, for a responsable). Don't build an export that bypasses `scopeToSite()`/`resolveSiteId()` "for simplicity" — it must go through the identical site-scoping path as everything else, verified live with a Louta responsable passing `?site_id=99` and still only getting Louta's rows.

Every export is styled like an actual table, not bare values: `ExcelExportService::stream()` bolds the header row with a sky-blue fill (`FF87CEEB`) and puts thin borders around every cell (header + data). It also takes an optional `?callable $highlightRow` — given a row's flattened array, return `true` to fill that row yellow (`FFFFFF00`). `exportCash()` is the one caller that passes this, flagging a row as an "Entrée" (recharge) rather than a "Dépense" so it visually stands out from a site's declared purchases at a glance. No other export currently uses `$highlightRow`, but the mechanism is generic — pass a closure over whatever column distinguishes the row types you want to flag.

On the frontend, `ReportsPage.tsx`'s "Export Excel" button exports whichever tab is currently active, with the same site/date filters the table itself is using; `CashPage.tsx` has its own "Export Excel" button (next to "Nouvelle opération"/"Déclarer un achat") calling the same `/reports/cash/export` endpoint with its own filters, since Caisse is also a standalone page and not only a Rapports tab. Both go through `downloadFile()` (`api/client.ts`) — a small helper that requests with `responseType: 'blob'`, reads the real filename off the `Content-Disposition` header, and triggers a browser download via a temporary `<a download>` element. If you add another exportable list anywhere in the app, follow this exact three-part pattern (shared query builder on the controller + a `download*` frontend call + a button next to the corresponding table) rather than inventing a new export mechanism.

### What's implemented vs. what's left

Done: full schema + migrations, all models/relations, all API controllers/routes with site-scoping, seeders (4 sites, departments, positions, superadmin + 4 responsables, demo employees/attendance/leaves+extension/sanctions/movements/cash), a working frontend covering every module in the spec (Dashboard, Pointage, Congés, Sanctions, Entrées/Sorties, Affectations, Caisse, Personnel + fiche employé, Utilisateurs, Rapports, Paramètres), and Excel export (§17) on every Rapports tab plus Caisse.

Not yet done (flagged rather than half-built): PDF export, a dedicated audit-log viewer UI (the `audit_logs` table and `AuditLogger` service exist but aren't called from every mutating controller yet), per-model Laravel `Policy` classes (authorization currently lives in the `InteractsWithSites` trait + inline checks rather than `App\Policies\*` — functionally equivalent but worth splitting out if the rules grow more elaborate), and a real automated test suite.
