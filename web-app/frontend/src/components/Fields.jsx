import { Tooltip } from "./Tooltip.jsx";

export function Field({ label, help, error, children }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[0.82rem] font-medium text-ink-secondary">{label}</span>
        {help ? <HelpTip text={help} /> : null}
      </div>
      {children}
      {error ? (
        <div role="alert" className="mt-1.5 animate-fade-in text-[0.76rem] leading-snug text-[var(--critical)]">
          {error}
        </div>
      ) : null}
    </label>
  );
}

export function HelpTip({ text }) {
  return (
    <Tooltip content={text}>
      <span
        tabIndex={0}
        aria-label="More about this field"
        className="focus-ring flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-border text-[9px] font-bold text-ink-muted"
      >
        ?
      </span>
    </Tooltip>
  );
}

const inputBase =
  "field-input w-full rounded-lg border border-border bg-surface px-3 py-2 text-[0.88rem] text-ink-primary outline-none placeholder:text-ink-muted focus:border-accent";

// No `step` on purpose. The browser treats step as a validation rule, not just a spinner
// increment, so `step={100}` rejected any income that wasn't a round hundred -- including
// the site's own presets -- with a native "nearest valid values are…" popup. Range checks
// live in PreapprovalPage's validate() so the message can say what's actually wrong.
export function NumberField({ label, help, error, value, onChange, min, max, prefix, suffix, disabled, placeholder }) {
  return (
    <Field label={label} help={help} error={error}>
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[0.85rem] font-medium text-ink-muted">
            {prefix}
          </span>
        ) : null}
        <input
          type="number"
          inputMode="decimal"
          step="any"
          className={`${inputBase} ${prefix ? "pl-7" : ""} ${suffix ? "pr-10" : ""} ${disabled ? "opacity-50" : ""}`}
          style={error ? { borderColor: "var(--critical)" } : undefined}
          aria-invalid={error ? true : undefined}
          value={value}
          min={min}
          max={max}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.78rem] text-ink-muted">
            {suffix}
          </span>
        ) : null}
      </div>
    </Field>
  );
}

const CHEVRON_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill='%23847b6d' d='M5.5 7.5l4.5 4.5 4.5-4.5'/%3E%3C/svg%3E\")";

export function SelectField({ label, help, value, onChange, options, placeholder }) {
  return (
    <Field label={label} help={help}>
      <select
        className={`${inputBase} appearance-none bg-no-repeat pr-8`}
        style={{ backgroundImage: CHEVRON_BG, backgroundSize: "14px", backgroundPosition: "right 10px center" }}
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
    </Field>
  );
}

export function SliderField({ label, help, value, onChange, min, max, step, format = (v) => v.toFixed(2) }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <Field
      label={
        <span className="flex items-center gap-2">
          {label}
          <span className="rounded-md bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-1.5 py-px text-[0.74rem] font-semibold tabular-nums text-accent">
            {format(value)}
          </span>
        </span>
      }
      help={help}
    >
      <input
        type="range"
        className="slider w-full"
        style={{ "--pct": `${pct}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

export function Checkbox({ label, checked, onChange }) {
  return (
    <label className="group flex cursor-pointer select-none items-center gap-2.5">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {/* no `key` remount here: the tick's draw-in is a transition on the existing
          path, and remounting would put it straight into its finished state */}
      <span
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-200 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent group-hover:border-accent ${
          checked ? "animate-pop border-accent bg-accent" : "border-border bg-surface"
        }`}
      >
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
          <path
            className={`tick ${checked ? "on" : ""}`}
            d="M2 6.2 4.8 9 10 3"
            stroke="var(--card)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="text-[0.85rem] text-ink-secondary transition-colors group-hover:text-ink-primary">{label}</span>
    </label>
  );
}
