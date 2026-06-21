import { useRef, useEffect, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { RotateCcw } from 'lucide-react';
import type { LuminanceSample } from '../app/types';

type Props = {
  data: LuminanceSample[];
  className?: string;
};

export function BrightnessChart({ data, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) return;

    const opts: uPlot.Options = {
      width: container.clientWidth,
      height: 180,
      cursor: { drag: { x: true, y: false, setScale: true } },
      select: { show: true, top: 0, left: 0, width: 0, height: 0 },
      legend: { show: false },
      hooks: {
        setSelect: [
          (u: uPlot) => {
            const sel = u.select;
            if (sel.width > 2 || sel.height > 2) {
              setZoomed(true);
            }
          },
        ],
      },
      axes: [
        {
          stroke: '#64748b',
          grid: { stroke: '#1e293b', width: 1 },
          ticks: { stroke: '#1e293b' },
          font: '10px monospace',
          values: (_self: uPlot, ticks: number[]) => ticks.map((v) => `${v.toFixed(1)}s`),
        },
        {
          stroke: '#64748b',
          grid: { stroke: '#1e293b', width: 1 },
          ticks: { stroke: '#1e293b' },
          font: '10px monospace',
          size: 48,
          values: (_self: uPlot, ticks: number[]) => ticks.map((v) => `${(v * 100).toFixed(0)}%`),
        },
      ],
      series: [
        {},
        {
          label: 'Brightness',
          stroke: '#69e2ff',
          width: 1.5,
          fill: 'rgba(105, 226, 255, 0.08)',
        },
      ],
    };

    const times = data.map((d) => d.t);
    const values = data.map((d) => d.y);
    const uData: uPlot.AlignedData = [times, values];

    if (plotRef.current) {
      plotRef.current.setData(uData);
      const w = container.clientWidth;
      if (w > 0) plotRef.current.setSize({ width: w, height: 180 });
    } else {
      setZoomed(false);
      plotRef.current = new uPlot(opts, uData, container);
    }
  }, [data]);

  function handleReset() {
    const u = plotRef.current;
    if (!u) return;
    const d = u.data[0];
    u.setScale('x', { min: d[0], max: d[d.length - 1] });
    u.setSelect({ left: 0, top: 0, width: 0, height: 0 });
    setZoomed(false);
  }

  return (
    <div className="relative">
      <div ref={containerRef} className={className} />
      {zoomed && (
        <button
          onClick={handleReset}
          className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded bg-panel/90 px-2 py-1 text-[11px] text-text-dim transition hover:text-text-main"
        >
          <RotateCcw className="size-3" />
          Reset zoom
        </button>
      )}
    </div>
  );
}
