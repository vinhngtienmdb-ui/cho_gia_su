import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { VIDEO_JOIN_TOKEN_SECONDS, type VideoGrants, type VideoTrackSource } from './video-grants.js';
import {
  AccessToken,
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  RoomServiceClient,
  S3Upload,
  TrackSource,
  WebhookReceiver,
} from 'livekit-server-sdk';
import type { ObjectStorageSettings, VideoSettings } from './configuration.js';

// Bộ nối phòng video (DT-27 phần 27a, YCTD-251; tài liệu 47 mục 19.5): tạo phòng, cấp mã vào phòng theo người và quyền, đổi quyền,
// kết thúc phòng, bắt đầu và dừng ghi, nhận sự kiện vào ra qua địa chỉ gọi lại có chữ ký. `livekit` (tự host) và `livekit-cloud` (dự
// phòng) cùng mã, khác địa chỉ; `mock` cho kiểm thử. Mã nghiệp vụ chỉ gọi qua lớp này, không rẽ nhánh theo nhà cung cấp
export interface VideoTokenInput {
  roomName: string;
  identity: string;
  displayName: string;
  grants: VideoGrants;
}

export interface VideoRoomEvent {
  kind: 'join' | 'leave' | 'recording_ended' | 'room_ended';
  roomName: string;
  identity: string | null;
  at: Date;
  recording?: { egressId: string; succeeded: boolean; sizeBytes: number };
}

export interface StoppedRecording {
  // Nhà cung cấp trả kết quả ngay (bộ giả lập) thì máy chủ ghi luôn; LiveKit báo qua sự kiện gọi lại khi Egress xong
  completed?: { sizeBytes: number; contents?: Buffer };
}

export class VideoWebhookError extends Error {}

export abstract class VideoRoomProvider {
  abstract readonly code: string;
  abstract readonly clientUrl: string;
  abstract createRoom(roomName: string, options: { maxParticipants: number }): Promise<void>;
  abstract issueToken(input: VideoTokenInput): Promise<string>;
  abstract updatePermissions(roomName: string, identity: string, grants: VideoGrants): Promise<void>;
  abstract removeParticipant(roomName: string, identity: string): Promise<void>;
  abstract endRoom(roomName: string): Promise<void>;
  abstract startRecording(roomName: string, storageKey: string): Promise<{ egressId: string }>;
  abstract stopRecording(egressId: string): Promise<StoppedRecording>;
  // Sự kiện gọi lại; chữ ký sai thì ném VideoWebhookError; sự kiện không dùng đến thì trả null
  abstract receiveWebhook(body: string, authorization: string | undefined): Promise<VideoRoomEvent | null>;
}

const TRACK_SOURCES: Record<VideoTrackSource, TrackSource> = {
  camera: TrackSource.CAMERA,
  microphone: TrackSource.MICROPHONE,
  screen_share: TrackSource.SCREEN_SHARE,
  screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
};

class LiveKitVideoProvider extends VideoRoomProvider {
  readonly clientUrl: string;
  private readonly rooms: RoomServiceClient;
  private readonly egress: EgressClient;
  private readonly receiver: WebhookReceiver;

  constructor(
    readonly code: string,
    private readonly settings: VideoSettings,
    private readonly storage: ObjectStorageSettings | null,
  ) {
    super();
    this.clientUrl = settings.clientUrl;
    this.rooms = new RoomServiceClient(settings.apiUrl, settings.apiKey, settings.apiSecret);
    this.egress = new EgressClient(settings.apiUrl, settings.apiKey, settings.apiSecret);
    this.receiver = new WebhookReceiver(settings.apiKey, settings.apiSecret);
  }

  async createRoom(roomName: string, options: { maxParticipants: number }) {
    await this.rooms.createRoom({ name: roomName, maxParticipants: options.maxParticipants, emptyTimeout: 600 });
  }

  async issueToken(input: VideoTokenInput) {
    const token = new AccessToken(this.settings.apiKey, this.settings.apiSecret, {
      identity: input.identity,
      name: input.displayName,
      ttl: VIDEO_JOIN_TOKEN_SECONDS,
    });
    token.addGrant({
      room: input.roomName,
      roomJoin: true,
      roomAdmin: input.grants.roomAdmin,
      canPublish: input.grants.canPublish,
      canPublishData: input.grants.canPublishData,
      canSubscribe: input.grants.canSubscribe,
      canPublishSources: input.grants.canPublishSources.map((source) => TRACK_SOURCES[source]),
    });
    return token.toJwt();
  }

  async updatePermissions(roomName: string, identity: string, grants: VideoGrants) {
    await this.rooms.updateParticipant(roomName, identity, {
      permission: {
        canPublish: grants.canPublish,
        canPublishData: grants.canPublishData,
        canSubscribe: grants.canSubscribe,
        canPublishSources: grants.canPublishSources.map((source) => TRACK_SOURCES[source]),
      },
    });
  }

  async removeParticipant(roomName: string, identity: string) {
    await this.rooms.removeParticipant(roomName, identity);
  }

  async endRoom(roomName: string) {
    await this.rooms.deleteRoom(roomName);
  }

