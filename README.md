# musicBot

## Usage
使用docker:
```bash
PROXY=localhost:20171 TELEGRAM_APITOKEN=1447999257:AAFcupdx7aTRDqyhN_xFl8hDINPDThOyI2I docker-compose up -d
```

使用pm2:
```bash
yarn global add pm2
PROXY=localhost:20171 TELEGRAM_APITOKEN=1447999257:AAFcupdx7aTRDqyhN_xFl8hDINPDThOyI2I pm2 start app.js --name musicbot
```