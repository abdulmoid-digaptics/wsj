import {Prisma} from '@prisma/client';
import {loadReservationPolicies, type ReservationPolicyScope} from './reservation-policy-admin';
import {resolveReservationPlan} from './resource-resolver';
import {ResourceInventory} from './resource-inventory';

type Tx=Prisma.TransactionClient;
/** All selections and ownerRef must come from verified server-side checkout state.
 * Caller creates the order/booking and saves returned claim IDs in this SAME
 * READ COMMITTED transaction. Stripe calls must happen only after commit. */
export async function holdReservationsForCheckout(tx:Tx,inventory:ResourceInventory,input:{selections:Array<{scope:ReservationPolicyScope;startAt:string}>;ownerRef:string;ttlSeconds:number;now?:Date}) {
 if(!Array.isArray(input.selections)||!input.selections.length||input.selections.length>64)throw new Error('Select 1 to 64 scheduled items');
 const configurations=await loadReservationPolicies(tx,input.selections.map(s=>s.scope));
 const plans=configurations.map((config,index)=>resolveReservationPlan({...config,startAt:input.selections[index].startAt,now:input.now}));
 const claims=await inventory.holdBatchInTransaction(tx,{items:plans.map(plan=>plan.item),ownerRef:input.ownerRef,ttlSeconds:input.ttlSeconds});
 return claims.map((claim,index)=>({claimId:claim.id,expiresAt:claim.expiresAt,policyId:configurations[index].policyId,policyVersion:configurations[index].version,ruleIds:plans[index].triggeredRuleIds}));
}
