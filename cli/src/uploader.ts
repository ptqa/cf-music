/**
 * R2 upload client using S3-compatible API.
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { type Config } from './config';

export class R2Uploader {
  private client: S3Client;
  private bucketName: string;

  constructor(config: Config) {
    this.bucketName = config.r2.bucket_name;
    this.client = new S3Client({
      region: 'auto',
      endpoint: config.r2.endpoint,
      credentials: {
        accessKeyId: config.r2.access_key_id,
        secretAccessKey: config.r2.secret_access_key,
      },
    });
  }

  /**
   * Check if an object exists in R2 with a given size.
   * Returns true if it exists with matching size (skip upload).
   */
  async exists(key: string, expectedSize: number): Promise<boolean> {
    try {
      const result = await this.client.send(new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }));
      return result.ContentLength === expectedSize;
    } catch {
      return false;
    }
  }

  /**
   * Upload a file buffer to R2.
   */
  async upload(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
  }

  /**
   * Upload audio file, skipping if already exists with same size.
   * Returns true if uploaded, false if skipped.
   */
  async uploadAudio(key: string, body: Buffer | Uint8Array, contentType: string): Promise<boolean> {
    if (await this.exists(key, body.length)) {
      return false;
    }
    await this.upload(key, body, contentType);
    return true;
  }

  /**
   * Upload cover art image.
   */
  async uploadCoverArt(key: string, body: Buffer | Uint8Array, mimeType: string): Promise<void> {
    // Always overwrite cover art (it might have been updated)
    await this.upload(key, body, mimeType);
  }
}
