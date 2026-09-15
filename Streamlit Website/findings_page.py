"""
Findings: what the data says, before any model is involved.

The home page of the site. Its job is to make the problem legible to someone who has
never seen the dataset, so it leads with what these loans are and what actually separates
people who miss a payment from people who don't.

Numbers are precomputed by `Modeling/utilities/site_findings.py` into a small JSON. Reading 2.5 GB of CSV
on every page load would make the site unusable, and none of these figures change unless
the data does.

Charts follow the project's mark specs: one hue per series, 4px rounded data-ends, a
hairline recessive grid, and values direct-labelled at the bar tip rather than left to a
tooltip.
"""

from __future__ import annotations

import json
import os

import plotly.graph_objects as go
import streamlit as st

import theme

INK = theme.get(st)
st.markdown(theme.css(INK), unsafe_allow_html=True)

RESULTS = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "Modeling", "utilities", "results")


@st.cache_data(show_spinner=False)
def load_stats():
    with open(os.path.join(RESULTS, "site_findings.json")) as f:
        return json.load(f)


try:
    S = load_stats()
except FileNotFoundError:
    st.error("Findings not built yet. Run `python Modeling/utilities/site_findings.py`.")
    st.stop()


def rate_bar(rows, color, height=None, pct_key="rate"):
    """Horizontal bar of a rate per band, ordered as given, labelled at the tip."""
    labels = [r["band"] for r in rows][::-1]
    vals = [r[pct_key] * (100 if pct_key == "rate" else 1) for r in rows][::-1]
    ns = [r.get("n") for r in rows][::-1]
    fig = go.Figure(go.Bar(
        x=vals, y=labels, orientation="h",
        marker=dict(color=color, cornerradius=4),
        text=[f"{v:.1f}%" for v in vals], textposition="outside", cliponaxis=False,
        customdata=[f"{n:,}" if n else "" for n in ns],
        hovertemplate="<b>%{y}</b><br>%{x:.1f}%<br>%{customdata} applicants<extra></extra>",
    ))
    lay = theme.plotly_layout(INK)
    lay["xaxis"].update(showgrid=True, ticksuffix="%")
    lay["yaxis"].update(showgrid=False)
    fig.update_layout(**lay, height=height or (56 + 34 * len(rows)), bargap=0.4,
                      showlegend=False)
    return fig


# ----------------------------------------------------------------------------------
st.markdown("<div class='kicker'>Home Credit &nbsp;·&nbsp; honors research project</div>",
            unsafe_allow_html=True)
st.markdown("<div class='page-title'>What the data says</div>", unsafe_allow_html=True)
st.markdown(
    "<div class='page-subtitle'>Before building anything, it's worth knowing what "
    "separates the people who keep up with payments from the people who don't. These are "
    "everyday consumer loans, the kind you take out for a phone, a laptop or furniture, "
    "or as a small cash loan. Here's what 307,511 of them look like.</div>",
    unsafe_allow_html=True,
)
st.write("")

st.markdown(
    f"""
    <div class="facts-row">
      <div class="fact"><div class="fact-value">{S['n']:,}</div>
        <div class="fact-label">loan applications</div></div>
      <div class="fact"><div class="fact-value">{S['miss_rate']:.1%}</div>
        <div class="fact-label">missed an early payment</div></div>
      <div class="fact"><div class="fact-value">{S['term']['median']:.0f} months</div>
        <div class="fact-label">typical time to pay one back</div></div>
    </div>
    """,
    unsafe_allow_html=True,
)

try:
    st.page_link("streamlit_app.py", label="**Try the preapproval tool.** Score an "
                                           "application and see where it lands.",
                 icon=":material/calculate:")
    st.write("")
except Exception:
    pass

st.divider()

# --- 1. the dominant signal -------------------------------------------------------
lo, hi = S["by_ext_score"][0]["rate"], S["by_ext_score"][-1]["rate"]
st.markdown("<div class='section-title'>Credit bureau scores separate people more than "
            "anything else</div>", unsafe_allow_html=True)
