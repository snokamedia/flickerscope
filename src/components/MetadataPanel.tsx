import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { VideoMetadata } from '../app/types';
import { getFpsTier } from '../lib/fps-constraints';

type Props = {
  metadata: VideoMetadata;
};

const TIER_CONFIG = {
  reject: { label: 'too low', class: 'text-danger border-danger/30' },
  limited: { label: 'limited', class: 'text-warning border-warning/30' },
  adequate: { label: 'adequate', class: 'text-safe border-safe/30' },
} as const;

export function MetadataPanel({ metadata }: Props) {
  const codecSupported = ['avc', 'hevc', 'vp9', 'av1'].includes(metadata.codec);
  const fps = metadata.fpsDecoded;
  const tier = getFpsTier(fps);
  const tierCfg = TIER_CONFIG[tier];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Stat label="Resolution" value={`${metadata.width} × ${metadata.height}`} />
      <Stat label="Duration" value={`${metadata.duration.toFixed(1)}s`} />
      <Stat label="Frames" value={`${metadata.frameCount}`} />
      <Stat
        label="Frame rate"
        value={`${fps.toFixed(1)} fps`}
        badge={tierCfg.label}
        badgeClass={tierCfg.class}
        help={
          metadata.isVfrLikely
            ? 'variable frame rate'
            : Math.abs(fps - metadata.fpsAverage) > 5
              ? `container reports ${metadata.fpsAverage.toFixed(0)} fps`
              : metadata.fpsNominal
                ? `nominal ${metadata.fpsNominal} fps`
                : undefined
        }
      />
      <Stat
        label="Codec"
        value={metadata.codec.toUpperCase()}
        valueClass={codecSupported ? 'text-safe' : 'text-warning'}
        icon={codecSupported ? <CheckCircle2 className="size-3.5 text-safe" /> : <AlertCircle className="size-3.5 text-warning" />}
      />
    </div>
  );
}

function Stat({ label, value, help, valueClass, icon, badge, badgeClass }: {
  label: string;
  value: string;
  help?: string;
  valueClass?: string;
  icon?: React.ReactNode;
  badge?: string;
  badgeClass?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <div className="mb-0.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-text-dim">
        {icon}
        {label}
      </div>
      <div className={`flex items-center gap-2 font-mono text-sm font-semibold tabular-nums ${valueClass ?? 'text-text-main'}`}>
        {value}
        {badge && <span className={`rounded border px-1 py-px text-[9px] font-medium uppercase leading-none tracking-wider ${badgeClass}`}>{badge}</span>}
      </div>
      {help && <div className="mt-0.5 text-[10px] text-text-dim">{help}</div>}
    </div>
  );
}
