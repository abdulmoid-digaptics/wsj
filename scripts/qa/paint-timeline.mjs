import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

/** Raw trace timings only. Never add these values to simulated Lighthouse metrics. */
export function analyzePaintTimeline(trace) {
 const events=trace.traceEvents;
 if(!Array.isArray(events))throw Error('Expected Chrome traceEvents array');
 const ordered=events.filter(e=>Number.isFinite(e.ts)).sort((a,b)=>a.ts-b.ts);
 const navigations=ordered.filter(e=>e.name==='navigationStart'&&e.args?.data?.isOutermostMainFrame===true);
 const nav=navigations.at(-1);
 if(!nav)throw Error('No outermost main-frame navigation');
 const navigationId=nav.args.data.navigationId;
 if(!navigationId)throw Error('Navigation ID required for unambiguous correlation');
 const candidates=ordered.filter(e=>e.name==='largestContentfulPaint::Candidate'&&e.args?.data?.navigationId===navigationId&&e.ts>=nav.ts);
 const lcp=candidates.at(-1);
 if(!lcp)throw Error('No LCP candidate for selected navigation');
 const data=lcp.args.data;
 const selected=ordered.filter(e=>e.pid===lcp.pid&&e.ts>=nav.ts&&e.ts<=lcp.ts);
 const main=selected.filter(e=>e.tid===lcp.tid);
 const ms=e=>e?(e.ts-nav.ts)/1000:null;
 const duration=e=>e?.dur===undefined?null:e.dur/1000;
 const frame=nav.args.frame;
 const relevantFrame=e=>!e.args?.frame||e.args.frame===frame;
 const paint=main.find(e=>e.name==='PaintImage'&&e.args?.data?.nodeId===data.nodeId);
 // Phase X Commit has an actual duration; async Commit markers are not equivalent.
 const commit=paint?main.find(e=>e.name==='Commit'&&e.ph==='X'&&e.ts>=paint.ts):null;
 const firstPaint=main.find(e=>e.name==='firstPaint'&&relevantFrame(e));
 const fcp=main.find(e=>e.name==='firstContentfulPaint'&&relevantFrame(e));
 const layouts=main.filter(e=>e.name==='Layout'&&e.dur>0);
 const tasks=main.filter(e=>e.name==='RunTask'&&e.ph==='X'&&e.dur>0);
 const intervalStart=paint?.ts;
 const intervalEnd=lcp.ts;
 // Union, not sum: nested/overlapping tasks must not inflate busy time.
 const spans=intervalStart===undefined?[]:tasks.map(e=>[Math.max(intervalStart,e.ts),Math.min(intervalEnd,e.ts+e.dur)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
 const merged=[];
 for(const span of spans){const last=merged.at(-1);if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else merged.push([...span]);}
 const busyMs=intervalStart===undefined?null:merged.reduce((sum,[a,b])=>sum+b-a,0)/1000;
 const gapMs=paint?(lcp.ts-paint.ts)/1000:null;
 return {
  kind:'Raw trace correlation, not simulated Lighthouse LCP or field acceptance',
  navigation:{id:navigationId,url:nav.args.data.documentLoaderURL,pid:lcp.pid,mainThreadId:lcp.tid},
  lcp:{rawMs:ms(lcp),nodeId:data.nodeId,nodeName:data.nodeName,type:data.type,imageLoadEndMs:data.imageLoadEnd??null},
  imagePaint:paint?{rawMs:ms(paint),url:paint.args.data.url,nodeId:paint.args.data.nodeId}:null,
  firstCommitAfterImagePaintMs:ms(commit),firstPaintMs:ms(firstPaint),firstContentfulPaintMs:ms(fcp),
  paintToLcpGapMs:gapMs,mainThreadTaskBusyDuringGapMs:busyMs,
  gapOutsideRecordedMainThreadTasksMs:gapMs===null?null:Math.max(0,gapMs-busyMs),
  layouts:layouts.map(e=>({rawMs:ms(e),durationMs:duration(e),objects:e.args?.beginData?.totalObjects??null})),
  longTasks:tasks.filter(e=>e.dur>=50000).map(e=>({rawMs:ms(e),durationMs:duration(e)})),
  // Decode Image lacks a stable image node/url identifier in these traces. Do not attribute it to the hero.
  unattributedProcessImageDecodes:selected.filter(e=>e.name==='Decode Image').map(e=>({rawMs:ms(e),durationMs:duration(e),type:e.args?.imageType??null,threadId:e.tid})),
  caveats:['PaintImage records painting work, not displayed pixels.','Time outside recorded main-thread tasks does not identify the compositor, GPU, OS, network, or paint-holding cause.','Decode events are process-scoped and not proven to belong to the LCP image.','Raw trace timings must not be added to or substituted for simulated Lighthouse LCP.']
 };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [input,output]=process.argv.slice(2);
  if(!input||!output)throw Error('Usage: node scripts/qa/paint-timeline.mjs <trace.json> <fresh-output.json>');
  const result=analyzePaintTimeline(JSON.parse(await fs.readFile(input,'utf8')));
  await fs.writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result,null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
