# Consumer Loan Preapproval — web app

A second front end for the same project as `../Streamlit Website/`: same LightGBM model,
same FastAPI service, same research-guide chatbot, same findings, nothing recomputed or
re-derived. This is a React + Express rebuild of the presentation layer only, polished into
something closer to a real product, living alongside the original rather than replacing it.

Four pages, reachable from the nav bar: **What the data says** (findings), **Preapproval
tool** (the form + model score), **About the research** (a chatbot that answers questions
using the project's own write-up), and **About me**.

## How it's put together

```
web-app/
  frontend/         React + Vite + Tailwind. No secrets, no model or chatbot logic.
  backend/          A small Express server. Three routes, all pure proxies:
                       POST /api/predict      -> Modeling/api/main.py     (the model)
                       POST /api/chat         -> guide-service/main.py    (the chatbot)
                       POST /api/chat/stream  -> guide-service/main.py    (same, streamed)
  guide-service/    A thin FastAPI wrapper around ../../Chatbot/chat.py's Guide class,
                     so the chatbot is reachable over HTTP the same way the model is.
                     /answer returns the whole reply at once; /answer/stream sends it as
                     server-sent events (retrieval progress, the passages found, then the
                     answer as it is written) so the page can show each step as it happens.
```

Nothing about the model, the scoring, the threshold, the explanations behind a score, the
chatbot's source material, or the underlying findings was changed or reimplemented. All of
that logic lives exactly once, in the project's existing Python code:

- `Modeling/api/main.py` — feature building, prediction, thresholding, explaining a score.
  `backend/` forwards `/api/predict` to it and returns its response verbatim.
- `Chatbot/chat.py` — the chatbot: condensing follow-up questions, finding the relevant
  parts of the project's write-up, answering, and citing what it used. `guide-service/main.py`
  imports `Guide` from it directly and exposes `.answer()` and `.answer_stream()` over
  HTTP (the streaming variant runs the identical pipeline and only streams the final
  completion); `backend/` forwards `/api/chat` and `/api/chat/stream` there and returns
  the responses verbatim.

The findings numbers (`frontend/public/data/*.json`) are copies of
`Modeling/utilities/results/site_findings.json` and `risk_distribution.json` — re-copy them
here if you ever regenerate those (the Streamlit site reads the same files directly, so
this isn't new duplication, just the same "precomputed JSON, not recomputed on every load"
approach the original site already uses).

## The About me page

Everything personal on `/about` lives in one `PROFILE` object at the top of
`frontend/src/pages/AboutPage.jsx` -- name, one-line title, tagline, location, bio
paragraphs, a row of fact tiles, and links. Edit that and nothing else needs touching.
For the photo, drop an image into `frontend/public/` (e.g. `me.jpg`) and set
`photo: "/me.jpg"`; until the file exists the page shows your initials instead of a
broken image.

## Running it

**Four** things running: the model API, the guide service, this backend, and this
frontend. Four terminal tabs.

```bash
# tab 1: the model service (from the project root)
cd "Modeling"
conda activate honorsproject
uvicorn api.main:app --port 8000

# tab 2: the research-guide service (needs its search index already built --
# same requirement the Streamlit "About the research" page has)
cd "Chatbot"
python ingest.py                       # one-time / whenever the write-up changes
cd "../web-app/guide-service"
conda activate honorsproject           # same env; it already has the packages chat.py needs
uvicorn main:app --port 8001

# tab 3 + 4: this web app (from web-app/, one time)
cd "web-app"
npm install          # installs both frontend/ and backend/ via npm workspaces
cp backend/.env.example backend/.env   # defaults are already correct for local dev
npm run dev           # runs the backend (8787) and the frontend (5173) together
```

Then open **http://localhost:5173**. The preapproval tool needs tab 1; without it,
submitting the form shows a clear error instead of hanging. The guide page needs tab 2;
without it, it shows a message explaining what's missing instead of crashing. Both
degrade independently -- you can use the preapproval tool with the guide service down, and
vice versa.

### Running it with Docker

The same four processes, as four containers, from the project root (one level above
`web-app/`):

```bash
docker compose up --build        # first run builds the images; later runs are quick
```

Then open **http://localhost:8080**. `Ctrl-C` stops it; `docker compose down` removes
the containers.

What runs:

| service         | image                          | what it is                                   |
|-----------------|--------------------------------|----------------------------------------------|
| `model-api`     | `docker/model-api.Dockerfile`  | `Modeling/api/main.py` + the served model    |
| `guide-service` | `docker/guide-service.Dockerfile` | `guide-service/main.py` + the Chroma index |
| `backend`       | `docker/backend.Dockerfile`    | the Express proxy                            |
| `web`           | `docker/web.Dockerfile`        | the built frontend behind nginx, on :8080    |

Only `web` publishes a port. nginx serves the static build and forwards `/api` to
`backend`, which forwards on to the two Python services by their compose service names,
so nothing needs to know about localhost ports.

The chatbot's `OPENAI_API_KEY` is read from `Modeling/.env`, the same place the rest of
the project keeps it; compose passes that file into the `guide-service` container only.
Without it the tool and findings pages still work and the guide page explains what is
missing.

The images stay small because `.dockerignore` leaves out the 2.5 GB of raw data, the
feature cache, the notebook and the archived work: each image carries only what its
process loads. Two things to remember:

- Re-run `docker compose build guide-service` after `python Chatbot/ingest.py`, since the
  index is baked into that image.
- Re-run `docker compose build model-api` if the served model files in `Modeling/models/`
  change.

### Deploying it (free) to a Hugging Face Space

A free Docker Space (2 vCPU, 16 GB RAM) runs the whole site in one container:
`deploy/space/app.py` mounts the model API and the guide in a single FastAPI process,
answers the same `/api/...` routes the Express proxy answers locally, and serves the
built frontend. Nothing is reimplemented; the two services' route functions are called
in-process instead of over HTTP.

One-time setup:

1. Create a free account at huggingface.co and make a new Space: **Docker** SDK, blank
   template, public or private, any name (say `preapproval`).
2. In the Space's *Settings → Variables and secrets*, add a **secret** named
   `OPENAI_API_KEY` with your key. The guide reads it from the environment.
3. Log in once from the terminal: `hf auth login` (paste a token from
   huggingface.co/settings/tokens with *write* access).

Then, from the project root, every time you want to publish:

```bash
deploy/build-space.sh                                   # assembles deploy/hf-space/
hf upload <your-user>/preapproval deploy/hf-space . --repo-type space
```

The Space builds the image (about five minutes the first time) and comes up at
`https://<your-user>-preapproval.hf.space`. `build-space.sh` copies only what the
container needs (12 MB: the API, the served model, the chatbot code and index, and the
frontend source), so re-run it after changing the model files, the index, the prompt,
or the site, and upload again. Free Spaces sleep after 48 hours without visitors and
wake on the next request in about half a minute.

### Building for production

```bash
npm run build     # builds the static frontend into frontend/dist/
npm start         # runs the backend only; serve frontend/dist/ behind any static host
                   # or a reverse proxy that forwards /api to the backend
```

## Keys and secrets

`web-app/backend/` holds no API keys at all — it's a pure proxy and doesn't need any.
`OPENAI_API_KEY` lives exactly where it already did before this web app existed: in
`Modeling/.env` or `Chatbot/.env`, read by `Chatbot/config.py`'s `get_api_key()`, which
`guide-service/main.py` inherits for free by importing `Guide` from `Chatbot/chat.py`
directly. Nothing new to configure, nothing duplicated.

## What's different from the Streamlit site

- One continuous app instead of four Streamlit pages, with client-side routing between
  them and no full-page reloads.
- The chatbot and the model are reached over HTTP from two small services
  (`guide-service/`, `Modeling/api/`) instead of being imported in-process the way
  Streamlit does it — necessary because a browser-based frontend can't import Python
  directly. Both services are thin wrappers with no logic of their own; the actual
  model and chatbot code is untouched and lives in one place each.
- Charts are hand-built SVG/CSS instead of Plotly, styled from the same earth palette
  (`Streamlit Website/theme.py`, ported to `frontend/src/index.css` as CSS variables,
  light and dark).

## Known leftovers this environment couldn't clean up

Two rounds of review found dead files and asked to delete them, but this environment's
sandbox doesn't have filesystem-delete permission on this project folder, so they're still
here. Each is harmless (nothing imports or reads them) but worth removing by hand:

```bash
rm backend/corpus.js backend/rag.js     # dead code -- see the comment at the top of each
rm backend/.gitignore                   # redundant, root .gitignore already covers it
rm -rf frontend/dist                    # stale build output from an earlier `npm run build`
rm -rf guide-service/__pycache__        # Python bytecode cache, now gitignored so it won't return
```
