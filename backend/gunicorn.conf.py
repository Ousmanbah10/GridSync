# Loaded automatically by gunicorn from the working directory (Render's root is backend/).
# Web research and AI analyses call Gemini and can take up to a couple of minutes;
# the default 30-second worker timeout would kill them before results are saved.
timeout = 180
graceful_timeout = 30
# One worker keeps the in-memory "already running" locks consistent across requests.
workers = 1
threads = 4
