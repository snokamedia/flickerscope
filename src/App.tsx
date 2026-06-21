import { useState, useCallback } from 'react';
import { Accordion } from '@base-ui/react/accordion';
import { UploadDropzone } from './components/UploadDropzone';
import { MetadataPanel } from './components/MetadataPanel';
import { PreviewPlayer } from './components/PreviewPlayer';
import { TimelineSlider } from './components/TimelineSlider';
import { StatStrip } from './components/StatStrip';
import { BrightnessChart } from './components/BrightnessChart';
import { SpectrumChart } from './components/SpectrumChart';
import { ResultsPanel } from './components/ResultsPanel';
import { PrivacyNotice } from './components/PrivacyNotice';
import { useVideoFile } from './hooks/useVideoFile';
import { useAnalysis } from './hooks/useAnalysis';
import { AnalysisTabs } from './components/AnalysisTabs';
import { validateTherapy } from './lib/therapy';
import type { Segment } from './app/types';

export default function App() {
  const video = useVideoFile();
  const analysis = useAnalysis();

  const [segment, setSegment] = useState<Segment | null>(null);

  const handleFile = useCallback((file: File) => {
    analysis.reset();
    setSegment(null);
    video.loadFile(file);
  }, [video, analysis]);

  const handleSegmentChange = useCallback((seg: Segment) => {
    setSegment(seg);
  }, []);

  const handleAnalyze = useCallback(() => {
    if (!video.file || !video.metadata || !segment) return;
    analysis.runAnalysis(video.file, video.metadata, segment);
  }, [video.file, video.metadata, segment, analysis]);

  const canAnalyze = !!(video.file && video.metadata && segment && !analysis.running);
  const fpsAvg = video.metadata?.fpsAverage ?? 0;
  const fpsTier = fpsAvg < 120 ? 'reject' : fpsAvg < 240 ? 'limited' : 'adequate';

  return (
    <div className="mx-auto max-w-3xl px-3 py-6 sm:px-4 sm:py-8">
      <header className="mb-6 text-center">
        <h1 className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-2xl font-bold text-transparent">
          FlickerScope
        </h1>
        <p className="mt-0.5 text-xs text-text-dim">
          Light flicker frequency estimator
        </p>
      </header>

      {!video.metadata && (
        <UploadDropzone onFile={handleFile} disabled={video.loading} />
      )}

      {video.metadata && (
        <section className="mb-4 space-y-4">
          <MetadataPanel metadata={video.metadata} />
          {fpsTier === 'reject' && (
            <div className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
              Frame rate ({video.metadata.fpsAverage.toFixed(1)} fps) is too low for flicker
              analysis. Minimum 120 fps required. Use a slow-motion mode (240 fps or higher).
            </div>
          )}
          {fpsTier === 'limited' && (
            <div className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">
              Frame rate ({video.metadata.fpsAverage.toFixed(1)} fps) limits analysis to
              low frequencies (≤ ~60 Hz). 100/120 Hz driver flicker may alias.
              {' '}<strong>240+ fps recommended</strong>.
            </div>
          )}
          {fpsTier === 'adequate' && (
            <div className="rounded-lg border border-accent/20 bg-accent-dim/30 px-3 py-2 text-xs text-accent">
              Frame rate ({video.metadata.fpsAverage.toFixed(1)} fps) is suitable for
              flicker analysis. Nyquist limit: {((video.metadata.fpsAverage / 2)).toFixed(0)} Hz.
            </div>
          )}
        </section>
      )}

      {video.videoUrl && (
        <section className="mb-4 space-y-3 rounded-lg border border-border bg-panel p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">
              Preview &amp; Trim
            </h2>
          </div>
          <PreviewPlayer videoUrl={video.videoUrl} onTimeUpdate={(t) => setSegment((s) => s)} />
          <TimelineSlider
            duration={video.metadata?.duration ?? 0}
            onSegmentChange={handleSegmentChange}
            onSeek={(t) => {
              const vid = document.querySelector<HTMLVideoElement>('video');
              if (vid) vid.currentTime = t;
            }}
          />
          <button
            onClick={handleAnalyze}
            disabled={!canAnalyze || fpsTier === 'reject'}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-black transition hover:bg-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {analysis.running
              ? 'Analyzing…'
              : fpsTier === 'reject'
                ? 'Insufficient frame rate'
                : 'Analyze selected segment'
            }
          </button>
        </section>
      )}

      {analysis.running && (
        <section className="mb-4 space-y-2 rounded-lg border border-border bg-panel p-4">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>Decoding &amp; analyzing</span>
            {analysis.progress && (
              <span className="font-mono tabular-nums">
                {analysis.progress.current} / {analysis.progress.total} frames
              </span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-accent transition-all duration-200"
              style={{
                width: analysis.progress
                  ? `${Math.min(100, (analysis.progress.current / analysis.progress.total) * 100)}%`
                  : '0%',
              }}
            />
          </div>
        </section>
      )}

      {analysis.error && (
        <section className="mb-4 rounded-lg border border-danger/20 bg-danger/5 p-3 text-xs text-danger">
          {analysis.error}
        </section>
      )}

      {analysis.results && video.metadata && (
        <section className="mb-4 space-y-4">
          <ResultsPanel results={analysis.results} />
          <StatStrip metadata={video.metadata} results={analysis.results} />

          <AnalysisTabs
            therapyReport={validateTherapy(analysis.results)}
          >
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-panel p-3 sm:p-4">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-dim">
                  Brightness over time
                </h3>
                <BrightnessChart
                  data={analysis.results.timeSeries}
                  className="w-full"
                />
              </div>

              <div className="rounded-lg border border-border bg-panel p-3 sm:p-4">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-dim">
                  Frequency spectrum
                </h3>
                <SpectrumChart
                  freqs={analysis.results.spectrum.map((s) => s.freq)}
                  powers={analysis.results.spectrum.map((s) => s.power)}
                  peakHz={analysis.results.frequencyHz}
                  confidence={analysis.results.confidence}
                  className="w-full"
                />
              </div>
            </div>
          </AnalysisTabs>
        </section>
      )}

      {video.error && !video.metadata && (
        <section className="mb-4 rounded-lg border border-danger/20 bg-danger/5 p-3 text-xs text-danger">
          {video.error}
        </section>
      )}

      <div className="mt-6 space-y-3">
        <PrivacyNotice />
        <Accordion.Root className="mx-auto max-w-lg">
          <Accordion.Item value="about" className="border-b border-border/0">
            <Accordion.Header>
              <Accordion.Trigger className="group flex w-full items-center justify-center gap-1 py-1 text-[11px] text-text-dim transition hover:text-text-muted">
                <span className="inline-block transition-transform group-data-[panel-open]:rotate-90">▶</span>
                About these measurements
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Panel className="pt-2 text-[10px] leading-relaxed text-text-dim">
              <div className="space-y-3">
                <section>
                  <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Method</h4>
                  <p>
                    FlickerScope analyzes video frames to estimate temporal luminance modulation.
                    Values are derived from camera pixel data (sRGB → linear-light Rec. 709 luminance),
                    resampled to a uniform time grid, and analyzed via FFT with Hann windowing.
                    Peak detection uses prominence-based filtering with a trimmed-median noise floor.
                  </p>
                </section>
                <section>
                  <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Standards</h4>
                  <p>
                    IEEE 1789-2015 risk references (NOEL, Low-risk) are provided as screening guidance.
                    Browser-based video analysis is <strong>not a substitute</strong> for calibrated
                    instrumentation (photodiode + IEC 61000-4-15 flickermeter) required for formal
                    compliance certification. Perceptual metrics such as Pst (IEC 61000-4-15) and
                    SVM (NEMA 77) require validated perception models not present in this tool.
                  </p>
                </section>
                <section>
                  <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Limitations</h4>
                  <p>
                    Camera ISP processing (tone mapping, denoising, HDR, auto-exposure),
                    rolling shutter, gamma correction, and compression artifacts may affect
                    measurement accuracy. Results are diagnostic — not certifiable.
                  </p>
                </section>
                <section>
                  <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Recommended capture</h4>
                  <p>
                    240+ fps slow-motion, locked exposure, stationary camera,
                    light source filling most of the frame. Avoid motion blur and mixed lighting.
                  </p>
                </section>
              </div>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion.Root>
      </div>
    </div>
  );
}
