import {
  adminToken,
  createAdminAccount,
  marketCall,
  openMarketDatabase,
  publishDocuments,
  registerAccount,
  seedApprovedTutor,
  useMarketSession,
  WEB_URL,
  type MarketDatabase,
} from './cho-gia-su.js';
import { expect, test } from './fixtures.js';

// DT-27 phần 27j (YCTD-362, spec 199): phòng học video của chợ gia sư với bộ giả lập lớp video. Phụ huynh vào phòng chờ trước khi gia sư
// mở phòng; gia sư mở phòng dạy, thấy học sinh trong phòng chờ, cho vào; phụ huynh thấy lớp video; gia sư kết thúc phòng; hai phía thấy
// điểm danh tự động. Học sinh đủ 18 tuổi nên buổi không bắt buộc ghi hình (đồng ý ghi hình theo gia sư và ghi hình bắt buộc có kiểm thử
// máy chủ CT-27i-5, CT-27j-2). Gia sư, hồ sơ con, buổi đã trả tiền dựng qua API và cơ sở dữ liệu chợ. Dữ liệu giả, không có tiền thật
const suffix = Math.random().toString(36).slice(2, 8);
const parentEmail = `phu-huynh-phong-${suffix}@example.test`;
const tutorEmail = `gia-su-phong-${suffix}@example.test`;
const tutorName = `Gia sư Lan ${suffix}`;
const childName = `Bé Khoa ${suffix}`;
const subjectName = `Đàn ${suffix}`;
const CODE = '640213';

let marketplace: MarketDatabase;
let tutorToken = '';
let parentToken = '';

test.beforeAll(async () => {
  marketplace = openMarketDatabase();
  const token = await adminToken(await createAdminAccount(marketplace, 'Quản trị đăng văn bản giả'));
  const documents = await publishDocuments(token, ['terms', 'privacy', 'parent_consent', 'tutor_terms'], suffix);

  // Gia sư đã duyệt dựng thẳng trong cơ sở dữ liệu chợ
  tutorToken = await registerAccount(
    marketplace,
    'tutor',
    tutorEmail,
    tutorName,
    [documents.terms ?? '', documents.privacy ?? '', documents.tutor_terms ?? ''],
    CODE,
  );
  const { tutorId, subjectId } = await seedApprovedTutor(marketplace, tutorEmail, {
    name: subjectName,
    schoolLevel: 'THPT',
    gradeFrom: 10,
    gradeTo: 12,
  });

  // Phụ huynh, hồ sơ con đủ 18 tuổi, buổi đã trả tiền giả lập rồi dời giờ học về 2 phút trước
  parentToken = await registerAccount(
    marketplace,
    'parent',
    parentEmail,
    'Phụ huynh phòng học',
    [documents.terms ?? '', documents.privacy ?? ''],
    CODE,
  );
  const child = await marketCall('POST', '/children', parentToken, {
    display_name: childName,
    birth_year: new Date().getFullYear() - 19,
    school_level: 'THPT',
    grade: 12,
    consent_document_id: documents.parent_consent,
  });
  expect(child.status, JSON.stringify(child.body)).toBe(201);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(
    new Date(Date.now() + 3 * 24 * 3_600_000),
  );
  const booking = await marketCall('POST', '/bookings', parentToken, {
    tutor_id: tutorId,
    child_id: child.body.id,
    subject_id: subjectId,
    starts_at: new Date(`${day}T18:00:00+07:00`).toISOString(),
    no_assignment_attested: false,
    recording_consented: false,
  });
  expect(booking.status, JSON.stringify(booking.body)).toBe(201);
  const bookingId = booking.body.id as string;
  expect((await marketCall('POST', `/bookings/${bookingId}/mock-pay`, parentToken, {})).status).toBe(200);
  await marketplace
    .updateTable('market_bookings')
    .set({ starts_at: new Date(Date.now() - 2 * 60_000) })
    .where('id', '=', bookingId)
    .execute();
});

test.afterAll(async () => {
  await marketplace?.destroy();
});

test('CT-27j-3: phòng chờ, gia sư cho vào, lớp video giả lập, kết thúc buổi có điểm danh hai phía', async ({
  browser,
}) => {
  const marketContext = await browser.newContext({ baseURL: WEB_URL });
  await useMarketSession(marketContext, parentToken);
  const market = await marketContext.newPage();
  await market.goto('/#buoi-hoc');
  const lesson = market
    .getByRole('region', { name: 'Buổi học của con' })
    .getByRole('listitem')
    .filter({ hasText: subjectName });
  await lesson.getByRole('button', { name: 'Vào phòng học' }).click();
  const parentRoom = market.getByRole('region', { name: 'Phòng học' });
  await expect(parentRoom.getByRole('list', { name: 'Điều kiện vào phòng' })).toContainText('Buổi đã trả tiền');
  await parentRoom.getByRole('button', { name: 'Vào phòng chờ' }).click();
  await expect(parentRoom).toContainText('Gia sư chưa mở phòng');

  // Gia sư mở phòng dạy, cho học sinh vào
  const tutorContext = await browser.newContext({ baseURL: WEB_URL });
  await useMarketSession(tutorContext, tutorToken);
  const tutor = await tutorContext.newPage();
  await tutor.goto('/#buoi-day');
  await tutor
    .getByRole('region', { name: 'Buổi dạy', exact: true })
    .getByRole('listitem')
    .filter({ hasText: subjectName })
    .getByRole('button', { name: 'Mở phòng học' })
    .click();
  const teaching = tutor.getByRole('region', { name: 'Phòng dạy' });
  await teaching.getByRole('button', { name: 'Mở phòng dạy' }).click();
  const host = teaching.getByRole('region', { name: 'Điều khiển phòng' });
  await expect(host).toContainText('đang chờ', { timeout: 15_000 });
  await host.getByRole('button', { name: `Cho ${childName} vào` }).click();

  // Phụ huynh (con học trên máy này) thấy lớp video giả lập
  await expect(parentRoom.getByText('Phòng giả lập')).toBeVisible({ timeout: 15_000 });

  // Gia sư kết thúc phòng: điểm danh tự động ở hai phía
  await host.getByRole('button', { name: 'Kết thúc phòng' }).click();
  await expect(teaching.getByRole('table', { name: 'Điểm danh tự động' })).toContainText(childName);
  await parentRoom.getByRole('button', { name: 'Rời phòng' }).first().click();
  await expect(parentRoom).toContainText('Buổi học đã kết thúc');
  await expect(parentRoom.getByRole('table', { name: 'Điểm danh tự động' })).toContainText(tutorName);
  await tutorContext.close();
  await marketContext.close();
});
