declare module 'heic-convert' {
  interface ConvertOptions {
    buffer: ArrayBuffer | Uint8Array
    format: 'JPEG' | 'PNG'
    /** JPEG only, 0..1. */
    quality?: number
  }
  export default function convert(options: ConvertOptions): Promise<ArrayBuffer>
}
