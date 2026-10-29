import {
  ADMIN_URL,
  adminToken,
  createAdminAccount,
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

// DT-27 phần 27i (YCTD-259, spec 198): phụ huynh nhắn tin cho gia sư (số điện thoại bị che, có cảnh báo), đặt buổi có đồng ý ghi hình,
// trả tiền giả lập, báo cáo mức nghiêm trọng; gia sư bị tạm khóa ngay; gia sư thấy tạm khóa ở khu gia sư; nhân viên hỗ trợ thấy chỉ số,
// chữ gốc của tin nhắn, ghi quyết định tạm khóa có lý do thì buổi mới được hoàn đủ (YCTD-322). Gia sư đã duyệt dựng thẳng trong cơ sở
// dữ liệu chợ. Dữ liệu giả, không có tiền thật
const suffix = Math.random().toString(36).slice(2, 8);
const parentEmail = `phu-huynh-an-toan-${suffix}@example.test`;
const tutorEmail = `gia-su-an-toan-${suffix}@example.test`;
const tutorName = `Gia sư Hòa ${suffix}`;
const subjectName = `Vẽ ${suffix}`;
const CODE = '531902';

let marketplace: MarketDatabase;
let tutorToken = '';

test.beforeAll(async () => {
  marketplace = openMarketDatabase();
  const token = await adminToken(await createAdminAccount(marketplace, 'Quản trị đăng văn bản giả'));
  const documents = await publishDocuments(token, ['terms', 'privacy', 'parent_consent', 'tutor_terms'], suffix);

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

test('CT-27i-6: tin nhắn bị che, báo cáo nghiêm trọng tạm khóa gia sư, quản trị xem bằng chứng và quyết định', async ({
  browser,
}) => {
  // Phụ huynh đăng ký, tạo hồ sơ con
  const marketContext = await browser.newContext({ baseURL: WEB_URL });
  const market = await marketContext.newPage();
  await market.goto('/');
  await market.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  const register = market.getByRole('form', { name: 'Đăng ký tài khoản chợ gia sư' });
  await register.getByLabel('Thư điện tử hoặc số điện thoại').fill(parentEmail);
  await register.getByLabel('Tên hiển thị').fill('Phụ huynh an toàn');
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
  await add.getByLabel('Tên hiển thị của con').fill('Bé An');
  await add.getByLabel('Năm sinh').fill(String(new Date().getFullYear() - 12));
  await add.getByLabel('Cấp học').selectOption({ label: 'Trung học cơ sở' });
  await add.getByLabel('Lớp').selectOption({ label: 'Lớp 7' });
  await add.getByLabel(new RegExp(`đồng ý Văn bản parent_consent ${suffix} \\(phiên bản \\d+\\)`)).check();
  await add.getByRole('button', { name: 'Thêm hồ sơ con' }).click();
  await expect(market.getByRole('listitem', { name: 'Hồ sơ Bé An' })).toContainText('Đã đồng ý cho hồ sơ con');
  await market
    .getByRole('navigation', { name: 'Điều hướng khu phụ huynh' })
    .getByRole('button', { name: 'An toàn' })
    .click();
  await expect(market.getByRole('region', { name: 'Chính sách an toàn trẻ em' }).first()).toContainText('111');
  await expect(market.getByRole('region', { name: 'Báo cáo tôi đã gửi' })).toContainText('Bạn chưa gửi báo cáo nào');

  // Mở trang gia sư: nhắn tin có số điện thoại thì bị che và có cảnh báo
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
  await market.getByRole('button', { name: 'Nhắn tin cho gia sư' }).click();
  const thread = market.getByRole('region', { name: `Tin nhắn với ${tutorName}` });
  await thread.getByLabel('Nội dung').fill('Thầy gọi em số 0912 345 678 nhé');
  await thread.getByRole('button', { name: 'Gửi tin nhắn' }).click();
  await expect(thread).toContainText('đã bị che');
  await expect(thread.getByRole('list', { name: 'Các tin nhắn' })).not.toContainText('0912');

  // Đặt buổi (đồng ý ghi hình), trả tiền giả lập
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(
    new Date(Date.now() + 3 * 24 * 3_600_000),
  );
  const booking = market.getByRole('form', { name: `Đặt buổi với ${tutorName}` });
  await booking.getByLabel('Giờ học (giờ Việt Nam)').fill(`${day}T19:00`);
  await booking.getByRole('button', { name: 'Giữ chỗ buổi học' }).click();
  await expect(booking).toContainText('đồng ý ghi hình');
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
  await lesson.getByRole('button', { name: 'Thanh toán giả lập' }).click();
  await lesson.getByRole('button', { name: 'Giả lập: đã trả thành công' }).click();
  await expect(lesson).toContainText('Đã trả tiền');
  await expect(lesson).toContainText('Buổi học được ghi hình để bảo vệ trẻ');

  // Báo cáo mức nghiêm trọng của phụ huynh đã trả tiền: gia sư bị tạm khóa ngay; buổi chờ nhân viên xác nhận mới hủy
  await lesson.getByRole('button', { name: 'Báo cáo vi phạm' }).click();
  const report = lesson.getByRole('form', { name: `Báo cáo vi phạm ${tutorName}` });
  await expect(report).toContainText('111');
  await report.getByLabel('Loại vi phạm').selectOption({ label: 'An toàn trẻ em' });
  await report.getByLabel('Mức độ').selectOption({ label: 'Nghiêm trọng (xử lý trong 4 giờ)' });
  await report.getByLabel('Mô tả sự việc').fill('Gia sư rủ con gặp riêng ngoài giờ');
  await report.getByRole('button', { name: 'Gửi báo cáo' }).click();
  await expect(report).toContainText('Gia sư đã bị tạm khóa');
  await lessons.getByRole('button', { name: 'Tải lại' }).click();
  await expect(lesson).toContainText('Đã trả tiền');

  // Gia sư thấy tài khoản đang tạm khóa
  const tutorContext = await browser.newContext({ baseURL: WEB_URL });
  await useMarketSession(tutorContext, tutorToken);
  const tutor = await tutorContext.newPage();
  await tutor.goto('/');
  await tutor
    .getByRole('navigation', { name: 'Điều hướng khu gia sư' })
    .getByRole('button', { name: 'An toàn, kiểm duyệt' })
    .click();
  await expect(tutor.getByRole('region', { name: 'Kiểm duyệt và an toàn' })).toContainText('Tài khoản đang tạm khóa');
  await tutorContext.close();

  // Nhân viên hỗ trợ của chợ: chỉ số, bằng chứng (chữ gốc), quyết định có lý do
  const adminContext = await browser.newContext({ baseURL: ADMIN_URL });
  const adminPage = await adminContext.newPage();
  await signInAdmin(adminPage, await createAdminAccount(marketplace, 'Nhân viên kiểm duyệt giả', 'ho_tro'));
  await adminPage
    .getByRole('navigation', { name: 'Trang quản trị' })
    .getByRole('button', { name: 'Chợ gia sư' })
    .click();
  const safety = adminPage.getByRole('region', { name: 'Kiểm duyệt và an toàn trẻ em của chợ' });
  await expect(safety.getByRole('list', { name: 'Gia sư đang tạm khóa' })).toContainText(tutorName);
  await safety.getByRole('button', { name: `Xem báo cáo về ${tutorName}` }).click();
  const review = safety.getByRole('region', { name: `Báo cáo về ${tutorName}` });
  await expect(review).toContainText('Gia sư rủ con gặp riêng ngoài giờ');
  await expect(review.getByRole('list', { name: 'Bằng chứng tin nhắn' })).toContainText('0912 345 678');
  const decision = review.getByRole('form', { name: 'Quyết định báo cáo' });
  await decision.getByLabel('Quyết định', { exact: true }).selectOption({ label: 'Tạm khóa' });
  await decision.getByLabel('Lý do quyết định').fill('Vi phạm an toàn trẻ em, giữ tạm khóa');
  await decision.getByRole('button', { name: 'Ghi quyết định' }).click();
  await expect(review).toContainText('đã quyết định');
  await expect(review.getByRole('list', { name: 'Nhật ký kiểm duyệt' })).toContainText('report.decide');
  await adminContext.close();
  // Nhân viên quyết định tạm khóa: buổi sắp tới được hủy, hoàn đủ
  await lessons.getByRole('button', { name: 'Tải lại' }).click();
  await expect(lesson).toContainText('Đã hoàn tiền');
  // Phụ huynh theo dõi báo cáo đã gửi ở trang An toàn (YCTD-360)
  await market
    .getByRole('navigation', { name: 'Điều hướng khu phụ huynh' })
    .getByRole('button', { name: 'An toàn' })
    .click();
  await expect(market.getByRole('listitem', { name: `Báo cáo về ${tutorName}` })).toContainText('Đã quyết định');
  await marketContext.close();
});
