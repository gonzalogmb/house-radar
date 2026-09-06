# Playwright's own image ships Chromium plus its system libraries already installed.
FROM mcr.microsoft.com/playwright/python:v1.49.1-noble

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY web ./web

ENV HR_DATA_DIR=/data \
    PYTHONUNBUFFERED=1 \
    PORT=8000
VOLUME ["/data"]
EXPOSE 8000

# Shell form so $PORT expands — Render (and most PaaS hosts) inject their own port
# and expect the container to bind to it instead of a fixed one.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
