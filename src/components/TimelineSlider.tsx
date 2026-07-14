import { useState, useCallback, useRef, useEffect } from 'react';
import { Scissors } from 'lucide-react';
import type { Segment } from '../app/types';


type Props = {
  duration: number;
  onSegmentChange: (seg: Segment) => void;
  onSeek: (t: number) => void;
  disabled?: boolean;
};

const MIN_DURATION = 0.5;

export function TimelineSlider({ duration, onSegmentChange, onSeek, disabled }: Props) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.min(3, duration));
  const [playhead, setPlayhead] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ type: 'start' | 'end' | 'playhead'; startVal: number; endVal: number; origX: number } | null>(null);

  const pct = (t: number) => (t / duration) * 100;

  const getTimeFromEvent = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const norm = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return norm * duration;
  }, [duration]);

  const emitSegment = useCallback((s: number, e: number) => {
    onSegmentChange({ start: s, end: e });
  }, [onSegmentChange]);

  const handlePointerDown = useCallback((e: React.PointerEvent, type: 'start' | 'end' | 'playhead') => {
    if (disabled) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { type, startVal: start, endVal: end, origX: e.clientX };

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const t = getTimeFromEvent(ev.clientX);
      const clampedT = Math.max(0, Math.min(duration, t));

      if (type === 'start') {
        const maxS = end - MIN_DURATION;
        const newS = Math.max(0, Math.min(maxS, clampedT));
        setStart(newS);
        emitSegment(newS, end);
        onSeek(newS);
      } else if (type === 'end') {
        const minE = start + MIN_DURATION;
        const newE = Math.min(duration, Math.max(minE, clampedT));
        setEnd(newE);
        emitSegment(start, newE);
        onSeek(newE);
      } else {
        setPlayhead(clampedT);
        onSeek(clampedT);
      }
    };

    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [disabled, duration, start, end, getTimeFromEvent, emitSegment, onSeek]);

  useEffect(() => {
    setEnd(Math.min(end, duration));
  }, [duration]);

  return (
    <div className="space-y-2">
      <div
        ref={trackRef}
        className="relative h-12 touch-none select-none"
      >
        <div className="absolute top-1/2 left-0 right-0 h-1 -translate-y-1/2 rounded-full bg-border" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }}
        />
        <div
          className="absolute top-1/2 h-full w-1 -translate-y-1/2 bg-danger/70"
          style={{ left: `${pct(playhead)}%` }}
        />
        <div
          className="absolute top-1/2 z-10 h-10 w-4 -translate-y-1/2 cursor-grab rounded-sm bg-accent active:cursor-grabbing"
          style={{ left: `${pct(start)}%` }}
          onPointerDown={(e) => handlePointerDown(e, 'start')}
          role="slider"
          aria-label="Segment start"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={start}
          tabIndex={0}
        />
        <div
          className="absolute top-1/2 z-10 h-10 w-4 -translate-y-1/2 cursor-grab rounded-sm bg-accent active:cursor-grabbing"
          style={{ left: `${pct(end)}%` }}
          onPointerDown={(e) => handlePointerDown(e, 'end')}
          role="slider"
          aria-label="Segment end"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={end}
          tabIndex={0}
        />
        <div
          className="absolute top-1/2 z-20 h-10 w-3 -translate-x-1/2 -translate-y-1/2 cursor-col-resize"
          style={{ left: `${pct(playhead)}%` }}
          onPointerDown={(e) => handlePointerDown(e, 'playhead')}
          role="slider"
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={playhead}
          tabIndex={0}
        >
          <div className="mx-auto h-full w-0.5 bg-danger" />
        </div>
      </div>
      <div className="flex items-center justify-between font-mono text-xs tabular-nums text-text-dim">
        <span>{start.toFixed(4)}</span>
        <span className="flex items-center gap-1 text-text-muted">
          <Scissors className="size-3" />
          {(end - start).toFixed(4)}s
        </span>
        <span>{end.toFixed(4)}</span>
      </div>
    </div>
  );
}
