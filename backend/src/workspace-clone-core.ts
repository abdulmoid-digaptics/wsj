import {randomUUID} from 'node:crypto';
import {bookingWallTime} from './booking-time';

export type CloneCell = string | number | boolean | null;
export type CloneRecord = {id: string; provenance: 'REFERENCE' | 'LOCAL' | 'LIVE'; [key: string]: CloneCell};
export type CloneColumn = {key: string; label: string; type: 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'select' | 'textarea'; options?: string[]; required?: boolean; readOnly?: boolean};
export type CloneSection = {key: string; label: string; area: 'Reports' | 'Access control'; description: string; readOnly: boolean; columns: CloneColumn[]; records: CloneRecord[]};
export type CloneState = {revision: number; capturedAt: string; sourceLinks: {sheets: string; kisi: string}; localLockdown: boolean; records: Record<string, CloneRecord[]>};
type ReferenceSource = {capturedAt: string; sourceLinks: CloneState['sourceLinks']; workbook: {sheets: Array<{name: string; rows: unknown[][]}>}; kisi: Record<string, any>};
const column = (key: string, label: string, type: CloneColumn['type'] = 'text', extra: Partial<CloneColumn> = {}): CloneColumn => ({key, label, type, ...extra});
const choice = (key: string, label: string, options: string[], required = false) => column(key, label, 'select', {options, required});
const text = (value: unknown) => value == null ? '' : String(value);
const numeric = (value: unknown) => {const number = Number(String(value ?? '').replace(/[$,%]/g, '')); return Number.isFinite(number) ? number : 0;};
/** Kisi's event history displays times in the place timezone (Central). Date-less times are on the capture day. */
export function capturedEventTime(display:string,capturedAt:string):string|null{
  const m=[...display.matchAll(/(?:([A-Z][a-z]{2}) (\d{1,2}), )?(\d{1,2}):(\d{2}) ([AP]M)/g)].at(-1);if(!m)return null;
  const cap=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(capturedAt)).split('-').map(Number);
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let year=cap[0],month=cap[1],day=cap[2];
  if(m[1]){month=months.indexOf(m[1])+1;day=Number(m[2]);if(month<1)return null;if(month>cap[1]||month===cap[1]&&day>cap[2])year--;}
  let hour=Number(m[3])%12;if(m[5]==='PM')hour+=12;
  try{return bookingWallTime(year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0'),String(hour).padStart(2,'0')+':'+m[4],'America/Chicago').toISOString();}catch{return null;}
}
/** Turns a captured accessibility-tree fragment into plain readable text. */
export function readableCapture(block:string){
  return block.replace(/\[ref=[^\]]+\]/g,'').split('\n').map(line=>line.replace(/^\s*-\s*(?:text|link|button)?:?\s*/,'').replace(/^"|"$/g,'').replace(/"\s*$/,'').trim()).filter(line=>line&&line!=='Collapsed'&&line!==':').join(' ').replace(/^Collapsed\s+/,'').replace(/\s+/g,' ').replace(/\(…/g,'').trim();
}
export function validCloneDate(value:string, datetime=false){
  if(!(datetime?/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/:/^\d{4}-\d{2}-\d{2}$/).test(value)||!Number.isFinite(Date.parse(value)))return false;
  return new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===value.slice(0,10);
}
const values = (state: CloneState, section: string, key: string) => (state.records[section] || []).map(r => text(r[key])).filter(Boolean);
const eventColumns = [column('object', 'Object'), column('action', 'Action'), column('user', 'User'), column('occurredAt', 'Local event time', 'datetime'), column('sourceDisplay', 'Captured source display', 'textarea')];
const memberColumns = [column('name', 'Name', 'text', {required: true}), column('email', 'Email', 'text', {required: true}), column('phone', 'Phone'), column('plan', 'Package'), choice('status', 'Status', ['Active','Cancelled','Suspended','Expired','Payment failed'], true), column('expires', 'Expires', 'datetime'), column('access_level', 'Access level'), column('contact_url', 'Reference contact URL', 'text', {readOnly: true})];

/** Every section is isolated local state. No provider SDK, network, mail or payment dependencies. */
export function cloneSections(state: CloneState): CloneSection[] {
  const groups = values(state, 'groups', 'name'), users = values(state, 'users', 'email'), doors = values(state, 'doors', 'name'), teams = values(state, 'teams', 'name');
  const specs: Array<Omit<CloneSection, 'records'>> = [];
  const add = (key: string, label: string, area: CloneSection['area'], columns: CloneColumn[], description: string, readOnly = false) => specs.push({key, label, area, columns, description, readOnly});
  add('weekly-reports','Weekly reports','Reports', [column('report_date','Report date','date'),column('week_ending','Week ending','date'),column('active_members','Active members','number'),column('expired_this_week','Expired this week','number'),column('new_leads','New leads','number'),column('won_leads','Won leads','number'),column('conversion_rate','Conversion rate'),column('churn_rate','Churn rate'),column('total_revenue','Total revenue'),column('successful_charges','Successful charges','number'),column('failed_charges','Failed charges','number'),column('arpu','ARPU'),column('plan_breakdown','Package breakdown','textarea'),column('timestamp','Captured / generated at','datetime')], 'Exact workbook history plus locally generated reports. Local reports use only clone records, not live GHL or Stripe.', true);
  add('packages','Packages','Reports',[column('subscription_type','Package','text',{required:true}),column('amount','Amount (USD)','number',{required:true}),column('yearly_amount','Yearly amount (USD)','number'),column('interval','Included units / interval','number',{required:true}),choice('pricing_mode','Pricing mode',['per_unit','bundle','monthly','one_time'],true),choice('quantity_unit','Quantity unit',['none','day','hour'],true),column('max_quantity','Maximum quantity','number'),choice('kisi_access','Kisi access',['Yes','No'],true),column('kisi_group_id','Reference Kisi group ID'),column('access_level','Access level')], 'All 37 verified workbook packages. Editing these clone packages does not change public checkout prices or the original sheet.');
  add('kpis','Dashboard KPIs','Reports',[column('active_count','Captured active','number'),column('expiring_count','Captured expiring','number'),column('failed_count','Captured failed','number'),column('last_updated','Source last updated','datetime')],'Captured dashboard values are preserved even when source statuses and expiry dates disagree.',true);
  add('active-members','Member dashboard','Reports',memberColumns,'Captured member rows, locally editable. Past expiry dates are flagged by derived counts; captured statuses are not silently corrected.');
  add('expiring','Expiring members','Reports',memberColumns,'Derived from local Active member records expiring within seven days, in Chicago time.',true);
  add('failed-payments','Failed payments','Reports',memberColumns,'Derived from local members with Payment failed status. The source tab was empty.',true);
  add('marketplace','Marketplace transactions','Reports',[column('date','Date','datetime',{required:true}),column('paymentIntentId','Payment Intent ID'),column('chargeId','Charge ID'),column('product','Product','text',{required:true}),column('category','Category'),column('quantity','Quantity','number',{required:true}),column('totalAmount','Total amount (USD)','number',{required:true}),column('platformFee','Platform fee (USD)','number',{required:true}),column('vendorPayout','Vendor payout (USD)','number',{required:true}),column('vendorName','Vendor name'),column('vendorEmail','Vendor email'),column('vendorStripeAccount','Vendor Stripe account'),column('customerEmail','Customer email'),column('customerName','Customer name'),column('transferId','Transfer ID'),column('currency','Currency','text',{required:true}),choice('status','Status',['succeeded','pending','failed','refunded'],true),column('orderReference','Order reference')],'Local settlement ledger. Amounts must balance to the cent. No Stripe charges, transfers or payouts are sent.');
  add('leads','Local leads','Reports',[column('name','Name','text',{required:true}),column('email','Email'),choice('status','Status',['NEW','CONTACTED','WON','LOST'],true),column('createdAt','Created','datetime',{required:true})],'Local lead inputs for report conversion metrics; not a copy of the live GHL contact database.');
  add('n8n-events','n8n sync log','Reports',[column('receivedAt','Received','datetime'),column('occurredAt','Happened in n8n','datetime'),choice('status','Result',['Access granted','No door access for package','Kisi grant failed','Kisi user needed','Access removed','Kisi revoke failed']),column('member','Member'),column('email','Email'),column('package','Package'),column('kisiUser','Kisi user ID'),column('kisiGroup','Kisi group ID'),column('detail','Detail','textarea'),column('workflow','Workflow'),column('execution','n8n execution')],'Every grant and revoke n8n sends to Kisi is also sent here, so the app stays in step with Kisi. Newest first.',true);
  add('report-catalog','Access reports','Reports',[column('name','Report'),column('sourceAvailability','Source availability'),column('description','Description','textarea')],'Reporting categories observed in Kisi. Upgrade-gated report internals were not accessible and are not claimed replicated.',true);
  add('report-schedules','Report schedules','Reports',[column('name','Name','text',{required:true}),choice('frequency','Frequency',['Weekly','Monthly'],true),column('recipients','Recipient labels (no delivery)','textarea'),choice('status','Status',['Draft','Enabled','Disabled'],true)],'Local schedule definitions only. No live report job or email scheduling is created.');
  add('users','Users','Access control',[column('name','Name','text',{required:true}),column('email','Email','text',{required:true}),choice('status','Access status',['Unknown','Enabled','Suspended'],true),column('notes','Notes','textarea'),column('lastAccess','Captured last access'),column('sourceDisplay','Captured source row','textarea',{readOnly:true})],'28 captured user rows. A dash in the source is Unknown, not proof of permission. Local suspension preserves group assignments.');
  add('teams','Teams','Access control',[column('name','Name','text',{required:true}),column('description','Description','textarea'),column('members','Members','textarea'),column('groups','Groups','textarea'),column('validFrom','Valid from','datetime',{required:true}),column('validUntil','Valid until','datetime',{required:true})],'Local teams combine user memberships and group access within explicit validity windows. The source had no teams.');
  add('groups','Groups','Access control',[column('name','Name','text',{required:true}),column('description','Description','textarea'),choice('scope','Scope',['Place','Organization'],true),column('sourceGroupId','Source group ID','text',{readOnly:true}),column('doors','Doors','textarea'),column('policyReviewed','Local policy reviewed','boolean'),column('appAccess','Allow app access','boolean'),column('primaryDeviceRestriction','Primary device restriction','boolean'),column('geofenceRestriction','Geofence restriction','boolean'),column('readerProximityRestriction','Reader proximity restriction','boolean'),column('readerTapRestriction','Reader tap restriction','boolean'),column('timeRestriction','Time restriction','boolean'),column('timeZone','Time zone'),column('sourceDisplay','Captured source row','textarea',{readOnly:true})],'30 captured groups. Only the inspected Classic Dedicated Desk policy was captured. Other policy flags are unknown until explicitly set locally. Review a local policy before simulated access.');
  const validity = [column('validFrom','Valid from','datetime',{required:true}),column('validUntil','Valid until','datetime',{required:true})];
  add('access-rights','Access rights','Access control',[choice('user','User email',users,true),choice('group','Group',groups,true),choice('role','Role',['group_basic','group_manager'],true),...validity,choice('status','Status',['Reference only','Active','Revoked'],true),column('sourceDisplay','Captured window display','textarea',{readOnly:true})],'Local assignments have explicit time windows. A captured window with an undisclosed display timezone remains Reference only until explicitly configured locally. They never call Kisi role_assignments.');
  add('schedules','Access schedules','Access control',[column('name','Name','text',{required:true}),choice('group','Group',groups,true),column('weekdays','ISO weekdays, comma-separated (1=Mon)','text',{required:true}),column('startTime','Start HH:mm','text',{required:true}),column('endTime','End HH:mm','text',{required:true}),column('exceptionDates','Restricted dates YYYY-MM-DD, comma-separated','textarea'),column('timeZone','Time zone','text',{required:true}),column('enabled','Enabled','boolean')],'Local weekly schedules and restriction exceptions. Only same-day windows are supported; use two schedules for overnight access.');
  add('credentials','Physical credentials','Access control',[column('name','Credential label','text',{required:true}),choice('user','Assigned user',users,true),choice('model','Model',['Card','Fob'],true),choice('status','Status',['Active','Suspended','Revoked'],true)],'Local credential labels only. Source had no physical credentials. Real card tokens, PINs and provisioning are never copied or generated.');
  add('digital-credentials','Digital credentials','Access control',[column('name','Recipient','text',{required:true}),choice('type','Type',['QR code','Access Link','QR code & Link'],true),choice('group','Group',groups,true),column('validUntil','Captured validity / local end'),column('lastUsed','Captured last used'),choice('status','Status',['Reference only','Draft','Revoked'])],'Three captured digital credential descriptors. Live access URLs and QR secrets are deliberately excluded; clone records do not unlock doors.');
  add('apple-passes','Apple passes','Access control',[column('name','Name','text',{required:true}),column('email','Email','text',{required:true}),choice('status','Status',['Draft','Revoked'],true),column('devices','Device labels')],'Local pass descriptors. Apple Wallet signing and real credential issuance require separate authorized integration.');
  add('events','Access event history','Access control',eventColumns,'Recent visible source event samples plus local simulation outcomes. Imported timestamps retain their original display; not a full historical export.',true);
  add('audit-events','Audit event history','Access control',eventColumns,'Captured audit samples plus append-only local clone changes. No real Kisi audit entries are generated.',true);
  add('doors','Doors','Access control',[column('name','Name','text',{required:true}),column('floor','Floor'),choice('status','Status',['Locked','Unlocked','Locked down','Offline','Unknown'],true),column('schedule','Schedule notes')],'Door state is a captured reference or local simulation, never live monitoring or a real door command.');
  add('hardware','Hardware','Access control',[column('name','Name','text',{required:true}),choice('type','Type',['Reader','Controller','Camera','Intercom','Kiosk'],true),choice('status','Captured status',['Online','Offline','Unknown'],true),column('door','Door'),column('notes','Notes','textarea')],'Local hardware inventory for readers, controllers, cameras, intercoms and kiosks. Pairing tokens and live connectivity are not cloned.');
  add('floors','Floors','Access control',[column('name','Name','text',{required:true}),column('number','Floor number','number',{required:true})],'Captured main floor plus local floor definitions.');
  add('elevators','Elevators','Access control',[column('name','Name','text',{required:true}),column('floors','Floors','textarea'),choice('status','Status',['Unknown','Enabled','Disabled'],true)],'Local elevator inventory. Does not send elevator calls.');
  add('access-points','Access points','Access control',[column('name','Name','text',{required:true}),choice('door','Door',doors),column('useCase','Use case'),choice('status','Status',['Draft','Enabled','Disabled'],true)],'Local access-point definitions. The source had no access points.');
  add('intrusion-zones','Intrusion detection','Access control',[column('name','Zone','text',{required:true}),choice('status','Local state',['Disarmed','Armed','Alarm','Unknown'],true),column('schedule','Schedule notes','textarea')],'Local zone and alarm-schedule records. No real alarms are armed, silenced or triggered.');
  add('visitors','Visitors','Access control',[column('name','Name','text',{required:true}),column('email','Email'),choice('group','Group',groups),...validity,column('shareAccess','Share access (local descriptor)','boolean'),choice('delivery','Delivery (not sent)',['Email','SMS','None'],true),choice('accessType','Access type',['Access link','QR code','QR code & Link','Log visit only'],true),choice('status','Status',['Invited','Checked in','Checked out','Cancelled'],true),column('ndaSigned','NDA signed (local record)','boolean'),column('customFields','Custom field notes','textarea'),column('issuedBy','Issued by'),column('checkedInAt','Checked in at','datetime',{readOnly:true}),column('checkedOutAt','Checked out at','datetime',{readOnly:true})],'Future/past visitor records and local check-in/check-out. No invitation, real access link, QR code or SMS/email is issued.');
  add('visitor-points','Visitor registration points','Access control',[column('name','Name','text',{required:true}),choice('team','Host team',teams,true),column('visitReasons','Visit reasons, comma-separated','textarea',{required:true}),choice('group','Access group',groups),choice('emailField','Email field',['Required','Optional','Hidden'],true),column('durationHours','Access duration (hours)','number'),column('printBadge','Print badge preference','boolean'),column('acceptPhoto','Photo preference','boolean'),column('notifications','Notification channel label (not sent)')],'Local registration-point settings based on the inspected form. No public registration endpoint or live Slack webhook is created.');
  add('badge-templates','Badge printing','Access control',[column('name','Template name','text',{required:true}),column('jobTitle','Job title'),column('details','Details','textarea')],'Select a cloned user and print or save a local badge preview. This is not a Kisi access credential.');
  add('integrations','Integrations','Access control',[column('name','Name','text',{required:true}),column('type','Type','text',{required:true}),choice('scope','Scope',['Organization','Place'],true),choice('status','Local descriptor',['Enabled','Disabled','Draft'],true)],'Captured Badge Printer and Visitor Management installation descriptors. Changes never enable, disable or configure a real integration.');
  add('places','Places','Access control',[column('name','Name','text',{required:true}),column('address','Address'),column('timeZone','Time zone','text',{required:true}),column('sourcePlaceId','Source place ID','text',{readOnly:true})],'Local venue/location records.');
  add('organization-settings','Organization settings','Access control',[column('name','Name','text',{required:true}),column('organizationId','Source organization ID','text',{readOnly:true}),column('domain','Domain'),column('timeZone','Time zone','text',{required:true}),column('sessionTimeoutDays','Session timeout (days)','number',{required:true}),column('sendAccessEmails','Access assignment email preference','boolean'),column('sendCredentialEmails','Credential assignment email preference','boolean'),column('sendIncidentEmails','Incident email preference','boolean'),column('sendReportEmails','Report email preference','boolean'),column('sendSecurityEmails','Security email preference','boolean')],'Local copies of captured preferences. They do not change app authentication, email delivery, or the live organization.');
  add('incidents','Incidents','Access control',[column('subject','Subject','text',{required:true}),choice('severity','Severity',['Low','Medium','High','Critical'],true),column('type','Type','text',{required:true}),choice('status','Status',['Active','Closed'],true),column('lastSeen','Last seen','datetime'),column('notes','Notes','textarea')],'Local incident workflow, not live monitoring or real security alerts. The inspected active incident list was empty.');
  add('incident-policies','Incident policies','Access control',[column('name','Name','text',{required:true}),choice('severity','Severity',['Low','Medium','High','Critical'],true),column('type','Event type','text',{required:true}),choice('status','Status',['Enabled','Disabled','Draft'],true),column('recipients','Recipient labels (not sent)','textarea')],'Local incident-policy definitions. No external notification or sensor subscription is created.');
  add('floor-plans','Floor plans','Access control',[column('name','Name','text',{required:true}),column('floor','Floor'),column('description','Placement notes','textarea')],'Local floor-plan descriptions. The source has no configured floor plan. Mapping images and live telemetry were not present in the reference.');
  add('custom-roles','Custom roles','Access control',[column('name','Role','text',{required:true}),column('description','Description','textarea'),column('permissions','Permission labels','textarea')],'Local role descriptors only. The source custom-role feature is add-on gated. These do not alter staff authorization.');
  add('event-retention','Event retention','Access control',[column('name','Name','text',{required:true}),column('periodDays','Period (days)','number',{required:true}),choice('action','Action',['Anonymize','Delete'],true),choice('status','Status',['Draft','Enabled','Disabled'],true)],'Local retention-policy descriptors only. No source events or imported reference history are automatically erased.');
  return specs.map(spec => ({...spec, records: state.records[spec.key] || []}));
}

export function seedClone(source: ReferenceSource): CloneState {
  const state: CloneState = {revision: 0, capturedAt: source.capturedAt, sourceLinks: source.sourceLinks, localLockdown: false, records: {}};
  const put = (section: string, rows: Array<Record<string, unknown>>) => {state.records[section] = rows.map((row,i) => ({id: 'reference-' + section + '-' + (i+1), provenance: 'REFERENCE', ...Object.fromEntries(Object.entries(row).map(([key,value]) => [key, value == null ? null : typeof value === 'boolean' || typeof value === 'number' ? value : String(value)]))}));};
  const sheet = (name: string) => {const rows = source.workbook.sheets.find(s => s.name === name)?.rows || []; const headers = rows[0] || []; return rows.slice(1).map(row => Object.fromEntries(headers.map((key,i) => [text(key), row[i] ?? null]).filter(([key]) => Boolean(key))));};
  put('weekly-reports', sheet('Weekly Reports')); put('packages', sheet('Packages')); put('kpis',sheet('Dashboard_KPIs'));
  // The workbook stores phones as =+92... formulas; the XLSX export drops the plus sign.
  put('active-members',sheet('Dashboard_ActiveMembers').map(row=>({...row,phone:typeof row.phone==='number'?'+'+row.phone:row.phone})));
  const marketplaceKeys = ['date','paymentIntentId','chargeId','product','category','quantity','totalAmount','platformFee','vendorPayout','vendorName','vendorEmail','vendorStripeAccount','customerEmail','customerName','transferId','currency','status','orderReference'];
  const marketSheet = source.workbook.sheets.find(s => s.name === 'Marketplace Transactions')?.rows || [];
  put('marketplace',marketSheet.slice(1).map(row => Object.fromEntries(marketplaceKeys.map((key,i) => [key,row[i] ?? null]))));
  put('users',(source.kisi.users || []).map((display: string) => {const emails = [...display.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]; const email = emails.at(-1); return {name: email ? display.slice(0,email.index).trim() : display,email:email?.[0] || '',status: /Suspended$/.test(display) ? 'Suspended' : 'Unknown',lastAccess:email ? display.slice(email.index! + email[0].length).replace(/Suspended$/, '').replace(/^-+|-+$/g,'').trim() || 'Not shown' : 'Not shown',sourceDisplay:display};}));
  put('groups',(source.kisi.groups || []).map((display: string) => {const scope = display.includes('Workspace Junction') ? 'Place' : 'Organization';const name = display.replace(/\s*(Workspace Junction|Organization) \d+ \d+$/, '').trim();const packageRow = state.records.packages.find(r => r.subscription_type === name);const inspected = name === source.kisi.classicGroupPermissions?.name ? source.kisi.classicGroupPermissions : {}; return {...inspected,name,scope,sourceGroupId:packageRow?.kisi_group_id == null ? null : String(packageRow.kisi_group_id),policyReviewed:false,sourceDisplay:display};}));
  for (const [section,key] of [['doors','doors'],['hardware','hardware'],['floors','floors'],['digital-credentials','digitalCredentials'],['integrations','integrations'],['report-catalog','reportCatalog'],['access-rights','referenceAccessRights']] as const) put(section,source.kisi[key] || []);
  put('organization-settings', source.kisi.organizationSettings ? [source.kisi.organizationSettings] : []);
  put('places',[{name:source.kisi.organization,sourcePlaceId:source.kisi.placeId,address:'1S280 Summit Avenue, Oakbrook Terrace, IL, USA',timeZone:'America/Chicago'}]);
  for (const [key,snapshot] of [['events',source.kisi.accessEvents],['audit-events',source.kisi.auditEvents]] as const) {
    const blocks = text(snapshot).split(/\n\s{4}- button/).slice(1);
    put(key,blocks.map(block => ({object: key === 'events' ? 'Main Entrance/Exit' : 'Captured audit object',action: key === 'events' ? /Unlocked/.test(block) ? 'Unlocked' : /Locked/.test(block) ? 'Locked' : 'Captured' : /Destroyed/.test(block) ? 'Destroyed' : /Updated/.test(block) ? 'Updated' : 'Created',sourceDisplay:readableCapture(block),occurredAt:capturedEventTime(readableCapture(block),source.capturedAt),user:(block.match(/link "([^"]+@[^"]+)"/)||[])[1]||''})));
  }
  for (const spec of cloneSections(state)) {state.records[spec.key] ||= [];const fields=new Set(['id','provenance',...spec.columns.map(c=>c.key)]);state.records[spec.key]=state.records[spec.key].map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>fields.has(key))) as CloneRecord);}
  refreshCloneDerived(state, new Date(source.capturedAt));
  return state;
}
export function refreshCloneDerived(state: CloneState, now = new Date()) {
  const members = state.records['active-members'] || [];
  const soon = now.getTime() + 7 * 86400000;
  state.records.expiring = members.filter(r => r.status === 'Active' && Date.parse(text(r.expires)) > now.getTime() && Date.parse(text(r.expires)) <= soon).map(r => ({...r}));
  state.records['failed-payments'] = members.filter(r => r.status === 'Payment failed').map(r => ({...r}));
}
export function cloneOverview(state: CloneState, now = new Date()) {
  refreshCloneDerived(state,now);
  const source = state.records.kpis?.[0] || {}, members = state.records['active-members'] || [];
  return {mode:'LOCAL_ONLY' as const,capturedAt:state.capturedAt,revision:state.revision,sourceLinks:state.sourceLinks,localLockdown:state.localLockdown,
    summary:{referenceActive:numeric(source.active_count),referenceExpiring:numeric(source.expiring_count),referenceFailed:numeric(source.failed_count),localActive:members.filter(r=>r.status==='Active'&&Date.parse(text(r.expires))>now.getTime()).length,localExpired:members.filter(r=>r.expires&&Date.parse(text(r.expires))<=now.getTime()).length,localFailed:state.records['failed-payments'].length},sections:cloneSections(state)};
}

