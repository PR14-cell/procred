import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'crypto';
import path from 'path';

const endpoint = process.env.S3_ENDPOINT || 'http://localhost:9000';
const accessKeyId = process.env.S3_ACCESS_KEY || 'minioadmin';
const secretAccessKey = process.env.S3_SECRET_KEY || 'miniopassword123';

export const s3Client = new S3Client({
  endpoint,
  region: 'us-east-1',
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  forcePathStyle: true, // Required for MinIO
});

export const S3_BUCKETS = {
  CREDENTIALS: process.env.S3_BUCKET_CREDENTIALS || 'credentials',
  ENROLLMENTS: process.env.S3_BUCKET_ENROLLMENTS || 'enrollments',
  GENERAL: process.env.S3_BUCKET_GENERAL || 'general',
};

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];

/**
 * Ensure all required storage buckets exist in MinIO.
 */
export async function ensureBucketsExist(): Promise<void> {
  for (const bucketName of Object.values(S3_BUCKETS)) {
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    } catch {
      try {
        await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
      } catch (createErr) {
        console.warn(`Could not create bucket ${bucketName}:`, createErr);
      }
    }
  }
}

/**
 * Sanitize filename to prevent directory traversal and special character exploits.
 */
export function sanitizeFileName(originalName: string): string {
  // Strip path traversal attempts and directory separators
  const base = path.basename(originalName).trim();
  // Allow alphanumeric, underscores, hyphens, and periods
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return clean.length > 0 ? clean : 'document_file.pdf';
}

/**
 * Validate file content magic bytes against MIME type.
 */
export function validateFileMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) return false;

  if (mimeType === 'application/pdf') {
    // PDF starts with %PDF (0x25 0x50 0x44 0x46)
    return (
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46
    );
  }

  if (mimeType === 'image/jpeg') {
    // JPEG starts with 0xFF 0xD8 0xFF
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === 'image/png') {
    // PNG starts with 0x89 0x50 0x4E 0x47
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }

  return false;
}

/**
 * Validate file payload: size, MIME type, magic bytes, and filename.
 */
export function validateDocumentPayload(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): { isValid: boolean; error?: string } {
  if (!buffer || buffer.length === 0) {
    return { isValid: false, error: 'File buffer cannot be empty.' };
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return {
      isValid: false,
      error: `File size exceeds the 25MB limit (received ${(buffer.length / (1024 * 1024)).toFixed(2)}MB).`,
    };
  }

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return {
      isValid: false,
      error: `Disallowed file type "${mimeType}". Allowed types: PDF, JPEG, PNG.`,
    };
  }

  if (!validateFileMagicBytes(buffer, mimeType)) {
    return {
      isValid: false,
      error: 'File content does not match the claimed MIME type (magic byte check failed).',
    };
  }

  return { isValid: true };
}

/**
 * Generate safe, unpredictable S3 object key.
 */
export function generateStorageKey(entityType: string, entityId: string, fileName: string): string {
  const safeName = sanitizeFileName(fileName);
  const uuidPrefix = randomUUID();
  const cleanEntityType = entityType.replace(/[^a-zA-Z0-9_-]/g, '');
  const cleanEntityId = entityId.replace(/[^a-zA-Z0-9_-]/g, '');
  return `${cleanEntityType}/${cleanEntityId}/${uuidPrefix}-${safeName}`;
}

/**
 * Compute SHA-256 checksum of buffer.
 */
export function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Upload file buffer to S3/MinIO.
 */
export async function uploadToS3(params: {
  bucket: string;
  key: string;
  body: Buffer;
  mimeType: string;
}): Promise<void> {
  const { bucket, key, body, mimeType } = params;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
      ContentLength: body.length,
    })
  );
}

/**
 * Download file from S3/MinIO as a readable stream / buffer.
 */
export async function downloadFromS3(params: {
  bucket: string;
  key: string;
}) {
  const { bucket, key } = params;
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  return {
    body: response.Body,
    contentLength: response.ContentLength,
    contentType: response.ContentType || 'application/octet-stream',
  };
}

/**
 * Delete file from S3/MinIO.
 */
export async function deleteFromS3(params: { bucket: string; key: string }): Promise<void> {
  const { bucket, key } = params;
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
  } catch (err) {
    console.warn(`Failed to delete S3 object ${bucket}/${key}:`, err);
  }
}
