import { Link } from "react-router-dom";

/**
 * The "go read/try this other page" link used on all three pages (findings -> tool,
 * tool -> guide, tool's result -> guide). Pulled out after the same className string and
 * arrow-on-hover markup showed up three times across FindingsPage and PreapprovalPage.
 */
export default function InlineLink({ to, state, className = "mt-6", children }) {
  return (
    <Link
      to={to}
      state={state}
      className={`focus-ring group flex items-center gap-2 text-[0.9rem] font-medium text-accent transition-opacity hover:opacity-80 ${className}`}
    >
      <span>{children}</span>
      <span className="transition-transform group-hover:translate-x-1">→</span>
    </Link>
  );
}
