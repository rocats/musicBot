const {convertID3v1ToID3v2} = require('./kuwoDecoder')
const fs = require('fs')


let t = fs.readFileSync("/home/mzz/Downloads/1538643802.mp3")
let b = Buffer.from(t)
let buffer = convertID3v1ToID3v2(b)
fs.writeFileSync("./test.mp3", buffer)