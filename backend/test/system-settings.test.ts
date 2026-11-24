import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {hash} from 'bcryptjs';
import {applyVaultToEnv, crossCheck, decryptValue, encryptValue, LOCKED_KEYS, normaliseSetting, preview, vaultState, writeChanges} from '../src/settings-vault';
import {SystemSettingsController, SystemSettingsService} from '../src/system-settings';
import {AuthGuard} from '../src/core';

const SK = 'sk_test_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6';
const SK_LIVE = 'sk_live_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4';
const PK_TEST = 'pk_test_' + 'Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6';

test('encryption round-trips and binds each ciphertext to its key name', () => {
  const master = randomBytes(32);
  const box = encryptValue(master, 'STRIPE_SECRET_KEY', SK);
  assert.equal(decryptValue(master, 'STRIPE_SECRET_KEY', box), SK);
  assert.notEqual(box.ct, Buffer.from(SK).toString('base64'));
  assert.throws(() => decryptValue(master, 'SMTP_PASSWORD', box), 'ciphertext moved to another key must fail');
  assert.throws(() => decryptValue(randomBytes(32), 'STRIPE_SECRET_KEY', box), 'wrong master key must fail');
  const tampered = {...box, ct: Buffer.from(Buffer.from(box.ct, 'base64').map((b, i) => i === 0 ? b ^ 1 : b)).toString('base64')};
  assert.throws(() => decryptValue(master, 'STRIPE_SECRET_KEY', tampered), 'modified ciphertext must fail');
  assert.notEqual(encryptValue(master, 'K', 'same').iv, encryptValue(master, 'K', 'same').iv, 'IVs must be random');
});

test('validation accepts real formats and rejects bad ones without echoing the value', () => {
  assert.equal(normaliseSetting('STRIPE_SECRET_KEY', '  ' + SK + ' '), SK);
  assert.equal(normaliseSetting('STRIPE_PUBLISHABLE_KEY', PK_TEST), PK_TEST);
  assert.equal(normaliseSetting('SMTP_PASSWORD', 'abcd efgh ijkl mnop'), 'abcdefghijklmnop');
  assert.equal(normaliseSetting('INQUIRY_TO', 'Team@Example.com'), 'team@example.com');
  assert.equal(normaliseSetting('SMTP_FROM', 'Workspace Junction <hello@example.com>'), 'Workspace Junction <hello@example.com>');
  assert.equal(normaliseSetting('FRONTEND_URL', 'https://wp.example.com/'), 'https://wp.example.com');
  assert.equal(normaliseSetting('KISI_ENABLED', 'true'), 'true');
  assert.equal(normaliseSetting('WORKSPACE_LIVE_INTERVAL_SECONDS', '60'), '60');
  const secretish = 'sk_fake_SHOULD_NOT_APPEAR_123456';
  for (const [key, value] of [['STRIPE_SECRET_KEY', secretish], ['STRIPE_SECRET_KEY', SK + '\nX'], ['SMTP_FROM', 'evil@example.com\r\nBcc: x@y.z'], ['INQUIRY_TO', 'not-an-email'], ['FRONTEND_URL', 'https://*.example.com'], ['FRONTEND_URL', 'https://example.com/path'], ['FRONTEND_URL', 'http://example.com'], ['WORKSPACE_LIVE_INTERVAL_SECONDS', '5'], ['KISI_ENABLED', 'yes'], ['API_ORIGIN', 'http://insecure.example.com'], ['API_ORIGIN', 'https://user:pass@example.com'], ['STRIPE_WEBHOOK_SECRET', '   ']] as const) {
    assert.throws(() => normaliseSetting(key, value), (e: Error) => (!value.trim() || !e.message.includes(value.trim())) && !e.message.includes(secretish));
  }
});

test('bootstrap keys can never be managed from the dashboard', () => {
  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'SETTINGS_ENCRYPTION_KEY', 'SUPER_ADMIN_EMAILS', 'NODE_ENV', 'SETTINGS_VAULT_PATH', 'UPLOAD_DIR']) {
    assert.ok(LOCKED_KEYS.includes(key));
    assert.throws(() => normaliseSetting(key, 'anything'));
  }
  assert.throws(() => normaliseSetting('SOME_UNKNOWN_KEY', 'x'));
});

