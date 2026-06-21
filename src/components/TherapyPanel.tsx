import type { TherapyReport, TherapyCriterion } from '../app/types';
import { therapyVerdictColor, therapyVerdictLabel } from '../lib/therapy';

type Props = {
  report: TherapyReport;
};

export function TherapyPanel({ report }: Props) {
  const { verdict, score, criteria, redFlags, summary } = report;
  const colorClass = therapyVerdictColor(verdict);

  /* Score gauge: a ring-like bar using conic gradient */
  const gaugeAngle = (score / 100) * 360;

  return (
    <div className="space-y-4">
      {/* Verdict badge + score */}
      <div className="flex items-center gap-4 rounded-lg border border-border bg-panel p-4">
        {/* Score ring */}
        <div className="relative size-16 shrink-0">
          <div
            className="size-full rounded-full"
            style={{
              background: `conic-gradient(currentColor ${gaugeAngle}deg, rgba(255,255,255,0.08) ${gaugeAngle}deg)`,
              color: `var(--tw-${colorClass.replace('text-', '')})`,
            }}
          />
          <div className="absolute inset-2 flex items-center justify-center rounded-full bg-panel">
            <span className={`text-base font-bold tabular-nums ${colorClass}`}>
              {score}
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <div className={`text-lg font-bold ${colorClass}`}>
            {therapyVerdictLabel(verdict)}
          </div>
          <div className="text-xs text-text-muted">
            40 Hz gamma therapy protocol validation
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="rounded-lg border border-border bg-panel-2 p-3 text-xs leading-relaxed text-text-main">
        {summary}
      </div>

      {/* Criteria grid */}
      <div className="grid gap-2 sm:grid-cols-2">
        {criteria.map((c) => (
          <CriterionCard key={c.key} criterion={c} />
        ))}
      </div>

      {/* Red flags */}
      {redFlags.length > 0 && (
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-danger">
            {redFlags.length === 1 ? '1 red flag' : `${redFlags.length} red flags`}
          </h4>
          <div className="space-y-1.5">
            {redFlags.map((flag, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs leading-relaxed text-danger"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0">
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z" />
                </svg>
                <span>{flag}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No red flags */}
      {redFlags.length === 0 && verdict !== 'indeterminate' && (
        <div className="flex items-center gap-2 rounded-lg border border-safe/20 bg-safe/5 px-3 py-2 text-xs text-safe">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>No red flags detected. Waveform characteristics are consistent with the 40 Hz protocol.</span>
        </div>
      )}
    </div>
  );
}

/* ---- Internal: per-criterion card ---- */

const passColors: Record<string, string> = {
  true: 'text-safe',
  warning: 'text-warning',
  false: 'text-danger',
};

const passIcons: Record<string, React.ReactElement> = {
  true: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  warning: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  false: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
};

function CriterionCard({ criterion }: { criterion: TherapyCriterion }) {
  const statusClass = passColors[String(criterion.pass)] || 'text-text-dim';
  const icon = passIcons[String(criterion.pass)] || null;

  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">
          {criterion.label}
        </span>
        <span className={`inline-flex items-center gap-1 ${statusClass}`}>
          {icon}
        </span>
      </div>
      <div className="mb-0.5 font-mono text-sm font-semibold tabular-nums text-text-main">
        {criterion.value}
      </div>
      <div className="text-[10px] text-text-dim">
        Target: {criterion.target}
      </div>
      <div className="mt-1.5 text-[10px] leading-relaxed text-text-muted">
        {criterion.explanation}
      </div>
    </div>
  );
}
