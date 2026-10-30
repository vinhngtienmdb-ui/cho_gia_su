// Vai trò trong phòng video và quyền tương ứng (sao chép từ gói shared của School Management, DT-27 phần 27a, YCTD-251, khi tách chợ,
// YCTD-393)
export type VideoRoomRole = 'host' | 'student' | 'guardian' | 'observer';
export type VideoTrackSource = 'camera' | 'microphone' | 'screen_share' | 'screen_share_audio';

// Thời hạn mã vào phòng (giây)
export const VIDEO_JOIN_TOKEN_SECONDS = 600;

export interface VideoGrants {
  roomAdmin: boolean;
  canPublish: boolean;
  canPublishData: boolean;
  canSubscribe: boolean;
  canPublishSources: VideoTrackSource[];
}

// Quyền theo vai trò: gia sư chia sẻ, ghi, tắt tiếng người khác; học sinh nói, chia sẻ màn hình khi được cho; phụ huynh xem, nói khi
// được cho. Bảng trắng đi qua kênh dữ liệu nên ai được nói thì vẽ được
export function videoGrantsFor(role: VideoRoomRole, allowed: { speak?: boolean; share?: boolean } = {}): VideoGrants {
  if (role === 'host') {
    return {
      roomAdmin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      canPublishSources: ['camera', 'microphone', 'screen_share', 'screen_share_audio'],
    };
  }
  if (role === 'student') {
    return {
      roomAdmin: false,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      canPublishSources: allowed.share
        ? ['camera', 'microphone', 'screen_share', 'screen_share_audio']
        : ['camera', 'microphone'],
    };
  }
  const speak = allowed.speak === true;
  return {
    roomAdmin: false,
    canPublish: speak,
    canPublishData: speak,
    canSubscribe: true,
    canPublishSources: speak ? ['microphone'] : [],
  };
}
