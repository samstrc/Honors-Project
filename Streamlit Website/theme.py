"""
Shared visual theme: an earth palette, validated rather than eyeballed.

Derived from the seaborn palette in `home_credit_default_risk.ipynb` (sage / warm brown / muted blue /
ochre / dark red on a beige ground), but re-stepped: the notebook values fail four of the
five computable data-viz checks on this surface. Sage, brown and blue all sat below the
OKLCH chroma floor of 0.10, which means they read as gray rather than as colours; the
ochre was too light for the lightness band and came in at 1.67:1 against beige; and sage
against brown scored ΔE 14.7 under normal vision, below the hard floor of 15, so even
full-colour readers struggled to tell them apart.

Each hue was held fixed and only lightness and chroma moved, so the palette still reads as
the same earth family. Both modes pass all five checks
(`dataviz/scripts/validate_palette.py`), light on #f2ede6 and dark on #1e1b17, and the
categorical order is fixed so that the closest pairs are never adjacent.
"""

from __future__ import annotations

LIGHT = {
    "surface": "#f2ede6",     # beige ground, from the notebook
    "card": "#fbf8f3",
    "primary": "#2e2a24",     # 12.4:1 on the surface
    "secondary": "#575044",   # 6.9:1
    "muted": "#847b6d",       # 3.6:1, decorative labels only
    "border": "rgba(46,42,36,0.13)",
    "gridline": "#ded4c5",
    # sage, brown, blue, ochre, rust -- this order keeps the three closest pairs apart
    "cat": ["#4d975e", "#925612", "#2f5b98", "#a87f04", "#8f2f2e"],
    "good": "#4d975e",        # preapproved
    "critical": "#8f2f2e",    # declined
    "pos": "#8f2f2e",         # raises risk (diverging warm pole)
    "neg": "#4d975e",         # lowers risk (diverging cool pole)
    "accent": "#925612",
}

DARK = {
    "surface": "#1e1b17",     # warm near-black rather than neutral, to match the family
    "card": "#272319",
    "primary": "#f4efe6",
    "secondary": "#c8c0b1",
    "muted": "#8d8477",
    "border": "rgba(244,239,230,0.13)",
    "gridline": "#3a352d",
    "cat": ["#4d975e", "#985c1c", "#3e6aa7", "#a87f08", "#a14f4b"],
    "good": "#4d975e",
    "critical": "#a14f4b",
    "pos": "#a14f4b",
    "neg": "#4d975e",
    "accent": "#985c1c",
}


def get(st) -> dict:
    """Palette for the viewer's current theme."""
    try:
        mode = st.context.theme.type if st.context.theme.type in ("light", "dark") else "light"
    except Exception:
        mode = "light"
    return DARK if mode == "dark" else LIGHT


def css(INK: dict) -> str:
    """The style block every page shares, so the three pages read as one site."""
    return f"""
    <style>
      html, body, [class*="css"], .block-container {{
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto,
                     "Helvetica Neue", Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
      }}
      .stApp {{ background: {INK['surface']}; }}
      .block-container {{ padding-top: 3rem; padding-bottom: 5rem; max-width: 900px; }}
      div[data-testid="stForm"] {{ border: none; padding: 0; }}
      [data-testid="stSidebar"] {{ background: {INK['card']}; }}

      .kicker {{
        text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.72rem;
        font-weight: 600; color: {INK['muted']}; margin-bottom: 4px;
      }}
      .page-title {{
        font-size: 2rem; font-weight: 700; color: {INK['primary']};
        margin: 2px 0 6px 0; letter-spacing: -0.01em;
      }}
      .page-subtitle {{
        color: {INK['secondary']}; font-size: 0.98rem; line-height: 1.55; max-width: 660px;
      }}
      .row-label {{
        font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.07em;
        color: {INK['muted']}; font-weight: 600; margin: 2px 0 8px 0;
      }}
      .section-title {{
        font-size: 1.08rem; font-weight: 600; color: {INK['primary']}; margin: 8px 0 2px 0;
      }}
      .section-sub {{ color: {INK['secondary']}; font-size: 0.89rem; margin-bottom: 14px; }}
      .footnote {{ color: {INK['muted']}; font-size: 0.8rem; margin-top: 8px; }}

      .facts-row {{ display: flex; gap: 10px; flex-wrap: wrap; margin: 2px 0 30px 0; }}
      .fact {{
        flex: 1 1 150px; padding: 15px 18px 13px 18px;
        border: 1px solid {INK['border']}; border-radius: 12px; background: {INK['card']};
      }}
      .fact-value {{
        font-size: 1.5rem; font-weight: 700; color: {INK['primary']};
        letter-spacing: -0.02em; line-height: 1.1;
        font-variant-numeric: proportional-nums;
      }}
      .fact-label {{ font-size: 0.75rem; color: {INK['muted']}; margin-top: 3px; line-height: 1.4; }}
    </style>
    """


def plotly_layout(INK: dict) -> dict:
    """Chart chrome: transparent ground, hairline recessive grid, text in ink tokens."""
    return dict(
        plot_bgcolor="rgba(0,0,0,0)", paper_bgcolor="rgba(0,0,0,0)",
        font=dict(color=INK["secondary"], size=13),
        xaxis=dict(gridcolor=INK["gridline"], gridwidth=1, zeroline=False,
                   color=INK["secondary"], ticksuffix="  "),
        yaxis=dict(gridcolor=INK["gridline"], gridwidth=1, zeroline=False,
                   color=INK["primary"], ticksuffix="  "),
        hoverlabel=dict(bgcolor=INK["card"], bordercolor=INK["border"],
                        font=dict(color=INK["primary"], size=12)),
        margin=dict(l=10, r=30, t=10, b=36),
    )