export function validateCloneData(state: CloneState, sectionKey: string, input: unknown, editing?: CloneRecord) {
  const section = cloneSections(state).find(s=>s.key===sectionKey);
  if (!section || section.readOnly) throw new Error('This section is not locally editable.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Provide record fields.');
  const entries=Object.entries(input);
  const allowed=new Map(section.columns.filter(c=>!c.readOnly).map(c=>[c.key,c]));
  const result: Record<string,CloneCell> = {};
  for(const [key,value] of entries) {
    const spec=allowed.get(key); if(!spec) throw new Error('Unknown or protected field: '+key);
    if(value===null||value==='') {result[key]=null;continue;}
    if(spec.type==='number') {if(typeof value!=='number'||!Number.isFinite(value))throw new Error(spec.label+' must be a finite number.');result[key]=value;}
    else if(spec.type==='boolean') {if(typeof value!=='boolean')throw new Error(spec.label+' must be true or false.');result[key]=value;}
    else {if(typeof value!=='string'||value.length>(spec.type==='textarea'?10000:2000))throw new Error(spec.label+' is invalid or too long.');
      const s=value.trim();if(spec.type==='select'&&spec.options?.length&&!spec.options.includes(s))throw new Error('Choose a valid '+spec.label.toLowerCase()+'.');
      if((spec.type==='date'||spec.type==='datetime')&&!validCloneDate(s,spec.type==='datetime'))throw new Error(spec.label+' must include a valid date'+(spec.type==='datetime'?' and timezone.':'.'));
      if(/email$/i.test(key)&&s&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw new Error('Use a valid '+spec.label.toLowerCase()+'.');result[key]=s;
    }
  }
  const merged={...editing,...result};
  // A captured reference assignment keeps its undisclosed-timezone window until someone sets one explicitly.
  const referenceOnly=sectionKey==='access-rights'&&merged.status==='Reference only';
  for(const spec of section.columns.filter(c=>c.required&&!c.readOnly&&!(referenceOnly&&['validFrom','validUntil'].includes(c.key))))if(merged[spec.key]===undefined||merged[spec.key]===null||merged[spec.key]==='')throw new Error(spec.label+' is required.');
  if(sectionKey==='access-rights'&&merged.status==='Active'&&(!merged.validFrom||!merged.validUntil))throw new Error('An active access right needs a valid-from and valid-until time.');
  const windowed=section.columns.some(c=>c.key==='validFrom'&&c.type==='datetime')&&section.columns.some(c=>c.key==='validUntil'&&c.type==='datetime');
  if(windowed)for(const key of ['validFrom','validUntil'])if(merged[key]&&!Number.isFinite(Date.parse(text(merged[key]))))throw new Error('Invalid validity date.');
  if(windowed&&merged.validFrom&&merged.validUntil&&Date.parse(text(merged.validFrom))>=Date.parse(text(merged.validUntil)))throw new Error('Valid until must be after valid from.');
  if('timeZone' in merged && merged.timeZone)try{new Intl.DateTimeFormat('en-US',{timeZone:text(merged.timeZone)});}catch{throw new Error('Use a valid IANA time zone.');}
  if(sectionKey==='users'&&(state.records.users||[]).some(r=>r.id!==editing?.id&&text(r.email).toLowerCase()===text(merged.email).toLowerCase()))throw new Error('A cloned user already has this email.');
  if(['groups','teams','doors'].includes(sectionKey)&&(state.records[sectionKey]||[]).some(r=>r.id!==editing?.id&&text(r.name).toLowerCase()===text(merged.name).toLowerCase()))throw new Error('A record with this name already exists.');
  for(const key of ['group','user','team','door'])if(merged[key]){const target=key==='group'?'groups':key==='user'?'users':key==='team'?'teams':'doors';const field=key==='user'?'email':'name';if(!(state.records[target]||[]).some(r=>r[field]===merged[key]))throw new Error('Choose an existing local '+key+'.');}
  if(sectionKey==='marketplace') {if(![merged.totalAmount,merged.platformFee,merged.vendorPayout].every(v=>typeof v==='number'&&Number.isFinite(v)||typeof v==='string'&&/^\d+(?:\.\d{1,2})?$/.test(v)))throw new Error('Enter valid monetary amounts.');if(text(merged.currency).toLowerCase()!=='usd')throw new Error('The local ledger uses USD; currency conversion is not supported.');const total=numeric(merged.totalAmount),fee=numeric(merged.platformFee),payout=numeric(merged.vendorPayout);if([total,fee,payout].some(v=>v<0||Math.abs(v*100-Math.round(v*100))>0.000001)||Math.round(total*100)!==Math.round(fee*100)+Math.round(payout*100))throw new Error('Total amount must equal platform fee plus vendor payout, to the cent.');if(numeric(merged.quantity)<1||!Number.isInteger(numeric(merged.quantity)))throw new Error('Quantity must be a positive integer.');}
  if(sectionKey==='packages'){if(numeric(merged.amount)<0||numeric(merged.yearly_amount)<0||(numeric(merged.interval)<=0||!Number.isInteger(numeric(merged.interval))))throw new Error('Prices must be nonnegative and interval a positive integer.');if(merged.max_quantity!=null&&(numeric(merged.max_quantity)<1||!Number.isInteger(numeric(merged.max_quantity))))throw new Error('Maximum quantity must be a positive integer.');if(merged.kisi_access==='Yes'&&!merged.kisi_group_id)throw new Error('A Kisi-enabled package needs a reference group ID.');}
  if(sectionKey==='organization-settings'&&(!Number.isInteger(numeric(merged.sessionTimeoutDays))||numeric(merged.sessionTimeoutDays)<1||numeric(merged.sessionTimeoutDays)>365))throw new Error('Session timeout must be 1 to 365 whole days.');
  if(sectionKey==='event-retention'&&(!Number.isInteger(numeric(merged.periodDays))||numeric(merged.periodDays)<1||numeric(merged.periodDays)>3650))throw new Error('Retention period must be 1 to 3650 whole days.');
  if(sectionKey==='visitors'&&merged.shareAccess===true&&(!merged.email||!merged.group||merged.accessType==='Log visit only'))throw new Error('Shared local visitor access requires an email, a group and an access type.');
  if(sectionKey==='teams'){for(const email of text(merged.members).split(',').map(s=>s.trim()).filter(Boolean))if(!state.records.users.some(u=>u.email===email))throw new Error('Team members must be existing cloned users.');for(const group of text(merged.groups).split(',').map(s=>s.trim()).filter(Boolean))if(!state.records.groups.some(g=>g.name===group))throw new Error('Team groups must exist locally.');}
  if(sectionKey==='visitor-points'&&merged.durationHours!=null&&(numeric(merged.durationHours)<1||numeric(merged.durationHours)>240))throw new Error('Visitor access duration must be 1 to 240 hours.');
  if(sectionKey==='schedules'){if(!/^[1-7](?:\s*,\s*[1-7])*$/.test(text(merged.weekdays)))throw new Error('Use ISO weekdays 1 through 7, separated by commas.');for(const key of ['startTime','endTime'])if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text(merged[key])))throw new Error('Use 24-hour HH:mm times.');if(text(merged.startTime)>=text(merged.endTime))throw new Error('Schedule end must follow start on the same day.');for(const day of text(merged.exceptionDates).split(',').map(x=>x.trim()).filter(Boolean))if(!validCloneDate(day))throw new Error('Use valid YYYY-MM-DD exception dates.');}
  return result;
}
export function localAudit(state: CloneState, actorId: string, action: string, object: string, now = new Date()) {
  state.records['audit-events'].unshift({id:randomUUID(),provenance:'LOCAL',action,object,user:actorId,occurredAt:now.toISOString(),sourceDisplay:'Local clone only; no source change.'});
}
export function saveCloneRecord(state: CloneState, section: string, input: unknown, actorId: string, id?: string, now = new Date()) {
  const current=id?state.records[section]?.find(r=>r.id===id):undefined;
  if(id&&!current)throw new Error('Local record not found.');
  if(current?.provenance==='LIVE')throw new Error('This row is live from Kisi or the Sheet. Live sync is off, so change it in Kisi or the Sheet; it refreshes here automatically.');
  const data=validateCloneData(state,section,input,current);
  const row:CloneRecord={...current,...data,id:current?.id||randomUUID(),provenance:'LOCAL'};
  if(current) {
    state.records[section]=state.records[section].map(r=>r.id===id?row:r);
    const linkKey=section==='users'?'user':section==='groups'?'group':section==='teams'?'team':section==='doors'?'door':null;
    const ownKey=section==='users'?'email':'name';
    if(linkKey&&current[ownKey]!==row[ownKey]) {
      const listKey=section==='users'?'members':section==='groups'?'groups':section==='doors'?'doors':null;
      for(const [target,rows] of Object.entries(state.records))if(target!==section&&!['events','audit-events','weekly-reports','kpis'].includes(target))for(const dependent of rows){let changed=false;if(dependent[linkKey]===current[ownKey]){dependent[linkKey]=row[ownKey];changed=true;}if(listKey&&typeof dependent[listKey]==='string'){const parts=text(dependent[listKey]).split(',').map(v=>v.trim());if(parts.includes(text(current[ownKey]))){dependent[listKey]=parts.map(v=>v===text(current[ownKey])?text(row[ownKey]):v).join(', ');changed=true;}}if(changed)dependent.provenance='LOCAL';}
    }
  } else state.records[section].push(row);
  localAudit(state,actorId,current?'UPDATE':'CREATE',section+':'+row.id,now);refreshCloneDerived(state,now);
}
export function deleteCloneRecord(state: CloneState, section: string, id: string, actorId: string, now = new Date()) {
  const spec=cloneSections(state).find(s=>s.key===section);if(!spec||spec.readOnly)throw new Error('This section is not locally editable.');
  const row=state.records[section].find(r=>r.id===id);if(!row)throw new Error('Local record not found.');if(row.provenance==='LIVE')throw new Error('This row is live from Kisi or the Sheet. Live sync is off, so change it in Kisi or the Sheet; it refreshes here automatically.');
  const referenceKey=section==='users'?'user':section==='groups'?'group':section==='teams'?'team':section==='doors'?'door':null;
  const name=section==='users'?row.email:row.name;
  const listReference=section==='users'?'members':section==='groups'?'groups':section==='doors'?'doors':null;
  if(referenceKey&&Object.entries(state.records).some(([key,rows])=>key!==section&&!['expiring','failed-payments','events','audit-events','weekly-reports','kpis'].includes(key)&&rows.some(r=>r[referenceKey]===name||listReference&&text(r[listReference]).split(',').map(v=>v.trim()).includes(text(name)))))throw new Error('Remove dependent local records before deleting this '+section+' record.');
  state.records[section]=state.records[section].filter(r=>r.id!==id);localAudit(state,actorId,'DELETE',section+':'+id,now);refreshCloneDerived(state,now);
}

