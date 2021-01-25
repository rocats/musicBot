const {
    search
} = require("./NeteaseCloudMusicApi/main")
const match = require("@nondanee/unblockneteasemusic")


async function main() {
    try {
        const result = await search({
            keywords: '等你下课 周杰伦'
        })
        console.log(result)
        console.log(result.body.result.songs)

    } catch (error) {
        console.log(error)
    }
}
main()