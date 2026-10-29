import { MockOidcServer } from '@cho-gia-su/api/dist/test-support.js';
import { E2E_MARKET_OIDC_CLIENT_ID, E2E_MARKET_OIDC_PORT } from '../e2e-environment.mjs';
import {
  ADMIN_URL,
  adminToken,
  createAdminAccount,
  openMarketDatabase,
  publishDocuments,
  setKnownCode,
  signInAdmin,
  WEB_URL,
  type MarketDatabase,
} from './cho-gia-su.js';
import { expect, test } from './fixtures.js';

// DT-27 phần 27g (YCTD-257, spec 196): gia sư ở khu gia sư của Chợ gia sư (ứng dụng chung từ YCTD-368) xác minh danh tính qua nhà cung
// cấp OIDC giả lập (đủ 18 tuổi), khai hồ sơ dạy, nộp phiếu lý lịch tư pháp (mã hóa ở máy chủ), gửi duyệt; quản trị duyệt ở ứng dụng quản
// trị; phụ huynh thấy gia sư ở Chợ gia sư, mở trang theo Mẫu 02. Dữ liệu giả, không gọi dịch vụ thật
const suffix = Math.random().toString(36).slice(2, 8);
const tutorEmail = `gia-su-xac-minh-${suffix}@example.test`;
const tutorName = `Gia sư Hòa ${suffix}`;
const CODE = '135790';
const PDF = Buffer.from('%PDF-1.4\n% phieu ly lich tu phap gia\n');

let marketplace: MarketDatabase;
let mock: MockOidcServer;

test.beforeAll(async () => {
  marketplace = openMarketDatabase();
  mock = await new MockOidcServer({
    port: E2E_MARKET_OIDC_PORT,
    clientId: E2E_MARKET_OIDC_CLIENT_ID,
    // Bí mật của lần chạy, cùng giá trị playwright.config.ts truyền cho máy chủ API
    clientSecret: process.env.E2E_RUN_OIDC_CLIENT_SECRET ?? '',
  }).start();
  const token = await adminToken(await createAdminAccount(marketplace, 'Quản trị đăng văn bản giả'));
  await publishDocuments(token, ['terms', 'privacy', 'tutor_terms'], suffix);
});

test.afterAll(async () => {
  await marketplace?.destroy();
  await mock?.stop();
});

