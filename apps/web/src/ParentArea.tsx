import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, ConfirmDialog, FORM_CONTROL_CLASS, StatusBadge } from '@cho-gia-su/ui';
import { errorText, marketRequest, type Child } from './client/index.js';
import { ChildReadMode, ParentAccount } from './ParentAccount.js';
import { CARD_CLASS, Initials } from './styles.js';

// Khu phụ huynh của chợ gia sư (DT-27 phần 27f): hồ sơ con tối thiểu (tên hiển thị, năm sinh, cấp, lớp), đồng ý của cha mẹ theo phiên bản
// cho từng con, rút đồng ý (bản tách khỏi School Management, YCTD-384, bỏ liên kết với trường). Theo bản thiết kế duyệt ngày 2026-10-28
// (YCTD-360): mỗi con một thẻ, sửa được hồ sơ con (máy chủ đã có PUT), xóa phải xác nhận, có khối thông tin tài khoản
const LEVELS = [
  { value: 'TH', label: 'Tiểu học', grades: [1, 2, 3, 4, 5] },
  { value: 'THCS', label: 'Trung học cơ sở', grades: [6, 7, 8, 9] },
  { value: 'THPT', label: 'Trung học phổ thông', grades: [10, 11, 12] },
] as const;

interface ChildrenView {
  parent_consent: { id: string; version: number; title: string } | null;
  children: Child[];
}

interface ChildFields {
  display_name: string;
  birth_year: string;
  school_level: string;
  grade: string;
}

