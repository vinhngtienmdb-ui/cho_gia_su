import { useCallback, useEffect, useState } from 'react';
import { errorText, marketRequest, REPORT_CATEGORY_LABELS, REPORT_DECISION_LABELS } from '../client/index.js';
import { Alert, Button, FORM_CONTROL_CLASS } from '@cho-gia-su/ui';

// Tình trạng an toàn của gia sư (DT-27 phần 27i, YCTD-259): đang bị tạm khóa hay không (khi khóa: không hiện công khai, không nhận đặt
// buổi, không nhắn tin, buổi sắp tới đã hủy và hoàn tiền cho phụ huynh, chưa giải ngân), các quyết định kiểm duyệt về mình, kháng nghị
// một lần trong 7 ngày
interface SafetyView {
  suspension: { reason: string; started_at: string } | null;
  reports: Array<{
    id: string;
    category: string;
    status: string;
    decision: string | null;
    decision_note: string | null;
    final_decision: string | null;
    final_note: string | null;
    can_appeal: boolean;
  }>;
}

// alwaysShow: trang An toàn, kiểm duyệt luôn hiện khối này (kể cả khi chưa có gì); trang Buổi dạy chỉ hiện khi có tạm khóa hoặc báo cáo
export function TutorSafety({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const [view, setView] = useState<SafetyView>();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    marketRequest<SafetyView>('GET', '/tutor/safety')
      .then(setView)
      .catch((caught: unknown) => setError(errorText(caught)));
  }, []);
  useEffect(load, [load]);
  if (!view) return error ? <Alert tone="danger">{error}</Alert> : null;
  if (!alwaysShow && !view.suspension && view.reports.length === 0) return null;
  return (
    <section
      aria-label="Kiểm duyệt và an toàn"
      className="rounded-2xl border border-border bg-card flex flex-col gap-3 p-6"
    >
      <h2 className="text-section-title font-semibold">Kiểm duyệt và an toàn</h2>
      {!view.suspension && view.reports.length === 0 ? (
        <p className="text-text-secondary">Không có báo cáo nào về bạn, tài khoản không bị tạm khóa.</p>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {view.suspension ? (
        <Alert tone="danger">
          Tài khoản đang tạm khóa từ {new Date(view.suspension.started_at).toLocaleString('vi-VN')}:{' '}
          {view.suspension.reason}. Hồ sơ không hiện công khai, không nhận đặt buổi, không nhắn tin; các buổi sắp tới đã
          được hủy và hoàn tiền cho phụ huynh; tiền chưa giải ngân được giữ đến khi có quyết định.
        </Alert>
      ) : null}
      <ul className="flex flex-col gap-2">
        {view.reports.map((report) => (
          <li key={report.id} className="flex flex-col gap-1 rounded-xl border border-border p-3">
            <span>
              Báo cáo {REPORT_CATEGORY_LABELS[report.category] ?? report.category}: quyết định{' '}
              {REPORT_DECISION_LABELS[report.final_decision ?? report.decision ?? ''] ?? 'đang xét'}
              {(report.final_note ?? report.decision_note) ? ` – ${report.final_note ?? report.decision_note}` : ''}
              {report.status === 'appealed' ? ' (đang xét kháng nghị)' : ''}
            </span>
            {report.can_appeal ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-label font-medium">
                  Lý do kháng nghị
                  <input
                    className={FORM_CONTROL_CLASS}
                    value={reasons[report.id] ?? ''}
                    onChange={(event) => setReasons({ ...reasons, [report.id]: event.target.value })}
                  />
                </label>
                <Button
                  onClick={() =>
                    void marketRequest('POST', `/reports/${report.id}/appeal`, { reason: reasons[report.id] ?? '' })
                      .then(() => {
                        setError(undefined);
                        load();
                      })
                      .catch((caught: unknown) => setError(errorText(caught)))
                  }
                >
                  Kháng nghị
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
