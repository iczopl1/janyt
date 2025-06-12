const mongoose = require('mongoose');

const songSchema = new mongoose.Schema({
    title: String,
    url: String,
    duration: Number, // Should be a number, not string
    path: String, // Make optional if not needed: { type: String, required: false }
    addedAt: { type: Date, default: Date.now }
});

const playlistSchema = new mongoose.Schema({
    userId: String,
    name: String,
    songs: [songSchema]
});

module.exports = mongoose.model('Playlist', playlistSchema);
