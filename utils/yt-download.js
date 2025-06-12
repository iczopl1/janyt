// utils/downloadYouTube.js
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

function downloadYouTubeVideo(url) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'yt_downloader.py');
    if (!fs.existsSync(script)) {
      console.log('❌ Python script not found');
      return reject(new Error('Downloader config error'));
    }

    console.log('⏳ Downloading:', url);
    const cmd = `python3 "${script}" "${url}"`;

    exec(cmd, { cwd: __dirname }, (err, stdout, stderr) => {
      if (err) {
        console.log('❌ Exec error:', err);
        return reject(new Error('Download failed'));
      }

      try {
        const output = stdout.trim() || stderr.trim();
        const result = JSON.parse(output);

        if (result.status === 'success') {
          if (fs.existsSync(result.filepath)) {
            console.log('✅ Downloaded:', result.title);
            resolve({
              status: 'success',
              title: result.title,
              filepath: result.filepath
            });
          } else {
            console.log('❌ File missing:', result.filepath);
            reject(new Error('File missing after download'));
          }
        } else {
          reject(new Error(result.message || 'Unknown error'));
        }
      } catch (parseErr) {
        console.log('❌ JSON parse error:', parseErr);
        reject(new Error('Invalid downloader response'));
      }
    });
  });
}

module.exports = downloadYouTubeVideo; // Don't forget to export!
