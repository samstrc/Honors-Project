/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Geist Variable"',
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
        display: ['"Bricolage Grotesque Variable"', '"Geist Variable"', "-apple-system", "sans-serif"],
      },
      colors: {
        surface: "var(--surface)",
        card: "var(--card)",
        tray: "var(--tray)",
        ink: {
          primary: "var(--ink-primary)",
          secondary: "var(--ink-secondary)",
          muted: "var(--ink-muted)",
        },
        border: "var(--border)",
        good: "var(--good)",
        critical: "var(--critical)",
        accent: "var(--accent)",
        // Text-safe versions of the status colours: the fills are too light to read as
        // small text on these backgrounds (good green is 3.0:1 on the light surface).
        "good-text": "var(--good-text)",
        "critical-text": "var(--critical-text)",
        "accent-text": "var(--accent-text)",
        cat1: "var(--cat-1)",
        cat2: "var(--cat-2)",
        cat3: "var(--cat-3)",
        cat4: "var(--cat-4)",
        cat5: "var(--cat-5)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: 0, transform: "translateY(8px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        // Played with fill-mode backwards, so nothing is left on the wrapper once it ends:
        // any transform there would trap the phone's fixed estimate bar inside the page.
        "page-in": {
          "0%": { opacity: 0, transform: "translateY(8px)" },
          "100%": { opacity: 1, transform: "none" },
        },
        "fade-in": {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        caret: {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0 },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "page-in": "page-in 0.55s cubic-bezier(0.16, 1, 0.3, 1) backwards",
        "fade-in": "fade-in 0.4s ease both",
        "tip-in": "fade-in 0.12s ease both",
        caret: "caret 1s steps(2, start) infinite",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};
