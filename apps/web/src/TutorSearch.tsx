import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, FORM_CONTROL_CLASS } from '@cho-gia-su/ui';
import { errorText, marketRequest, MessageThread, readSession, ReportForm } from './client/index.js';
import { BookingForm, type BookableSubject } from './ParentBookings.js';
import { CARD_CLASS, Initials, money } from './styles.js';

// Tìm gia sư và trang công khai của gia sư theo Mẫu 02 (DT-27 phần 27g, YCTD-257): chỉ gia sư đã duyệt, đã xác minh danh tính và lý lịch
// tư pháp; không có số điện thoại, địa chỉ của gia sư. Đặt buổi là của 27h. Bố cục theo bản thiết kế duyệt ngày 2026-10-28 (YCTD-360):
// khối tìm ở đầu trang, bộ lọc bên trái (loại nội dung, giá, ngày trống, huy hiệu, sắp xếp), thẻ gia sư bên phải; trang gia sư hai cột,
// thẻ đặt buổi bên phải
const LEVEL_LABELS: Record<string, string> = { TH: 'Tiểu học', THCS: 'Trung học cơ sở', THPT: 'Trung học phổ thông' };
const KIND_LABELS: Record<string, string> = {
  curriculum: 'Môn của chương trình phổ thông',
  enrichment: 'Năng khiếu, kỹ năng, ngoại ngữ tăng cường',
};
const WEEKDAYS = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];
const BADGE_LABELS: Record<string, string> = {
  identity: 'Đã xác minh danh tính',
  degree: 'Đã xác minh bằng cấp',
  criminal_record: 'Đã xác minh lý lịch tư pháp',
  business_registration: 'Có đăng ký kinh doanh',
  school_teacher: 'Giáo viên đang dạy ở trường',
};

interface SubjectRow {
  subject: string;
  school_level: string;
  grade_from: number;
  grade_to: number;
  content_kind: string;
  price_per_session: number;
  package_sessions?: number | null;
}

interface TutorCard {
  rating?: { average: number | null; count: number };
  id: string;
  display_name: string;
  headline: string;
  teaching_language: string;
  min_price: number;
  subjects: SubjectRow[];
  badges: Record<string, boolean>;
}

interface TutorPage {
  subjects: BookableSubject[];
  id: string;
  display_name: string;
  headline: string;
  bio: string;
  teaching_language: string;
  badges: Record<string, boolean>;
  form02: {
    provider_name: string;
    provider_kind: string;
    business_registration_no: string | null;
    place: string;
    form: string;
    teachers: string[];
    subjects: Array<{
      subject: string;
      school_level: string;
      grades: string;
      content_kind: string;
      session_minutes: number;
      price_per_session: number;
    }>;
    schedule: Array<{ weekday: number; start_minute: number; end_minute: number }>;
  };
}

const time = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

function Badges({ badges }: { badges: Record<string, boolean> }) {
  return (
    <ul className="flex flex-wrap gap-1.5 text-label" aria-label="Huy hiệu xác minh">
      {Object.entries(BADGE_LABELS)
        .filter(([key]) => badges[key])
        .map(([key, label]) => (
          <li
            key={key}
            className={`rounded-full px-2.5 py-0.5 font-medium ${
              key === 'school_teacher' ? 'bg-selected text-brand-strong' : 'bg-success/10 text-success'
            }`}
          >
            {label}
          </li>
        ))}
    </ul>
  );
}

// Điểm đánh giá đã duyệt (YCTD-364): trung bình trên 5 và số đánh giá
function Stars({ rating }: { rating?: { average: number | null; count: number } }) {
  if (!rating || rating.count === 0 || rating.average === null) {
    return <span className="text-label text-text-secondary">Chưa có đánh giá</span>;
  }
  return (
    <span className="text-label font-semibold text-warning">
      <span aria-hidden="true">★ </span>
      {rating.average.toLocaleString('vi-VN')} trên 5 · {rating.count} đánh giá
    </span>
  );
}

interface ReviewsView {
  summary: {
    count: number;
    average: number | null;
    punctuality: number | null;
    clarity: number | null;
    progress: number | null;
    communication: number | null;
  };
  reviews: Array<{
    id: string;
    grade: number;
    rating: number;
    body: string;
    reply_body: string | null;
    created_at: string;
  }>;
}

