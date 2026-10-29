import {
  ADMIN_URL,
  adminToken,
  createAdminAccount,
  marketCall,
  openMarketDatabase,
  publishDocuments,
  registerAccount,
  seedApprovedTutor,
  setKnownCode,
  signInAdmin,
  useMarketSession,
  WEB_URL,
  type MarketDatabase,
} from './cho-gia-su.js';
import { expect, test } from './fixtures.js';

// DT-27 phần 27h (YCTD-258, spec 197): phụ huynh ở Chợ gia sư đặt buổi với gia sư đã duyệt, thanh toán giả lập; gia sư đánh dấu đã dạy ở
// khu gia sư (ứng dụng chung, YCTD-368); phụ huynh mở tranh chấp; quản trị quyết định hoàn đủ ở ứng dụng quản trị, chốt; phụ huynh thấy
// đã hoàn tiền. Gia sư đã duyệt dựng thẳng trong cơ sở dữ liệu chợ (luồng duyệt ở spec 196). Không có tiền thật
const suffix = Math.random().toString(36).slice(2, 8);
const parentEmail = `phu-huynh-dat-${suffix}@example.test`;
const tutorEmail = `gia-su-dat-${suffix}@example.test`;
const tutorName = `Gia sư Lan ${suffix}`;
const subjectName = `Cờ tướng ${suffix}`;
const CODE = '864201';

let marketplace: MarketDatabase;
let tutorToken = '';

test.beforeAll(async () => {
  marketplace = openMarketDatabase();
  const token = await adminToken(await createAdminAccount(marketplace, 'Quản trị thanh toán giả'));
  const documents = await publishDocuments(token, ['terms', 'privacy', 'parent_consent', 'tutor_terms'], suffix);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  expect(
    (
      await marketCall('POST', '/admin/payments/commission-rules', token, {
        percent: 10,
        minimum: 0,
        effective_from: today,
      })
    ).status,
  ).toBe(200);

  // Gia sư: đăng ký ở Chợ gia sư (ứng dụng chung, YCTD-368), rồi dựng hồ sơ đã duyệt thẳng trong cơ sở dữ liệu chợ
  tutorToken = await registerAccount(
    marketplace,
    'tutor',
    tutorEmail,
    tutorName,
    [documents.terms ?? '', documents.privacy ?? '', documents.tutor_terms ?? ''],
    CODE,
  );
  await seedApprovedTutor(marketplace, tutorEmail, {
    name: subjectName,
    schoolLevel: 'THCS',
    gradeFrom: 6,
    gradeTo: 9,
  });
});

test.afterAll(async () => {
  await marketplace?.destroy();
});

