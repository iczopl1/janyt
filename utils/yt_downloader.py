#!/usr/bin/env python3
import os
from pathlib import Path
import string
import sys
import json
import yt_dlp
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
from bson.objectid import ObjectId
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

MONGODB_URI = os.getenv("MONGODB_URI")
# Configure yt-dlp to suppress all output except our JSON
DATABASE_NAME = "song_database"
COLLECTION_NAME = "downloaded_songs"

class SilentLogger:
    def debug(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
        pass


output_dir = "YTmusic"
os.makedirs(output_dir, exist_ok=True)
YTDL_OPTIONS = {
    "format": "bestaudio/best",
    "outtmpl": os.path.join(output_dir, "%(title)s.%(ext)s"),
    "restrictfilenames": False,
    "noplaylist": True,
    "nocheckcertificate": True,
    "ignoreerrors": False,
    "quiet": True,
    "no_warnings": True,
    "logger": SilentLogger(),
    "extractaudio": True,
    "audioformat": "mp3",
    "postprocessors": [
        {
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }
    ],
}

def get_db_connection():
    try:
        client = MongoClient(MONGODB_URI)
        # Verify the connection
        client.server_info()
        db = client[DATABASE_NAME]
        return db
    except ConnectionFailure as e:
        print(f"Could not connect to MongoDB: {e}", file=sys.stderr)
        return None

def url_in_music_list(input_url, db):
    collection = db[COLLECTION_NAME]
    song = collection.find_one({"url": input_url})
    return song if song else False

def download_video(url):
    response = {"status": "error", "message": "Unknown error"}
    
    # Connect to MongoDB
    db = get_db_connection()
    if db is None:
        response["message"] = "DB_connection"
        print(json.dumps(response))
        return
    
    collection = db[COLLECTION_NAME]
    
    try:
        with yt_dlp.YoutubeDL(YTDL_OPTIONS) as ydl:
            # Check if song exists in database
            existing_song = collection.find_one({"url": url})
            
            if existing_song:
                abs_path = existing_song["path"]
                # Check if file exists and has content
                if os.path.exists(abs_path) and os.path.getsize(abs_path) > 0:
                    response = {
                        "status": "success",
                        "filepath": abs_path,
                        "title": existing_song["title"],
                        "duration": existing_song["duration"],
                        "message": "File already exists and is not empty",
                    }
                else:
                    # File doesn't exist or is empty - proceed with download
                    info = ydl.extract_info(url, download=False)
                    ydl.download([url])
                    
                    if os.path.exists(abs_path) and os.path.getsize(abs_path) > 0:
                        response = {
                            "status": "success",
                            "filepath": abs_path,
                            "title": existing_song["title"],
                            "duration": existing_song["duration"],
                            "message": "Re-downloaded successfully",
                        }
                    else:
                        response = {
                            "status": "error",
                            "message": "Second download error - missing file on disk",
                        }
            else:
                # New download
                info = ydl.extract_info(url, download=False)
                currentDir = os.getcwd()
                dir_path = os.path.join(currentDir, output_dir)

                # Download the video/audio
                ydl.download([url])
                
                # Find the actual downloaded file
                actual_files = [
                    f for f in os.listdir(dir_path) 
                    if f.startswith(info["title"])
                ]
                
                if not actual_files:
                    response = {
                        "status": "error",
                        "message": "Downloaded file not found",
                    }
                    print(json.dumps(response))
                    return
                
                actual_filename = actual_files[0]
                abs_path = os.path.join(dir_path, actual_filename)
                
                # Verify download was successful
                if os.path.exists(abs_path) and os.path.getsize(abs_path) > 0:
                    song_data = {
                        "url": url,
                        "title": actual_filename,
                        "duration": info.get("duration", 0),
                        "uploader": info.get("uploader", "Unknown Artist"),
                        "path": abs_path,
                    }
                    
                    # Insert into MongoDB
                    result = collection.insert_one(song_data)
                    
                    response = {
                        "status": "success",
                        "filepath": abs_path,
                        "title": actual_filename,
                        "duration": info.get("duration", 0),
                        "uploader": info.get("uploader", "Unknown Artist"),
                    }
                else:
                    response = {
                        "status": "error",
                        "message": "Downloaded file is empty or corrupted",
                    }
    except Exception as e:
        response["message"] = str(e)

    # Print ONLY the JSON response (no other output)
    print(json.dumps(response))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        download_video(sys.argv[1])
    else:
        print(json.dumps({"status": "error", "message": "No URL provided"}))
