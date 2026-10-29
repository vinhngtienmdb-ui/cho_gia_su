import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from 'livekit-client';
import { Alert } from './Alert.js';
import { Button } from './Button.js';

// Lớp video trực tiếp (DT-27 phần 27a, YCTD-251) dùng chung cho cổng quản trị, ứng dụng giáo viên, ứng dụng phụ huynh (cha mẹ và học
// sinh): nối máy chủ phòng LiveKit bằng mã vào phòng do máy chủ API cấp; micro, camera, chia sẻ màn hình theo quyền; "đang ghi" luôn
// hiện khi phòng đang ghi; bảng trắng đồng bộ qua kênh dữ liệu của phòng (tự viết bằng canvas, không thêm thư viện, GD-137). Máy chủ
// API dùng bộ giả lập (địa chỉ mock://) thì không nối máy chủ video, chỉ hiện phòng giả lập để kiểm thử luồng
export interface VideoJoinInfo {
  status: 'ready' | 'waiting';
  room_id: string;
  title: string;
  role: 'host' | 'student' | 'guardian' | 'observer';
  identity: string;
  url?: string;
  token?: string;
  recording?: boolean;
  can_speak?: boolean;
  can_share?: boolean;
}

const ROLE_LABELS: Record<VideoJoinInfo['role'], string> = {
  host: 'Gia sư',
  student: 'Học sinh',
  guardian: 'Cha mẹ (xem)',
  observer: 'Ban Giám hiệu (xem)',
};

const WHITEBOARD_TOPIC = 'bang-trang';

interface Stroke {
  points: Array<[number, number]>;
  color: string;
}

function Whiteboard({ room, editable }: { room: Room | null; editable: boolean }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const draw = useCallback(() => {
    const context = canvas.current?.getContext('2d');
    if (!context || !canvas.current) {
      return;
    }
    context.clearRect(0, 0, canvas.current.width, canvas.current.height);
    for (const stroke of strokes.current) {
      context.strokeStyle = stroke.color;
      context.lineWidth = 3;
      context.beginPath();
      stroke.points.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
      context.stroke();
    }
  }, []);
  useEffect(() => {
    if (!room) {
      return undefined;
    }
    const onData = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic !== WHITEBOARD_TOPIC) {
        return;
      }
      const message = JSON.parse(new TextDecoder().decode(payload)) as { clear?: boolean; stroke?: Stroke };
      if (message.clear) {
        strokes.current = [];
      } else if (message.stroke) {
        strokes.current.push(message.stroke);
      }
      draw();
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, draw]);
  const send = (message: object) =>
    room?.localParticipant
      .publishData(new TextEncoder().encode(JSON.stringify(message)), { reliable: true, topic: WHITEBOARD_TOPIC })
      .catch(() => undefined);
  const point = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const box = event.currentTarget.getBoundingClientRect();
    return [Math.round(event.clientX - box.left), Math.round(event.clientY - box.top)];
  };
  return (
    <section aria-label="Bảng trắng" className="flex flex-col gap-2">
      <canvas
        ref={canvas}
        width={640}
        height={320}
        className="max-w-full rounded-lg border border-border bg-white touch-none"
        onPointerDown={(event) => {
          if (editable) {
            current.current = { points: [point(event)], color: '#1d4ed8' };
          }
        }}
        onPointerMove={(event) => {
          if (current.current) {
            current.current.points.push(point(event));
            strokes.current = [...strokes.current.filter((stroke) => stroke !== current.current), current.current];
            draw();
          }
        }}
        onPointerUp={() => {
          if (current.current) {
            void send({ stroke: current.current });
            current.current = null;
          }
        }}
      />
      {editable ? (
        <Button
          onClick={() => {
            strokes.current = [];
            draw();
            void send({ clear: true });
          }}
        >
          Xóa bảng
        </Button>
      ) : null}
    </section>
  );
}

