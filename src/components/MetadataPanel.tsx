import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { VideoMetadata } from '../app/types';

type Props = {
  metadata: VideoMetadata;
};

export function MetadataPanel({ metadata }: Props) {
  const codecSupported = ['avc', 'hevc', 'vp9', 'av1'].includes(metadata.codec);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Resolution" value={`${metadata.width} × ${metadata.height}`} />
      <Stat label="Duration" value={`${metadata.duration.toFixed(1)}s`} />
      <Stat
        label="Frame rate"
        value={`${metadata.fpsDecoded.toFixed(1)} fps`}
        help={
          metadata.isVfrLikely
            ? 'variable frame rate'
            : Math.abs(metadata.fpsDecoded - metadata.fpsAverage) > 5
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

function Stat({ label, value, help, valueClass, icon }: {
  label: string;
  value: string;
  help?: string;
  valueClass?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <div className="mb-0.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-text-dim">
        {icon}
        {label}
      </div>
      <div className={`font-mono text-sm font-semibold tabular-nums ${valueClass ?? 'text-text-main'}`}>
        {value}
      </div>
      {help && <div className="mt-0.5 text-[10px] text-text-dim">{help}</div>}
    </div>
  );
}
