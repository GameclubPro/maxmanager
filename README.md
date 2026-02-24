# MAX Moderation Bot

Бот для MAX (`chat` + `channel`) с функциями:
- удаление любых ссылок (с whitelist доменов)
- лимит `3` сообщения в сутки на пользователя в чате (по `Europe/Moscow`)
- лимит `1` фото-сообщение в час на пользователя с эскалацией в `mute 3h`
- антиспам `3 сообщения / 10 сек` с эскалацией `warn -> mute 1h -> ban 24h`
- админ-команды настройки без перезапуска
- SQLite-хранилище

## Установка

```bash
npm ci
cp .env.example .env
# заполнить BOT_TOKEN
npm run build
npm start
```

## PM2

```bash
pm2 start dist/index.js --name max-moderation-bot
pm2 save
```

## Быстрые команды (локалка и VPS)

### 1) Локальный коммит + push

```bash
npm run local:push -- "Initial commit"
```

Что делает:
- `git add -A`
- `git commit -m "..."`
- `git push origin <current-branch>`

### 2) VPS pull + install + build + restart

```bash
npm run vps:deploy
```

Что делает:
- `git fetch` + `git pull --ff-only`
- `npm ci` (или `npm install`, если нет lock-файла)
- `npm run build`
- `pm2 restart max-moderation-bot` (или старт, если процесса нет)
- `pm2 save`

## Две короткие команды без npm

Один раз на машине установите команды в `/usr/local/bin`:

```bash
sudo bash scripts/install-global-commands.sh
```

После этого используйте только:

```bash
maxpush "ваш commit message"
maxdeploy
```

Важно: запускать команды нужно внутри папки git-репозитория проекта.

## Админ-команды

- `/mod_status`
- `/mod_on`
- `/mod_off`
- `/allowdomain_add <domain>`
- `/allowdomain_del <domain>`
- `/allowdomain_list`
- `/set_limit <n>`
- `/set_photo_limit <0..20>`
- `/set_spam <threshold> <windowSec>`
- `/set_logchat <chatId>`

## Разработка

```bash
npm run dev
npm test
```

## Безопасность

Токен бота храните только в `.env`.
Если токен был опубликован, его нужно немедленно ротировать через Master Bot.