// roleLabel (DT-28 phần 28g): nhãn vai thay cho nhãn mặc định, ví dụ "Giáo viên" ở giờ học của trường thay cho "Gia sư"
export function VideoRoom({
  join,
  onLeave,
  roleLabel,
}: {
  join: VideoJoinInfo;
  onLeave: () => void;
  roleLabel?: string;
}) {
  const mock = join.url?.startsWith('mock://') ?? false;
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string>();
  const [microphone, setMicrophone] = useState(false);
  const [camera, setCamera] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [participants, setParticipants] = useState<string[]>([]);
  const media = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (mock || !join.url || !join.token) {
      return undefined;
    }
    const next = new Room({ adaptiveStream: true, dynacast: true });
    const refresh = () =>
      setParticipants(
        [...next.remoteParticipants.values()].map((participant) => participant.name || participant.identity),
      );
    const attach = (track: RemoteTrack, _publication: unknown, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) {
        const element = track.attach();
        element.setAttribute('aria-label', `${participant.name || participant.identity}: ${track.source}`);
        element.className = 'w-full max-w-sm rounded-lg bg-black';
        media.current?.appendChild(element);
      }
    };
    next
      .on(RoomEvent.TrackSubscribed, attach)
      .on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((element) => element.remove()))
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.Disconnected, () => setRoom(null));
    next
      .connect(join.url, join.token)
      .then(() => {
        setRoom(next);
        refresh();
      })
      .catch(() => setError('Không nối được lớp video, kiểm tra mạng rồi vào lại'));
    return () => {
      void next.disconnect();
    };
  }, [mock, join.url, join.token]);
  const toggle = async (kind: 'microphone' | 'camera' | 'screen') => {
    if (!room) {
      return;
    }
    try {
      if (kind === 'microphone') {
        await room.localParticipant.setMicrophoneEnabled(!microphone);
        setMicrophone(!microphone);
      } else if (kind === 'camera') {
        await room.localParticipant.setCameraEnabled(!camera);
        setCamera(!camera);
      } else {
        await room.localParticipant.setScreenShareEnabled(!sharing);
        setSharing(!sharing);
      }
    } catch {
      setError('Trình duyệt chưa cho dùng micro, camera hoặc chia sẻ màn hình');
    }
  };
  return (
    <section aria-label={`Lớp video ${join.title}`} className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-section-title font-semibold">{join.title}</h2>
        <span className="text-label text-text-secondary">{roleLabel ?? ROLE_LABELS[join.role]}</span>
        {join.recording ? (
          <span role="status" className="rounded-full bg-red-600 px-3 py-1 text-label font-medium text-white">
            ● Đang ghi
          </span>
        ) : null}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {mock ? (
        <Alert tone="info">
          Phòng giả lập: máy chủ đang dùng bộ giả lập lớp video (kiểm thử), không có hình và tiếng.
        </Alert>
      ) : (
        <p className="text-label text-text-secondary">
          {room ? `Đang ở trong phòng · ${participants.length} người khác` : 'Đang nối lớp video…'}
          {participants.length > 0 ? `: ${participants.join(', ')}` : ''}
        </p>
      )}
      <div ref={media} aria-label="Hình và tiếng của người dự" className="flex flex-wrap gap-2" />
      <div className="flex flex-wrap gap-2">
        {join.can_speak ? (
          <>
            <Button onClick={() => void toggle('microphone')} disabled={!room}>
              {microphone ? 'Tắt micro' : 'Bật micro'}
            </Button>
            {join.role === 'host' || join.role === 'student' ? (
              <Button onClick={() => void toggle('camera')} disabled={!room}>
                {camera ? 'Tắt camera' : 'Bật camera'}
              </Button>
            ) : null}
          </>
        ) : null}
        {join.can_share ? (
          <Button onClick={() => void toggle('screen')} disabled={!room}>
            {sharing ? 'Dừng chia sẻ màn hình' : 'Chia sẻ màn hình'}
          </Button>
        ) : null}
        <Button variant="danger" onClick={onLeave}>
          Rời phòng
        </Button>
      </div>
      {!mock ? <Whiteboard room={room} editable={join.can_speak === true} /> : null}
    </section>
  );
}

export interface VideoAdmission {
  identity: string;
  role: VideoJoinInfo['role'];
  display_name: string;
  admitted_at: string | null;
  can_speak: boolean;
  can_share: boolean;
}

