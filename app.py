import os
import uuid
import glob
import json
import shutil
import subprocess
import threading
from flask import Flask, request, jsonify, send_file, render_template

app = Flask(__name__)
DOWNLOAD_DIR = os.path.join(os.path.dirname(__file__), "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)


def _find_ffmpeg_dir():
    """
    Return the directory that contains BOTH ffmpeg and ffprobe.
    Prefer the system install (from Nix) because imageio_ffmpeg only
    ships the ffmpeg binary without ffprobe, which causes yt-dlp's
    post-processing to fail with 'unable to obtain file audio codec'.
    """
    sys_ffprobe = shutil.which("ffprobe")
    sys_ffmpeg = shutil.which("ffmpeg")
    if sys_ffprobe and sys_ffmpeg:
        ffprobe_dir = os.path.dirname(os.path.realpath(sys_ffprobe))
        ffmpeg_dir = os.path.dirname(os.path.realpath(sys_ffmpeg))
        if ffprobe_dir == ffmpeg_dir:
            return ffmpeg_dir

    try:
        import imageio_ffmpeg
        imageio_path = imageio_ffmpeg.get_ffmpeg_exe()
        imageio_dir = os.path.dirname(imageio_path)
        if shutil.which("ffprobe", path=imageio_dir):
            return imageio_dir
    except Exception:
        pass

    if sys_ffmpeg:
        return os.path.dirname(os.path.realpath(sys_ffmpeg))

    return None


FFMPEG_DIR = _find_ffmpeg_dir()

_base_env = os.environ.copy()
if FFMPEG_DIR:
    _base_env["PATH"] = FFMPEG_DIR + os.pathsep + _base_env.get("PATH", "")
SUBPROCESS_ENV = _base_env

jobs = {}


@app.after_request
def add_extension_headers(response):
    origin = request.headers.get("Origin", "")
    if origin.startswith("chrome-extension://"):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


def _build_base_cmd(out_template):
    cmd = ["yt-dlp", "--no-playlist", "-o", out_template]
    if FFMPEG_DIR:
        cmd += ["--ffmpeg-location", FFMPEG_DIR]
    return cmd


def run_download(job_id, url, format_choice, format_id):
    job = jobs[job_id]
    out_template = os.path.join(DOWNLOAD_DIR, f"{job_id}.%(ext)s")

    cmd = _build_base_cmd(out_template)

    if format_choice == "audio":
        cmd += [
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "--postprocessor-args", "ffmpeg:-ar 44100",
        ]
    elif format_id:
        cmd += ["-f", f"{format_id}+bestaudio/best", "--merge-output-format", "mp4"]
    else:
        cmd += ["-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4"]

    cmd.append(url)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300, env=SUBPROCESS_ENV)
        if result.returncode != 0:
            stderr_lines = [l for l in result.stderr.strip().splitlines() if l.strip()]
            error_msg = stderr_lines[-1] if stderr_lines else "Download failed"
            job["status"] = "error"
            job["error"] = error_msg
            return

        files = glob.glob(os.path.join(DOWNLOAD_DIR, f"{job_id}.*"))
        if not files:
            job["status"] = "error"
            job["error"] = "Download completed but no file was found"
            return

        if format_choice == "audio":
            target = [f for f in files if f.endswith(".mp3")]
            chosen = target[0] if target else files[0]
        else:
            target = [f for f in files if f.endswith(".mp4")]
            chosen = target[0] if target else files[0]

        for f in files:
            if f != chosen:
                try:
                    os.remove(f)
                except OSError:
                    pass

        job["status"] = "done"
        job["file"] = chosen
        ext = os.path.splitext(chosen)[1]
        title = job.get("title", "").strip()
        if title:
            safe_title = "".join(c for c in title if c not in r'\/:*?"<>|').strip()[:20].strip()
            job["filename"] = f"{safe_title}{ext}" if safe_title else os.path.basename(chosen)
        else:
            job["filename"] = os.path.basename(chosen)
    except subprocess.TimeoutExpired:
        job["status"] = "error"
        job["error"] = "Download timed out (5 min limit)"
    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/info", methods=["POST"])
def get_info():
    data = request.json
    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    cmd = ["yt-dlp", "--no-playlist", "-j", url]
    if FFMPEG_DIR:
        cmd += ["--ffmpeg-location", FFMPEG_DIR]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60, env=SUBPROCESS_ENV)
        if result.returncode != 0:
            stderr_lines = [l for l in result.stderr.strip().splitlines() if l.strip()]
            return jsonify({"error": stderr_lines[-1] if stderr_lines else "Failed to fetch info"}), 400

        info = json.loads(result.stdout)

        best_by_height = {}
        for f in info.get("formats", []):
            height = f.get("height")
            if height and f.get("vcodec", "none") != "none":
                tbr = f.get("tbr") or 0
                if height not in best_by_height or tbr > (best_by_height[height].get("tbr") or 0):
                    best_by_height[height] = f

        formats = []
        for height, f in best_by_height.items():
            formats.append({
                "id": f["format_id"],
                "label": f"{height}p",
                "height": height,
            })
        formats.sort(key=lambda x: x["height"], reverse=True)

        return jsonify({
            "title": info.get("title", ""),
            "thumbnail": info.get("thumbnail", ""),
            "duration": info.get("duration"),
            "uploader": info.get("uploader", ""),
            "formats": formats,
        })
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Timed out fetching video info"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/download", methods=["POST"])
def start_download():
    data = request.json
    url = data.get("url", "").strip()
    format_choice = data.get("format", "video")
    format_id = data.get("format_id")
    title = data.get("title", "")

    if not url:
        return jsonify({"error": "No URL provided"}), 400

    job_id = uuid.uuid4().hex[:10]
    jobs[job_id] = {"status": "downloading", "url": url, "title": title}

    thread = threading.Thread(target=run_download, args=(job_id, url, format_choice, format_id))
    thread.daemon = True
    thread.start()

    return jsonify({"job_id": job_id})


@app.route("/api/status/<job_id>")
def check_status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({
        "status": job["status"],
        "error": job.get("error"),
        "filename": job.get("filename"),
    })


@app.route("/api/file/<job_id>")
def download_file(job_id):
    job = jobs.get(job_id)
    if not job or job["status"] != "done":
        return jsonify({"error": "File not ready"}), 404

    filepath = job["file"]
    filename = job["filename"]
    ext = os.path.splitext(filename)[1].lower()

    mime_map = {
        ".mp4": "video/mp4",
        ".mp3": "audio/mpeg",
        ".webm": "video/webm",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
    }
    mimetype = mime_map.get(ext, "application/octet-stream")

    response = send_file(
        filepath,
        as_attachment=True,
        download_name=filename,
        mimetype=mimetype,
    )
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    host = os.environ.get("HOST", "0.0.0.0")
    app.run(host=host, port=port)
