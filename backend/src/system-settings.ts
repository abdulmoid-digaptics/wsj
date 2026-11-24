/**
 * System settings: lets super admins manage Stripe keys, email sending, notification inboxes and
 * other backend configuration from the dashboard.
 *
 * Access model (defence in depth):
 * 1. AuthGuard: valid staff session (bearer token or cookie + trusted Origin for writes).
 * 2. Role ADMIN, active account.
 * 3. Super admin: email listed in SUPER_ADMIN_EMAILS, which is server-only and cannot be edited here,
 *    so no dashboard user can promote themselves.
 * 4. Every change re-verifies the account password (separate lockout: 5 failures per 15 minutes).
 * 5. Provider checks run before saving (Stripe, SMTP, Kisi, R2). Invalid credentials are rejected
 *    and nothing is stored.
 * 6. Secrets are write-only; responses carry only previews. All responses are no-store.
 * 7. Every change is audited by key name with keyed fingerprints (never values), and all super
 *    admins are emailed. The API restarts itself under PM2 so every worker uses the new values.
 */
import {BadRequestException, Controller, ForbiddenException, Get, Header, HttpCode, HttpException, Inject, Injectable, Post, Put, Req, ServiceUnavailableException, UseGuards} from '@nestjs/common';
import {ApiBearerAuth} from '@nestjs/swagger';
import {Throttle} from '@nestjs/throttler';
import {IsIn, IsObject, IsString, MaxLength, MinLength} from 'class-validator';
import {compare} from 'bcryptjs';
import Stripe from 'stripe';
import {AuthGuard, Db, Roles} from './core';
import {ValidatedBody} from './validation';
import {MailService} from './mail';
import {LOCKED_KEYS, SETTING_GROUPS, SETTINGS, SettingError, crossCheck, isManageable, masterKey, normaliseSetting, preview, superAdminEmails, vaultMeta, vaultState, writeChanges} from './settings-vault';

export class SettingsUpdateDto {
  @IsObject() changes!: Record<string, string | null>;
  @IsString() @MinLength(1) @MaxLength(256) currentPassword!: string;
}
export class SettingsTestDto {
  @IsIn(['smtp', 'stripe', 'kisi', 'r2']) target!: 'smtp' | 'stripe' | 'kisi' | 'r2';
}

type StaffUser = {id: string; email: string; role: string};
const REAUTH_WINDOW_MS = 15 * 60000, REAUTH_MAX_FAILURES = 5;
const STRIPE_KEYS = ['STRIPE_SECRET_KEY'], SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'], R2_KEYS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_ENDPOINT', 'R2_REGION'];

