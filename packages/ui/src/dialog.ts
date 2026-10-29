// Hộp thoại theo khổ thiết bị (DT-26 phần 26e, YCTD-235): từ 768 px là hộp giữa màn hình như cũ; dưới 768 px phủ kín màn hình, không bo
// góc, cuộn trong hộp. Thêm lớp này vào phần tử <dialog> sau các lớp kích thước của hộp (max-w-*, rounded-*)
export const DIALOG_NARROW_FULL_SCREEN_CLASS =
  'max-md:m-0 max-md:h-dvh max-md:max-h-none max-md:w-screen max-md:max-w-none max-md:overflow-y-auto max-md:rounded-none max-md:border-0';
