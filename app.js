let p = process.env.PROXY
const token = process.env.TELEGRAM_APITOKEN
const countrycode = parseInt(process.env.NETEASE_COUNTRYCODE),
    phone = process.env.NETEASE_PHONE,
    password = process.env.NETEASE_PASSWORD
const pageSize = 10
const dbPath = './data.db'

const {
    cloudsearch,
    song_url,
    login_cellphone,
    login_refresh,
    check_music
} = require('./NeteaseCloudMusicApi/main')
const TelegramBot = require('node-telegram-bot-api')
const tunnel = require('tunnel')
const request = require('request')
const match = require('./match')
const fs = require('fs')
const os = require('os')
const sqlite3 = require('sqlite3').verbose();
let db = null
let cookie = null

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
    return new Promise((resolve, reject) => {
        let notExist = !fs.existsSync(dbPath)
        let db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                return reject(err.message);
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
        return resolve(db)
    })
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
        const msgPromise = bot.sendMessage(chatID, `嗯.. 这就去找 ${content}`, {
            reply_to_message_id: sessionID,
        }).then(msg => {
            return msg.message_id
        }).catch(console.error)
        const resp = await cloudsearch({
            keywords: content,
        })
        let code = resp.status
        code !== 200 || (code = resp.body.code)
        if (code !== 200) {
            bot.sendMessage(chatID, `接口调用失败: ${code}`, {
                reply_to_message_id: sessionID
            }).catch(console.error)
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
        const msgID = await msgPromise
        if (!msgID) {
            return
        }
        let matrix = makeMatrix(session)
        bot.editMessageReplyMarkup({
            inline_keyboard: matrix
        }, {
            chat_id: chatID,
            message_id: msgID,
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
    console.log("正在获取bot信息")
    const botUsername = (await bot.getMe()).username
    db = await initDB().catch((err) => {
        console.error(err)
        os.exit(1)
    })
    console.log("Username:", botUsername)
    if (phone && password) {
        console.log("正在登录网易云")
        const resp = await login_cellphone({phone, password, countrycode}).catch(err => {
            console.error(err)
            os.exit(1)
        })
        if (resp.status !== 200 || resp.body.code !== 200) {
            console.error(resp)
            os.exit(1)
        }
        cookie = resp.body.cookie

        // 十分钟刷新一次登录状态
        setInterval(() => {
            login_refresh({
                cookie
            })
        }, 10 * 60 * 1000)
    } else {
        console.log("您可以通过登录网易云vip账号以扩展vip歌曲：设置环境变量NETEASE_PHONE/NETEASE_PASSWORD, 并在需要时设置NETEASE_COUNTRYCODE")
    }

    bot.onText(new RegExp(`^@${botUsername}\\s+/music\\s+(.+)\\s*$`), musicCallback);
    bot.onText(new RegExp(`^/music\\s*@${botUsername}\\s+(.+)\\s*$`), musicCallback);
    bot.onText(new RegExp(`^/music\\s+(.+)\\s*@${botUsername}\\s*$`), musicCallback);
    bot.onText(new RegExp(`^/music\\s+(.+)\\s*$`), (msg, match) => {
        if (msg.chat.type !== 'private') {
            return
        }
        musicCallback(msg, match)
    });

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
                // setTimeout(() => {
                //     bot.deleteMessage(chatID, msg.message_id)
                // }, 10000)
            }).catch(console.error)
            bot.answerCallbackQuery(queryID)
        }

        db.get(`SELECT session_json FROM sessions WHERE id = ?`, [sessionID], async (err, row) => {
            if (err) {
                errFunc(err, "服务器内部错误")
                return
            }
            if (!row) {
                bot.deleteMessage(chatID, msgID).catch(console.error)
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
                }).catch(console.error)
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
                        bot.editMessageText("快马加鞭! 在下了在下了!!", {
                            chat_id: chatID,
                            message_id: msgID,
                        }).catch(console.error)
                        console.log("miss", song.id, from_domain)
                        // 本地下载并上传
                        request({
                            url,
                            encoding: null
                        }, (err, response, buffer) => {
                            if (err) {
                                errFunc(err, "下载失败")
                                return
                            }
                            bot.editMessageText("莫慌! 马上传好了!!", {
                                chat_id: chatID,
                                message_id: msgID,
                            }).catch(console.error)
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
                    }).catch(console.error)
                    bot.sendAudio(chatID, row.file_id).then((msg) => {
                        bot.deleteMessage(chatID, msgID).catch(console.error)
                        db.run(`DELETE FROM sessions WHERE id = ?`, [sessionID], (err) => {
                            err && console.error(err)
                        })
                    }).catch((err) => {
                        errFunc(err, "上传失败")
                    })
                })
            }

            bot.editMessageReplyMarkup({inline_keyboard: null}, {
                chat_id: chatID,
                message_id: msgID,
            }).catch(err => {
                // pass
            })
            bot.editMessageText("在查了在查了!", {
                chat_id: chatID,
                message_id: msgID,
            }).catch(console.error)
            let needOtherSource = true
            await check_music({id: song.id}).then(async (resp) => {
                if (resp.body.success) {
                    await song_url({id: song.id, br: 320000, cookie}).then((res) => {
                        const {body: {data: [{url: url, freeTrialInfo: freeTrialInfo}]}} = res
                        if (freeTrialInfo) {
                            return
                        }
                        needOtherSource = false
                        sendFunc(url, songTitle(song, " - "))
                    }).catch((err) => {
                        console.error("获取地址失败", err)
                    })
                }
            }).catch((err) => {
                if (err.body && err.body.success === false) {
                    // 正常
                    console.log(song.id, err.body.message)
                    return
                }
                console.error("检查歌曲是否可用失败", err)
            })
            if (needOtherSource) {
                bot.editMessageText("等一哈, 在搜了!!", {
                    chat_id: chatID,
                    message_id: msgID,
                }).catch(console.error)
                match(song.id, ['qq', 'kuwo', 'migu', 'kugou']).then(async ([res, meta]) => {
                    let {size, url} = res
                    sendFunc(url, meta.name)
                }).catch((err) => {
                    errFunc(err, "匹配地址失败")
                })
            }
        })
    });
})()
