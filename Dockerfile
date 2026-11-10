# The whole site in one container: stage 1 builds the React frontend, stage 2 runs the
# FastAPI backend, which serves the API and the built site on one port. Used by Render
# (render.yaml). Built from the repository root, so the COPY paths are the repo's own.

FROM node:22-alpine AS build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM python:3.12-slim

# lightgbm links against OpenMP
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Run unprivileged; files it may write (Chroma's sqlite) are its own.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH
WORKDIR /home/user/app

# Only what the process loads, in the repo's own layout so backend/app/paths.py holds.
COPY --chown=user backend/app ./backend/app
COPY --chown=user modeling/features.py ./modeling/features.py
# The served model (MODEL_NAME in backend/app/paths.py), written by modeling/03_train.ipynb
COPY --chown=user modeling/models/lightgbm_form_v3* ./modeling/models/
COPY --chown=user --from=build /build/dist ./frontend/dist

# OPENAI_API_KEY arrives as an environment variable (a Render env var).
# Listens on $PORT if the host sets one (Render does), else 8000.
WORKDIR /home/user/app/backend
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
