/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Inter",
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
      },
      colors: {
        surface: "var(--surface)",
        card: "var(--card)",
        ink: {
          primary: "var(--ink-primary)",
          secondary: "var(--ink-secondary)",
          muted: "var(--ink-muted)",
        },
        border: "var(--border)",
        good: "var(--good)",
        critical: "var(--critical)",
        accent: "var(--accent)",
        cat1: "var(--cat-1)",
        cat2: "var(--cat-2)",
        cat3: "var(--cat-3)",
        cat4: "var(--cat-4)",
        cat5: "var(--cat-5)",
      },
      boxShadow: {
        card: "0 1px 2px rgba(30, 27, 23, 0.04), 0 8px 24px -12px rgba(30, 27, 23, 0.12)",
        // A touch heavier than a card so a tooltip reads as floating above the page.
        tip: "0 1px 2px rgba(30, 27, 23, 0.06), 0 10px 28px -8px rgba(30, 27, 23, 0.28)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: 0, transform: "translateY(8px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 },
        },
        "grow-x": {
          "0%": { width: "0%" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        caret: {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0 },
        },
        pop: {
          "0%": { transform: "scale(0.85)" },
          "60%": { transform: "scale(1.08)" },
          "100%": { transform: "scale(1)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 0.4s ease both",
        "tip-in": "fade-in 0.12s ease both",
        caret: "caret 1s steps(2, start) infinite",
        pop: "pop 0.3s cubic-bezier(0.16, 1, 0.3, 1) both",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};
