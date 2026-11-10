import { useId } from "react";
import { Tooltip } from "./Tooltip.jsx";

export function Field({ label, help, error, children, htmlFor }) {
  const errorId = useId();
  return (
    <div>
      <div className="flex items-center gap-1.5 pl-1">
        <label htmlFor={htmlFor} className="text-[0.875rem] font-[560] text-ink-primary">
          {label}
        </label>
        {help ? <HelpTip text={help} /> : null}
      </div>
      {children(error ? errorId : undefined)}
      {error ? (
        <p id={errorId} className="mt-1.5 pl-1 text-[0.8125rem] leading-snug text-critical-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function HelpTip({ text }) {
  return (
    <Tooltip content={text}>
      <button
        type="button"
        className="flex h-[18px] w-[18px] cursor-help items-center justify-center rounded-full bg-card text-[10px] font-bold leading-none text-ink-muted shadow-[var(--shadow-raised)] transition-colors hover:text-ink-primary"
      >
        <span aria-hidden>?</span>
        {/* the tooltip is visual only, so screen readers get the same text here */}
        <span className="sr-only">{text}</span>
      </button>
    </Tooltip>
  );
}

// No `step` on purpose. The browser treats step as a validation rule, not just a spinner
// increment, so `step={100}` rejected any income that wasn't a round hundred -- including
// the site's own presets -- with a native "nearest valid values are…" popup. Range checks
// live in validate() (lib/application.js) so the message can say what's actually wrong.
export function NumberField({ id, label, help, error, value, onChange, min, max, prefix, suffix, disabled, placeholder, stepper }) {
  const input = (describedBy, extra = "") => (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      step="any"
      className={`field-input ${prefix ? "pl-8" : ""} ${suffix ? "pr-14" : ""} ${extra}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      value={value}
      min={min}
      max={max}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
    />
  );

  // Small whole numbers (children, household) get round − and + buttons either side, so
  // a phone doesn't need its keyboard. The box in the middle still takes typing.
  if (stepper) {
    const n = Number(value) || 0;
    const nudge = (d) => onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n + d)));
    return (
      <Field label={label} help={help} error={error} htmlFor={id}>
        {(describedBy) => (
          <div className="mt-1.5 flex items-center gap-2">
            <StepButton label={`Fewer: ${label}`} onClick={() => nudge(-1)} disabled={disabled || n <= (min ?? -Infinity)}>
              <path d="M5 10h10" />
            </StepButton>
            {input(describedBy, "t-num text-center text-[1.0625rem] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none")}
            <StepButton label={`More: ${label}`} onClick={() => nudge(1)} disabled={disabled || n >= (max ?? Infinity)}>
              <path d="M5 10h10M10 5v10" />
            </StepButton>
          </div>
        )}
      </Field>
    );
  }

  return (
    <Field label={label} help={help} error={error} htmlFor={id}>
      {(describedBy) => (
        <div className="relative mt-1.5">
          {prefix ? (
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted">{prefix}</span>
          ) : null}
          {input(describedBy)}
          {suffix ? (
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[0.875rem] text-ink-muted">
              {suffix}
            </span>
          ) : null}
        </div>
      )}
    </Field>
  );
}

function StepButton({ label, onClick, disabled, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card text-ink-primary shadow-[var(--shadow-raised)] transition-transform duration-150 active:scale-90 disabled:opacity-40"
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

const CHEVRON_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill='%2371685b' d='M5.5 7.5l4.5 4.5 4.5-4.5'/%3E%3C/svg%3E\")";

export function SelectField({ id, label, help, value, onChange, options, placeholder }) {
  return (
    <Field label={label} help={help} htmlFor={id}>
      {() => (
        <select
          id={id}
          className="field-input mt-1.5"
          style={{ backgroundImage: CHEVRON_BG }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function SliderField({ id, label, help, value, onChange, min, max, step, format = (v) => v.toFixed(2) }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <Field
      htmlFor={id}
      label={
        <span className="flex items-baseline gap-2">
          {label}
          <span className="t-num text-ink-primary">{format(value)}</span>
        </span>
      }
      help={help}
    >
      {() => (
        <input
          id={id}
          type="range"
          className="slider mt-4 w-full"
          style={{ "--pct": `${pct}%` }}
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={format(value)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )}
    </Field>
  );
}

/**
 * An on/off switch: a checkbox underneath, so it keeps the native keyboard behaviour and
 * is announced as a switch. `description` is the quieter line under the label.
 */
export function Toggle({ label, description, checked, onChange }) {
  return (
    <label className="flex cursor-pointer select-none items-center justify-between gap-4">
      <span>
        <span className="block text-[0.9375rem] font-[560] text-ink-primary">{label}</span>
        {description ? <span className="t-small block">{description}</span> : null}
      </span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-300 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] ${
          checked ? "bg-good" : "bg-[color-mix(in_srgb,var(--ink-primary)_14%,transparent)]"
        }`}
      >
        <span
          className="absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-[#fffdf9] shadow-[0_2px_6px_rgba(30,27,23,0.3)]"
          style={{ transform: checked ? "translateX(20px)" : "none", transition: "transform 380ms cubic-bezier(0.34, 1.4, 0.64, 1)" }}
        />
      </span>
    </label>
  );
}
