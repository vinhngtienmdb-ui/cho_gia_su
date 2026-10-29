import { Logger } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ObjectStorageSettings } from './configuration.js';

// Kho tệp: máy chủ API ghi và đọc tệp qua giao diện S3 (TP-08, YCTD-45); kiểm thử dùng kho trong bộ nhớ
export abstract class FileStorage {
  // Có kho tệp thật không (NoFileStorage khi máy chủ không đặt S3_*)
  readonly available: boolean = true;
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  // Xóa tệp khi bản ghi sở hữu bị xóa; tệp không còn thì bỏ qua
  abstract delete(key: string): Promise<void>;
  // Xóa mọi tệp có khóa bắt đầu bằng tiền tố; trả số tệp đã xóa
  abstract deletePrefix(prefix: string): Promise<number>;
}

// Máy chủ không có kho tệp: chợ báo chưa nhận tệp (hasMarketStorage), mọi lời gọi khác báo lỗi
export class NoFileStorage extends FileStorage {
  override readonly available = false;

  private missing(): never {
    throw new Error('Máy chủ chưa cấu hình kho tệp (S3_*)');
  }

  async put(): Promise<void> {
    this.missing();
  }

  async get(): Promise<Buffer> {
    this.missing();
  }

  async delete(): Promise<void> {
    this.missing();
  }

  async deletePrefix(): Promise<number> {
    this.missing();
  }
}

export class S3FileStorage extends FileStorage {
  private readonly logger = new Logger('FileStorage');
  private readonly client: S3Client;
  private bucketReady: Promise<void> | undefined;

  constructor(private readonly settings: ObjectStorageSettings) {
    super();
    this.client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: true,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({ Bucket: this.settings.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }));
    return Buffer.from(await (result.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.settings.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const item of page.Contents ?? []) {
        if (item.Key) {
          await this.delete(item.Key);
          deleted += 1;
        }
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    return deleted;
  }

  // Kiểm thùng chứa còn truy cập được (khối "Tình trạng dịch vụ" của cổng vận hành, YCTD-376); không tạo thùng
  async probe(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.settings.bucket }));
  }

  // Tạo thùng chứa ở lần ghi đầu nếu chưa có
  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.settings.bucket }));
      } catch {
        this.logger.warn(`Tạo thùng chứa tệp ${this.settings.bucket}`);
        await this.client.send(new CreateBucketCommand({ Bucket: this.settings.bucket }));
      }
    })().catch((error: unknown) => {
      this.bucketReady = undefined;
      throw error;
    });
    return this.bucketReady;
  }
}

export class MemoryFileStorage extends FileStorage {
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
  }

  async get(key: string): Promise<Buffer> {
    const body = this.objects.get(key);
    if (!body) {
      throw new Error(`Không có tệp ${key}`);
    }
    return body;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async deletePrefix(prefix: string): Promise<number> {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix));
    for (const key of keys) {
      this.objects.delete(key);
    }
    return keys.length;
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }
}
