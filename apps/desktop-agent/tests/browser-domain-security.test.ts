import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DomainSecurityService } from '../src/runtimes/browser/domain-security.js';

describe('Domain Security Service — Navigation, SSRF, & Scheme Security', () => {
  const service = new DomainSecurityService();
  const allowedDomains = ['*.example.com', 'trusted-site.org'];

  it('allows navigation to policy-approved domains and wildcard subdomains', () => {
    const r1 = service.validateUrl('https://app.example.com/dashboard', allowedDomains);
    assert.equal(r1.valid, true);
    assert.equal(r1.domain, 'app.example.com');

    const r2 = service.validateUrl('https://trusted-site.org/api', allowedDomains);
    assert.equal(r2.valid, true);
    assert.equal(r2.domain, 'trusted-site.org');
  });

  it('rejects navigation to unapproved external domains', () => {
    const r = service.validateUrl('https://malicious-site.net', allowedDomains);
    assert.equal(r.valid, false);
    assert.equal(r.error?.code, 'UNAUTHORIZED_DOMAIN');
  });

  it('rejects loopback and localhost targets (SSRF protection)', () => {
    const r1 = service.validateUrl('http://localhost:8080', allowedDomains);
    assert.equal(r1.valid, false);
    assert.equal(r1.error?.code, 'PROHIBITED_DESTINATION');

    const r2 = service.validateUrl('http://127.0.0.1/admin', allowedDomains);
    assert.equal(r2.valid, false);
    assert.equal(r2.error?.code, 'PROHIBITED_DESTINATION');
  });

  it('rejects cloud metadata endpoints (169.254.169.254)', () => {
    const r = service.validateUrl('http://169.254.169.254/latest/meta-data', allowedDomains);
    assert.equal(r.valid, false);
    assert.equal(r.error?.code, 'PROHIBITED_DESTINATION');
  });

  it('rejects private IPv4 network targets (10.x, 172.16.x, 192.168.x)', () => {
    const r1 = service.validateUrl('http://10.0.0.1', allowedDomains);
    assert.equal(r1.valid, false);
    assert.equal(r1.error?.code, 'PROHIBITED_PRIVATE_NETWORK');

    const r2 = service.validateUrl('http://192.168.1.100', allowedDomains);
    assert.equal(r2.valid, false);
    assert.equal(r2.error?.code, 'PROHIBITED_PRIVATE_NETWORK');
  });

  it('rejects prohibited schemes (file://, javascript:, data:)', () => {
    const r1 = service.validateUrl('file:///etc/passwd', allowedDomains);
    assert.equal(r1.valid, false);
    assert.equal(r1.error?.code, 'PROHIBITED_SCHEME');

    const r2 = service.validateUrl('javascript:alert(1)', allowedDomains);
    assert.equal(r2.valid, false);
  });

  it('validates redirects and denies redirect to unapproved domains', () => {
    const r = service.validateRedirect(
      'https://app.example.com',
      'https://malicious.com',
      allowedDomains,
    );
    assert.equal(r.valid, false);
    assert.equal(r.error?.code, 'UNAUTHORIZED_DOMAIN');
  });
});
