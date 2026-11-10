import { useId } from "react";
import { Tooltip } from "./Tooltip.jsx";

export function Field({ label, help, error, children, htmlFor }) {
  const errorId = useId();
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label htmlFor={htmlFor} className="text-[0.875rem] font-[560] text-ink-primary">
          {label}
        </label>
        {help ? <HelpTip text={help} /> : null}
      </div>
      {children(error ? errorId : undefined)}
      {error ? (
        <p id={errorId} className="mt-1.5 text-[0.8125rem] leading-snug text-critical-text">
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
        className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-[var(--rule)] text-[10px] font-bold leading-none text-ink-muted hover:text-ink-primary"
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
export function NumberField({ id, label, help, error, value, onChange, min, max, prefix, suffix, disabled, placeholder }) {
  return (
    <Field label={label} help={help} error={error} htmlFor={id}>
      {(describedBy) => (
        <div className="relative mt-1">
          {prefix ? (
            <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-ink-muted">{prefix}</span>
          ) : null}
          <input
            id={id}
            type="number"
            inputMode="decimal"
            step="any"
            className={`field-input ${prefix ? "pl-4" : ""} ${suffix ? "pr-12" : ""}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            value={value}
            min={min}
            max={max}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          />
          {suffix ? (
            <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-[0.875rem] text-ink-muted">
              {suffix}
            </span>
          ) : null}
        </div>
      )}
    </Field>
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
          className="field-input mt-1"
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
          className="slider mt-3 w-full"
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

export function Checkbox({ label, checked, onChange }) {
  return (
    <label className="group flex w-fit cursor-pointer select-none items-center gap-2.5">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border-[1.5px] transition-colors duration-150 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] ${
          checked ? "animate-pop border-accent bg-accent" : "border-ink-muted group-hover:border-ink-secondary"
        }`}
      >
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
          <path className={`tick ${checked ? "on" : ""}`} d="M2 6.2 4.8 9 10 3" stroke="var(--card)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="text-[0.9375rem] text-ink-primary">{label}</span>
    </label>
  );
}
