import { createHash, createHmac, randomUUID } from "node:crypto"

export interface SignedHeadersInput {
  readonly clientId: string
  readonly clientSecret: string
  readonly contentType: string
  readonly bodyTextForMd5?: string
  readonly accessToken?: string
  readonly nonce?: string
  readonly timestamp?: number
}

export function md5Hex(value: string): string {
  return createHash("md5").update(value, "utf8").digest("hex")
}

export function buildSignedHeaders(
  input: SignedHeadersInput,
): Record<string, string> {
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1_000))
  const nonce = input.nonce ?? randomUUID()
  const contentMd5 = md5Hex(input.bodyTextForMd5 ?? "")
  const signedHeaderMap: Record<string, string> = {
    "x-bili-accesskeyid": input.clientId,
    "x-bili-content-md5": contentMd5,
    "x-bili-signature-method": "HMAC-SHA256",
    "x-bili-signature-nonce": nonce,
    "x-bili-signature-version": "2.0",
    "x-bili-timestamp": timestamp,
  }

  const signText = Object.keys(signedHeaderMap)
    .sort()
    .map((key) => `${key}:${signedHeaderMap[key]}`)
    .join("\n")
  const authorization = createHmac("sha256", input.clientSecret)
    .update(signText, "utf8")
    .digest("hex")

  return {
    Accept: "application/json",
    "Content-Type": input.contentType,
    ...signedHeaderMap,
    ...(input.accessToken ? { "access-token": input.accessToken } : {}),
    Authorization: authorization,
  }
}
