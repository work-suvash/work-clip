# ReClip

## Overview
ReClip is a Python Flask web app with a vanilla HTML/CSS/JavaScript frontend in `templates/index.html`. It uses `yt-dlp` and `ffmpeg` to fetch media information and download MP4/MP3 files.

## Project Layout
- `app.py` - Flask server, API routes, download job management, and local file serving.
- `templates/index.html` - Single-page web UI.
- `static/favicon.svg` - Static favicon asset.
- `requirements.txt` - Python dependencies managed by Replit package tooling.
- `downloads/` - Runtime download output directory, ignored by git.

## Replit Setup
- Python 3.12 is configured in `.replit`.
- Main workflow: `Start application`.
- Development command: `PORT=5000 HOST=0.0.0.0 python3 app.py`.
- Preview port: `5000`.
- Production publishing is configured as an always-running VM service using Gunicorn: `gunicorn --bind=0.0.0.0:5000 --reuse-port app:app`.

## Notes
- The app stores active jobs in memory and downloaded media in local files, so an always-running production service is a better fit than stateless autoscaling.
- `ffmpeg`, `yt-dlp`, Flask, and Gunicorn are installed in the Replit environment.