  async startRecording(roomName: string, storageKey: string) {
    if (!this.storage) {
      throw new Error('Chưa cấu hình kho tệp S3 cho bản ghi video');
    }
    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: storageKey,
      output: {
        case: 's3',
        value: new S3Upload({
          endpoint: this.storage.endpoint,
          region: this.storage.region,
          bucket: this.storage.bucket,
          accessKey: this.storage.accessKeyId,
          secret: this.storage.secretAccessKey,
          forcePathStyle: true,
        }),
      },
    });
    const info = await this.egress.startRoomCompositeEgress(roomName, { file: output }, { layout: 'grid' });
    return { egressId: info.egressId };
  }

  async stopRecording(egressId: string) {
    await this.egress.stopEgress(egressId);
    return {};
  }

  async receiveWebhook(body: string, authorization: string | undefined): Promise<VideoRoomEvent | null> {
    let event;
    try {
      event = await this.receiver.receive(body, authorization);
    } catch {
      throw new VideoWebhookError('Chữ ký sự kiện gọi lại không hợp lệ');
    }
    const at = event.createdAt ? new Date(Number(event.createdAt) * 1000) : new Date();
    const roomName = event.room?.name ?? event.egressInfo?.roomName ?? '';
    if (event.event === 'participant_joined' || event.event === 'participant_left') {
      return {
        kind: event.event === 'participant_joined' ? 'join' : 'leave',
        roomName,
        identity: event.participant?.identity ?? null,
        at,
      };
    }
    if (event.event === 'egress_ended' && event.egressInfo) {
      const files = event.egressInfo.fileResults ?? [];
      return {
        kind: 'recording_ended',
        roomName,
        identity: null,
        at,
        recording: {
          egressId: event.egressInfo.egressId,
          // Trạng thái EGRESS_COMPLETE của giao thức là 3
          succeeded: Number(event.egressInfo.status) === 3,
          sizeBytes: files.reduce((sum, file) => sum + Number(file.size ?? 0), 0),
        },
      };
    }
    if (event.event === 'room_finished') {
      return { kind: 'room_ended', roomName, identity: null, at };
    }
    return null;
  }
}

// Bộ giả lập: mã vào phòng là chuỗi ký bằng khóa giả lập (giao diện nhận biết và không nối máy chủ video); sự kiện gọi lại là JSON
// kèm tiêu đề `Mock <chữ ký HMAC của thân>`; dừng ghi trả ngay một tệp nhỏ để xem lại được
export class MockVideoProvider extends VideoRoomProvider {
  readonly code = 'mock';
  readonly clientUrl = 'mock://video';
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  constructor(private readonly secret: string) {
    super();
  }

  signature(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  async createRoom(roomName: string, options: { maxParticipants: number }) {
    this.calls.push({ method: 'createRoom', args: [roomName, options] });
  }

  async issueToken(input: VideoTokenInput) {
    this.calls.push({ method: 'issueToken', args: [input] });
    const payload = Buffer.from(
      JSON.stringify({ room: input.roomName, identity: input.identity, grants: input.grants }),
    ).toString('base64url');
    return `mock.${payload}.${this.signature(payload)}`;
  }

  async updatePermissions(roomName: string, identity: string, grants: VideoGrants) {
    this.calls.push({ method: 'updatePermissions', args: [roomName, identity, grants] });
  }

  async removeParticipant(roomName: string, identity: string) {
    this.calls.push({ method: 'removeParticipant', args: [roomName, identity] });
  }

  async endRoom(roomName: string) {
    this.calls.push({ method: 'endRoom', args: [roomName] });
  }

  async startRecording(roomName: string, storageKey: string) {
    this.calls.push({ method: 'startRecording', args: [roomName, storageKey] });
    return { egressId: `mock-egress-${randomUUID()}` };
  }

  async stopRecording(egressId: string): Promise<StoppedRecording> {
    this.calls.push({ method: 'stopRecording', args: [egressId] });
    if (this.deferRecordingCompletion) {
      return {};
    }
    const contents = Buffer.from('ban ghi gia lap');
    return { completed: { sizeBytes: contents.length, contents } };
  }

  // Bật thì dừng ghi không trả tệp, như LiveKit: tệp ghi xong báo qua sự kiện `recording_ended` (YCTD-379)
  deferRecordingCompletion = false;

  async receiveWebhook(body: string, authorization: string | undefined): Promise<VideoRoomEvent | null> {
    const expected = Buffer.from(`Mock ${this.signature(body)}`);
    const received = Buffer.from(authorization ?? '');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new VideoWebhookError('Chữ ký sự kiện gọi lại không hợp lệ');
    }
    const event = JSON.parse(body) as {
      kind: 'join' | 'leave' | 'recording_ended';
      room: string;
      identity: string;
      at?: string;
      egress_id?: string;
      succeeded?: boolean;
      size_bytes?: number;
    };
    if (event.kind === 'recording_ended' && event.egress_id) {
      return {
        kind: 'recording_ended',
        roomName: event.room,
        identity: null,
        at: event.at ? new Date(event.at) : new Date(),
        recording: { egressId: event.egress_id, succeeded: event.succeeded === true, sizeBytes: event.size_bytes ?? 0 },
      };
    }
    if (event.kind !== 'join' && event.kind !== 'leave') {
      return null;
    }
    return {
      kind: event.kind,
      roomName: event.room,
      identity: event.identity,
      at: event.at ? new Date(event.at) : new Date(),
    };
  }
}

export const VIDEO_PROVIDER = Symbol('VIDEO_PROVIDER');

export function createVideoProvider(
  settings: VideoSettings | null | undefined,
  storage: ObjectStorageSettings | null,
): VideoRoomProvider | null {
  if (!settings) {
    return null;
  }
  if (settings.provider === 'mock') {
    return new MockVideoProvider(settings.apiSecret);
  }
  return new LiveKitVideoProvider(settings.provider, settings, storage);
}
