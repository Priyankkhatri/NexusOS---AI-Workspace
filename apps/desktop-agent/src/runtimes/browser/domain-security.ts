import { URL } from 'node:url';

export interface DomainSecurityResult {
  valid: boolean;
  normalizedUrl: string;
  domain?: string;
  error?: {
    code: string;
    message: string;
  };
}

export class DomainSecurityService {
  private static readonly PROHIBITED_SCHEMES = new Set([
    'file:',
    'javascript:',
    'data:',
    'gopher:',
    'ftp:',
    'chrome:',
    'edge:',
    'about:',
    'blob:',
  ]);

  private static readonly PROHIBITED_HOSTNAMES = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    '169.254.169.254', // AWS/GCP/Azure Metadata Endpoint
  ]);

  /**
   * Validates target URL against scheme rules, loopback/private/metadata IP blocks, and domain allowlists.
   */
  public validateUrl(rawUrl: string, allowedDomains: string[]): DomainSecurityResult {
    if (!rawUrl || typeof rawUrl !== 'string') {
      return {
        valid: false,
        normalizedUrl: '',
        error: { code: 'INVALID_URL', message: 'URL must be a non-empty string.' },
      };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return {
        valid: false,
        normalizedUrl: rawUrl,
        error: { code: 'INVALID_URL', message: `Malformed URL string: '${rawUrl}'.` },
      };
    }

    const scheme = parsedUrl.protocol.toLowerCase();
    if (
      DomainSecurityService.PROHIBITED_SCHEMES.has(scheme) ||
      (scheme !== 'http:' && scheme !== 'https:')
    ) {
      return {
        valid: false,
        normalizedUrl: parsedUrl.toString(),
        error: {
          code: 'PROHIBITED_SCHEME',
          message: `URL scheme '${scheme}' is strictly prohibited. Only http and https are allowed.`,
        },
      };
    }

    const rawHost = parsedUrl.hostname.toLowerCase().trim();
    const hostname = rawHost.replace(/^\[|\]$/g, '');

    // 1. Check prohibited hostnames & loopback / metadata endpoints
    if (
      DomainSecurityService.PROHIBITED_HOSTNAMES.has(rawHost) ||
      DomainSecurityService.PROHIBITED_HOSTNAMES.has(hostname)
    ) {
      return {
        valid: false,
        normalizedUrl: parsedUrl.toString(),
        error: {
          code: 'PROHIBITED_DESTINATION',
          message: `Access to local, loopback, or cloud metadata target '${rawHost}' is prohibited.`,
        },
      };
    }

    // 2. Check private IPv4 / IPv6 ranges
    if (this.isPrivateOrLocalIp(hostname)) {
      return {
        valid: false,
        normalizedUrl: parsedUrl.toString(),
        error: {
          code: 'PROHIBITED_PRIVATE_NETWORK',
          message: `Access to private or local network IP '${hostname}' is prohibited.`,
        },
      };
    }

    // 3. Domain Allowlist Verification
    if (!allowedDomains || allowedDomains.length === 0) {
      return {
        valid: false,
        normalizedUrl: parsedUrl.toString(),
        error: {
          code: 'NO_ALLOWED_DOMAINS',
          message: 'No domain allowlist specified for browser navigation.',
        },
      };
    }

    const matchedDomain = allowedDomains.find((pattern) =>
      this.matchesDomainPattern(hostname, pattern),
    );
    if (!matchedDomain) {
      return {
        valid: false,
        normalizedUrl: parsedUrl.toString(),
        error: {
          code: 'UNAUTHORIZED_DOMAIN',
          message: `Domain '${hostname}' is not included in the policy domain allowlist.`,
        },
      };
    }

    return {
      valid: true,
      normalizedUrl: parsedUrl.toString(),
      domain: hostname,
    };
  }

  /**
   * Validates redirect target URL against domain security rules.
   */
  public validateRedirect(
    initialUrl: string,
    redirectUrl: string,
    allowedDomains: string[],
  ): DomainSecurityResult {
    const secResult = this.validateUrl(redirectUrl, allowedDomains);
    if (!secResult.valid) {
      return {
        ...secResult,
        error: {
          code: 'UNAUTHORIZED_REDIRECT',
          message: `Redirect from '${initialUrl}' to '${redirectUrl}' denied: ${secResult.error?.message}`,
        },
      };
    }
    return secResult;
  }

  private matchesDomainPattern(hostname: string, pattern: string): boolean {
    const normPattern = pattern.toLowerCase().trim();
    if (normPattern === '*' || normPattern === hostname) {
      return true;
    }

    if (normPattern.startsWith('*.')) {
      const baseDomain = normPattern.substring(2);
      return hostname === baseDomain || hostname.endsWith(`.${baseDomain}`);
    }

    return false;
  }

  private isPrivateOrLocalIp(hostname: string): boolean {
    let target = hostname.toLowerCase().trim();

    // Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
    if (target.startsWith('::ffff:')) {
      target = target.substring(7);
    }

    // IPv4 Private Ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = target.match(ipv4Regex);

    if (match) {
      const p1 = parseInt(match[1]!, 10);
      const p2 = parseInt(match[2]!, 10);

      if (p1 === 10) return true; // 10.0.0.0/8
      if (p1 === 172 && p2 >= 16 && p2 <= 31) return true; // 172.16.0.0/12
      if (p1 === 192 && p2 === 168) return true; // 192.168.0.0/16
      if (p1 === 169 && p2 === 254) return true; // 169.254.0.0/16
      if (p1 === 100 && p2 >= 64 && p2 <= 127) return true; // 100.64.0.0/10 (CGNAT)
      if (p1 === 127) return true; // 127.0.0.0/8
      if (p1 === 0) return true; // 0.0.0.0/8
    }

    // IPv6 Loopback or Local (fe80:, fc00:, fd00:)
    if (
      target === '::' ||
      target === '::1' ||
      target.startsWith('fe80:') ||
      target.startsWith('fc00:') ||
      target.startsWith('fd00:')
    ) {
      return true;
    }

    return false;
  }
}