st.markdown(
    f"<div class='section-sub'>Each applicant carries up to three creditworthiness scores "
    f"from outside bureaus. Sorting everyone by their average and splitting into fifths, "
    f"the riskiest fifth misses a payment <b>{lo/hi:.1f} times</b> as often as the safest. "
    f"Nothing else in the data comes close.</div>",
    unsafe_allow_html=True,
)
st.plotly_chart(rate_bar(S["by_ext_score"], INK["cat"][0]), use_container_width=True,
                config={"displayModeBar": False})
st.caption(f"{S['ext_missing_rate']:.0%} of applicants have no bureau score at all, which "
           f"is itself informative: the model treats missing as its own signal rather than "
           f"filling it in.")

st.write("")

# --- 2. affordability -------------------------------------------------------------
st.markdown("<div class='section-title'>How much of your income the payment eats</div>",
            unsafe_allow_html=True)
st.markdown(
    "<div class='section-sub'>The monthly payment as a share of monthly income. This is "
    "the quantity a lender underwrites on, and it matters far more than income by itself: "
    "in the final model, changing stated income barely moves a prediction, while changing "
    "the payment moves it a lot.</div>",
    unsafe_allow_html=True,
)
st.plotly_chart(rate_bar(S["by_dsr"], INK["cat"][1]), use_container_width=True,
                config={"displayModeBar": False})

st.write("")

# --- 3. age + employment ----------------------------------------------------------
c1, c2 = st.columns(2)
with c1:
    st.markdown("<div class='section-title'>Age</div>", unsafe_allow_html=True)
    st.markdown("<div class='section-sub'>Younger applicants miss payments more often, and "
                "it falls steadily with age.</div>", unsafe_allow_html=True)
    st.plotly_chart(rate_bar(S["by_age"], INK["cat"][2]), use_container_width=True,
                    config={"displayModeBar": False})
with c2:
    st.markdown("<div class='section-title'>Time in the job</div>", unsafe_allow_html=True)
    st.markdown("<div class='section-sub'>Recent starters are the riskiest group. Pensioners "
                "are excluded here since they have no employment record.</div>",
                unsafe_allow_html=True)
    st.plotly_chart(rate_bar(S["by_employment"], INK["cat"][3]), use_container_width=True,
                    config={"displayModeBar": False})

st.write("")

# --- 4. education -----------------------------------------------------------------
st.markdown("<div class='section-title'>Education</div>", unsafe_allow_html=True)
st.markdown("<div class='section-sub'>A clear gradient, though a smaller one than the "
            "bureau scores. Bands with fewer than 500 applicants are left out.</div>",
            unsafe_allow_html=True)
st.plotly_chart(rate_bar(S["by_education"], INK["cat"][4]), use_container_width=True,
                config={"displayModeBar": False})

st.write("")

# --- 5. what the loans were for ---------------------------------------------------
st.markdown("<div class='section-title'>What people actually borrowed for</div>",
            unsafe_allow_html=True)
st.markdown(
    f"<div class='section-sub'>From prior applications, where the financed item is "
    f"recorded. Half the median loan is repaid inside "
    f"{S['term']['median']:.0f} months and the longest runs "
    f"{S['term']['max']:.0f}. This is consumer credit, not mortgages.</div>",
    unsafe_allow_html=True,
)
st.plotly_chart(rate_bar(S["goods"], INK["cat"][0], pct_key="pct"),
                use_container_width=True, config={"displayModeBar": False})

st.divider()
st.markdown(
    "<div class='footnote'>Rates are the share of applicants in each band who missed a "
    "payment more than a few days late on one of the first instalments, which is what the "
    "dataset records. The dataset's own currency is anonymised, so the preapproval page "
    "takes dollars and converts them at a fixed rate set so the typical applicant earns "
    "$4,300 a month. Income is monthly.</div>",
    unsafe_allow_html=True,
)
