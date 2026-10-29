import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { ApplicationError, Clock } from '../common/server.js';
import type { Request } from 'express';
import { throwError, type Observable } from 'rxjs';

// Giới hạn số yêu cầu tới chợ gia sư theo địa chỉ mạng (YCTD-379), cửa sổ cố định như bộ giới hạn công khai của tuyển sinh: mọi điểm
// cuối `market/*` tối đa 600 yêu cầu mỗi phút; các điểm cuối nhận hoặc gửi mã, mật khẩu (xác nhận tài khoản, quên, đặt lại, đổi,
// xác nhận lại mật khẩu) tối đa 30 yêu cầu mỗi phút. Sự kiện gọi lại của cổng thanh toán không tính. Bộ đếm giữ trong bộ nhớ của
// tiến trình; khởi động lại thì đếm lại
export const MARKET_RATE_LIMITS = {
  code: { limit: 30, windowMs: 60_000 },
  all: { limit: 600, windowMs: 60_000 },
} as const;

const MARKET_PREFIX = '/api/v1/market/';
const CODE_ROUTES = new Set([
  '/api/v1/market/auth/verify',
  '/api/v1/market/auth/resend',
  '/api/v1/market/auth/password/forgot',
  '/api/v1/market/auth/password/reset',
  '/api/v1/market/auth/password/change',
  '/api/v1/market/auth/password/confirm',
]);
const EXEMPT_PREFIX = '/api/v1/market/payments/webhooks/';

@Injectable()
export class MarketRateLimiter implements NestInterceptor {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly clock: Clock) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    // Mẫu tuyến đã khớp (không phụ thuộc chữ hoa, "/" cuối của đường dẫn gửi lên)
    const route =
      `${request.baseUrl}${(request.route as { path?: string } | undefined)?.path ?? request.path}`.toLowerCase();
    if (route.startsWith(MARKET_PREFIX) && !route.startsWith(EXEMPT_PREFIX)) {
      const address = request.ip ?? 'unknown';
      try {
        this.consume(`all:${address}`, MARKET_RATE_LIMITS.all);
        if (CODE_ROUTES.has(route)) {
          this.consume(`code:${address}`, MARKET_RATE_LIMITS.code);
        }
      } catch (error) {
        return throwError(() => error);
      }
    }
    return next.handle();
  }

  // Xóa mọi bộ đếm; dùng trong kiểm thử
  reset(): void {
    this.windows.clear();
  }

  private consume(key: string, rule: { limit: number; windowMs: number }): void {
    const now = this.clock.now().getTime();
    const window = this.windows.get(key);
    if (!window || now - window.start >= rule.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      this.prune(now);
      return;
    }
    window.count += 1;
    if (window.count > rule.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((window.start + rule.windowMs - now) / 1000));
      throw new ApplicationError(
        'ERR_RATE_LIMIT',
        `Bạn thao tác quá nhiều lần, vui lòng thử lại sau ${retryAfterSeconds} giây`,
        [],
        retryAfterSeconds,
      );
    }
  }

  // Bỏ cửa sổ đã hết hạn để bộ nhớ không tăng mãi
  private prune(now: number): void {
    if (this.windows.size < 10_000) {
      return;
    }
    for (const [key, window] of this.windows) {
      if (now - window.start >= MARKET_RATE_LIMITS.all.windowMs) {
        this.windows.delete(key);
      }
    }
  }
}
