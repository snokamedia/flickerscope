# FlickerScope

**A fully client-side browser app for estimating dominant light flicker frequency and related waveform metrics from high-frame-rate video — with no video upload and no server processing.**

FlickerScope analyzes user-supplied slow-motion video in the browser to estimate temporal light modulation characteristics such as dominant flicker frequency, effective frame rate, modulation depth, flicker index, harmonic structure, duty cycle, timing jitter, and selected perceptual or application-specific screening metrics. It is built for rapid investigation, comparative testing, and educational use when dedicated laboratory instrumentation is unavailable or impractical.

***

## **Legal disclaimer**

**FlickerScope is NOT a certified flickermeter. It does NOT implement or satisfy the requirements of IEC 61000-4-15 flickermeter instrumentation, and it does NOT implement NEMA 77 / SVM compliance measurement.**

**FlickerScope is NOT a substitute for calibrated photodiode instrumentation, laboratory photometric equipment, or standards-based compliance testing.** Results are derived from camera video, not a calibrated optical sensor, so camera processing can materially affect accuracy.

**Camera-based limitations matter.** Smartphone and consumer camera pipelines may introduce rolling shutter effects, auto-exposure changes, HDR/tone mapping, denoising, sharpening, compression artifacts, frame pacing irregularity, dropped frames, and gamma encoding that can distort the waveform observed by the app.

**All results are screening and diagnostic estimates only.** They are suitable for exploratory analysis, engineering triage, comparative testing, and educational review, but they must not be treated as formal certification, regulatory evidence, product compliance proof, medical validation, or contractual acceptance criteria.

***

## Quick start

### Use the hosted app (no install)

The easiest way to use FlickerScope is the hosted version:

