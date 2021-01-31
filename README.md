# musicBot

## Usage

初始化 git 子模块
```bash
git clone https://github.com/rooboots/musicBot.git
cd musicBot
git submodule init
git submodule update
```

使用 docker:
```bash
PROXY=localhost:20171 TELEGRAM_APITOKEN=1447999257:AAFcupdx7aTRDqyhN_xFl8hDINPDThOyI2I docker-compose up -d
```

使用 pm2:
```bash
yarn global add pm2
PROXY=localhost:20171 TELEGRAM_APITOKEN=1447999257:AAFcupdx7aTRDqyhN_xFl8hDINPDThOyI2I pm2 start app.js --name musicbot
```

## TODO

-[ ] 无损格式的TAG信息(metadata)补全
   -[ ] flac
   -[ ] ape
   -[ ] aac