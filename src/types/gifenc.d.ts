declare module 'gifenc' {
  type Palette = number[][];
  interface Encoder { writeFrame(index: Uint8Array, w: number, h: number, opts?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean }): void; finish(): void; bytes(): Uint8Array }
  const gifenc: {
    GIFEncoder(): Encoder;
    quantize(rgba: Uint8Array | Uint8ClampedArray, max: number): Palette;
    applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette): Uint8Array;
  };
  export default gifenc;
}
