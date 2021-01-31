process.env.ENABLE_FLAC = "true"
let p = process.env.PROXY
const token = process.env.TELEGRAM_APITOKEN
const md5check = !(process.env.NO_MD5CHECK && (process.env.NO_MD5CHECK === "1" || process.env.NO_MD5CHECK.toLowerCase() === "true"))
const countrycode = parseInt(process.env.NETEASE_COUNTRYCODE),
    phone = process.env.NETEASE_PHONE,
    password = process.env.NETEASE_PASSWORD
const pageSize = 10
const dbPath = './data.db'
const source = [/*'qq', 'migu', 'kuwo', 'kugou', 'joox', 'xiami', 'youtube'*/'qq', 'kuwo', 'kugou']

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
const {convertID3v1ToID3v2} = require('./kuwoDecoder')
const md5Hash = require('md5')
const mm = require('music-metadata');
let db = null
let cookie = null
let botUsername = ''

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
    console.log("使用 HTTP 代理:", proxy.host + ":" + proxy.port)
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
                byte_length INTEGER NOT NULL,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
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
    if (l + pageSize < session.count) {
        controller.push({
            text: "下一页",
            callback_data: `${session.id}/nextPage`
        })
    }
    controller.push({
        text: `取消`,
        callback_data: `${session.id}/close`
    })
    controller.length > 2 && matrix.push(controller)
    return matrix
}

