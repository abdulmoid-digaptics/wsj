import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BadRequestException, type ArgumentsHost} from '@nestjs/common';
import {Errors} from '../src/errors';

function responseFor(error: unknown) {
 const result: {status?: number; body?: unknown} = {};
 const response = {status(code: number) {result.status=code;return this;},json(body: unknown) {result.body=body;}};
 const host = {switchToHttp:()=>({getResponse:()=>response})} as ArgumentsHost;
 new Errors().catch(error,host);
 return result;
}

test('oversized JSON is a client413 without echoing its payload',()=>{
 const result=responseFor({type:'entity.too.large',status:413,body:'must-not-be-returned'});
 assert.equal(result.status,413);
 const b413=result.body as any;assert.equal(b413.statusCode,413);assert.equal(b413.message,'Request body is too large');assert.equal(b413.success,false);assert.equal(b413.error.code,'PAYLOAD_TOO_LARGE');assert.doesNotMatch(JSON.stringify(b413),/must-not-be-returned/);
});
test('body-parser malformed JSON is a generic400',()=>{
 const result=responseFor({type:'entity.parse.failed',status:400,body:'must-not-be-returned'});
 assert.equal(result.status,400);
 const b400=result.body as any;assert.equal(b400.statusCode,400);assert.equal(b400.message,'Malformed JSON request body');assert.equal(b400.error.code,'VALIDATION_ERROR');assert.doesNotMatch(JSON.stringify(b400),/must-not-be-returned/);
});
test('Nest HTTP validation errors retain their structured response',()=>{
 const result=responseFor(new BadRequestException(['Invalid value']));
 assert.equal(result.status,400);
 const bv=result.body as any;assert.deepEqual(bv.message,['Invalid value']);assert.equal(bv.statusCode,400);assert.equal(bv.error.code,'VALIDATION_ERROR');assert.equal(typeof bv.requestId,'string');
});
