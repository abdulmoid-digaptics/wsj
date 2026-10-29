import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePaintTimeline} from './paint-timeline.mjs';
const event=(name,ts,extra={})=>({name,ts,pid:1,tid:2,...extra});
const fixture=()=>({traceEvents:[
 event('navigationStart',100000,{args:{frame:'f',data:{isOutermostMainFrame:true,navigationId:'nav',documentLoaderURL:'http://localhost:3100/'}}}),
 event('PaintImage',300000,{args:{data:{nodeId:10,url:'http://localhost:3100/hero.webp'}}}),
 event('Commit',310000,{ph:'X',dur:1000}),
 event('RunTask',350000,{ph:'X',dur:100000}),
 event('RunTask',380000,{ph:'X',dur:100000}),
 event('firstPaint',1100000,{args:{frame:'f'}}),
 event('firstContentfulPaint',1100000,{args:{frame:'f'}}),
 event('largestContentfulPaint::Candidate',1100000,{args:{data:{navigationId:'nav',nodeId:10,nodeName:'IMG',type:'image',imageLoadEnd:40}}})
]});
test('separates raw paint, presentation, and task union',()=>{const r=analyzePaintTimeline(fixture());assert.equal(r.imagePaint.rawMs,200);assert.equal(r.lcp.rawMs,1000);assert.equal(r.paintToLcpGapMs,800);assert.equal(r.mainThreadTaskBusyDuringGapMs,130);assert.equal(r.gapOutsideRecordedMainThreadTasksMs,670);assert.equal(r.firstCommitAfterImagePaintMs,210);assert.equal(r.firstPaintMs,1000);});
test('ignores unrelated process/thread and async commit markers',()=>{const t=fixture();t.traceEvents.push(event('PaintImage',200000,{pid:99,args:{data:{nodeId:10}}}),event('Commit',305000,{ph:'b'}),event('RunTask',300000,{tid:99,ph:'X',dur:800000}));const r=analyzePaintTimeline(t);assert.equal(r.imagePaint.rawMs,200);assert.equal(r.mainThreadTaskBusyDuringGapMs,130);assert.equal(r.firstCommitAfterImagePaintMs,210);});
test('sorts trace events and matches navigation ID',()=>{const t=fixture();t.traceEvents.push(event('largestContentfulPaint::Candidate',1200000,{args:{data:{navigationId:'other',nodeId:10}}}));t.traceEvents.reverse();assert.equal(analyzePaintTimeline(t).lcp.rawMs,1000);});
test('does not invent hero decode attribution',()=>{const t=fixture();t.traceEvents.push(event('Decode Image',250000,{tid:5,dur:13000,args:{imageType:'webp'}}));const r=analyzePaintTimeline(t);assert.equal(r.unattributedProcessImageDecodes[0].durationMs,13);assert.ok(r.caveats.some(c=>c.includes('not proven')));});
test('missing matching image paint stays unknown',()=>{const t=fixture();t.traceEvents=t.traceEvents.filter(e=>e.name!=='PaintImage');const r=analyzePaintTimeline(t);assert.equal(r.imagePaint,null);assert.equal(r.paintToLcpGapMs,null);assert.equal(r.mainThreadTaskBusyDuringGapMs,null);assert.equal(r.gapOutsideRecordedMainThreadTasksMs,null);});
test('requires main-frame navigation and matching LCP',()=>{assert.throws(()=>analyzePaintTimeline({traceEvents:[]}),/navigation/);const t=fixture();t.traceEvents=t.traceEvents.filter(e=>e.name!=='largestContentfulPaint::Candidate');assert.throws(()=>analyzePaintTimeline(t),/LCP/);});
test('clips tasks to the image-paint and LCP interval',()=>{const t=fixture();t.traceEvents.push(event('RunTask',250000,{ph:'X',dur:100000}),event('RunTask',1000000,{ph:'X',dur:300000}));assert.equal(analyzePaintTimeline(t).mainThreadTaskBusyDuringGapMs,280);});
test('latest navigation cannot reuse stale previous-page evidence',()=>{const t=fixture();t.traceEvents.push(event('navigationStart',1300000,{args:{frame:'f',data:{isOutermostMainFrame:true,navigationId:'new'}}}));assert.throws(()=>analyzePaintTimeline(t),/LCP/);});
