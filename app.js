const token = '1447999257:AAFcupdx7aTRDqyhN_xFl8hDINPDThOyI2I';
const pageSize = 10;

const {
    cloudsearch,
    song_url
} = require('./NeteaseCloudMusicApi/main')
const TelegramBot = require('node-telegram-bot-api')
const tunnel = require('tunnel')
const request = require('request')
const match = require('./match')

const tunnelingAgent = tunnel.httpsOverHttp({
    proxy: {
        host: 'localhost',
        port: 20171
    }
});

const bot = new TelegramBot(token, {
    polling: true,
    request: {
        agent: tunnelingAgent
    }
});

let sessions = {}

function sessionMaxPage(session) {
    return Math.floor(session.count / pageSize) - (session.count % pageSize === 0 ? 1 : 0)
}

function songTitle(song, sep = "/") {
    const name = song.name,
        artists = song.ar ? song.ar.map(x => x.name).join(",") : ""
    return `${name}${sep}${artists}`
}

function makeMatrix(session) {
    const l = session.page * pageSize
    let r = l + pageSize - 1
    if (l > session.count) {
        return null
    }
    r >= session.count && (r = session.count - 1)
    let matrix = []
    for (let i = l; i <= r; i++) {

        matrix.push([{
            text: songTitle(session.songs[i]),
            callback_data: `${session.id}/${i}`
        }])
    }
    const controller = []
    if (session.page > 0) {
        controller.push({
            text: "上一页",
            callback_data: `${session.id}/lastPage`
        })
    }
    controller.push({
        text: `${session.page + 1} / ${sessionMaxPage(session) + 1}`,
        callback_data: `#`
    })
    if (l + pageSize - 1 < session.count) {
        controller.push({
            text: "下一页",
            callback_data: `${session.id}/nextPage`
        })
    }
    controller.length > 1 && matrix.push(controller)
    return matrix
}

async function musicCallback(msg, match) {
    const chatID = msg.chat.id;
    const content = match[1];
    console.log(content)

    try {
        const sessionID = msg.message_id
        const resp = await cloudsearch({
            keywords: content,
        })
        let code = resp.status
        code !== 200 || (code = resp.body.code)
        if (code !== 200) {
            bot.sendMessage(chatID, `接口调用失败: ${code}`, {
                reply_to_message_id: sessionID
            })
            return
        }
        const result = resp.body.result
        let session = {
            id: sessionID,
            chatID,
            songs: result.songs,
            page: 0,
            count: result.songs.length,
            createdAt: Date.now(),
            messageID: null,
        }
        let matrix = makeMatrix(session)
        console.log(content, "ok")
        bot.sendMessage(chatID, content, {
            reply_to_message_id: sessionID,
            reply_markup: {
                inline_keyboard: matrix
            }
        }).then((msg) => {
            session.messageID = msg.message_id
            sessions[sessionID] = session
        }).catch((err) => {
            console.error(err)
        });
    } catch (error) {
        console.log(error)
    }
}

(async () => {
    console.log("正在获取bot信息...")
    const botUsername = (await bot.getMe()).username
    console.log("正在运行:", botUsername)

    bot.onText(new RegExp(`^@${botUsername}\\s+/music\\s+(.+)\\s*$`), musicCallback);
    bot.onText(new RegExp(`^/music\\s+@${botUsername}\\s+(.+)\\s*$`), musicCallback);
    bot.onText(new RegExp(`^/music\\s+(.+)\\s*@${botUsername}\\s*$`), musicCallback);

    bot.on('callback_query', (query) => {
        const {
            id: queryID,
            data: callbackData,
            message: {
                chat: {
                    id: chatID
                }
            }
        } = query
        if (callbackData === "#") {
            bot.answerCallbackQuery(queryID)
            return
        }
        let [sessionID, i] = callbackData.split("/")
        sessionID = parseInt(sessionID)
        const session = sessions[sessionID]
        if (!session) {
            bot.answerCallbackQuery(queryID)
            return
        }
        if (isNaN(parseInt(i))) {
            if (i === "lastPage") {
                if (session.page <= 0) {
                    bot.answerCallbackQuery(queryID)
                    return
                }
                session.page--
                console.log("上一页:", session.page)
            }
            if (i === "nextPage") {
                if (session.page >= sessionMaxPage(session)) {
                    bot.answerCallbackQuery(queryID)
                    return
                }
                session.page++
                console.log("下一页:", session.page)
            }
            const matrix = makeMatrix(session)
            bot.editMessageReplyMarkup({inline_keyboard: matrix}, {
                chat_id: chatID,
                message_id: session.messageID,
            }).then(() => {
                sessions[sessionID] = session
            })
            return
        }
        i = parseInt(i)
        const song = session.songs[i]

        const sendFunc = function (url, name) {
            const errFunc = function (err) {
                bot.sendMessage(chatID, `音乐拉取失败: ${err}`, {
                    reply_to_message_id: sessionID
                }).then((msg) => {
                    setTimeout(() => {
                        bot.deleteMessage(chatID, msg.message_id)
                    }, 10000)
                })
                bot.answerCallbackQuery(queryID)
            }
            // 本地下载并上传
            request({
                url,
                encoding: null
            }, (err, response, buffer) => {
                if (err) {
                    errFunc(err)
                    return
                }
                bot.sendAudio(chatID, buffer, {}, {
                    filename: name
                }).then(() => {
                    bot.deleteMessage(chatID, session.messageID)
                }).catch((err) => {
                    errFunc(err)
                })
            })
        }

        // FIXME: 调用网易云接口下载需要登录，合适吗
        // 不登录似乎也可以获取到较好结果
        if (!song.copyrightId) {
            song_url({id: song.id, br: 320000}).then((res) => {
                const {body: {data: [{url: url}]}} = res
                sendFunc(url, songTitle(song, " - "))
            }).catch((err) => {
                errFunc(err)
            })
        } else {
            match(song.id, ['qq', 'kugou', 'kuwo', 'migu']).then(async ([res, meta]) => {
                let {size, url} = res
                sendFunc(url, meta.name)
            })
        }
    });
})()