function ChildFieldsEditor({ value, onChange }: { value: ChildFields; onChange: (next: ChildFields) => void }) {
  const level = LEVELS.find((row) => row.value === value.school_level) ?? LEVELS[1];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-label font-medium">
        Tên hiển thị của con
        <input
          className={FORM_CONTROL_CLASS}
          value={value.display_name}
          onChange={(event) => onChange({ ...value, display_name: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-label font-medium">
        Năm sinh
        <input
          className={FORM_CONTROL_CLASS}
          inputMode="numeric"
          value={value.birth_year}
          onChange={(event) => onChange({ ...value, birth_year: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-label font-medium">
        Cấp học
        <select
          className={FORM_CONTROL_CLASS}
          value={value.school_level}
          onChange={(event) => {
            const next = LEVELS.find((row) => row.value === event.target.value) ?? LEVELS[1];
            onChange({ ...value, school_level: next.value, grade: String(next.grades[0]) });
          }}
        >
          {LEVELS.map((row) => (
            <option key={row.value} value={row.value}>
              {row.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-label font-medium">
        Lớp
        <select
          className={FORM_CONTROL_CLASS}
          value={value.grade}
          onChange={(event) => onChange({ ...value, grade: event.target.value })}
        >
          {level.grades.map((grade) => (
            <option key={grade} value={grade}>
              Lớp {grade}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

const toBody = (fields: ChildFields) => ({
  display_name: fields.display_name,
  birth_year: Number(fields.birth_year),
  school_level: fields.school_level,
  grade: Number(fields.grade),
});

// Đồng ý ghi hình theo gia sư (phòng học video, YCTD-362): một lần cho mọi buổi của một con với một gia sư, rút lại được bất cứ lúc nào;
// rút rồi thì buổi sau với gia sư đó phải đồng ý lại mới vào được phòng
interface RecordingConsent {
  id: string;
  child_name: string;
  tutor_name: string;
  child_confirmed: boolean;
  consented_at: string;
}

function RecordingConsents() {
  const [rows, setRows] = useState<RecordingConsent[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    marketRequest<{ consents: RecordingConsent[] }>('GET', '/recording-consents')
      .then((view) => setRows(view.consents))
      .catch((caught: unknown) => setError(errorText(caught)));
  }, []);
  return (
    <section aria-label="Đồng ý ghi hình" className={`${CARD_CLASS} flex flex-col gap-3 p-6`}>
      <h2 className="text-section-title font-semibold">Đồng ý ghi hình theo gia sư</h2>
      <p className="text-label text-text-secondary">
        Buổi học với trẻ dưới 18 tuổi luôn ghi hình. Rút đồng ý thì buổi sau với gia sư đó phải đồng ý lại mới vào được
        phòng.
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {rows && rows.length === 0 ? <p className="text-text-secondary">Chưa có đồng ý nào.</p> : null}
      <ul className="flex flex-col gap-2">
        {(rows ?? []).map((row) => (
          <li
            key={row.id}
            aria-label={`Đồng ý ghi hình ${row.child_name} với ${row.tutor_name}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3"
          >
            <span className="flex flex-col">
              <strong>
                {row.child_name} với {row.tutor_name}
              </strong>
              <span className="text-label text-text-secondary">
                Đồng ý {new Date(row.consented_at).toLocaleDateString('vi-VN')}
                {row.child_confirmed ? ', con cùng xác nhận' : ''}
              </span>
            </span>
            <Button
              onClick={() =>
                void marketRequest<{ consents: RecordingConsent[] }>('POST', `/recording-consents/${row.id}/withdraw`)
                  .then((view) => setRows(view.consents))
                  .catch((caught: unknown) => setError(errorText(caught)))
              }
            >
              Rút đồng ý
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ParentArea() {
  const [view, setView] = useState<ChildrenView>();
  const [form, setForm] = useState({ display_name: '', birth_year: '', school_level: 'THCS', grade: '6' });
  const [consentChecked, setConsentChecked] = useState(false);
  const [editing, setEditing] = useState<{ id: string; fields: ChildFields }>();
  const [removing, setRemoving] = useState<Child>();
  const [reading, setReading] = useState<string>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    marketRequest<ChildrenView>('GET', '/children')
      .then(setView)
      .catch((caught: unknown) => setError(errorText(caught)));
  }, []);
  useEffect(load, [load]);
  const run = (work: Promise<unknown>) =>
    work
      .then(() => {
        setError(undefined);
        load();
      })
      .catch((caught: unknown) => setError(errorText(caught)));
  const consent = view?.parent_consent;

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Hồ sơ con" className="flex flex-col gap-4">
        <div>
          <h2 className="text-page-title font-bold">Hồ sơ con</h2>
          <p className="text-text-secondary">
            Con không có tài khoản riêng; mọi việc ở chợ đi qua tài khoản của bạn. Chợ chỉ giữ tên hiển thị, năm sinh,
            cấp học và lớp của con; không cần tên thật, không thu số định danh hay ảnh.
          </p>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ul className="flex flex-col gap-3">
          {(view?.children ?? []).map((child) => (
            <li
              key={child.id}
              className={`${CARD_CLASS} flex flex-col gap-4 p-5`}
              aria-label={`Hồ sơ ${child.display_name}`}
            >
              <div className="flex flex-wrap items-center gap-4">
                <Initials name={child.display_name} />
                <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
                  <strong className="text-section-title">
                    {child.display_name} · sinh năm {child.birth_year} · lớp {child.grade}
                  </strong>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge
                      tone={child.consent_current ? 'success' : 'warning'}
                      label={
                        child.consent_current ? 'Đã đồng ý cho hồ sơ con' : 'Chưa đồng ý (con chưa học được ở chợ)'
                      }
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() =>
                      setEditing({
                        id: child.id,
                        fields: {
                          display_name: child.display_name,
                          birth_year: String(child.birth_year),
                          school_level: child.school_level,
                          grade: String(child.grade),
                        },
                      })
                    }
                  >
                    Sửa hồ sơ {child.display_name}
                  </Button>
                  <Button className="text-danger" onClick={() => setRemoving(child)}>
                    Xóa hồ sơ {child.display_name}
                  </Button>
                </div>
              </div>

              {editing?.id === child.id ? (
                <form
                  aria-label={`Sửa hồ sơ ${child.display_name}`}
                  className="flex flex-col gap-3 rounded-xl bg-page p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(
                      marketRequest('PUT', `/children/${child.id}`, toBody(editing.fields)).then(() =>
                        setEditing(undefined),
                      ),
                    );
                  }}
                >
                  <ChildFieldsEditor
                    value={editing.fields}
                    onChange={(fields) => setEditing({ id: child.id, fields })}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" variant="primary">
                      Lưu hồ sơ con
                    </Button>
                    <Button onClick={() => setEditing(undefined)}>Hủy sửa</Button>
                  </div>
                </form>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                {child.consent_current ? (
                  <Button onClick={() => void run(marketRequest('POST', `/children/${child.id}/consent/withdraw`))}>
                    Rút đồng ý cho {child.display_name}
                  </Button>
                ) : consent ? (
                  <Button
                    onClick={() =>
                      void run(
                        marketRequest('POST', `/children/${child.id}/consent`, { consent_document_id: consent.id }),
                      )
                    }
                  >
                    Đồng ý lại cho {child.display_name}
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
                <label className="flex min-w-0 flex-[1_1_280px] items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={child.reads_messages}
                    onChange={(event) =>
                      void run(
                        marketRequest('POST', `/children/${child.id}/reads-messages`, {
                          enabled: event.target.checked,
                        }),
                      )
                    }
                  />
                  <span className="flex flex-col">
                    <span>Con đọc tin nhắn với gia sư khi tôi cho phép</span>
                    <span className="text-label text-text-secondary">
                      Con chỉ đọc trên máy này, không nhắn riêng với gia sư. Thoát phải nhập mật khẩu của bạn.
                    </span>
                  </span>
                </label>
                {child.reads_messages ? (
                  <Button onClick={() => setReading(child.id)}>Mở chế độ con đọc tin nhắn</Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        <form
          aria-label="Thêm hồ sơ con"
          className={`${CARD_CLASS} flex flex-col gap-3 p-6`}
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              marketRequest('POST', '/children', {
                ...toBody(form),
                ...(consentChecked && consent ? { consent_document_id: consent.id } : {}),
              }).then(() => {
                setForm({ ...form, display_name: '', birth_year: '' });
                setConsentChecked(false);
              }),
            );
          }}
        >
          <h3 className="text-section-title font-semibold">Thêm hồ sơ con</h3>
          <ChildFieldsEditor value={form} onChange={setForm} />
          {consent ? (
            <label className="flex items-start gap-2 text-label">
              <input
                type="checkbox"
                className="mt-1"
                checked={consentChecked}
                onChange={(event) => setConsentChecked(event.target.checked)}
              />
              <span>
                Tôi là cha mẹ hoặc người giám hộ và đồng ý {consent.title} (phiên bản {consent.version})
              </span>
            </label>
          ) : (
            <Alert tone="warning">Chợ chưa đăng văn bản đồng ý của cha mẹ.</Alert>
          )}
          <div>
            <Button type="submit" variant="primary">
              Thêm hồ sơ con
            </Button>
          </div>
        </form>
      </section>

      <RecordingConsents />
      <ParentAccount />
      {reading ? <ChildReadMode childId={reading} onExit={() => setReading(undefined)} /> : null}

      <ConfirmDialog
        open={Boolean(removing)}
        title={`Xóa hồ sơ của ${removing?.display_name ?? ''}?`}
        confirmLabel="Xóa hồ sơ con"
        onCancel={() => setRemoving(undefined)}
        onConfirm={() => {
          const child = removing;
          setRemoving(undefined);
          if (child) void run(marketRequest('DELETE', `/children/${child.id}`));
        }}
      >
        Hồ sơ con bị xóa khỏi chợ. Không hoàn tác được.
      </ConfirmDialog>
    </div>
  );
}
