# FlickerScope — Methodologies

> **Version:** 0.3.2  
---

## Table of contents

1. [Project overview](#1-project-overview)
2. [Video decoding and metadata pipeline](#2-video-decoding-and-metadata-pipeline)
3. [Luminance extraction](#3-luminance-extraction)
4. [Frame rate measurement](#4-frame-rate-measurement)
5. [Timeline and segment selection](#5-timeline-and-segment-selection)
6. [Uniform resampling](#6-uniform-resampling)
7. [FFT pipeline](#7-fft-pipeline)
8. [Spectrum peak detection](#8-spectrum-peak-detection)
9. [Parabolic frequency interpolation](#9-parabolic-frequency-interpolation)
10. [Confidence scoring](#10-confidence-scoring)
11. [Modulation depth (Michelson contrast)](#11-modulation-depth-michelson-contrast)
12. [Flicker index (IEC/IES area-based)](#12-flicker-index-iecies-area-based)
13. [Timing metrics (duty cycle, jitter)](#13-timing-metrics-duty-cycle-jitter)
14. [IEEE 1789-2015 verdict](#14-ieee-1789-2015-verdict)
15. [40 Hz gamma therapy validation](#15-40-hz-gamma-therapy-validation)
16. [MP proxy (perceptual flicker metric)](#16-mp-proxy-perceptual-flicker-metric)
17. [Design decisions and UX rationale](#17-design-decisions-and-ux-rationale)
18. [Known limitations](#18-known-limitations)
19. [References](#19-references)

---

## 1. Project overview

FlickerScope is a **fully client-side browser application** that estimates dominant light flicker frequency and related metrics from user-supplied high-frame-rate video. It was designed to serve lighting engineers, electrical inspectors, and hobbyists who need a quick flicker screening tool without requiring dedicated photometric hardware.

### 1.1 Core design principles

| Principle | Rationale |
|-----------|-----------|
| **100 % client-side** | No video data ever leaves the browser. Privacy is a hard requirement — the app must work without any server. |
| **Explainable metrics** | Every computed value has a documented formula, reference to a known standard, or a clear rationale. The codebase carries inline comments sufficient for expert peer review. |
| **Conservative claims** | The app labels itself as a screening tool, not a standards-certified flicker meter. Results are qualified with confidence scores, notes, and explicit limitations. |
| **Video-first sampling** | Unlike photometric flicker meters that sample at 1–10 kHz with calibrated sensors, FlickerScope extracts luminance from video frames at typical slow-motion rates (120–240 fps). This fundamental constraint limits the measurable frequency band and absolute accuracy. |

### 1.2 Standards and references

FlickerScope references the following standards and publications where applicable:

- **IEEE 1789-2015** — *Recommended Practices for Modulating Current in High-Brightness LEDs for Mitigating Health Risks to Viewers*
- **IEC 61000-4-15** — *Electromagnetic compatibility (EMC) — Testing and measurement techniques — Flickermeter — Functional and design specifications*
- **IES LM-79** — *Electrical and Photometric Measurements of Solid-State Lighting Products*
- **CIE TN 012:2021** — *Guidance on the Measurement of Temporal Light Modulation of Lighting Systems*
- **ASSIST MP** — *A Proposed Method for Measuring and Reporting Flicker* (Vol. 11, Issue 1, 2012)
- **Li & Ohno (2023)** — *Revision of the MP Calculation Method for Flicker Measurement*
- **Kelly (1961)** — *Visual responses to time-dependent stimuli*
- **de Lange (1958)** — *Research into the dynamic nature of the human fovea*

> **Important:** FlickerScope is an approximation of these standards, not a certified implementation. Results should be treated as screening-level estimates.

---

## 2. Video decoding and metadata pipeline

### 2.1 Overview

File ingestion uses **Mediabunny** (`npm:mediabunny`), a browser-side media demuxing and decoding library built on WebCodecs. The pipeline is:

```
File (Blob) → Input(BlobSource) → Primary Video Track → Metadata + Sample Sink
```

### 2.2 Why Mediabunny

Mediabunny was chosen over raw WebCodecs for three reasons:

1. **Container demuxing** — WebCodecs operates on raw coded frames (`EncodedVideoChunk`), not container formats. Mediabunny handles MP4, WebM, and other container demuxing transparently.
2. **Cross-browser format negotiation** — The library abstracts format support queries (`ALL_FORMATS`, `canDecode`), reducing platform-specific code.
3. **Sample iteration** — `VideoSampleSink` provides an async iterator over decoded frames with optional time-range filtering, directly matching the spec's need to extract luminance from a selected segment.

### 2.3 Metadata extraction

```typescript
const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
const videoTrack = await input.getPrimaryVideoTrack();
const duration = await input.computeDuration();
const codec = await videoTrack.getCodec();
const width = await videoTrack.getDisplayWidth();
const height = await videoTrack.getDisplayHeight();
```

The `BlobSource` constructor accepts a `File` or `Blob`. The optional second parameter sets the `startOffset` and `size` for partial reads, though the current implementation reads the full file. For very large files, partial reads could be used to limit memory use, but the spec explicitly sets a soft limit based on memory.

**Codec support check:** The application checks whether the reported codec string (e.g., `'avc'`, `'hevc'`, `'vp9'`, `'av1'`) is in the set of known supported codecs. If not, a warning badge is shown but analysis is still attempted, since Mediabunny's runtime `canDecode` check may be more permissive than string matching.

**Decoded frame rate (`fpsDecoded`):** In addition to container-level packet statistics, the application decodes the first 180 frames and computes the median inter-frame interval from decoded sample timestamps (see §4.4). This `fpsDecoded` value is the primary frame rate used for the tier gate and the metadata panel, because some devices — particularly iPhones — repackage slow-motion footage with a container playback rate that differs from the actual capture rate (e.g., 240 fps footage showing as 30 fps in container metadata).

### 2.4 FPS constraint tiers

The application enforces three tiers for the effective frame rate (using `fpsDecoded`, falling back to `fpsAverage` if the decoded rate is unavailable):

| Tier | FPS range | Behavior |
|------|-----------|----------|
| **Adequate** | ≥ 240 | Full analysis enabled. Nyquist limit ≥ 120 Hz covers all mains harmonics. |
| **Limited** | 120–239 | Analysis enabled with a banner noting the reduced Nyquist limit. The MP proxy band is clipped. |
| **Insufficient** | < 120 | Analysis blocked. The user is shown a clear message that the frame rate is too low for reliable mains-frequency flicker measurement. |

The 120 Hz threshold follows from the Nyquist criterion: to detect 50/60 Hz reliably, the sampling rate must be at least 2× the highest frequency of interest. 120 fps gives a Nyquist limit of 60 Hz, which is the minimum viable threshold; 240 fps (Nyquist = 120 Hz) is considered adequate because it covers the 2nd harmonic of 60 Hz flicker.

---

## 3. Luminance extraction

### 3.1 Method

Each decoded video frame is drawn to an `OffscreenCanvas` at 64 × 36 pixels using `sample.draw(ctx, 0, 0, 64, 36)`. The `getImageData` method reads the downsampled pixel buffer. A spatially averaged luminance is computed as:

```typescript
Y = (1/N) × Σ(0.2126 × R_linear + 0.7152 × G_linear + 0.0722 × B_linear)
```

where `R_linear`, `G_linear`, `B_linear` are sRGB‑linearized channel values.

### 3.2 Why sRGB gamma expansion

The `getImageData()` method returns **8‑bit sRGB‑encoded** values, not linear‑light measurements. Applying the Rec. 709 luminance coefficients directly to gamma‑encoded data yields *luma* (Y′), not physical *luminance* (Y). For a flicker measurement system that claims to track physical light modulation, this distinction matters:

- **Modulation depth** — sRGB gamma compresses dark values and expands mid‑tones, biasing the measured contrast ratio. A physical 50% modulation can appear as 73% in gamma‑encoded space.
- **Flicker index** — The area‑based flicker index integrates light output over time. Using gamma‑encoded values distorts the area ratios.
- **Threshold crossings** — Duty‑cycle measurement depends on accurate threshold levels; gamma distortion shifts where transitions are detected.

The correction applies the sRGB standard transfer function (IEC 61966‑2‑1):

```
C_linear = C_srgb / 12.92                        if C_srgb ≤ 0.04045
C_linear = ((C_srgb + 0.055) / 1.055) ^ 2.4     otherwise
```

A **256‑entry lookup table** is precomputed at module load time, mapping each 8‑bit value to its linear‑light equivalent. This avoids per‑pixel exponentiation during the luminance extraction hot path.

### 3.3 Downsampling resolution: 64 × 36

The canvas is downsampled to 64 × 36 pixels (a 2.3 MP → 2.3 kP reduction). This aggressive downsampling is acceptable because:

1. **The application averages across the entire frame** — spatial detail is discarded by design.
2. **Anti‑aliasing during `drawImage`** provides a hardware‑accelerated average, which is preferable to a manual per‑pixel loop at full resolution.
3. **Performance** — at 240 fps, decoding and processing one second of video involves 240 frames × 2,304 pixels/frame ≈ 550 k pixel operations, which stays well within worker frame budgets.

---

## 4. Frame rate measurement

### 4.1 Average frame rate (packet statistics)

The primary method for measuring average frame rate uses Mediabunny's `computePacketStats()` API:

```typescript
const stats = await videoTrack.computePacketStats();
const fpsAverage = stats.averagePacketRate;
```

This examines **container‑level packet timestamps**, not decoded sample timestamps. Container timestamps are set by the recording device at mux time and reflect the intended frame cadence. This approach:

- Avoids timing jitter introduced by the decode pipeline (decode latency, frame reordering, dropped frames on slow devices).
- Provides a stable average even for VFR content.
- Is a single async call — no sample iteration required.

### 4.2 Variable frame rate (VFR) detection

A separate function decodes the first 180 frames and computes the coefficient of variation (CV) of inter‑frame intervals:

```
CV = σ(dt) / μ(dt)
```

Where `dt_i = timestamp_i - timestamp_{i-1}` for all positive intervals. The **0.02 CV threshold** is a heuristic:

| CV range | Classification | Typical cause |
|----------|---------------|---------------|
| < 0.001 | Constant frame rate (CFR) | Professional cameras, fixed‑rate recording |
| 0.001 – 0.005 | Near‑CFR | Most phone slow‑motion modes |
| 0.005 – 0.02 | Mild VFR | 3:2 pulldown, edit gaps, variable‑rate encoders |
| > 0.02 | VFR | Dropped frames, hybrid phone modes, screen recordings |

The 180‑frame sample (≈ 0.75 s at 240 fps) is sufficient for classification because VFR cadence patterns in phone videos typically repeat over short windows. The sample uses the **first** 180 frames, which may miss cadence changes later in longer clips — a documented limitation.

### 4.3 Design evolution

The original implementation decoded 30 samples and computed `1 / mean(dt)`. This was changed after the Perplexity review identified three issues:

1. **Sample iteration is expensive** — 30 samples was too few for robust statistics, and increasing the count (to 100–300) would have made metadata loading slow.
2. **Container timestamps are more reliable** for average‑rate measurement.
3. **Mean is sensitive to outliers** — a single dropped frame shifts the estimate; median or trimmed statistics are preferred.

### 4.4 Decoded frame rate (`fpsDecoded`)

The `detectVariableFrameRate()` function was extended to also return a decoded frame rate, computed from the same 180 decoded samples:

```typescript
dts.sort((a, b) => a - b);
const medianDt = dts.length % 2 !== 0
  ? dts[mid]
  : (dts[mid - 1] + dts[mid]) / 2;
const fpsDecoded = 1 / medianDt;
```

This solves a real-world problem: **iOS slow-motion footage**. When an iPhone records 240 fps slow-motion video, the container metadata often reports a playback rate of 30 fps (the default playback speed for slow-motion clips). The container-level `fpsAverage` from `computePacketStats()` reads this 30 fps value, which would cause FlickerScope's tier gate to reject the video as insufficient. By measuring the actual decoded frame timestamps — which reflect the true capture cadence — `fpsDecoded` correctly reports 240 fps.

The `fpsDecoded` value is stored in `VideoMetadata` and used as the primary frame rate for the tier gate, the metadata panel display, and the progress bar estimate during sample extraction. When both `fpsDecoded` and `fpsAverage` are available and differ by more than 5 fps, the metadata panel shows both values with an explanatory note.

The worker's `computeEffectiveSampleRate()` (see §7) independently computes the sample rate from the segment timestamps for FFT use. If the user trims to a segment, the per-segment rate may differ slightly from the clip-wide `fpsDecoded`.

---

## 5. Timeline and segment selection

### 5.1 Range selection

The user selects an analysis segment using a dual‑handle slider spanning the video duration. The slider is implemented as a custom React component (`TimelineSlider.tsx`) using pointer events for drag‑handle interaction rather than a native `<input type="range">`, because:

- Native range inputs do not support dual‑handle selection.
- Pointer events give precise control over handle hit‑testing and z‑ordering.
- Touch targets are enlarged (h‑12, handles at h‑10 w‑4) for mobile usability.

### 5.2 Segment constraints

| Constraint | Value | Rationale |
|------------|-------|-----------|
| Minimum duration | 0.5 s | Ensures enough cycles for analysis at 50/60 Hz (≥ 25 cycles). The FFT frequency resolution Δf = 1 / T gives 2 Hz resolution at 0.5 s, which is marginal but acceptable for harmonic identification. |
| Maximum duration | None (soft limit) | The original spec suggested 5 s. Practically, longer segments increase processing time linearly. A 3‑s segment at 240 fps processes 720 frames, which completes in < 2 s on modern hardware. |

### 5.3 Segment → analysis flow

1. User adjusts handles → `[startTime, endTime]` in seconds.
2. `extractLuminanceSamples` is called with these bounds, using Mediabunny's `VideoSampleSink.samples(startTime, endTime)`.
3. The sink's time filter is applied at the container level, not by discarding samples after decode, which saves decode work.
4. The extracted `LuminanceSample[]` array and the original `VideoMetadata` are forwarded to the analysis worker.

---

## 6. Uniform resampling

### 6.1 Why resampling is necessary

The FFT algorithm assumes **uniformly spaced samples** in the time domain. Video frame timestamps — even from "constant" frame rate sources — exhibit small‑scale jitter from:

- Container muxing granularity (presentation timestamps are typically quantized to 1/90000 s or 1/1000 s).
- Variable decode latency that propagates to sample emission order in the software pipeline.
- True VFR content where frames are intentionally captured at irregular intervals.

Resampling the raw `(t_i, Y_i)` samples onto a uniform grid eliminates this jitter as a source of spectral noise.

### 6.2 Algorithm

The input is an irregularly‑sampled sequence `(t_i, Y_i)` and a target rate `fs` (Hz). The output is `N` uniformly‑spaced samples `x[n]` where:

```
t_0 = input timestamps[0]
t_{N-1} = input timestamps[last]
Δt = 1 / fs
N = floor((t_{N-1} - t_0) × fs) + 1
```

For each output sample `n`:

```
t_target = t_0 + n × Δt
```

A **binary search** finds the bracketing input pair `(t_j, t_{j+1})` where `t_j ≤ t_target < t_{j+1}`. The output value is a **linear interpolation**:

```
frac = (t_target - t_j) / (t_{j+1} - t_j)
x[n] = Y_j + (Y_{j+1} - Y_j) × frac
```

Edge cases (target before first or after last timestamp) clamp to the boundary value.

### 6.3 Off‑by‑one correction

The original implementation used `N = Math.round(span × rate)` for the output length. This can truncate the last sample by up to 0.5 × Δt, meaning the final grid point falls before the actual end time. The corrected formula `N = Math.floor(span × rate) + 1` guarantees an endpoint‑inclusive grid:

| Formula | N | Last sample at | Correct? |
|---------|---|----------------|----------|
| `round(1.0 × 100)` = 100 | 100 | 0.99 s | Loses last 0.01 s |
| `floor(1.0 × 100) + 1` = 101 | 101 | 1.00 s | Includes endpoint |

### 6.4 Why linear interpolation

Linear interpolation was chosen over cubic, spline, or nearest‑neighbor methods because:

| Method | Advantage for this use case |
|--------|---------------------------|
| **Linear** | No overshoot, no ringing, no edge oscillation. Fast (one multiply‑add per sample). Property: preserves monotonicity. |
| Cubic / spline | Can overshoot sharp transitions, creating artificial peaks. Slower. |
| Nearest neighbor | Introduces quantization artifacts (stair‑step) in the luminance signal, adding high‑frequency noise to the spectrum. |

The trade‑off is mild low‑pass filtering: linear interpolation attenuates frequencies above ≈ 0.45 × fs (near Nyquist). For the target band of 3–80 Hz sampled at 240 Hz (Nyquist = 120 Hz), this attenuation is negligible.

---

## 7. FFT pipeline

### 7.1 Processing chain

The full signal‑processing chain applied before the FFT is:

```
Raw samples → Uniform resampling → Detrend (linear, index‑based) → Hann window → Zero‑pad to next power of 2 → FFT
```

Each stage is justified below.

### 7.2 Detrending

A linear trend is fitted to the resampled signal and subtracted. The trend captures slow brightness drifts from:

- Auto‑exposure adjustments by the phone camera.
- Scene illumination changes (e.g., a cloud passing, head movement).
- Sensor thermal drift.

The fit uses ordinary least squares on the **sample index** (not time), which is valid because the signal has already been resampled to a uniform grid:

```
slope = (N × Σ(i × y_i) − Σi × Σy_i) / (N × Σ(i²) − (Σi)²)
intercept = (Σy_i − slope × Σi) / N
y_detrended[i] = y_i − (slope × i + intercept)
```

### 7.3 Hann window

The Hann (raised‑cosine) window is applied before the FFT to reduce **spectral leakage** — the smearing of energy from a frequency bin into adjacent bins caused by the implicit rectangular window of finite‑length sampling.

```
w[n] = 0.5 × (1 − cos(2π × n / (N−1)))
y_windowed[n] = y_detrended[n] × w[n]
```

**Why Hann over other windows:**

| Window | Main‑lobe width | Sidelobe roll‑off | Best for |
|--------|----------------|-------------------|----------|
| Hann (von Hann) | 4 bins | −18 dB/octave | General‑purpose; good leakage suppression |
| Hamming | 4 bins | −6 dB/octave | Near‑bin frequency resolution |
| Blackman | 6 bins | −24 dB/octave | Strongest leakage suppression; wider lobes |
| Tukey | Variable | Moderate | When preserving amplitude at edges |

Hann was chosen as the best balance between main‑lobe width (frequency resolution) and sidelobe roll‑off (leakage suppression). The revised MP metric (Section 16) also specifies Hann windowing for consistency with Li & Ohno (2023).

### 7.4 Zero‑padding

The windowed signal is zero‑padded to the next power of 2 length for FFT efficiency. For example, 600 samples → 1024‑point FFT.

**What zero‑padding does:**
- Increases the number of frequency bins (interpolates the spectrum).
- Does **not** increase frequency resolution (which remains Δf = fs / N_original).
- Improves visual peak location in the spectrum display.

### 7.5 FFT implementation

The application uses **fft.js** (`npm:fft.js`), a pure‑JavaScript FFT library chosen for:

- No native dependencies (works in any Web Worker).
- Supports arbitrary power‑of‑2 lengths.
- Provides `realTransform()` followed by `completeSpectrum()` for efficient real‑valued input processing.

The FFT output is an interleaved complex array `[re_0, im_0, re_1, im_1, ...]`. For each positive‑frequency bin `k` (from 1 to N/2 − 1):

```
power_k = re_k² + im_k²
freq_k = k × fs / N
```

**Power normalization:** The values are unnormalized (depend on FFT size and window choice). For relative comparisons within a single segment, this is acceptable. Cross‑segment comparability would require PSD normalization:

```
PSD_k = |X_k|² / (fs × Σ(w²))
```

This is noted but not implemented in v0.1.0.

### 7.6 Sub‑5 Hz rejection

Bins with frequency < 5 Hz are excluded from peak detection and MP analysis. The rationale:

- Electric light flicker from mains‑powered sources operates at ≥ 50 Hz (Europe) or ≥ 60 Hz (North America), or their harmonics.
- LED PWM drivers typically operate at ≥ 1 kHz; any visible flicker is from the mains‑frequency envelope, not sub‑5 Hz modulation.
- Sub‑5 Hz modulation in consumer video is almost always from scene motion, exposure drift, or camera instability — not the light source.

The 5 Hz cutoff is a domain‑specific heuristic. For non‑electric light sources (e.g., natural fire, mechanical shutters), this cutoff would need adjustment.

---

## 8. Spectrum peak detection

### 8.1 Goals

Reliable peak detection in a flicker spectrum must handle:

- **Multiple harmonics** — A square‑wave PWM signal has odd harmonics (3×, 5×, 7×) that can be stronger than the fundamental.
- **Spectral leakage sidelobes** — Even with Hann windowing, nearby bins show elevated power around strong peaks.
- **Noise floor variations** — Camera sensor noise, compression artifacts, and scene motion contribute a non‑uniform noise floor.

### 8.2 Algorithm

The peak detection algorithm has four stages:

#### Stage 1: Noise floor estimation (trimmed median)

The noise floor is estimated as the median of the **lower 50% of sorted power values**. Using all bins (including strong peaks) inflates the noise estimate, causing weak but real peaks to be rejected. The trimmed median avoids this bias.

```typescript
const sorted = [...powers].sort((a, b) => a - b);
const lowerHalf = sorted.slice(0, Math.floor(sorted.length / 2));
const noiseFloor = lowerHalf[lowerHalf.length >> 1];
```

#### Stage 2: Local maxima above threshold

A candidate is any bin where `power > power[left]` and `power ≥ power[right]` (a strict local maximum) **and** `power ≥ noiseFloor × 3`. The 3× threshold is a heuristic that works well for typical SNR ranges in phone‑captured flicker videos (SNR ≈ 10–30 dB at the dominant frequency).

#### Stage 3: Prominence computation

For each candidate, the algorithm finds the minimum power within a fixed‑radius window (~5 Hz on each side, minimum 3 bins) on both sides:

```typescript
const prominenceRadius = Math.max(3, Math.round(5 / binWidth));
```

The prominence is the candidate's power minus the **higher** of the two valley minima:

```
prominence = peakPower − max(valleyLeft, valleyRight)
```

Using `max` of the two valleys (instead of `min`) prevents overcounting peaks on a sloping spectrum floor — a peak must rise above both adjacent valleys to qualify.

A peak is retained if `prominence > noiseFloor × 1.5`.

#### Stage 4: Dedup and sort

Candidates are sorted by descending power. Peaks within **2.5 Hz** (bin‑derived radius: `ceil(2.5 / binWidth)`, minimum 1 bin) of a higher‑ranked peak are merged, keeping the higher‑power one. The 2.5 Hz threshold covers the typical main‑lobe spread of a Hann window at real-world flicker signals without collapsing genuinely distinct nearby components. Using a Hz‑derived bin radius (rather than a fixed bin count) ensures consistent behavior across varying FFT sizes and bin widths.

#### Stage 5: Post-merge parabolic interpolation

After merging, each surviving peak is interpolated to sub-bin precision using the parabolic fit described in [§9](#9-parabolic-frequency-interpolation). Interpolation is deliberately deferred until after the merge step: merging based on raw bin‑center frequencies ensures stable, deterministic deduplication unaffected by minor sub-bin shifts that parabolic interpolation could introduce.

Each merged peak's `normalizedMagnitude` is computed relative to the **strongest prominence peak** (not the global maximum bin), ensuring the ambiguity check (`topPeaks[1].power / topPeaks[0].power > 0.7`) matches the UI display. Using the global max bin would include non-prominent DC leakage or sidelobe energy that could inflate or shrink displayed ratios.

The top **5 peaks** by power are returned.

### 8.3 Why fixed‑radius prominence

The original implementation used a prominence window of 2% of the spectrum length. This was identified as a problem during the Perplexity review because:

- **At low frequencies** (e.g., 5 Hz), 2% of a 512‑bin spectrum ≈ 10 bins, corresponding to ≈ 4.7 Hz — too narrow to reach the true valley floor for a 5 Hz peak.
- **At high frequencies** (e.g., 80 Hz), 2% is the same 10 bins, corresponding to ≈ 4.7 Hz — wider than needed.

Switching to a **fixed‑Hz radius** (~5 Hz) makes the algorithm scale automatically with bin density, which varies with segment duration and FFT size.

---

## 9. Parabolic frequency interpolation

### 9.1 Motivation

The raw FFT bin spacing Δf = fs / N ≈ 240 Hz / 600 ≈ 0.4 Hz. For therapy validation — where the pass criterion is 39.5–40.5 Hz ± 0.1 Hz — this bin spacing is insufficient. The peak could be 0.2 Hz away from the correct frequency simply due to bin quantization.

### 9.2 Method

Parabolic interpolation fits a parabola to the power values of the peak bin and its two immediate neighbors `(k−1, k, k+1)`:

```
Δ = 0.5 × (P_{k−1} − P_{k+1}) / (P_{k−1} − 2P_k + P_{k+1})
f_interpolated = (k + Δ) × fs / N
```

The delta is clamped to **±0.5 bins** to prevent extrapolation beyond the adjacent bins, which could produce wildly incorrect frequencies when the parabolic fit is poor.

This estimator is **asymptotically unbiased** for a pure sinusoid under moderate SNR, approaching the Cramér‑Rao bound. It is valid when the main lobe spans ≥ 3 bins, which holds for the Hann window (main‑lobe width ≈ 4 bins at −3 dB).

### 9.3 Where interpolation is applied

Interpolation is used in two places:

1. **Global dominant frequency:** The global maximum bin is interpolated directly for the `dominantHz` value reported as the primary result.
2. **Prominence peaks:** After the merge step in `findSpectrumPeaks()`, each surviving prominence peak is interpolated. This deferred interpolation (post-merge) ensures peak deduplication uses stable bin‑center frequencies, unaffected by sub-bin shifts.

### 9.4 Limitations

- The estimator assumes a single sinusoid in the bin neighborhood. Closely spaced multi‑frequency components bias the interpolation.
- At very low SNR (< 5 dB), the parabolic fit becomes unreliable, and the raw bin center is preferred. The implementation falls back to the raw bin frequency when `|denominator| < 1e-12`.

---

## 10. Confidence scoring

### 10.1 Design

The confidence score is a dimensionless value in [0, 1] combining five independent factors that capture different aspects of signal quality:

| Factor | Weight | Description |
|--------|--------|-------------|
| **Local peak‑to‑noise ratio (PNR)** | 0.35 | How much stronger the dominant peak is than the noise in a guarded local annulus around the peak. Strongest single indicator of spectral quality. |
| **Nyquist proximity** | 0.20 | Quadratic penalty as the dominant frequency approaches the Nyquist limit. Peaks near Nyquist are at risk of aliasing. |
| **Cycle count** | 0.15 | How many full cycles of the fundamental fit in the segment. More cycles = better statistical reliability. |
| **Spectral concentration** | 0.15 | Energy ratio of the main lobe (±~1 Hz) to a local band (±~5 Hz). Real electrical flicker produces sharp peaks (high ratio); motion-induced pseudo-flicker produces broader peaks (low ratio). |
| **Welch frequency stability** | 0.15 | Multi-window consistency of the dominant frequency across overlapping sub-segments. Real flicker is frequency-stable; camera shake or transient disturbances produce drift. |

The weights were chosen to give PNR the largest influence while distributing significant weight to the three orthogonal discriminators (PNR alone cannot distinguish a sharp noise peak from a real signal).

### 10.2 PNR computation (local guarded annulus)

The noise floor is estimated from a **local ring** around the dominant peak, not the full spectrum:

- A **guard band** of ±3 Hz excludes the main lobe and leakage margin.
- Noise is sampled from a **ring ±10 Hz to ±30 Hz** away from the peak.

This prevents clean high-frequency bins from artificially lowering the noise floor in scenarios where the spectrum is dominated by a strong low-frequency line:

```typescript
const pnr = peakPower / noiseMedian;
const pnrNorm = log10(1 + pnr) / log10(1 + 100);
```

**Absolute PNR veto:** If `pnr < 10` (linear, equivalent to ~10 dB), the confidence is set to 0. A ratio below 10 dB indicates the peak is indistinguishable from noise-driven random fluctuations (the max-of-N Rayleigh distribution for white noise typically produces a 7–12 dB apparent peak). This veto gates the entire confidence computation.

The logarithmic compression maps a 100× PNR (≈ 20 dB) to approximately 0.83, with diminishing returns beyond that.

### 10.3 Nyquist proximity

```
nyquistConfidence = max(0, 1 − (f_dominant / f_Nyquist)²)
```

| f_dominant / f_Nyquist | nyquistConfidence |
|------------------------|-------------------|
| 0.2 | 0.96 |
| 0.5 | 0.75 |
| 0.8 | 0.36 |
| 1.0 | 0.00 |

### 10.4 Cycle count

```
numCycles = segmentDuration × f_dominant
cycleConfidence = min(1, numCycles / 10)
```

At least 10 full cycles yields full confidence. A 240 fps, 2-second segment at 60 Hz contains 120 cycles, so this factor is typically 1.0 except for very low frequencies or short segments.

### 10.5 Spectral concentration

Spectral concentration measures the **sharpness** of the dominant peak — how much of the local spectral energy is concentrated in the main lobe versus spread across a wider band:

```
innerPower = Σ(powers[peakIdx − ci] … powers[peakIdx + ci])     // ci ≈ ±1 Hz
outerPower = Σ(powers[peakIdx − co] … powers[peakIdx + co])     // co ≈ ±5 Hz
concentration = innerPower / outerPower
concNorm = clamp((concentration − 0.3) / 0.65, 0, 1)
```

- **High concentration** (→ 1.0): Energy is sharply focused at the peak, characteristic of electrical flicker from mains-driven or PWM light sources.
- **Low concentration** (→ 0.0): Energy is spread across many bins, characteristic of broad-spectrum motion artifacts or noise.

The normalization maps a typical 0.3 ratio to ~0 and a near-1.0 ratio to ~1. This factor is orthogonal to PNR because it depends only on peak shape, not absolute power level.

### 10.6 Welch frequency stability

The Welch stability factor uses multiple overlapping sub-window FFTs to measure **frequency consistency** across the segment (see §18.10 for the full algorithm description).

For the confidence formula, it enters as a pre-computed score `welchStability ∈ [0, 1]`. The score is a weighted combination of sub-window agreement and frequency dispersion (see §18.10 for the full description). The following table shows illustrative anchor values:

| Score | Meaning |
|-------|---------|
| ~1.0 | All sub-windows agree with the dominant frequency — high confidence that the detection is a stable, real signal. |
| 0.5 | Default when segmentation is insufficient (< 2 valid sub-windows) — neutral, no penalty. |
| ~0.0 | Sub-windows disagree strongly — likely a transient or unstable artifact. |

In practice, the score is a continuous value whose granularity depends on the number of sub-windows (typically 3–20 for common segment lengths).

### 10.7 Combined formula

```
confidence = min(1, 0.35 × PNR + 0.20 × Nyquist + 0.15 × Cycles + 0.15 × Concentration + 0.15 × Welch)
```

The five-factor composite provides robustness against three specific failure modes that the original three-factor system could miss:

1. **Broad noise peaks with high PNR** — spectral concentration penalizes them.
2. **Transient or camera-shake pseudo-flicker** — Welch stability flags frequency drift across sub-windows.
3. **Low-SNR peaks with many cycles** — the absolute PNR veto (10 dB) prevents false positives from noise-driven maxima even when cycle count and Nyquist proximity look good.

---

## 11. Modulation depth (Michelson contrast)

### 11.1 Definition

Modulation depth (also called percent flicker or Michelson contrast) is:

```
M% = (L_max − L_min) / (L_max + L_min) × 100
```

Where `L_max` and `L_min` are the maximum and minimum luminance values in the analyzed segment.

### 11.2 Rationale

This metric is specified in:

- **IEEE 1789-2015** — Uses percent flicker as the primary axis on the risk‑region chart.
- **CIE TN 012:2021** — Defines percent flicker as the standard metric for characterizing temporal light modulation amplitude.
- **IES LM-79** — References percent flicker for reporting LED product modulation.

The metric is dimensionless, normalized to the DC level (mean luminance ≈ (L_max + L_min)/2 for symmetric waveforms), and direct to interpret: a 100% modulation means the light fully extinguishes each cycle; 0% means no modulation.

### 11.3 Computed on raw (non‑resampled) signal

Modulation depth is computed on the **raw luminance samples**, not the resampled signal. This avoids the low‑pass filtering effect of interpolation, which would reduce L_max and raise L_min, underestimating the true peak‑to‑peak amplitude.

---

## 12. Flicker index (IEC/IES area-based)

### 12.1 Definition

The IEC/IES flicker index is the ratio of the area above the mean light level to the total area under the waveform:

```
flickerIndex = Area(above mean) / Total area under waveform
```

or equivalently:

```
flickerIndex = ∫ max(0, Y(t) − Ȳ) dt / ∫ Y(t) dt
```

### 12.2 Why this definition

The flicker index captures the **shape** of the waveform, not just its extreme values. A narrow, bright pulse (low duty cycle, high peak) and a sinusoidal waveform with the same percent flicker can have very different flicker indices. This provides additional information about the visual impact — waveforms with the same energy above the mean can look different.

### 12.3 Implementation: trapezoidal integration

Both integrals use **trapezoidal integration** over the original timestamps (not the resampled grid):

```
For each interval [t_i, t_{i+1}]
  Δt = t_{i+1} − t_i
  aboveArea += trapezoidAboveMean(i, i+1) × Δt
  totalArea += (Y_i + Y_{i+1})/2 × Δt
```

For intervals that cross the mean, the crossing fraction is linearly interpolated and the triangular area above the mean is computed analytically:

```
// Downward crossing
frac = (Y_i − Ȳ) / (Y_i − Y_{i+1})   // fraction to mean
aboveArea += 0.5 × (Y_i − Ȳ) × frac × Δt
```

This avoids the sample‑discretization bias that would arise from round‑to‑nearest‑sample approaches.

### 12.4 Range

The flicker index ranges from 0 (no modulation) to values approaching 1 (extremely narrow pulse). A pure sine wave at 50% modulation has a flicker index of approximately 0.32.

---

## 13. Timing metrics (duty cycle, jitter)

### 13.1 Threshold‑based cycle detection

The timing analysis identifies individual ON/OFF cycles in the luminance waveform using a **hysteresis thresholding** approach:

1. **Signal range:** Compute `Y_min` and `Y_max` from the raw luminance.
2. **Hysteresis thresholds:**
   - ON threshold: `Y_min + 0.6 × (Y_max − Y_min)`
   - OFF threshold: `Y_min + 0.4 × (Y_max − Y_min)`
3. **3‑point moving average smoother** applied to reduce single‑sample noise that could cause threshold chatter.
4. **State machine:** Starts in ON or OFF based on the first sample's position relative to the ON threshold. When the signal crosses a threshold, the exact crossing time is **linearly interpolated** between the adjacent samples for sub‑frame precision.

### 13.2 Why 60%/40% hysteresis

The 20% hysteresis band prevents rapid ON/OFF toggling from noise at the threshold boundary. The 60/40 split (asymmetric around the midpoint) is a standard choice from lighting analysis tools. It assumes the waveform is approximately symmetric; for severely asymmetric waveforms, the duty cycle measurement becomes a function of the chosen thresholds rather than the true waveform shape.

### 13.3 Duty cycle

```
dutyCycle = mean(ON durations) / (mean(ON) + mean(OFF)) × 100
```

ON periods are measured from an upward ON‑crossing to the next downward OFF‑crossing. OFF periods are measured from a downward OFF‑crossing to the next upward ON‑crossing.

### 13.4 Jitter (same‑direction crossings)

**Critical decision:** Jitter is computed on **full‑cycle periods from consecutive ON→ON up‑crossings**, not from the pooled distribution of ON and OFF durations.

```
cyclePeriods = [t_up_2 − t_up_1, t_up_3 − t_up_2, ...]
rmsJitter = σ(cyclePeriods) = √(Σ(p_i − p̄)² / n)
```

**Why this matters:** If duty cycle ≠ 50%, the ON and OFF distributions have different means. Pooling them (`allPeriods = [...onPeriods, ...offPeriods]` as implemented in an earlier version) inflates the variance — and thus the jitter estimate — purely from the mean difference, not from actual cycle‑to‑cycle timing variation:

| Duty cycle | True timing variation | Pooled‑period std dev | Same‑direction std dev |
|-----------|----------------------|----------------------|------------------------|
| 50% | 0.5 ms | 0.5 ms | 0.5 ms |
| 25% | 0.5 ms | **4.1 ms** (inflated) | 0.5 ms |

The same‑direction approach correctly reports 0.5 ms regardless of duty cycle.

### 13.5 Interpolated crossing times

Instead of using the sample timestamp at the crossing index (which introduces up to ±½‑sample quantization error), the exact crossing time is interpolated:

```typescript
frac = −yPrev / (yCurr − yPrev)   // where yPrev, yCurr are (sample − threshold)
crossTime = timestamps[i−1] + frac × (timestamps[i] − timestamps[i−1])
```

At 240 fps, this improves timing precision from ±2.1 ms (sample quantization) to sub‑millisecond.

---

## 14. IEEE 1789-2015 verdict

### 14.1 Standard reference

IEEE 1789‑2015 defines risk regions for flicker based on two parameters:

- **Percent flicker** (modulation depth) — the `x`‑axis of the risk chart.
- **Frequency** — the `y`‑axis.

The standard defines three regions: **No Observable Effect Level (NOEL)**, **Low risk**, and **High risk**. FlickerScope uses a five‑level verdict (`none`, `noel`, `low-risk`, `elevated`, `high`, `uncertain`). The `none` verdict indicates no discernible flicker was found (see §18.8). The `high` verdict at f ≥ 100 Hz is an **app-defined tier** based on 0.20 × f threshold, not part of the IEEE 1789 standard — the standard does not define a "high" region above 100 Hz beyond its single "low risk" boundary.

### 14.2 Piecewise thresholds

The implementation follows these piecewise boundary lines (shown as percent modulation vs. frequency):

| Region | f < 90 Hz | 90 ≤ f < 100 Hz | f ≥ 100 Hz |
|--------|-----------|-----------------|------------|
| **NOEL** | mod ≤ 0.01 × f | mod ≤ 0.0333 × f | mod ≤ 0.0333 × f |
| **Low risk** | 0.01 × f < mod ≤ 0.08 × f | 0.0333 × f < mod ≤ 0.08 × f | 0.0333 × f < mod ≤ 0.08 × f |
| **Elevated** | 0.08 × f < mod | 0.08 × f < mod | — |
| **High** | — | — | mod > 0.20 × f (app-defined) |

Key properties of this implementation:

1. **NOEL at f ≥ 100 Hz:** The NOEL threshold for f ≥ 100 Hz is set to `0.0333 × f`, matching the 90–100 Hz transition band. An earlier version omitted a NOEL threshold for f ≥ 100 Hz entirely, causing modulation levels like 12% at 120 Hz to be incorrectly classified as `noel` when they exceed the ASSIST-recommended low-risk guideline.
2. **Three tiers at f ≥ 100 Hz:** Even at high frequencies, the system distinguishes NOEL (≤ 0.0333 × f), low-risk (0.0333 × f to 0.08 × f), and high (> 0.20 × f) — rather than collapsing to a single threshold. The `high` tier at 0.20 × f is an app-defined screening threshold beyond the IEEE 1789 low-risk boundary.
3. **No automatic remapping:** Earlier versions remapped `low-risk` → `noel` and `elevated` → `high` for f ≥ 100 Hz. This was removed because it could silently downgrade genuine low-risk detections and obscure the actual modulation level.

### 14.3 Mapping to IEEE 1789 and app-defined labels

| FlickerScope verdict | IEEE 1789 region / meaning |
|---------------------|----------------------------|
| `none` | No discernible frequency found (no‑flicker gate triggered, see §18.8) |
| `noel` | Below NOEL line — flicker is theoretically imperceptible |
| `low-risk` | Between NOEL and low‑risk line — flicker may be visible but risk is minimal |
| `elevated` | Above low‑risk line (f < 100 Hz) — flicker likely visible; investigate |
| `high` | Above 0.20 × f (≥ 100 Hz, app-defined) — strong modulation at high frequencies |
| `uncertain` | Confidence too low for reliable classification |

---

## 15. 40 Hz gamma therapy validation

### 15.1 Scientific basis

A growing body of research (Tsai et al., 2016; Iaccarino et al., 2016; Adaikkan et al., 2019) demonstrates that **40 Hz gamma‑frequency light flicker** can entrain neural oscillations in the brain, potentially reducing amyloid‑beta pathology and improving cognitive function in Alzheimer's disease models.

The protocol requires:
- **Frequency:** 40 Hz ± 0.5 Hz (ideally 39.5–40.5 Hz)
- **Modulation depth:** High (> 80% Michelson contrast)
- **Duty cycle:** ≈ 50% (square‑wave modulation)
- **Duration:** Sustained exposure (minutes to hours, though the segment analysis only validates source quality)

### 15.2 Validation rubric

The therapy validation module (`lib/therapy.ts`) evaluates the analyzed segment against a 6‑criterion rubric:

| # | Criterion | Target | Weight |
|---|-----------|--------|--------|
| 1 | **Frequency accuracy** | 40 ± 0.5 Hz (interpolated) | 30 |
| 2 | **Duty cycle** | 45–55% (near‑square) | 20 |
| 3 | **Modulation depth** | > 80% Michelson contrast | 15 |
| 4 | **20 Hz suppression** | 20 Hz < 10% of 40 Hz power | 15 |
| 5 | **Jitter** | < 1 ms RMS cycle‑to‑cycle | 10 |
| 6 | **Signal confidence** | > 0.7 | 10 |

**Non‑scored checks** (red flags only, no point contribution):

| Check | Purpose |
|-------|---------|
| **120 Hz harmonic presence** | Confirms square‑wave (not sine) modulation. Skipped when Nyquist ≤ 125 Hz (see 15.4). |
| **80 Hz even harmonic suppression** | Strong 80 Hz indicates duty‑cycle asymmetry beyond the ±5% window. |

Each criterion receives a pass / warning / fail verdict. The **composite score** (0–100) maps to:

| Score | Verdict |
|-------|---------|
| ≥ 90 | `strong-pass` |
| 70–89 | `pass` |
| 50–69 | `warning` |
| < 50 | `fail` |
| N/A | `indeterminate` |

### 15.3 Why 20 Hz subharmonic is a red flag

A 20 Hz component in the spectrum — half the target 40 Hz — is a **primary red flag** because:

- If the light source is producing 20 Hz modulation (from a mis‑configured LED driver or 50 Hz mains half‑wave rectification), it indicates the source is not producing clean 40 Hz flicker.
- The therapeutic protocol specifically calls for 40 Hz, not its subharmonic.
- Even a weak 20 Hz component suggests the waveform periodicity is not purely 40 Hz.

The criterion passes if the power at 20 Hz (within ±0.5 Hz) is < 30% of the power at 40 Hz.

### 15.4 Why 120 Hz is expected (and when it cannot be checked)

A 40 Hz square wave with 50% duty cycle has odd harmonics: 120 Hz (3rd), 200 Hz (5th), etc. The 120 Hz component is useful for validation because it confirms square‑wave (not sinusoidal) modulation. The ratio of 120 Hz to 40 Hz power also relates to the duty cycle and edge sharpness.

**However, at the recommended 240 fps capture rate, the 120 Hz harmonic check is not reliable:**

| Capture rate | Nyquist limit | 120 Hz resolvable? |
|-------------|---------------|-------------------|
| **120 fps** | 60 Hz | No — above Nyquist entirely |
| **240 fps** | 120 Hz | **Borderline** — at exactly Nyquist, 120 Hz aliases to DC and cannot be reliably distinguished |
| **480 fps** | 240 Hz | Yes — well within measurable band |
| **960 fps** | 480 Hz | Yes — 3rd and 5th harmonics resolvable |

At 240 fps, a 120 Hz signal falls precisely at the Nyquist frequency (`fs / 2`). At Nyquist, the signal is indistinguishable from DC — its measured magnitude depends on the signal's phase relative to the sampling lattice and is essentially random. **The 120 Hz check is therefore skipped when the effective sample rate ≤ 250 Hz.**

The topPeaks array may still report a bin near 120 Hz, but the therapy validator will not produce a red flag for a missing 120 Hz peak unless the capture rate supports it. Instead, a note is added: *"120 Hz harmonic check skipped — capture at ≥ 480 fps to verify odd-harmonic structure."*

The **80 Hz (2nd harmonic) suppression check** is unaffected — 80 Hz is well below the Nyquist limit at 240 fps and can be reliably measured. A strong 80 Hz peak remains a valid indicator of duty-cycle asymmetry.

This criterion is lower‑weighted than frequency accuracy or subharmonic suppression because some valid 40 Hz sources (e.g., sine‑wave modulated LEDs) will not show the 120 Hz harmonic even with adequate sampling.

---

## 16. MP proxy (perceptual flicker metric)

### 16.1 Conceptual origin

The **MP (Métrique de Papillon / Flicker Perception Metric)** was developed by the ASSIST program to provide a single‑number score for direct flicker visibility, where:

- **MP = 1** corresponds to the 50% detection threshold for typical observers.
- **MP < 1** means flicker is below the threshold of visibility for most people.
- **MP > 1** means flicker is likely visible.

The original MP specification (ASSIST, 2012) is sensitive to waveform duration and starting phase — two labs measuring the same light source could report MP values differing by > 2×. Li & Ohno (2023) proposed a **Hann‑windowed revision** that dramatically reduces this measurement variability.

### 16.2 FlickerScope's MP proxy

The `MP_proxy` implementation mirrors the revised MP structure while accepting the constraints of video‑based sampling:

| MP component | Revised MP (lab) | MP_proxy (FlickerScope) |
|-------------|-------------------|------------------------|
| **Sampling rate** | ≥ 1 kHz (photodiode) | ~240 Hz (video frames) |
| **Normalization** | Divide by DC level | Same |
| **Detrending** | High‑pass filter | Linear regression on index |
| **Window** | Hann | Same |
| **Freq. range** | 0.3–500 Hz+ | 3–80 Hz (limited by Nyquist) |
| **Amplitude correction** | C_H ≈ 1.225 | Same |
| **Perceptual weighting** | MDT table (threshold detection curve) | Same, from literature |
| **Summation** | SRSS over frequency bins | Same |
| **Calibration** | 30% modulation at 54 Hz → MP = 1 | Same (target; pending calibration) |

### 16.3 MDT table

The Minimum Detectable Modulation Depth (MDT) table encodes the human temporal contrast sensitivity function. The values approximate the shape of the Kelly (1961) / de Lange (1958) data, scaled so that a 30% sinusoidal modulation at 54 Hz yields MP = 1:

| Frequency (Hz) | MDT (modulation fraction) |
|---------------|--------------------------|
| 3 | 0.019 |
| 5 | 0.010 |
| 10 | 0.004 |
| 15 | 0.003 |
| 20 | 0.004 |
| 30 | 0.012 |
| 40 | 0.031 |
| 50 | 0.086 |
| **54** | **0.184 (reference)** |
| 60 | 0.245 |
| 70 | 0.460 |
| 80 | 0.613 |

**Important caveat:** These values are directionally correct but have not been empirically calibrated against reference waveforms. The table should be fitted using a synthetic test set — generate waveforms at known MP values, run them through the video pipeline, and adjust the MDT scale factor to minimize MP error.

### 16.4 Pipeline

```
Raw samples → buildNormalizedSignal (power‑of‑2 resampling, DC‑normalize)
→ Detrend → Hann window → FFT → M_k = |X_k| / (N/2) × C_H
→ For each bin k with f_k ∈ [3, 80] Hz:
    MP_k = M_k / MDT(f_k)
→ MP_raw = √(Σ MP_k²)
→ MP_proxy = max(0, a × MP_raw + b)
```

Where `a = 1.0` and `b = 0.0` are placeholders; `a` and `b` should be fitted against reference data.

### 16.5 Interpretation guidelines

| MP_proxy range | Description |
|----------------|-------------|
| < 0.3 | Very low — unlikely perceptible |
| 0.3 – 1.0 | Below typical detection threshold |
| 1.0 – 3.0 | Likely visible — above 50% detection threshold |
| ≥ 3.0 | Strong — likely obvious to most observers |

### 16.6 Why a proxy

The MP_proxy is explicitly labeled as a **video‑based approximation** because:

- **Sampling rate:** MP assumes ≥ 1 kHz optical sampling; FlickerScope uses ~240 Hz frame‑rate sampling, which limits the measurable bandwidth and introduces interpolation artifacts.
- **Camera pipeline:** Phone cameras apply rolling shutter, temporal filtering, and compression that modify the waveform in ways a photodiode does not.
- **Luminance vs. illuminance:** The app measures scene luminance (camera sensor response), not the illuminating light source's output directly.
- **No temporal calibration:** The camera's temporal response (exposure time, AGC, sensor persistence) is unknown and uncalibrated.

---

## 17. Design decisions and UX rationale

### 17.1 Technology choices

| Technology | Version | Rationale |
|-----------|---------|-----------|
| **React** | 19 | Component‑based UI; ecosystem maturity; concurrent rendering for smooth progress updates during analysis. |
| **Vite** | 6 | Fast HMR during development; native ES‑module bundling for Web Workers; Tailwind CSS v4 integration via plugin. |
| **TypeScript** | ~5.7 | Static typing catches numeric precision errors, null‑safety issues, and interface mismatches across the main‑thread/Worker boundary. |
| **Tailwind CSS** | 4 | Utility‑first CSS for rapid prototyping; the `@theme` directive maps directly to the measurement‑instrument palette. |
| **@base‑ui/react** | 1.0.0‑rc.0 | Unstyled, accessible React primitives. Used for Tooltip (stat explanations), Popover (detailed metric definitions), Slider (timeline range), Tabs (analysis/therapy views), Accordion (measurement details). |
| **uPlot** | ~1.6 | Minimal‑footprint charting library. Chosen over Chart.js (larger bundle, heavier abstraction) and ECharts (too large) for its small size (~40 KB) and direct canvas API. |
| **lucide‑react** | ~0.400 | Lightweight icon library with tree‑shakable imports. |
| **fft.js** | ~4.6 | Pure‑JS FFT with no native dependencies and zero‑allocation API compatible with Web Workers. |
| **Mediabunny** | latest | As described in [Section 2](#2-video-decoding-and-metadata-pipeline). |

### 17.2 Visual design

The UI follows a **measurement‑instrument aesthetic**:

| Element | Specification |
|---------|---------------|
| **Background** | `#0b1020` (very dark blue‑gray) |
| **Panels** | `#121a2f` (dark surface) |
| **Accent** | `#69e2ff` (cyan; all interactive elements, plotted lines, dominant frequency highlight) |
| **Secondary accent** | `#9b8cff` (violet; therapy pass, spectrum peaks) |
| **Safe / pass** | `#22c55e` (green) |
| **Warning** | `#eab308` (amber) |
| **Danger** | `#ef4444` (red) |
| **Body text** | `#e2e8f0` (light gray) |
| **Muted text** | `#94a3b8` |
| **Dim text** | `#64748b` |
| **Borders** | `#1e293b` |
| **Typography** | System font stack for body; monospaced (`tabular-nums`) for all numeric values |

Deviations from typical light/dark mode:
- Battery‑friendly (minimal bright areas on OLED screens).
- High contrast between data (accent‑colored) and background (dark) reduces visual noise.
- Color‑coding conventions follow traffic‑light semantics universal in diagnostic tools.

### 17.3 Mobile considerations

- App shell: `w-full max-w-6xl` with `px-3 sm:px-4 lg:px-6`, collapsing naturally on small screens.
- Touch targets: Timeline slider track is `h‑12`, handles are `h‑10 w‑4`.
- Stat strip grid: `grid‑cols‑2` on mobile → `grid‑cols‑7` on desktop.
- Charts: uPlot supports touch‑based zoom; a "Reset zoom" button is provided.
- The upload dropzone fills the viewport on mobile.

---

## 18. Known limitations

### 18.1 Sampling rate ceiling

The hard ceiling for our analysis is the video frame rate. At 240 fps:
- Nyquist frequency = 120 Hz — adequate for mains fundamental (50/60 Hz) and second harmonic (100/120 Hz).
- Third harmonic (150/180 Hz) is above Nyquist and will alias.
- High‑frequency LED PWM (1–10 kHz) cannot be measured at all.

### 18.2 Camera pipeline distortion

The camera's image processing pipeline introduces several sources of error that cannot be fully corrected:

| Artifact | Effect |
|----------|--------|
| **Rolling shutter** | Different rows of the frame are exposed at different times. For fast PWM, this creates spatial bands rather than temporal modulation. The downsampled average luminance then reflects the spatial mix of ON and OFF rows rather than the true temporal waveform. |
| **Automatic gain control (AGC)** | The camera adjusts sensitivity frame‑by‑frame, introducing slow luminance drift unrelated to the light source. Detrending removes linear components but not non‑linear AGC responses. |
| **Auto‑exposure** | Same as AGC but affects the shutter time. A changing shutter time changes the integration window, modifying the captured modulation depth. |
| **Compression** | H.264/HEVC compression attenuates high‑frequency spatial detail and can introduce temporal artifacts (e.g., I‑frame vs. P‑frame quality differences). |

### 18.3 No temporal calibration

Unlike a dedicated flicker meter with a calibrated photodiode, FlickerScope has no knowledge of:
- The camera's exposure time per frame.
- The camera's temporal impulse response (sensor persistence, anti‑blooming circuits).
- The accuracy of the camera's frame‑timing clock.

### 18.4 MP proxy calibration

The MDT table (Section 16.3) has not been empirically calibrated. The `a` and `b` coefficients in the MP_proxy calibration formula are set to 1.0 and 0.0 — effectively passing the raw score through without adjustment. Proper calibration would require:

1. Generating synthetic sinewave flicker at several frequencies (10, 30, 54, 80 Hz) and modulation depths (1%, 3%, 10%, 30%, 100%).
2. Computing "true" MP values for these waveforms using a reference implementation.
3. Downsampling the waveforms through the video pipeline (including simulated rolling shutter and quantization).
4. Fitting `a` and `b` to minimize the error between reference MP and MP_proxy.

### 18.5 Therapy validation scope

The 40 Hz therapy validation rubric is based on published research criteria for neuroscience applications. It does **not** imply that a device or video source is medically certified or suitable for therapeutic use. The module is explicitly labeled as a screening tool for validating light sources used in research settings.

### 18.6 Frame rate detection

The VFR detection scans only the first 180 frames. For videos with time‑segment cadence changes (e.g., hybrid phone modes that switch frame rate mid‑clip), this initial sample may misclassify the content. A more robust approach would resample the VFR check across multiple windows or process the entire clip.

**iOS Photos reprocessing:** The `fpsDecoded` feature (§4.4) addresses the case where iPhone slow-motion container metadata reports 30 fps while the actual capture rate is 240 fps. However, if the user uploads directly from the **Photos library** (rather than from the Files app), iOS may serve a genuinely reprocessed video with different frame timing — not just different metadata. The capture guide now directs iOS users to save to Files first (see §18.12).

### 18.7 The worker bundle

fft.js and the mp‑proxy module are bundled into the Web Worker chunk (≈ 16 KB). This is efficient but means both the main thread and the worker include fft.js. At 716 KB total JS (gzip: 215 KB), this is acceptable but worth monitoring if the feature set grows.

### 18.8 Noise-driven false positives (no-flicker gate)

A steady light source produces a near-constant luminance signal with only sensor noise. The FFT of white noise always has a global maximum bin by chance (max-of-N Rayleigh distribution, typically 7–12 dB above the median). Without a specific guard, this can register as a false-positive "flicker" detection.

The current gate uses three criteria checked in order:

1. **Prominence peak support:** The global max bin must align with a prominence-qualified peak (`findSpectrumPeaks`) within 1.5 Hz. This is the primary discriminator: a noise-driven global maximum rarely has the spectral profile (local rise above both adjacent valleys) of a true periodic signal. Random noise may produce an elevated bin, but the binned energy is spread across neighbors without the sharp peak-and-valley structure of a real signal.
2. **Peak-to-noise ratio:** The global max must be at least 10 dB (10× linear) above the median of the local noise annulus (±10–30 Hz ring). This guards against false positives from residual low-frequency energy that passes the prominence check (e.g., slow camera exposure drift).
3. **Minimum modulation:** The Michelson contrast of the original (non-detrended) luminance signal must be at least 1.0%. This catches the rare case where both a prominence peak and high PNR exist but the actual luminance variation is trivially small — essentially a high-SNR measurement of a meaningless signal.

If any criterion fails, the verdict is set to `none` and the result is reported as "No discernible frequency found." This gate acts before the IEEE 1789 verdict: if `none`, the risk-level verdict is never displayed.

### 18.9 Low-frequency artifact gate (camera shake)

Handheld camera shake can produce quasi-periodic luminance oscillations in the 5–10 Hz range. Because the motion is real (not noise), it passes all spectral filters: PNR may be high, the peak is sharp, and Welch frequency stability confirms consistency across sub-windows. The resulting detection looks spectrally identical to genuine low-frequency electrical flicker.

The gate uses the perceptual MP proxy as an orthogonal discriminator:

- **Frequency:** dominant frequency < 15 Hz (below typical mains frequencies, into shake territory).
- **MP_proxy score:** < 0.3 (below typical detection threshold with MDT temporal contrast sensitivity weighting).
- **Modulation depth:** < 3% (low amplitude, unlikely to be meaningful electrical flicker).
- **Harmonic safeguard:** If any strong harmonic peak (> 10% of fundamental power) exists, the source has electrical waveform structure and passes through regardless of MP_proxy score.

When all conditions are met, the verdict is set to `uncertain` with a note explaining the ambiguity. The gate does **not** suppress detections with significant harmonic content, maintaining sensitivity to genuine non-sinusoidal low-frequency sources.

**Design rationale.** This is not a universal flicker-absence detector; it is a targeted veto for a specific verified failure mode: weak, quasi-sinusoidal low-frequency modulation from handheld video. The MP proxy was chosen because it is already computed and independently validated (see §16), and MDT weighting inherently penalizes frequencies where the visual system is less sensitive. The gate is deliberately narrow (< 15 Hz, < 3%, < 0.3) to avoid false suppression of real flicker.

### 18.10 Welch frequency stability (multi-window consistency)

The Welch frequency stability check is designed to distinguish **stable, real flicker** from **transient, drift-prone artifacts** using a multi-window FFT approach:

```
signal → split into overlapping sub-windows (50% overlap, ~1/3 of segment length)
       → detrend + Hann-window each sub-window
       → FFT each sub-window → find dominant frequency in each
       → score = agreement × 0.6 + dispersion × 0.4
```

**Sub-window parameters:**
- Length: `min(max(64, floor(n / 3)), 512)` samples — roughly one-third of the segment, capped at 512 for performance.
- Hop: 50% overlap (`winLen / 2`).
- Minimum: 2 valid sub-windows required; below that, score defaults to 0.5 (neutral).

**Two-component scoring:**

1. **Agreement** — fraction of sub-windows whose dominant frequency falls within ±2 Hz of the global dominant frequency.
   - High agreement: the same frequency appears consistently across the segment.
   - Low agreement: the frequency drifts, indicating camera shake or transient disturbance.

2. **Dispersion** — coefficient of variation (CV) of sub-window frequencies, transformed to a score:
   ```
   dispersionScore = max(0, 1 − min(1, CV × 3))
   ```
   - Low CV (tight clustering): high score.
   - High CV (frequencies spread across many bins): low score.

The combined score `agreement × 0.6 + dispersion × 0.4` is fed into the five-factor confidence formula (§10) as a continuous value in [0, 1].

**Why not Welch's method for PSD:** This is not Welch's averaged periodogram (which reduces variance at the cost of frequency resolution). Instead, it is a **frequency-consistency check** that uses the same sub-windowing concept but keeps per-window spectra independent and measures agreement of the peak location, not averaged power.

### 18.11 Spectral concentration

Spectral concentration measures the **sharpness** of the dominant peak, providing an orthogonal discriminator to PNR. While PNR measures the peak's height above noise, concentration measures the peak's width:

| Peak type | Typical concentration | Mechanism |
|-----------|---------------------|-----------|
| **Sharp electrical flicker** | > 0.8 | Energy concentrated in 2–3 bins; high ratio. |
| **Broad motion artifact** | 0.3–0.6 | Energy spread across 5+ bins; moderate ratio. |
| **White noise bump** | < 0.3 | No true peak structure; low ratio. |

The concentration ratio is computed as:
```
innerPower = Σ(powers[peak ± ci])     // ci ≈ ±1 Hz (main lobe)
outerPower = Σ(powers[peak ± co])     // co ≈ ±5 Hz (local band)
concentration = innerPower / outerPower
concNorm = clamp((concentration − 0.3) / 0.65, 0, 1)
```

The normalization empirically maps a typical noise floor ratio of ~0.3 to 0 and a tight flicker peak ratio of ~0.95 to 1.0. Unlike PNR, this factor is unaffected by the absolute power level — two signals with identical PNR but different spectral widths will score differently.

### 18.12 Decoded frame rate on iOS (fpsDecoded)

The `fpsDecoded` feature (§4.4) solves a real-world failure mode specific to **iPhone slow-motion footage**, but this workaround has its own limitations:

1. **Only works when decoded timestamps are available.** If Mediabunny's `VideoSampleSink` cannot decode frames (e.g., unsupported codec, encrypted stream), the fallback `fpsAverage` is used — which is the container-level 30 fps value that triggered the false rejection in the first place.

2. **iOS Photos app reprocessing remains an issue.** When a user uploads directly from the Photos library via the browser file picker, iOS may serve a reprocessed copy of the video rather than the original capture file. This reprocessed copy can have genuinely different frame timing — not just metadata — because iOS re-encodes the video. The `fpsDecoded` check reads the decoded timestamps of this reprocessed copy, which may not match the original capture.

   **Mitigation:** The app's capture guide now recommends iPhone users save the video to the **Files** app and upload from there, bypassing the Photos reprocessing pipeline. Additionally, disabling "Optimize iPhone Storage" in iCloud Photos settings reduces the chance of proxy files being served.

3. **Limited sample window.** The fpsDecoded rate is computed from the first 180 frames only. For unusual videos that have segment-dependent frame rates (e.g., hybrid phone modes that switch cameras mid-recording), this initial sample may not reflect the full clip.

---

## 19. References

1. [IEEE 1789-2015. *IEEE Recommended Practices for Modulating Current in High-Brightness LEDs for Mitigating Health Risks to Viewers.*](https://ieeexplore.ieee.org/document/7118618)
2. [IEC 61000-4-15. *Electromagnetic compatibility (EMC) - Part 4: Testing and measurement techniques - Section 15: Flickermeter - Functional and design specifications.*](https://webstore.iec.ch/en/publication/18749)
3. [CIE TN 012:2021. *Guidance on the Measurement of Temporal Light Modulation of Light Sources and Lighting Systems.*](https://backend.orbit.dtu.dk/ws/files/239586420/CIE_TN_012_2021.pdf)
4. [ASSIST. (2012). *A Proposed Method for Measuring and Reporting Flicker.* Vol. 11, Issue 1.](https://www.lisungroup.com/wp-content/uploads/2019/12/AR-FlickerMetric-Standard-Free-Download.pdf)
5. [Li, J., Ohno, Y., \& Bierman, A. (2025). *Revision of MP calculation method for flicker measurement.* Lighting Research \& Technology.](https://journals.sagepub.com/doi/full/10.1177/14771535261435634)
6. [Kelly, D. H. (1961). *Visual responses to time-dependent stimuli. I. Amplitude sensitivity measurements.* Journal of the Optical Society of America, 51(4), 422-429.](https://opg.optica.org/josa/abstract.cfm?uri=josa-51-4-422)
7. [de Lange, H. (1958). *Research into the dynamic nature of the human fovea-cortex systems with intermittent and modulated light. I. Attenuation characteristics with white and colored light.* Journal of the Optical Society of America, 48(11), 777-784.](https://pubmed.ncbi.nlm.nih.gov/13588450/)
8. [Iaccarino, H. F., Singer, A. C., Martorell, A. J., Rudenko, A., Gao, F., Gillingham, T. Z., Mathys, H., Seo, J., Kritskiy, O., Abdurrob, F., Adaikkan, C., Canter, R. G., Rueda, R., Brown, E. N., Boyden, E. S., \& Tsai, L.-H. (2016). *Gamma frequency entrainment attenuates amyloid load and modifies microglia.* Nature, 540, 230-235.](https://www.nature.com/articles/nature20587)
9. [Adaikkan, C., Middleton, S. J., Marco, A., Pao, P.-C., Mathys, H., Kim, D. N.-W., Gao, F., Young, J. Z., Suk, H.-J., Boyden, E. S., McHugh, T. J., \& Tsai, L.-H. (2019). *Gamma Entrainment Binds Higher-Order Brain Regions and Offers Neuroprotection.* Neuron, 102(5), 929-943.e8.](https://dspace.mit.edu/handle/1721.1/138165)
10. Mediabunny documentation. https://mediabunny.dev
11. fft.js. https://github.com/indutny/fft.js
12. uPlot. https://github.com/leeoniya/uPlot
13. @base-ui/react. https://base-ui.com
14. U.S. DOE SSL Program (2018). *Characterizing Photometric Flicker.* https://www.energy.gov/sites/prod/files/2019/01/f58/characterizing-photometric-flicker_nov2018.pdf
15. Bierman, A. (2016). *Flicker Metrics: Past, Present, and Future.* EPA Flicker Webinar.
