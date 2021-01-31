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
    if (buf.length - offset < length) {
        length = buf.length - offset
        console.warn("paddingWrite: length exceeds", str)
    }
    let len = buf.write(str, offset, length)
    if (len >= length) {
        return
    }
    for (let i = len; i < length && i < buf.length - offset; i++) {
        buf.writeUInt8(0, offset + i)
    }
}

function readID3v1(buffer) {
    let metadata = buffer.slice(buffer.byteLength - 128)

    let offset = 0
    let length = 3
    const header = realText(metadata.slice(offset, offset + length))
    offset += length
    if (header !== "TAG") {
        // 格式不对
        return null
    }

    length = 30
    const title = realText(metadata.slice(offset, offset + length))
    offset += length

    const artist = realText(metadata.slice(offset, offset + length))
    offset += length

    const album = realText(metadata.slice(offset, offset + length))
    offset += length

    // pass: year
    length = 4
    const year = metadata.slice(offset, offset + length)
    offset += length

    length = 30
    const comment = realText(metadata.slice(offset, offset + length))
    offset += length

    length = 1
    const genre = metadata.slice(offset, offset + length)

    return [title, artist, album, year, comment, genre]
}

function decodeKuwo(buffer) {
    const ret = readID3v1(buffer)
    if (!ret) {
        // 格式不对
        return buffer
    }
    const [title, artist, album, year, comment, genre] = ret

    let metadata = buffer.slice(buffer.byteLength - 128)
    let offset = 3
    let length = 30
    paddingWrite(metadata, offset, title, length)
    offset += length
    paddingWrite(metadata, offset, artist, length)
    offset += length
    paddingWrite(metadata, offset, album, length)
    offset += length
    // pass: year
    length = 4
    metadata.write(year.toString(), offset, length)
    offset += length
    length = 30
    paddingWrite(metadata, offset, comment, length)
    offset += length
    metadata.write(genre.toString(), offset, length)
    return buffer
}

function convertID3v1ToID3v2(buffer) {
    const Version = 3,
        Encoding = "ucs2"
    const ret = readID3v1(buffer)
    if (!ret) {
        // 格式不对
        return buffer
    }
    //省略comment和genre
    let [title, artist, album, year, comment, genre] = ret
    let metadata = Buffer.alloc(32768)
    let offset = 0
    let length = 3
    metadata.write("ID3", offset, "ascii") // header
    offset += length

    length = 1
    metadata.writeUInt8(Version, offset) // ver, ID3v2.3
    offset += length

    metadata.writeUInt8(0, offset) // revision
    offset += length

    metadata.writeUInt8(0, offset) // flag
    offset += length

    length = 4
    // size. 在最后写
    offset += length

    if (title.length) {
        metadata.writeUInt8(1, offset + 10)
        metadata.writeUInt8(0xff, offset + 11)
        metadata.writeUInt8(0xfe, offset + 12)
        let contentSize = metadata.write(title, offset + 13, Encoding) + 3
        length = 4
        metadata.write("TIT2", offset, "ascii")
        offset += length

        metadata.writeUInt32BE(contentSize, offset)
        offset += length

        length = 2
        metadata.writeUInt16BE(0, offset)
        offset += length
        offset += contentSize
    }
    if (artist.length) {
        metadata.writeUInt8(1, offset + 10)
        metadata.writeUInt8(0xff, offset + 11)
        metadata.writeUInt8(0xfe, offset + 12)
        let contentSize = metadata.write(artist, offset + 13, Encoding) + 3
        length = 4
        metadata.write("TPE1", offset, "ascii")
        offset += length

        metadata.writeUInt32BE(contentSize, offset)
        offset += length

        length = 2
        metadata.writeUInt16BE(0, offset)
        offset += length
        offset += contentSize
    }
    if (album.length) {
        metadata.writeUInt8(1, offset + 10)
        metadata.writeUInt8(0xff, offset + 11)
        metadata.writeUInt8(0xfe, offset + 12)
        let contentSize = metadata.write(album, offset + 13, Encoding) + 3
        length = 4
        metadata.write("TALB", offset, "ascii")
        offset += length

        metadata.writeUInt32BE(contentSize, offset)
        offset += length

        length = 2
        metadata.writeUInt16BE(0, offset)
        offset += length
        offset += contentSize
    }
    if (year.readUInt32BE(0)) {
        metadata.writeUInt8(0, offset + 10)
        let contentSize = metadata.write(year.toString(), offset + 11, "ascii") + 1
        console.log(contentSize)
        length = 4
        metadata.write("TYER", offset, "ascii")
        offset += length

        metadata.writeUInt32BE(contentSize, offset)
        offset += length

        length = 2
        metadata.writeUInt16BE(0, offset)
        offset += length
        offset += contentSize
    }
    if (offset <= 10) {
        return buffer
    }
    let totalSize = offset
    metadata.writeUInt8(totalSize / 0x200000, 6)
    totalSize %= 0x200000
    metadata.writeUInt8(totalSize / 0x4000, 7)
    totalSize %= 0x4000
    metadata.writeUInt8(totalSize / 0x80, 8)
    totalSize %= 0x80
    metadata.writeUInt8(totalSize, 9)

    return Buffer.concat([metadata.slice(0, offset), buffer.slice(0, buffer.byteLength - 128)])
}

module.exports = {decodeKuwo, convertID3v1ToID3v2}