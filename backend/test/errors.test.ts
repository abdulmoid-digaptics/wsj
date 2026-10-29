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
 assert.deepEqual(result.body,{statusCode:413,message:'Request body is too large'});
});
test('body-parser malformed JSON is a generic400',()=>{
 const result=responseFor({type:'entity.parse.failed',status:400,body:'must-not-be-returned'});
 assert.equal(result.status,400);
 assert.deepEqual(result.body,{statusCode:400,message:'Malformed JSON request body'});
});
test('Nest HTTP validation errors retain their structured response',()=>{
 const result=responseFor(new BadRequestException(['Invalid value']));
 assert.equal(result.status,400);
 assert.deepEqual(result.body,{message:['Invalid value'],error:'Bad Request',statusCode:400});
});