async function musicCallback(msg, match) {
    const chatID = msg.chat.id;
    const content = match[1];
    const fields = content.split(/\s+/)
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
            limit: 100
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
        if (!result || !result.songs) {
            bot.sendMessage(chatID, '找不到呢... 可能被河蟹了...', {
                reply_to_message_id: sessionID
            }).catch(console.error)
            return
        }
        let session = {
            id: sessionID,
            chatID,
            songs: result.songs
                .sort((a, b) => {
                    let scoreA = fields.some(field => field === a.name) ? 1 : 0
                    let scoreB = fields.some(field => field === b.name) ? 1 : 0
                    return scoreB - scoreA
                })
                .sort((a, b) => {
                    let scoreA = (a.ar && a.ar.some(artist => fields.some(field => field === artist.name))) ? 1 : 0
                    let scoreB = (b.ar && b.ar.some(artist => fields.some(field => field === artist.name))) ? 1 : 0
                    return scoreB - scoreA
                }),
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

function caption(name, url, byteLength, br) {
    const dotIndex = name.lastIndexOf(".")
    if (dotIndex >= 0) {
        name = name.substr(0, dotIndex)
    }
    return `名称: ${name}\n格式: ${url.substr(url.lastIndexOf(".") + 1)}\n音质: ${Math.floor(br / 1000)} kbits/s\n大小: ${(byteLength / 1024 / 1024).toFixed(2)} MB`
}

// 最小编辑距离
function minDistance(s1, s2) {
    const len1 = s1.length
    const len2 = s2.length

    let matrix = []

    for (let i = 0; i <= len1; i++) {
        // 构造二维数组
        matrix[i] = new Array()
        for (let j = 0; j <= len2; j++) {
            // 初始化
            if (i == 0) {
                matrix[i][j] = j
            } else if (j == 0) {
                matrix[i][j] = i
            } else {
                // 进行最小值分析
                let cost = 0
                if (s1[i - 1] != s2[j - 1]) { // 相同为0，不同置1
                    cost = 1
                }
                const temp = matrix[i - 1][j - 1] + cost

                matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, temp)
            }
        }
    }
    return matrix[len1][len2] //返回右下角的值
}

(async () => {
    console.log("正在获取 Bot 信息")
    botUsername = (await bot.getMe()).username
    db = await initDB().catch((err) => {
        console.error(err)
        os.exit(1)
    })
    console.log("Bot Username:", botUsername)
    if (phone && password) {
        console.log("正在登录网易云")
        let resp = await login_cellphone({phone, password, countrycode}).catch(err => {
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

        // 获取用户名
        resp = await login_cellphone({phone, password, countrycode}).catch(err => {
            console.error(err)
            os.exit(1)
        })
        if (resp.status !== 200 || resp.body.code !== 200) {
            console.error(resp)
            os.exit(1)
        }
        const {
            body: {
                profile: {
                    nickname
                },
                account: {
                    vipType
                }
            }
        } = resp
        console.log(`网易云登录成功, 昵称: ${nickname}, vip类型: ${vipType === 0 ? "非会员" : vipType}`)
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
            console.error(err)
            bot.sendMessage(chatID, `${msg}: ${err}`, {
                reply_to_message_id: sessionID
            }).then((msg) => {
                // setTimeout(() => {
                //     bot.deleteMessage(chatID, msg.message_id)
                // }, 10000)
            }).catch(console.error)
            bot.answerCallbackQuery(queryID).catch(() => {
            })
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
                if (i === "close") {
                    bot.deleteMessage(chatID, msgID).catch(console.error)
                    db.run(`DELETE FROM sessions WHERE id = ?`, [sessionID], (err) => {
                        err && console.error(err)
                    })
                    return
                }
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

            const sendFunc = function (url, name, md5, br, info) {
                if (info && info.name) {
                    name = info.name
                    if (info.artists.length) {
                        name += ' - ' + info.artists.map((artist) => artist.name).join('/')
                    }
                }
                let from_domain = new URL(url).hostname
                let fields = from_domain.split(".")
                from_domain = fields.slice(fields.length - 2 >= 0 ? fields.length - 2 : 0).join(".")
                db.get(`SELECT file_id,byte_length,name FROM recollections WHERE song_id = ? AND from_domain = ? AND username = ?`, [song.id, from_domain, botUsername], (err, row) => {
                    if (err) {
                        return
                    }
                    if (row) {
                        console.log("hit", song.id, from_domain)
                        bot.editMessageText("马上传好了!!", {
                            chat_id: chatID,
                            message_id: msgID,
                        }).catch(console.error)
                        bot.sendAudio(chatID, row.file_id, {caption: caption(row.name, url, row.byte_length, br)}).then((msg) => {
                            bot.deleteMessage(chatID, msgID).catch(console.error)
                            db.run(`DELETE FROM sessions WHERE id = ?`, [sessionID], (err) => {
                                err && console.error(err)
                            })
                        }).catch((err) => {
                            errFunc(err, "上传失败")
                        })
                        return
                    }
                    bot.editMessageText("找到了! 在下了在下了!!", {
                        chat_id: chatID,
                        message_id: msgID,
                    }).catch(console.error)
                    console.log("miss", song.id, from_domain)
                    // 本地下载并上传
                    console.log(`song.id: ${song.id}, url: ${url}, info: ${JSON.stringify(info)}`)
                    request({
                        url,
                        encoding: null
                    }, async (err, response, buffer) => {
                        if (err) {
                            errFunc(err, "下载失败")
                            return
                        }
                        if (md5check && md5 && md5Hash(buffer) !== md5.toLowerCase()) {
                            errFunc(name, "MD5校验失败")
                            return
                        }
                        if (url.substr(url.length - 4) === ".mp3") {
                            buffer = convertID3v1ToID3v2(buffer, info.name, info.artists.map((artist) => artist.name).join('/'), info.album.name)
                        }
                        bot.editMessageText("就要传好了!!", {
                            chat_id: chatID,
                            message_id: msgID,
                        }).catch(console.error)
                        try {
                            const metadata = await mm.parseBuffer(buffer, {mimeType: response.headers["content-type"] || null});
                            name += "." + metadata.format.container.toLowerCase()
                        } catch (err) {
                            console.error(err.message);
                            const index = url.lastIndexOf(".")
                            if (index > url.indexOf("/")) {
                                name += url.substr(index)
                            }
                        }
                        console.log(name)
                        bot.sendAudio(chatID, buffer, {caption: caption(name, url, buffer.byteLength, br)}, {
                            filename: name,
                            contentType: response.headers["content-type"] || "application/octet-stream"
                        }).then((msg) => {
                            bot.deleteMessage(chatID, msgID).catch(console.error)
                            db.run(`DELETE FROM sessions WHERE id = ?`, [sessionID], (err) => {
                                err && console.error(err)
                            })
                            db.run(`INSERT INTO recollections VALUES (?,?,?,?,?,?)`, [song.id, from_domain, msg.audio.file_id, buffer.byteLength, botUsername, name], (err) => {
                                err && console.error(err)
                            })
                        }).catch((err) => {
                            errFunc(err, "上传失败")
                        })
                    })
                })
            }
            bot.editMessageReplyMarkup({inline_keyboard: null}, {
                chat_id: chatID,
                message_id: msgID,
            }).catch(err => {
                // pass
            })
            bot.editMessageText("似乎...", {
                chat_id: chatID,
                message_id: msgID,
            }).catch(console.error)
            let needOtherSource = true
            await check_music({id: song.id}).then(async (resp) => {
                if (resp.body.success) {
                    await song_url({id: song.id, cookie}).then((res) => {
                        const {body: {data: [{url, br, freeTrialInfo, md5}]}} = res
                        if (freeTrialInfo) {
                            return
                        }
                        needOtherSource = false
                        sendFunc(url, songTitle(song, " - "), md5, br)
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
                console.error("检查歌曲是否可用:", err)
            })
            if (needOtherSource) {
                bot.editMessageText("嗯...我再仔细找找", {
                    chat_id: chatID,
                    message_id: msgID,
                }).catch(console.error)
                match(song.id, source).then(async ([meta, songs]) => {
                    if (!songs.length) {
                        errFunc("", "找不到呢...")
                        return
                    }
                    songs.sort((a, b) => {
                        let scoreA = minDistance(song.name, a.info.name)
                        let scoreB = minDistance(song.name, b.info.name)
                        return scoreA - scoreB
                    }).sort((a, b) => {
                        let scoreA = song.ar.some(ar => a.info.artists.some(artist => ar === artist))
                        let scoreB = song.ar.some(ar => b.info.artists.some(artist => ar === artist))
                        return scoreB - scoreA
                    })
                    let {size, url, md5, br, info} = songs[0]
                    sendFunc(url, meta.name, md5, br, info)
                }).catch((err) => {
                    errFunc(err, "匹配地址失败")
                })
            }
        })
    });
})()
