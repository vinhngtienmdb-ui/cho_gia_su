// Vỏ ứng dụng web cài được của Chợ gia sư (sao chép từ gói pwa của School Management khi tách, YCTD-384). Plugin Vite ở
// `@cho-gia-su/pwa/vite`
export { InstallPrompt, UpdateBanner, useInstallState, type InstallPromptProperties } from './InstallPrompt.js';
export { detectInstallState, dismissedRecently, type InstallEnvironment, type InstallState } from './install-state.js';
export {
  applyUpdate,
  clearCaches,
  onUpdateAvailable,
  registerServiceWorker,
  serviceWorkerSupported,
  unregisterServiceWorker,
  type ServiceWorkerOptions,
} from './service-worker-client.js';