**[https://snokamedia.github.io/flickerscope/](https://snokamedia.github.io/flickerscope/)**

Open it in any modern phone or desktop browser. It works entirely client-side — no uploads, no account, no install.

### Requirements

- A modern browser with WebCodecs / HTMLMediaElement support (Chrome, Edge, Samsung Internet, Safari 16.4+)
- High-frame-rate video for meaningful analysis, ideally 240 fps or higher
- See the [Capturing Video for FlickerScope](https://github.com/snokamedia/flickerscope/wiki/Capturing-Video-for-FlickerScope) wiki page for phone capture setup guides

### Run from source (developers only)

```bash
git clone https://github.com/snokamedia/flickerscope.git
cd flickerscope
npm install
npm run dev
```

```bash
npm run build
npm run preview
```

***

## Why FlickerScope exists

Dedicated flicker measurement hardware remains the gold standard, but it is often expensive, lab-bound, or unavailable in field situations. FlickerScope exists to provide a practical, privacy-preserving, browser-native workflow for:

- rapid screening,
- comparative measurements between fixtures or settings,
- educational demonstration of flicker behavior,
- early engineering triage before deeper instrumented testing,
- and quick verification that a suspect source has a dominant modulation frequency in the range expected.

It is especially useful when the alternative is "no measurement at all," not when the alternative is a certified lab workflow.

***

## Feature map

FlickerScope intentionally separates features by confidence and intended use.

### Screening

- **Dominant frequency estimation** from high-frame-rate video.
- **Modulation depth (Michelson contrast)** for percent-modulation style screening.
- **7-level IEEE 1789-2015 inspired verdict** spanning NOEL through high plus uncertain; this is an application-level screening interpretation, not a standards-certified compliance result.

### Diagnostic

- **Effective frame-rate verification** from observed frame timing.
- **Variable frame rate (VFR) detection** using the coefficient of variation of inter-frame intervals.
- **Linear-light luminance extraction** using sRGB gamma expansion and Rec.709 coefficients.
- **Area-based flicker index** in the style commonly used in lighting analysis.
- **Duty cycle and timing jitter** from hysteresis thresholding with interpolated crossings.
- **Harmonic peak detection** using local prominence and a trimmed-median noise floor.
- **Brightness waveform and spectrum inspection** using interactive uPlot charts.
- **Timeline trimming** so the user can isolate the most representative segment.

### Experimental

- **MP_proxy**, a revised-MP-inspired perceptual flicker metric using Hann windowing, C_H = 1.225 correction, and MDT weighting informed by temporal contrast sensitivity research. This is an approximation, not a certified ASSIST MP implementation.
- **40 Hz gamma flicker waveform validation**, using a six-criterion rubric with spectral red flags such as 20 Hz suppression checks and odd-harmonic structure review. This is a waveform quality screen only, not a medical or therapeutic certification workflow.

***

## Why not just use...

| Tool | Strengths | What it cannot do | Where FlickerScope helps |
|---|---|---|---|
| **Phone slow-motion + FlickerScope** | Cheap, accessible, private, fast, no lab gear | Cannot provide standards-grade optical measurement; limited by camera pipeline and frame rate | Rapid field screening, comparison between fixtures, educational use |
| **Photodiode + oscilloscope** | Direct waveform capture, high temporal resolution, far better timing fidelity | Requires lab setup, equipment cost, and expertise | Useful when lab setup is unavailable or for candidate screening before bench testing |
| **Spectrometer** | Spectral power distribution and some temporal analysis | Expensive, complex, overkill for simple flicker screening | Simpler and cheaper for browser-based temporal screening from video |
| **Lux meter** | Useful for absolute illuminance measurements | Most lux meters cannot provide temporal waveform analysis | FlickerScope can reveal modulation patterns a basic lux meter cannot |

### Standards boundary

- IEC 61000-4-15 defines the functional specification for flickermeter apparatus. FlickerScope does not implement that standardized instrument model.
- NEMA 77 addresses temporal light artifact measurement, including SVM. FlickerScope does not implement SVM compliance measurement.
- Browser video analysis is best treated as **screening and diagnostic support**, not formal compliance evidence.

***

## Recommended capture technique

See the [Capturing Video for FlickerScope](https://github.com/snokamedia/flickerscope/wiki/Capturing-Video-for-FlickerScope) wiki page for detailed setup guides using Open Camera (Android) and iPhone slow-motion capture.

### Best practice

- Use **240 fps or higher** slow-motion capture whenever possible.
- Lock exposure if the camera app supports it.
- Disable HDR or other adaptive image enhancements if possible.
- Keep the camera **stationary** — a tripod or phone stand helps greatly.
- Fill as much of the frame as practical with the light source or illuminated target.
- Avoid mixed lighting scenes when testing a single fixture.
- Record several seconds of stable footage (trim off the start and end where you pressed the button — FlickerScope's timeline controls let you select only the clean middle segment).
- Avoid severe clipping, overexposure, or deep underexposure.

### Why 240+ fps matters

The usable analysis band is constrained by the Nyquist limit, which is half the effective frame rate. At 240 fps, the Nyquist limit is 120 Hz. Frequencies near Nyquist are less reliable than frequencies comfortably below it, especially in a camera-based workflow.

For the most common consumer use case — screening mains-powered LED lighting — the dominant flicker component is typically at 100 Hz (50 Hz mains) or 120 Hz (60 Hz mains). Captured at 240 fps, 120 Hz sits right at Nyquist. In this case, **modulation depth is the primary screening metric** (IEEE 1789 low-risk ceiling ≈ 0.08 × f, roughly 8–10% at these frequencies). Harmonic structure, timing jitter, and exact waveform shape carry lower confidence near the sampling limit and should be treated as secondary diagnostics. Despite the Nyquist constraint, this still supports a practical low-concern vs. higher-concern judgment aligned with IEEE-style modulation thresholds at the detected frequency.

### Practical advice

- For mains-related flicker screening, 240 fps is the preferred starting point.
- For waveform shape review, longer steady captures help.
- For comparative testing, consistency matters more than absolute perfection.
- If the source occupies only a small portion of the frame, results may be diluted by background pixels.

***

## Core metrics

### Frequency and confidence

- Dominant frequency estimate with parabolic interpolation
- Effective frame rate from median inter-frame interval
- Combined confidence score (PNR, Nyquist proximity, cycle count)
- Variable frame rate warning where applicable

### Amplitude and waveform metrics

- Modulation depth (Michelson contrast / percent flicker)
- Area-based flicker index (trapezoidal integration over time)
- Duty cycle and timing jitter (hysteresis thresholding, same-direction crossings)

### Spectral diagnostics

- Harmonic peaks (prominence-based, trimmed-median noise floor)
- Relative spectral structure
- Noise-floor-aware peak ranking (top 5)

### Experimental metrics

- MP_proxy (revised MP-inspired perceptual flicker estimate)
- 40 Hz waveform validation rubric with spectral red-flag checks

***

## Limitations

### Instrumentation limits

- FlickerScope is not a certified flickermeter.
- It does not implement IEC 61000-4-15 instrument behavior or reporting.
- It does not implement NEMA 77 / SVM compliance measurement.
- It is not a substitute for a calibrated photodiode plus oscilloscope workflow.

### Camera and browser limits

- Measurements come from decoded video, not direct sensor readout.
- Smartphone processing pipelines can distort temporal modulation.
- Rolling shutter can alter apparent waveform structure.
- Compression can smear or reshape transitions.
- Auto-exposure and HDR can create false low-frequency trends.
- Browser media support varies by codec, device, and operating system.

### Sampling limits

- Frequencies above half the effective frame rate cannot be measured reliably.
- Frequencies near the Nyquist limit are particularly fragile.
- Some real sources may alias into misleading lower-frequency artifacts.
- Variable frame rate content is less reliable than stable cadence content.

### Interpretation limits

- The IEEE-inspired verdict is a screening aid, not a compliance result.
- MP_proxy is experimental.
- 40 Hz validation is a waveform resemblance tool, not a clinical determination.

***

## Validation philosophy

FlickerScope should be validated like a practical screening tool, not assumed correct by default.

Recommended approach:

- Compare against a photodiode plus oscilloscope setup whenever available.
- Test repeatability using multiple captures of the same source.
- Compare multiple phones to understand device-specific bias.
- Build a small library of known-good and known-bad reference clips.
- Treat algorithm changes as requiring regression review.
- Prefer conservative interpretation when capture quality is weak or confidence is poor.

**Guiding principles:**

- better to warn than to overclaim,
- better to label uncertain than to imply precision,
- better to support engineering judgment than to pretend certification.

***

## Technical stack

- **Vite** for build and development tooling
- **React 19** for UI
- **TypeScript** for application code
- **Tailwind CSS v4** for styling
- **@base-ui/react** for accessible UI primitives
- **uPlot** for fast diagnostic charts
- **lucide-react** for iconography
- **Mediabunny** for browser-side demuxing on top of WebCodecs
- **fft.js** for spectral analysis
- **OffscreenCanvas** for frame processing

***

## How it works

1. Open a user-supplied local video file via Mediabunny.
2. Demux the video track and read frame timing.
3. Estimate effective frame rate; detect VFR.
4. Extract frame luminance in linear light (sRGB gamma expansion + Rec.709).
5. User isolates the time segment via interactive timeline.
6. Resample signal to uniform time base (binary search + linear interpolation).
7. Detrend + Hann window + FFT (fft.js).
8. Detect peaks (prominence-based, trimmed-median noise floor).
9. Compute derived metrics (modulation depth, flicker index, duty cycle, jitter, confidence).
10. Optionally run MP_proxy or therapy validation.
11. Present interactive summary and diagnostic plots.

All analysis runs client-side. No upload required.

***

## Community contributions

Contributions are welcome. Helpful areas include:

- browser compatibility improvements,
- performance optimization,
- better validation datasets,
- documentation and methodology clarification,
- UI/UX refinement,
- additional diagnostic visualizations,
- careful improvement of experimental metrics.

Please keep these principles in mind:

- Preserve conservative claims.
- Do not market experimental metrics as standards-equivalent.
- Prefer documented reasoning over magic constants.
- Make limitations clearer, not less visible.
- Include reproducible examples when changing analysis behavior.

***

## License

FlickerScope is licensed under the **Apache License 2.0**. Apache 2.0 is a permissive license with an explicit patent grant, suitable for technical, browser-based analysis tools that may be adopted in research, commercial, and educational environments.

***

## Final note

FlickerScope is most useful when treated honestly: a capable browser-based flicker screening and diagnostic tool, not a lab instrument. Used with good capture practice and conservative interpretation, it can be extremely helpful for field investigation, comparative testing, and education. Used as a substitute for calibrated standards-based instrumentation, it will be overextended beyond its design purpose.
