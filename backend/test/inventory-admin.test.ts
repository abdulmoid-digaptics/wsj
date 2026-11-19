import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InventoryAdminController} from '../src/inventory-admin';
import {AuthGuard} from '../src/core';

const req:any={user:{id:'admin-1'}};
function fixture(){
 const audits:any[]=[],locations:any[]=[],resources:any[]=[],mappings:any[]=[];
 const db:any={
  audit:{create:async(v:any)=>{audits.push(v.data);return v.data;}},
  inventoryLocation:{findUnique:async({where}:any)=>locations.find(x=>x.id===where.id)||null,create:async({data}:any)=>{const row={id:'location-1',...data};locations.push(row);return row;}},
  physicalResource:{findUnique:async({where}:any)=>resources.find(x=>x.id===where.id)||null,create:async({data}:any)=>{const row={id:'resource-1',...data};resources.push(row);return row;}},
  serviceCategory:{findUnique:async({where}:any)=>where.id==='service-1'?{id:'service-1'}:null},
  resourceServiceMapping:{upsert:async({create}:any)=>{const found=mappings.find(x=>x.resourceId===create.resourceId&&x.serviceId===create.serviceId);if(found)return found;mappings.push(create);return create;}},
 };
 return {controller:new InventoryAdminController(db),audits,locations,resources,mappings};
}
test('inventory administration requires authentication and restricted write roles',()=>{
 assert.ok(Reflect.getMetadata('__guards__',InventoryAdminController).includes(AuthGuard));
 assert.deepEqual(Reflect.getMetadata('roles',InventoryAdminController.prototype.createLocation),['ADMIN']);
 assert.deepEqual(Reflect.getMetadata('roles',InventoryAdminController.prototype.createResource),['ADMIN']);
 assert.deepEqual(Reflect.getMetadata('roles',InventoryAdminController.prototype.mapService),['ADMIN']);
 assert.deepEqual(Reflect.getMetadata('roles',InventoryAdminController.prototype.close),['ADMIN','EDITOR']);
});
test('creates a location, physical pool and idempotent service mapping with audit records',async()=>{
 const f=fixture();await f.controller.createLocation({name:'  Main  ',timeZone:'America/Chicago'},req);
 await f.controller.createResource({locationId:'location-1',name:' Desk pool ',kind:'desk',capacity:5},req);
 await f.controller.mapService('resource-1',{serviceId:'service-1'},req);await f.controller.mapService('resource-1',{serviceId:'service-1'},req);
 assert.equal(f.locations[0].name,'Main');assert.equal(f.resources[0].capacity,5);assert.equal(f.mappings.length,1);assert.equal(f.audits.length,4);
});
test('rejects invalid timezones, blank resource names and unknown mappings',async()=>{
 const f=fixture();await assert.rejects(f.controller.createLocation({name:'A',timeZone:'Not/AZone'},req),/time zone/);
 await assert.rejects(f.controller.createResource({locationId:'unknown',name:' ',kind:'desk',capacity:1},req),/required/);
 await assert.rejects(f.controller.mapService('unknown',{serviceId:'service-1'},req),/Unknown/);
 assert.equal(f.audits.length,0);
});

test('rejects impossible calendar dates before attempting closure',async()=>{
 const f=fixture();await assert.rejects(f.controller.close({locationId:'location-1',startsAt:'2026-02-30T10:00:00Z',endsAt:'2026-03-03T11:00:00Z',resourceIds:['resource-1']},req),/Invalid closure interval/);
});
