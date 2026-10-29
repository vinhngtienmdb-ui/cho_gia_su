import { useState } from 'react';
import { Alert, Button, FORM_CONTROL_CLASS, StatusBadge } from '@cho-gia-su/ui';
import { errorText, marketRequest } from '../client/index.js';
import {
  LISTING_STATUS_LABELS,
  minutesText,
  parseTime,
  WEEKDAYS,
  type Listing,
  type Slot,
  type Subject,
} from './tutor-api.js';

// Hồ sơ dạy của gia sư (DT-27 phần 27g, YCTD-257): môn theo cấp và khối, loại nội dung, giá mỗi buổi, thời lượng, lịch trống theo tuần,
// ngôn ngữ dạy; gửi nền tảng duyệt. Sửa hồ sơ đã duyệt thì hồ sơ về chờ duyệt
const LEVEL_GRADES = { TH: [1, 5], THCS: [6, 9], THPT: [10, 12] } as const;
const EMPTY_SUBJECT: Subject = {
  subject: '',
  school_level: 'THCS',
  grade_from: 6,
  grade_to: 9,
  content_kind: 'enrichment',
  price_per_session: 150_000,
  session_minutes: 60,
  package_sessions: null,
  package_price: null,
};

export function TutorListing({ listing, onChange }: { listing: Listing; onChange: (next: Listing) => void }) {
  const [language, setLanguage] = useState(listing.teaching_language);
  const [subjects, setSubjects] = useState<Subject[]>(listing.subjects);
  const [slots, setSlots] = useState<Slot[]>(listing.availability);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  const save = () =>
    marketRequest<Listing>('PUT', '/tutor/listing', { teaching_language: language, subjects, availability: slots })
      .then((next) => {
        setError(undefined);
        setMessage('Đã lưu hồ sơ dạy');
        onChange(next);
      })
      .catch((caught: unknown) => setError(errorText(caught)));

  const submit = () =>
    marketRequest<Listing>('POST', '/tutor/listing/submit')
      .then((next) => {
        setError(undefined);
        setMessage('Đã gửi hồ sơ cho nền tảng duyệt');
        onChange(next);
      })
      .catch((caught: unknown) => setError(errorText(caught)));

  const updateSubject = (index: number, patch: Partial<Subject>) =>
    setSubjects(subjects.map((item, position) => (position === index ? { ...item, ...patch } : item)));
  const updateSlot = (index: number, patch: Partial<Slot>) =>
    setSlots(slots.map((item, position) => (position === index ? { ...item, ...patch } : item)));

  return (
    <section
      id="ho-so-day"
      aria-label="Hồ sơ dạy"
      className="rounded-2xl border border-border bg-card flex flex-col gap-4 p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section-title font-semibold">Hồ sơ dạy</h2>
        <StatusBadge
          tone={listing.status === 'approved' ? 'success' : listing.status === 'rejected' ? 'danger' : 'warning'}
          label={LISTING_STATUS_LABELS[listing.status]}
        />
      </div>
      {listing.review_note ? <p>Ghi chú của nền tảng: {listing.review_note}</p> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}
      <label className="flex flex-col gap-1 text-label font-medium">
        Ngôn ngữ dạy
        <input className={FORM_CONTROL_CLASS} value={language} onChange={(event) => setLanguage(event.target.value)} />
      </label>
      <h3 className="font-semibold">Môn dạy</h3>
      {subjects.map((item, index) => {
        const grades = LEVEL_GRADES[item.school_level];
        const options = Array.from({ length: grades[1] - grades[0] + 1 }, (_, offset) => grades[0] + offset);
        return (
          <fieldset
            key={index}
            aria-label={`Môn ${index + 1}`}
            className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-page p-3"
          >
            <label className="flex flex-col gap-1 text-label font-medium">
              Tên môn
              <input
                className={FORM_CONTROL_CLASS}
                value={item.subject}
                onChange={(event) => updateSubject(index, { subject: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-label font-medium">
              Cấp
              <select
                className={FORM_CONTROL_CLASS}
                value={item.school_level}
                onChange={(event) => {
                  const level = event.target.value as Subject['school_level'];
                  updateSubject(index, {
                    school_level: level,
                    grade_from: LEVEL_GRADES[level][0],
                    grade_to: LEVEL_GRADES[level][1],
                  });
                }}
              >
                <option value="TH">Tiểu học</option>
                <option value="THCS">Trung học cơ sở</option>
                <option value="THPT">Trung học phổ thông</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-label font-medium">
              Từ lớp
              <select
                className={FORM_CONTROL_CLASS}
                value={item.grade_from}
                onChange={(event) => updateSubject(index, { grade_from: Number(event.target.value) })}
              >
                {options.map((grade) => (
                  <option key={grade} value={grade}>
                    {grade}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-label font-medium">
              Đến lớp
              <select
                className={FORM_CONTROL_CLASS}
                value={item.grade_to}
                onChange={(event) => updateSubject(index, { grade_to: Number(event.target.value) })}
              >
                {options.map((grade) => (
                  <option key={grade} value={grade}>
                    {grade}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-label font-medium">
              Loại nội dung
              <select
                className={FORM_CONTROL_CLASS}
                value={item.content_kind}
                onChange={(event) =>
                  updateSubject(index, { content_kind: event.target.value as Subject['content_kind'] })
                }
              >
                <option value="enrichment">Năng khiếu, kỹ năng, ngoại ngữ tăng cường</option>
                <option value="curriculum">Môn của chương trình phổ thông</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-label font-medium">
              Giá mỗi buổi (đồng)
              <input
                className={FORM_CONTROL_CLASS}
                type="number"
                min={0}
                step={1000}
                value={item.price_per_session}
                onChange={(event) => updateSubject(index, { price_per_session: Number(event.target.value) })}
              />
            </label>
            <label className="flex flex-col gap-1 text-label font-medium">
              Thời lượng (phút)
              <input
                className={FORM_CONTROL_CLASS}
                type="number"
                min={30}
                max={180}
                step={15}
                value={item.session_minutes}
                onChange={(event) => updateSubject(index, { session_minutes: Number(event.target.value) })}
              />
            </label>
            <label className="flex flex-col gap-1 text-label font-medium">
              Số buổi của gói (trống: không bán gói)
              <input
                className={FORM_CONTROL_CLASS}
                type="number"
                min={2}
                max={50}
                value={item.package_sessions ?? ''}
                onChange={(event) =>
                  updateSubject(index, {
                    package_sessions: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-label font-medium">
              Giá cả gói (đồng)
              <input
                className={FORM_CONTROL_CLASS}
                type="number"
                min={0}
                step={1000}
                value={item.package_price ?? ''}
                onChange={(event) =>
                  updateSubject(index, { package_price: event.target.value === '' ? null : Number(event.target.value) })
                }
              />
            </label>
            <Button onClick={() => setSubjects(subjects.filter((_, position) => position !== index))}>Bỏ môn</Button>
          </fieldset>
        );
      })}
      <Button onClick={() => setSubjects([...subjects, EMPTY_SUBJECT])}>Thêm môn</Button>
      <h3 className="font-semibold">Giờ trống mỗi tuần (giờ Việt Nam)</h3>
      {slots.map((slot, index) => (
        <fieldset
          key={index}
          aria-label={`Khung giờ ${index + 1}`}
          className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-page p-3"
        >
          <label className="flex flex-col gap-1 text-label font-medium">
            Thứ
            <select
              className={FORM_CONTROL_CLASS}
              value={slot.weekday}
              onChange={(event) => updateSlot(index, { weekday: Number(event.target.value) })}
            >
              {WEEKDAYS.slice(1).map((label, offset) => (
                <option key={label} value={offset + 1}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-label font-medium">
            Từ
            <input
              className={FORM_CONTROL_CLASS}
              type="time"
              value={minutesText(slot.start_minute)}
              onChange={(event) => updateSlot(index, { start_minute: parseTime(event.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1 text-label font-medium">
            Đến
            <input
              className={FORM_CONTROL_CLASS}
              type="time"
              value={minutesText(slot.end_minute)}
              onChange={(event) => updateSlot(index, { end_minute: parseTime(event.target.value) })}
            />
          </label>
          <Button onClick={() => setSlots(slots.filter((_, position) => position !== index))}>Bỏ khung giờ</Button>
        </fieldset>
      ))}
      <Button onClick={() => setSlots([...slots, { weekday: 2, start_minute: 18 * 60, end_minute: 20 * 60 }])}>
        Thêm khung giờ
      </Button>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void save()}>
          Lưu hồ sơ dạy
        </Button>
        {listing.status === 'draft' || listing.status === 'rejected' ? (
          <Button onClick={() => void submit()} disabled={listing.submit_blockers.length > 0}>
            Gửi nền tảng duyệt
          </Button>
        ) : null}
      </div>
      {listing.submit_blockers.length > 0 && (listing.status === 'draft' || listing.status === 'rejected') ? (
        <ul aria-label="Cần làm trước khi gửi duyệt" className="list-disc pl-5 text-label text-text-secondary">
          {listing.submit_blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
