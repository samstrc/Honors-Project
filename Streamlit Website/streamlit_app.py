import os

import plotly.graph_objects as go
import requests
import streamlit as st

API_URL = os.environ.get("PREAPPROVAL_API_URL", "http://localhost:8000")

# Measured in Part 2 of the notebook and copied here rather than fetched, since they
# only change when the model is retrained. Source: utilities/results/ablation.json.
MODEL_AUC = 0.797          # full model, with a complete credit history
MODEL_AUC_APPONLY = 0.760  # what a preapproval form actually reaches. The history
                           # aggregates are missing, but the API rebuilds the 80 cohort
                           # features from the exported lookup tables: 0.744 -> 0.760.
MODEL_AP = 0.302

# The dataset's currency is anonymised, so there is no exchange rate to look up. This is a
# calibration constant, not an exchange rate: it maps the dataset's median applicant income
# (147,150 a month) onto $4,300 a month, so someone entering dollars lands in the same part
# of the population an equivalent Home Credit applicant would. Every amount the form
# collects is multiplied by it before scoring. That matters because 80 of the model's
# features compare an applicant's income against their cohort's average, and those only
# mean anything if the applicant is measured on the same scale as the training data.
#
# The exact anchor is not load-bearing. Moving it from $3,000 to $6,670 a month changes a
# typical applicant's predicted risk by 0.26 percentage points and one percentile, because
# scaling every amount by the same rate leaves the payment-to-income and loan-to-income
# ratios untouched, and those carry most of the signal. What did matter was converting at
# all: entering dollars unconverted, off by 36x, moved the same applicant 2.2 points.
TYPICAL_INCOME_USD = 4_300.0
DATASET_MEDIAN_INCOME = 147_150.0
USD_TO_UNITS = DATASET_MEDIAN_INCOME / TYPICAL_INCOME_USD   # 34.2209 units per dollar

# From the same reference file the percentile uses: the held-out set scored form-only,
# the way this tool scores. Using the full-history distribution instead misplaces the
# "typical applicant" tick and stretches the track past the range the scores occupy.
RISK_SCALE_MAX = 0.30     # matches the distribution chart, and covers 99.7% of scores
RISK_MEDIAN = 0.0606      # p50 of the form-only reference distribution

import theme

INK = theme.get(st)
STATUS_GOOD = INK["good"]
STATUS_CRITICAL = INK["critical"]
DIVERGING_RED = INK["pos"]     # raises risk
DIVERGING_BLUE = INK["neg"]    # lowers risk
ACCENT = INK["accent"]

try:
    st.set_page_config(page_title="Consumer Loan Preapproval", page_icon="•", layout="centered")
except st.errors.StreamlitAPIException:
    pass   # site.py already configured it in the multipage run

