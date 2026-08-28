# Наша история

Семейный архив на своём компьютере: фото и файлы на диске, доступ из браузера (PWA).

Репозиторий по-прежнему называется `doma-cloud` — это только техническое имя.

**Стек:** Next.js 16 · Bun · SQLite · локальная FS.

---

## Возможности

- Аккаунты с квотами; первый пользователь — администратор
- Загрузка drag&drop, предпросмотр (фото, видео, аудио, PDF, текст)
- Шаринг по ссылке (пароль, срок, лимит просмотров)
- Корзина с восстановлением; шаринг папок между членами семьи
- PWA на телефон

---

## Быстрый старт

Нужен [Bun](https://bun.sh).

```bash
git clone https://github.com/redbleach5/doma-cloud.git
cd doma-cloud
cp .env.example .env          # задайте DOMA_JWT_SECRET и CRON_SECRET
bun install
bun run db:generate && bun run db:push
bun run dev                   # http://localhost:3000
```

С телефона в той же Wi‑Fi: адрес `Network:` из вывода `bun run dev`
(текущий LAN-IP подхватывается сам при старте; после смены DHCP — просто
перезапустите dev).

Первый зарегистрированный пользователь становится админом. PWA: Safari → «На экран Домой» / Chrome → «Установить приложение».

### Данные на диске

В `.env`:

| Переменная | Смысл |
|------------|--------|
| `STORAGE_LOCAL_ROOT` | Папка с файлами пользователей |
| `DATABASE_URL` | Путь к SQLite (`file:…`) |

Чтобы переносить диск целиком, держите БД рядом с файлами:

```
/mnt/raid/doma/                 ← STORAGE_LOCAL_ROOT
  .doma/db/doma.db              ← DATABASE_URL=file:/mnt/raid/doma/.doma/db/doma.db
  …ваши файлы…
```

На Windows то же самое выглядит так:

```
D:\doma\                        ← STORAGE_LOCAL_ROOT=D:\doma
  .doma\db\doma.db              ← DATABASE_URL=file:D:/doma/.doma/db/doma.db
  users\<userId>\files\…        ← файлы каждого пользователя — только в его папке
```

Файлы каждого пользователя лежат строго в своей директории
`users/<userId>/files/<fileId>/<имя>` — сбой не может «смешать» данные разных
людей. Полезные команды обслуживания:

```bash
bun run storage:verify          # сверка БД ↔ диск (потерянные/чужие файлы)
bun run storage:migrate-keys    # перенос старых ключей в новую структуру (dry-run)
bun run storage:migrate-keys -- --apply   # выполнить перенос
```

Каталог `.doma` скрыт в UI. Перед отключением диска остановите процесс — иначе WAL SQLite может повредиться.

---

## Production (сервис + бэкапы)

Перед первым стартом:

1. Секреты в `.env`: `openssl rand -base64 48` → `DOMA_JWT_SECRET`, `openssl rand -hex 32` → `CRON_SECRET`
2. Абсолютные пути `STORAGE_LOCAL_ROOT` и `DATABASE_URL` на постоянном диске
3. HTTPS: `DOMA_INSECURE_COOKIE=0` за reverse proxy (`Caddyfile`); для plain HTTP в LAN оставьте `1`
4. Сборка: `bun run build`

### Установка автозапуска

**macOS (launchd)** — приложение + бэкап в 03:15 + очистка 3×/сутки:

```bash
bun run build
bun run prod:install-launchd
bun run prod:health
```

**Linux (systemd)** — то же (`--user` по умолчанию без sudo; `--system` для `/etc/systemd`):

```bash
bun run build
bun run prod:install-systemd          # или: bash scripts/prod/install-systemd.sh --system
bun run prod:health
```

Снять сервис: `bun run prod:uninstall-launchd` / `bun run prod:uninstall-systemd`.

Ручной старт без unit: `bun run start` (wrapper с `.env`: `bash scripts/prod/run-start.sh`).

**Windows (Планировщик заданий)** — приложение при входе + бэкап в 03:15 +
очистка каждые 8 часов:

```powershell
bun run build
bun run prod:install-tasks-win
bun run prod:health-win
```

Снять задачи: `bun run prod:uninstall-tasks-win`. Ручной старт:
`bun run start` (wrapper с `.env`: `powershell -File scripts\prod\run-start.ps1`).

### Health / cron / бэкап

| Команда | Что делает |
|---------|------------|
| `bun run prod:health` / `prod:health-win` | `GET /api/health` (процесс + SQLite) |
| `bun run prod:cron` / `prod:cron-win` | trash / uploads / share cleanup |
| `bun run prod:backup` / `prod:backup-win` | online-consistent копия SQLite → `../doma-backups/` |
| `bun run prod:backup -- --with-files` | то же + копия всего `STORAGE_LOCAL_ROOT` (`rsync` / `robocopy`) |
| `bun run prod:restore -- <dir> --dry-run` | проверка бэкапа без записи |
| `bun run prod:smoke-ops` | локальный drill на temp DB |

По умолчанию бэкап **не** копирует фото (они могут весить сотни ГБ). Держите
`STORAGE_LOCAL_ROOT` на диске, который уже бэкапится (Time Machine / rsync на
второй диск), или периодически гоняйте `--with-files`.
Каталог бэкапов: `DOMA_BACKUP_DIR` (default `<repo>/../doma-backups`), retention
`DOMA_BACKUP_KEEP` (default 7).

Шаблоны: [`deploy/launchd/`](deploy/launchd/), [`deploy/systemd/`](deploy/systemd/).

### HTTPS / LAN

По желанию: `Caddyfile` проксирует `:80` → приложение `:3000`. Снаружи сети — Tailscale / Funnel или свой домен. За proxy: `TRUSTED_PROXY_HOPS=1`.

---

## Авария / перенос диска

### 1. Учебный restore (данные не трогаем)

```bash
bun run prod:backup
bun run prod:restore -- "$(ls -1d ../doma-backups/backup-* | sort | tail -1)" --dry-run
# или полный smoke без вашей БД:
bun run prod:smoke-ops
```

### 2. Диск отвалился / БД повреждена

1. Остановить сервис (`prod:uninstall-launchd` временно *или* `launchctl bootout gui/$(id -u)/com.doma.cloud` / `systemctl stop doma-cloud`)
2. Выбрать бэкап: `ls ../doma-backups`
3. `bun run prod:restore -- ../doma-backups/backup-YYYYMMDD-HHMMSS`
4. Если в бэкапе были файлы: добавьте `--with-files`
5. Сверить `backup.env` с `.env` (пути и секреты)
6. Запустить сервис снова → `bun run prod:health` → войти админом

### 3. Переезд на другой диск / NAS

1. Остановить Doma
2. Скопировать **целиком** дерево данных (БД + файлы), например:
   `rsync -aH --info=progress2 /old/doma/ /new/doma/`
3. В `.env` прописать новые абсолютные пути `STORAGE_LOCAL_ROOT` и `DATABASE_URL`
4. `bun run build` на новой машине (если переносите и код) → `prod:install-*` → `prod:health`

Перед любым отключением тома — **stop сервиса**, иначе SQLite WAL может не дописаться.

---

## Тесты

```bash
bun run test              # все (serial runner)
bun run test:unit
bun run test:integration
bun run typecheck
bun run build
bun run prod:smoke-ops    # backup/restore drill
```

Подробнее — `tests/README.md`. Не запускайте голый `bun test` по всей папке.

---

## Безопасность (кратко)

- Production требует `DOMA_JWT_SECRET` (≥ 32 символов) и реальный `CRON_SECRET`
- За reverse proxy: `TRUSTED_PROXY_HOPS=1` (см. `.env.example`)
- Rate limit на login / регистрацию / пароль share
- Share-пароли — argon2id
- Каталог `doma-backups` содержит `backup.env` с секретами — не кладите его в публичный share

---

## Ограничения деплоя

| Конфиг | Ограничение |
|--------|-------------|
| Несколько инстансов | Rate limit in-memory; нужен один процесс |
| Смена `storageLocalRoot` в админке | Файлы на старом диске не переносятся автоматически |

---

## Структура

```
src/app/api/          # HTTP API (+ /api/health)
src/components/cloud/ # UI
src/lib/              # auth, storage, дерево файлов
prisma/               # схема
scripts/prod/         # backup, restore, cron, install units
deploy/               # launchd + systemd шаблоны
Caddyfile             # опциональный reverse proxy
```

---

## Дорожная карта

- [ ] Автозагрузка фото с камеры
- [ ] Версии файлов
- [ ] Полнотекстовый поиск
- [ ] 2FA для админа
- [ ] Мультиселект и массовые операции
- [ ] CI на GitHub
- [ ] Админ: квоты / orphan / статус cron

---

## Лицензия

Personal / family use.
