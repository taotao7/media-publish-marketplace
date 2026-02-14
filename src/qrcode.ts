import jsQR from "jsqr"
import { PNG } from "pngjs"
import QRCode from "qrcode"

/**
 * Decode a base64-encoded PNG QR code image, extract the embedded data,
 * and re-render it as a clean high-contrast PNG (base64).
 */
export async function qrcodeToCleanPng(base64Png: string): Promise<string> {
  const data = decodeQrData(base64Png)
  const pngBuffer = await QRCode.toBuffer(data, {
    type: "png",
    width: 400,
    margin: 2,
    color: { dark: "#000000", light: "#FFFFFF" },
  })
  return pngBuffer.toString("base64")
}

function decodeQrData(base64Png: string): string {
  const buffer = Buffer.from(base64Png, "base64")
  const png = PNG.sync.read(buffer)

  const code = jsQR(
    new Uint8ClampedArray(png.data),
    png.width,
    png.height,
  )

  if (!code) {
    throw new Error("Failed to decode QR code from image")
  }

  return code.data
}
