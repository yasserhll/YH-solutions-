# Solution Administrative — TransWin Mining

Application de gestion RH et administrative (pointage, congés, sanctions, HSE, caisse, consommation…) pour les sites Ben Guerir, Louta, Bouchane et Mzinda.

- `backend/` — API Laravel 11 (PHP 8.2, MySQL, Sanctum)
- `frontend/` — React 19 + TypeScript + Vite (PWA)

Le détail technique (architecture, règles métier) est dans [`CLAUDE.md`](CLAUDE.md).

---

## Redéployer une nouvelle version sur le VPS (sans perte de données)

C'est la procédure suivie à chaque fois que la demande est :

> Update the production version with the latest Git changes.
> IMPORTANT: Preserve all existing production data. Do not delete, reset, overwrite, or modify the existing database, ".env", uploaded files, or user data. Do not run "migrate:fresh", "db:wipe", or destructive seeders.

### Ce qui est interdit sur le serveur

Ces commandes effacent ou écrasent les données. On ne les lance **jamais** en production :

| Interdit | Pourquoi |
|---|---|
| `php artisan migrate:fresh`, `migrate:refresh`, `migrate:reset`, `migrate:rollback` | suppriment des tables et leurs données |
| `php artisan db:wipe`, `php artisan db:seed`, `migrate --seed` | vident la base ou y injectent les données de démo |
| `git reset --hard`, `git clean -fd`, `git checkout -- .` | peuvent écraser ou supprimer des fichiers du serveur |
| modifier, remplacer ou recopier `backend/.env` | contient les accès à la base et la clé de l'application |
| supprimer ou remplacer `backend/storage/` | contient les fichiers importés et les logs |

La seule commande de base de données autorisée est **`php artisan migrate --force`**. Elle n'ajoute que les migrations qui n'ont pas encore été exécutées : nouvelles tables, nouvelles colonnes.

`backend/.env`, `backend/vendor/`, `backend/storage/` et `frontend/dist/` ne sont pas suivis par Git, donc un `git pull` ne les touche pas.

### Variables utilisées ci-dessous

Adapter ces chemins au serveur une fois pour toutes :

```bash
APP_DIR=/var/www/globalisation-app   # dossier du dépôt Git sur le VPS
PHP_FPM=php8.2-fpm                   # nom du service PHP-FPM (voir: systemctl list-units | grep fpm)
WEB_USER=www-data                    # utilisateur du serveur web
```

### Étape 1 — Se connecter et vérifier l'état du serveur

```bash
ssh utilisateur@ip-du-vps
cd $APP_DIR
git status            # doit être "working tree clean"
git log --oneline -1  # noter ce commit : c'est la version de retour arrière
```

Si `git status` montre des fichiers modifiés **sur le serveur**, on s'arrête : on regarde la modification avec `git diff` et on décide quoi faire. On ne l'écrase pas.

### Étape 2 — Sauvegarder avant de toucher à quoi que ce soit

```bash
mkdir -p ~/backups
STAMP=$(date +%Y%m%d-%H%M)

# Base de données (les accès sont lus dans le .env, sans le modifier)
DB_NAME=$(grep '^DB_DATABASE=' backend/.env | cut -d= -f2)
DB_USER=$(grep '^DB_USERNAME=' backend/.env | cut -d= -f2)
mysqldump --single-transaction --routines -u "$DB_USER" -p "$DB_NAME" > ~/backups/db-$STAMP.sql

# .env et fichiers importés
cp backend/.env ~/backups/env-$STAMP
tar -czf ~/backups/storage-$STAMP.tar.gz -C backend storage/app

ls -lh ~/backups | tail -3   # vérifier que le dump n'est pas vide
```

### Étape 3 — Mettre l'application en maintenance

```bash
cd $APP_DIR/backend
php artisan down --retry=60
```

### Étape 4 — Récupérer la nouvelle version

```bash
cd $APP_DIR
git fetch origin
git log --oneline HEAD..origin/main   # liste des nouveaux commits
git pull --ff-only origin main
```

`--ff-only` refuse la mise à jour plutôt que de créer une fusion si le serveur a divergé. Dans ce cas, on s'arrête et on regarde pourquoi.

### Étape 5 — Backend : dépendances, migrations, caches

```bash
cd $APP_DIR/backend
composer install --no-dev --optimize-autoloader --no-interaction

php artisan migrate:status        # voir les migrations "Pending"
php artisan migrate --force       # n'ajoute que les migrations manquantes

php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache

[ -L public/storage ] || php artisan storage:link
sudo chown -R $WEB_USER:$WEB_USER storage bootstrap/cache
```

### Étape 6 — Frontend : reconstruire

```bash
cd $APP_DIR/frontend
npm ci
npm run build      # produit frontend/dist, servi par nginx
```

Si `npm run build` échoue, l'ancien `dist/` peut être incomplet : on corrige ou on revient en arrière (étape 9) avant de remettre en ligne.

### Étape 7 — Redémarrer les services et remettre en ligne

```bash
sudo systemctl reload $PHP_FPM    # vide l'OPcache : le nouveau code PHP est pris en compte
cd $APP_DIR/backend
php artisan queue:restart         # sans effet s'il n'y a pas de worker
php artisan up
```

### Étape 8 — Vérifier

```bash
cd $APP_DIR/backend
php artisan migrate:status | tail -5          # plus aucune migration "Pending"
tail -n 50 storage/logs/laravel.log            # pas de nouvelle erreur
curl -s -o /dev/null -w "%{http_code}\n" https://votre-domaine/api/me   # 401 attendu (non connecté), pas 500
```

Puis, dans le navigateur :
1. Ouvrir l'application, cliquer sur **RECHARGER** si la bannière « Une nouvelle version est disponible » apparaît.
2. Se connecter et vérifier que les données sont toujours là (personnel, pointage, caisse, consommation…).
3. Tester la fonctionnalité qui vient d'être livrée.

Si la livraison touche la Consommation : `php artisan consommation:diagnostic` (lecture seule) contrôle les extensions PHP, les limites d'upload et les données par site.

### Étape 9 — En cas de problème : revenir en arrière

```bash
cd $APP_DIR
php backend/artisan down
git checkout <commit-noté-à-l-étape-1>
cd backend && composer install --no-dev --optimize-autoloader --no-interaction && php artisan optimize:clear && php artisan config:cache && php artisan route:cache && php artisan view:cache
cd ../frontend && npm ci && npm run build
sudo systemctl reload $PHP_FPM
php ../backend/artisan up
```

Ne pas annuler les migrations avec `migrate:rollback` : les colonnes et tables ajoutées n'empêchent pas l'ancienne version de fonctionner. Ne restaurer la base depuis `~/backups/db-<date>.sql` qu'en dernier recours, après décision explicite, car toute saisie faite depuis la sauvegarde serait perdue.

Une fois le problème corrigé et poussé sur GitHub, revenir sur la branche avec `git checkout main`, puis refaire la procédure depuis l'étape 4.
