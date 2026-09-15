"""
Project-guide page for the multipage site.

Only the UI lives here. The retrieval engine stays in `Chatbot/` (corpus, ingest, chat,
config), so the site's pages sit together in one directory the way Streamlit's navigation
expects, and the RAG code stays a package you can still run on its own.
"""

from __future__ import annotations

import os
import sys

import streamlit as st

CHATBOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Chatbot")
if CHATBOT not in sys.path:
    sys.path.insert(0, CHATBOT)

from chat import Guide  # noqa: E402

import theme

INK = theme.get(st)
st.markdown(theme.css(INK), unsafe_allow_html=True)
st.markdown(
    f"""
    <style>
      .src-chip {{
        display: inline-block; font-size: 0.72rem; color: {INK['muted']};
        border: 1px solid {INK['border']}; border-radius: 999px;
        padding: 2px 10px; margin: 3px 4px 0 0;
      }}
    </style>
    """,
    unsafe_allow_html=True,
)

st.markdown('<div class="kicker">Honors research project</div>', unsafe_allow_html=True)
st.markdown('<div class="page-title">About the research</div>', unsafe_allow_html=True)
st.markdown(
    '<div class="page-subtitle">The preapproval tool is the working end of an honors '
    'research project on consumer lending. Ask how the model was built, what the study '
    'found, or how the tool reaches a decision. Answers come from the notebook, the '
    'experiment results and the pipeline source, and each cites where it came from. If '
    'something is not in the project, the guide says so rather than guessing.</div>',
    unsafe_allow_html=True,
)
st.write("")


@st.cache_resource(show_spinner=False)
def get_guide() -> Guide:
    return Guide()


try:
    guide = get_guide()
except SystemExit as e:
    st.error(str(e))
    st.info("Build the index first:  `cd Chatbot && python ingest.py`")
    st.stop()

if "messages" not in st.session_state:
    st.session_state.messages = []

STARTERS = [
    "What did this project actually find?",
    "How does the tool decide to approve or decline?",
    "What kind of loans is this trained on?",
    "How good is the model at catching missed payments?",
]

if not st.session_state.messages:
    st.caption("Try one of these:")
    cols = st.columns(2)
    for i, s in enumerate(STARTERS):
        if cols[i % 2].button(s, use_container_width=True, key=f"starter_{i}"):
            st.session_state.pending = s
            st.rerun()

for m in st.session_state.messages:
    with st.chat_message(m["role"]):
        st.markdown(m["content"])
        if m.get("sources"):
            st.markdown(
                "".join(f'<span class="src-chip">{s}</span>' for s in dict.fromkeys(m["sources"])),
                unsafe_allow_html=True,
            )

prompt = st.chat_input("Ask about the project…") or st.session_state.pop("pending", None)

if prompt:
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        with st.spinner("Searching the project…"):
            # Only role/content reach the model; stored source lists are UI state.
            history = [{"role": m["role"], "content": m["content"]}
                       for m in st.session_state.messages[:-1]]
            try:
                text, sources = guide.answer(prompt, history)
            except Exception as e:
                text, sources = f"Something went wrong: `{type(e).__name__}: {e}`", []
        st.markdown(text)
        labels = [f"{s['source']} · {s['section']}" if s["section"] else s["source"]
                  for s in sources]
        if labels:
            st.markdown(
                "".join(f'<span class="src-chip">{s}</span>' for s in dict.fromkeys(labels)),
                unsafe_allow_html=True,
            )

    st.session_state.messages.append({"role": "assistant", "content": text, "sources": labels})
    st.rerun()
