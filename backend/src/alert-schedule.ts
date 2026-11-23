/** Pure decision logic only. A worker must atomically claim the alert in its database
 * before sending; this function alone does not deduplicate concurrent workers. */
export type AlertSchedule = {repeatMinutes:number; timeZone:string; quietHours?:{start:string; end:string}};
export type AlertObservation = {active:boolean; lastSentAt:Date|null; acknowledgedUntil:Date|null};
export type AlertDecision = 'resolved'|'acknowledged'|'not_due'|'quiet_hours'|'send';
function minuteOfDay(value:string):number {
 const m=/^(\d{2}):(\d{2})$/.exec(value);
 if(!m || +m[1]>23 || +m[2]>59)throw new Error('Quiet hours must use 24-hour HH:mm');
 return +m[1]*60 + +m[2];
}
function clockMinute(now:Date,timeZone:string):number {
 let formatter:Intl.DateTimeFormat;
 try{formatter=new Intl.DateTimeFormat('en-US',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}catch{throw new Error('Invalid IANA time zone');}
 const parts=formatter.formatToParts(now);const hour=Number(parts.find(p=>p.type==='hour')?.value),minute=Number(parts.find(p=>p.type==='minute')?.value);
 if(!Number.isInteger(hour)||!Number.isInteger(minute))throw new Error('Unable to read local time');
 return hour*60+minute;
}
export function decideCapacityAlert(schedule:AlertSchedule,observation:AlertObservation,now:Date):AlertDecision {
 if(!(now instanceof Date)||!Number.isFinite(+now)||!Number.isInteger(schedule.repeatMinutes)||schedule.repeatMinutes<1||schedule.repeatMinutes>10080)throw new Error('Invalid alert schedule');
 const local=clockMinute(now,schedule.timeZone);
 let quiet=false;
 if(schedule.quietHours){
  const start=minuteOfDay(schedule.quietHours.start),end=minuteOfDay(schedule.quietHours.end);
  if(start===end)throw new Error('Quiet hours cannot span the entire day');
  quiet=start<end?local>=start&&local<end:local>=start||local<end;
 }
 for(const value of [observation.lastSentAt,observation.acknowledgedUntil])if(value!==null&&(!(value instanceof Date)||!Number.isFinite(+value)))throw new Error('Invalid alert timestamp');
 if(!observation.active)return 'resolved';
 if(observation.acknowledgedUntil && +observation.acknowledgedUntil>+now)return 'acknowledged';
 if(observation.lastSentAt && +observation.lastSentAt+schedule.repeatMinutes*60000>+now)return 'not_due';
 return quiet?'quiet_hours':'send';
}
