# Solution Administrative — TransWin Mining

Application de gestion RH et administrative (pointage, congés, sanctions, HSE, caisse, consommation…) pour les sites Ben Guerir, Louta, Bouchane et Mzinda.

- `backend/` — API Laravel 11 (PHP 8.2, MySQL, Sanctum)
- `frontend/` — React 19 + TypeScript + Vite (PWA)

Le détail technique (architecture, règles métier) est dans [`CLAUDE.md`](CLAUDE.md).

---

## Redéployer une nouvelle version sur le VPS (sans perte de données)

Voici les étapes à suivre en SSH sur le serveur quand une nouvelle version est poussée sur GitHub. Ce sont celles appliquées à chaque mise à jour, quand la demande est :

> Update the production version with the latest Git changes.
> IMPORTANT: Preserve all existing production data. Do not delete, reset, overwrite, or modify the existing database, ".env", uploaded files, or user data. Do not run "migrate:fresh", "db:wipe", or destructive seeders.

- Dossier de l'application : `/var/www/apps/YH-solutions`
- Base de données : `yh_solutions`
- PHP : `php8.3-fpm`

### 1. Voir ce qui arrive (ne change rien)

```bash
cd /var/www/apps/YH-solutions
git status                         # doit être vide
git fetch origin
git log --oneline HEAD..origin/main
git diff --stat HEAD origin/main
```

- S'il y a des fichiers dans `backend/database/migrations/`, il y aura une migration.
- S'il y a des fichiers dans `frontend/`, il faudra reconstruire l'interface.
- Si `git status` n'est pas vide, arrêtez-vous et vérifiez d'abord ce qui a été modifié.

### 2. Sauvegarder la base (obligatoire)

```bash
cd /var/www/apps/YH-solutions/backend
DBU=$(grep ^DB_USERNAME= .env | cut -d= -f2-)
DBP=$(grep ^DB_PASSWORD= .env | cut -d= -f2-)
B=/root/yh_solutions-backup-$(date +%Y%m%d-%H%M%S).sql.gz
MYSQL_PWD="$DBP" mysqldump -u"$DBU" --single-transaction --no-tablespaces yh_solutions | gzip > $B
chmod 600 $B; ls -la $B            # la taille ne doit pas être 0
```

### 3. Compter les données avant la mise à jour

```bash
MYSQL_PWD="$DBP" mysql -u"$DBU" yh_solutions -e "select * from (select count(*) from employees) emp, (select count(*) from attendances) pointages, (select count(*) from fuel_movements) carburant, (select count(*) from users) comptes"
```

Notez les chiffres.

### 4. Récupérer le code

```bash
cd /var/www/apps/YH-solutions && git pull --ff-only
```

Si la commande refuse, ne forcez rien.

### 5. Migrations, seulement s'il y en a

```bash
cd backend
php artisan migrate:status --pending
php artisan migrate --force
```

Avant de lancer `migrate --force`, ouvrez les nouveaux fichiers de migration et vérifiez qu'ils ne contiennent pas `drop`, `truncate` ou `delete`.

### 6. Rafraîchir le backend

```bash
php artisan optimize:clear
php artisan event:cache
systemctl reload php8.3-fpm
```

### 7. Reconstruire l'interface, seulement si `frontend/` a changé

```bash
cd ../frontend
npm install          # seulement si package.json ou package-lock.json a changé
npm run build
```

### 8. Vérifier

- Relancez la commande de l'étape 3. Les chiffres doivent être identiques, ou plus grands si des gens ont saisi des données entre-temps, mais jamais plus petits.
- Ouvrez le site, faites Ctrl+F5 et testez la nouveauté.
- En cas d'erreur, regardez le journal : `tail -50 /var/www/apps/YH-solutions/backend/storage/logs/laravel.log`.

### ⛔ À ne JAMAIS lancer en production

- `migrate:fresh`, `migrate:refresh`, `migrate:reset`
- `db:wipe`, `db:seed`
- `git reset --hard`, `git clean`

Ne modifiez pas non plus `.env` ni `backend/storage/`.

### En dernier recours : restaurer la sauvegarde

À faire seulement si des données ont vraiment été perdues. Tout ce qui a été saisi après la sauvegarde sera effacé.

```bash
gunzip < /root/yh_solutions-backup-XXXX.sql.gz | MYSQL_PWD="$DBP" mysql -u"$DBU" yh_solutions
```
