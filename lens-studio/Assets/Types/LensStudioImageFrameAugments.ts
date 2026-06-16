// Lens Studio's generated declarations document ImageFrame.timestampMillis
// on CameraModule.requestImage() results, but the ImageFrame type currently
// omits that property. Augment the global instance type so project code can
// use the wearable API without per-call casts.
declare global {
  interface ImageFrame {
    timestampMillis: number;
  }
}

export {};
