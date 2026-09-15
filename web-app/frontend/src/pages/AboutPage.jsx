import { useState } from "react";
import { Kicker, PageTitle, SectionTitle } from "../components/PageHeader.jsx";
import useInView from "../lib/useInView.js";
import { CapIcon, BriefcaseIcon, HourglassIcon, StarIcon, ShieldIcon, WalletIcon, DatabaseIcon } from "../components/icons.jsx";

/**
 * About me. Everything on this page that is about a person is in PROFILE below; edit
 * that and nothing else needs to change.
 *
 *   photo       An image in web-app/frontend/public/ (currently /me.jpg). Set to null to
 *               show initials instead.
 *   now         The three tiles under the hero: what's happening right now.
 *   experience  Most recent first. `tools` are the chips under each entry (optional),
 *               `current: true` adds a "now" marker, `upcoming: true` a dashed one.
 *   toolbox     Groups of chips.
 *   bio         One string per paragraph.
 *   links       Email should be "mailto:...". Any can be removed.
 */
const PROFILE = {
  name: "Sam Strickler",
  pronouns: "he/him",
  title: "Applied math and statistics student. Jr AI Engineer at Union Home Mortgage from January 2027.",
  tagline:
    "I build machine learning systems, mostly for finance. I care about whether they hold up on real data and whether someone who isn't technical can follow the result.",
  photo: "/me.jpg",
  location: "Greater Cleveland, Ohio",
  now: [
    { icon: CapIcon, label: "Studying", value: "Applied mathematics & statistics, computer science minor", sub: "The University of Akron, Williams Honors College" },
    { icon: HourglassIcon, label: "Graduating", value: "Spring 2027", sub: "then a master's in a quantitative field" },
    { icon: BriefcaseIcon, label: "Next", value: "Jr AI Engineer, Union Home Mortgage", sub: "starting January 2027" },
  ],
  experience: [
    {
      title: "Jr AI Engineer",
      org: "Union Home Mortgage Corp.",
      when: "Jan 2027",
      note: "Going back to the AI team after the internship.",
      upcoming: true,
    },
    {
      title: "Statistical Consultant",
      org: "The University of Akron, Buchtel College of Arts & Sciences",
      when: "Jan 2026 to now",
      note: "Help faculty, grad students and outside clients with study design, exploratory analysis, picking a model, and explaining the results.",
      tools: ["Statistical analysis", "Study design", "Data visualization"],
      current: true,
    },
    {
      title: "Honors Undergraduate Researcher",
      org: "The University of Akron",
      when: "Dec 2025 to now",
      note: "Loan default risk with statistical and machine learning methods. This project: defining the problem, reviewing the literature, exploring the data, modeling and tuning, then deployment and the web app.",
      tools: ["Python", "LightGBM", "SHAP", "FastAPI", "React", "Docker"],
      current: true,
    },
    {
      title: "AI Engineer Intern",
      org: "Union Home Mortgage Corp.",
      when: "May to Aug 2026",
      note: "Built a document extraction pipeline for identity verification with OCR and vision-language models. 96% accuracy on critical fields in training, 95% on test data. First place in the intern presentation competition.",
      tools: ["Python", "OCR", "YOLO", "Databricks", "SQL", "Docker", "Azure DevOps"],
    },
    {
      title: "Student Assistant, Office of Student Accounts / Bursar",
      org: "The University of Akron",
      when: "Nov 2025 to now",
      note: "Report analysis, payment processing and basic accounting for the university's financial systems.",
      tools: ["Excel", "Accounting"],
      current: true,
    },
    {
      title: "Shift Supervisor, previously Barista",
      org: "Starbucks",
      when: "May 2021 to Nov 2025",
      note: "Ran shifts with teams of 3 to 12 people in a busy store: metrics, inventory, cash handling, coaching, and customer issues.",
      tools: ["Management", "Teamwork"],
    },
  ],
  toolbox: [
    { icon: WalletIcon, label: "Languages", items: ["Python", "R", "SQL", "MATLAB", "C++", "JavaScript", "HTML & CSS", "Excel"] },
    { icon: StarIcon, label: "Machine learning", items: ["Supervised learning", "Unsupervised learning", "Reinforcement learning", "Deep learning", "Computer vision & OCR", "Statistical modeling", "Model evaluation"] },
    { icon: DatabaseIcon, label: "Platforms & tools", items: ["Databricks", "Docker", "Azure DevOps", "FastAPI", "React", "Data engineering", "Data visualization"] },
  ],
  bio: [
    "I'm a senior at The University of Akron, double majoring in applied mathematics and statistics in the Williams Honors College with a concentration in data science and AI. I'm also finishing a computer science minor. I graduate in Spring 2027 and plan to go on to a master's in a quantitative field.",
    "This past summer I interned as an AI engineer at Union Home Mortgage. I built a document extraction pipeline for identity verification from scratch: OCR and vision-language models to read the documents, a YOLO detector to find and crop them, face detection and barcode parsing to check them, and a human review step for quality and compliance. It reached 96% accuracy on the critical fields in training and 95% on test data. My presentation group also won first place in the intern competition. Day to day I was in Python, Databricks, SQL, Docker and Azure DevOps. I'm going back to UHM in January 2027 as a Jr AI Engineer.",
    "At school I work as a statistical consultant for the Buchtel College of Arts & Sciences, helping faculty, grad students and outside clients with study design, analysis, and explaining what the results mean in plain terms. The preapproval tool on this site is my honors research project. I did all of it, from defining the problem and exploring the data through modeling, tuning, deployment and this web app.",
    "I work in Python, R, SQL, MATLAB, C++ and the usual web stack. I've done supervised, unsupervised and reinforcement learning, and what I enjoy most is building a complete ML pipeline end to end, ideally for something in fintech.",
  ],
  links: [
    { label: "LinkedIn", href: "https://www.linkedin.com/in/sam-strickler-769860203/", kind: "linkedin" },
    { label: "GitHub", href: "https://github.com/samstrc", kind: "github" },
    { label: "Email", href: "mailto:samstrc@gmail.com", kind: "mail" },
  ],
};