test('CT-27h-7: đặt buổi, thanh toán giả lập, gia sư đánh dấu đã dạy, phụ huynh khiếu nại, quản trị hoàn đủ', async ({
  browser,
}) => {
  // Phụ huynh đăng ký, tạo hồ sơ con
  const marketContext = await browser.newContext({ baseURL: WEB_URL });
  const market = await marketContext.newPage();
  await market.goto('/');
  await market.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  const register = market.getByRole('form', { name: 'Đăng ký tài khoản chợ gia sư' });
  await register.getByLabel('Thư điện tử hoặc số điện thoại').fill(parentEmail);
  await register.getByLabel('Tên hiển thị').fill('Phụ huynh đặt buổi');
  await register.getByLabel('Mật khẩu (ít nhất 8 ký tự, có chữ và số)').fill('matkhau123');
  await register.getByLabel(`Tôi đồng ý Văn bản terms ${suffix}`).check();
  await register.getByLabel(`Tôi đồng ý Văn bản privacy ${suffix}`).check();
  await register.getByRole('button', { name: 'Tạo tài khoản' }).click();
  await expect(market.getByRole('form', { name: 'Xác nhận tài khoản' })).toBeVisible();
  await setKnownCode(marketplace, parentEmail, CODE);
  const verify = market.getByRole('form', { name: 'Xác nhận tài khoản' });
  await verify.getByLabel('Mã xác nhận').fill(CODE);
  await verify.getByRole('button', { name: 'Xác nhận' }).click();
  const add = market.getByRole('form', { name: 'Thêm hồ sơ con' });
  await add.getByLabel('Tên hiển thị của con').fill('Bé Minh');
  await add.getByLabel('Năm sinh').fill(String(new Date().getFullYear() - 12));
  await add.getByLabel('Cấp học').selectOption({ label: 'Trung học cơ sở' });
  await add.getByLabel('Lớp').selectOption({ label: 'Lớp 7' });
  // Spec khác đã đăng văn bản đồng ý trước nên không giả định số phiên bản
  await add.getByLabel(new RegExp(`đồng ý Văn bản parent_consent ${suffix} \\(phiên bản \\d+\\)`)).check();
  await add.getByRole('button', { name: 'Thêm hồ sơ con' }).click();
  await expect(market.getByRole('listitem', { name: 'Hồ sơ Bé Minh' })).toContainText('Đã đồng ý cho hồ sơ con');

  // Tìm gia sư, đặt buổi 3 ngày tới lúc 18:00 giờ Việt Nam (khu phụ huynh chia trang theo thanh điều hướng, YCTD-360)
  await market
    .getByRole('navigation', { name: 'Điều hướng khu phụ huynh' })
    .getByRole('button', { name: 'Tìm gia sư' })
    .click();
  const search = market.getByRole('form', { name: 'Lọc gia sư' });
  await search.getByLabel('Môn').fill(subjectName);
  await search.getByRole('button', { name: 'Tìm' }).click();
  await market
    .getByRole('listitem', { name: `Gia sư ${tutorName}` })
    .getByRole('button', { name: `Xem gia sư ${tutorName}` })
    .click();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(
    new Date(Date.now() + 3 * 24 * 3_600_000),
  );
  const booking = market.getByRole('form', { name: `Đặt buổi với ${tutorName}` });
  await booking.getByLabel('Giờ học (giờ Việt Nam)').fill(`${day}T18:00`);
  // Buổi với trẻ dưới 18 tuổi phải đồng ý ghi hình (27i)
  await booking.getByLabel(/Tôi đồng ý buổi học được ghi hình/).check();
  await booking.getByRole('button', { name: 'Giữ chỗ buổi học' }).click();
  await expect(booking).toContainText('Đã giữ chỗ buổi');
  await market
    .getByRole('navigation', { name: 'Điều hướng khu phụ huynh' })
    .getByRole('button', { name: 'Buổi học của con' })
    .click();
  const lessons = market.getByRole('region', { name: 'Buổi học của con' });
  await lessons.getByRole('button', { name: 'Tải lại' }).click();
  const lesson = lessons.getByRole('listitem').filter({ hasText: subjectName });
  await expect(lesson).toContainText('Đang giữ chỗ, chờ trả tiền');
  await lesson.getByRole('button', { name: 'Thanh toán giả lập' }).click();
  await expect(lesson).toContainText('Đây là thanh toán giả lập');
  await lesson.getByRole('button', { name: 'Giả lập: đã trả thành công' }).click();
  await expect(lesson).toContainText('Đã trả tiền');

  // Giả lập buổi đã diễn ra: dời giờ học về 2 giờ trước
  const row = await marketplace
    .selectFrom('market_bookings')
    .select('id')
    .where('subject', '=', subjectName)
    .executeTakeFirstOrThrow();
  await marketplace
    .updateTable('market_bookings')
    .set({ starts_at: new Date(Date.now() - 2 * 3_600_000) })
    .where('id', '=', row.id)
    .execute();

  // Gia sư đánh dấu đã dạy ở khu gia sư (phiên đặt sẵn vào bộ nhớ của thẻ)
  const tutorContext = await browser.newContext({ baseURL: WEB_URL });
  await useMarketSession(tutorContext, tutorToken);
  const tutor = await tutorContext.newPage();
  await tutor.goto('/');
  const taught = tutor
    .getByRole('region', { name: 'Buổi dạy', exact: true })
    .getByRole('listitem')
    .filter({ hasText: subjectName });
  await taught.getByRole('button', { name: 'Đánh dấu đã dạy' }).click();
  await expect(taught).toContainText('Đã dạy, chờ hết hạn khiếu nại');
  await tutorContext.close();

  // Phụ huynh khiếu nại trong hạn
  await lessons.getByRole('button', { name: 'Tải lại' }).click();
  await lesson.getByLabel('Lý do khiếu nại').fill('Buổi học chỉ 20 phút');
  await lesson.getByRole('button', { name: 'Mở tranh chấp' }).click();
  await expect(lesson).toContainText('Đang tranh chấp');

  // Kế toán của chợ quyết định hoàn đủ, chốt
  const adminContext = await browser.newContext({ baseURL: ADMIN_URL });
  const adminPage = await adminContext.newPage();
  await signInAdmin(adminPage, await createAdminAccount(marketplace, 'Kế toán chợ giả', 'ke_toan'));
  await adminPage
    .getByRole('navigation', { name: 'Trang quản trị' })
    .getByRole('button', { name: 'Chợ gia sư' })
    .click();
  const payments = adminPage.getByRole('region', { name: 'Buổi học và thanh toán của chợ' });
  await payments.getByRole('button', { name: `Xem tranh chấp ${subjectName}` }).click();
  const dispute = payments.getByRole('region', { name: `Tranh chấp buổi ${subjectName}` });
  await expect(dispute).toContainText('Buổi học chỉ 20 phút');
  const decision = dispute.getByRole('form', { name: 'Quyết định tranh chấp' });
  await decision.getByLabel('Quyết định', { exact: true }).selectOption({ label: 'Hoàn đủ cho phụ huynh' });
  await decision.getByLabel('Lý do quyết định').fill('Buổi học thiếu giờ');
  await decision.getByRole('button', { name: 'Ghi quyết định' }).click();
  await expect(dispute).toContainText('đã quyết định');
  await dispute.getByRole('button', { name: 'Chốt quyết định và chuyển tiền' }).click();
  await expect(dispute).toContainText('đã chốt');
  await adminContext.close();

  await lessons.getByRole('button', { name: 'Tải lại' }).click();
  await expect(lesson).toContainText('Đã hoàn tiền');
  await expect(lesson).toContainText('đã hoàn 150.000 đồng');
  await marketContext.close();
});
