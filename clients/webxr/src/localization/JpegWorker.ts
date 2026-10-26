export type EncodeRequest = { id: number; frame: VideoFrame; quality: number };
export type EncodeResponse = { id: number; jpeg?: ArrayBuffer; width?: number; height?: number; error?: string };

const port = globalThis as unknown as {
  onmessage: (event: MessageEvent<EncodeRequest>) => void;
  postMessage: (message: EncodeResponse, transfer?: Transferable[]) => void;
};
let canvas: OffscreenCanvas | null = null;

port.onmessage = async ({ data: { id, frame, quality } }) => {
  try {
    const width = frame.displayWidth, height = frame.displayHeight;
    if (!canvas || canvas.width !== width || canvas.height !== height) canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas is required for JPEG encoding");
    context.drawImage(frame, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (blob.type !== "image/jpeg") throw new Error("Browser cannot encode JPEG images");
    const jpeg = await blob.arrayBuffer();
    port.postMessage({ id, jpeg, width, height }, [jpeg]);
  } catch (error) {
    port.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  } finally {
    frame.close();
  }
};
