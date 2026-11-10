import { useState } from "react";

/**
 * About me. Everything on this page that is about a person is in PROFILE below; edit
 * that and nothing else needs to change.
 *
 *   photo       An image in frontend/public/ (currently /me.jpg). Set to null to
 *               show initials instead.
 *   now         The short list under the intro: what's happening right now.
 *   experience  Most recent first. `tools` are listed under each entry (optional).
 *   toolbox     Groups of skills.
 *   bio         One string per paragraph.
 *   links       Email should be "mailto:...". Any can be removed.
 */
const PROFILE = {
  name: "Sam Strickler",
  pronouns: "he/him",
  title: "Applied mathematics and statistics student. Jr AI Engineer at Union Home Mortgage from January 2027.",
  tagline:
    "I study data science and build machine learning and AI systems. I care about whether they hold up on real data and whether someone who isn't technical can follow the result.",
  photo: "/me.jpg",
  location: "Greater Cleveland, Ohio",
  now: [
    { label: "Studying", value: "Applied mathematics and statistics, computer science minor, Williams Honors College at The University of Akron" },
    { label: "Graduating", value: "Spring 2027, then a master's in a quantitative field" },
    { label: "Next", value: "Jr AI Engineer at Union Home Mortgage, starting January 2027" },
  ],
  experience: [
    {
      title: "Jr AI Engineer",
      org: "Union Home Mortgage Corp.",
      when: "Jan 2027",
      note: "Building machine learning and AI tools for mortgage lending.",
      upcoming: true,
    },
    {
      title: "Statistical Consultant",
      org: "The University of Akron, Buchtel College of Arts & Sciences",
      when: "Jan 2026 to now",
      note: "Helping faculty, grad students and outside clients design studies, choose models and explain results.",
      tools: ["Statistical analysis", "Study design", "Data visualization"],
      current: true,
    },
    {
      title: "Honors Undergraduate Researcher",
      org: "The University of Akron",
      when: "Dec 2025 to now",
      note: "This site: predicting early missed payments on consumer loans, from the first look at the data to the model, the API and the web app.",
      tools: ["Python", "LightGBM", "SHAP", "FastAPI", "React", "Docker"],
      current: true,
    },
    {
      title: "AI Engineer Intern",
      org: "Union Home Mortgage Corp.",
      when: "May to Aug 2026",
      note: "Built an identity-verification pipeline with OCR and vision-language models: 96% accuracy on critical fields in training, 95% on test data. Won the intern presentation competition.",
      tools: ["Python", "OCR", "YOLO", "Databricks", "SQL", "Docker", "Azure DevOps"],
    },
    {
      title: "Student Assistant, Office of Student Accounts / Bursar",
      org: "The University of Akron",
      when: "Nov 2025 to now",
      note: "Reports, payment processing and basic accounting.",
      tools: ["Excel", "Accounting"],
      current: true,
    },
    {
      title: "Shift Supervisor, previously Barista",
      org: "Starbucks",
      when: "May 2021 to Nov 2025",
      note: "Ran shifts of 3 to 12 people in a busy store, from inventory and cash to coaching.",
      tools: ["Management", "Teamwork"],
    },
  ],
  toolbox: [
    { label: "Languages", items: ["Python", "R", "SQL", "MATLAB", "C++", "JavaScript", "HTML & CSS", "Excel"] },
    { label: "Machine learning", items: ["Supervised learning", "Unsupervised learning", "Reinforcement learning", "Deep learning", "Computer vision & OCR", "Statistical modeling", "Model evaluation"] },
    { label: "Platforms and tools", items: ["Databricks", "Docker", "Azure DevOps", "FastAPI", "React", "Data engineering", "Data visualization"] },
  ],
  bio: [
    "I'm a senior in the Williams Honors College at The University of Akron, double majoring in applied mathematics and statistics with a computer science minor and a concentration in data science and AI. I graduate in Spring 2027 and plan to do a master's in a quantitative field.",
    "Last summer I interned as an AI engineer at Union Home Mortgage, where I built an identity-verification pipeline from scratch: OCR and vision-language models to read documents, a YOLO detector to find them, face detection and barcode checks, and a human review step. It reached 96% accuracy on critical fields in training and 95% on test data, and my group won the intern presentation competition. I go back in January 2027 as a Jr AI Engineer.",
    "At school I'm a statistical consultant, helping faculty, grad students and outside clients plan studies and explain results in plain terms. This site is my honors project, and I built all of it. What I enjoy most is building an ML pipeline end to end, ideally in fintech.",
  ],
  links: [
    { label: "LinkedIn", href: "https://www.linkedin.com/in/sam-strickler-769860203/", kind: "linkedin" },
    { label: "GitHub", href: "https://github.com/samstrc", kind: "github" },
    { label: "Email", href: "mailto:samstrc@gmail.com", kind: "mail" },
  ],
};

