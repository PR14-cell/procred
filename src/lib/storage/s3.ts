import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';

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