/** Provider checks. Each throws a short, value-free message on failure. Exported for tests. */
export const providerChecks = {
  async stripe(env: Record<string, string | undefined>) {
    const key = env.STRIPE_SECRET_KEY;
    if (!key) return 'not configured';
    try {
      const balance = await new Stripe(key, {timeout: 10000, maxNetworkRetries: 0}).balance.retrieve();
      const expectLive = /_live_/.test(key);
      if (balance.livemode !== expectLive) throw new Error('mode');
      return expectLive ? 'live mode' : 'test mode';
    } catch (error) {
      throw new BadRequestException(error instanceof Error && error.message === 'mode' ? 'Stripe reports a different mode for this secret key.' : 'Stripe rejected this secret key. Check that it is complete and not revoked.');
    }
  },
  async smtp(env: Record<string, string | undefined>) {
    if (!env.SMTP_HOST) return 'not configured';
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.default.createTransport({
      host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_PORT === '465',
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      ...(env.SMTP_USER ? {auth: {user: env.SMTP_USER, pass: env.SMTP_PASSWORD}} : {}),
    });
    try { await transport.verify(); return 'login accepted'; }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as {code?: unknown}).code) : '';
      throw new BadRequestException(code === 'EAUTH' ? 'The email server rejected the login. For Gmail, use a 16-letter App Password and the full email address.' : 'Could not connect to the email server' + (code ? ' (' + code.replace(/[^A-Z]/g, '').slice(0, 20) + ')' : '') + '. Check the server and port.');
    } finally { transport.close(); }
  },
  async kisi(env: Record<string, string | undefined>) {
    const key = env.KISI_API_KEY?.trim();
    if (!key) return 'not configured';
    let ok = false;
    try { const r = await fetch('https://api.kisi.io/groups?limit=1', {headers: {Authorization: 'KISI-LOGIN ' + key, Accept: 'application/json'}, signal: AbortSignal.timeout(10000), redirect: 'error'}); ok = r.ok; } catch { /* reported below */ }
    if (!ok) throw new BadRequestException('Kisi rejected this API key or could not be reached.');
    return 'key accepted';
  },
  async r2(env: Record<string, string | undefined>) {
    if (!env.R2_BUCKET_NAME || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return 'not configured';
    const endpoint = env.R2_ENDPOINT || (env.R2_ACCOUNT_ID ? 'https://' + env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com' : '');
    if (!endpoint) throw new BadRequestException('R2 needs an endpoint or account ID.');
    const s3 = await import('@aws-sdk/client-s3');
    const client = new s3.S3Client({region: env.R2_REGION || 'auto', endpoint, credentials: {accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY}});
    try { await client.send(new s3.HeadBucketCommand({Bucket: env.R2_BUCKET_NAME}), {abortSignal: AbortSignal.timeout(10000)}); return 'bucket reachable'; }
    catch { throw new BadRequestException('Cloudflare R2 rejected these credentials or the bucket does not exist.'); }
    finally { client.destroy(); }
  },
};

let writing = false;

@Injectable()
export class SystemSettingsService {
  constructor(@Inject(Db) private readonly db: Db) {}

  /** Throws unless the caller is an active ADMIN whose email is on the server-side super admin list. */
  async assertSuperAdmin(user: StaffUser | undefined) {
    const list = superAdminEmails();
    if (!user || !list.length) throw new ForbiddenException('System settings are restricted to super admins.');
    const row = await this.db.user.findUnique({where: {id: user.id}});
    if (!row?.active || row.role !== 'ADMIN' || !list.includes(row.email.toLowerCase())) throw new ForbiddenException('System settings are restricted to super admins.');
    return row;
  }

  overview() {
    const enabled = Boolean(masterKey());
    const state = vaultState();
    let meta: Record<string, {updatedAt: string; updatedBy: string}> = {};
    let readError: string | null = null;
    if (enabled) try { meta = vaultMeta(); } catch (error) { readError = error instanceof Error ? error.message : 'Vault unreadable'; }
    return {
      enabled,
      ...(enabled ? {} : {reason: 'SETTINGS_ENCRYPTION_KEY is not configured on the server. Settings are read-only until it is added.'}),
      warning: readError || state.bootError,
      restartManaged: process.env.pm_id !== undefined,
      groups: SETTING_GROUPS.map(group => ({
        ...group,
        settings: SETTINGS.filter(s => s.group === group.id).map(s => ({
          key: s.key, label: s.label, help: s.help, kind: s.kind, min: s.min ?? null, max: s.max ?? null,
          secret: s.kind === 'secret',
          source: state.fromVault.has(s.key) ? 'dashboard' : process.env[s.key] ? 'env' : 'unset',
          envFallback: Boolean(state.baseline[s.key]),
          configured: Boolean(process.env[s.key]),
          value: preview(s.key, process.env[s.key]),
          updatedAt: meta[s.key]?.updatedAt ?? null,
          updatedBy: meta[s.key]?.updatedBy ?? null,
        })),
      })),
      locked: LOCKED_KEYS.map(key => ({key, configured: Boolean(process.env[key])})),
    };
  }

  private async reauth(user: {id: string; passwordHash: string}, password: string) {
    const since = new Date(Date.now() - REAUTH_WINDOW_MS);
    const failures = await this.db.audit.count({where: {action: 'SETTINGS_REAUTH_FAILED', resource: 'system-settings', resourceId: user.id, createdAt: {gt: since}}});
    if (failures >= REAUTH_MAX_FAILURES) throw new HttpException('Too many incorrect passwords. Try again in 15 minutes.', 429);
    if (!(await compare(password, user.passwordHash))) {
      await this.db.audit.create({data: {actorId: user.id, action: 'SETTINGS_REAUTH_FAILED', resource: 'system-settings', resourceId: user.id}});
      throw new ForbiddenException('Your password is incorrect. No settings were changed.');
    }
  }

  async update(actor: StaffUser, body: SettingsUpdateDto, ip: string | undefined) {
    const user = await this.assertSuperAdmin(actor);
    if (!masterKey()) throw new ServiceUnavailableException('SETTINGS_ENCRYPTION_KEY is not configured on the server.');
    const entries = Object.entries(body.changes || {});
    if (!entries.length) throw new BadRequestException('No changes to save.');
    if (entries.length > SETTINGS.length) throw new BadRequestException('Too many changes in one request.');
    await this.reauth(user, body.currentPassword);
    if (writing) throw new ServiceUnavailableException('Another settings change is being saved. Try again shortly.');
    writing = true;
    try {
      const state = vaultState();
      const changes: Record<string, string | null> = {};
      for (const [key, raw] of entries) {
        if (!isManageable(key)) throw new BadRequestException(key.slice(0, 64).replace(/[^A-Z0-9_]/g, '') + ' cannot be managed from the dashboard.');
        if (raw === null) { if (!state.fromVault.has(key)) throw new BadRequestException((SETTINGS.find(s => s.key === key)?.label || key) + ' has no dashboard value to clear.'); changes[key] = null; continue; }
        try { changes[key] = normaliseSetting(key, raw); } catch (error) { throw new BadRequestException(error instanceof SettingError ? error.message : 'Invalid value.'); }
      }
      const effective: Record<string, string | undefined> = {...process.env};
      for (const [key, value] of Object.entries(changes)) effective[key] = value === null ? state.baseline[key] : value;
      try { crossCheck(effective); } catch (error) { throw new BadRequestException(error instanceof SettingError ? error.message : 'Invalid combination of settings.'); }
      const touched = (keys: string[]) => keys.some(k => k in changes && effective[k]);
      const checks: string[] = [];
      if (touched(STRIPE_KEYS)) checks.push('Stripe: ' + await providerChecks.stripe(effective));
      if (touched(SMTP_KEYS)) checks.push('Email: ' + await providerChecks.smtp(effective));
      if (touched(['KISI_API_KEY'])) checks.push('Kisi: ' + await providerChecks.kisi(effective));
      if (touched(R2_KEYS)) checks.push('R2: ' + await providerChecks.r2(effective));

      const trail = writeChanges(changes, user.email);
      for (const row of trail) await this.db.audit.create({data: {actorId: user.id, action: row.cleared ? 'SYSTEM_SETTING_CLEARED' : 'SYSTEM_SETTING_UPDATED', resource: 'system-settings', resourceId: row.key, details: {before: row.before, after: row.after, ip: (ip || '').slice(0, 64)}}});
      const keys = trail.map(r => r.key);
      const notified = this.notify(user.email, keys, ip);
      const restarting = process.env.pm_id !== undefined && process.env.NODE_ENV !== 'test';
      if (restarting) void Promise.race([notified, new Promise(r => setTimeout(r, 8000))]).finally(() => setTimeout(() => process.kill(process.pid, 'SIGTERM'), 1500));
      return {saved: keys, checks, restarting, message: restarting ? 'Saved. The API is restarting to apply the new settings (about 10 seconds).' : 'Saved. Restart the API to apply every change.'};
    } finally { writing = false; }
  }

  /** Alert every super admin. Never includes values. Best effort: a mail failure never undoes a save. */
  private async notify(actorEmail: string, keys: string[], ip: string | undefined) {
    const mail = new MailService();
    if (mail.mode() === 'none') return;
    const text = 'System settings were changed in WSJ Studio.\n\nChanged by: ' + actorEmail + '\nWhen: ' + new Date().toISOString() + '\nFrom IP: ' + (ip || 'unknown') + '\nSettings: ' + keys.join(', ') + '\n\nValues are never included in this email. If you did not expect this change, sign in, review System settings and the audit trail, and rotate the affected credentials.';
    for (const to of superAdminEmails()) await mail.deliver({to, audience: 'staff', subject: 'Security notice: system settings changed', text}).catch(() => console.error('[settings] change alert could not be emailed'));
  }

  async test(actor: StaffUser, target: SettingsTestDto['target']) {
    const user = await this.assertSuperAdmin(actor);
    const env = {...process.env};
    if (target === 'smtp') {
      const status = await providerChecks.smtp(env);
      if (status === 'not configured') throw new BadRequestException('Email sending is not configured.');
      const mail = new MailService();
      try { await mail.deliver({to: user.email, audience: 'staff', subject: 'Test email from WSJ Studio', text: 'Email sending works. This test was requested from System settings by ' + user.email + '.'}); }
      catch { throw new BadRequestException('The email server accepted the login but the test email could not be sent. Check the "Send emails as" address.'); }
      return {ok: true, message: 'Test email sent to ' + user.email + '.'};
    }
    const status = await providerChecks[target](env);
    if (status === 'not configured') throw new BadRequestException('This integration is not configured.');
    return {ok: true, message: status.charAt(0).toUpperCase() + status.slice(1) + '.'};
  }
}

@ApiBearerAuth() @UseGuards(AuthGuard) @Roles('ADMIN') @Controller('admin/system-settings')
export class SystemSettingsController {
  constructor(@Inject(SystemSettingsService) private readonly service: SystemSettingsService) {}
  @Get() @Header('Cache-Control', 'no-store') @Throttle({default: {limit: 30, ttl: 60000}})
  async overview(@Req() req: {user: StaffUser}) { await this.service.assertSuperAdmin(req.user); return this.service.overview(); }
  @Put() @Header('Cache-Control', 'no-store') @Throttle({default: {limit: 6, ttl: 300000}})
  update(@ValidatedBody(SettingsUpdateDto) body: SettingsUpdateDto, @Req() req: {user: StaffUser; ip?: string}) { return this.service.update(req.user, body, req.ip); }
  @Post('test') @HttpCode(200) @Header('Cache-Control', 'no-store') @Throttle({default: {limit: 6, ttl: 60000}})
  test(@ValidatedBody(SettingsTestDto) body: SettingsTestDto, @Req() req: {user: StaffUser}) { return this.service.test(req.user, body.target); }
}
