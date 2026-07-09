# Doma — семейная библиотека

Тёплая семейная библиотека на современном стеке (Next.js 16 + TypeScript + Tailwind 4 + shadcn/ui).
Хранит файлы локально на вашем мини-ПК, доступ через браузер (PWA) или WebDAV-клиенты.

## Возможности

- **Многопользовательские аккаунты с квотами** — у каждого члена семьи своя учётка и личное место.
- **Первый пользователь — администратор** с полным доступом и настраиваемой квотой (по умолчанию 3 ТБ).
- **Drag&drop загрузка** с прогрессом по каждому файлу.
- **Прокачанный предпросмотр**: изображения (с зумом), видео (HTML5 player, range-запросы), аудио (тёплый плеер), PDF, текст, код, Markdown.
- **Контекстные меню** — долгое нажатие на файл в мобильном → меню действий.
- **Расшаривание по ссылке** — с паролем, сроком жизни, лимитом просмотров.
- **Корзина** — soft delete с восстановлением; автотип-удаление через 30 дней.
- **PWA** — устанавливается на телефон, оффлайн-шелл, иконка на главном экране.
- **WebDAV-совместимый** доступ к файлам (через отдельный мини-сервис, опционально).
- **Тёплый интерфейс** — янтарно-кремовая палитра, мягкие тени, плавные анимации, тёмная/светлая темы.
- **Range-запросы** для видео — мгновенная перемотка без полной загрузки.

## Технологии

| Слой | Стек |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui (New York) |
| State | Zustand (client), TanStack Query v5 (server) |
| Backend | Next.js API Routes (Route Handlers) |
| Storage | Локальная FS (по умолчанию) или MinIO/S3 (через переменную окружения) |
| DB | SQLite + Prisma ORM |
| Auth | Кастомный JWT в httpOnly cookie (jose + bcryptjs) |
| Reverse proxy | Caddy (auto self-signed HTTPS для локалки) |
| Контейнер | Docker Compose |

## Установка на мини-ПК

### 1. Подготовьте диски (BTRFS RAID1)

Предполагается, что у вас два внешних HDD по 3 ТБ. Все данные будут зеркалироваться.

```bash
# Найдите ваши диски (например /dev/sdb и /dev/sdc)
lsblk

# Создайте BTRFS RAID1 на двух дисках
sudo mkfs.btrfs -m raid1 -d raid1 -L doma-raid /dev/sdb /dev/sdc

# Создайте точку монтирования
sudo mkdir -p /mnt/raid

# Смонтируйте
sudo mount /dev/sdb /mnt/raid

# Автомонтирование при загрузке — узнайте UUID
sudo btrfs filesystem show /mnt/raid
# Добавьте в /etc/fstab:
#   UUID=<uuid>  /mnt/raid  btrfs  defaults,compress=zstd:9  0  0

# Включите сжатие на лету (экономит место для фото/видео/документов)
sudo btrfs property set /mnt/raid compression zstd

# Создайте папку под файлы Doma
sudo mkdir -p /mnt/raid/doma
sudo chown -R $USER:$USER /mnt/raid/doma
```

### 2. Установите Docker

```bash
# Ubuntu / Debian
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Выйдите и зайдите снова, чтобы группа применилась
```

### 3. Склонируйте проект и настройте

```bash
git clone <your-repo-url> doma-cloud
cd doma-cloud

# Скопируйте и отредактируйте окружение
cp .env.example .env
nano .env
# Обязательно:
#   DOMA_JWT_SECRET — сгенерируйте через `openssl rand -base64 48`
#   STORAGE_LOCAL_ROOT=/mnt/raid/doma
#   NEXT_PUBLIC_APP_URL=http://mini-pc.local  (или IP мини-ПК)

# Запустите
docker compose up -d --build
```

### 4. Откройте в браузере

На любом устройстве в домашней сети зайдите на `http://<IP-мини-ПК>` или `http://mini-pc.local`.

Первый пользователь, которого вы создадите, станет администратором. Квота
администратора и квота новых пользователей настраивается в админ-панели
→ Система (по умолчанию 3 ТБ для админа и 50 ГБ для обычных пользователей).

### 5. Добавьте остальных членов семьи

После входа администратора — на странице входа есть форма регистрации. Каждый может зарегистрироваться сам (по умолчанию 50 ГБ квоты), либо админ может изменить квоту в БД через `sqlite3`.

### 6. Установите PWA на телефон

- **iPhone (Safari)**: откройте облако → Поделиться → «На экран Домой».
- **Android (Chrome)**: откройте облако → меню → «Установить приложение».

## Доступ из любой сети (позже)

Сейчас облако доступно только из домашней сети. Чтобы открыть его извне с HTTPS в РФ:

