import { useEffect, useRef, useState } from "react";

export function MultiFilter({ label, allLabel, options, value, onChange }: {
  label: string;
  allLabel: string;
  options: Record<string, string>;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return <div className="multi-filter" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
  }}>
    <button type="button" ref={button} aria-label={`${label}: ${value.length ? value.map(key => options[key]).join(", ") : allLabel}`} aria-expanded={open} onClick={() => setOpen(!open)}>
      {value.length === 0 ? allLabel : value.length === 1 ? options[value[0]] : `${label}: ${value.length}`}
    </button>
    {open && <div className="multi-filter-options" role="group" aria-label={label}>
      {Object.entries(options).map(([key, text]) => <button
        type="button"
        key={key}
        className={`filter-choice ${key}`}
        aria-pressed={value.includes(key)}
        onClick={() => onChange(value.includes(key) ? value.filter(item => item !== key) : [...value, key])}
      >
        {text}
      </button>)}
    </div>}
  </div>;
}
