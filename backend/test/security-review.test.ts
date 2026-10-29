import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {ValidationPipe} from '@nestjs/common';
import {plainToInstance} from 'class-transformer';
import {validateSync} from 'class-validator';
import {BookingDto,UserDto,UpdateContentDto,LoginDto} from '../src/dto';
import {cleanContent,publicSafe,contentEligible} from '../src/content-safety';

// Pure only. No main/controllers/Db imports, .env, HTTP, Prisma, SMTP or writes.
const source=(name:string)=>readFileSync(path.resolve(__dirname,'../src',name),'utf8');
const booking=()=>({customerName:'Review Fixture',customerEmail:'review@example.invalid',serviceType:'meeting-rooms',serviceId:'not-a-catalog-id',serviceName:'Unverified fixture',planId:'silver',addOns:['printing']});
const errors=(type:any,payload:unknown)=>validateSync(plainToInstance(type,payload,{enableImplicitConversion:false}),{whitelist:true,forbidNonWhitelisted:true});

test('explicit expectedType validates DTO when parameter metadata is Object',async()=>{
 const pipe=new ValidationPipe({expectedType:LoginDto,transform:true,whitelist:true,forbidNonWhitelisted:true});
 await assert.rejects(()=>pipe.transform({email:'invalid',password:'x',role:'ADMIN'},{type:'body',metatype:Object}));
 const result=await pipe.transform({email:'review@example.invalid',password:'fixture-only'},{type:'body',metatype:Object});
 assert.ok(result instanceof LoginDto);
 assert.match(source('validation.ts'),/expectedType:\s*dto/);
});

test('booking input cannot assign privileged status or payment fields',()=>{
 for(const key of ['status','couponDiscount','stripePaymentIntentId','stripeChargeId','stripeResponse','emailStatus']){
  assert.ok(errors(BookingDto,{...booking(),[key]:'untrusted'}).some(e=>e.property===key));
 }
});

test('fix: the client cannot supply a price at all; the server resolves it from planId/addOns against its own catalog',()=>{
 assert.deepEqual(errors(BookingDto,booking()),[]);
 for(const field of ['subtotalPrice','totalPrice'])assert.ok(errors(BookingDto,{...booking(),[field]:0.01}).some(e=>e.property===field&&e.constraints?.whitelistValidation),field+' must be rejected as an unknown field, not trusted from the client');
 assert.ok(errors(BookingDto,{...booking(),addOns:['not-a-real-addon']}).some(e=>e.property==='addOns'),'An add-on id outside the catalog must be rejected, not silently priced at zero');
 const source_=source('booking.ts');
 assert.ok(source_.includes('resolveBookingTotal(planId,addOns||[])'),'booking.ts must resolve price server-side from the catalog');
 assert.ok(!source_.includes('data.subtotalPrice')&&!source_.includes('data.totalPrice'),'booking.ts must not read a client-supplied price');
});

test('fix: with the actual production pipe config, a Boolean field rejects the string "false" instead of coercing it to true',()=>{
 const proto=UserDto.prototype;
 const previous=Reflect.getMetadata('design:type',proto,'active');
 // Model the real tsc-emitted production metadata regardless of this loader.
 Reflect.defineMetadata('design:type',Boolean,proto,'active');
 try{
  // main.ts and validation.ts now set enableImplicitConversion:false; match it here.
  const dto=plainToInstance(UserDto,{email:'review@example.invalid',name:'Review Fixture',password:'fixture-only-12345',role:'VIEWER',active:'false'},{enableImplicitConversion:false});
  assert.equal(dto.active,'false','Implicit conversion is off: the raw string passes through unchanged');
  assert.ok(validateSync(dto,{whitelist:true,forbidNonWhitelisted:true}).some(e=>e.property==='active'),'A non-boolean value must now be rejected, not silently coerced to true');
 }finally{
  if(previous===undefined)Reflect.deleteMetadata('design:type',proto,'active');
  else Reflect.defineMetadata('design:type',previous,proto,'active');
 }
});

test('patch validation rejects null title and unknown kind override',()=>{
 assert.ok(errors(UpdateContentDto,{title:null}).some(e=>e.property==='title'));
 assert.ok(errors(UpdateContentDto,{kind:'settings'}).some(e=>e.property==='kind'));
});

test('sanitization strips executable markup and secret-looking public keys',()=>{
 const result=cleanContent({html:'<script>bad()</script><img src="x" onerror="bad()"><a href="javascript:bad()">bad</a>'});
 assert.doesNotMatch(result.html,/<script|onerror|javascript:/i);
 assert.deepEqual(publicSafe({metadata:{apiKey:'fixture-only',smtpPassword:'fixture-only',publicLabel:'ok'}}),{metadata:{publicLabel:'ok'}});
});

test('publicSafe denylist is not a private-data classification boundary',()=>{
 assert.deepEqual(publicSafe({metadata:{internalNotes:'fixture-only',customerEmail:'review@example.invalid'}}),{metadata:{internalNotes:'fixture-only',customerEmail:'review@example.invalid'}});
});

test('publication gates remain independent of frontend state',()=>{
 assert.equal(contentEligible('pricing',{metadata:{requiresReview:true}}),false);
 assert.equal(contentEligible('blog',{metadata:{enabled:false}}),false);
 assert.equal(contentEligible('blog',{metadata:{publishAt:'2099-01-01T00:00:00Z'}}),false);
});

test('guard retains revocation, current role and cookie-write Origin checks',()=>{
 const guard=source('core.ts');
 assert.ok(guard.includes('user.tokenVersion!==payload.v'));
 assert.ok(guard.includes('roles.includes(req.user.role)'));
 assert.ok(guard.includes('!bearer &&'));
 assert.ok(guard.includes('frontendOrigins().includes(origin)'));
});

test('media retains limits, random exclusive filenames and sandbox serving',()=>{
 const media=source('media.ts'),main=source('application.ts');
 assert.ok(media.includes('fileSize:5*1024*1024,files:1'));
 assert.ok(media.includes('randomUUID()'));
 assert.ok(media.includes("flag:'wx'"));
 assert.ok(main.includes("default-src 'none'; sandbox"));
});
