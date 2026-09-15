# The whole site in one container: stage 1 builds the React frontend, stage 2 runs the
# model API, the research guide and the static site in a single FastAPI process
# (deploy/space/app.py). Built from the repository root, so the COPY paths below are the
# project's own. Used by Render (render.yaml) and by the Hugging Face Space folder that
# deploy/build-space.sh assembles.

FROM node:22-alpine AS build
WORKDIR /build
COPY web-app/package.json web-app/package-lock.json ./
COPY web-app/backend/package.json ./backend/
COPY web-app/frontend/package.json ./frontend/
RUN npm ci --workspace frontend
COPY web-app/frontend ./frontend
RUN npm run build --workspace frontend

FROM python:3.12-slim

# lightgbm links against OpenMP
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

COPY deploy/space/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Run unprivileged (Spaces require UID 1000); files it may write (Chroma's sqlite) are its.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH
WORKDIR /home/user/app

# only what the process loads, in the repo's own layout so relative paths hold
COPY --chown=user Modeling/api ./Modeling/api
COPY --chown=user Modeling/utilities/build_features.py ./Modeling/utilities/build_features.py
COPY --chown=user Modeling/models/lightgbm_tuned_v2* ./Modeling/models/
COPY --chown=user Chatbot/chat.py Chatbot/config.py ./Chatbot/
COPY --chown=user Chatbot/db ./Chatbot/db
COPY --chown=user web-app/guide-service/main.py ./web-app/guide-service/main.py
COPY --chown=user --from=build /build/frontend/dist ./web-app/frontend/dist
COPY --chown=user deploy/space/app.py ./app.py

# OPENAI_API_KEY arrives as an environment variable (Render env var / Space secret),
# which is the first place the guide looks for it.
# Listens on $PORT if the host sets one (Render, Cloud Run), else 7860 (Spaces).
EXPOSE 7860
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-7860}"]