1. **Tailscale** — установите на мини-ПК и на телефоны семьи:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```
   Теперь облако доступно по Tailscale IP мини-ПК (например `100.x.x.x`).

2. **Tailscale Funnel** — для публичного HTTPS без открытия портов:
   ```bash
   sudo tailscale funnel 80
   ```
   Получите адрес вида `https://mini-pc.ts.net` — работает в РФ, бесплатный сертификат.

3. **Альтернатива: Caddy + Let's Encrypt** — если у вас есть домен и DDNS.

## WebDAV-доступ — нативные файловые менеджеры

Doma включает полноценный WebDAV-сервер. Это позволяет подключать облако
напрямую к файловым менеджерам на телефоне и компьютере — файлы видны как
обычная папка, можно копировать/переименовывать/удалять без браузера.

### Подключение

- **URL**: `http://<IP-мини-ПК>/dav/`  (например `http://mini-pc.local/dav/`)
- **Логин**: ваш логин Doma (например `papa`)
- **Пароль**: ваш пароль Doma

WebDAV работает по HTTP Basic Auth. Каждый член семьи подключается под своей
учёткой — видит только свои файлы.

### iPhone / iPad

**Documents by Readdle** (бесплатно, рекомендуется):
1. Установите Documents из App Store
2. Откройте → вкладка «Services» → «Add account» → «WebDAV»
3. URL: `http://mini-pc.local/dav/`
4. Логин/пароль — ваши
5. Готово — файлы Doma видны как папка, можно открывать фото/видео/документы напрямую

**FE File Explorer** (бесплатная версия):
1. Установите FE File Explorer
2. + → WebDAV
3. Те же параметры

### Android

**CX Проводник** (бесплатно):
1. Установите CX Проводник из Google Play
2. Меню → «Сеть» → «WebDAV»
3. URL: `http://mini-pc.local/dav/`
4. Логин/пароль — ваши

**Solid Explorer** (платный, trial 14 дней):
1. Меню → «Новое подключение» → «WebDAV»
2. Те же параметры

### Windows

**Проводник (Map Network Drive)** — нативно:
1. Откройте «Этот компьютер»
2. Меню → «Подключить сетевой диск»
3. Папка: `http://mini-pc.local/dav/`
4. Галка «Использовать другие учётные данные»
5. Введите логин/пароль Doma

Если Windows ругается на HTTP (нужен HTTPS) — используйте RaiDrive:
1. Установите RaiDrive (бесплатно)
2. Add → NAS → WebDAV
3. URL: `http://mini-pc.local/dav/`

### macOS

**Finder → Connect to Server** (⌘K):
1. Откройте Finder → ⌘K
2. Адрес: `http://mini-pc.local/dav/`
3. Введите логин/пароль Doma

### Что поддерживается

| Метод | Описание |
|-------|----------|
| PROPFIND | Метаданные файла/папки, листинг (Depth: 0 и 1) |
| GET / HEAD | Скачивание с Range-запросами (мгновенная перемотка видео) |
| PUT | Загрузка файлов (стримом, без буферизации в память) |
| MKCOL | Создание папок |
| DELETE | Удаление (soft delete → корзина, восстанимо) |
| MOVE | Переименование/перемещение |
| OPTIONS | Discovery (DAV: 1, 2) |

Файлы, загруженные через WebDAV, сразу видны в веб-интерфейсе и наоборот —
единая файловая система.

## Бэкапы

```bash
# Снимок BTRFS (мгновенный, без даунтайма)
sudo btrfs subvolume snapshot -r /mnt/raid/doma /mnt/raid/doma-snapshots/$(date +%Y%m%d)

# Можно настроить cron на ежедневный снимок + удаление старых
```

SQLite-база лежит в Docker volume `doma-db` — периодически делайте бэкап
через `sqlite3` (создаёт текстовый дамп схемы + данных, восстанавливается
на любой версии SQLite):

```bash
# Бэкап (можно запускать на ходу — WAL mode не блокирует чтение):
docker compose exec doma sh -c 'sqlite3 /app/db/doma.db .dump' > doma-backup-$(date +%Y%m%d).sql

# Восстановление:
docker compose cp doma-backup-YYYYMMDD.sql doma:/tmp/restore.sql
docker compose exec doma sh -c 'sqlite3 /app/db/doma.db < /tmp/restore.sql'
```

Альтернатива — просто скопировать файлы `doma.db` + `doma.db-wal` + `doma.db-shm`
из volume, пока контейнер остановлен или в момент между транзакциями.

## Автоочистка корзины

