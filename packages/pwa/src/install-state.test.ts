import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectInstallState, dismissedRecently, type InstallEnvironment } from './install-state.ts';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const ANDROID_ZALO =
  'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36 Zalo android/12100';
const IPHONE_FACEBOOK =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.0]';

function environment(userAgent: string, overrides: Partial<InstallEnvironment> = {}): InstallEnvironment {
  return { userAgent, standalone: false, maxTouchPoints: 0, promptAvailable: false, ...overrides };
}

describe('nhận biết cách cài ứng dụng (26a)', () => {
  it('đã cài thì không mời nữa, kể cả trong trình duyệt nhúng', () => {
    assert.equal(detectInstallState(environment(IPHONE_SAFARI, { standalone: true })), 'installed');
    assert.equal(detectInstallState(environment(ANDROID_ZALO, { standalone: true })), 'installed');
  });

  it('trình duyệt nhúng của Zalo, Facebook hướng dẫn mở bằng trình duyệt', () => {
    assert.equal(detectInstallState(environment(ANDROID_ZALO, { promptAvailable: true })), 'in-app-browser');
    assert.equal(detectInstallState(environment(IPHONE_FACEBOOK, { maxTouchPoints: 5 })), 'in-app-browser');
  });

  it('iPhone, iPad mở bằng Safari hướng dẫn thêm vào màn hình chính', () => {
    assert.equal(detectInstallState(environment(IPHONE_SAFARI, { maxTouchPoints: 5 })), 'ios-safari');
    assert.equal(detectInstallState(environment(IPAD_DESKTOP_MODE, { maxTouchPoints: 5 })), 'ios-safari');
    assert.equal(detectInstallState(environment(IPHONE_CHROME, { maxTouchPoints: 5 })), 'ios-other');
  });

  it('máy Mac không cảm ứng không bị coi là iPad', () => {
    assert.equal(detectInstallState(environment(IPAD_DESKTOP_MODE)), 'unsupported');
  });

  it('Android có sự kiện cài đặt thì hiện nút cài, chưa có thì không mời', () => {
    assert.equal(detectInstallState(environment(ANDROID_CHROME, { promptAvailable: true })), 'prompt');
    assert.equal(detectInstallState(environment(ANDROID_CHROME)), 'unsupported');
  });

  it('"Để sau" giữ 30 ngày', () => {
    const now = new Date('2026-10-26T08:00:00Z');
    assert.equal(dismissedRecently(null, now), false);
    assert.equal(dismissedRecently('2026-10-01T08:00:00Z', now), true);
    assert.equal(dismissedRecently('2026-09-20T08:00:00Z', now), false);
    assert.equal(dismissedRecently('hỏng', now), false);
  });
});
