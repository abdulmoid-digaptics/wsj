import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BadRequestException} from '@nestjs/common';
import {parseBookingRuleConfig} from '../src/booking-rule-admin';

const loc = 'north';
const leaf = {field:'serviceKey',op:'eq',value:'meeting'};
const valid = {priority:0,enabled:false,condition:{all:[leaf,{any:[{field:'locationId',op:'in',value:[loc]},leaf]}]},targetResourceIds:['room'],beforeMinutes:0,afterMinutes:10080};

test('accepts nested conditions, explicit-offset instants, UTC dates and numeric edit version',()=>{
  const config = {...valid, activeFrom:'2028-02-29T07:30:00-05:00', activeUntil:'2028-02-29T15:00:00Z', excludedDates:['2028-02-29']};
  assert.deepEqual(parseBookingRuleConfig(config,loc),config);
  assert.deepEqual(parseBookingRuleConfig({...config,expectedVersion:2},loc,true),config);
});

test('rejects malformed conditions, ambiguous operators, scope injection and over-budget trees',()=>{
  let deep: unknown = leaf;
  for (let i=0;i<10;i++) deep = {all:[deep]};
  for (const condition of [null,{},[],{all:[]},{any:[null]},{all:[leaf],any:[leaf]}, {...leaf,extra:1}, {...leaf,op:'no'}, {...leaf,field:'email'}, {...leaf,value:'   '}, {...leaf,value:'bad\0value'}, {...leaf,value:'\uD800'}, {field:'locationId',op:'eq',value:'elsewhere'}, deep, {any:Array.from({length:20},()=>({all:Array(25).fill(leaf)}))}]) {
    assert.throws(()=>parseBookingRuleConfig({...valid,condition},loc),BadRequestException);
  }
});

test('rejects invented fields, bad dates/ranges, buffers, target lists and non-integer versions',()=>{
  for (const bad of [{},{...valid,id:'client'}, {...valid,locationId:loc}, {...valid,enabled:'false'}, {...valid,priority:2147483648}, {...valid,beforeMinutes:-1}, {...valid,afterMinutes:10081}, {...valid,targetResourceIds:[]}, {...valid,targetResourceIds:['a','a']}, {...valid,targetResourceIds:[null]}, {...valid,activeUntil:null}, {...valid,activeFrom:'2030-01-01T12:00'}, {...valid,activeFrom:'2030-02-30T12:00Z'}, {...valid,activeFrom:'2030-01-01T24:00Z'}, {...valid,activeFrom:'2030-01-03T12:00Z',activeUntil:'2030-01-03T11:00Z'}, {...valid,excludedDates:['2029-02-29']}, {...valid,excludedDates:['2028-02-29','2028-02-29']}, {...valid,expectedVersion:1}]) {
    assert.throws(()=>parseBookingRuleConfig(bad,loc),BadRequestException);
  }
  for (const expectedVersion of [null,'1',0,1.5,2147483648,undefined]) assert.throws(()=>parseBookingRuleConfig({...valid,expectedVersion},loc,true),BadRequestException);
});
