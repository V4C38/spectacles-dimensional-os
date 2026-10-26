import { expect, test } from "@playwright/test";

test("encodes frozen full-resolution video pixels in the real JPEG worker", async ({ page }) => {
  await page.routeWebSocket("**/ar", () => {});
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { BrowserJpegEncoder } = await import("/src/localization/BrowserJpegEncoder.ts");
    const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 960;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "red"; context.fillRect(0, 0, 1280, 960);
    const video = document.createElement("video"); video.muted = true; video.playsInline = true;
    const stream = canvas.captureStream(0); video.srcObject = stream; document.body.append(video);
    const encoder = new BrowserJpegEncoder();
    try {
      const frameReady = new Promise<void>(resolve => video.requestVideoFrameCallback(() => resolve()));
      const playing = video.play();
      (stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack).requestFrame();
      await playing; await frameReady;
      const started = performance.now();
      const pending = encoder.encode(video);
      context.fillStyle = "blue"; context.fillRect(0, 0, 1280, 960);
      const encoded = await pending;
      const elapsed = performance.now() - started;
      const bitmap = await createImageBitmap(new Blob([encoded.jpeg], { type: "image/jpeg" }));
      context.drawImage(bitmap, 0, 0); bitmap.close();
      return { width: encoded.width, height: encoded.height, elapsed, pixel: Array.from(context.getImageData(640, 480, 1, 1).data), bytes: encoded.jpeg.length };
    } finally {
      encoder.dispose(); stream.getTracks().forEach(track => track.stop()); video.remove();
    }
  });
  expect(result.width).toBe(1280); expect(result.height).toBe(960);
  expect(result.bytes).toBeGreaterThan(1000);
  expect(result.pixel[0]).toBeGreaterThan(240); expect(result.pixel[2]).toBeLessThan(20);
  expect(result.elapsed).toBeLessThan(1500);
});
