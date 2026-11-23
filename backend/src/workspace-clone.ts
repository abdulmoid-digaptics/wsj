import {BadRequestException, ConflictException, Controller, Delete, Get, Inject, Injectable, OnModuleDestroy, OnModuleInit, Param, Patch, Post, Req, ServiceUnavailableException, UseGuards} from '@nestjs/common';
import {ApiBearerAuth} from '@nestjs/swagger';
import {IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min} from 'class-validator';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {Db, AuthGuard, Roles} from './core';
import {ValidatedBody} from './validation';
import {applyCloneAction, CloneState, cloneOverview, deleteCloneRecord, overlayLive, saveCloneRecord, seedClone, stripLive, validateStoredClone} from './workspace-clone-core';
import {WorkspaceLiveService} from './workspace-live';
import {WorkspaceSyncService} from './workspace-sync';
import {N8nEventsService} from './n8n-events';
import {Optional} from '@nestjs/common';

const KIND = 'private-workspace-clone';
const SLUG = 'workspace-operations';
class RevisionDto { @IsInt() @Min(0) @Max(1000000000) revision!: number; }
class RecordDto extends RevisionDto { @IsObject() data!: Record<string,unknown>; }
class ActionDto extends RevisionDto {
  @IsIn(['generate-report','suspend-user','resume-user','offboard-member','check-in-visitor','check-out-visitor','simulate-unlock','simulate-lockdown']) action!: string;
  @IsOptional() @IsString() @MaxLength(100) section?: string;
  @IsOptional() @IsString() @MaxLength(100) id?: string;
  @IsOptional() @IsObject() data?: Record<string,unknown>;
}

