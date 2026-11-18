import "server-only";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

// The one request Atlas sends to a host that is not on the allowlist: an RFC 8058
// one-click unsubscribe, after the owner approved that sender. The URL comes from an
// email header, so it is untrusted:
//   - https only, no credentials in the URL, a real DNS name (no IP literals, no
//     localhost or internal names);
//   - every address the name resolves to must be public: private, loopback, link-local,
//     carrier-grade NAT, multicast and reserved ranges are refused (no SSRF into a
//     private network or a cloud metadata endpoint);
//   - the connection goes to the exact address that was checked. The name is resolved
//     once; a hostile DNS server cannot answer "public" for the check and "private" a
//     moment later for the connection (DNS rebinding);
//   - redirects are not followed, no cookies are sent, the response body is never read,
//     and the request times out after 6 seconds.

export class UnsafeTargetError extends Error {}

const INTERNAL_NAME = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|arpa)$/i;

export function isPublicIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false; // IETF protocol assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51) return false; // TEST-NET-2
  if (a === 203 && b === 0) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast and reserved
  return true;
}

export function isPublicIPv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return false;
  // An IPv4 address inside an IPv6 one, written dotted (::ffff:1.2.3.4) or in hex
  // (::ffff:7f00:1): judge the IPv4 address it reaches.
  const dotted = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (dotted) return isPublicIPv4(dotted[1]!);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
  if (hex) {
    const hi = Number.parseInt(hex[1]!, 16);
    const lo = Number.parseInt(hex[2]!, 16);
    return isPublicIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (/^f[cd]/.test(v)) return false; // unique local
  if (/^fe[89ab]/.test(v)) return false; // link-local
  if (/^ff/.test(v)) return false; // multicast
  if (v.startsWith("2001:db8") || v.startsWith("64:ff9b") || v.startsWith("100:")) return false;
  // 6to4 and Teredo tunnel to an IPv4 address written inside them. No sender needs one.
  if (v.startsWith("2002:") || /^2001:(0{1,4})?:/.test(v)) return false;
  return true;
}

export interface PublicTarget {
  url: URL;
  /** The vetted address to connect to. */
  address: string;
  family: 4 | 6;
}

/**
 * Throws unless the URL is https on a public DNS name that resolves only to public
 * addresses. Returns the URL with one of those addresses, to connect to directly.
 */
export async function resolvePublicHttps(raw: string): Promise<PublicTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeTargetError("Not a URL");
  }
  if (url.protocol !== "https:") throw new UnsafeTargetError("Only https is allowed");
  if (url.username || url.password) throw new UnsafeTargetError("Credentials in URL");
  if (url.port && url.port !== "443") throw new UnsafeTargetError("Only the standard https port is allowed");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || INTERNAL_NAME.test(host)) throw new UnsafeTargetError("Not a public host name");
  const addrs = await lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (addrs.length === 0) throw new UnsafeTargetError("Host does not resolve");
  for (const a of addrs) {
    const ok = a.family === 4 ? isPublicIPv4(a.address) : isPublicIPv6(a.address);
    if (!ok) throw new UnsafeTargetError("Host resolves to a private address");
  }
  const first = addrs[0]!;
  return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
}

/** Throws unless the URL is https on a public DNS name that resolves only to public addresses. */
export async function assertPublicHttps(raw: string): Promise<URL> {
  return (await resolvePublicHttps(raw)).url;
}

type LookupCallback = (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void;

/**
 * POSTs a small form body to a vetted target and returns the status code. The socket
 * connects to `target.address` only; the host name is still used for TLS (SNI and
 * certificate check) and the Host header.
 */
export function postToPinnedAddress(target: PublicTarget, body: string, timeoutMs = 6000): Promise<number> {
  const { url, address, family } = target;
  return new Promise<number>((resolve, reject) => {
    const req = request(
      {
        host: url.hostname,
        servername: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        agent: false,
        timeout: timeoutMs,
        headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body), "user-agent": "AtlasOptim/1.0 (personal dashboard)" },
        // Never resolve the name again: hand back the address that passed the checks.
        lookup: (_host: string, options: { all?: boolean }, cb: LookupCallback) => (options?.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // The body is never read.
        res.destroy();
        resolve(status);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

/** Sends the RFC 8058 one-click unsubscribe POST. True when the sender accepted it (2xx or 3xx). */
export async function oneClickUnsubscribe(raw: string): Promise<boolean> {
  const status = await postToPinnedAddress(await resolvePublicHttps(raw), "List-Unsubscribe=One-Click");
  return status >= 200 && status < 400;
}
