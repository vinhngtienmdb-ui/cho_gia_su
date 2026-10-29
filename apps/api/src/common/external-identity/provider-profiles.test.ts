import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ageFromBirthdate, pkceChallenge } from './identity-provider.js';
import {
  parseProviderDefinition,
  PENDING_RAR_DOCUMENTATION,
  readProviderDefinitions,
  secretVariableName,
} from './provider-profiles.js';

// Khai báo nhà cung cấp định danh ở mức nền tảng và hồ sơ vneid (DT-25, YCTD-225)
describe('khai báo nhà cung cấp định danh bên ngoài', () => {
  it('trống là không có nhà cung cấp nào', () => {
    assert.deepEqual(readProviderDefinitions({}), []);
  });

  it('hồ sơ vneid dùng giá trị giả định của OIDC, ghi rõ mục chờ tài liệu RAR', () => {
    const definition = parseProviderDefinition({
      code: 'vneid',
      profile: 'vneid',
      issuer: 'https://xac-thuc.example.vn',
    });
    assert.equal(definition.displayName, 'VNeID');
    assert.deepEqual(definition.scopes, ['openid']);
    assert.equal(definition.subjectClaim, 'sub');
    assert.equal(definition.birthdateClaim, 'birthdate');
    assert.ok(PENDING_RAR_DOCUMENTATION.includes('issuer'));
    assert.ok(PENDING_RAR_DOCUMENTATION.includes('scopes'));
  });

  it('khóa bí mật đọc từ biến môi trường riêng theo mã, không nằm trong JSON', () => {
    const definitions = readProviderDefinitions({
      EXTERNAL_IDENTITY_PROVIDERS: JSON.stringify([
        { code: 'vneid', profile: 'vneid', issuer: 'https://a.example.vn' },
      ]),
      [secretVariableName('vneid')]: 'bi-mat-thu',
    });
    assert.equal(secretVariableName('vneid'), 'EXTERNAL_IDENTITY_VNEID_CLIENT_SECRET');
    assert.equal(definitions[0]?.clientSecret, 'bi-mat-thu');
  });

  it('từ chối cấu hình không an toàn hoặc sai', () => {
    const bad: unknown[] = [
      { code: 'a', issuer: 'https://a.example.vn' },
      { code: 'oidc', issuer: 'http://a.example.vn' },
      { code: 'oidc', issuer: 'https://a.example.vn', scopes: ['profile'] },
      { code: 'oidc', issuer: 'https://a.example.vn', algorithms: ['HS256'] },
      { code: 'oidc', issuer: 'https://a.example.vn', algorithms: ['none'] },
      { code: 'oidc', issuer: 'https://a.example.vn', profile: 'khac' },
      { code: 'oidc', issuer: 'https://a.example.vn', discovery: false },
      { code: 'oidc', issuer: 'https://a.example.vn', token_auth_method: 'private_key_jwt' },
    ];
    for (const item of bad) {
      assert.throws(() => parseProviderDefinition(item), JSON.stringify(item));
    }
    assert.throws(() =>
      readProviderDefinitions({
        EXTERNAL_IDENTITY_PROVIDERS: JSON.stringify([
          { code: 'oidc', issuer: 'https://a.example.vn' },
          { code: 'oidc', issuer: 'https://b.example.vn' },
        ]),
      }),
    );
  });

  it('http chỉ nhận cho máy cục bộ', () => {
    assert.ok(parseProviderDefinition({ code: 'oidc', issuer: 'http://127.0.0.1:3299/oidc' }));
    assert.ok(parseProviderDefinition({ code: 'oidc', issuer: 'http://idp.localhost/oidc' }));
  });

  it('PKCE S256 theo RFC 7636 và tính tuổi từ ngày sinh', () => {
    assert.equal(
      pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    const now = new Date('2026-10-26T05:00:00Z');
    assert.equal(ageFromBirthdate('2012-10-26', now), 14);
    assert.equal(ageFromBirthdate('2012-10-27', now), 13);
    assert.equal(ageFromBirthdate('26/10/2012', now), null);
    assert.equal(ageFromBirthdate(undefined, now), null);
  });
});
