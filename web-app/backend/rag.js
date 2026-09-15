/**
 * DEAD FILE -- not imported anywhere. Please delete it (and corpus.js next to it):
 *
 *   rm backend/rag.js backend/corpus.js
 *
 * This used to hold a hand-copied, cut-down version of the chatbot's source material and
 * answer chat questions directly in Node. That was flagged in review as duplicated logic:
 * it was a smaller copy of what ../../Chatbot/ingest.py already builds from the notebook
 * and results files, and would have quietly gone stale as the project changed. It was
 * replaced by ../guide-service/, a thin wrapper that calls the project's real chatbot
 * code (Chatbot/chat.py) over HTTP instead of re-approximating it. See server.js and
 * guide-service/main.py for how the app is wired up now.
 *
 * Two rounds of automated cleanup have tried to delete this file and been refused
 * filesystem permission, so it's still here -- please remove it by hand.
 */
export {};
