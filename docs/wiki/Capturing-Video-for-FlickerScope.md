Many modern phones — especially models from about 2020 onward — can record **240 fps slow-motion video** out of the box, even if the default camera app does not make that obvious. On Android, the easiest way to get reliable clips for FlickerScope is **Open Camera**, a free, open-source app available on **F-Droid** and the **Google Play Store**. It gives much better control over frame rate, resolution, codec, focus, and exposure than most stock camera apps.

## No computer required

FlickerScope runs entirely in your phone browser at **[https://snokamedia.github.io/flickerscope/](https://snokamedia.github.io/flickerscope/)**. Record a clip with your camera app, then open FlickerScope in your phone browser and load the video directly from your gallery — no uploads, no computer, no install needed.

## Recommended app: Open Camera

Open Camera is the best starting point for Android because it exposes the settings that matter for flicker capture instead of hiding them behind automatic modes.

### Quick setup

1. Install **Open Camera** from **F-Droid** or **Google Play**.
2. Open video settings and set the frame rate to **240 fps**, or enable **Force 240fps** if your phone supports it.
3. Set resolution to **720p or 1080p**. Lower resolution is often better for flicker work because it reduces processing and can make results cleaner.
4. Turn **image stabilization off**.
5. Set focus to **infinity** or use **manual focus**.
6. **Lock exposure** so brightness does not drift during recording.
7. Record a **8–15 second** clip. The extra length lets you trim off the first and last few seconds where pressing the button caused camera shake — use FlickerScope's timeline controls to select only the clean middle segment. A **tripod or phone stand** helps minimize shake.
8. Open **[FlickerScope](https://snokamedia.github.io/flickerscope/)** in your phone browser and load the video from your gallery.

### iPhone workflow

1. Use the stock **Camera** app in **Slo-mo** mode.
2. Record a **8–15 second** clip. The extra length lets you trim off the shaky start and end where you tapped the button — FlickerScope's timeline controls can isolate just the stable portion.
3. Open **[FlickerScope](https://snokamedia.github.io/flickerscope/)** in Safari or Chrome.
4. **Upload from Files, not Photos.** This is the most important step (see below).

If you prefer to transfer the file to a desktop instead, use local file sharing and choose **Keep Originals** so the clip is not altered during transfer.

### ⚠️ Important: iPhone Photos can silently downgrade your video

When you upload a video **directly from the Photos library** through a browser, iOS may serve a **reprocessed copy** instead of the original capture file. This is a well-known issue affecting many web apps:

- 60 fps or 240 fps videos uploaded from Photos can appear as **30 fps** on the receiving end.
- This happens because the Photos picker can serve an optimized or proxy version, especially when "Optimize iPhone Storage" is enabled in iCloud Photos settings.
- The browser receives the file, sees 30 fps in the container metadata, and both the website and you are left confused.

This issue has been reported extensively ([Apple Discussions](https://discussions.apple.com/thread/255786254), [another thread](https://discussions.apple.com/thread/8333061), [Hive article](https://www.hive.photo/@skatehype.com/iphone-trick-how-to-prevent-videos-from-dropping-from-60fps-to-30fps-when-uploading)).

#### Best workaround: upload from Files

1. In the **Photos** app, tap **Share** → **Save to Files**.
2. Open **FlickerScope** in your browser.
3. Tap **Choose file** or drop the video.
4. Navigate to the **Files** app picker (not Photos) and select the saved video.

This bypasses the Photos reprocessing pipeline and sends the original file to the browser. Multiple user reports confirm this preserves the correct frame rate metadata.

#### Additional tips

- **Disable "Optimize iPhone Storage"** in **Settings → Photos** so your device keeps full originals locally. This reduces the chance of proxy files being served.
- **Mac users:** use **Image Capture** to transfer the original unmodified video to your computer, then test from there. This is the most reliable desktop transfer method.
- Other apps and cloud services may also re-encode videos during transfer. When in doubt, use **Files → browser** or **Image Capture**.

#### Why FlickerScope may still work even with the wrong metadata

FlickerScope computes the actual frame rate from **decoded frame timestamps**, not just the container metadata. So even if the upload process mangles the container to show 30 fps, FlickerScope can often detect the true frame cadence (e.g., 59.94 or 240 fps) and still produce accurate analysis. The Metadata Panel shows both values when they differ, so you can verify.

## Phone compatibility

This usually works well on many **Samsung**, **Google Pixel**, **OnePlus**, and **Xiaomi** phones, though the exact options vary by model and camera API support. iPhones also support **240 fps slow-motion** in the stock Camera app on many models.

## Troubleshooting

### Why does my video not look slow-motion?

That is normal. Many phones save slow-motion clips with extra playback metadata, so the file may not always look obviously slow when opened in another app. What matters is the **actual capture rate**. If the phone recorded at 240 fps, FlickerScope can still analyze it even if playback looks normal-speed outside the camera app. iPhone slow-motion files in particular often behave this way when shared or exported.
