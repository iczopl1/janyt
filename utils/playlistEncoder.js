const { Buffer } = require('buffer');

exports.encodePlaylist = (playlist) => {
    const data = {
        name: playlist.name,
        songs: playlist.songs.map(song => ({
            title: song.title,
            url: song.url,
            duration: song.duration
        }))
    };
    return Buffer.from(JSON.stringify(data)).toString('base64');
};

exports.decodePlaylist = (code) => {
    try {
        return JSON.parse(Buffer.from(code, 'base64').toString());
    } catch (error) {
        return null;
    }
};
