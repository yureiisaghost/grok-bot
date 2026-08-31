import { createHmac } from "node:crypto"

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function generateTotp(secret: string, period = 30, digits = 6): string {
  const key = decodeBase32(secret)
  const counter = Math.floor(Date.now() / 1000 / period)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac("sha1", key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  const otp = binary % 10 ** digits
  return String(otp).padStart(digits, "0")
}

function decodeBase32(secret: string): Buffer {
  const cleaned = secret.toUpperCase().replace(/=+$/g, "").replace(/[\s-]/g, "")
  let bits = ""
  for (const ch of cleaned) {
    const val = ALPHABET.indexOf(ch)
    if (val < 0) throw new Error("TOTP secret is not valid base32 (A–Z and 2–7 only)")
    bits += val.toString(2).padStart(5, "0")
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}
