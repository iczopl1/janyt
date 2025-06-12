const Playlist = require('../models/Playlist');

/**
 * Validates playlist import data structure
 */
function validatePlaylistImport(data) {
    if (!data || typeof data !== 'object') return false;
    if (!data.name || typeof data.name !== 'string') return false;
    if (!Array.isArray(data.songs)) return false;
    
    // Validate each song
    for (const song of data.songs) {
        if (!song.title || typeof song.title !== 'string') return false;
        if (!song.url || typeof song.url !== 'string') return false;
    }
    
    return true;
}

/**
 * Checks if songs exist in database and adds file paths
 */
async function hydrateImportedSongs(songs, db) {
    const collection = db.collection("downloaded_songs");
    const hydratedSongs = [];
    
    for (const song of songs) {
        // Try to find song in database
        const dbSong = await collection.findOne({ 
            $or: [
                { url: song.url },
                { title: song.title }
            ]
        });
        
        hydratedSongs.push({
            title: song.title,
            url: song.url,
            path: dbSong?.path || '', // Will be downloaded when played if missing
            duration: song.duration || dbSong?.duration || 0,
            addedAt: new Date()
        });
    }
    
    return hydratedSongs;
}

module.exports = {
    validatePlaylistImport,
    hydrateImportedSongs
};
