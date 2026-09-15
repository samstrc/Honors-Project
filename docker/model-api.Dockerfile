# The model service: Modeling/api/main.py + the served model. Nothing else from
# Modeling/ is needed at runtime, so only those pieces are copied in.
FROM python:3.12-slim

# lightgbm's wheel links against OpenMP
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/Modeling

COPY docker/requirements-model.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# same layout as the repo, so api/main.py's relative paths (../utilities, ../models)
# resolve exactly as they do when run from the Modeling/ folder locally
COPY Modeling/api ./api
COPY Modeling/utilities/build_features.py ./utilities/build_features.py
COPY Modeling/models/lightgbm_tuned_v2* ./models/

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