const CRITERIA_LABELS = {
  punctuality: 'Đúng giờ',
  clarity: 'Giảng dễ hiểu',
  progress: 'Con tiến bộ',
  communication: 'Trao đổi với phụ huynh',
} as const;

// Đánh giá của phụ huynh đã học, đã được nhân viên nền tảng duyệt; gia sư trả lời một lần (YCTD-364)
function TutorReviews({ tutorId, tutorName }: { tutorId: string; tutorName: string }) {
  const [view, setView] = useState<ReviewsView>();
  const [reporting, setReporting] = useState<string>();
  useEffect(() => {
    marketRequest<ReviewsView>('GET', `/public/reviews/${tutorId}`)
      .then(setView)
      .catch(() => setView(undefined));
  }, [tutorId]);
  if (!view) return null;
  return (
    <section aria-label="Đánh giá của phụ huynh" className={`${CARD_CLASS} flex flex-col gap-4 p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-section-title font-semibold">Đánh giá của phụ huynh đã học</h3>
        <span className="text-label text-text-secondary">
          Chỉ phụ huynh có buổi đã học mới đánh giá được; đánh giá được duyệt trước khi hiện.
        </span>
      </div>
      {view.summary.count === 0 ? (
        <p className="text-text-secondary">Chưa có đánh giá.</p>
      ) : (
        <div className="flex flex-wrap gap-6">
          <div className="flex flex-col">
            <strong className="text-page-title">{view.summary.average?.toLocaleString('vi-VN')}</strong>
            <span className="text-label text-text-secondary">trên 5 · {view.summary.count} đánh giá</span>
          </div>
          <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-1 text-label">
            {(Object.keys(CRITERIA_LABELS) as Array<keyof typeof CRITERIA_LABELS>).map((key) =>
              view.summary[key] === null ? null : (
                <div key={key} className="flex gap-2">
                  <dt>{CRITERIA_LABELS[key]}:</dt>
                  <dd className="font-semibold">{view.summary[key]?.toLocaleString('vi-VN')}</dd>
                </div>
              ),
            )}
          </dl>
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {view.reviews.map((review) => (
          <li key={review.id} className="flex flex-col gap-1 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-3">
              <strong>Phụ huynh học sinh lớp {review.grade}</strong>
              <span className="font-semibold text-warning">{review.rating} sao</span>
              <span className="text-label text-text-secondary">
                {new Date(review.created_at).toLocaleDateString('vi-VN')}
              </span>
            </div>
            {review.body ? <p className="whitespace-pre-wrap">{review.body}</p> : null}
            {review.reply_body ? (
              <div className="ml-4 flex flex-col rounded-xl bg-page p-3">
                <span className="text-label font-semibold">Gia sư trả lời</span>
                <span className="whitespace-pre-wrap">{review.reply_body}</span>
              </div>
            ) : null}
            {readSession() ? (
              reporting === review.id ? (
                <ReportForm subjectId={tutorId} subjectName={tutorName} targetKind="review" targetId={review.id} />
              ) : (
                <Button variant="text" className="self-start text-danger" onClick={() => setReporting(review.id)}>
                  Báo cáo đánh giá này
                </Button>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Giờ trống mỗi tuần dạng lưới bảy ngày (giờ Việt Nam)
function WeeklySchedule({ schedule }: { schedule: TutorPage['form02']['schedule'] }) {
  return (
    <section aria-label="Giờ trống hằng tuần" className={`${CARD_CLASS} flex flex-col gap-3 p-5`}>
      <h3 className="text-section-title font-semibold">Giờ trống hằng tuần</h3>
      {schedule.length === 0 ? <p className="text-text-secondary">Gia sư chưa khai giờ trống.</p> : null}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {WEEKDAYS.slice(1).map((label, index) => {
          const slots = schedule.filter((slot) => slot.weekday === index + 1);
          return (
            <li key={label} className="flex flex-col gap-1">
              <strong className="text-label">{label}</strong>
              {slots.length === 0 ? (
                <span className="rounded-md bg-page px-2 py-1 text-label text-text-muted">Không nhận</span>
              ) : (
                slots.map((slot) => (
                  <span
                    key={slot.start_minute}
                    className="rounded-md border border-dashed border-success/50 bg-success/10 px-2 py-1 text-label text-success"
                  >
                    {time(slot.start_minute)}–{time(slot.end_minute)}
                  </span>
                ))
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-label text-text-secondary">Giờ Việt Nam. Chọn giờ học ở thẻ Đặt buổi.</p>
    </section>
  );
}

function TutorDetail({ id, onBack, onBooked }: { id: string; onBack: () => void; onBooked?: () => void }) {
  const [page, setPage] = useState<TutorPage>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    marketRequest<TutorPage>('GET', `/public/tutors/${id}`)
      .then(setPage)
      .catch((caught: unknown) => setError(errorText(caught)));
  }, [id]);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!page) return <p>Đang tải…</p>;
  const form = page.form02;
  return (
    <article aria-label={`Gia sư ${page.display_name}`} className="flex flex-col gap-4">
      <div>
        <Button variant="text" onClick={onBack}>
          Quay lại danh sách
        </Button>
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          <section className={`${CARD_CLASS} flex flex-wrap items-start gap-5 p-6`}>
            <Initials name={page.display_name} size="lg" />
            <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-2">
              <h2 className="text-page-title font-bold">{page.display_name}</h2>
              <p className="text-text-secondary">{page.headline}</p>
              <Badges badges={page.badges} />
              <p className="whitespace-pre-wrap">{page.bio}</p>
            </div>
          </section>
          <section aria-label="Thông tin công khai theo Mẫu 02" className={`${CARD_CLASS} flex flex-col gap-3 p-5`}>
            <h3 className="text-section-title font-semibold">Thông tin công khai của cơ sở dạy thêm (Mẫu 02)</h3>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
              <dt className="text-text-secondary">Người hoặc cơ sở đứng tên</dt>
              <dd>
                {form.provider_name} ({form.provider_kind === 'organization' ? 'tổ chức' : 'cá nhân'})
                {form.business_registration_no ? `, đăng ký kinh doanh số ${form.business_registration_no}` : ''}
              </dd>
              <dt className="text-text-secondary">Địa điểm, hình thức</dt>
              <dd>
                {form.place}. {form.form}. Ngôn ngữ dạy: {page.teaching_language}
              </dd>
              <dt className="text-text-secondary">Người dạy</dt>
              <dd>{form.teachers.join(', ')}</dd>
              <dt className="text-text-secondary">Thời gian</dt>
              <dd>
                {form.schedule
                  .map((slot) => `${WEEKDAYS[slot.weekday]} ${time(slot.start_minute)}–${time(slot.end_minute)}`)
                  .join('; ')}
              </dd>
            </dl>
            <div className="overflow-x-auto">
              <table aria-label="Môn, thời lượng, mức thu" className="w-full min-w-[36rem] text-label">
                <thead>
                  <tr className="border-b border-border text-left text-text-secondary">
                    <th className="py-2 pr-2 font-semibold">Môn</th>
                    <th className="py-2 pr-2 font-semibold">Khối lớp</th>
                    <th className="py-2 pr-2 font-semibold">Loại nội dung</th>
                    <th className="py-2 pr-2 font-semibold">Thời lượng</th>
                    <th className="py-2 font-semibold">Mức thu mỗi buổi</th>
                  </tr>
                </thead>
                <tbody>
                  {form.subjects.map((item, index) => (
                    <tr key={index} className="border-b border-border last:border-0">
                      <td className="py-2 pr-2 font-medium">{item.subject}</td>
                      <td className="py-2 pr-2">
                        {LEVEL_LABELS[item.school_level]} {item.grades}
                      </td>
                      <td className="py-2 pr-2">{KIND_LABELS[item.content_kind]}</td>
                      <td className="py-2 pr-2">{item.session_minutes} phút</td>
                      <td className="py-2">{money(item.price_per_session)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <WeeklySchedule schedule={form.schedule} />
          <TutorReviews tutorId={page.id} tutorName={page.display_name} />
        </div>
        <aside className="flex w-full max-w-sm flex-[1_1_300px] flex-col gap-4">
          <BookingForm
            tutorId={page.id}
            tutorName={page.display_name}
            subjects={page.subjects}
            schoolTeacher={Boolean(page.badges.school_teacher)}
            onBooked={onBooked}
          />
          <TutorContact tutorId={page.id} tutorName={page.display_name} />
          <section className={`${CARD_CLASS} flex flex-col gap-2 p-5 text-label`}>
            <strong className="text-content">An toàn khi học</strong>
            <span>Buổi học với trẻ dưới 18 tuổi luôn được ghi hình.</span>
            <span>Gia sư không nhắn riêng cho con: mọi tin nhắn đều có phụ huynh.</span>
          </section>
        </aside>
      </div>
    </article>
  );
}

// Nhắn tin và báo cáo hồ sơ gia sư (27i): chỉ phụ huynh đã đăng nhập; tin nhắn luôn giữa phụ huynh và gia sư
function TutorContact({ tutorId, tutorName }: { tutorId: string; tutorName: string }) {
  const [thread, setThread] = useState<string>();
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState<string>();
  if (!readSession()) return null;
  return (
    <section aria-label={`Liên hệ ${tutorName}`} className="flex flex-col gap-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() =>
            void marketRequest<{ id: string }>('POST', '/messages/threads', { tutor_id: tutorId })
              .then((result) => {
                setError(undefined);
                setThread(result.id);
              })
              .catch((caught: unknown) => setError(errorText(caught)))
          }
        >
          Nhắn tin cho gia sư
        </Button>
        <Button variant="text" className="text-danger" onClick={() => setReporting(true)}>
          Báo cáo hồ sơ
        </Button>
      </div>
      {thread ? <MessageThread id={thread} role="parent" /> : null}
      {reporting ? <ReportForm subjectId={tutorId} subjectName={tutorName} targetKind="profile" /> : null}
    </section>
  );
}

const EMPTY_FILTERS = {
  subject: '',
  school_level: '',
  grade: '',
  weekday: '',
  content_kind: '',
  max_price: '',
  sort: 'price_asc',
};

export function TutorSearch({ onBooked }: { onBooked?: () => void }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  // Lọc theo huy hiệu làm ở trình duyệt trên danh sách máy chủ trả về
  const [requiredBadges, setRequiredBadges] = useState<string[]>([]);
  const [tutors, setTutors] = useState<TutorCard[]>();
  const [open, setOpen] = useState<string>();
  const [error, setError] = useState<string>();
  const search = useCallback((current: typeof EMPTY_FILTERS) => {
    const query = new URLSearchParams(Object.entries(current).filter(([, value]) => value !== ''));
    marketRequest<{ tutors: TutorCard[] }>('GET', `/public/tutors?${query.toString()}`)
      .then((result) => {
        setError(undefined);
        setTutors(result.tutors);
      })
      .catch((caught: unknown) => setError(errorText(caught)));
  }, []);
  useEffect(() => search(EMPTY_FILTERS), [search]);
  const apply = (next: typeof EMPTY_FILTERS) => {
    setFilters(next);
    search(next);
  };

  if (open) return <TutorDetail id={open} onBack={() => setOpen(undefined)} onBooked={onBooked} />;
  const shown = (tutors ?? []).filter((tutor) => requiredBadges.every((badge) => tutor.badges[badge]));
  return (
    <section aria-label="Tìm gia sư" className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-2xl bg-warning/5 p-6">
        <div className="flex max-w-3xl flex-col gap-1">
          <h2 className="text-page-title font-bold text-brand-strong">Tìm gia sư cho con</h2>
          <p className="text-text-secondary">
            Gia sư đã được nền tảng xác minh danh tính và lý lịch tư pháp. Mọi buổi học với trẻ dưới 18 tuổi được ghi
            hình, phụ huynh vào xem lúc nào cũng được.
          </p>
        </div>
        <form
          aria-label="Lọc gia sư"
          className={`${CARD_CLASS} grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]`}
          onSubmit={(event) => {
            event.preventDefault();
            search(filters);
          }}
        >
          <label className="flex flex-col gap-1 text-label font-medium">
            Môn
            <input
              className={FORM_CONTROL_CLASS}
              value={filters.subject}
              onChange={(event) => setFilters({ ...filters, subject: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-label font-medium">
            Cấp
            <select
              className={FORM_CONTROL_CLASS}
              value={filters.school_level}
              onChange={(event) => setFilters({ ...filters, school_level: event.target.value })}
            >
              <option value="">Mọi cấp</option>
              {Object.entries(LEVEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-label font-medium">
            Lớp
            <input
              className={FORM_CONTROL_CLASS}
              type="number"
              min={1}
              max={12}
              value={filters.grade}
              onChange={(event) => setFilters({ ...filters, grade: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-label font-medium">
            Ngày trống
            <select
              className={FORM_CONTROL_CLASS}
              value={filters.weekday}
              onChange={(event) => setFilters({ ...filters, weekday: event.target.value })}
            >
              <option value="">Mọi ngày</option>
              {WEEKDAYS.slice(1).map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="primary" className="min-h-11">
            Tìm
          </Button>
        </form>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <aside
          aria-label="Bộ lọc thêm"
          className={`${CARD_CLASS} flex w-full max-w-xs flex-[1_1_240px] flex-col gap-4 p-5`}
        >
          <h3 className="font-semibold">Lọc thêm</h3>
          <label className="flex flex-col gap-1 text-label font-medium">
            Loại nội dung
            <select
              className={FORM_CONTROL_CLASS}
              value={filters.content_kind}
              onChange={(event) => apply({ ...filters, content_kind: event.target.value })}
            >
              <option value="">Mọi loại</option>
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-label font-medium">
            Giá tối đa mỗi buổi
            <input
              className={FORM_CONTROL_CLASS}
              type="number"
              min={0}
              step={10000}
              value={filters.max_price}
              onChange={(event) => setFilters({ ...filters, max_price: event.target.value })}
              onBlur={() => search(filters)}
            />
          </label>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-label font-semibold">Huy hiệu xác minh</legend>
            {Object.entries(BADGE_LABELS).map(([key, label]) => (
              <label key={key} className="flex min-h-9 items-center gap-2 text-label">
                <input
                  type="checkbox"
                  checked={requiredBadges.includes(key)}
                  onChange={(event) =>
                    setRequiredBadges(
                      event.target.checked ? [...requiredBadges, key] : requiredBadges.filter((item) => item !== key),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <Button
            onClick={() => {
              setRequiredBadges([]);
              apply(EMPTY_FILTERS);
            }}
          >
            Xóa bộ lọc
          </Button>
        </aside>

        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-section-title font-semibold">
              {tutors ? `${shown.length} gia sư phù hợp` : 'Đang tải danh sách gia sư'}
            </h3>
            <label className="flex items-center gap-2 text-label font-medium">
              Sắp xếp
              <select
                className={FORM_CONTROL_CLASS}
                value={filters.sort}
                onChange={(event) => apply({ ...filters, sort: event.target.value })}
              >
                <option value="price_asc">Giá thấp trước</option>
                <option value="price_desc">Giá cao trước</option>
                <option value="newest">Mới duyệt</option>
                <option value="rating_desc">Đánh giá cao trước</option>
              </select>
            </label>
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {tutors && shown.length === 0 ? <p className="text-text-secondary">Chưa có gia sư phù hợp.</p> : null}
          <ul className="flex flex-col gap-3" aria-label="Danh sách gia sư">
            {shown.map((tutor) => (
              <li
                key={tutor.id}
                aria-label={`Gia sư ${tutor.display_name}`}
                className={`${CARD_CLASS} flex flex-wrap gap-5 p-5`}
              >
                <Initials name={tutor.display_name} />
                <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
                  <strong className="text-section-title">{tutor.display_name}</strong>
                  <span className="text-text-secondary">{tutor.headline}</span>
                  <span className="text-label">
                    {tutor.subjects
                      .map(
                        (item) =>
                          `${item.subject} (${LEVEL_LABELS[item.school_level]} ${item.grade_from}–${item.grade_to})`,
                      )
                      .join('; ')}
                  </span>
                  <Stars rating={tutor.rating} />
                  <Badges badges={tutor.badges} />
                </div>
                <div className="flex flex-[0_1_220px] flex-col gap-2">
                  <span className="flex flex-col">
                    <strong className="text-section-title">Từ {money(tutor.min_price)}</strong>
                    <span className="text-label text-text-secondary">mỗi buổi</span>
                  </span>
                  {tutor.subjects.some((item) => item.package_sessions) ? (
                    <span className="text-label font-medium text-brand-strong">Có giá theo gói buổi</span>
                  ) : null}
                  <Button variant="primary" onClick={() => setOpen(tutor.id)}>
                    Xem gia sư {tutor.display_name}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
