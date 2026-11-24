/**
 * Encrypted store for operator-managed configuration (Stripe keys, SMTP login, notification
 * addresses, integrations). Values are written by super admins from the dashboard and applied to
 * process.env at boot, overriding backend/.env for the same key.
 *
 * Security properties:
 * - AES-256-GCM per value, random 96-bit IV, key name bound as additional authenticated data, so a
 *   ciphertext cannot be moved to another key or modified without detection.
 * - The 32-byte master key (SETTINGS_ENCRYPTION_KEY) lives only in the server environment and can
 *   never be read or changed through the API.
 * - Only allowlisted keys are accepted or applied. Bootstrap keys (database, JWT, master key, super
 *   admin list, ports, filesystem paths) are locked to the server environment.
 * - Secret values are write-only: nothing in this module returns a plaintext secret to callers
 *   outside the process environment. Previews expose at most a known prefix and the last 4 chars.
 * - File written atomically (temp file + rename) with mode 0600.
 */
import {createCipheriv, createDecipheriv, createHmac, randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type SettingKind = 'secret' | 'text' | 'email' | 'url' | 'origins' | 'bool' | 'onoff' | 'int' | 'sender';
export type SettingDef = {
  key: string; group: string; label: string; help: string; kind: SettingKind;
  pattern?: RegExp; patternHint?: string; min?: number; max?: number; required?: boolean;
};
export type SettingGroup = {id: string; label: string; description: string};

export const SETTING_GROUPS: SettingGroup[] = [
  {id: 'payments', label: 'Payments (Stripe)', description: 'Keys from Stripe Dashboard → Developers → API keys and Webhooks. Secret and publishable keys must be the same mode (live or test).'},
  {id: 'email', label: 'Email sending', description: 'The mailbox notifications are sent from. For Gmail use smtp.gmail.com, port 465, the full address as user, and a Google App Password (not your normal password).'},
  {id: 'notifications', label: 'Who receives notifications', description: 'Team addresses that receive new inquiries, finance alerts and customer replies.'},
  {id: 'access', label: 'Door access (Kisi) and Workspace', description: 'Kisi API key and the switches for automatic door access and live monitoring.'},
  {id: 'storage', label: 'Media storage (Cloudflare R2)', description: 'Bucket used for uploaded images.'},
  {id: 'push', label: 'Browser push notifications', description: 'VAPID key pair used to send push notifications.'},
  {id: 'integrations', label: 'Integrations', description: 'Shared secrets for automation tools.'},
  {id: 'site', label: 'Website addresses', description: 'Public origins used for links, CORS and emails. A wrong value can break checkout links; change with care.'},
  {id: 'workers', label: 'Background workers', description: 'Switch background jobs on or off.'},
];

const B64URL = /^[A-Za-z0-9_-]+$/;
export const SETTINGS: SettingDef[] = [
  {key: 'STRIPE_SECRET_KEY', group: 'payments', label: 'Secret key', help: 'Starts with sk_live_ (real payments) or sk_test_ (test cards). Restricted keys (rk_) also work.', kind: 'secret', pattern: /^(sk|rk)_(live|test)_[A-Za-z0-9]{16,240}$/, patternHint: 'must start with sk_live_, sk_test_, rk_live_ or rk_test_'},
  {key: 'STRIPE_PUBLISHABLE_KEY', group: 'payments', label: 'Publishable key', help: 'Starts with pk_live_ or pk_test_. Shown to browsers by design.', kind: 'text', pattern: /^pk_(live|test)_[A-Za-z0-9]{16,240}$/, patternHint: 'must start with pk_live_ or pk_test_'},
  {key: 'STRIPE_WEBHOOK_SECRET', group: 'payments', label: 'Webhook signing secret', help: 'Starts with whsec_. From the webhook endpoint pointing to /api/webhooks/stripe/.', kind: 'secret', pattern: /^whsec_[A-Za-z0-9+/=]{16,240}$/, patternHint: 'must start with whsec_'},

  {key: 'SMTP_HOST', group: 'email', label: 'SMTP server', help: 'For Gmail: smtp.gmail.com', kind: 'text', pattern: /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/, patternHint: 'must be a host name like smtp.gmail.com'},
  {key: 'SMTP_PORT', group: 'email', label: 'SMTP port', help: '465 (SSL) or 587 (STARTTLS).', kind: 'int', min: 1, max: 65535},
  {key: 'SMTP_USER', group: 'email', label: 'Login (email address)', help: 'The full mailbox address, e.g. notifications@yourdomain.com', kind: 'email'},
  {key: 'SMTP_PASSWORD', group: 'email', label: 'Password / Google App Password', help: 'For Gmail create an App Password at myaccount.google.com/apppasswords (16 letters). Spaces are removed automatically.', kind: 'secret'},
  {key: 'SMTP_FROM', group: 'email', label: 'Send emails as', help: 'Name and address shown to recipients, e.g. Workspace Junction <notifications@yourdomain.com>. Gmail requires this address to be the login or a verified alias.', kind: 'sender'},
  {key: 'REPLY_TO_EMAIL', group: 'email', label: 'Reply-to address for customer emails', help: 'Where customer replies go. Leave as dashboard-cleared to use the sender.', kind: 'email'},

  {key: 'INQUIRY_TO', group: 'notifications', label: 'Admin / team inbox', help: 'Receives new website inquiries and customer support requests.', kind: 'email'},
  {key: 'FINANCE_NOTIFICATION_EMAIL', group: 'notifications', label: 'Finance alerts inbox', help: 'Receives paid orders, renewals, failed payments and refunds.', kind: 'email'},

  {key: 'KISI_API_KEY', group: 'access', label: 'Kisi API key', help: 'From Kisi → Integrations → API keys.', kind: 'secret', pattern: /^[A-Za-z0-9_-]{16,128}$/, patternHint: 'must be 16-128 letters or digits'},
  {key: 'KISI_ENABLED', group: 'access', label: 'Automatic door access for paid packages', help: 'When on, paid packages mapped in Door access receive Kisi access automatically.', kind: 'bool'},
  {key: 'KISI_LIVE_WRITES', group: 'access', label: 'Allow changes to the live Kisi account', help: 'When off, the site only reads Kisi and never grants or removes access.', kind: 'bool'},
  {key: 'WORKSPACE_LIVE_MONITOR', group: 'access', label: 'Live Workspace monitor', help: 'Refresh Kisi and Sheet data on the Workspace screen.', kind: 'bool'},
  {key: 'WORKSPACE_LIVE_INTERVAL_SECONDS', group: 'access', label: 'Monitor refresh interval (seconds)', help: '30 to 3600.', kind: 'int', min: 30, max: 3600},
  {key: 'WORKSPACE_SHEET_ID', group: 'access', label: 'Workspace Google Sheet ID', help: 'The long ID in the Sheet URL.', kind: 'text', pattern: /^[A-Za-z0-9_-]{20,100}$/, patternHint: 'must be a Google Sheet ID'},

  {key: 'R2_ACCOUNT_ID', group: 'storage', label: 'Account ID', help: '32-character Cloudflare account ID.', kind: 'text', pattern: /^[a-f0-9]{32}$/i, patternHint: 'must be 32 hexadecimal characters'},
  {key: 'R2_ACCESS_KEY_ID', group: 'storage', label: 'Access key ID', help: 'R2 API token access key ID.', kind: 'secret', pattern: /^[A-Za-z0-9]{16,128}$/, patternHint: 'must be letters and digits'},
  {key: 'R2_SECRET_ACCESS_KEY', group: 'storage', label: 'Secret access key', help: 'R2 API token secret.', kind: 'secret', pattern: /^[A-Za-z0-9]{32,128}$/, patternHint: 'must be letters and digits'},
  {key: 'R2_BUCKET_NAME', group: 'storage', label: 'Bucket name', help: 'Lowercase bucket name.', kind: 'text', pattern: /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, patternHint: 'must be a lowercase bucket name'},
  {key: 'R2_ENDPOINT', group: 'storage', label: 'S3 endpoint', help: 'https://<account>.r2.cloudflarestorage.com', kind: 'url'},
  {key: 'R2_PUBLIC_URL', group: 'storage', label: 'Public URL', help: 'Public bucket or custom domain URL used in image links.', kind: 'url'},
  {key: 'R2_REGION', group: 'storage', label: 'Region', help: 'Usually auto.', kind: 'text', pattern: /^[a-z0-9-]{2,32}$/, patternHint: 'must be like auto'},

  {key: 'VAPID_PUBLIC_KEY', group: 'push', label: 'Public key', help: 'Base64url VAPID public key.', kind: 'text', pattern: /^[A-Za-z0-9_-]{80,100}$/, patternHint: 'must be a base64url VAPID public key'},
  {key: 'VAPID_PRIVATE_KEY', group: 'push', label: 'Private key', help: 'Base64url VAPID private key.', kind: 'secret', pattern: /^[A-Za-z0-9_-]{40,50}$/, patternHint: 'must be a base64url VAPID private key'},
  {key: 'VAPID_SUBJECT', group: 'push', label: 'Contact (subject)', help: 'mailto:you@example.com or an https URL.', kind: 'text', pattern: /^(mailto:[^\s@<>]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+|https:\/\/[^\s]{3,200})$/, patternHint: 'must be mailto:address or an https URL'},

  {key: 'N8N_WEBHOOK_SECRET', group: 'integrations', label: 'n8n webhook secret', help: 'Shared secret n8n sends to /api/integrations/n8n/events. At least 24 characters.', kind: 'secret', pattern: /^[\x21-\x7e]{24,256}$/, patternHint: 'must be 24-256 visible characters'},

  {key: 'FRONTEND_URL', group: 'site', label: 'Main website origin', help: 'e.g. https://workspacejunction.com (no path).', kind: 'origins', required: true},
  {key: 'FRONTEND_URLS', group: 'site', label: 'Extra allowed origins', help: 'Comma-separated origins, no wildcards.', kind: 'origins'},
  {key: 'SITE_URL', group: 'site', label: 'Canonical site URL', help: 'Used in journal links.', kind: 'url'},
  {key: 'API_ORIGIN', group: 'site', label: 'API origin', help: 'Base for uploaded media links.', kind: 'url'},

  {key: 'OUTBOX_WORKER', group: 'workers', label: 'Email outbox worker', help: 'Sends queued emails.', kind: 'onoff'},
  {key: 'REMINDER_WORKER', group: 'workers', label: 'Booking reminder worker', help: 'Sends booking reminders.', kind: 'onoff'},
  {key: 'MARKETING_WORKER', group: 'workers', label: 'Marketing campaign worker', help: 'Sends scheduled campaigns.', kind: 'onoff'},
  {key: 'MARKETING_RATE_PER_MINUTE', group: 'workers', label: 'Marketing emails per minute', help: '1 to 600.', kind: 'int', min: 1, max: 600},
  {key: 'WEB_PUSH_DELIVERY', group: 'workers', label: 'Push notification delivery', help: 'Sends browser push notifications.', kind: 'onoff'},
  {key: 'WORKSPACE_CLONE_AUTO_REPORT', group: 'workers', label: 'Weekly Workspace report', help: 'Generates the Monday report automatically.', kind: 'onoff'},
];
const BY_KEY = new Map(SETTINGS.map(s => [s.key, s]));

/** Bootstrap configuration that must never be readable or writable through the API. */
export const LOCKED_KEYS = ['DATABASE_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'JWT_SECRET', 'SETTINGS_ENCRYPTION_KEY', 'SETTINGS_VAULT_PATH', 'SUPER_ADMIN_EMAILS', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'PORT', 'HOST', 'NODE_ENV', 'UPLOAD_DIR', 'MAIL_CAPTURE_DIR', 'WORKSPACE_CLONE_REFERENCE_PATH', 'SWAGGER_ENABLED', 'INVENTORY_CHECKOUT_ENFORCEMENT'];

export const isManageable = (key: string) => BY_KEY.has(key) && !LOCKED_KEYS.includes(key);
export const settingDef = (key: string) => BY_KEY.get(key);

const EMAIL = /^[^\s@<>()",;:\\[\]]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Normalise and validate one value. Error messages never echo the value. */
export function normaliseSetting(key: string, raw: unknown): string {
  const def = BY_KEY.get(key);
  if (!def || LOCKED_KEYS.includes(key)) throw new SettingError(key, 'cannot be managed from the dashboard');
  if (typeof raw !== 'string') throw new SettingError(key, 'must be text');
  let value = raw.trim();
  if (!value) throw new SettingError(key, 'cannot be empty (use Clear to remove a dashboard value)');
  if (value.length > 4096 || CONTROL.test(value)) throw new SettingError(key, 'contains invalid characters');
  if (key === 'SMTP_PASSWORD' && /^[a-z]{4}( [a-z]{4}){3}$/i.test(value)) value = value.replace(/ /g, '');
  switch (def.kind) {
    case 'email': if (value.length > 254 || !EMAIL.test(value)) throw new SettingError(key, 'must be a valid email address'); value = value.toLowerCase(); break;
    case 'sender': {
      const m = /^(?:([^<>"\r\n]{1,100})\s)?<([^<>\s]+)>$/.exec(value);
      const address = m ? m[2] : value;
      if (address.length > 254 || !EMAIL.test(address)) throw new SettingError(key, 'must be an email address or Name <email@domain>');
      if (m && /[<>"]/.test(m[1] || '')) throw new SettingError(key, 'name contains invalid characters');
      break;
    }
    case 'url': {
      let url: URL; try { url = new URL(value); } catch { throw new SettingError(key, 'must be a full https:// URL'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new SettingError(key, 'must be an https:// URL without credentials');
      value = url.toString().replace(/\/$/, '');
      break;
    }
    case 'origins': {
      const parts = value.split(',').map(v => v.trim()).filter(Boolean);
      if (!parts.length || parts.length > 10) throw new SettingError(key, 'must list 1 to 10 origins');
      for (const part of parts) {
        let url: URL; try { url = new URL(part); } catch { throw new SettingError(key, 'must contain full origins like https://example.com'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || part.includes('*')) throw new SettingError(key, 'must contain origins only (no paths or wildcards)');
        if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new SettingError(key, 'must use https except for localhost');
      }
      value = parts.map(p => new URL(p).origin).join(',');
      break;
    }
    case 'bool': if (!['true', 'false'].includes(value)) throw new SettingError(key, 'must be true or false'); break;
    case 'onoff': if (!['on', 'off'].includes(value)) throw new SettingError(key, 'must be on or off'); break;
    case 'int': {
      if (!/^\d{1,6}$/.test(value)) throw new SettingError(key, 'must be a whole number');
      const n = Number(value);
      if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) throw new SettingError(key, 'must be between ' + def.min + ' and ' + def.max);
      value = String(n);
      break;
    }
    case 'secret': case 'text': if (/\s/.test(value)) throw new SettingError(key, 'must not contain spaces'); break;
  }
  if (def.pattern && !def.pattern.test(value)) throw new SettingError(key, def.patternHint || 'has an invalid format');
  return value;
}

/** Checks that depend on more than one key, run against the full effective configuration. */
export function crossCheck(effective: Record<string, string | undefined>) {
  const sk = effective.STRIPE_SECRET_KEY, pk = effective.STRIPE_PUBLISHABLE_KEY;
  const mode = (v?: string) => v ? (/_live_/.test(v) ? 'live' : /_test_/.test(v) ? 'test' : null) : null;
  if (sk && pk && mode(sk) !== mode(pk)) throw new SettingError('STRIPE_PUBLISHABLE_KEY', 'must be the same mode (live or test) as the secret key');
  if (effective.KISI_LIVE_WRITES === 'true' && !effective.KISI_API_KEY) throw new SettingError('KISI_LIVE_WRITES', 'needs a Kisi API key first');
  if (!effective.FRONTEND_URL) throw new SettingError('FRONTEND_URL', 'is required');
}

export class SettingError extends Error {
  constructor(public readonly key: string, reason: string) { super((settingDef(key)?.label || key) + ' ' + reason + '.'); }
}

/** Display-safe preview. Secrets never reveal more than a known public prefix and the last 4 chars. */
export function preview(key: string, value: string | undefined): string | null {
  if (!value) return null;
  const def = BY_KEY.get(key);
  if (def?.kind !== 'secret') return value;
  const prefix = /^(sk_live_|sk_test_|rk_live_|rk_test_|whsec_)/.exec(value)?.[1] || '';
  return value.length >= 24 ? prefix + '••••' + value.slice(-4) : prefix + '••••••••';
}

/* ───────────────────────────── Encrypted file ───────────────────────────── */

type Entry = {iv: string; tag: string; ct: string; updatedAt: string; updatedBy: string};
type VaultFile = {version: 1; entries: Record<string, Entry>};
export type VaultMeta = {updatedAt: string; updatedBy: string};

export function masterKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.SETTINGS_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(raw) ? key : null;
}
export function vaultPath(env: Record<string, string | undefined> = process.env) {
  return env.SETTINGS_VAULT_PATH?.trim() || path.resolve(__dirname, '../private/settings.vault.json');
}
const aad = (key: string) => Buffer.from('wsj-settings:v1:' + key, 'utf8');

export function encryptValue(master: Buffer, key: string, value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', master, iv);
  cipher.setAAD(aad(key));
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64')};
}
export function decryptValue(master: Buffer, key: string, entry: {iv: string; tag: string; ct: string}) {
  const decipher = createDecipheriv('aes-256-gcm', master, Buffer.from(entry.iv, 'base64'));
  decipher.setAAD(aad(key));
  decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(entry.ct, 'base64')), decipher.final()]).toString('utf8');
}
/** Keyed fingerprint for the audit trail: shows that a value changed without revealing it. */
export function fingerprint(master: Buffer, key: string, value: string) {
  return createHmac('sha256', master).update(key + '\u0000' + value).digest('hex').slice(0, 12);
}

function readFile(file: string): VaultFile {
  if (!fs.existsSync(file)) return {version: 1, entries: {}};
  const stat = fs.statSync(file);
  if (stat.size > 512 * 1024) throw new Error('Settings vault is too large');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (parsed?.version !== 1 || typeof parsed.entries !== 'object' || !parsed.entries) throw new Error('Settings vault has an unknown format');
  return parsed as VaultFile;
}
function writeFile(file: string, data: VaultFile) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const tmp = file + '.' + process.pid + '.' + randomBytes(6).toString('hex') + '.tmp';
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeSync(fd, JSON.stringify(data, null, 1)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

/** Baseline values from backend/.env before dashboard overrides, so Clear can fall back to them. */
const baseline: Record<string, string | undefined> = {};
const fromVault = new Set<string>();
let bootError: string | null = null;

/**
 * Apply stored values to the environment. Called once, synchronously, before any module reads its
 * configuration. A missing/invalid master key or an undecryptable entry never stops the API: the
 * affected value falls back to backend/.env and the problem is reported to super admins.
 */
export function applyVaultToEnv(env: NodeJS.ProcessEnv = process.env) {
  for (const def of SETTINGS) if (!(def.key in baseline)) baseline[def.key] = env[def.key];
  const master = masterKey(env);
  if (!master) { bootError = env.SETTINGS_ENCRYPTION_KEY ? 'SETTINGS_ENCRYPTION_KEY must be 32 random bytes in base64.' : null; return; }
  let data: VaultFile;
  try { data = readFile(vaultPath(env)); } catch (error) { bootError = 'Settings vault could not be read: ' + (error instanceof Error ? error.message : 'unknown error'); console.error('[settings] ' + bootError); return; }
  const failed: string[] = [];
  for (const [key, entry] of Object.entries(data.entries)) {
    if (!isManageable(key)) continue;
    try { env[key] = decryptValue(master, key, entry); fromVault.add(key); }
    catch { failed.push(key); }
  }
  bootError = failed.length ? 'These stored settings failed integrity checks and were ignored: ' + failed.join(', ') : null;
  if (bootError) console.error('[settings] ' + bootError);
  if (fromVault.size) console.log('[settings] Applied ' + fromVault.size + ' dashboard-managed setting(s).');
}

export function vaultState() { return {bootError, fromVault: new Set(fromVault), baseline: {...baseline}}; }

/** Read stored metadata (never values) for the overview. */
export function vaultMeta(env: Record<string, string | undefined> = process.env): Record<string, VaultMeta> {
  const data = readFile(vaultPath(env));
  return Object.fromEntries(Object.entries(data.entries).filter(([k]) => isManageable(k)).map(([k, e]) => [k, {updatedAt: e.updatedAt, updatedBy: e.updatedBy}]));
}

/**
 * Persist a batch of changes atomically. `null` removes the dashboard value (backend/.env applies
 * again). Returns the previous fingerprints for the audit trail.
 */
export function writeChanges(changes: Record<string, string | null>, actor: string, env: NodeJS.ProcessEnv = process.env) {
  const master = masterKey(env);
  if (!master) throw new Error('Settings encryption key is not configured');
  const file = vaultPath(env);
  const data = readFile(file);
  const now = new Date().toISOString();
  const audit: Array<{key: string; cleared: boolean; before: string | null; after: string | null}> = [];
  for (const [key, value] of Object.entries(changes)) {
    if (!isManageable(key)) throw new SettingError(key, 'cannot be managed from the dashboard');
    const before = env[key] ? fingerprint(master, key, env[key]!) : null;
    if (value === null) delete data.entries[key];
    else data.entries[key] = {...encryptValue(master, key, value), updatedAt: now, updatedBy: actor};
    audit.push({key, cleared: value === null, before, after: value === null ? (baseline[key] ? fingerprint(master, key, baseline[key]!) : null) : fingerprint(master, key, value)});
  }
  writeFile(file, data);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) { fromVault.delete(key); if (baseline[key] === undefined) delete env[key]; else env[key] = baseline[key]; }
    else { fromVault.add(key); env[key] = value; }
  }
  return audit;
}

export function superAdminEmails(env: Record<string, string | undefined> = process.env) {
  return (env.SUPER_ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(v => EMAIL.test(v));
}
