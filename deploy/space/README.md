---
title: Consumer Loan Preapproval
emoji: 🏦
colorFrom: yellow
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# Consumer loan preapproval

An honors research project on the Home Credit Default Risk dataset, served as a site:
what the data says, a preapproval tool backed by a LightGBM model with per-application
explanations, and a research guide that answers questions from the project's own
write-up.

This Space runs the whole thing in one container: the model API, the retrieval-augmented
guide, and the React frontend. Set `OPENAI_API_KEY` as a Space secret for the guide;
without it the tool and findings pages still work and the guide page explains what's
missing.

Built by Sam Strickler.
