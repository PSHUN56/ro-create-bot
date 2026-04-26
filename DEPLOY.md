# GitHub и WispByte

## Что создать

Для проекта лучше использовать такие названия:

- бот: `Ro Create Bot`
- сервер: `Ro Create`
- репозиторий: `ro-create-bot`

## GitHub

1. Создай новый репозиторий `ro-create-bot`.
2. Не добавляй туда `.gitignore` и `README`, они уже есть в проекте.
3. После создания репозитория выполни в папке проекта:

```bash
git init
git add .
git commit -m "Initial Ro Create bot"
git branch -M main
git remote add origin https://github.com/ТВОЙ_ЛОГИН/ro-create-bot.git
git push -u origin main
```

## WispByte

По актуальным материалам WispByte для Discord-ботов нужен готовый код проекта, выбранный стартовый файл и переменные окружения в панели:

- [WispByte Discord bot guide](https://wispbyte.com/blog/discord-bot-hosting)
- [WispByte Getting Started](https://wispbyte.com/kb/getting-started)

## Что вставить в переменные окружения

```env
DISCORD_TOKEN=токен_бота
CLIENT_ID=id_приложения
GUILD_ID=id_тестового_сервера
ANNOUNCEMENT_COST=2000
```

## Какой запуск указать

- install command: `npm install`
- start command: `npm start`

Если в панели нет отдельного поля для install command, обычно достаточно, чтобы был `package.json`, а потом вручную нажать установку зависимостей или выполнить `npm install` в консоли панели.

## Что важно перед деплоем

- Нужен Node.js 20+.
- У бота в Discord должны быть права на роли, каналы, сообщения и slash-команды.
- Сейчас локальная установка зависимостей уперлась в нехватку места на диске, так что лучше сначала освободить место.
