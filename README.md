# MAX Moderation Bot

Бот для MAX (`chat` + `channel`) с функциями:
- удаление любых ссылок (с whitelist доменов)
- лимит `3` сообщения в сутки на пользователя в чате (по `Europe/Moscow`)
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

## Админ-команды

- `/mod_status`
- `/mod_on`
- `/mod_off`
- `/allowdomain_add <domain>`
- `/allowdomain_del <domain>`
- `/allowdomain_list`
- `/set_limit <n>`
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