Настройка `trashRetentionDays` (в админ-панели → Система) определяет, через
сколько дней файлы в корзине удаляются навсегда. Сама очистка запускается
по cron — endpoint `/api/cron/trash-cleanup`:

```bash
# Добавьте в crontab на мини-ПК (каждую ночь в 3:00):
0 3 * * * curl -fsS -X POST http://localhost:3000/api/cron/trash-cleanup \
  -H "X-Cron-Secret: $CRON_SECRET" >> /var/log/doma-cleanup.log 2>&1
```

`CRON_SECRET` берётся из `.env` — без него endpoint вернёт 503 (защита от
внешних вызовов). Если `trashRetentionDays = 0`, ничего не удаляется.

## Безопасность

- **JWT-секрет** — в production приложение отказывается запускаться без `DOMA_JWT_SECRET` (минимум 32 символа). Сгенерируйте: `openssl rand -base64 48`.
- **Rate limiting** — login (10/мин), регистрация (5/мин), проверка пароля share (20/мин) на IP. Брутфорс блокируется.
- **Share-пароли** — проверяются через bcrypt на каждом доступе; cookie `doma_sv_*` (24ч) позволяет media Range-запросам не пересылать пароль.
- **oneTimeUse** — после первого успешного доступа share удаляется.
- **Счётчик просмотров** — инкрементируется 1 раз за сессию (24ч cookie), не на каждый Range-запрос.
- **WebDAV** — Basic Auth; для доступа извне используйте HTTPS (Tailscale Funnel или Caddy с Let's Encrypt).
- **Удаление пользователей** — нельзя удалить последнего админа или самого себя.

## Структура проекта

```
src/
├── app/
│   ├── api/                    # API routes
│   │   ├── auth/               # /register, /login, /logout
│   │   ├── files/              # /list, /upload, /upload-chunk, /mkdir, /download/[id], /[id]
│   │   ├── me                  # текущий пользователь
│   │   ├── share/[token]       # публичная проверка ссылки
│   │   └── setup/status        # нужен ли initial setup
│   ├── s/[token]/              # публичная страница расшаренного файла
│   ├── page.tsx                # серверный компонент: setup/login/cloud
│   └── layout.tsx              # корневой layout + провайдеры
├── components/
│   ├── cloud/                  # все компоненты облака
│   │   ├── cloud-app.tsx       # главный клиентский оркестратор
│   │   ├── file-browser.tsx    # браузер файлов
│   │   ├── file-grid.tsx       # сетка
│   │   ├── file-list.tsx       # список
│   │   ├── file-context-menu.tsx  # контекстное меню (long-press на мобиле)
│   │   ├── file-preview-dialog.tsx  # модалка предпросмотра
│   │   ├── file-preview-body.tsx    # универсальный просмотрщик
│   │   ├── share-dialog.tsx    # диалог создания ссылки
│   │   ├── upload-dropzone.tsx # drag&drop зона
│   │   ├── upload-overlay.tsx  # прогресс с пламенем
│   │   ├── atmosphere/         # ламповый уют (пылинки, сезоны, капли, свечение)
│   │   └── ...
│   └── ui/                     # shadcn/ui компоненты
└── lib/
    ├── auth/session.ts         # JWT-сессии
    ├── cloud/
    │   ├── api.ts              # типизированный клиент API (+ chunked upload)
    │   ├── mime.ts             # категоризация файлов
    │   ├── tree.ts             # операции с деревом файлов
    │   ├── store.ts            # Zustand store
    │   └── format.ts           # форматирование размеров/дат
    └── storage/
        ├── index.ts            # LocalFileStorage + фабрика (стриминг на диск)
        └── storage-s3.ts       # S3/MinIO адаптер

mini-services/
└── webdav/                     # WebDAV-сервер (Bun, порт 3001)
    ├── package.json
    └── index.ts                # PROPFIND/GET/PUT/MKCOL/DELETE/MOVE

docker-compose.yml              # doma + webdav + caddy
Dockerfile                      # multi-stage standalone build
Caddyfile.prod                  # роутинг: /dav/* → webdav, /* → doma
.env.example                    # шаблон конфигурации
```

## Дорожная карта

- [x] WebDAV-эндпоинт для нативных файловых менеджеров ✅
- [x] Стриминг загрузок без буферизации в память (chunked upload) ✅
- [x] Ламповый UI с тёплой атмосферой ✅
- [ ] Автозагрузка фото с камеры (Background Fetch API)
- [ ] Версии файлов (история изменений)
- [ ] Полнотекстовый поиск (Meilisearch)
- [ ] Расшаривание папок (не только файлов)
- [ ] 2FA для администратора
- [ ] Поле дня рождения в профиле + именинный режим
- [ ] Квоты через UI администратора

## Лицензия

Personal / family use.
