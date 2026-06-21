import type { FlickerMetrics, LuminanceSample } from '../app/types';

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('../workers/fft.worker.ts', import.meta.url),
      { type: 'module' },
    );
  }
  return worker;
}

export function terminateWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

export function analyzeSamples(
  samples: LuminanceSample[],
): Promise<FlickerMetrics> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const handler = (event: MessageEvent) => {
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errHandler);
      resolve(event.data as FlickerMetrics);
    };
    const errHandler = (event: ErrorEvent) => {
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errHandler);
      reject(new Error(event.message || 'Worker error'));
    };
    w.addEventListener('message', handler);
    w.addEventListener('error', errHandler);

    const t = new Float64Array(samples.map((s) => s.t));
    const y = new Float64Array(samples.map((s) => s.y));

    w.postMessage(
      {
        timestamps: t.buffer,
        luminance: y.buffer,
      },
      [t.buffer, y.buffer],
    );
  });
}