st.markdown(theme.css(INK), unsafe_allow_html=True)
st.markdown(
    f"""
    <style>
      .result-card {{
        background: {INK['card']}; border: 1px solid {INK['border']};
        border-radius: 14px; padding: 26px 28px 22px 28px; margin: 8px 0 28px 0;
      }}
      .snapshot-row {{
        display: flex; flex-wrap: wrap; gap: 0; border: 1px solid {INK['border']};
        border-radius: 10px; overflow: hidden; margin: 4px 0 32px 0;
        background: {INK['card']};
      }}
      .snapshot-chip {{ flex: 1 1 140px; padding: 14px 18px; border-right: 1px solid {INK['border']}; }}
      .snapshot-chip:last-child {{ border-right: none; }}
      .snapshot-label {{
        font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em;
        color: {INK['muted']}; margin-bottom: 3px;
      }}
      .snapshot-value {{ font-size: 0.95rem; font-weight: 600; color: {INK['primary']}; }}
      .status-row {{ display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }}
      .status-dot {{ width: 9px; height: 9px; border-radius: 50%; display: inline-block; }}
      .status-word {{ font-size: 0.8rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }}
      .hero-number {{
        font-size: clamp(48px, 7vw, 66px); font-weight: 700; line-height: 1.05;
        color: {INK['primary']}; margin: 2px 0 4px 0;
        font-variant-numeric: proportional-nums; letter-spacing: -0.02em;
      }}
      .hero-caption {{ color: {INK['secondary']}; font-size: 0.92rem; margin-bottom: 28px; }}
      .meter-track {{ position: relative; height: 14px; border-radius: 4px; overflow: hidden; margin: 6px 0 0 0; }}
      .meter-fill {{ height: 100%; border-radius: 0 4px 4px 0; }}
      .meter-ticks {{ position: relative; height: 30px; margin-top: 6px; }}
      .meter-tick {{ position: absolute; transform: translateX(-50%); text-align: center; }}
      .meter-tick-line {{ width: 2px; height: 8px; margin: 0 auto 3px auto; border-radius: 1px; }}
      .meter-tick-label {{ font-size: 0.72rem; color: {INK['muted']}; white-space: nowrap; }}
      .meter-ends {{ display: flex; justify-content: space-between; font-size: 0.72rem; color: {INK['muted']}; margin-top: 2px; }}
      @media (max-width: 640px) {{
        .meter-tick-label {{ font-size: 0.62rem; }}
        .meter-ends {{ font-size: 0.62rem; }}
      }}
    </style>
    """,
    unsafe_allow_html=True,
)

with st.sidebar:
    st.markdown("<div class='kicker'>About this tool</div>", unsafe_allow_html=True)
    st.write(
        "A LightGBM model trained on 307,511 consumer loan applications from Home Credit. "
        "It reads 693 features: the application itself, plus what the credit bureau knows "
        "about the applicant, their past applications, and how they repaid them."
    )
    st.write(
        "It doesn't reweight the classes, which means the probabilities mean what they "
        "say. It predicts 7.9% on average against a real rate of 8.1%, with nothing "
        "corrected afterwards."
    )
    col1, col2 = st.columns(2)
    col1.metric("With a full credit file", f"{MODEL_AUC:.3f}")
    col2.metric("From the form alone", f"{MODEL_AUC_APPONLY:.3f}")
    st.caption(
        "Two numbers because they answer different questions. The model scores "
        f"{MODEL_AUC:.3f} AUC when it can look up the applicant's credit history. A "
        "preapproval form has no history to look up, so about 600 of the 693 features "
        f"arrive empty and it works out closer to {MODEL_AUC_APPONLY:.3f}. That second "
        "number is the one this page is actually delivering."
    )
    st.divider()
    st.caption(
        "\"Risk\" here means what the dataset actually recorded: a payment more than a "
        "few days late on one of the first instalments. That's an early stumble, not a "
        "written-off loan. It happened to 8.07% of applicants."
    )
    st.caption(
        "Built as part of an honors research project. Predictions are illustrative "
        "only and not a real lending decision."
    )

st.markdown("<div class='kicker'>Home Credit &nbsp;·&nbsp; honors research project</div>", unsafe_allow_html=True)
st.markdown("<div class='page-title'>Consumer loan preapproval</div>", unsafe_allow_html=True)
st.markdown(
    "<div class='page-subtitle'>Fill in a few details and see how likely this applicant "
    "is to miss an early payment. These are everyday <b>consumer loans</b>, the kind you "
    "take out for a phone, a laptop or furniture, or as a small cash loan. Most are paid "
    "back inside a year. No mortgages here.</div>",
    unsafe_allow_html=True,
)
st.write("")

# st.page_link only works inside a multipage run, so this is skipped when the file is
# run on its own.
try:
    st.page_link("guide_page.py",
                 label="**About the research.** How the model was built, what the study "
                       "found, and why the form asks what it asks.",
                 icon=":material/forum:")
    st.write("")
except Exception:
    pass

