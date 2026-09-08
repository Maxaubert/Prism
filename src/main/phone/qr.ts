import QRCode from 'qrcode'

/** The pairing link as an SVG string, sized by the dialog's CSS (#104). */
export function qrSvg(link: string): Promise<string> {
  return QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
}