test('cross checks reject mixed Stripe modes and unsafe Kisi switches', () => {
  assert.throws(() => crossCheck({FRONTEND_URL: 'https://a.example', STRIPE_SECRET_KEY: SK_LIVE, STRIPE_PUBLISHABLE_KEY: PK_TEST}), /same mode/);
  assert.throws(() => crossCheck({FRONTEND_URL: 'https://a.example', KISI_LIVE_WRITES: 'true'}), /Kisi API key/);
  assert.doesNotThrow(() => crossCheck({FRONTEND_URL: 'https://a.example', STRIPE_SECRET_KEY: SK, STRIPE_PUBLISHABLE_KEY: PK_TEST}));
});

test('previews never reveal more than a known prefix and the last 4 characters', () => {
  assert.equal(preview('STRIPE_SECRET_KEY', SK), 'sk_test_••••' + SK.slice(-4));
  assert.equal(preview('SMTP_PASSWORD', 'abcdefghijklmnop'), '••••••••');
  assert.equal(preview('INQUIRY_TO', 'team@example.com'), 'team@example.com');
  assert.equal(preview('STRIPE_SECRET_KEY', undefined), null);
});

/* ───────── Vault file + service (shared process env, run in order) ───────── */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsj-vault-'));
const file = path.join(dir, 'settings.vault.json');
process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.SETTINGS_VAULT_PATH = file;
process.env.SUPER_ADMIN_EMAILS = 'owner@example.com';
process.env.FRONTEND_URL = 'https://site.example.com';
process.env.INQUIRY_TO = 'env-inbox@example.com';
delete process.env.pm_id;
applyVaultToEnv();

test('stored values are encrypted on disk, applied on boot, and clearing restores backend/.env', () => {
  writeChanges({STRIPE_SECRET_KEY: SK, INQUIRY_TO: 'dash@example.com'}, 'owner@example.com');
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes(SK) && !raw.includes('dash@example.com'), 'plaintext must never be written');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const fresh: NodeJS.ProcessEnv = {SETTINGS_ENCRYPTION_KEY: process.env.SETTINGS_ENCRYPTION_KEY, SETTINGS_VAULT_PATH: file, INQUIRY_TO: 'env-inbox@example.com'};
  applyVaultToEnv(fresh);
  assert.equal(fresh.STRIPE_SECRET_KEY, SK);
  assert.equal(fresh.INQUIRY_TO, 'dash@example.com');
  writeChanges({INQUIRY_TO: null, STRIPE_SECRET_KEY: null}, 'owner@example.com');
  assert.equal(process.env.INQUIRY_TO, 'env-inbox@example.com');
  assert.ok(!vaultState().fromVault.has('INQUIRY_TO'));
});

test('a vault entry for a locked key is ignored even if planted in the file', () => {
  const master = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY!, 'base64');
  fs.writeFileSync(file, JSON.stringify({version: 1, entries: {JWT_SECRET: {...encryptValue(master, 'JWT_SECRET', 'attacker-chosen'), updatedAt: '', updatedBy: ''}}}));
  const env: NodeJS.ProcessEnv = {SETTINGS_ENCRYPTION_KEY: process.env.SETTINGS_ENCRYPTION_KEY, SETTINGS_VAULT_PATH: file, JWT_SECRET: 'original'};
  applyVaultToEnv(env);
  assert.equal(env.JWT_SECRET, 'original');
  fs.writeFileSync(file, JSON.stringify({version: 1, entries: {}}));
});

async function serviceFixture(user: Record<string, unknown>) {
  const audits: any[] = [];
  const db: any = {
    user: {findUnique: async () => user},
    audit: {count: async ({where}: any) => audits.filter(a => a.action === where.action && a.resourceId === where.resourceId).length, create: async ({data}: any) => {audits.push(data); return data;}},
  };
  return {service: new SystemSettingsService(db), audits};
}
const owner = async () => ({id: 'u1', email: 'owner@example.com', role: 'ADMIN', active: true, passwordHash: await hash('correct horse battery', 4)});

