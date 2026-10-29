import { ADMIN_URL, createAdminAccount, openMarketDatabase, setKnownCode, signInAdmin, WEB_URL } from './cho-gia-su.js';
import type { MarketDatabase } from './cho-gia-su.js';
import { expect, test } from './fixtures.js';

// DT-27 phần 27f (YCTD-256, spec 195): nền chợ gia sư. Quản trị đăng văn bản pháp lý có phiên bản ở ứng dụng quản trị (thu tiền thật không
// có công tắc), phụ huynh đăng ký ở ứng dụng chợ, xác nhận mã, tạo hồ sơ con có đồng ý, rút đồng ý; gia sư đăng ký ở cùng ứng dụng và
// chỉ thấy bộ màn của gia sư (YCTD-368). Dữ liệu giả, không gọi dịch vụ thật
const suffix = Math.random().toString(36).slice(2, 8);
const parentEmail = `phu-huynh-${suffix}@example.test`;
const tutorEmail = `gia-su-${suffix}@example.test`;
const CODE = '246810';

let marketplace: MarketDatabase;

test.beforeAll(() => {
  marketplace = openMarketDatabase();
});

test.afterAll(async () => {
  await marketplace?.destroy();
});

test('CT-27f-6: quản trị đăng văn bản pháp lý, phụ huynh đăng ký và tạo hồ sơ con có đồng ý, gia sư đăng ký ở cùng ứng dụng', async ({
  browser,
}) => {
  // Quản trị đăng văn bản pháp lý
  const administrator = await createAdminAccount(marketplace, 'Quản trị chợ giả');
  const adminContext = await browser.newContext({ baseURL: ADMIN_URL });
  const adminPage = await adminContext.newPage();
  await signInAdmin(adminPage, administrator);
  await adminPage
    .getByRole('navigation', { name: 'Trang quản trị' })
    .getByRole('button', { name: 'Chợ gia sư' })
    .click();
  const page = adminPage.getByRole('region', { name: 'Chợ gia sư' });
  await expect(page).toContainText('Thu tiền thật ở chợ: tắt');
  const publish = page.getByRole('form', { name: 'Đăng văn bản pháp lý của chợ' });
  for (const [kind, title] of [
    ['Điều khoản sử dụng', `Điều khoản giả ${suffix}`],
    ['Chính sách dữ liệu cá nhân', `Chính sách giả ${suffix}`],
    ['Đồng ý của cha mẹ cho hồ sơ con', `Đồng ý của cha mẹ giả ${suffix}`],
    ['Điều khoản dành cho gia sư', `Điều khoản gia sư giả ${suffix}`],
  ] as const) {
    await publish.getByLabel('Loại văn bản').selectOption({ label: kind });
    await publish.getByLabel('Tiêu đề').fill(title);
    await publish.getByLabel('Nội dung').fill(`Nội dung giả của ${title}`);
    await publish.getByRole('button', { name: 'Đăng phiên bản mới' }).click();
    await expect(page.getByRole('table', { name: 'Văn bản pháp lý đã đăng' })).toContainText(title);
  }
  await adminContext.close();

  // Phụ huynh đăng ký ở ứng dụng chợ
  const marketContext = await browser.newContext({ baseURL: WEB_URL });
  const market = await marketContext.newPage();
  await market.goto('/');
  await expect(market.getByText('thanh toán là giả lập')).toBeVisible();
  await market.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  const register = market.getByRole('form', { name: 'Đăng ký tài khoản chợ gia sư' });
  await register.getByLabel('Thư điện tử hoặc số điện thoại').fill(parentEmail);
  await register.getByLabel('Tên hiển thị').fill('Phụ huynh giả');
  await register.getByLabel('Mật khẩu (ít nhất 8 ký tự, có chữ và số)').fill('matkhau123');
  await register.getByLabel(`Tôi đồng ý Điều khoản giả ${suffix}`).check();
  await register.getByLabel(`Tôi đồng ý Chính sách giả ${suffix}`).check();
  await register.getByRole('button', { name: 'Tạo tài khoản' }).click();
  await expect(market.getByRole('form', { name: 'Xác nhận tài khoản' })).toBeVisible();

  await setKnownCode(marketplace, parentEmail, CODE);
  const verify = market.getByRole('form', { name: 'Xác nhận tài khoản' });
  await verify.getByLabel('Mã xác nhận').fill(CODE);
  await verify.getByRole('button', { name: 'Xác nhận' }).click();

  // Hồ sơ con tối thiểu, có đồng ý của cha mẹ; rút đồng ý
  const add = market.getByRole('form', { name: 'Thêm hồ sơ con' });
  await add.getByLabel('Tên hiển thị của con').fill('Bé Na');
  await add.getByLabel('Năm sinh').fill(String(new Date().getFullYear() - 12));
  await add.getByLabel('Cấp học').selectOption({ label: 'Trung học cơ sở' });
  await add.getByLabel('Lớp').selectOption({ label: 'Lớp 7' });
  await add
    .getByLabel(`Tôi là cha mẹ hoặc người giám hộ và đồng ý Đồng ý của cha mẹ giả ${suffix} (phiên bản 1)`)
    .check();
  await add.getByRole('button', { name: 'Thêm hồ sơ con' }).click();
  const child = market.getByRole('listitem', { name: 'Hồ sơ Bé Na' });
  await expect(child).toContainText('Đã đồng ý cho hồ sơ con');
  await child.getByRole('button', { name: 'Rút đồng ý cho Bé Na' }).click();
  await expect(child).toContainText('Chưa đồng ý (con chưa học được ở chợ)');
  // Ứng dụng chung (YCTD-368): phụ huynh chỉ thấy bộ màn của phụ huynh
  const parentNavigation = market.getByRole('navigation', { name: 'Điều hướng khu phụ huynh' });
  await expect(parentNavigation.getByRole('button', { name: 'Buổi học của con' })).toBeVisible();
  await expect(market.getByRole('button', { name: 'Hồ sơ và môn dạy' })).toHaveCount(0);
  // Liên kết tới trang của gia sư (#thu-nhap): báo trang dành cho gia sư, mở trang của phụ huynh (CT-1754)
  await market.goto('/?mo-lai=1#thu-nhap');
  await expect(
    market.getByText('Trang bạn mở dành cho tài khoản gia sư. Đã mở trang của tài khoản phụ huynh.'),
  ).toBeVisible();
  await expect(parentNavigation).toBeVisible();
  await expect(market.getByRole('navigation', { name: 'Điều hướng khu gia sư' })).toHaveCount(0);
  await marketContext.close();

  // Ứng dụng chung (YCTD-368): gia sư đăng ký ở chợ, chọn loại tài khoản gia sư, rồi thấy bộ màn của gia sư
  const tutorContext = await browser.newContext({ baseURL: WEB_URL });
  const tutor = await tutorContext.newPage();
  await tutor.goto('/');
  // Ứng dụng chung cài được như ứng dụng Gia sư cũ: trang có manifest của Chợ gia sư, đường dẫn tuyệt đối (vite gắn đường dẫn gốc khi
  // dựng)
  await expect(tutor.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  expect(
    await tutor.evaluate(
      "fetch('/manifest.webmanifest').then((response) => response.json()).then((body) => body.name)",
    ),
  ).toBe('Chợ gia sư');
  await tutor.getByRole('button', { name: 'Đăng ký làm gia sư' }).click();
  const tutorRegister = tutor.getByRole('form', { name: 'Đăng ký tài khoản chợ gia sư' });
  await expect(tutorRegister.getByLabel('Gia sư, kể cả giáo viên dạy kèm ngoài trường')).toBeChecked();
  await tutorRegister.getByLabel('Thư điện tử hoặc số điện thoại').fill(tutorEmail);
  await tutorRegister.getByLabel('Tên hiển thị').fill('Gia sư giả');
  await tutorRegister.getByLabel('Mật khẩu (ít nhất 8 ký tự, có chữ và số)').fill('matkhau123');
  await tutorRegister.getByLabel(`Tôi đồng ý Điều khoản giả ${suffix}`).check();
  await tutorRegister.getByLabel(`Tôi đồng ý Chính sách giả ${suffix}`).check();
  await tutorRegister.getByLabel(`Tôi đồng ý Điều khoản gia sư giả ${suffix}`).check();
  await tutorRegister.getByRole('button', { name: 'Tạo tài khoản' }).click();
  await expect(tutor.getByRole('form', { name: 'Xác nhận tài khoản' })).toBeVisible();
  await setKnownCode(marketplace, tutorEmail, CODE);
  const tutorVerify = tutor.getByRole('form', { name: 'Xác nhận tài khoản' });
  await tutorVerify.getByLabel('Mã xác nhận').fill(CODE);
  await tutorVerify.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(tutor.getByRole('navigation', { name: 'Điều hướng khu phụ huynh' })).toHaveCount(0);
  await tutor
    .getByRole('navigation', { name: 'Điều hướng khu gia sư' })
    .getByRole('button', { name: 'Hồ sơ và môn dạy' })
    .click();
  const tutorProfile = tutor.getByRole('region', { name: 'Hồ sơ gia sư' });
  await tutorProfile.getByLabel('Dòng giới thiệu').fill('Dạy Toán THCS');
  await tutorProfile.getByRole('button', { name: 'Lưu giới thiệu' }).click();
  await expect(tutorProfile.getByText('Đã lưu giới thiệu')).toBeVisible();
  // Liên kết tới trang của phụ huynh (#ho-so-con): báo trang dành cho phụ huynh, không hiện hồ sơ con (CT-1753)
  await tutor.goto('/?mo-lai=1#ho-so-con');
  await expect(
    tutor.getByText('Trang bạn mở dành cho tài khoản phụ huynh. Đã mở trang của tài khoản gia sư.'),
  ).toBeVisible();
  await expect(tutor.getByRole('navigation', { name: 'Điều hướng khu gia sư' })).toBeVisible();
  await expect(tutor.getByRole('form', { name: 'Thêm hồ sơ con' })).toHaveCount(0);
  await tutorContext.close();
});
