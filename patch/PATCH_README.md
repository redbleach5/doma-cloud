# Doma Cloud — история патчей

Эта папка хранит `.patch`-файлы, которые применялись к проекту поэтапно.
**Все патчи уже влиты в `main`** на https://github.com/redbleach5/doma-cloud —
повторно применять не нужно, если только вы не форкаете старую версию.

## Порядок применения (исторический)

| Патч | Коммит в main | Что дало |
|------|---------------|----------|
| `doma-cloud-audit.patch` | `6a71830` | Security fixes, cleanup, S3 chunks, Docker hardening |
| `doma-cloud-argon2-quotas.patch` | `fd78e4b` | argon2id, учёт квот, recompute-quotas |
| `doma-cloud-tests.patch` | `a2edb0d` | 426 тестов, test infrastructure |
| — (фиксы багов из тестов) | `843fc22` | mime .ts, username case, sanitizeName, icon colors |

## Тесты (актуально)

- **25 test files**, **426 tests** — все проходят
- Запуск: `bun run test` (см. `tests/README.md` и корневой `README.md`)
- 5 багов, которые тесты изначально документировали как regression guards, **исправлены** в `843fc22`
- Осталась одна design note: роль в `getSession()` читается из БД, не из JWT (намеренно)

## Если всё же нужно применить патч на старый checkout

```bash
git apply patch/doma-cloud-tests.patch   # или другой .patch
bun install
bunx prisma generate
DATABASE_URL="file:$(pwd)/prisma/test.db" bunx prisma db push --skip-generate
bun run test
```

На macOS: `scripts/run-tests-serially.sh` использует portable `while read`
вместо `mapfile` (bash 3.2) — уже в репо.

## Troubleshooting

**`bun:test` not found** — нужен Bun, не Node: `bun run test`

**Test DB** — `prisma/test.db`, создаётся preload-скриптом; при ошибках:
`DATABASE_URL="file:$(pwd)/prisma/test.db" bunx prisma db push --skip-generate`

**Flaky tests** — не запускайте `bun test tests/` напрямую; только `bun run test`
