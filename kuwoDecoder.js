const iconv = require("iconv-lite");

// 用于解码 kuwo 这样的使用 ID3v1 且 metadata 使用 GBK 编码的 mp3 buffer

function realText(buffer) {
    let endPos = buffer.indexOf(0)
    if (endPos >= 0) {
        buffer = buffer.slice(0, endPos)
    }
    return iconv.decode(buffer, "gbk")
}

function paddingWrite(buf, offset, str, length) {
    let len = buf.write(str, offset, length)
    if (len >= length) {
        return
    }
    for (let i = len; i < length; i++) {
        buf.writeUInt8(0, i)
    }
}

function decodeKuwo(buffer) {
    const metadata = buffer.slice(buffer.byteLength - 128)
    const header = iconv.decode(metadata.slice(0, 3), "gbk")
    if (header !== "TAG") {
        // 格式不对
        return buffer
    }
    let offset = 3
    const title = realText(metadata.slice(offset, offset + 30))
    paddingWrite(metadata, offset, title, 30)
    offset += 30
    const artist = realText(metadata.slice(offset, offset + 30))
    paddingWrite(metadata, offset, artist, 30)
    offset += 30
    const album = realText(metadata.slice(offset, offset + 30))
    paddingWrite(metadata, offset, album, 30)
    offset += 30
    // pass: year
    offset += 4
    const comment = realText(metadata.slice(offset, offset + 30))
    paddingWrite(metadata, offset, comment, 30)
    return Buffer.concat([buffer.slice(0, buffer.byteLength - 128), metadata])
}

module.exports = decodeKuwo