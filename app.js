let p = process.env.PROXY
const token = process.env.TELEGRAM_APITOKEN
const pageSize = 10
const dbPath = './data.db'

const {
    cloudsearch,
    song_url
} = require('./NeteaseCloudMusicApi/main')
const TelegramBot = require('node-telegram-bot-api')
const tunnel = require('tunnel')
const request = require('request')
const match = require('./match')
const fs = require('fs')
const sqlite3 = require('sqlite3').verbose();
let db = null


console.log("Token:", token)
let proxy = null
if (p) {
    if (p.indexOf("://") < 0) {
        p = "http://" + p
    }
    p = new URL(p)
    proxy = {
        host: p.hostname,
        port: parseInt(p.port) || 80
    }
    console.log("使用HTTP代理:", proxy.host + ":" + proxy.port)
} else {
    console.log("不使用代理")
}
const bot = new TelegramBot(token, {
    polling: true,
    request: {
        agent: tunnel.httpsOverHttp({
            proxy
        })
    }
});

function initDB() {
    let notExist = !fs.existsSync(dbPath)
    let db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            return console.error(err.message);
        }
        console.log('成功连接 SQLite 数据库');
    });
    if (notExist) {
        db.serialize(() => {
            db.run(`CREATE TABLE sessions (
                id INTEGER PRIMARY KEY,
                session_json TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )`)
            db.run(`CREATE TABLE recollections (
                song_id INTEGER,
                from_domain TEXT,
                file_id TEXT NOT NULL,
                PRIMARY KEY(song_id,from_domain)
            )`)
        })
        console.log('数据库建表完毕')
    }
    return db
}

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
        }
        let matrix = makeMatrix(session)
        bot.sendMessage(chatID, content, {
            reply_to_message_id: sessionID,
            reply_markup: {
                inline_keyboard: matrix
            }
        }).then((msg) => {
            db.run("INSERT INTO sessions VALUES (?,?,?)", [sessionID, JSON.stringify(session), Date.now()], (err) => {
                err && console.error(err)
            })
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
    db = initDB()
    console.log("Username:", botUsername)

    bot.onText(new RegExp(`^@${botUsername}\\s+/music\\s+(.+)\\s*$`), musicCallback);
    bot.onText(new RegExp(`^/music\\s*@${botUsername}\\s+(.+)\\s*$`), musicCallback);
    bot.onText(new RegExp(`^/music\\s+(.+)\\s*@${botUsername}\\s*$`), musicCallback);

    bot.on('callback_query', (query) => {
        const {
            id: queryID,
            data: callbackData,
            message: {
                message_id: msgID,
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

        const errFunc = function (err, msg = "未知错误") {
            bot.sendMessage(chatID, `${msg}: ${err}`, {
                reply_to_message_id: sessionID
            }).then((msg) => {
                setTimeout(() => {
                    bot.deleteMessage(chatID, msg.message_id)
                }, 10000)
            })
            bot.answerCallbackQuery(queryID)
        }

        db.get(`SELECT session_json FROM sessions WHERE id = ?`, [sessionID], (err, row) => {
            if (err) {
                errFunc(err, "服务器内部错误")
                return
            }
            if (!row) {
                bot.deleteMessage(chatID, msgID)
                return
            }
            const session = JSON.parse(row.session_json)

            if (!(session instanceof Object)) {
                console.error(session)
                console.log("无法在数据库中找到sessionID", sessionID)
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
                    message_id: msgID,
                }).then(() => {
                    db.run("UPDATE sessions SET session_json = ? WHERE id = ?", [JSON.stringify(session), sessionID], (err) => {
                        err && console.error(err)
                    })
                })
                return
            }
            i = parseInt(i)
            const song = session.songs[i]

            const sendFunc = function (url, name) {
                let from_domain = new URL(url).hostname
                let fields = from_domain.split(".")
                from_domain = fields.slice(fields.length - 2 >= 0 ? fields.length - 2 : 0).join(".")
                db.get(`SELECT file_id FROM recollections WHERE song_id = ? AND from_domain = ?`, [song.id, from_domain], (err, row) => {
                    if (err) {
                        return
                    }
                    if (!row) {
                        bot.editMessageText("没得窜瞌睡! 在下了在下了!!", {
                            chat_id: chatID,
                            message_id: msgID,
                        })
                        console.log("miss", song.id, from_domain)
                        // 本地下载并上传
                        request({
                            url,
                            encoding: null
                        }, (err, response, buffer) => {
                            if (err) {
                                errFunc(err, "拉取失败")
                                return
                            }
                            bot.editMessageText("莫慌! 马上传好了!!", {
                                chat_id: chatID,
                                message_id: msgID,
                            })
                            bot.sendAudio(chatID, buffer, {}, {
                                filename: name
                            }).then((msg) => {
                                bot.deleteMessage(chatID, msgID)
                                db.run(`DELETE FROM sessions WHERE id = ?`, [sessionID], (err) => {
                                    err && console.error(err)
                                })
                                db.run(`INSERT INTO recollections VALUES (?,?,?)`, [song.id, from_domain, msg.audio.file_id], (err) => {
                                    err && console.error(err)
                                })
                            }).catch((err) => {
                                errFunc(err, "上传失败")
                            })
                        })
                        return
                    }
                    console.log("hit", song.id, from_domain)
                    bot.editMessageText("莫慌! 马上传好了!!", {
                        chat_id: chatID,
                        message_id: msgID,
                    })
                    bot.sendAudio(chatID, row.file_id).then((msg) => {
                        bot.deleteMessage(chatID, msgID)
                        db.run(`DELETE FROM sessions WHERE id = ?`, [sessionID], (err) => {
                            err && console.error(err)
                        })
                    }).catch((err) => {
                        errFunc(err, "上传失败")
                    })
                })
            }

            bot.editMessageReplyMarkup({}, {
                chat_id: chatID,
                message_id: msgID,
            })

            // FIXME: 调用网易云接口下载需要登录，合适吗
            // 不登录似乎也可以获取到较好结果
            if (!song.copyrightId) {
                song_url({id: song.id, br: 320000}).then((res) => {
                    const {body: {data: [{url: url}]}} = res
                    sendFunc(url, songTitle(song, " - "))
                }).catch((err) => {
                    errFunc(err, "拉取失败")
                })
            } else {
                bot.editMessageText("等一哈, 在搜了!!", {
                    chat_id: chatID,
                    message_id: msgID,
                })
                match(song.id, ['qq', 'kugou', 'kuwo', 'migu']).then(async ([res, meta]) => {
                    let {size, url} = res
                    sendFunc(url, meta.name)
                }).catch((err) => {
                    errFunc(err, "拉取失败")
                })
            }
        })
    });
})()