/** Local-only clone. No Kisi, Google, Stripe, email, webhook or network dependencies. */
@Injectable()
export class WorkspaceCloneService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(@Inject(Db) private readonly db:Db, @Optional() @Inject(WorkspaceLiveService) private readonly live?: WorkspaceLiveService, @Optional() @Inject(WorkspaceSyncService) private readonly sync?: WorkspaceSyncService, @Optional() @Inject(N8nEventsService) private readonly n8n?: N8nEventsService) {}
  /** Current merged view (stored + live), used to route edits on live rows to Kisi. */
  private async mergedView(){ const saved=await this.db.content.findUnique({where:{kind_slug:{kind:KIND,slug:SLUG}}}); const state=saved?this.state(saved.content):await this.seed(); return overlayLive(state,this.liveSnapshot()); }
  private get syncOn(){ return !!this.sync?.enabled && !!this.live?.enabled; }
  /** Run a Kisi write, refresh live Kisi data, and return the fresh overview with a notice. */
  private async kisiWrite(work:()=>Promise<string>){
    let notice:string;
    try { notice=await work(); } catch(e:any){ if(typeof e?.getStatus==='function')throw e; throw new BadRequestException(e instanceof Error?e.message:'Kisi rejected the change.'); }
    await this.live?.refreshKisi();
    return {...(await this.overview()),notice};
  }
  /** Live Kisi/Sheet rows plus the n8n sync log (the log is shown even when live monitoring is off). */
  private liveSnapshot(){ const s=this.live?.current(); const events=this.n8n?.rows()??[]; if(s?.enabled)return {...s,records:{...s.records,'n8n-events':events}}; return events.length?{records:{'n8n-events':events}}:null; }
  private liveStatus(){ const s=this.live?.current(); return s?{enabled:s.enabled,kisi:s.kisi,sheets:s.sheets,writesEnabled:!!this.sync?.enabled,syncSections:WorkspaceSyncService.EDIT_SECTIONS}:{enabled:false,kisi:null,sheets:null,writesEnabled:false}; }
  async refreshLive(){ if(!this.live?.enabled)throw new BadRequestException('Live monitoring is off. Set WORKSPACE_LIVE_MONITOR=true on the API server.'); await this.live.refreshAll(); return this.overview(); }
  /** Mirrors the Sheet workflow: one weekly report row each Monday from 00:00 Chicago time. Writes only the local clone. */
  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.WORKSPACE_CLONE_AUTO_REPORT === 'off') return;
    const tick = () => void this.autoWeeklyReport().catch(() => console.warn('[workspace-clone] automatic weekly report skipped'));
    this.timer = setInterval(tick, 15 * 60000); this.timer.unref();
    setTimeout(tick, 60000).unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async autoWeeklyReport(now = new Date()) {
    const weekday = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Chicago', weekday: 'short'}).format(now);
    if (weekday !== 'Mon') return false;
    const saved = await this.db.content.findUnique({where: {kind_slug: {kind: KIND, slug: SLUG}}});
    if (!saved) return false; // Only after an admin has opened and saved the clone at least once.
    const state = this.state(saved.content);
    const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'}).format(now);
    if (state.records['weekly-reports'].some(r => r.provenance === 'LOCAL' && r.report_date === today)) return false;
    await this.mutate(state.revision, 'system:weekly-report', s => applyCloneAction(s, 'generate-report', 'weekly-reports', undefined, {}, 'system:weekly-report', now));
    return true;
  }
  private async seed():Promise<CloneState> {
    try {
      const filename=process.env.WORKSPACE_CLONE_REFERENCE_PATH || path.resolve(__dirname,'../private/workspace-reference.json');
      const raw=await readFile(filename,'utf8');
      if(Buffer.byteLength(raw)>3*1024*1024)throw new Error('oversized');
      const source=JSON.parse(raw);
      if(source.version!==1||!Array.isArray(source.workbook?.sheets)||!source.kisi||!Number.isFinite(Date.parse(source.capturedAt)))throw new Error('invalid');
      return validateStoredClone(seedClone(source));
    } catch {throw new ServiceUnavailableException('The private read-only reference snapshot is not available. Configure WORKSPACE_CLONE_REFERENCE_PATH on the API server. No live source was contacted.');}
  }
  private state(value:unknown):CloneState {
    try {return validateStoredClone(value);} catch {throw new ServiceUnavailableException('Local clone state is invalid. Restore a reviewed local backup; live sources are unchanged.');}
  }
  async overview() {
    const saved=await this.db.content.findUnique({where:{kind_slug:{kind:KIND,slug:SLUG}}});
    const state=saved?this.state(saved.content):await this.seed();
    return {...cloneOverview(overlayLive(state,this.liveSnapshot())),live:this.liveStatus()};
  }
  private async mutate(revision:number,actorId:string,work:(state:CloneState)=>string|void) {
    // One optimistic revision and advisory lock across every clone section prevents lost updates.
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(917431102)`;
      const existing=await tx.content.findUnique({where:{kind_slug:{kind:KIND,slug:SLUG}}});
      const state=existing?this.state(existing.content):await this.seed();
      if(state.revision!==revision)throw new ConflictException('The local clone changed in another window. Reload latest before saving.');
      let notice:string|void;
      const merged=overlayLive(state,this.liveSnapshot());
      try {notice=work(merged);}catch(error){throw new BadRequestException(error instanceof Error?error.message:'Invalid local operation.');}
      const next=stripLive(merged,state);
      next.revision=state.revision+1;
      const content=JSON.parse(JSON.stringify(next));
      await tx.content.upsert({where:{kind_slug:{kind:KIND,slug:SLUG}},create:{kind:KIND,slug:SLUG,title:'Private workspace operations clone',status:'DRAFT',content},update:{content}});
      await tx.audit.create({data:{actorId,action:'WORKSPACE_CLONE_LOCAL_CHANGE',resource:'workspace-clone',details:{revision:state.revision,mode:'LOCAL_ONLY'}}});
      return {...cloneOverview(overlayLive(next,this.liveSnapshot())),live:this.liveStatus(),...(notice?{notice}:{})};
    },{maxWait:10000,timeout:15000});
  }
  async create(section:string,dto:RecordDto,actorId:string){
    if(this.syncOn&&WorkspaceSyncService.CREATE_SECTIONS.includes(section)){
      const v=await this.mergedView();
      return this.kisiWrite(()=>section==='users'?this.sync!.createUser(dto.data,actorId):this.sync!.createAccess(dto.data,v.records.users,v.records.groups,actorId));
    }
    return this.mutate(dto.revision,actorId,state=>saveCloneRecord(state,section,dto.data,actorId));
  }
  async update(section:string,id:string,dto:RecordDto,actorId:string){
    if(this.syncOn&&WorkspaceSyncService.EDIT_SECTIONS.includes(section)){
      const v=await this.mergedView(); const row=v.records[section]?.find(r=>r.id===id);
      if(row?.provenance==='LIVE')return this.kisiWrite(()=>section==='users'?this.sync!.updateUser(row,dto.data,actorId):this.sync!.updateAccess(row,dto.data,v.records.users,v.records.groups,actorId));
    }
    return this.mutate(dto.revision,actorId,state=>saveCloneRecord(state,section,dto.data,actorId,id));
  }
  async remove(section:string,id:string,dto:RevisionDto,actorId:string){
    if(this.syncOn&&section==='access-rights'){
      const v=await this.mergedView(); const row=v.records[section]?.find(r=>r.id===id);
      if(row?.provenance==='LIVE')return this.kisiWrite(()=>this.sync!.removeAccess(row,actorId));
    }
    return this.mutate(dto.revision,actorId,state=>deleteCloneRecord(state,section,id,actorId));
  }
  async action(dto:ActionDto,actorId:string){
    if(dto.data&&Object.keys(dto.data).some(k=>k!=='userId'))throw new BadRequestException('Unknown local action field.');
    if(dto.data?.userId!==undefined&&(typeof dto.data.userId!=='string'||dto.data.userId.length>100))throw new BadRequestException('Invalid local user selection.');
    if(this.syncOn&&dto.id&&['suspend-user','resume-user','offboard-member'].includes(dto.action)){
      const v=await this.mergedView(); const key=dto.action==='offboard-member'?'active-members':'users'; const row=v.records[key]?.find(r=>r.id===dto.id);
      if(row?.provenance==='LIVE'){
        if(dto.action==='offboard-member')return this.kisiWrite(()=>this.sync!.offboard(String(row.email||''),v.records.users,actorId));
        return this.kisiWrite(()=>this.sync!.setUserAccess(row,dto.action==='resume-user',actorId));
      }
    }
    return this.mutate(dto.revision,actorId,state=>applyCloneAction(state,dto.action,dto.section,dto.id,dto.data||{},actorId));
  }
}
@ApiBearerAuth() @UseGuards(AuthGuard) @Roles('ADMIN') @Controller('admin/workspace-clone')
export class WorkspaceCloneController {
  constructor(@Inject(WorkspaceCloneService) private readonly clone:WorkspaceCloneService){}
  @Get() overview(){return this.clone.overview();}
  @Post('live/refresh') refreshLive(){return this.clone.refreshLive();}
  @Post('records/:section') create(@Param('section') section:string,@ValidatedBody(RecordDto) dto:RecordDto,@Req() req:any){return this.clone.create(section,dto,req.user.id);}
  @Patch('records/:section/:id') update(@Param('section') section:string,@Param('id') id:string,@ValidatedBody(RecordDto) dto:RecordDto,@Req() req:any){return this.clone.update(section,id,dto,req.user.id);}
  @Delete('records/:section/:id') remove(@Param('section') section:string,@Param('id') id:string,@ValidatedBody(RevisionDto) dto:RevisionDto,@Req() req:any){return this.clone.remove(section,id,dto,req.user.id);}
  @Post('actions') action(@ValidatedBody(ActionDto) dto:ActionDto,@Req() req:any){return this.clone.action(dto,req.user.id);}
}
