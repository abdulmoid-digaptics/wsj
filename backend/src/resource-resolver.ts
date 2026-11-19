import {evaluateBookingRules, type BookingRule} from './booking-rules';
import type {InventoryBatchItem, InventoryLine} from './resource-inventory';

/** Trusted server-side configuration, never a decoded request body. */
export type ReservationResource = {id:string; locationId:string; capacity:number; active:boolean};
export type ReservationPolicy = {
  serviceId:string; serviceKey:string; locationId:string;
  durationMinutes:number;
  requirements:Array<{resource:ReservationResource; units:number}>;
};
export type ReservationPlan = {item:InventoryBatchItem; triggeredRuleIds:string[]};
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/;
function absolute(value:string):Date {
 if(!ISO.test(value))throw new Error('Select a time with an explicit timezone');
 const date=new Date(value),day=value.slice(0,10),midnight=Date.parse(day+'T00:00:00Z');
 if(!Number.isFinite(+date)||!Number.isFinite(midnight)||new Date(midnight).toISOString().slice(0,10)!==day)throw new Error('Invalid start time');
 return date;
}
function resourceValid(resource:ReservationResource,locationId:string) {
 return !!resource && typeof resource.id==='string' && !!resource.id && resource.locationId===locationId && resource.active===true && Number.isInteger(resource.capacity) && resource.capacity>0;
}
/**
 * Resolve one explicit all-required policy and its server-supplied rule targets.
 * The result is NOT a reservation: pass it directly to an atomic inventory batch.
 * There is deliberately no client-selected resource, inferred mapping or duration.
 */
export function resolveReservationPlan(input:{policy:ReservationPolicy; startAt:string; rules:BookingRule[]; ruleTargets:ReservationResource[]; now?:Date}):ReservationPlan {
 const {policy}=input;
 if(!policy || !policy.serviceId?.trim() || !policy.serviceKey?.trim() || !policy.locationId?.trim() || !Number.isInteger(policy.durationMinutes) || policy.durationMinutes<1 || policy.durationMinutes>10080 || !Array.isArray(policy.requirements) || !policy.requirements.length || policy.requirements.length>64)throw new Error('Reservation policy is incomplete');
 const start=absolute(input.startAt),now=input.now??new Date();
 if(!Number.isFinite(+now)||+start<=+now)throw new Error('Reservation must start in the future');
 const end=new Date(+start+policy.durationMinutes*60000);
 if(!Number.isFinite(+end))throw new Error('Invalid reservation duration');
 const required=new Map<string,InventoryLine>();
 for(const requirement of policy.requirements){
  const {resource,units}=requirement;
  if(!resourceValid(resource,policy.locationId)||!Number.isInteger(units)||units<1||units>resource.capacity||required.has(resource.id))throw new Error('Invalid required resource');
  required.set(resource.id,{resourceId:resource.id,units,startsAt:start,endsAt:end});
 }
 const targets=new Map<string,ReservationResource>();
 for(const resource of input.ruleTargets){if(!resourceValid(resource,policy.locationId)||targets.has(resource.id))throw new Error('Invalid rule target');targets.set(resource.id,resource);}
 // A pending checkout reserves the union of pending and eventual confirmed rules.
 // Otherwise a paid event could discover its configured room locks are unavailable.
 const locksByResource=new Map<string,{resourceId:string;start:Date;end:Date;ruleIds:string[]}>();
 for(const status of ['PENDING','CONFIRMED']) for(const lock of evaluateBookingRules(input.rules,{serviceKey:policy.serviceKey,status,locationId:policy.locationId,start:start.toISOString(),end:end.toISOString()})){
  const previous=locksByResource.get(lock.resourceId);
  if(!previous)locksByResource.set(lock.resourceId,{...lock,ruleIds:[...lock.ruleIds]});
  else{previous.start=new Date(Math.min(+previous.start,+lock.start));previous.end=new Date(Math.max(+previous.end,+lock.end));previous.ruleIds=[...new Set([...previous.ruleIds,...lock.ruleIds])];}
 }
 const locks=[...locksByResource.values()];
 const rules:InventoryLine[]=[];const triggeredRuleIds=new Set<string>();
 for(const lock of locks){
  const target=targets.get(lock.resourceId);if(!target)throw new Error('Rule target is not available at this location');
  lock.ruleIds.forEach(id=>triggeredRuleIds.add(id));
  const existing=required.get(target.id);
  if(existing){
   const requiredResource=policy.requirements.find(item=>item.resource.id===target.id)!.resource;
   if(requiredResource.capacity!==target.capacity)throw new Error('Inconsistent resource capacity');
   existing.units=target.capacity;
   existing.exclusive=true;
   existing.startsAt=new Date(Math.min(+existing.startsAt!,+lock.start));
   existing.endsAt=new Date(Math.max(+existing.endsAt!,+lock.end));
  } else rules.push({resourceId:target.id,units:target.capacity,startsAt:lock.start,endsAt:lock.end});
 }
 if(required.size+rules.length>64)throw new Error('Too many physical resources');
 return {item:{serviceId:policy.serviceId,locationId:policy.locationId,startsAt:start,endsAt:end,resources:[...required.values()],...(rules.length?{ruleResources:rules}:{})},triggeredRuleIds:[...triggeredRuleIds]};
}