function withinSchedule(state:CloneState,group:CloneRecord,now:Date){
  if(group.timeRestriction!==true)return true;
  const schedules=state.records.schedules.filter(s=>s.group===group.name&&s.enabled===true);
  return schedules.some(s=>{try{const tz=text(s.timeZone)||'America/Chicago';const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));const day=parts.year+'-'+parts.month+'-'+parts.day;const weekday=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(parts.weekday)+1;if(!text(s.weekdays).split(',').map(x=>Number(x.trim())).includes(weekday)||text(s.exceptionDates).split(',').map(x=>x.trim()).includes(day))return false;const from=bookingWallTime(day,text(s.startTime),tz),until=bookingWallTime(day,text(s.endTime),tz);return from<=now&&now<until;}catch{return false;}});
}
export function simulateCloneUnlock(state:CloneState,doorId:string,userId:string,actorId:string,now=new Date()){
  const door=state.records.doors.find(r=>r.id===doorId),user=state.records.users.find(r=>r.id===userId);if(!door||!user)throw new Error('Choose an existing local door and user.');
  let allowed=false,reason='No matching active, reviewed local group assignment.';
  if(state.localLockdown)reason='Local lockdown is active.';
  else if(user.status!=='Enabled')reason='User is suspended or access status is unknown.';
  else {
    const assignments=state.records['access-rights'].filter(r=>r.user===user.email&&r.status==='Active'&&Date.parse(text(r.validFrom))<=now.getTime()&&Date.parse(text(r.validUntil))>now.getTime());
    const teamGroups=state.records.teams.filter(t=>Date.parse(text(t.validFrom))<=now.getTime()&&Date.parse(text(t.validUntil))>now.getTime()&&text(t.members).split(',').map(s=>s.trim()).includes(text(user.email))).flatMap(t=>text(t.groups).split(',').map(s=>s.trim()));
    const groupNames=[...assignments.map(a=>text(a.group)),...teamGroups];
    const candidates=state.records.groups.filter(g=>groupNames.includes(text(g.name))&&text(g.doors).split(',').map(s=>s.trim()).includes(text(door.name)));
    if(!candidates.length)reason='No active assignment or team gives this user a group that includes this door.';
    else if(!candidates.some(g=>g.policyReviewed===true&&g.appAccess===true))reason='The matching group policy is not reviewed locally or app access is off.';
    else if(!candidates.some(g=>g.primaryDeviceRestriction===false&&g.geofenceRestriction===false&&g.readerProximityRestriction===false&&g.readerTapRestriction===false))reason='A device, geofence, reader proximity or tap restriction is on or unknown; a remote simulation cannot satisfy it.';
    else reason='Outside the group\'s access schedule (or restricted date).';
    allowed=state.records.groups.some(g=>groupNames.includes(text(g.name))&&g.policyReviewed===true&&g.appAccess===true&&text(g.doors).split(',').map(s=>s.trim()).includes(text(door.name))&&g.primaryDeviceRestriction===false&&g.geofenceRestriction===false&&g.readerProximityRestriction===false&&g.readerTapRestriction===false&&typeof g.timeRestriction==='boolean'&&withinSchedule(state,g,now));
    if(allowed)reason='Matching local policy permits this simulated app unlock. Physical restrictions are never assumed satisfied.';
  }
  state.records.events.unshift({id:randomUUID(),provenance:'LOCAL',object:text(door.name),user:text(user.email),action:allowed?'SIMULATED_UNLOCK_ALLOWED':'SIMULATED_UNLOCK_DENIED',occurredAt:now.toISOString(),sourceDisplay:reason+' No real door signal sent.'});
  localAudit(state,actorId,'SIMULATE_UNLOCK',text(door.name),now);
  return (allowed?'Simulation allowed. ':'Simulation denied. ')+reason+' No real door was changed.';
}
function generateWeeklyReport(state:CloneState,now:Date){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}).formatToParts(now).map(p=>[p.type,p.value]));
  const day=parts.year+'-'+parts.month+'-'+parts.day;const date=new Date(day+'T00:00:00Z');const monday=new Date(date);monday.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));const sunday=new Date(monday);sunday.setUTCDate(monday.getUTCDate()+6);const from=bookingWallTime(monday.toISOString().slice(0,10),'00:00','America/Chicago');
  const inWeek=(v:unknown)=>Date.parse(text(v))>=from.getTime()&&Date.parse(text(v))<=now.getTime();
  const members=state.records['active-members'],active=members.filter(r=>r.status==='Active'&&Date.parse(text(r.expires))>now.getTime()),expired=members.filter(r=>inWeek(r.expires));const leads=state.records.leads.filter(r=>inWeek(r.createdAt)),won=leads.filter(r=>r.status==='WON');const charges=state.records.marketplace.filter(r=>r.provenance==='LOCAL'&&inWeek(r.date));const paid=charges.filter(r=>r.status==='succeeded'),failed=charges.filter(r=>r.status==='failed');const revenue=paid.reduce((sum,r)=>sum+numeric(r.totalAmount),0);const breakdown:Record<string,number>={};for(const member of active)breakdown[text(member.plan)]=(breakdown[text(member.plan)]||0)+1;
  const row:CloneRecord={id:randomUUID(),provenance:'LOCAL',report_date:day,week_ending:sunday.toISOString().slice(0,10),active_members:active.length,expired_this_week:expired.length,new_leads:leads.length,won_leads:won.length,conversion_rate:(leads.length?won.length/leads.length*100:0).toFixed(1)+'%',churn_rate:(active.length+expired.length?expired.length/(active.length+expired.length)*100:0).toFixed(1)+'%',total_revenue:'$'+revenue.toFixed(2),successful_charges:paid.length,failed_charges:failed.length,arpu:'$'+(active.length?revenue/active.length:0).toFixed(2),plan_breakdown:Object.keys(breakdown).length?Object.entries(breakdown).sort((a,b)=>b[1]-a[1]).map(([plan,count])=>plan+': '+count).join(', '):'No active members',timestamp:now.toISOString()};
  // Regeneration replaces only the same local week, preserving every captured report.
  state.records['weekly-reports']=state.records['weekly-reports'].filter(r=>!(r.provenance==='LOCAL'&&r.week_ending===row.week_ending));state.records['weekly-reports'].push(row);
}
export function applyCloneAction(state:CloneState,action:string,section:string|undefined,id:string|undefined,data:Record<string,unknown>,actorId:string,now=new Date()){
  let notice='Local change saved. No live system was changed.';
  const locate=(key:string)=>{const record=state.records[key]?.find(r=>r.id===id);if(!record)throw new Error('Local record not found.');if(record.provenance==='LIVE')throw new Error('This row is live from Kisi or the Sheet. Live sync is off, so change it in Kisi or the Sheet; it refreshes here automatically.');return record;};
  if(action==='generate-report'){generateWeeklyReport(state,now);localAudit(state,actorId,'GENERATE_LOCAL_REPORT','weekly-reports',now);}
  else if(action==='suspend-user'||action==='resume-user'){const user=locate('users');user.status=action==='suspend-user'?'Suspended':'Enabled';user.provenance='LOCAL';localAudit(state,actorId,action,text(user.email),now);}
  else if(action==='offboard-member'){const member=locate('active-members');member.status='Cancelled';member.provenance='LOCAL';for(const right of state.records['access-rights'].filter(r=>r.user===member.email)){right.status='Revoked';right.provenance='LOCAL';}for(const user of state.records.users.filter(r=>text(r.email).toLowerCase()===text(member.email).toLowerCase())){user.status='Suspended';user.provenance='LOCAL';}for(const team of state.records.teams){const emails=text(team.members).split(',').map(s=>s.trim()).filter(Boolean);if(emails.some(email=>email.toLowerCase()===text(member.email).toLowerCase())){team.members=emails.filter(email=>email.toLowerCase()!==text(member.email).toLowerCase()).join(', ');team.provenance='LOCAL';}}localAudit(state,actorId,action,text(member.email),now);}
  else if(action==='check-in-visitor'||action==='check-out-visitor'){const visitor=locate('visitors');if(action==='check-in-visitor'){if(visitor.status!=='Invited'||Date.parse(text(visitor.validFrom))>now.getTime()||Date.parse(text(visitor.validUntil))<=now.getTime())throw new Error('Only an invited visitor within the valid visit window can check in.');visitor.status='Checked in';visitor.checkedInAt=now.toISOString();if(visitor.shareAccess===true){if(!visitor.email||!state.records.groups.some(g=>g.name===visitor.group))throw new Error('Shared visitor access requires a local group and email.');let user=state.records.users.find(u=>text(u.email).toLowerCase()===text(visitor.email).toLowerCase());if(!user){user={id:randomUUID(),provenance:'LOCAL',name:text(visitor.name),email:text(visitor.email),status:'Enabled'};state.records.users.push(user);}state.records['access-rights'].push({id:randomUUID(),provenance:'LOCAL',visitorId:visitor.id,user:text(user.email),group:text(visitor.group),role:'group_basic',validFrom:text(visitor.validFrom),validUntil:text(visitor.validUntil),status:'Active'});}}else{if(visitor.status!=='Checked in')throw new Error('Only a checked-in visitor can check out.');visitor.status='Checked out';visitor.checkedOutAt=now.toISOString();for(const right of state.records['access-rights'].filter(r=>r.visitorId===visitor.id)){right.status='Revoked';right.provenance='LOCAL';}}visitor.provenance='LOCAL';localAudit(state,actorId,action,text(visitor.name),now);}
  else if(action==='simulate-unlock')notice=simulateCloneUnlock(state,id||'',text(data.userId),actorId,now);
  else if(action==='simulate-lockdown'){if(id&&!state.records.doors.some(r=>r.id===id))throw new Error('Local record not found.');state.localLockdown=!state.localLockdown;localAudit(state,actorId,'SIMULATE_LOCKDOWN',state.localLockdown?'ON':'OFF',now);notice='Local lockdown '+(state.localLockdown?'enabled':'disabled')+'. No real door was changed.';}
  else throw new Error('Unsupported local action.');
  refreshCloneDerived(state,now);return notice;
}