/* ------------------------------------------------------------------ bits */

const initialsOf = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

function Photo({ src, name }) {
  const [failed, setFailed] = useState(false);
  const showImage = src && !failed;
  return (
    <div className="relative shrink-0">
      {/* a tilted accent slab behind the photo, so it sits on something */}
      <div aria-hidden className="absolute -inset-1.5 -rotate-3 rounded-[22px] bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]" />
      <div aria-hidden className="absolute -inset-1.5 rotate-2 rounded-[22px] border border-[color-mix(in_srgb,var(--accent)_40%,transparent)]" />
      <div className="relative h-44 w-44 overflow-hidden rounded-[20px] border border-border bg-surface shadow-card sm:h-52 sm:w-52">
        {showImage ? (
          <img src={src} alt={name} className="h-full w-full object-cover" onError={() => setFailed(true)} />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-5xl font-bold tracking-tight text-[var(--card)]"
            style={{ background: "linear-gradient(135deg, var(--accent), var(--cat-3))" }}
          >
            {initialsOf(name) || "?"}
          </div>
        )}
      </div>
    </div>
  );
}

function LinkGlyph({ kind }) {
  if (kind === "linkedin")
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-[3px] bg-current text-[9px] font-bold leading-none">
        <span className="text-[var(--card)]">in</span>
      </span>
    );
  if (kind === "github")
    return (
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="m7 6-4 4 4 4M13 6l4 4-4 4M11.5 3.5l-3 13" />
      </svg>
    );
  if (kind === "mail")
    return (
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
        <path d="m3 6 7 5 7-5" />
      </svg>
    );
  return null;
}

function LinkPill({ link, big = false }) {
  const external = !link.href.startsWith("mailto:");
  return (
    <a
      href={link.href}
      target={external ? "_blank" : undefined}
      rel="noreferrer"
      className={`focus-ring flex items-center gap-2 rounded-full border border-border bg-card font-medium text-ink-secondary transition-all hover:-translate-y-0.5 hover:border-accent hover:text-ink-primary hover:shadow-card ${
        big ? "px-4 py-2.5 text-[0.88rem]" : "px-3.5 py-1.5 text-[0.8rem]"
      }`}
    >
      <LinkGlyph kind={link.kind} />
      {link.label}
    </a>
  );
}

