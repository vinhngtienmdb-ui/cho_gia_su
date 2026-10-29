import { useCallback, useEffect, useState } from 'react';
import { UpdateBanner } from '@cho-gia-su/pwa';
import { Alert, Button } from '@cho-gia-su/ui';
import { ChildSafetyPolicy, MarketShell, marketRequest, MessageInbox, type Child, type Me } from './client/index.js';
import { IdentityLogin, useIdentityReturn } from './ParentAccount.js';
import { ParentArea } from './ParentArea.js';
import { ParentBookings } from './ParentBookings.js';
import { SafetyPage } from './SafetyPage.js';
import { TutorSearch } from './TutorSearch.js';
import { TUTOR_PAGES, TutorHome, type TutorPage } from './tutor/TutorHome.js';

// Chợ gia sư (DT-27 phần 27f, YCTD-256; tài liệu 47 mục 19.5): trang công khai, đăng ký, đăng nhập, rồi khu riêng theo loại tài khoản.
// Từ YCTD-368 (GD-185) là ứng dụng chung của phụ huynh và gia sư (gộp ứng dụng Gia sư của YCTD-262): phụ huynh thấy tìm gia sư, buổi học
// của con, tin nhắn, hồ sơ con, an toàn (thanh điều hướng ở đầu trang, YCTD-360); gia sư, kể cả giáo viên dạy kèm ngoài trường, thấy
// buổi dạy, lịch, hồ sơ, thu nhập, xác minh (cột điều hướng bên trái, YCTD-361). Ẩn ở giao diện chỉ để gọn: máy chủ kiểm loại tài khoản
// ở từng điểm cuối. Trang đang mở ghi ở phần # của địa chỉ để tải lại vẫn đúng trang
const PARENT_PAGES = [
  { key: 'tim-gia-su', label: 'Tìm gia sư' },
  { key: 'buoi-hoc', label: 'Buổi học của con' },
  { key: 'tin-nhan', label: 'Tin nhắn' },
  { key: 'ho-so-con', label: 'Hồ sơ con' },
  { key: 'an-toan', label: 'An toàn' },
] as const;
type ParentPage = (typeof PARENT_PAGES)[number]['key'];

function pagesOf(kind: Me['kind']): ReadonlyArray<{ key: string; label: string }> {
  return kind === 'tutor' ? TUTOR_PAGES : PARENT_PAGES;
}

function pageFromHash(): string | null {
  return window.location.hash.replace(/^#/, '') || null;
}

// Mở khu phụ huynh: chưa có hồ sơ con thì vào thẳng trang Hồ sơ con để thêm con trước khi tìm gia sư
function ParentHome({ page, onPage }: { page: ParentPage | null; onPage: (next: ParentPage) => void }) {
  useEffect(() => {
    if (page) return;
    marketRequest<{ children: Child[] }>('GET', '/children')
      .then((view) => onPage(view.children.length === 0 ? 'ho-so-con' : 'tim-gia-su'))
      .catch(() => onPage('tim-gia-su'));
  }, [page, onPage]);
  if (page === 'tim-gia-su') return <TutorSearch onBooked={() => onPage('buoi-hoc')} />;
  if (page === 'buoi-hoc') return <ParentBookings />;
  if (page === 'tin-nhan') return <MessageInbox role="parent" />;
  if (page === 'ho-so-con') return <ParentArea />;
  if (page === 'an-toan') return <SafetyPage />;
  return null;
}

// Địa chỉ mở ra trỏ tới trang của vai kia (ví dụ liên kết gia sư gửi phụ huynh): báo một lần lúc vào khu riêng, ứng dụng mở trang mặc
// định của vai mình (bản mẫu MH-593, MH-594 trạng thái "không có quyền", YCTD-368)
function ForeignPageNotice({ me, page }: { me: Me; page: string | null }) {
  const [foreign] = useState(
    () =>
      page !== null &&
      !pagesOf(me.kind).some((row) => row.key === page) &&
      pagesOf(me.kind === 'tutor' ? 'parent' : 'tutor').some((row) => row.key === page),
  );
  if (!foreign) return null;
  return (
    <Alert tone="warning">
      {me.kind === 'tutor'
        ? 'Trang bạn mở dành cho tài khoản phụ huynh. Đã mở trang của tài khoản gia sư.'
        : 'Trang bạn mở dành cho tài khoản gia sư. Đã mở trang của tài khoản phụ huynh.'}
    </Alert>
  );
}

function RoleNavigation({ me, page, onPage }: { me: Me; page: string | null; onPage: (next: string) => void }) {
  const side = me.kind === 'tutor';
  return (
    <nav
      aria-label={side ? 'Điều hướng khu gia sư' : 'Điều hướng khu phụ huynh'}
      className={side ? 'flex flex-col gap-1' : 'flex gap-1 overflow-x-auto'}
    >
      {pagesOf(me.kind).map((row) => (
        <button
          key={row.key}
          type="button"
          aria-current={page === row.key ? 'page' : undefined}
          className={`min-h-11 rounded-lg px-3 font-medium ${side ? 'text-left' : 'shrink-0 whitespace-nowrap'} ${
            page === row.key ? 'bg-selected text-brand-strong' : 'text-text hover:bg-page'
          }`}
          onClick={() => onPage(row.key)}
        >
          {row.label}
        </button>
      ))}
    </nav>
  );
}

export function MarketApplication() {
  const identityReturn = useIdentityReturn();
  const [page, setPage] = useState<string | null>(pageFromHash);
  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const open = useCallback((next: string) => {
    setPage(next);
    window.history.replaceState(null, '', `#${next}`);
  }, []);
  // Trang ở địa chỉ không thuộc bộ màn của loại tài khoản (ví dụ liên kết của vai kia) thì như chưa chọn trang
  const pageFor = (me: Me) => (pagesOf(me.kind).some((row) => row.key === page) ? page : null);
  if (identityReturn.pending) {
    return <p className="p-4">Đang hoàn tất đăng nhập bằng định danh…</p>;
  }
  return (
    <>
      <UpdateBanner />
      {identityReturn.message ? <Alert tone="success">{identityReturn.message}</Alert> : null}
      {identityReturn.error ? <Alert tone="danger">{identityReturn.error}</Alert> : null}
      <MarketShell
        title="Chợ gia sư"
        loginExtras={<IdentityLogin />}
        navigationPlacement={(me) => (me.kind === 'tutor' ? 'side' : 'top')}
        navigation={(me) => <RoleNavigation me={me} page={pageFor(me)} onPage={open} />}
        intro={(_site, register) => (
          <section aria-label="Giới thiệu" className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-warning/5 p-4">
              <p className="min-w-0 flex-1 text-text-secondary">
                Bạn là gia sư hoặc giáo viên muốn dạy kèm trực tuyến? Gia sư được xác minh danh tính và lý lịch trước
                khi nhận học sinh; mọi tin nhắn với học sinh luôn có phụ huynh.
              </p>
              <Button onClick={() => register('tutor')}>Đăng ký làm gia sư</Button>
            </div>
            <TutorSearch />
            <ChildSafetyPolicy />
          </section>
        )}
      >
        {(me) => (
          <>
            <ForeignPageNotice me={me} page={page} />
            {me.kind === 'tutor' ? (
              <TutorHome page={pageFor(me) as TutorPage | null} onPage={open} />
            ) : (
              <ParentHome page={pageFor(me) as ParentPage | null} onPage={open} />
            )}
          </>
        )}
      </MarketShell>
    </>
  );
}