/** Validate persisted private state before returning any part of it to an admin. */
export function validateStoredClone(value:unknown):CloneState {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid clone state.');
  const state=value as CloneState;
  if(!Number.isSafeInteger(state.revision)||state.revision<0||typeof state.localLockdown!=='boolean'||!validCloneDate(state.capturedAt,true)||!state.records||typeof state.records!=='object'||Array.isArray(state.records))throw new Error('Invalid clone state.');
  if(typeof state.sourceLinks?.sheets!=='string'||typeof state.sourceLinks?.kisi!=='string')throw new Error('Invalid reference links.');
  if(new URL(state.sourceLinks.sheets).origin!=='https://docs.google.com'||new URL(state.sourceLinks.kisi).origin!=='https://web.kisi.io')throw new Error('Unexpected reference origin.');
  if(Buffer.byteLength(JSON.stringify(state))>12*1024*1024)throw new Error('Clone state exceeds the supported limit.');
  for(const rows of Object.values(state.records))if(!Array.isArray(rows)||rows.length>10000)throw new Error('Invalid clone section.');
  const sections=cloneSections(state),known=new Map(sections.map(s=>[s.key,s]));
  for(const [section,rows] of Object.entries(state.records)) {
    const spec=known.get(section);if(!spec)throw new Error('Unknown clone section.');
    const fields=new Set(['id','provenance','visitorId',...spec.columns.map(c=>c.key)]),ids=new Set<string>();
    for(const row of rows){
      if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||row.id.length>100||ids.has(row.id)||!['LOCAL','REFERENCE'].includes(row.provenance))throw new Error('Invalid clone record.');ids.add(row.id);
      for(const [key,cell] of Object.entries(row))if(!fields.has(key)||!['string','number','boolean'].includes(typeof cell)&&cell!==null||typeof cell==='number'&&!Number.isFinite(cell)||typeof cell==='string'&&cell.length>20000)throw new Error('Invalid clone field.');
    }
  }
  for(const section of sections)if(!state.records[section.key])throw new Error('Missing clone section.');
  return structuredClone(state);
}

