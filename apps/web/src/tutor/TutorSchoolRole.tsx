import { useState } from 'react';
import { Alert, Button, FORM_CONTROL_CLASS } from '@cho-gia-su/ui';
import { errorText, marketRequest } from '../client/index.js';
import { minutesText, WEEKDAYS, type Listing } from './tutor-api.js';

// Giáo viên đang dạy ở trường dạy kèm qua chợ (DT-27 phần 27g, YCTD-257; Eric làm rõ ngày 2026-10-28: giáo viên dạy kèm ngoài trường dùng
// ứng dụng Gia sư bằng tài khoản chợ riêng): khai trường, công lập hay không, môn, lớp đang dạy; giáo viên công lập không có môn của chương
// trình phổ thông (Thông tư 29/2024); in báo cáo theo Mẫu 03 gửi Hiệu trưởng trước khi bắt đầu dạy
interface Form03 {
  generated_at: string;
  teacher_name: string;
  school_name: string;
  school_subjects: string;
  school_grades: string;
  tutoring_subjects: Array<{ subject: string; school_level: string; grades: string; content_kind: string }>;
  place: string;
  form: string;
  schedule: Array<{ weekday: number; start_minute: number; end_minute: number }>;
  provider: { kind: string; name: string; business_registration_no: string | null };
  relationship: string;
}

export function TutorSchoolRole({ listing, onChange }: { listing: Listing; onChange: (next: Listing) => void }) {
  const role = listing.school_role;
  const [form, setForm] = useState({
    school_name: role?.school_name ?? '',
    is_public: role?.is_public ?? true,
    subjects: role?.subjects ?? '',
    grades: role?.grades ?? '',
  });
  const [report, setReport] = useState<Form03>();
  const [error, setError] = useState<string>();

  const declare = () =>
    marketRequest<Listing>('PUT', '/tutor/school-role', form)
      .then((next) => {
        setError(undefined);
        onChange(next);
      })
      .catch((caught: unknown) => setError(errorText(caught)));

  return (
    <section
      aria-label="Giáo viên đang dạy ở trường"
      className="rounded-2xl border border-border bg-card flex flex-col gap-3 p-6"
    >
      <h2 className="text-section-title font-semibold">Giáo viên đang dạy ở trường</h2>
      <p className="text-label text-text-secondary">
        Chỉ khai khi bạn đang là giáo viên của một trường. Dạy kèm học sinh của chính trường mình vẫn làm ở ứng dụng
        giáo viên của trường.
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <label className="flex flex-col gap-1 text-label font-medium">
        Tên trường
        <input
          className={FORM_CONTROL_CLASS}
          value={form.school_name}
          onChange={(event) => setForm({ ...form, school_name: event.target.value })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={form.is_public}
          onChange={(event) => setForm({ ...form, is_public: event.target.checked })}
        />{' '}
        Trường công lập
      </label>
      <label className="flex flex-col gap-1 text-label font-medium">
        Môn đang dạy ở trường
        <input
          className={FORM_CONTROL_CLASS}
          value={form.subjects}
          onChange={(event) => setForm({ ...form, subjects: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-label font-medium">
        Lớp đang dạy ở trường
        <input
          className={FORM_CONTROL_CLASS}
          value={form.grades}
          onChange={(event) => setForm({ ...form, grades: event.target.value })}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void declare()}>Lưu khai báo</Button>
        {role ? (
          <Button
            className="text-danger"
            onClick={() =>
              void marketRequest<Listing>('DELETE', '/tutor/school-role')
                .then((next) => {
                  setError(undefined);
                  setReport(undefined);
                  setForm({ school_name: '', is_public: true, subjects: '', grades: '' });
                  onChange(next);
                })
                .catch((caught: unknown) => setError(errorText(caught)))
            }
          >
            Bỏ khai báo
          </Button>
        ) : null}
        {role ? (
          <Button
            onClick={() =>
              void marketRequest<Form03>('GET', '/tutor/form-03')
                .then(setReport)
                .catch((caught: unknown) => setError(errorText(caught)))
            }
          >
            Lập báo cáo Mẫu 03
          </Button>
        ) : null}
      </div>
      {report ? (
        <article
          aria-label="Báo cáo Mẫu 03"
          className="flex flex-col gap-1 rounded-xl border border-border p-4 print:border-0"
        >
          <h3 className="font-semibold">Báo cáo về việc tham gia dạy thêm ngoài nhà trường (Mẫu 03)</h3>
          <p>Kính gửi: Hiệu trưởng {report.school_name}</p>
          <p>Người báo cáo: {report.teacher_name}</p>
          <p>
            Đang dạy ở trường: môn {report.school_subjects}; lớp {report.school_grades}
          </p>
          <p>
            Môn dạy thêm:{' '}
            {report.tutoring_subjects.map((item) => `${item.subject} (khối ${item.grades})`).join('; ') || 'chưa khai'}
          </p>
          <p>
            Địa điểm: {report.place}. Hình thức: {report.form}
          </p>
          <p>
            Thời gian:{' '}
            {report.schedule
              .map(
                (slot) => `${WEEKDAYS[slot.weekday]} ${minutesText(slot.start_minute)}–${minutesText(slot.end_minute)}`,
              )
              .join('; ') || 'chưa khai'}
          </p>
          <p>
            Chủ thể đứng tên: {report.provider.name}; quan hệ: {report.relationship}
          </p>
          <p className="text-text-secondary">Lập lúc {new Date(report.generated_at).toLocaleString('vi-VN')}</p>
          <Button onClick={() => window.print()}>In báo cáo</Button>
        </article>
      ) : null}
    </section>
  );
}