st.markdown(
    f"""
    <div class="facts-row">
      <div class="fact">
        <div class="fact-value">307,511</div>
        <div class="fact-label">real applications behind the model</div>
      </div>
      <div class="fact">
        <div class="fact-value">8.1%</div>
        <div class="fact-label">missed an early payment</div>
      </div>
      <div class="fact">
        <div class="fact-value">12 months</div>
        <div class="fact-label">typical time to pay one back</div>
      </div>
    </div>
    """,
    unsafe_allow_html=True,
)

PRESETS = {
    "Strong applicant": {
        "income": 9350.0, "credit_amount": 5840.0, "annuity": 350.0, "goods_price": 5260.0,
        "age_years": 42, "gender": "F", "children": 0, "family_members": 2,
        "family_status": "Married", "education": "Higher education", 
        "income_type": "Working", "occupation": "Managers", "years_employed": 15.0,
        
        "use_ext_scores": True, "ext_score_1": 0.85, "ext_score_2": 0.82, "ext_score_3": 0.80,
        "use_cc": True, "cc_utilization": 0.1,
    },
    "Typical applicant": {
        "income": 4380.0, "credit_amount": 14990.0, "annuity": 730.0, "goods_price": 13150.0,
        "age_years": 43, "gender": "F", "children": 0, "family_members": 2,
        "family_status": "Married", "education": "Secondary / secondary special", 
        "income_type": "Working", "occupation": None, "years_employed": 4.5,
        
        "use_ext_scores": False, "ext_score_1": 0.5, "ext_score_2": 0.5, "ext_score_3": 0.5,
        "use_cc": False, "cc_utilization": 0.3,
    },
    "High-risk applicant": {
        "income": 1170.0, "credit_amount": 29220.0, "annuity": 1900.0, "goods_price": 27760.0,
        "age_years": 21, "gender": "M", "children": 3, "family_members": 5,
        "family_status": "Single / not married", "education": "Lower secondary", 
        "income_type": "Unemployed", "occupation": None, "years_employed": 0.0,
        
        "use_ext_scores": True, "ext_score_1": 0.08, "ext_score_2": 0.06, "ext_score_3": 0.07,
        "use_cc": True, "cc_utilization": 1.7,
    },
}

st.markdown("<div class='row-label'>Start from an example</div>", unsafe_allow_html=True)
preset_cols = st.columns(3)
for col, preset_name in zip(preset_cols, PRESETS):
    if col.button(preset_name, use_container_width=True):
        st.session_state.update(PRESETS[preset_name])
st.write("")

