#!/usr/bin/env bash
# Assemble deploy/hf-space/ from the project: only what the Space needs, in the same
# folder layout the code expects. Re-run after any change (model files, chatbot index,
# frontend, prompt) and upload the folder again.
#
#   deploy/build-space.sh
#   hf upload <user>/<space-name> deploy/hf-space . --repo-type space
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/deploy/hf-space"

rm -rf "$OUT"
mkdir -p "$OUT/Modeling/api" "$OUT/Modeling/utilities" "$OUT/Modeling/models" \
         "$OUT/Chatbot" "$OUT/web-app/guide-service" "$OUT/web-app/backend" "$OUT/web-app/frontend" \
         "$OUT/deploy/space"

# the Space's own files: the Dockerfile must sit at the root of a Space repo; it copies
# app.py and requirements.txt from deploy/space/, the same place they live in the project
cp "$ROOT"/deploy/Dockerfile "$OUT/Dockerfile"
cp "$ROOT"/deploy/space/{README.md,.gitattributes,.gitignore} "$OUT/"
cp "$ROOT"/deploy/space/{app.py,requirements.txt} "$OUT/deploy/space/"

# model service: the API, the one utility it imports, the served model's five files
cp "$ROOT"/Modeling/api/*.py "$OUT/Modeling/api/"
cp "$ROOT"/Modeling/utilities/build_features.py "$OUT/Modeling/utilities/"
cp "$ROOT"/Modeling/models/lightgbm_tuned_v2* "$OUT/Modeling/models/"

# research guide: the chatbot code and its index
cp "$ROOT"/Chatbot/{chat.py,config.py} "$OUT/Chatbot/"
cp -R "$ROOT"/Chatbot/db "$OUT/Chatbot/db"
cp "$ROOT"/web-app/guide-service/main.py "$OUT/web-app/guide-service/"

# frontend source (built inside the Dockerfile) plus the workspace manifests npm needs
cp "$ROOT"/web-app/{package.json,package-lock.json} "$OUT/web-app/"
cp "$ROOT"/web-app/backend/package.json "$OUT/web-app/backend/"
cp "$ROOT"/web-app/frontend/{index.html,package.json,vite.config.js,tailwind.config.js,postcss.config.js} "$OUT/web-app/frontend/"
cp -R "$ROOT"/web-app/frontend/public "$OUT/web-app/frontend/public"
cp -R "$ROOT"/web-app/frontend/src "$OUT/web-app/frontend/src"

# never ship these
find "$OUT" -name "__pycache__" -type d -prune -exec rm -rf {} + 2>/dev/null || true
find "$OUT" -name ".DS_Store" -delete 2>/dev/null || true

echo "Space folder ready: $OUT ($(du -sh "$OUT" | cut -f1))"