// Bảng của chủ phòng: phòng chờ (cho vào), cho nói, cho chia sẻ màn hình, mời ra; bắt đầu, dừng ghi; kết thúc phòng; phút còn lại.
// recordingLocked (phòng học của chợ gia sư, YCTD-362): buổi có trẻ vị thành niên luôn ghi hình, không có nút dừng ghi
export function VideoHostPanel({
  admissions,
  recording,
  recordingLocked = false,
  minutesLeft,
  onParticipant,
  onRecording,
  onEnd,
}: {
  admissions: VideoAdmission[];
  recording: boolean;
  recordingLocked?: boolean;
  minutesLeft: number | null;
  onParticipant: (
    identity: string,
    change: { admit?: true; can_speak?: boolean; can_share?: boolean; remove?: true },
  ) => void;
  onRecording: (start: boolean) => void;
  onEnd: () => void;
}) {
  const others = admissions.filter((admission) => admission.role !== 'host');
  return (
    <section aria-label="Điều khiển phòng" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h3 className="font-semibold">Người dự</h3>
      {minutesLeft !== null ? (
        <p className="text-label text-text-secondary">
          Còn {minutesLeft} phút người dự trong tháng theo gói của trường
        </p>
      ) : null}
      {others.length === 0 ? <p className="text-label">Chưa có ai vào phòng.</p> : null}
      <ul className="flex flex-col gap-2">
        {others.map((admission) => (
          <li key={admission.identity} className="flex flex-wrap items-center gap-2">
            <span>
              {admission.display_name} · {ROLE_LABELS[admission.role]}
              {admission.admitted_at ? '' : ' · đang chờ'}
            </span>
            {admission.admitted_at ? null : (
              <Button onClick={() => onParticipant(admission.identity, { admit: true })}>
                Cho {admission.display_name} vào
              </Button>
            )}
            {admission.role !== 'student' ? (
              <Button onClick={() => onParticipant(admission.identity, { can_speak: !admission.can_speak })}>
                {admission.can_speak ? 'Thôi cho nói' : 'Cho nói'}
              </Button>
            ) : (
              <Button onClick={() => onParticipant(admission.identity, { can_share: !admission.can_share })}>
                {admission.can_share ? 'Thôi cho chia sẻ' : 'Cho chia sẻ màn hình'}
              </Button>
            )}
            <Button onClick={() => onParticipant(admission.identity, { remove: true })}>Mời ra</Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {recordingLocked ? (
          <span className="text-label text-text-secondary">Buổi với trẻ dưới 18 tuổi luôn ghi hình</span>
        ) : (
          <Button onClick={() => onRecording(!recording)}>{recording ? 'Dừng ghi hình' : 'Bắt đầu ghi hình'}</Button>
        )}
        <Button variant="danger" onClick={onEnd}>
          Kết thúc phòng
        </Button>
      </div>
    </section>
  );
}

export interface VideoRecordingRow {
  id: string;
  status: 'recording' | 'ready' | 'failed' | 'deleted';
  started_at: string;
  expires_at: string;
}

// Bản ghi của buổi: xem bằng đường dẫn ký ngắn hạn, không có nút tải, mỗi lần xem ghi nhật ký
export function VideoRecordingList({
  recordings,
  onView,
}: {
  recordings: VideoRecordingRow[];
  onView: (id: string) => Promise<string>;
}) {
  const [source, setSource] = useState<string>();
  const [error, setError] = useState<string>();
  if (recordings.length === 0) {
    return null;
  }
  return (
    <section aria-label="Bản ghi của buổi" className="flex flex-col gap-2">
      <h3 className="font-semibold">Bản ghi</h3>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ul className="flex flex-col gap-1">
        {recordings.map((recording) => (
          <li key={recording.id} className="flex flex-wrap items-center gap-2 text-label">
            <span>
              {new Date(recording.started_at).toLocaleString('vi-VN')} · giữ đến{' '}
              {new Date(recording.expires_at).toLocaleDateString('vi-VN')}
            </span>
            {recording.status === 'ready' ? (
              <Button
                onClick={() =>
                  onView(recording.id)
                    .then((url) => {
                      setError(undefined);
                      setSource(url);
                    })
                    .catch(() => setError('Không mở được bản ghi'))
                }
              >
                Xem bản ghi
              </Button>
            ) : (
              <span>{recording.status === 'recording' ? 'Đang ghi' : 'Không xem được'}</span>
            )}
          </li>
        ))}
      </ul>
      {source ? (
        <video
          aria-label="Xem lại bản ghi"
          src={source}
          controls
          controlsList="nodownload"
          onContextMenu={(event) => event.preventDefault()}
          className="w-full max-w-xl rounded-lg bg-black"
        />
      ) : null}
    </section>
  );
}
