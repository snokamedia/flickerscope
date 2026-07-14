import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { VideoMetadata } from '../app/types';
import { getFpsTier } from '../lib/fps-constraints';

type Props = {
  metadata: VideoMetadata;
};

const TIER_CONFIG = {
  reject: { label: 'too low', class: 'text-danger border-danger/30', icon: AlertCircle, iconClass: 'text-danger' },
  limited: { label: 'limited', class: 'text-warning border-warning/30', icon: AlertCircle, iconClass: 'text-warning' },
  adequate: { label: 'adequate', class: 'text-safe border-safe/30', icon: CheckCircle2, iconClass: 'text-safe' },
} as const;

export function MetadataPanel({ metadata }: Props) {
  const codecSupported = ['avc', 'hevc', 'vp9', 'av1'].includes(metadata.codec);
  const fps = metadata.fpsDecoded;
  const tier = getFpsTier(fps);
  const tierCfg = TIER_CONFIG[tier];
  const TierIcon = tierCfg.icon;
  const durationOk = metadata.duration >= 5;
  const framesOk = metadata.frameCount >= 1200;

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-3">
        <Stat
          label="Frame rate"
          value={`${fps.toFixed(1)} fps`}
          icon={<TierIcon className={`size-3.5 ${tierCfg.iconClass}`} />}
          valueClass={tier === 'adequate' ? 'text-safe' : tier === 'reject' ? 'text-danger' : 'text-warning'}
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
          label="Duration"
          value={`${metadata.duration.toFixed(1)}s`}
          icon={durationOk ? <CheckCircle2 className="size-3.5 text-safe" /> : <AlertCircle className="size-3.5 text-warning" />}
          valueClass={durationOk ? 'text-safe' : 'text-warning'}
        />
        <Stat
          label="Frames"
          value={`${metadata.frameCount}`}
          icon={framesOk ? <CheckCircle2 className="size-3.5 text-safe" /> : <AlertCircle className="size-3.5 text-warning" />}
          valueClass={framesOk ? 'text-safe' : 'text-warning'}
        />
      </div>
      <div className="space-y-3">
        <Stat label="Resolution" value={`${metadata.width} × ${metadata.height}`} />
        <Stat
          label="Codec"
          value={metadata.codec.toUpperCase()}
          valueClass={codecSupported ? 'text-safe' : 'text-warning'}
          icon={codecSupported ? <CheckCircle2 className="size-3.5 text-safe" /> : <AlertCircle className="size-3.5 text-warning" />}
        />
      </div>
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
      <div className="mb-0.5 flex items-center gap-1.5 text-xs uppercase tracking-wider text-text-dim">
        {icon}
        {label}
      </div>
      <div className={`flex items-center gap-2 font-mono text-sm font-semibold tabular-nums ${valueClass ?? 'text-text-main'}`}>
        {value}
        {badge && <span className={`rounded border px-1 py-px text-[11px] font-medium uppercase leading-none tracking-wider ${badgeClass}`}>{badge}</span>}
      </div>
      {help && <div className="mt-0.5 text-xs text-text-dim">{help}</div>}
    </div>
  );
}
