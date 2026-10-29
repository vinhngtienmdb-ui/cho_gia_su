import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import {
  ageFromBirthdate,
  IdentityProvider,
  IdentityProviderError,
  pkceChallenge,
  type AuthorizationParameters,
  type ExternalIdentityResult,
} from './identity-provider.js';
import { assertProviderUrl, type ExternalProviderDefinition } from './provider-profiles.js';

// Bộ nối OIDC chung (DT-25, YCTD-225): authorization code + PKCE (S256), state và nonce, đọc địa chỉ qua discovery, kiểm chữ ký id_token
// bằng bộ khóa JWKS của nhà cung cấp. Quay khóa: bộ khóa được lưu tạm và tải lại khi id_token mang mã khóa lạ (có thời gian chờ giữa hai
// lần tải để không bị lợi dụng gọi dồn). Không gọi userinfo, không đọc claim nào ngoài subject, mức đảm bảo, ngày sinh (nếu cấu hình)
const DISCOVERY_CACHE_MILLISECONDS = 60 * 60 * 1000;
const HTTP_TIMEOUT_MILLISECONDS = 10_000;
const CLOCK_TOLERANCE_SECONDS = 60;

interface ProviderMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

const discoveryCache = new Map<string, { metadata: ProviderMetadata; expiresAt: number }>();
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

// Kiểm thử đổi bộ giả lập giữa các ca thì xóa bộ nhớ tạm
export function clearOidcCaches(): void {
  discoveryCache.clear();
  keySets.clear();
}

export interface OidcClientCredentials {
  clientId: string;
  clientSecret: string | null;
}

export class OidcIdentityProvider extends IdentityProvider {
  readonly code: string;

  constructor(
    private readonly definition: ExternalProviderDefinition,
    private readonly credentials: OidcClientCredentials,
  ) {
    super();
    this.code = definition.code;
  }

  private async metadata(): Promise<ProviderMetadata> {
    const definition = this.definition;
    if (!definition.discovery) {
      return {
        authorizationEndpoint: definition.authorizationEndpoint as string,
        tokenEndpoint: definition.tokenEndpoint as string,
        jwksUri: definition.jwksUri as string,
      };
    }
    const cached = discoveryCache.get(definition.issuer);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.metadata;
    }
    const url = `${definition.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    let document: Record<string, unknown>;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MILLISECONDS) });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      document = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new IdentityProviderError('discovery_failed', 'Không đọc được cấu hình của nhà cung cấp định danh');
    }
    // Tài liệu discovery phải đúng bên phát hành đã khai (chống tráo cấu hình)
    if (document.issuer !== definition.issuer) {
      throw new IdentityProviderError('discovery_failed', 'Cấu hình nhà cung cấp định danh không khớp bên phát hành');
    }
    const pick = (field: string, override: string | null): string => {
      const value = override ?? document[field];
      if (typeof value !== 'string') {
        throw new IdentityProviderError('discovery_failed', `Cấu hình nhà cung cấp định danh thiếu ${field}`);
      }
      try {
        return assertProviderUrl(value, field);
      } catch {
        throw new IdentityProviderError('discovery_failed', `Địa chỉ ${field} của nhà cung cấp định danh không hợp lệ`);
      }
    };
    const metadata = {
      authorizationEndpoint: pick('authorization_endpoint', definition.authorizationEndpoint),
      tokenEndpoint: pick('token_endpoint', definition.tokenEndpoint),
      jwksUri: pick('jwks_uri', definition.jwksUri),
    };
    discoveryCache.set(definition.issuer, { metadata, expiresAt: Date.now() + DISCOVERY_CACHE_MILLISECONDS });
    return metadata;
  }

  private keySet(jwksUri: string) {
    const key = `${jwksUri}#${this.definition.jwksCooldownSeconds}`;
    let keySet = keySets.get(key);
    if (!keySet) {
      keySet = createRemoteJWKSet(new URL(jwksUri), {
        timeoutDuration: HTTP_TIMEOUT_MILLISECONDS,
        cooldownDuration: this.definition.jwksCooldownSeconds * 1000,
      });
      keySets.set(key, keySet);
    }
    return keySet;
  }

  async authorizationUrl(parameters: AuthorizationParameters): Promise<string> {
    const metadata = await this.metadata();
    const url = new URL(metadata.authorizationEndpoint);
    const query: Record<string, string> = {
      ...this.definition.extraAuthorizationParameters,
      response_type: 'code',
      client_id: this.credentials.clientId,
      redirect_uri: parameters.redirectUri,
      scope: this.definition.scopes.join(' '),
      state: parameters.state,
      nonce: parameters.nonce,
      code_challenge: pkceChallenge(parameters.codeVerifier),
      code_challenge_method: 'S256',
    };
    for (const [name, value] of Object.entries(query)) {
      url.searchParams.set(name, value);
    }
    return url.toString();
  }

  async exchange(code: string, parameters: AuthorizationParameters, now: Date): Promise<ExternalIdentityResult> {
    const metadata = await this.metadata();
    const idToken = await this.requestIdToken(metadata.tokenEndpoint, code, parameters);
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.keySet(metadata.jwksUri), {
        issuer: this.definition.issuer,
        audience: this.credentials.clientId,
        algorithms: this.definition.algorithms,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: now,
        requiredClaims: ['exp', 'iat'],
      }));
    } catch {
      throw new IdentityProviderError('invalid_id_token', 'Mã định danh của nhà cung cấp không hợp lệ');
    }
    // Có nhiều đối tượng thì bên được cấp (azp) phải là ứng dụng này
    if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== this.credentials.clientId) {
      throw new IdentityProviderError('invalid_id_token', 'Mã định danh của nhà cung cấp không dành cho ứng dụng này');
    }
    if (payload.nonce !== parameters.nonce) {
      throw new IdentityProviderError('nonce_mismatch', 'Mã định danh không thuộc lượt đăng nhập này');
    }
    const subject = payload[this.definition.subjectClaim];
    if (typeof subject !== 'string' || subject.trim() === '' || subject.length > 255) {
      throw new IdentityProviderError('missing_subject', 'Nhà cung cấp không trả mã liên kết');
    }
    const assurance = this.definition.assuranceClaim ? payload[this.definition.assuranceClaim] : undefined;
    return {
      subject,
      assurance: typeof assurance === 'string' ? assurance : null,
      ageYears: this.definition.birthdateClaim ? ageFromBirthdate(payload[this.definition.birthdateClaim], now) : null,
    };
  }

  private async requestIdToken(
    tokenEndpoint: string,
    code: string,
    parameters: AuthorizationParameters,
  ): Promise<string> {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: parameters.redirectUri,
      code_verifier: parameters.codeVerifier,
    });
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };
    const { clientId, clientSecret } = this.credentials;
    if (clientSecret && this.definition.tokenAuthMethod === 'client_secret_basic') {
      const encode = (value: string) => encodeURIComponent(value);
      headers.authorization = `Basic ${Buffer.from(`${encode(clientId)}:${encode(clientSecret)}`).toString('base64')}`;
    } else {
      form.set('client_id', clientId);
      if (clientSecret) {
        form.set('client_secret', clientSecret);
      }
    }
    let body: Record<string, unknown>;
    try {
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers,
        body: form,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MILLISECONDS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new IdentityProviderError('token_exchange_failed', 'Nhà cung cấp định danh từ chối mã đăng nhập');
    }
    if (typeof body.id_token !== 'string') {
      throw new IdentityProviderError('token_exchange_failed', 'Nhà cung cấp định danh không trả mã định danh');
    }
    return body.id_token;
  }
}
