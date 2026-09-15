"""
Entry point for the project website.

    streamlit run site.py

Three pages, ordered as a reader would move through them: what the data says, then the
tool built from it, then the research behind both.

`st.set_page_config` lives here and only here. Streamlit permits exactly one call per run,
so a page script that calls it again raises; each page guards its own call so it still
works when run directly.
"""

import streamlit as st

st.set_page_config(page_title="Consumer Loan Preapproval", page_icon="•", layout="centered")

PAGES = [
    st.Page("findings_page.py", title="What the data says",
            icon=":material/insights:", default=True),
    st.Page("streamlit_app.py", title="Preapproval tool", icon=":material/calculate:"),
    st.Page("guide_page.py", title="About the research", icon=":material/forum:"),
]

st.navigation(PAGES).run()
