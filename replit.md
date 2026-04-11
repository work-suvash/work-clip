# WorkClip

A self-hosted, open-source video and audio downloader with a clean web interface. Supports downloading from 1,000+ sites including YouTube, TikTok, Instagram, Twitter/X, and Reddit.

## Tech Stack

- **Backend:** Python 3.12 + Flask
- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Media Engine:** yt-dlp + ffmpeg
- **Production Server:** gunicorn

## Project Structure

```
app.py              # Flask backend with REST API
templates/index.html # Frontend UI (single file)
static/favicon.svg  # Static assets
downloads/          # Temporary download storage (auto-created)
requirements.txt    # Python dependencies
```

## Running the App

The app runs on port 5000 via the "Start application" workflow:

```
python app.py
```

## API Endpoints

- `GET /` — Main UI
- `POST /api/info` — Fetch video metadata and available formats
- `POST /api/download` — Start a background download job
- `GET /api/status/<job_id>` — Poll job status
- `GET /api/file/<job_id>` — Download the completed file

## Deployment

Configured for autoscale deployment using gunicorn:

```
gunicorn --bind=0.0.0.0:5000 --reuse-port app:app
```