test('CT-27g-5: gia sư xác minh, khai hồ sơ, nộp lý lịch; quản trị duyệt; phụ huynh tìm thấy theo Mẫu 02', async ({
  browser,
}) => {
  // Đăng ký gia sư ở ứng dụng chung Chợ gia sư, chọn loại tài khoản gia sư (YCTD-368)
  const tutorContext = await browser.newContext({ baseURL: WEB_URL });
  const tutor = await tutorContext.newPage();
  await tutor.goto('/');
  await tutor.getByRole('button', { name: 'Đăng ký làm gia sư' }).click();
  const register = tutor.getByRole('form', { name: 'Đăng ký tài khoản chợ gia sư' });
  await expect(register.getByLabel('Gia sư, kể cả giáo viên dạy kèm ngoài trường')).toBeChecked();
  await register.getByLabel('Thư điện tử hoặc số điện thoại').fill(tutorEmail);
  await register.getByLabel('Tên hiển thị').fill(tutorName);
  await register.getByLabel('Mật khẩu (ít nhất 8 ký tự, có chữ và số)').fill('matkhau123');
  for (const kind of ['terms', 'privacy', 'tutor_terms']) {
    await register.getByLabel(`Tôi đồng ý Văn bản ${kind} ${suffix}`).check();
  }
  await register.getByRole('button', { name: 'Tạo tài khoản' }).click();
  await expect(tutor.getByRole('form', { name: 'Xác nhận tài khoản' })).toBeVisible();
  await setKnownCode(marketplace, tutorEmail, CODE);
  const verify = tutor.getByRole('form', { name: 'Xác nhận tài khoản' });
  await verify.getByLabel('Mã xác nhận').fill(CODE);
  await verify.getByRole('button', { name: 'Xác nhận' }).click();

  // Xác minh danh tính: sang nhà cung cấp giả lập rồi quay về /xac-minh; ứng dụng bỏ đường dẫn quay về và mở trang Xác minh của tài
  // khoản chưa duyệt (`#xac-minh`, YCTD-361)
  mock.nextIdentity = { subject: `gia-su-e2e-${suffix}`, birthdate: `${new Date().getFullYear() - 30}-03-08` };
  const identity = tutor.getByRole('region', { name: 'Danh tính' });
  await tutor.getByRole('button', { name: 'Xác minh bằng Định danh giả lập' }).click();
  await expect(tutor.getByText('Đã xác minh danh tính')).toBeVisible();
  await expect(tutor).toHaveURL(/\/(#xac-minh)?$/);
  await expect(identity).toContainText('Đã xác minh');

  // Hồ sơ dạy: một môn năng khiếu, một khung giờ (khu gia sư chia trang theo cột điều hướng, YCTD-361)
  await tutor
    .getByRole('navigation', { name: 'Điều hướng khu gia sư' })
    .getByRole('button', { name: 'Hồ sơ và môn dạy' })
    .click();
  const listing = tutor.getByRole('region', { name: 'Hồ sơ dạy' });
  await listing.getByRole('button', { name: 'Thêm môn' }).click();
  const subject = listing.getByRole('group', { name: 'Môn 1' });
  await subject.getByLabel('Tên môn').fill(`Cờ vua ${suffix}`);
  await subject.getByLabel('Giá mỗi buổi (đồng)').fill('120000');
  await listing.getByRole('button', { name: 'Thêm khung giờ' }).click();
  await listing.getByRole('button', { name: 'Lưu hồ sơ dạy' }).click();
  await expect(listing.getByText('Đã lưu hồ sơ dạy')).toBeVisible();

  // Phiếu lý lịch tư pháp cấp hôm nay
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  await tutor
    .getByRole('navigation', { name: 'Điều hướng khu gia sư' })
    .getByRole('button', { name: 'Xác minh' })
    .click();
  const record = tutor.getByRole('form', { name: 'Phiếu lý lịch tư pháp' });
  await record.getByLabel('Ngày cấp').fill(today);
  await record.getByLabel('Tệp (PDF, JPEG, PNG, tối đa 10 MB)').setInputFiles({
    name: 'ly-lich.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await record.getByRole('button', { name: 'Nộp phiếu lý lịch tư pháp' }).click();
  await expect(record).toContainText('Đang chờ duyệt');
  await tutor
    .getByRole('navigation', { name: 'Điều hướng khu gia sư' })
    .getByRole('button', { name: 'Hồ sơ và môn dạy' })
    .click();
  await tutor.getByRole('region', { name: 'Hồ sơ dạy' }).getByRole('button', { name: 'Gửi nền tảng duyệt' }).click();
  await expect(tutor.getByRole('region', { name: 'Hồ sơ dạy' })).toContainText('Đang chờ nền tảng duyệt');
  await tutorContext.close();

  // Quản trị duyệt lý lịch rồi duyệt hồ sơ ở ứng dụng quản trị
  const adminContext = await browser.newContext({ baseURL: ADMIN_URL });
  const adminPage = await adminContext.newPage();
  await signInAdmin(adminPage, await createAdminAccount(marketplace, 'Nhân viên duyệt gia sư giả', 'ho_tro'));
  await adminPage
    .getByRole('navigation', { name: 'Trang quản trị' })
    .getByRole('button', { name: 'Chợ gia sư' })
    .click();
  const queue = adminPage.getByRole('region', { name: 'Hàng chờ duyệt gia sư' });
  await queue.getByRole('button', { name: `Mở ${tutorName}` }).click();
  const review = adminPage.getByRole('region', { name: `Duyệt gia sư ${tutorName}` });
  await expect(review.getByRole('button', { name: 'Duyệt hồ sơ' })).toBeDisabled();
  await review.getByRole('button', { name: 'Duyệt Lý lịch tư pháp' }).click();
  await expect(review.getByRole('list', { name: 'Trạng thái xác minh' })).toContainText('Lý lịch tư pháp: đã duyệt');
  await review.getByRole('button', { name: 'Duyệt hồ sơ' }).click();
  await expect(review).toContainText('Hồ sơ: approved');
  await adminContext.close();

  // Phụ huynh tìm thấy gia sư ở Chợ gia sư, mở trang theo Mẫu 02; không có thư điện tử của gia sư
  const marketContext = await browser.newContext({ baseURL: WEB_URL });
  const market = await marketContext.newPage();
  await market.goto('/');
  const search = market.getByRole('form', { name: 'Lọc gia sư' });
  await search.getByLabel('Môn').fill(`Cờ vua ${suffix}`);
  await search.getByRole('button', { name: 'Tìm' }).click();
  const card = market.getByRole('listitem', { name: `Gia sư ${tutorName}` });
  await expect(card).toContainText('120.000 đồng');
  await expect(card).toContainText('Đã xác minh lý lịch tư pháp');
  await card.getByRole('button', { name: `Xem gia sư ${tutorName}` }).click();
  const form02 = market.getByRole('region', { name: 'Thông tin công khai theo Mẫu 02' });
  await expect(form02).toContainText('Trực tuyến qua Chợ gia sư');
  await expect(form02).toContainText(`Cờ vua ${suffix}`);
  await expect(market.getByText(tutorEmail)).toHaveCount(0);
  await marketContext.close();
});
