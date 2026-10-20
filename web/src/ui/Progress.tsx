/** A labelled progress bar for the slow jobs: building a rotation, reading a PDF. */
export function Progress({ done, label }: { done: number; label: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, done)) * 100);
  return (
    <div class="progress-box" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
      <div class="progress-head">
        <span>{label}</span>
        <span class="progress-pct">{percent}%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
