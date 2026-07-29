# syntax=docker/dockerfile:1
#
# Two targets from one file:
#   --target dev  → what docker-compose.yml builds: root, source bind-mounted, reload
#   (default)     → what docker-compose.prod.yml builds: non-root, source baked in
#
# The production stage is last on purpose: `docker build` with no --target must
# give the hardened image, never the development one.

# ─── Builder: resolve dependencies into a venv ───
FROM python:3.11-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Toolchain for any dependency without a manylinux wheel for this platform.
# It stays in this stage — only the finished venv is copied forward, so none of
# it reaches a running container.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install -r requirements.txt

# ─── Shared runtime layer ───
FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH="/opt/venv/bin:$PATH"

COPY --from=builder /opt/venv /opt/venv
WORKDIR /app
EXPOSE 8000

# ─── Development ───
# Root, and no source copied: docker-compose.yml bind-mounts the working tree
# over /app and reloads on change. Running as root here is deliberate — a
# non-root uid would collide with the host ownership of that bind mount.
FROM runtime AS dev
COPY requirements-dev.txt .
RUN pip install -r requirements-dev.txt
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# ─── Production (default target) ───
FROM runtime AS production

# UPLOAD_DIR holds uploaded files, per-source SQLite databases and the AutoML
# model signing key, so it must be a mounted volume — not a container-lifetime
# directory, or every restart invalidates every trained model.
ENV UPLOAD_DIR=/data/uploads

RUN useradd --system --create-home --uid 10001 nexusbi \
 && mkdir -p "$UPLOAD_DIR" \
 && chown -R nexusbi:nexusbi /data

COPY --chown=nexusbi:nexusbi . .
USER nexusbi

# python, not curl: the slim image has no curl, and installing one to check a
# health endpoint would add a package for no other reason.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/live', timeout=3)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
