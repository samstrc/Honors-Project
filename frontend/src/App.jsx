import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Nav from "./components/Nav.jsx";
import FindingsPage from "./pages/FindingsPage.jsx";
import PreapprovalPage from "./pages/PreapprovalPage.jsx";
import GuidePage from "./pages/GuidePage.jsx";
import AboutPage from "./pages/AboutPage.jsx";

export default function App() {
  const location = useLocation();
  return (
    <div className="flex min-h-screen flex-col bg-surface font-sans text-ink-primary">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 text-ink-primary focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 pb-24 pt-10 sm:px-6 sm:pt-12 lg:px-8">
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
      <footer className="border-t border-[var(--rule)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-5 py-6 text-[0.8125rem] text-ink-muted sm:flex-row sm:justify-between sm:px-6 lg:px-8">
          <span>Sam Strickler, Williams Honors College, The University of Akron</span>
          <span>Estimates are illustrative, not lending decisions.</span>
        </div>
      </footer>
    </div>
  );
}
