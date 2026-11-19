import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {Reflector} from '@nestjs/core';
import {AuthGuard} from '../src/core';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-value-that-is-long-enough-123456';
const user = {id: 'staff-1', email: 'staff@example.invalid', name: 'Staff', role: 'ADMIN', active: true, tokenVersion: 0};
const guard = new AuthGuard({user: {findUnique: async () => user}} as never, new Reflector());
const context = (token: string) => ({
  switchToHttp: () => ({getRequest: () => ({method: 'GET', headers: {authorization: 'Bearer ' + token}, cookies: {}})}),
  getHandler: () => function handler() {},
  getClass: () => class Controller {},
}) as never;

test('staff tokens must be HS256 signed with the server secret', async () => {
  const good = jwt.sign({sub: user.id, v: 0}, process.env.JWT_SECRET!, {algorithm: 'HS256', expiresIn: '5m'});
  assert.equal(await guard.canActivate(context(good)), true);
  const otherAlgorithm = jwt.sign({sub: user.id, v: 0}, process.env.JWT_SECRET!, {algorithm: 'HS512', expiresIn: '5m'});
  await assert.rejects(guard.canActivate(context(otherAlgorithm)), /Invalid or expired session/);
  const unsigned = Buffer.from(JSON.stringify({alg: 'none', typ: 'JWT'})).toString('base64url') + '.' + Buffer.from(JSON.stringify({sub: user.id, v: 0})).toString('base64url') + '.';
  await assert.rejects(guard.canActivate(context(unsigned)), /Invalid or expired session/);
  const wrongSecret = jwt.sign({sub: user.id, v: 0}, 'another-secret-value-that-is-long-enough-000000', {algorithm: 'HS256'});
  await assert.rejects(guard.canActivate(context(wrongSecret)), /Invalid or expired session/);
  const stale = jwt.sign({sub: user.id, v: 1}, process.env.JWT_SECRET!, {algorithm: 'HS256'});
  await assert.rejects(guard.canActivate(context(stale)), /Invalid or expired session/);
});
