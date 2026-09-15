import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";

// Dark mode is a user preference for a project the person will revisit, not conversation
// UI, so it's fine to persist it -- default to system preference, remember an explicit
// override.
let stored = null;
try {
  stored = localStorage.getItem("theme");
} catch {
  /* storage blocked (privacy mode etc.): fall through to the system preference */
}
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
if (stored === "dark" || (!stored && prefersDark)) {
  document.documentElement.classList.add("dark");
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
