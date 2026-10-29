import type { NextFunction, Request, Response } from 'express';

// Tiêu đề bảo mật cho máy chủ API và dịch vụ định danh (DT-SaaS phần S8b, YCTD-201, tài liệu 47 mục 14.5), thêm vào lớp tiêu đề của máy chủ
// chuyển tiếp (Caddy): chặn đoán kiểu nội dung, chặn nhúng khung, bỏ tiêu đề tiết lộ phần mềm, tắt quyền cảm biến, buộc HTTPS khi yêu cầu
// đến qua HTTPS (HSTS), và không cho lưu đệm phản hồi xác thực (mã phiên). Không đặt CSP vì máy chủ API cũng trả trang HTML của website
// trường và trang chọn trường (CSP của trang do lớp trình bày đặt)
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

export function securityHeaders() {
  return (request: Request, response: Response, next: NextFunction): void => {
    response.removeHeader('X-Powered-By');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    const forwardedProtocol = request.header('x-forwarded-proto')?.split(',')[0]?.trim();
    if (request.secure || forwardedProtocol === 'https') {
      response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (/^\/api\/v\d+\/auth(\/|$)/.test(request.path)) {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Pragma', 'no-cache');
    }
    next();
  };
}
