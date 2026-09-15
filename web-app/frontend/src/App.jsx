import { Routes, Route } from "react-router-dom";
import Nav from "./components/Nav.jsx";
import FindingsPage from "./pages/FindingsPage.jsx";
import PreapprovalPage from "./pages/PreapprovalPage.jsx";
import GuidePage from "./pages/GuidePage.jsx";
import AboutPage from "./pages/AboutPage.jsx";

export default function App() {
  return (
    <div className="min-h-screen bg-surface font-sans text-ink-primary">
      <Nav />
      <main className="mx-auto max-w-6xl px-5 pb-24 pt-10 sm:px-6 lg:px-8">
        <Routes>
          <Route path="/" element={<FindingsPage />} />
          <Route path="/preapproval" element={<PreapprovalPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<FindingsPage />} />
        </Routes>
      </main>
      <footer className="border-t border-border py-8 text-center text-[0.75rem] text-ink-muted">
        Honors research project · illustrative only, not a real lending decision.
      </footer>
    </div>
  );
}
