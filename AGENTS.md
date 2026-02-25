# AGENTS.md

## Массовое добавление участников в аналогичные чаты MAX

Этот репозиторий поддерживает **один основной способ** добавления участников:
- `npm run members:add -- ...`
- Скрипт: `scripts/add-chat-members-2026.js`

Другие подходы для массового добавления не используются.

## Обязательные условия

- В `.env` задан `BOT_TOKEN`.
- Бот является админом в целевом чате и имеет `add_remove_members`.
- Есть файл источника ID (`.json` с полем `ids` или `.txt`).

## Стандартная рабочая схема (как в текущих прогонах)

1. Подготовить файл источника участников, например:
- `data/official_max_member_ids.json`

2. Запускать приглашение пачками по 400 участников:
- `--start 0 --count 400 --invite-batch-size 10`
- затем `--start 400 --count 400 --invite-batch-size 10`
- затем `--start 800 ...` и так далее до конца списка.

3. После каждого запуска использовать файлы результата:
- `data/add_*_result.json`
- `data/still_missing_*.txt`

4. Для повторной попытки по недобавленным запускать тот же скрипт с `still_missing` файлом как `--source-file`.

## Базовые команды

```bash
# Первая пачка
npm run members:add -- \
  --source-file data/SOURCE_MEMBER_IDS.json \
  --target-chat-id -12345678901234 \
  --start 0 \
  --count 400 \
  --invite-batch-size 10

# Следующая пачка
npm run members:add -- \
  --source-file data/SOURCE_MEMBER_IDS.json \
  --target-chat-id -12345678901234 \
  --start 400 \
  --count 400 \
  --invite-batch-size 10
```

## Правило поддержки

Если требуется массовое добавление в новый аналогичный чат, использовать только эту схему.
