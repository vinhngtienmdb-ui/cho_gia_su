import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

// Nhiều ca mở thêm phiên trình duyệt bằng browser.newContext() cho từng vai trò; cả lượt chạy dùng chung một trình duyệt nên phiên
// không đóng dồn lại tới khi Chrome báo ERR_INSUFFICIENT_RESOURCES. Sau mỗi ca đóng mọi phiên mở thêm trong ca đó
export const test = base.extend<{ closeExtraContexts: void }>({
  closeExtraContexts: [
    async ({ browser }, use) => {
      const before = new Set(browser.contexts());
      await use();
      await Promise.all(
        browser
          .contexts()
          .filter((context) => !before.has(context))
          .map((context) => context.close()),
      );
    },
    { auto: true },
  ],
});
