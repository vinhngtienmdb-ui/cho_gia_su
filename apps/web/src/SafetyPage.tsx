import { useEffect, useState } from 'react';
import { Alert, StatusBadge, type StatusTone } from '@cho-gia-su/ui';
import {
  ChildSafetyPolicy,
  errorText,
  marketRequest,
  REPORT_CATEGORY_LABELS,
  REPORT_DECISION_LABELS,
  REPORT_SEVERITY_LABELS,
  SAFETY_HOTLINE,
} from './client/index.js';
import { CARD_CLASS, when } from './styles.js';

// Trang an toàn của phụ huynh (YCTD-360, thiết kế duyệt ngày 2026-10-28; bổ sung việc T-M8 của rà soát giao diện): đường dây nóng, báo
// cáo vi phạm phụ huynh đã gửi kèm trạng thái và quyết định (máy chủ đã có GET /market/reports từ 27i), chính sách an toàn trẻ em. Gửi báo
// cáo mới làm ở hồ sơ gia sư, tin nhắn, buổi học, nơi có đối tượng bị báo cáo
interface MyReport {
  id: string;
  category: string;
  severity: string;
  status: string;
  decision: string | null;
  decision_note: string | null;
  final_decision: string | null;
  decided_at: string | null;
  created_at: string;
  subject_name: string;
}

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: 'Đang xử lý', tone: 'warning' },
  decided: { label: 'Đã quyết định', tone: 'success' },
  appealed: { label: 'Đang xem lại theo kháng nghị', tone: 'warning' },
  final: { label: 'Đã chốt', tone: 'neutral' },
};

export function SafetyPage() {
  const [reports, setReports] = useState<MyReport[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    marketRequest<{ reports: MyReport[] }>('GET', '/reports')
      .then((view) => setReports(view.reports))
      .catch((caught: unknown) => setError(errorText(caught)));
  }, []);
  return (
    <div className="flex flex-col gap-5">
      <p role="note" className="rounded-2xl bg-danger px-5 py-4 font-semibold text-white">
        {SAFETY_HOTLINE}
      </p>
      <div className="flex flex-wrap items-start gap-6">
        <section
          aria-label="Báo cáo tôi đã gửi"
          className={`${CARD_CLASS} flex min-w-0 flex-[3_1_480px] flex-col gap-3 p-6`}
        >
          <h2 className="text-section-title font-semibold">Báo cáo tôi đã gửi</h2>
          <p className="text-label text-text-secondary">
            Gửi báo cáo mới bằng nút "Báo cáo" ở hồ sơ gia sư, tin nhắn hoặc buổi học. Người bị báo cáo không biết ai
            báo cáo.
          </p>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {reports && reports.length === 0 ? <p className="text-text-secondary">Bạn chưa gửi báo cáo nào.</p> : null}
          <ul className="flex flex-col gap-3">
            {(reports ?? []).map((report) => {
              const status = STATUS[report.status];
              const decision = report.final_decision ?? report.decision;
              return (
                <li
                  key={report.id}
                  aria-label={`Báo cáo về ${report.subject_name}`}
                  className="flex flex-col gap-1 rounded-xl border border-border p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{report.subject_name}</strong>
                    <StatusBadge tone={status?.tone ?? 'neutral'} label={status?.label ?? report.status} />
                  </div>
                  <span className="text-label text-text-secondary">
                    {REPORT_CATEGORY_LABELS[report.category] ?? report.category} · mức{' '}
                    {(REPORT_SEVERITY_LABELS[report.severity] ?? report.severity).toLowerCase()} · gửi{' '}
                    {when(report.created_at)}
                  </span>
                  {decision ? (
                    <span>
                      Kết quả: {REPORT_DECISION_LABELS[decision] ?? decision}
                      {report.decision_note ? ` – ${report.decision_note}` : ''}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
        <div className="flex min-w-0 flex-[2_1_320px] flex-col">
          <ChildSafetyPolicy />
        </div>
      </div>
    </div>
  );
}
