import { useState } from "preact/hooks";
import { suggestions } from "../form/validate";

interface Props {
  value: string;
  pool: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

/** A text box that offers names or places used before, as the Windows app does. */
export function Autocomplete({ value, pool, onChange, placeholder, label }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = open ? suggestions(pool, value) : [];

  const take = (v: string) => {
    onChange(v);
    setOpen(false);
    setActive(-1);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!matches.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((active + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active <= 0 ? matches.length - 1 : active - 1);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      take(matches[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div class="auto">
      <input
        value={value}
        placeholder={placeholder}
        aria-label={label}
        autoCapitalize="words"
        autoComplete="off"
        spellcheck={false}
        onInput={(e) => {
          onChange((e.currentTarget as HTMLInputElement).value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
      />
      {matches.length > 0 && (
        <ul class="auto-list" role="listbox">
          {matches.map((m, i) => (
            <li
              key={m}
              role="option"
              aria-selected={i === active}
              class={i === active ? "on" : ""}
              // pointerdown fires before the box loses focus, so the tap lands
              onPointerDown={(e) => {
                e.preventDefault();
                take(m);
              }}
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
