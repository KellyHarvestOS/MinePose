declare module "gifenc" {
  type Palette = number[][];
  type QuantizeOptions = { format?: "rgb565" | "rgb444" | "rgba4444"; oneBitAlpha?: boolean | number; clearAlpha?: boolean; clearAlphaThreshold?: number; clearAlphaColor?: number };
  type FrameOptions = { palette?: Palette; transparent?: boolean; transparentIndex?: number; delay?: number; repeat?: number; dispose?: number; first?: boolean };
  export function quantize(data: Uint8Array | Uint8ClampedArray, maxColors: number, options?: QuantizeOptions): Palette;
  export function applyPalette(data: Uint8Array | Uint8ClampedArray, palette: Palette, format?: "rgb565" | "rgb444" | "rgba4444"): Uint8Array;
  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): { writeFrame(data: Uint8Array, width: number, height: number, options?: FrameOptions): void; finish(): void; bytes(): Uint8Array; bytesView(): Uint8Array };
}
