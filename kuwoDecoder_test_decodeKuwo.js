const {decodeKuwo} = require('./kuwoDecoder')
const fs = require('fs')


let t = fs.readFileSync("/home/mzz/Downloads/test.mp3")
let b = Buffer.from(t)
console.log(b.slice(b.length - 128, b.length - 125).toString())
console.log(b.slice(b.length - 128).toString())
console.log(b.readUInt8(b.byteLength - 1))

let buffer = decodeKuwo(b)
fs.writeFileSync("./test.mp3", buffer)
console.log(buffer.slice(buffer.length - 128, buffer.length - 125).toString())
console.log(buffer.slice(buffer.length - 128).toString())
console.log(buffer.readUInt8(buffer.byteLength - 1))