/** Fades a section up the first time it scrolls into view. */
function Reveal({ children, className = "" }) {
  const [ref, visible] = useInView(0.12);
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${className}`}
      style={{ opacity: visible ? 1 : 0, transform: visible ? "none" : "translateY(14px)", transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
    >
      {children}
    </div>
  );
}

function Chip({ children, accent = false }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-[0.72rem] font-medium ${
        accent ? "border-transparent bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent" : "border-border bg-surface text-ink-secondary"
      }`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ page */

export default function AboutPage() {
  const P = PROFILE;
  const email = P.links.find((l) => l.kind === "mail");

  return (
    <div>
      {/* hero */}
      <Kicker>About me</Kicker>
      <div className="mt-1 grid grid-cols-1 items-center gap-7 sm:grid-cols-[auto_1fr] sm:gap-10">
        <div className="animate-fade-up [animation-delay:120ms] justify-self-center sm:justify-self-start">
          <Photo src={P.photo} name={P.name} />
        </div>
        <div>
          <PageTitle>
            <span className="flex flex-wrap items-baseline gap-x-3">
              {P.name}
              {P.pronouns ? <span className="text-[0.95rem] font-normal text-ink-muted">{P.pronouns}</span> : null}
            </span>
          </PageTitle>
          <p className="mt-1.5 max-w-xl text-[1rem] font-medium leading-snug text-accent animate-fade-up [animation-delay:120ms]">{P.title}</p>
          {P.location ? (
            <div className="mt-1.5 flex items-center gap-1.5 text-[0.82rem] text-ink-muted animate-fade-up [animation-delay:160ms]">
              <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 17.5s5.5-5 5.5-9.5a5.5 5.5 0 0 0-11 0c0 4.5 5.5 9.5 5.5 9.5Z" />
                <circle cx="10" cy="8" r="2" />
              </svg>
              {P.location}
            </div>
          ) : null}
          <p className="mt-3 max-w-2xl text-[0.95rem] leading-relaxed text-ink-secondary animate-fade-up [animation-delay:200ms]">{P.tagline}</p>
          <div className="mt-4 flex flex-wrap gap-2 animate-fade-up [animation-delay:260ms]">
            {P.links.map((l) => (
              <LinkPill key={l.label} link={l} />
            ))}
          </div>
        </div>
      </div>

      {/* right now */}
      <div className="mt-9 grid grid-cols-1 gap-2.5 animate-fade-up [animation-delay:320ms] sm:grid-cols-3">
        {P.now.map(({ icon: Icon, label, value, sub }) => (
          <div key={label} className="flex gap-3 rounded-xl border border-border bg-card px-4 py-3.5 shadow-card transition-transform duration-300 hover:-translate-y-0.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[0.66rem] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
              <div className="mt-0.5 text-[0.9rem] font-semibold leading-snug text-ink-primary">{value}</div>
              {sub ? <div className="mt-0.5 text-[0.74rem] leading-snug text-ink-muted">{sub}</div> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="my-10 h-px bg-border" />

      {/* experience */}
      <Reveal>
        <SectionTitle icon={BriefcaseIcon}>Experience</SectionTitle>
        <ol className="mt-5">
          {P.experience.map((e, i) => (
            <li key={`${e.title}-${e.org}`} className="group grid grid-cols-[auto_1fr] gap-x-4 sm:grid-cols-[120px_auto_1fr] sm:gap-x-5">
              {/* date column (desktop) */}
              <div className="hidden pt-[3px] text-right text-[0.76rem] font-medium tabular-nums text-ink-muted sm:block">{e.when}</div>
              {/* rail */}
              <div className="flex flex-col items-center">
                <span
                  className={`mt-[5px] h-3 w-3 shrink-0 rounded-full border-2 ${
                    e.upcoming
                      ? "border-dashed border-accent bg-card"
                      : e.current
                        ? "border-[var(--good)] bg-[var(--good)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--good)_18%,transparent)]"
                        : "border-accent bg-accent"
                  }`}
                />
                {i < P.experience.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
              </div>
              {/* card */}
              <div className="mb-3 rounded-xl border border-border bg-card px-4 py-3.5 shadow-card transition-all duration-300 group-hover:-translate-y-0.5 group-hover:border-accent">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[0.95rem] font-semibold text-ink-primary">{e.title}</span>
                  {e.upcoming ? <Chip accent>upcoming</Chip> : null}
                  {e.current ? <Chip accent>now</Chip> : null}
                  <span className="text-[0.74rem] tabular-nums text-ink-muted sm:hidden">· {e.when}</span>
                </div>
                <div className="text-[0.82rem] text-accent">{e.org}</div>
                {e.note ? <p className="mt-1.5 text-[0.85rem] leading-relaxed text-ink-secondary">{e.note}</p> : null}
                {e.tools?.length ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {e.tools.map((t) => (
                      <Chip key={t}>{t}</Chip>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </Reveal>

      {/* toolbox */}
      <Reveal className="mt-10">
        <SectionTitle icon={ShieldIcon}>Toolbox</SectionTitle>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {P.toolbox.map(({ icon: Icon, label, items }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4 shadow-card">
              <div className="flex items-center gap-2 text-[0.8rem] font-semibold text-ink-primary">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-accent">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                {label}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {items.map((t) => (
                  <Chip key={t}>{t}</Chip>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Reveal>

      {/* bio */}
      <Reveal className="mt-10">
        <SectionTitle icon={StarIcon}>A little more</SectionTitle>
        <div className="mt-3 space-y-3.5 text-[0.95rem] leading-relaxed text-ink-secondary">
          {P.bio.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      </Reveal>

      {/* get in touch */}
      <Reveal className="mt-10">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-card sm:p-7">
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(160deg, color-mix(in srgb, var(--accent) 10%, transparent) 0%, transparent 65%)" }} />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[1.05rem] font-semibold text-ink-primary">Want to talk?</div>
              <p className="mt-1 max-w-md text-[0.88rem] leading-relaxed text-ink-secondary">
                Questions about the project, the model, or anything on this site. Or just say hi.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {email ? <LinkPill link={email} big /> : null}
              {P.links.filter((l) => l.kind !== "mail").map((l) => (
                <LinkPill key={l.label} link={l} big />
              ))}
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
