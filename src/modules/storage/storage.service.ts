import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import {
  ALLOWED_MIME_TYPES,
  StorageFolder,
  UploadedFileResult,
} from './storage.constants';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client!: S3Client;
  private bucket!: string;
  private publicUrlBase!: string;
  private enabled = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    if (this.configService.get<string>('nodeEnv') === 'test') {
      this.logger.log('S3 storage disabled in test environment');
      return;
    }

    const bucket = this.configService.get<string>('s3.bucket');
    const region = this.configService.get<string>('s3.region');
    const accessKeyId = this.configService.get<string>('s3.accessKeyId');
    const secretAccessKey = this.configService.get<string>('s3.secretAccessKey');

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      this.logger.warn('S3 storage is not fully configured – uploads will fail');
      return;
    }

    this.bucket = bucket;
    this.publicUrlBase =
      this.configService.get<string>('s3.publicUrlBase') ??
      `https://${bucket}.s3.${region}.amazonaws.com`;

    const endpoint = this.configService.get<string>('s3.endpoint');
    const forcePathStyle =
      this.configService.get<boolean>('s3.forcePathStyle') ?? false;

    this.client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle,
    });

    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.enabled = true;
      this.logger.log(`S3 storage connected to bucket "${this.bucket}"`);
    } catch (error) {
      this.logger.error(
        `Failed to connect to S3 bucket "${this.bucket}"`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  assertEnabled(): void {
    if (!this.enabled) {
      throw new InternalServerErrorException('File storage is not configured');
    }
  }

  validateFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype as (typeof ALLOWED_MIME_TYPES)[number])) {
      throw new BadRequestException(
        `Unsupported file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }
  }

  buildObjectKey(folder: StorageFolder, originalName: string): string {
    const extension = extname(originalName).toLowerCase() || '';
    const safeName = originalName
      .replace(extname(originalName), '')
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .slice(0, 80);

    return `${folder}/${randomUUID()}-${safeName || 'file'}${extension}`;
  }

  getPublicUrl(key: string): string {
    return `${this.publicUrlBase.replace(/\/$/, '')}/${key}`;
  }

  extractKeyFromUrl(url: string): string | null {
    if (!url.startsWith('http')) {
      return null;
    }

    const normalizedBase = this.publicUrlBase.replace(/\/$/, '');
    if (url.startsWith(`${normalizedBase}/`)) {
      return url.slice(normalizedBase.length + 1);
    }

    const pathStylePrefix = `/${this.bucket}/`;
    const pathStyleIndex = url.indexOf(pathStylePrefix);
    if (pathStyleIndex !== -1) {
      return url.slice(pathStyleIndex + pathStylePrefix.length);
    }

    return null;
  }

  async resolveAccessibleUrl(url: string, expiresInSeconds = 86_400): Promise<string> {
    if (!this.enabled) {
      return url;
    }

    const key = this.extractKeyFromUrl(url);
    if (!key) {
      return url;
    }

    return this.getSignedUrl(key, expiresInSeconds);
  }

  async resolveAccessibleUrls<T extends { url: string }>(
    items: T[],
    expiresInSeconds = 86_400,
  ): Promise<T[]> {
    return Promise.all(
      items.map(async (item) => ({
        ...item,
        url: await this.resolveAccessibleUrl(item.url, expiresInSeconds),
      })),
    );
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: StorageFolder,
  ): Promise<UploadedFileResult> {
    this.assertEnabled();
    this.validateFile(file);

    const key = this.buildObjectKey(folder, file.originalname);

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          CacheControl: 'public, max-age=31536000, immutable',
          Metadata: {
            originalName: file.originalname,
          },
        }),
      );

      return {
        key,
        url: this.getPublicUrl(key),
        bucket: this.bucket,
        mimeType: file.mimetype,
        size: file.size,
        originalName: file.originalname,
      };
    } catch (error) {
      this.logger.error(
        `Upload failed for ${file.originalname}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException('Failed to upload file');
    }
  }

  async deleteFile(key: string): Promise<void> {
    this.assertEnabled();

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      this.logger.error(
        `Delete failed for ${key}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException('Failed to delete file');
    }
  }

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    this.assertEnabled();

    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async uploadBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<UploadedFileResult> {
    if (!this.enabled) {
      return {
        key,
        url: `data:${contentType};base64,${buffer.toString('base64')}`,
        bucket: 'local',
        mimeType: contentType,
        size: buffer.length,
        originalName: key.split('/').pop() ?? key,
      };
    }

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );

      return {
        key,
        url: this.getPublicUrl(key),
        bucket: this.bucket,
        mimeType: contentType,
        size: buffer.length,
        originalName: key.split('/').pop() ?? key,
      };
    } catch (error) {
      this.logger.error(
        `Buffer upload failed for ${key}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException('Failed to upload file');
    }
  }
}
