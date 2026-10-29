import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {frontendOrigins} from '../src/origins';
import {PublicController} from '../src/public';
import {AuthController} from '../src/auth';
import {THROTTLER_LIMIT,THROTTLER_TTL} from '@nestjs/throttler/dist/throttler.constants';
test('origin allowlist validates explicit URLs and rejects unsafe configuration',()=>{
 assert.deepEqual(frontendOrigins({FRONTEND_URL:'http://localhost:3000',FRONTEND_URLS:' http://localhost:3100, http://localhost:3000/ '}),['http://localhost:3000','http://localhost:3100']);
 for(const value of ['*','https://*.example.com','javascript:alert(1)','https://example.com/path','https://user:pass@example.com','https://example.com?x=1','https://example.com#hash','null','https://example.com,'])assert.throws(()=>frontendOrigins({FRONTEND_URL:'https://example.com',FRONTEND_URLS:value}));
 assert.throws(()=>frontendOrigins({}));
});
test('public read overrides preserve strict write throttles',()=>{
 for(const method of ['health','list','detail'] as const){assert.equal(Reflect.getMetadata(THROTTLER_LIMIT+'default',PublicController.prototype[method]),2000);assert.equal(Reflect.getMetadata(THROTTLER_TTL+'default',PublicController.prototype[method]),60000);}
 assert.equal(Reflect.getMetadata(THROTTLER_LIMIT+'default',PublicController.prototype.inquiry),5);
 assert.equal(Reflect.getMetadata(THROTTLER_LIMIT+'default',PublicController.prototype.event),60);
 assert.equal(Reflect.getMetadata(THROTTLER_LIMIT+'default',AuthController.prototype.login),5);
});
