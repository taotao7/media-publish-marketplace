import { readFileSync } from "node:fs"
import { basename, extname } from "node:path"

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
}

function getEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Missing environment variable: ${name}`)
  return val
}

async function createR2Client() {
  const { S3Client } = await import("@aws-sdk/client-s3")
  const accountId = getEnv("R2_ACCOUNT_ID")
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: getEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: getEnv("R2_SECRET_ACCESS_KEY"),
    },
  })
}

export async function uploadToR2(filePath: string): Promise<string> {
  const bucket = getEnv("R2_BUCKET_NAME")
  const publicUrl = getEnv("R2_PUBLIC_URL") // e.g. https://img.example.com

  const ext = extname(filePath).toLowerCase()
  const contentType = MIME_MAP[ext] ?? "application/octet-stream"

  // Generate a unique key: timestamp-originalname
  const key = `${Date.now()}-${basename(filePath)}`

  const body = readFileSync(filePath)

  const { PutObjectCommand } = await import("@aws-sdk/client-s3")
  const client = await createR2Client()
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )

  const base = publicUrl.replace(/\/+$/, "")
  const urlPrefix = /^https?:\/\//.test(base) ? base : `https://${base}`
  return `${urlPrefix}/${key}`
}
