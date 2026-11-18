import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encryption for stored credentials (OAuth refresh tokens). AES-256-GCM with a key that
// lives only in the ATLAS_VAULT_KEY environment variable, never in the database, so a
// database leak alone does not leak the token. The "context" (e.g. "google:<owner id>")
// is bound in as additional authenticated data: a ciphertext copied to another row or
// provider fails to decrypt.
//
// Format: v1.<iv base64url>.<tag base64url>.<ciphertext base64url>

const VERSION = "v1";

export function parseKey(raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ATLAS_VAULT_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function seal(key: Buffer, plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function open(key: Buffer, sealed: string, context: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Unrecognized sealed value");
  const [, iv, tag, ct] = parts as [string, string, string, string];
  const ivBytes = Buffer.from(iv, "base64url");
  const tagBytes = Buffer.from(tag, "base64url");
  // GCM accepts shortened tags unless told otherwise, and a short tag is far easier to
  // forge. Only the full 96-bit nonce and 128-bit tag that seal() writes are accepted.
  if (ivBytes.length !== 12 || tagBytes.length !== 16) throw new Error("Unrecognized sealed value");
  const decipher = createDecipheriv("aes-256-gcm", key, ivBytes, { authTagLength: 16 });
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tagBytes);
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
