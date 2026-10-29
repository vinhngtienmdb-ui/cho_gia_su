import { useCallback, useEffect, useState } from 'react';
import { ChildSafetyPolicy, errorText, marketRequest, MessageInbox } from '../client/index.js';
import { Alert } from '@cho-gia-su/ui';
import { TutorArea } from './TutorArea.js';
import { TutorBookings, TutorEarnings } from './TutorBookings.js';
import { TutorListing } from './TutorListing.js';
import { TutorAccount, TutorReviews } from './TutorReviews.js';
import { TutorSafety } from './TutorSafety.js';
import { TutorSchedule } from './TutorSchedule.js';
import { TutorSchoolRole } from './TutorSchoolRole.js';
import { TutorVerification } from './TutorVerification.js';
import type { Listing } from './tutor-api.js';

// Khu gia sư của Chợ gia sư (DT-27, YCTD-262; quyết định của Eric ngày 2026-10-28 "làm thêm ứng dụng cho gia sư"; giáo viên dạy kèm
// ngoài trường cũng dùng bằng tài khoản chợ riêng): giới thiệu và cơ sở dạy thêm (27f), xác minh từng bậc, hồ sơ dạy, khai giáo viên
// đang dạy ở trường, Mẫu 03 (27g). Lịch dạy, buổi, thu nhập (27h); báo cáo an toàn (27i). Từ YCTD-361 chia trang theo cột điều hướng
// bên trái, trang đang mở ghi ở phần # của địa chỉ. Từ YCTD-368 (GD-185) không còn là ứng dụng riêng: ứng dụng Chợ gia sư hiện khu
// này khi tài khoản đăng nhập là gia sư; máy chủ vẫn chỉ cho tài khoản gia sư gọi các điểm cuối /tutor/*
export const TUTOR_PAGES = [
  { key: 'buoi-day', label: 'Buổi dạy' },
  { key: 'lich', label: 'Lịch' },
  { key: 'ho-so', label: 'Hồ sơ và môn dạy' },
  { key: 'thu-nhap', label: 'Thu nhập' },
  { key: 'tin-nhan', label: 'Tin nhắn' },
  { key: 'danh-gia', label: 'Đánh giá' },
  { key: 'xac-minh', label: 'Xác minh' },
  { key: 'an-toan', label: 'An toàn, kiểm duyệt' },
] as const;
export type TutorPage = (typeof TUTOR_PAGES)[number]['key'];

// Mở khu gia sư: hồ sơ đã duyệt thì vào Buổi dạy, chưa duyệt thì vào Xác minh
export function TutorHome({ page, onPage }: { page: TutorPage | null; onPage: (next: TutorPage) => void }) {
  const [listing, setListing] = useState<Listing>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    marketRequest<Listing>('GET', '/tutor/listing')
      .then(setListing)
      .catch((caught: unknown) => setError(errorText(caught)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!page && listing) onPage(listing.status === 'approved' ? 'buoi-day' : 'xac-minh');
  }, [page, listing, onPage]);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!listing) return <p>Đang tải hồ sơ…</p>;
  if (page === 'buoi-day') {
    return (
      <>
        <TutorSafety />
        <TutorBookings />
      </>
    );
  }
  if (page === 'lich') return <TutorSchedule listing={listing} onEditAvailability={() => onPage('ho-so')} />;
  if (page === 'ho-so') {
    return (
      <>
        <h2 className="text-page-title font-bold">Hồ sơ và môn dạy</h2>
        <TutorArea />
        <TutorListing key={listing.status} listing={listing} onChange={setListing} />
        <TutorSchoolRole listing={listing} onChange={setListing} />
        <TutorAccount />
      </>
    );
  }
  if (page === 'thu-nhap') return <TutorEarnings />;
  if (page === 'tin-nhan') return <MessageInbox role="tutor" />;
  if (page === 'danh-gia') return <TutorReviews />;
  if (page === 'xac-minh') return <TutorVerification listing={listing} onChange={setListing} />;
  if (page === 'an-toan') {
    return (
      <>
        <TutorSafety alwaysShow />
        <ChildSafetyPolicy />
      </>
    );
  }
  return null;
}