with st.form("application_form"):
    tab_financials, tab_applicant, tab_employment, tab_credit = st.tabs(
        ["Income & loan", "About you", "Employment", "Credit bureau"]
    )

    with tab_financials:
        # Amounts are collected in dollars and converted with USD_TO_UNITS before being
        # sent to the API, which speaks the dataset's own units. The dataset's currency is
        # anonymised: bureau.csv has a CREDIT_CURRENCY column holding "currency 1" through
        # "currency 4", and nothing names a real one, so the rate is a calibration choice
        # rather than a lookup. It is stated on the page so nobody mistakes it for one.
        st.caption(
            "Enter amounts in **US dollars**. Income is **monthly**, before tax. The "
            "dataset's own currency is anonymised, so dollars are converted at a fixed "
            "rate set so the typical applicant earns $4,300 a month. That rate is a "
            "calibration constant, not a real exchange rate. For scale, the typical "
            "applicant borrows about $15,000, roughly 3.3 months of income paid back "
            "over 20 months."
        )
        col1, col2 = st.columns(2)
        with col1:
            income = st.number_input(
                "Monthly income before tax ($)", min_value=1000.0, max_value=25000.0, value=4300.0, step=100.0,
                key="income",
                help="Gross monthly income, before tax and deductions. The dataset states "
                     "neither the period nor whether income is gross or net. The period is "
                     "settled by arithmetic: read as monthly the median payment is 16.9% of "
                     "income, read as annual it would be 203%, which is impossible. Gross is "
                     "an assumption, and a minor one -- entering net instead moves a typical "
                     "result by about 0.2 percentage points.",
            )
            credit_amount = st.number_input(
                "Amount you want to borrow ($)", min_value=1500.0, max_value=120000.0, value=15000.0, step=500.0,
                key="credit_amount",
                help="The loan principal, before interest.",
            )
        with col2:
            annuity = st.number_input(
                "Monthly payment ($)", min_value=100.0, max_value=7500.0, value=730.0, step=25.0, key="annuity",
                help="What you would pay each month. The dataset calls this the 'annuity'. "
                     "Across prior loans, monthly payment x number of payments comes to about "
                     "1.26x the amount borrowed -- the rest is interest.",
            )
            goods_price = st.number_input(
                "Price of the item being bought ($, optional)", min_value=0.0, max_value=120000.0, value=13150.0,
                step=500.0, key="goods_price",
                help="For a purchase loan -- a car or appliance, say. Leave at 0 for a cash loan "
                     "with nothing attached to it.",
            )

    with tab_applicant:
        col1, col2, col3 = st.columns(3)
        with col1:
            age_years = st.number_input("Age", min_value=18, max_value=75, value=35, key="age_years")
            gender = st.selectbox("Gender", ["F", "M"], key="gender")
        with col2:
            children = st.number_input("Children", min_value=0, max_value=12, value=0, key="children")
            family_members = st.number_input(
                "People in household", min_value=1, max_value=15, value=1, key="family_members",
                help="Everyone living in the home, including you and any children.",
            )
        with col3:
            family_status = st.selectbox(
                "Family status",
                ["Married", "Single / not married", "Civil marriage", "Separated", "Widow", "Unknown"],
                key="family_status",
                help="'Civil marriage' means living with a partner without being legally married.",
            )
            education = st.selectbox(
                "Education",
                ["Secondary / secondary special", "Higher education", "Incomplete higher", "Lower secondary", "Academic degree"],
                key="education",
                help="Dataset wording. 'Secondary / secondary special' = finished high school or "
                     "vocational training. 'Incomplete higher' = started university but did not "
                     "finish. 'Lower secondary' = left school before finishing high school.",
            )

    with tab_employment:
        col1, col2 = st.columns(2)
        with col1:
            income_type = st.selectbox(
                "Income source",
                ["Working", "Commercial associate", "State servant", "Pensioner", "Unemployed", "Student", "Businessman", "Maternity leave"],
                key="income_type",
                help="Dataset wording. 'Commercial associate' = employed in the private sector. "
                     "'State servant' = government employee. 'Working' is the generic employed "
                     "category. 'Pensioner' = retired.",
            )
            occupation = st.selectbox(
                "Occupation (optional)",
                [None, "Laborers", "Core staff", "Sales staff", "Managers", "Drivers", "High skill tech staff",
                 "Accountants", "Medicine staff", "Security staff", "Cooking staff", "Cleaning staff",
                 "Private service staff", "Low-skill Laborers", "Secretaries", "Waiters/barmen staff",
                 "HR staff", "Realty agents", "IT staff"],
                key="occupation",
            )
            # Taken from the model schema so the options can't drift from the categories
            # it was trained on. Employer type is the second-highest-gain feature.
            organization_type = st.selectbox(
                "Type of employer", ["(prefer not to say)", "Advertising", "Agriculture", "Bank", "Business Entity Type 1", "Business Entity Type 2", "Business Entity Type 3", "Cleaning", "Construction", "Culture", "Electricity", "Emergency", "Government", "Hotel", "Housing", "Industry: type 1", "Industry: type 10", "Industry: type 11", "Industry: type 12", "Industry: type 13", "Industry: type 2", "Industry: type 3", "Industry: type 4", "Industry: type 5", "Industry: type 6", "Industry: type 7", "Industry: type 8", "Industry: type 9", "Insurance", "Kindergarten", "Legal Services", "Medicine", "Military", "Mobile", "Other", "Police", "Postal", "Realtor", "Religion", "Restaurant", "School", "Security", "Security Ministries", "Self-employed", "Services", "Telecom", "Trade: type 1", "Trade: type 2", "Trade: type 3", "Trade: type 4", "Trade: type 5", "Trade: type 6", "Trade: type 7", "Transport: type 1", "Transport: type 2", "Transport: type 3", "Transport: type 4", "University", "XNA"], key="organization_type",
                help="The kind of organisation you work for. Leave as 'prefer not to say' "
                     "if none fit; the model handles it being unknown.",
            )
        with col2:
            employed_unknown = income_type in ("Unemployed", "Pensioner", "Student")
            years_employed = st.number_input(
                "Years at your current job", min_value=0.0, max_value=50.0, value=0.0 if employed_unknown else 5.0,
                step=0.5, disabled=employed_unknown, key="years_employed",
                help="Disabled automatically for unemployed, retired, or student applicants.",
            )


    with tab_credit:
        st.caption(
            "In a production system these would come from a live credit bureau pull "
            "rather than self-reporting. These are optional -- check the box for any "
            "you want to include, otherwise the model falls back to typical values "
            "learned from the training population."
        )
        # The sliders stay visible and enabled the whole time. st.form only reruns on
        # submit, so a checkbox inside a form can't reveal or enable other widgets while
        # the user is still filling it in. The checkbox only decides whether the slider
        # values get sent.
        use_ext_scores = st.checkbox("I know my credit bureau scores", key="use_ext_scores")
        st.caption(
            "Three creditworthiness scores from outside credit bureaus, rescaled to 0-1. "
            "**Higher is safer:** applicants in the top quarter default about 3.5% of the "
            "time, against roughly 14% in the bottom quarter. These are the strongest "
            "signals the model has."
        )
        ext_score_1 = st.slider("Bureau score 1", 0.0, 1.0, 0.5, key="ext_score_1",
                                help="0 = riskiest, 1 = safest.")
        ext_score_2 = st.slider("Bureau score 2", 0.0, 1.0, 0.5, key="ext_score_2",
                                help="0 = riskiest, 1 = safest.")
        ext_score_3 = st.slider("Bureau score 3", 0.0, 1.0, 0.5, key="ext_score_3",
                                help="0 = riskiest, 1 = safest.")

        st.write("")
        use_cc = st.checkbox("I have a credit card", key="use_cc")
        cc_utilization = st.slider(
            "How much of your credit limit you use", 0.0, 2.0, 0.3, key="cc_utilization",
            help="Balance divided by limit. 0.3 means using 30% of your limit. Above 1.0 means "
                 "over the limit, which does happen in the data.",
        )

    submitted = st.form_submit_button("Check preapproval", use_container_width=True)

