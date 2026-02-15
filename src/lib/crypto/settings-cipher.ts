import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { getBootstrapEnv } from "@/lib/bootstrap-env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const decodeHexKey = (hex: string): Buffer => {
  const trimmed = hex.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const key = Buffer.from(trimmed, "hex");
    if (key.length !== 32) {
      throw new Error("DB_ENCRYPTION_KEY must decode to 32 bytes");
    }
    return key;
  }

  const key = Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error("DB_ENCRYPTION_KEY must decode to 32 bytes (hex or base64)");
  }
  return key;
};

const readKey = (): Buffer => {
  const env = getBootstrapEnv();
  return decodeHexKey(env.DB_ENCRYPTION_KEY);
};

export const encryptSetting = (plaintext: string): Buffer => {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, readKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]);
};

export const decryptSetting = (encrypted: Buffer): string => {
  if (encrypted.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Encrypted setting payload is malformed");
  }

  const iv = encrypted.subarray(0, IV_LENGTH);
  const authTag = encrypted.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = encrypted.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, readKey(), iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
};

export const __private__ = {
  decodeHexKey,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
};
