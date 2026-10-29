import { useEffect, useState } from 'react';
import { detectInstallState, dismissedRecently, isIos, type InstallState } from './install-state.js';
import { applyUpdate, onUpdateAvailable } from './service-worker-client.js';

// Mời cài ứng dụng lên màn hình chính (DT-26 phần 26a, YCTD-231): Android, máy tính có sự kiện cài đặt thì hiện nút "Cài ứng
// dụng"; iPhone, iPad không có sự kiện nên hiện hướng dẫn nút Chia sẻ, "Thêm vào MH chính"; mở trong Zalo, Facebook thì hướng dẫn
// mở bằng Safari hoặc Chrome. Bấm "Để sau" thì 30 ngày không mời lại (ghi ở localStorage của máy, không phải dữ liệu cá nhân)
const DISMISS_KEY = 'ung-dung:moi-cai-de-sau';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Sự kiện có thể đến trước khi thành phần được vẽ: giữ lại từ lúc tải gói
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    promptListeners.forEach((listener) => listener());
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    promptListeners.forEach((listener) => listener());
  });
}

function readStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function currentState(): InstallState {
  return detectInstallState({
    userAgent: navigator.userAgent,
    standalone: readStandalone(),
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    promptAvailable: deferredPrompt !== null,
  });
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

export function useInstallState(): InstallState {
  const [state, setState] = useState(currentState);
  useEffect(() => {
    const listener = () => setState(currentState());
    promptListeners.add(listener);
    listener();
    return () => {
      promptListeners.delete(listener);
    };
  }, []);
  return state;
}

export interface InstallPromptProperties {
  // Tên ứng dụng hiện trong lời mời, ví dụ "ứng dụng giáo viên"
  applicationName: string;
}

const BOX_CLASS = 'rounded-lg border border-border bg-card px-4 py-3 text-label text-text';
const BUTTON_CLASS = 'min-h-11 rounded-lg px-4 py-2 text-label font-medium';

export function InstallPrompt({ applicationName }: InstallPromptProperties) {
  const state = useInstallState();
  const [dismissed, setDismissed] = useState(() => dismissedRecently(readDismissed(), new Date()));

  if (dismissed || state === 'installed' || state === 'unsupported') {
    return null;
  }

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    } catch {
      // không ghi được thì chỉ ẩn trong lần mở này
    }
    setDismissed(true);
  };

  const install = async () => {
    const event = deferredPrompt;
    if (!event) {
      return;
    }
    await event.prompt();
    const choice = await event.userChoice;
    deferredPrompt = null;
    if (choice.outcome === 'dismissed') {
      dismiss();
    } else {
      promptListeners.forEach((listener) => listener());
    }
  };

  const ipad = isIos({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0 })
    ? /iPad|Macintosh/.test(navigator.userAgent)
    : false;

  return (
    <section className={BOX_CLASS} aria-label="Cài ứng dụng lên màn hình chính">
      <p className="font-medium">Cài {applicationName} lên màn hình chính</p>
      {state === 'prompt' ? (
        <p className="mt-1 text-text-secondary">Mở nhanh như ứng dụng, có biểu tượng của trường.</p>
      ) : null}
      {state === 'ios-safari' ? (
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-text-secondary">
          <li>Chạm nút Chia sẻ (hình vuông có mũi tên lên) {ipad ? 'ở góc trên' : 'ở thanh dưới cùng'}.</li>
          <li>Chọn &quot;Thêm vào MH chính&quot;, rồi chạm &quot;Thêm&quot;.</li>
          <li>
            Mở ứng dụng từ biểu tượng mới trên màn hình chính. Thông báo đẩy trên iPhone, iPad chỉ nhận được theo cách
            này.
          </li>
        </ol>
      ) : null}
      {state === 'ios-other' ? (
        <p className="mt-1 text-text-secondary">
          Mở trang này bằng Safari rồi chạm nút Chia sẻ, chọn &quot;Thêm vào MH chính&quot;.
        </p>
      ) : null}
      {state === 'in-app-browser' ? (
        <p className="mt-1 text-text-secondary">
          Trang đang mở trong Zalo hoặc Facebook nên không cài được. Chạm nút ba chấm, chọn &quot;Mở bằng trình
          duyệt&quot; (Safari hoặc Chrome), rồi cài từ đó.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {state === 'prompt' ? (
          <button type="button" className={`${BUTTON_CLASS} bg-brand text-white`} onClick={() => void install()}>
            Cài ứng dụng
          </button>
        ) : null}
        <button type="button" className={`${BUTTON_CLASS} text-link`} onClick={dismiss}>
          Để sau
        </button>
      </div>
    </section>
  );
}

// Thanh báo có bản mới của ứng dụng (dùng chung cho mọi màn hình, không chỉ trang công cụ lớp học)
export function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => onUpdateAvailable(setReady), []);
  if (!ready) {
    return null;
  }
  return (
    <div role="status" className="border-b border-info/30 bg-info/10 px-4 py-2 text-label font-medium text-info">
      Có bản mới của ứng dụng.{' '}
      <button type="button" className="min-h-11 underline" onClick={applyUpdate}>
        Tải lại để dùng bản mới
      </button>
    </div>
  );
}
