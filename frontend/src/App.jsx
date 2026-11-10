import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Nav from "./components/Nav.jsx";
import FindingsPage from "./pages/FindingsPage.jsx";
import PreapprovalPage from "./pages/PreapprovalPage.jsx";
import GuidePage from "./pages/GuidePage.jsx";
import AboutPage from "./pages/AboutPage.jsx";

export default function App() {
  const location = useLocation();
  return (
    <div className="relative flex min-h-screen flex-col font-sans text-ink-primary">
      {/* Two faint pools of the palette's sage and clay behind everything. They're what
          the glass nav has to bend and blur, so it reads as glass even at the top. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-[10%] -top-[18%] h-[60vh] w-[55vw] rounded-full bg-[var(--cat-1)] opacity-[0.13] blur-[110px] dark:opacity-[0.12]" />
        <div className="absolute -right-[12%] top-[30%] h-[55vh] w-[45vw] rounded-full bg-[var(--cat-2)] opacity-[0.10] blur-[120px] dark:opacity-[0.14]" />
      </div>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 text-ink-primary focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-8">
        {/* keyed on the path so each page arrives with one short rise, not a pile of
            separate entrances */}
        <div key={location.pathname} className="animate-page-in">
        <Routes location={location}>
          <Route path="/" element={<FindingsPage />} />
          <Route path="/preapproval" element={<PreapprovalPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/findings" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </div>
      </main>
      <footer>
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-5 py-6 text-[0.8125rem] text-ink-muted sm:flex-row sm:justify-between sm:px-6 lg:px-8">
          <span>Sam Strickler, Williams Honors College, The University of Akron</span>
          <span>Estimates are illustrative, not lending decisions.</span>
        </div>
      </footer>
    </div>
  );
}
