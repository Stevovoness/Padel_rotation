import type { ComponentChildren } from "preact";

interface Props {
  title: string;
  subtitle?: string;
  left?: ComponentChildren;
}

export function Header({ title, subtitle, left }: Props) {
  return (
    <header class="header">
      {left}
      <div class="header-text">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </header>
  );
}
