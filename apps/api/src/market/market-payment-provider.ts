import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

// Bộ nối thanh toán của chợ gia sư (DT-27 phần 27h, YCTD-258; tài liệu 47 mục 19.3 "tiền đi theo mô hình"): tiền nằm ở tổ chức có giấy
// phép, nền tảng chỉ ra lệnh (tạo lệnh thu có giữ, giải ngân chia hoa hồng, hoàn một phần hoặc toàn phần, giữ khi tranh chấp) và nhận sự
// kiện có chữ ký. Bản này chỉ có bộ giả lập `mock` (quyết định của Eric ngày 2026-10-28: tiền giả lập); nhà cung cấp thật viết theo lớp
// này khi Eric chọn tổ chức (E-02) và chỉ dùng được khi thu tiền thật bật (chặn đến khi xong E-01 đến E-07)
export interface HeldCharge {
  providerRef: string;
  // `mock`: ứng dụng hiện nút thanh toán giả lập; `redirect`: chuyển sang trang của nhà cung cấp
  checkout: { kind: 'mock' } | { kind: 'redirect'; url: string };
}

export interface PaymentEvent {
  eventId: string;
  type: 'charge.succeeded' | 'charge.failed';
  providerRef: string;
  amount: number;
}

export class PaymentEventError extends Error {}

export abstract class MarketplacePaymentProvider {
  abstract readonly code: string;
  // Nhà cung cấp chuyển tiền thật; chỉ dùng khi cấu hình chợ bật thu tiền thật
  abstract readonly realMoney: boolean;

  abstract createHeldCharge(input: { reference: string; amount: number; description: string }): Promise<HeldCharge>;
  // Giải ngân: phần cho gia sư và phần hoa hồng của nền tảng
  abstract release(input: { providerRef: string; payout: number; commission: number }): Promise<void>;
  abstract refund(input: { providerRef: string; amount: number }): Promise<void>;
  // Giữ tiền khi có tranh chấp, bỏ giữ khi đã quyết định
  abstract setDisputeHold(input: { providerRef: string; held: boolean }): Promise<void>;
  // Kiểm chữ ký rồi đọc sự kiện; sai chữ ký ném PaymentEventError
  abstract verifyEvent(body: unknown, signature: string | undefined): PaymentEvent;
}

export interface MockLedgerEntry {
  action: 'charge' | 'release' | 'refund' | 'hold' | 'unhold';
  providerRef: string;
  amount?: number;
  payout?: number;
  commission?: number;
}

// Bộ giả lập: không gọi dịch vụ nào, ghi sổ các lệnh trong bộ nhớ để kiểm thử đọc; sự kiện ký HMAC-SHA256 bằng bí mật của tiến trình
export class MockMarketplacePaymentProvider extends MarketplacePaymentProvider {
  readonly code = 'mock';
  readonly realMoney = false;
  readonly ledger: MockLedgerEntry[] = [];
  private readonly secret: Buffer;

  constructor(secret?: string) {
    super();
    this.secret = secret ? Buffer.from(secret) : randomBytes(32);
  }

  createHeldCharge(input: { reference: string; amount: number }): Promise<HeldCharge> {
    const providerRef = `mock_${randomUUID()}`;
    this.ledger.push({ action: 'charge', providerRef, amount: input.amount });
    return Promise.resolve({ providerRef, checkout: { kind: 'mock' } });
  }

  release(input: { providerRef: string; payout: number; commission: number }): Promise<void> {
    this.ledger.push({ action: 'release', ...input });
    return Promise.resolve();
  }

  refund(input: { providerRef: string; amount: number }): Promise<void> {
    this.ledger.push({ action: 'refund', ...input });
    return Promise.resolve();
  }

  setDisputeHold(input: { providerRef: string; held: boolean }): Promise<void> {
    this.ledger.push({ action: input.held ? 'hold' : 'unhold', providerRef: input.providerRef });
    return Promise.resolve();
  }

  private sign(text: string): string {
    return createHmac('sha256', this.secret).update(text).digest('hex');
  }

  // Sự kiện "đã thu tiền" giả lập, ký như nhà cung cấp thật sẽ ký (dùng cho nút thanh toán giả lập và kiểm thử)
  signedEvent(event: PaymentEvent): { body: Record<string, unknown>; signature: string } {
    const body = { event_id: event.eventId, type: event.type, provider_ref: event.providerRef, amount: event.amount };
    return { body, signature: this.sign(JSON.stringify(body)) };
  }

  verifyEvent(body: unknown, signature: string | undefined): PaymentEvent {
    const item = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const canonical = JSON.stringify({
      event_id: item.event_id,
      type: item.type,
      provider_ref: item.provider_ref,
      amount: item.amount,
    });
    const expected = Buffer.from(this.sign(canonical));
    const given = Buffer.from(signature ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new PaymentEventError('Chữ ký sự kiện không đúng');
    }
    if (
      typeof item.event_id !== 'string' ||
      (item.type !== 'charge.succeeded' && item.type !== 'charge.failed') ||
      typeof item.provider_ref !== 'string' ||
      typeof item.amount !== 'number'
    ) {
      throw new PaymentEventError('Sự kiện không đúng dạng');
    }
    return { eventId: item.event_id, type: item.type, providerRef: item.provider_ref, amount: item.amount };
  }
}
