import { useRef, useEffect, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { RotateCcw, AlertTriangle } from 'lucide-react';

type Props = {
  freqs: number[];
  powers: number[];
  peakHz: number;
  confidence: number;
  className?: string;
};

const ZONES = [
  { label: 'Concern', start: 3, end: 70, color: 'rgba(234, 179, 8, 0.07)' },
  { label: 'High risk', start: 12, end: 30, color: 'rgba(239, 68, 68, 0.12)' },
];

const BASE_NOTABLE_LINES = [
  { label: 'Peak discomfort 15 Hz', freq: 15, color: 'rgba(234, 179, 8, 0.6)' },
];

function isTherapyBand(phz: number): boolean {
  return phz >= 39 && phz <= 41;
}

export function SpectrumChart({ freqs, powers, peakHz, confidence, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const peakHzRef = useRef(peakHz);
  const lowConfidenceRef = useRef(confidence < 0.4);
  const [zoomed, setZoomed] = useState(false);
  const zoomedRef = useRef(false);

  peakHzRef.current = peakHz;
  lowConfidenceRef.current = confidence < 0.4;

  const lowConfidence = confidence < 0.4;

  useEffect(() => {
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || freqs.length === 0) return;

    const maxFreq = Math.min(freqs[freqs.length - 1] || 500, 140);
    const filteredFreqs: number[] = [];
    const filteredPowers: number[] = [];
    for (let i = 0; i < freqs.length; i++) {
      if (freqs[i] <= maxFreq) {
        filteredFreqs.push(freqs[i]);
        filteredPowers.push(powers[i]);
      }
    }

    const INITIAL_X = { min: 0, max: 140 };

    const opts: uPlot.Options = {
      width: container.clientWidth,
      height: 200,
      scales: {
        x: { time: false },
      },
      cursor: { drag: { x: true, y: false, setScale: true } },
      select: { show: true, top: 0, left: 0, width: 0, height: 0 },
      legend: { show: false },
      hooks: {
        setSelect: [
          (u: uPlot) => {
            const sel = u.select;
            if (sel.width > 2) {
              zoomedRef.current = true;
              setZoomed(true);
            }
          },
        ],
        drawClear: [
          (u: uPlot) => {
            const { ctx, bbox } = u;
            ctx.save();
            for (const zone of ZONES) {
              const x1 = u.valToPos(zone.start, 'x', true);
              const x2 = u.valToPos(zone.end, 'x', true);
              ctx.fillStyle = zone.color;
              ctx.fillRect(x1, bbox.top, x2 - x1, bbox.height);
            }
            ctx.restore();
          },
        ],
        draw: [
          (u: uPlot) => {
            const { ctx, bbox } = u;
            ctx.save();

            const notableLines = isTherapyBand(peakHzRef.current)
              ? [...BASE_NOTABLE_LINES, { label: 'Therapeutic 40 Hz', freq: 40, color: 'rgba(34, 197, 94, 0.6)' as const }]
              : BASE_NOTABLE_LINES;

            for (const line of notableLines) {
              const x = u.valToPos(line.freq, 'x', true);
              if (x < bbox.left || x > bbox.left + bbox.width) continue;
              ctx.strokeStyle = line.color;
              ctx.lineWidth = 1;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(x, bbox.top);
              ctx.lineTo(x, bbox.top + bbox.height);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = line.color;
              ctx.font = '10px monospace';
              const labelY = line.freq === 40
                ? bbox.top + bbox.height - 4
                : bbox.top + 14;
              ctx.fillText(line.label, x + 4, labelY);
            }

            const phz = peakHzRef.current;
            if (phz > 0) {
              const xPeak = u.valToPos(phz, 'x', true);
              if (xPeak >= bbox.left && xPeak <= bbox.left + bbox.width) {
                ctx.strokeStyle = lowConfidenceRef.current ? '#eab308' : '#ef4444';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(xPeak, bbox.top);
                ctx.lineTo(xPeak, bbox.top + bbox.height);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = lowConfidenceRef.current ? '#eab308' : '#ef4444';
                ctx.font = 'bold 11px monospace';
                ctx.fillText(`${phz.toFixed(1)} Hz`, xPeak + 4, bbox.top - 4);
              }
            }

            ctx.restore();
          },
        ],
      },
      axes: [
        {
          stroke: '#64748b',
          grid: { stroke: '#1e293b', width: 1 },
          ticks: { stroke: '#1e293b' },
          font: '10px monospace',
          label: 'Frequency (Hz)',
          labelFont: '10px monospace',
          labelGap: 4,
          values: (_self: uPlot, ticks: number[]) => ticks.map((v) => `${v} Hz`),
        },
        {
          stroke: '#64748b',
          grid: { stroke: '#1e293b', width: 1 },
          ticks: { stroke: '#1e293b' },
          font: '10px monospace',
          size: 48,
        },
      ],
      series: [
        {},
        {
          label: 'Power',
          stroke: '#9b8cff',
          width: 1.5,
          fill: 'rgba(155, 140, 255, 0.08)',
        },
      ],
    };

    const uData: uPlot.AlignedData = [filteredFreqs, filteredPowers];

    if (plotRef.current) {
      plotRef.current.setData(uData);
      const w = container.clientWidth;
      if (w > 0) plotRef.current.setSize({ width: w, height: 200 });
    } else {
      zoomedRef.current = false;
      setZoomed(false);
      const u = new uPlot(opts, uData, container);
      u.setScale('x', INITIAL_X);
      plotRef.current = u;
    }
  }, [freqs, powers]);

  function handleReset() {
    const u = plotRef.current;
    if (!u) return;
    zoomedRef.current = false;
    u.setScale('x', { min: 0, max: 140 });
    u.setSelect({ left: 0, top: 0, width: 0, height: 0 });
    setZoomed(false);
  }

  return (
    <div className="relative">
      <div ref={containerRef} className={className} />
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-[2px] bg-amber-500/20" />
          Concern 3–70 Hz
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-[2px] bg-red-500/25" />
          High risk 12–30 Hz
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-3 border-b border-dashed border-amber-500/60" />
          Peak discomfort 15 Hz
        </span>
        {isTherapyBand(peakHz) && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-px w-3 border-b border-dashed border-green-500/60" />
            Therapeutic 40 Hz
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {zoomed && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1 rounded bg-panel/90 px-2 py-1 text-sm text-text-dim transition hover:text-text-main"
            >
              <RotateCcw className="size-3" />
              Reset zoom
            </button>
          )}
        </div>
      </div>
      {lowConfidence && (
        <div className="pointer-events-none absolute top-2 right-2 flex items-center gap-1 rounded bg-warning/15 px-2 py-1 text-sm text-warning">
          <AlertTriangle className="size-3" />
          Low confidence
        </div>
      )}
    </div>
  );
}
