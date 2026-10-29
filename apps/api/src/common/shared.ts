// Hằng số và quyền dùng chung của máy chủ API
export { videoGrantsFor } from './video-grants.js';

export const API_VERSION_PREFIX = '/api/v1';

// Vai trò quản trị chợ và việc từng vai trò được làm (lấy phần chợ của OPERATOR_PERMISSIONS ở School Management, YCTD-323, khi tách
// chợ, YCTD-384): quan_tri mọi việc; ho_tro duyệt hồ sơ gia sư, kiểm duyệt; ke_toan thanh toán, giải ngân, tranh chấp
export const ADMIN_ROLES = ['quan_tri', 'ho_tro', 'ke_toan'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

const ADMIN_PERMISSIONS = {
  'market.view': ADMIN_ROLES,
  'market.settings': ['quan_tri'],
  'market.review': ['quan_tri', 'ho_tro'],
  'market.safety': ['quan_tri', 'ho_tro'],
  'market.payments': ['quan_tri', 'ke_toan'],
  'admins.manage': ['quan_tri'],
} as const satisfies Record<string, readonly AdminRole[]>;

export type AdminCapability = keyof typeof ADMIN_PERMISSIONS;

export function operatorRolesFor(capability: AdminCapability): readonly AdminRole[] {
  return ADMIN_PERMISSIONS[capability];
}
