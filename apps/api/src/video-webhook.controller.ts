import { Controller, HttpCode, Inject, NotFoundException, Optional, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PublicEndpoint } from './common/public-endpoint.js';
import { unauthenticatedError } from './common/server.js';
import { VIDEO_PROVIDER, VideoWebhookError, type VideoRoomProvider } from './common/video-provider.js';
import { MarketRoomsService } from './market/market-rooms.js';

// Nhận sự kiện gọi lại của máy chủ video (vào, ra, ghi xong, phòng kết thúc) có chữ ký. Ở School Management điểm này thuộc mô-đun video
// của trường và chuyển sự kiện phòng `market-` sang chợ; bản tách chỉ có phòng học của chợ (YCTD-384)
@Controller('video/webhook')
@PublicEndpoint()
export class VideoWebhookController {
  constructor(
    private readonly rooms: MarketRoomsService,
    @Optional() @Inject(VIDEO_PROVIDER) private readonly provider: VideoRoomProvider | null = null,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(@Req() request: Request) {
    if (!this.provider) {
      throw new NotFoundException();
    }
    const body = await readRawBody(request);
    let event;
    try {
      event = await this.provider.receiveWebhook(body, request.headers.authorization);
    } catch (error) {
      if (error instanceof VideoWebhookError) {
        throw unauthenticatedError(error.message);
      }
      throw error;
    }
    if (!event) {
      return { handled: false };
    }
    return this.rooms.handleEvent(event);
  }
}

// Thân thô của yêu cầu để kiểm chữ ký: LiveKit gửi `application/webhook+json` nên bộ đọc JSON không đọc trước
async function readRawBody(request: Request): Promise<string> {
  const parsed = typeof request.body === 'object' && request.body !== null && Object.keys(request.body).length > 0;
  if (request.readableEnded || parsed) {
    return JSON.stringify(request.body);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}