/* ------------------------------------------------------------------ page */

const initialsOf = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

function Photo({ src, name }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="h-40 w-40 shrink-0 overflow-hidden rounded-[20px] bg-[var(--gridline)] shadow-[var(--shadow-raised)] sm:h-48 sm:w-48">
      {src && !failed ? (
        <img src={src} alt={name} className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-4xl font-[680] text-ink-secondary">{initialsOf(name) || "?"}</div>
      )}
    </div>
  );
}

function Links({ links }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {links.map((l) => {
        const external = !l.href.startsWith("mailto:");
        return (
          <li key={l.label}>
            <a href={l.href} target={external ? "_blank" : undefined} rel="noreferrer" className="chip">
              {l.label}
              {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function Section({ id, title, children }) {
  return (
    <section aria-labelledby={id} className="tray grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
      <h2 id={id} className="t-h2 px-4 pb-2 pt-4">
        {title}
      </h2>
      <div className="raised min-w-0 p-5 sm:p-6">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  const P = PROFILE;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 items-center gap-8 pb-8 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-10">
        <Photo src={P.photo} name={P.name} />
        <div>
          <h1 className="t-h1">{P.name}</h1>
          <p className="t-small mt-1">
            {P.pronouns}
            {P.location ? `, ${P.location}` : ""}
          </p>
          <p className="mt-4 max-w-[60ch] text-[1.0625rem] font-[560] leading-snug text-ink-primary">{P.title}</p>
          <p className="t-body mt-2 max-w-[62ch]">{P.tagline}</p>
          <div className="mt-5">
            <Links links={P.links} />
          </div>
        </div>
      </div>

      <Section id="a-now" title="Right now">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[7rem_1fr]">
          {P.now.map(({ label, value }) => (
            <div key={label} className="contents">
              <dt className="text-[0.9375rem] text-ink-muted">{label}</dt>
              <dd className="-mt-2 text-[0.9375rem] text-ink-primary sm:mt-0">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="a-experience" title="Experience">
        <ol className="space-y-7">
          {P.experience.map((e) => (
            <li key={`${e.title}-${e.org}`} className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
              <p className="t-small pt-0.5">
                {e.when}
                {e.upcoming ? <span className="mt-1 block w-fit rounded-full bg-[color-mix(in_srgb,var(--good)_16%,transparent)] px-2 py-0.5 text-[0.75rem] font-[600] text-good-text">upcoming</span> : null}
              </p>
              <div>
                <h3 className="t-h3">{e.title}</h3>
                <p className="text-[0.9375rem] text-ink-secondary">{e.org}</p>
                {e.note ? <p className="t-body mt-2 max-w-[66ch] text-[0.9375rem]">{e.note}</p> : null}
                {e.tools?.length ? <p className="t-small mt-2">{e.tools.join(", ")}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="a-skills" title="Skills">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          {P.toolbox.map(({ label, items }) => (
            <div key={label}>
              <h3 className="t-h3 text-[0.9375rem]">{label}</h3>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {items.map((t) => (
                  <li key={t} className="rounded-full bg-[var(--tray)] px-3 py-1 text-[0.8125rem] text-ink-secondary">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section id="a-more" title="More about me">
        <div className="t-body max-w-[66ch] space-y-4">
          {P.bio.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      </Section>

      <Section id="a-contact" title="Get in touch">
        <p className="t-body max-w-[62ch]">Questions about the project or the model? I'd be glad to hear from you.</p>
        <div className="mt-4">
          <Links links={P.links} />
        </div>
      </Section>
    </div>
  );
}
