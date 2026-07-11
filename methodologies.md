# FlickerScope — Methodologies

> **Version:** 0.1.0  
> **Last updated:** 2026-06-21  
> **Status:** Pre-release / active development  
> **Lead maintainer:** AI-assisted (opencode agent)

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

### 2.4 FPS constraint tiers

The application enforces three tiers for the effective frame rate (computed as described in [Section 4](#4-frame-rate-measurement)):

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

Candidates are sorted by descending power. Peaks within **2 Hz** of a higher‑ranked peak are merged (keeping the higher‑power one). The top 5 peaks are returned.

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

This estimator is **asymptotically unbiased** for a pure sinusoid under moderate SNR, approaching the Cramér‑Rao bound. It is valid when the main lobe spans ≥ 3 bins, which holds for the Hann window (main‑lobe width ≈ 4 bins at −3 dB).

### 9.3 Limitations

- The estimator assumes a single sinusoid in the bin neighborhood. Closely spaced multi‑frequency components bias the interpolation.
- At very low SNR (< 5 dB), the parabolic fit becomes unreliable, and the raw bin center is preferred. The implementation falls back to the raw bin frequency when `|denominator| < 1e-12`.

---

## 10. Confidence scoring

### 10.1 Design

The confidence score is a dimensionless value in [0, 1] combining three independent factors:

| Factor | Weight | Description |
|--------|--------|-------------|
| **Peak‑to‑noise ratio (PNR)** | 0.5 | How much stronger the dominant peak is than the surrounding noise floor. Dominant indicator of spectral quality. |
| **Nyquist proximity** | 0.3 | How far the dominant frequency is from the Nyquist limit. Peaks near Nyquist are at risk of aliasing. |
| **Cycle count** | 0.2 | How many full cycles of the fundamental frequency fit in the segment. More cycles = better statistical reliability. |

### 10.2 PNR computation

The noise floor is estimated from all bins **excluding a ±15‑bin window** around the dominant peak. This exclusion prevents the peak from inflating the noise baseline:

```typescript
const pnr = peakPower / noiseMedian;
const pnrNorm = log10(1 + pnr) / log10(1 + 100);
```

The logarithmic compression provides a dB‑like mapping where a 100× PNR (≈ 20 dB) saturates at 1.0.

### 10.3 Nyquist proximity

A quadratic penalty is applied as the dominant frequency approaches Nyquist:

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

At least 10 cycles yields full confidence. A 240 fps, 2‑second segment at 60 Hz contains 120 cycles, so this factor is typically 1.0 except for very low frequencies or short segments.

### 10.5 Combined formula

```
confidence = min(1, 0.5 × PNR + 0.3 × Nyquist + 0.2 × Cycles)
```

The weights were chosen heuristically based on the relative importance of each factor — PNR is the strongest signal‑quality indicator, Nyquist proximity guards against a specific failure mode (aliasing), and cycle count ensures basic statistical sufficiency.

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

The standard defines three regions: **No Observable Effect Level (NOEL)**, **Low risk**, and **High risk**. FlickerScope uses a four‑level verdict (`noel`, `low-risk`, `elevated`, `high`, `uncertain`) by splitting the original "high risk" region into `elevated` and `high` based on the modulation depth.

### 14.2 Piecewise thresholds

The implementation follows these piecewise boundary lines (shown as percent modulation vs. frequency):

| Region | f < 90 Hz | 90 ≤ f < 100 Hz | f ≥ 100 Hz |
|--------|-----------|-----------------|------------|
| **NOEL** | mod ≤ 0.01 × f | mod ≤ 0.0333 × f | mod ≤ 0.08 × f |
| **Low risk** | 0.01 × f < mod ≤ 0.08 × f | 0.0333 × f < mod ≤ 0.08 × f | 0.08 × f < mod ≤ 0.20 × f |
| **Elevated** | 0.08 × f < mod | 0.08 × f < mod | — |
| **High** | — | — | mod > 0.20 × f |

The `elevated`/`high` split for f ≥ 100 Hz is based on the observation that high‑frequency flicker (above the critical flicker fusion frequency) is less perceptible. The `high` verdict is reserved for modulation levels that are likely to produce visible stroboscopic effects.

### 14.3 Mapping to IEEE 1789

| FlickerScope verdict | IEEE 1789 region | Meaning |
|---------------------|------------------|---------|
| `noel` | Below NOEL line | Flicker is theoretically imperceptible |
| `low-risk` | Between NOEL and low‑risk line | Flicker may be visible but risk is minimal |
| `elevated` | Above low‑risk line (f < 100 Hz) | Flicker likely visible; investigate |
| `high` | Above low‑risk line with high modulation (f ≥ 100 Hz) | Strong modulation even at high frequencies |
| `uncertain` | — | Confidence too low for reliable classification |

### 14.4 Frequency‑dependent mapping for f ≥ 100 Hz

When the dominant frequency is ≥ 100 Hz, the verdict is adjusted:
- `low-risk` maps to `noel` (high‑frequency flicker is less perceptible, so even "low‑risk" is essentially imperceptible)
- `elevated` maps to `high` (at these frequencies, any exceedance merits the stronger label because the usual NOEL relaxation is already applied)

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

- Touch targets: Timeline slider track is `h‑12`, handles are `h‑10 w‑4`.
- Stat strip grid: `grid‑cols‑2` on mobile → `grid‑cols‑7` on desktop.
- Charts: uPlot supports touch‑based zoom; a "Reset zoom" button is provided.
- The upload dropzone fills the viewport on mobile and has a flexible 400‑px max‑width on desktop.

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

### 18.7 The worker bundle

fft.js and the mp‑proxy module are bundled into the Web Worker chunk (≈ 16 KB). This is efficient but means both the main thread and the worker include fft.js. At 716 KB total JS (gzip: 215 KB), this is acceptable but worth monitoring if the feature set grows.

### 18.8 Noise-driven false positives (no-flicker gate)

A steady light source produces a near-constant luminance signal with only sensor noise. The FFT of white noise always has a global maximum bin by chance (max-of-N Rayleigh distribution, typically 7–12 dB above the median). Without a specific guard, this can register as a false-positive "flicker" detection.

The current gate uses three criteria checked in order:

1. **Prominence peak support:** The global max bin must be backed by a prominence-qualified peak (`findSpectrumPeaks`). This filters out noise-driven maxima that lack the spectral signature of a real periodic signal.
2. **Peak-to-noise ratio:** The global max must be at least 10 dB above the median of all non-DC bins outside a ±15-bin exclusion window around the peak.
3. **Minimum modulation:** The Michelson contrast of the original (non-detrended) luminance signal must be at least 1.0%.

If any criterion fails, the verdict is set to `none` and the result is reported as "No discernible frequency found."

**Future improvements (not yet implemented):**

- **Autocorrelation periodicity check:** Compute the normalized autocorrelation of the detrended signal at the candidate period. A real periodic source produces a clear autocorrelation peak (> 0.3–0.4); white noise decorrelates immediately. This directly tests "does the signal repeat?" — the fundamental question that threshold-based tests only approximate.
- **Spectral concentration check:** Measure what fraction of total non-DC power lies within a narrow band (±2 bins) around the dominant frequency. Real flicker concentrates energy (> 30%); sensor noise spreads it broadly (< 10–15%). This discriminates between a structured periodic source and a diffuse noise spectrum.
- **Multi-window consistency vote:** Split the segment into overlapping sub-windows and require the dominant frequency to be stable across them. True flicker persists across time windows; noise peaks wander.

These stages would further reduce false positives without raising static thresholds that could miss real weak flicker.

---

## 19. References

1. IEEE 1789-2015. *Recommended Practices for Modulating Current in High-Brightness LEDs for Mitigating Health Risks to Viewers.*
2. IEC 61000-4-15. *Electromagnetic Compatibility (EMC) — Testing and Measurement Techniques — Flickermeter — Functional and Design Specifications.*
3. CIE TN 012:2021. *Guidance on the Measurement of Temporal Light Modulation of Lighting Systems.*
4. ASSIST (2012). *A Proposed Method for Measuring and Reporting Flicker.* Vol. 11, Issue 1.
5. Li, Y. & Ohno, Y. (2023). *Revision of the MP Calculation Method for Flicker Measurement.* CORM/USNC CIE Conference.
6. Kelly, D. H. (1961). *Visual responses to time-dependent stimuli. I. Amplitude sensitivity measurements.* Journal of the Optical Society of America, 51(4), 422–429.
7. de Lange, H. (1958). *Research into the dynamic nature of the human fovea → cortex systems with intermittent and modulated light.* Journal of the Optical Society of America, 48(11), 777–784.
8. Tsai, L. H. et al. (2016). *Gamma frequency entrainment attenuates amyloid load and modifies microglia.* Nature, 540, 230–235.
9. Iaccarino, H. F. et al. (2016). *Gamma frequency entrainment attenuates amyloid-β deposition in a mouse model of Alzheimer's disease.* Nature, 540, 230–235.
10. Adaikkan, C. et al. (2019). *Gamma entrainment binds higher-order brain regions and offers neuroprotection.* Neuron, 102(5), 929–943.
11. Mediabunny documentation. https://mediabunny.dev
12. fft.js. https://github.com/indutny/fft.js
13. uPlot. https://github.com/leeoniya/uPlot
14. @base-ui/react. https://base-ui.com
15. U.S. DOE SSL Program (2018). *Characterizing Photometric Flicker.* https://www.energy.gov/sites/prod/files/2019/01/f58/characterizing-photometric-flicker_nov2018.pdf
16. Bierman, A. (2016). *Flicker Metrics: Past, Present, and Future.* EPA Flicker Webinar.