/** Live monitor overlay: live rows replace reference rows section by section; local records stay. Live rows never persist. */
export const LIVE_SECTIONS = ['n8n-events','weekly-reports','packages','kpis','active-members','marketplace','users','groups','access-rights','doors','hardware','floors','elevators','access-points','digital-credentials','credentials','visitors','places','events','audit-events'];
export function overlayLive(state: CloneState, live: {records: Record<string, CloneRecord[]>} | null | undefined): CloneState {
  if (!live) return state;
  const merged: CloneState = structuredClone(state);
  for (const key of LIVE_SECTIONS) {
    const rows = live.records[key];
    if (!Array.isArray(rows)) continue;
    const local = (merged.records[key] || []).filter(r => r.provenance === 'LOCAL');
    // Local simulation events stay on top of the live feed.
    merged.records[key] = key === 'events' || key === 'audit-events' ? [...local, ...rows] : [...rows, ...local];
  }
  return merged;
}
/** Persist only non-live rows, keeping captured reference rows for sections a live source replaced. */
export function stripLive(merged: CloneState, original: CloneState): CloneState {
  const out: CloneState = {...merged, records: {}};
  for (const [key, rows] of Object.entries(merged.records)) {
    const kept = rows.filter(r => r.provenance !== 'LIVE');
    const hadReference = (original.records[key] || []).filter(r => r.provenance === 'REFERENCE' && !kept.some(k => k.id === r.id));
    out.records[key] = [...hadReference, ...kept];
  }
  return out;
}
