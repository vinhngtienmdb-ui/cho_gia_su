// Nhận biết cách cài ứng dụng lên màn hình chính trên máy đang dùng (DT-26 phần 26a, YCTD-231). Hàm thuần, chỉ đọc chuỗi nhận
// dạng trình duyệt và vài cờ, để kiểm thử đơn vị được:
// - 'installed': đang chạy ở chế độ đã cài (standalone), không mời cài nữa;
// - 'in-app-browser': mở trong trình duyệt nhúng của Zalo, Facebook, Messenger, Instagram, TikTok (thường gặp khi liên kết gửi
//   qua nhóm Zalo): không cài được, hướng dẫn mở bằng Safari hoặc Chrome;
// - 'ios-safari': iPhone, iPad mở bằng Safari: không có sự kiện cài đặt, hướng dẫn nút Chia sẻ, "Thêm vào MH chính";
// - 'ios-other': iPhone, iPad mở bằng trình duyệt khác (Chrome, Edge trên iOS từ 16.4 cũng thêm được, nhưng đường đi khác
//   nhau), hướng dẫn mở bằng Safari cho chắc;
// - 'prompt': trình duyệt đã báo sự kiện cài đặt (Chrome, Edge trên Android và máy tính), hiện nút "Cài ứng dụng";
// - 'unsupported': còn lại (Firefox máy tính, trình duyệt cũ), không mời cài
export type InstallState = 'installed' | 'in-app-browser' | 'ios-safari' | 'ios-other' | 'prompt' | 'unsupported';

export interface InstallEnvironment {
  userAgent: string;
  // matchMedia('(display-mode: standalone)') hoặc navigator.standalone của iOS
  standalone: boolean;
  // iPadOS 13 trở lên báo là máy Mac: Macintosh có màn hình cảm ứng thì coi là iPad
  maxTouchPoints: number;
  // Đã nhận sự kiện beforeinstallprompt
  promptAvailable: boolean;
}

const IN_APP_BROWSER = /\b(Zalo|FBAN|FBAV|FB_IAB|Messenger|Instagram|musical_ly|TikTok|Line)\b/i;

export function isIos(environment: Pick<InstallEnvironment, 'userAgent' | 'maxTouchPoints'>): boolean {
  return (
    /\b(iPhone|iPad|iPod)\b/.test(environment.userAgent) ||
    (/\bMacintosh\b/.test(environment.userAgent) && environment.maxTouchPoints > 1)
  );
}

export function detectInstallState(environment: InstallEnvironment): InstallState {
  if (environment.standalone) {
    return 'installed';
  }
  if (IN_APP_BROWSER.test(environment.userAgent)) {
    return 'in-app-browser';
  }
  if (isIos(environment)) {
    // Chrome, Edge, Firefox trên iOS có dấu CriOS, EdgiOS, FxiOS
    return /\b(CriOS|EdgiOS|FxiOS|OPiOS)\b/.test(environment.userAgent) ? 'ios-other' : 'ios-safari';
  }
  return environment.promptAvailable ? 'prompt' : 'unsupported';
}

// Người dùng bấm "Để sau": không mời lại trong 30 ngày
export const DISMISS_DAYS = 30;

export function dismissedRecently(dismissedAt: string | null, now: Date): boolean {
  if (!dismissedAt) {
    return false;
  }
  const time = Date.parse(dismissedAt);
  return Number.isFinite(time) && now.getTime() - time < DISMISS_DAYS * 24 * 60 * 60_000;
}