test('only active ADMINs on the server-side super admin list are allowed', async () => {
  for (const user of [{...(await owner()), role: 'EDITOR'}, {...(await owner()), active: false}, {...(await owner()), email: 'other-admin@example.com'}]) {
    const {service} = await serviceFixture(user);
    await assert.rejects(service.assertSuperAdmin({id: 'u1', email: String(user.email), role: String(user.role)}), /super admins/);
  }
  const saved = process.env.SUPER_ADMIN_EMAILS; process.env.SUPER_ADMIN_EMAILS = '';
  try { const {service} = await serviceFixture(await owner()); await assert.rejects(service.assertSuperAdmin({id: 'u1', email: 'owner@example.com', role: 'ADMIN'})); }
  finally { process.env.SUPER_ADMIN_EMAILS = saved; }
  const {service} = await serviceFixture(await owner());
  await service.assertSuperAdmin({id: 'u1', email: 'owner@example.com', role: 'ADMIN'});
});

test('wrong password changes nothing, is audited, and locks after 5 attempts', async () => {
  const {service, audits} = await serviceFixture(await owner());
  const actor = {id: 'u1', email: 'owner@example.com', role: 'ADMIN'};
  const before = fs.readFileSync(file, 'utf8');
  for (let i = 0; i < 5; i++) await assert.rejects(service.update(actor, {changes: {INQUIRY_TO: 'x@example.com'}, currentPassword: 'wrong'}, '1.2.3.4'), /incorrect/);
  assert.equal(audits.filter(a => a.action === 'SETTINGS_REAUTH_FAILED').length, 5);
  await assert.rejects(service.update(actor, {changes: {INQUIRY_TO: 'x@example.com'}, currentPassword: 'correct horse battery'}, '1.2.3.4'), (e: any) => e.getStatus?.() === 429);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('successful change is saved, audited by name and fingerprint only, and never returns values', async () => {
  const {service, audits} = await serviceFixture(await owner());
  const actor = {id: 'u1', email: 'owner@example.com', role: 'ADMIN'};
  const result = await service.update(actor, {changes: {FINANCE_NOTIFICATION_EMAIL: 'finance@example.com', KISI_ENABLED: 'true'}, currentPassword: 'correct horse battery'}, '1.2.3.4');
  assert.deepEqual(result.saved.sort(), ['FINANCE_NOTIFICATION_EMAIL', 'KISI_ENABLED']);
  assert.equal(result.restarting, false);
  assert.equal(process.env.FINANCE_NOTIFICATION_EMAIL, 'finance@example.com');
  const updates = audits.filter(a => a.action === 'SYSTEM_SETTING_UPDATED');
  assert.equal(updates.length, 2);
  assert.ok(!JSON.stringify(updates).includes('finance@example.com'));
  assert.match(updates[0].details.after, /^[a-f0-9]{12}$/);
});

test('locked or unknown keys are rejected through the API even with a valid password', async () => {
  const {service} = await serviceFixture(await owner());
  const actor = {id: 'u1', email: 'owner@example.com', role: 'ADMIN'};
  for (const key of ['JWT_SECRET', 'DATABASE_URL', 'SUPER_ADMIN_EMAILS', 'NOT_A_SETTING']) await assert.rejects(service.update(actor, {changes: {[key]: 'x'}, currentPassword: 'correct horse battery'}, ''), /cannot be managed/);
  process.env.STRIPE_SECRET_KEY = SK;
  try { await assert.rejects(service.update(actor, {changes: {STRIPE_PUBLISHABLE_KEY: 'pk_live_' + 'x'.repeat(24)}, currentPassword: 'correct horse battery'}, ''), /same mode/); }
  finally { delete process.env.STRIPE_SECRET_KEY; }
});

test('overview never contains a plaintext secret', async () => {
  const {service} = await serviceFixture(await owner());
  process.env.STRIPE_SECRET_KEY = SK; process.env.SMTP_PASSWORD = 'abcdefghijklmnop'; process.env.KISI_API_KEY = 'kisi' + 'k'.repeat(28);
  const json = JSON.stringify(service.overview());
  assert.ok(!json.includes(SK) && !json.includes('abcdefghijklmnop') && !json.includes('k'.repeat(28)));
  assert.ok(!json.includes(process.env.SETTINGS_ENCRYPTION_KEY!));
  assert.ok(json.includes('"key":"JWT_SECRET","configured"'));
});

test('controller requires an authenticated ADMIN session', () => {
  assert.deepEqual(Reflect.getMetadata('roles', SystemSettingsController), ['ADMIN']);
  assert.ok((Reflect.getMetadata('__guards__', SystemSettingsController) || []).includes(AuthGuard));
});