if submitted:
    # Dollars in the form, dataset units on the wire. The API speaks the units the model
    # was trained on, so the conversion happens here rather than there.
    payload = {
        "income": income * USD_TO_UNITS,
        "credit_amount": credit_amount * USD_TO_UNITS,
        "annuity": annuity * USD_TO_UNITS,
        "goods_price": (goods_price * USD_TO_UNITS) if goods_price else None,
        "age_years": age_years,
        "gender": gender,
        "children": children,
        "family_members": family_members,
        "family_status": family_status,
        "education": education,
        "income_type": income_type,
        "occupation": occupation,
        "years_employed": None if employed_unknown else years_employed,
        "organization_type": None if organization_type == "(prefer not to say)" else organization_type,
        "ext_score_1": ext_score_1 if use_ext_scores else None,
        "ext_score_2": ext_score_2 if use_ext_scores else None,
        "ext_score_3": ext_score_3 if use_ext_scores else None,
        "cc_utilization": cc_utilization if use_cc else None,
    }

    try:
        resp = requests.post(f"{API_URL}/predict", json=payload, timeout=10)
        resp.raise_for_status()
        result = resp.json()
    except requests.exceptions.ConnectionError:
        st.error(f"Can't reach the API at {API_URL}. Is it running? (`uvicorn api.main:app`)")
    except requests.exceptions.HTTPError:
        st.error(f"API error: {resp.status_code} {resp.text}")
    else:
        prob = result["default_probability"]
        threshold = result["threshold"]
        decision = result["decision"]
        top_factors = result["top_factors"]
        percentile = result["risk_percentile"]

        is_good = decision == "preapproved"
        status_color = STATUS_GOOD if is_good else STATUS_CRITICAL
        status_label = "Preapproved" if is_good else "Declined"

        st.write("")
        st.divider()

        # --- applicant snapshot: a plain recap of the inputs, ahead of the score ---
        employment_text = "Not currently employed" if employed_unknown else f"{years_employed:.0f} yrs, {occupation or income_type.lower()}"
        st.markdown(
            f"""
            <div class="snapshot-row">
                <div class="snapshot-chip">
                    <div class="snapshot-label">Income</div>
                    <div class="snapshot-value">${income:,.0f}/mo</div>
                </div>
                <div class="snapshot-chip">
                    <div class="snapshot-label">Loan requested</div>
                    <div class="snapshot-value">${credit_amount:,.0f}</div>
                </div>
                <div class="snapshot-chip">
                    <div class="snapshot-label">Age</div>
                    <div class="snapshot-value">{age_years}</div>
                </div>
                <div class="snapshot-chip">
                    <div class="snapshot-label">Education</div>
                    <div class="snapshot-value">{education.split(' / ')[0]}</div>
                </div>
                <div class="snapshot-chip">
                    <div class="snapshot-label">Employment</div>
                    <div class="snapshot-value">{employment_text}</div>
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        # --- decision: the risk number is the headline, not a badge ---
        # A meter rather than a bare number. The decision is a value read against a
        # threshold, so showing where it sits on a track answers "how close was this?".
        # The track is a light step of the fill's hue, and the fill is square at the
        # baseline and rounded 4px at the data end.
        pct_of = lambda v: min(100.0, max(0.0, v / RISK_SCALE_MAX * 100.0))
        st.markdown(
            f"""
            <div class="result-card">
              <div class="status-row">
                <span class="status-dot" style="background:{status_color};"></span>
                <span class="status-word" style="color:{status_color};">{status_label}</span>
              </div>
              <div class="hero-number">{prob:.1%}</div>
              <div class="hero-caption" style="margin-bottom:14px;">
                estimated chance of an early missed payment &nbsp;·&nbsp; riskier than
                {percentile}% of real applicants
              </div>

              <div class="meter-track" style="background:{status_color}1f;">
                <div class="meter-fill"
                     style="width:{pct_of(prob):.2f}%; background:{status_color};"></div>
              </div>
              <div class="meter-ticks">
                <div class="meter-tick" style="left:{pct_of(RISK_MEDIAN):.2f}%;">
                  <div class="meter-tick-line" style="background:{INK['muted']};"></div>
                  <div class="meter-tick-label">typical</div>
                </div>
                <div class="meter-tick" style="left:{pct_of(threshold):.2f}%;">
                  <div class="meter-tick-line" style="background:{INK['primary']};"></div>
                  <div class="meter-tick-label"><b>cutoff {threshold:.1%}</b></div>
                </div>
              </div>
              <div class="meter-ends">
                <span>0%</span>
                <span>{RISK_SCALE_MAX:.0%}+</span>
              </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        # --- meter: fill carries status, track is a pale wash of the same color ---
        fill_pct = min(max(prob, 0.0), 1.0) * 100
        threshold_pct = min(max(threshold, 0.0), 1.0) * 100
        r, g, b = tuple(int(status_color.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
        track_rgba = f"rgba({r},{g},{b},0.14)"

        st.markdown(
            f"""
            <div style="position:relative; height:20px; border-radius:10px;
                        background:{track_rgba}; overflow:visible; margin-top:4px;">
                <div style="position:absolute; left:0; top:0; height:100%; width:{fill_pct}%;
                            background:{status_color}; border-radius:10px;"></div>
                <div style="position:absolute; left:{threshold_pct}%; top:-3px; height:26px; width:2px;
                            background:{INK['primary']}; opacity:0.55;"></div>
            </div>
            <div style="position:relative; height:16px; margin-top:3px;">
                <div style="position:absolute; left:{threshold_pct}%; transform:translateX(-50%);
                            font-size:0.72rem; color:{INK['muted']}; white-space:nowrap;">
                    cutoff
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

        # --- where this applicant falls among everyone else ---
        # The reference population is the held-out test set scored the way this tool
        # scores, with the credit-history aggregates missing. Comparing a form-only score
        # against a full-history distribution is off by up to 17 percentile points, since
        # without history the model can't reach the extremes.
        import json as _json, os as _os
        _dist_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                                   "..", "Modeling", "utilities", "results",
                                   "risk_distribution.json")
        if _os.path.exists(_dist_path):
            with open(_dist_path) as _f:
                D = _json.load(_f)
            edges, counts = D["edges"], D["counts"]
            centres = [(edges[i] + edges[i + 1]) / 2 for i in range(len(counts))]
            width = edges[1] - edges[0]

            st.markdown("<div class='section-title'>Where this application falls</div>",
                        unsafe_allow_html=True)
            st.markdown(
                f"<div class='section-sub'>Every one of the {D['n']:,} applicants in the "
                f"held-out set, scored the same way. This one sits at the marked point, "
                f"riskier than {percentile}% of them.</div>",
                unsafe_allow_html=True,
            )

            # A coloured bar can't mark the applicant. 92.7% of the population sits
            # below 0.15, so anyone in the tail lands in a bin a few pixels tall and the
            # highlight disappears. A full-height rule reads the same wherever it falls.
            dfig = go.Figure(go.Bar(
                x=centres, y=counts, width=[width * 0.84] * len(centres),
                marker=dict(color=INK["cat"][0], cornerradius=3),
                hovertemplate="%{y:,} applicants scored about %{x:.1%}<extra></extra>",
            ))
            top = max(counts)
            x_app = min(prob, D["cap"])

            # The two labels always go on separate rows. Checking whether the rules are
            # close misses the case where they sit far apart but the labels grow towards
            # each other and meet in the middle. Stacking makes horizontal overlap moot,
            # and each label then extends away from the other and from the nearer edge.
            app_right_of_cut = x_app >= threshold
            app_anchor = "right" if x_app > D["cap"] * 0.55 else "left"
            cut_anchor = "right" if app_right_of_cut else "left"
            cut_y, app_y = top * 0.99, top * 1.12

            dfig.add_vline(x=threshold, line_width=2, line_color=INK["muted"],
                           line_dash="dot")
            dfig.add_annotation(x=threshold, y=cut_y, text=f"cutoff {threshold:.1%}",
                                showarrow=False, font=dict(color=INK["muted"], size=11),
                                xanchor=cut_anchor,
                                xshift=-5 if cut_anchor == "right" else 5)
            dfig.add_vline(x=x_app, line_width=3, line_color=status_color)
            dfig.add_annotation(x=x_app, y=app_y,
                                text=f"<b>this application, {prob:.1%}</b>",
                                showarrow=False,
                                font=dict(color=status_color, size=12),
                                xanchor=app_anchor,
                                xshift=-6 if app_anchor == "right" else 6)

            _dl = theme.plotly_layout(INK)
            _dl["xaxis"].update(tickformat=".0%", showgrid=False,
                                title="chance of an early missed payment",
                                range=[-width, D["cap"] + width])
            _dl["yaxis"].update(showgrid=True, showticklabels=False, title="applicants",
                                range=[0, top * 1.24])
            _dl["margin"].update(t=16, b=44)
            dfig.update_layout(**_dl, height=250, bargap=0.08, showlegend=False)
            st.plotly_chart(dfig, use_container_width=True, config={"displayModeBar": False})
            st.caption(
                f"Most applicants bunch up at the low end, well under the cutoff. That "
                f"shape is why declining the riskiest 14% still only catches about half "
                f"the missed payments. The last bar holds everyone above "
                f"{D['cap']:.0%} ({D['tail_n']:,} people)."
            )
            st.write("")

        st.markdown("<div style='height:32px'></div>", unsafe_allow_html=True)

        # --- SHAP factor chart: diverging colours for direction, not status. This is
        # which way each input pushed the score, not whether it is good or bad ---
        st.markdown("<div class='section-title'>What drove this score</div>", unsafe_allow_html=True)
        n_contrib = result.get("n_contributing") or 0
        _of_total = (f"the {len(top_factors)} largest of {n_contrib} inputs that moved this "
                     "score" if n_contrib else f"the {len(top_factors)} largest movers")
        st.markdown(
            f"<div class='section-sub'>Each bar is how much one input moved the score, "
            f"holding everything else fixed. These are {_of_total}. Effects are in "
            f"<b>log-odds</b>, the scale the model works on, so they do not add up to the "
            f"percentage above.</div>",
            unsafe_allow_html=True,
        )

        sorted_factors = sorted(top_factors, key=lambda f: f["contribution"])
        names = [f["feature"] for f in sorted_factors]
        values = [f["contribution"] for f in sorted_factors]
        bar_colors = [DIVERGING_RED if v > 0 else DIVERGING_BLUE for v in values]

        fig = go.Figure(
            go.Bar(
                x=values,
                y=names,
                orientation="h",
                # Plotly rounds the growing end only, so the zero baseline stays square.
                marker=dict(color=bar_colors, cornerradius=4),
                text=[f"{v:+.3f}" for v in values],
                textposition="outside",
                cliponaxis=False,
                customdata=[f"{v:+.3f}" for v in values],
                hovertemplate="<b>%{y}</b><br>Effect: %{customdata} log-odds<extra></extra>",
            )
        )
        _lay = theme.plotly_layout(INK)
        # The zero line anchors a diverging bar chart, so it stays the one emphasised rule.
        _lay["xaxis"].update(title="Effect on the score (log-odds)",
                             zeroline=True, zerolinewidth=1, zerolinecolor=INK["muted"])
        _lay["margin"].update(r=40, b=40)
        fig.update_layout(**_lay, height=90 + 38 * len(names), bargap=0.42)
        st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})

        st.markdown(
            f"<span style='color:{DIVERGING_RED}'>■</span> increases risk &nbsp;&nbsp; "
            f"<span style='color:{DIVERGING_BLUE}'>■</span> decreases risk",
            unsafe_allow_html=True,
        )
        st.caption(
            "Bars are SHAP values in log-odds. Longer bar = that input mattered more for "
            "this particular applicant. They add up to the gap between this estimate and "
            "the model's average applicant."
        )

        # The same values as a table, so nothing depends on colour or on bar lengths.
        with st.expander("View as a table"):
            st.dataframe(
                {
                    "Factor": [f["feature"] for f in sorted_factors][::-1],
                    "Direction": ["increases risk" if f["contribution"] > 0 else "decreases risk"
                                  for f in sorted_factors][::-1],
                    "Effect (log-odds)": [round(f["contribution"], 3) for f in sorted_factors][::-1],
                },
                use_container_width=True, hide_index=True,
            )

        # Second link to the research page, placed where the question comes up: the
        # user has just seen a number and wants to know where it came from.
        try:
            st.page_link("guide_page.py",
                         label="**Why this score?** Ask how the model was built, and what "
                               "it can and can't tell you.",
                         icon=":material/forum:")
        except Exception:
            pass

        st.markdown(
            f"<div class='footnote'>Model: {result['model_used']} &nbsp;·&nbsp; "
            "illustrative only, not a real lending decision.</div>",
            unsafe_allow_html=True,
        )
