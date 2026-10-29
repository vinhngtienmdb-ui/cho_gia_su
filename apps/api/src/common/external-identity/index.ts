// Bộ nối nhà cung cấp định danh bên ngoài (DT-25, YCTD-225), chuyển từ dịch vụ định danh sang gói dùng chung (DT-27 phần 27g, YCTD-257)
// để máy chủ API dùng cho xác minh danh tính gia sư và đăng nhập ở chợ gia sư; dịch vụ định danh dùng như trước
export {
  ageFromBirthdate,
  IdentityProvider,
  IdentityProviderError,
  newAuthorizationParameters,
  pkceChallenge,
  type AuthorizationParameters,
  type ExternalIdentityResult,
} from './identity-provider.js';
export { clearOidcCaches, OidcIdentityProvider, type OidcClientCredentials } from './oidc-provider.js';
export {
  assertProviderUrl,
  isLocalHostname,
  parseProviderDefinition,
  PENDING_RAR_DOCUMENTATION,
  ProviderConfigurationError,
  readProviderDefinitions,
  secretVariableName,
  type ExternalProviderDefinition,
  type ProviderProfile,
  type TokenAuthMethod,
} from './provider-profiles.js';
