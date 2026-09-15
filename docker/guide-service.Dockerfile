# The research-guide service: web-app/guide-service/main.py wrapping Chatbot/chat.py,
# with the Chroma index baked in. Rebuild this image after re-running
# `python Chatbot/ingest.py` so the container picks up the new index.
FROM python:3.12-slim

WORKDIR /app

COPY docker/requirements-guide.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# main.py finds the chatbot at ../../Chatbot relative to itself, so keep that shape
COPY Chatbot/config.py Chatbot/chat.py ./Chatbot/
COPY Chatbot/db ./Chatbot/db
COPY web-app/guide-service/main.py ./web-app/guide-service/main.py

WORKDIR /app/web-app/guide-service

# OPENAI_API_KEY comes from the environment (docker-compose passes it in); config.py
# checks the environment before it looks for any .env file.
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health')" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
