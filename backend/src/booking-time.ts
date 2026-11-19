/** Convert a local wall time to one unambiguous instant in an explicit IANA zone.
 * DST gaps and repeated wall times are rejected rather than silently guessing.
 */
export function bookingWallTime(date:string,time:string,timeZone:string): Date {
 const dm=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date), tm=/^(\d{2}):(\d{2})$/.exec(time);
 if(!dm||!tm) throw new Error('Use a valid date and 24-hour time');
 const year=Number(dm[1]),month=Number(dm[2]),day=Number(dm[3]),hour=Number(tm[1]),minute=Number(tm[2]);
 if(year<1970||year>9999||month<1||month>12||hour>23||minute>59)throw new Error('Invalid date or time');
 const wall=Date.UTC(year,month-1,day,hour,minute), valid=new Date(wall);
 if(valid.getUTCFullYear()!==year||valid.getUTCMonth()!==month-1||valid.getUTCDate()!==day)throw new Error('Invalid calendar date');
 let formatter:Intl.DateTimeFormat;
 try{formatter=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});}catch{throw new Error('Invalid IANA time zone');}
 const fields=(timestamp:number)=>{
  const p=Object.fromEntries(formatter.formatToParts(new Date(timestamp)).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
  return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
 };
 const offsets=new Set<number>();
 for(let delta=-48;delta<=48;delta+=6){const sample=wall+delta*3600000;offsets.add(fields(sample)-sample);}
 const candidates=[...offsets].map(offset=>wall-offset).filter(candidate=>fields(candidate)===wall);
 const unique=[...new Set(candidates)];
 if(unique.length!==1)throw new Error(unique.length?'This local time occurs twice due to a clock change':'This local time does not exist due to a clock change');
 return new Date(unique[0]);
}
