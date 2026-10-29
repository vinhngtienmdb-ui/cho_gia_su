import type { Migration } from 'kysely/migration';
import { migration as m0001 } from './0001_set_timezone.js';
import { migration as m0002 } from './0002_create_market_accounts.js';
import { migration as m0003 } from './0003_create_market_legal_documents.js';
import { migration as m0004 } from './0004_create_market_children.js';
import { migration as m0005 } from './0005_create_market_tutors.js';
import { migration as m0010 } from './0010_create_market_tutor_verification.js';
import { migration as m0020 } from './0020_create_market_bookings.js';
import { migration as m0030 } from './0030_create_market_safety.js';
import { migration as m0040 } from './0040_create_market_session_rooms.js';
import { migration as m0050 } from './0050_create_market_reviews.js';
import { migration as m0051 } from './0051_create_market_packages.js';
import { migration as m0060 } from './0060_create_market_settings_and_admins.js';

// Danh sách tệp thay đổi cấu trúc, Kysely chạy theo thứ tự tên. Thêm tệp mới thì thêm một dòng ở đây; kiểm thử
// migrations.test.ts báo lỗi khi tệp trong thư mục chưa có trong danh sách
export const migrations: Record<string, Migration> = {
  '0001_set_timezone': m0001,
  '0002_create_market_accounts': m0002,
  '0003_create_market_legal_documents': m0003,
  '0004_create_market_children': m0004,
  '0005_create_market_tutors': m0005,
  '0010_create_market_tutor_verification': m0010,
  '0020_create_market_bookings': m0020,
  '0030_create_market_safety': m0030,
  '0040_create_market_session_rooms': m0040,
  '0050_create_market_reviews': m0050,
  '0051_create_market_packages': m0051,
  '0060_create_market_settings_and_admins': m0060,
};
