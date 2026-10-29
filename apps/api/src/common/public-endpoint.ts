import { SetMetadata } from '@nestjs/common';

// Đánh dấu bộ điều khiển không cần mã phiên ở tầng chung. Máy chủ của chợ không có bộ kiểm phiên toàn cục: từng điểm cuối tự kiểm phiên
// chợ (MarketContext.account) hoặc phiên quản trị (MarketContext.operator); dấu này giữ lại để đọc mã dễ thấy điểm cuối nào công khai
export const PUBLIC_ENDPOINT = 'cho-gia-su:public-endpoint';

export const PublicEndpoint = () => SetMetadata(PUBLIC_ENDPOINT, true);
