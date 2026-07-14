import { useRef, useEffect, useState } from 'react';
import { Play, Pause } from 'lucide-react';

type Props = {
  videoUrl: string;
  onTimeUpdate?: (t: number) => void;
};

export function PreviewPlayer({ videoUrl, onTimeUpdate }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState('0:00 / 0:00');

  useEffect(() => {
    setPlaying(false);
  }, [videoUrl]);

  const toggle = () => {
    if (!ref.current) return;
    if (ref.current.paused) {
      ref.current.play().catch(() => {});
      setPlaying(true);
    } else {
      ref.current.pause();
      setPlaying(false);
    }
  };

  return (
    <div>
      <video
        ref={ref}
        src={videoUrl}
        muted
        playsInline
        preload="auto"
        className="w-full max-h-[360px] rounded-lg bg-black object-contain"
        onTimeUpdate={() => {
          const v = ref.current;
          if (!v) return;
          const m = Math.floor(v.currentTime / 60);
          const s = Math.floor(v.currentTime % 60);
          const dm = Math.floor((v.duration || 0) / 60);
          const ds = Math.floor((v.duration || 0) % 60);
          setTime(`${m}:${s.toString().padStart(2, '0')} / ${dm}:${ds.toString().padStart(2, '0')}`);
          onTimeUpdate?.(v.currentTime);
        }}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={toggle}
          className="flex size-10 items-center justify-center rounded-md border border-border bg-panel text-text-muted transition hover:border-accent hover:text-accent"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <span className="font-mono text-sm tabular-nums text-text-dim">{time}</span>
      </div>
    </div>
  );
}
