import { Injectable } from '@nestjs/common';

// Gửi mã xác nhận của chợ gia sư (DT-27 phần 27f, YCTD-256). Bản này chỉ có hộp thư giả lập trong bộ nhớ (không gọi dịch vụ thật,
// không ghi mã ra nhật ký): kiểm thử đọc hộp thư, môi trường thử nghiệm xem mã ở đây. Nối nhà cung cấp thư điện tử, tin nhắn thật
// (eSMS dùng chung với S8) làm khi mở chợ (E-04), không chặn các phần 27g đến 27i
export interface MarketMessage {
  channel: 'email' | 'sms';
  to: string;
  text: string;
}

const OUTBOX_LIMIT = 200;

@Injectable()
export class MarketMessenger {
  readonly outbox: MarketMessage[] = [];

  send(message: MarketMessage): Promise<void> {
    this.outbox.push(message);
    if (this.outbox.length > OUTBOX_LIMIT) {
      this.outbox.splice(0, this.outbox.length - OUTBOX_LIMIT);
    }
    return Promise.resolve();
  }

  // Thư gần nhất gửi tới một địa chỉ (kiểm thử)
  lastTo(to: string): MarketMessage | undefined {
    return [...this.outbox].reverse().find((message) => message.to === to);
  }
}
