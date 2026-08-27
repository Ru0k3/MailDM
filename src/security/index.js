import crypto from 'node:crypto';
import nacl from 'tweetnacl';

export function verifyDiscordRequest(rawBody, signature, timestamp, publicKey) {
  if (!rawBody || !signature || !timestamp || !publicKey) return false;
  try {
    const message = Buffer.from(`${timestamp}${rawBody}`);
    return nacl.sign.detached.verify(message, Buffer.from(signature, 'hex'), Buffer.from(publicKey, 'hex'));
  } catch {
    return false;
  }
}

export function createSignedState(secret, discordUserId) {
  const nonce = crypto.randomBytes(24).toString('base64url');
  const payload = `${discordUserId}.${nonce}`;
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function verifySignedState(secret, state) {
  const parts = String(state ?? '').split('.');
  if (parts.length !== 3) return null;
  const [discordUserId, nonce, mac] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${discordUserId}.${nonce}`).digest('base64url');
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return discordUserId;
}

export function encryptSecret(value, secret) {
  if (!value) return null;
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(value, secret) {
  if (!value) return null;
  const [ivText, tagText, dataText] = value.split('.');
  const key = crypto.createHash('sha256').update(secret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
}
