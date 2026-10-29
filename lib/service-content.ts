import {parseDocument} from 'htmlparser2';
import {textContent} from 'domutils';
import render from 'dom-serializer';

type Node=ReturnType<typeof parseDocument>['children'][number];
export type ServiceSection={title:string;html:string;key:string};
export type ServiceContent={overview:string;sections:ServiceSection[];features:{title:string;copy:string}[];legacyCount:number};
const normalize=(s:string)=>s.replace(/\s+/g,' ').trim();
const name=(n:Node)=>'name' in n?n.name:'';
const heading=(n:Node)=>/^h[1-6]$/.test(name(n));
const riskyText=/(?:[$€£]\s*\d|\b(?:USD|per month|per hour)\b|instant access|confirmation.*(?:email|immediate)|(?:payment|credit card|checkout)|tap your phone|download.*app|cancel anytime|24\s*\/\s*7)/i;
const archiveTopic=/testimoni|trusted by|pricing|packages|membership overview|(?:^|\s)(?:bronze|silver|gold|platinum)(?:\s|$)|classic dedicated|performance dedicated|how.*works|getting started|choose your plan|reserve your time|reserve your session|choose your room|walk into a fully prepared|record with confidence|get broadcast-ready|instant access|tap.*work|^0[1-9][.\s]|insights, tips|complete guide|ultimate guide|monthly membership/i;
/** Input MUST already be safeContent HTML. Never use this as a sanitizer. */
export function organizeServiceContent(safeHtml:string,options:{informational?:boolean}={}):ServiceContent{
 const doc=parseDocument(safeHtml);
 // Flatten layout containers only. Lists, figures, tables, links and other
 // semantic containers remain whole; no regex slicing of nested HTML.
 const flatten=(nodes:Node[]):Node[]=>nodes.flatMap(n=>['div','section','article','main','header','footer'].includes(name(n))&&'children' in n?flatten(n.children):[n]);
 const nodes=flatten(doc.children);
 const groups:{title:string;nodes:Node[]}[]=[];
 let current={title:'Overview',nodes:[] as Node[]};
 for(const n of nodes){
  if(/^h[12]$/.test(name(n))||(name(n)==='h3'&&/faq|questions|pricing|membership overview/i.test(textContent(n)))){
   if(current.nodes.some(v=>!heading(v)&&normalize(textContent(v)).length>35))groups.push(current);
   current={title:normalize(textContent(n))||current.title,nodes:[]};
  }else current.nodes.push(n);
 }
 if(current.nodes.length)groups.push(current);
 const seen=new Set<string>(),sections:ServiceSection[]=[],features:{title:string;copy:string}[]=[];let overview='',legacyCount=0,legacyPlan=false;
 for(const [index,group] of groups.entries()){
  const full=normalize(group.nodes.map(n=>textContent(n)).join(' '));
  if(legacyPlan&&/^(?:includes|plan includes|benefits|what.?s included)[:.! ]*$/i.test(group.title)){legacyCount++;continue;}
  legacyPlan=/[$€£]\s*\d|pricing|packages|bronze|silver|gold|platinum|classic dedicated|performance dedicated/i.test(group.title);
  // Superseded plans, review quotations, imported payment/entry workflows
  // and tables are historical evidence, not a current commercial offer.
  const containsLegacyPlanHeadings=group.nodes.some(n=>heading(n)&&/^(?:bronze|silver|gold|platinum)(?:\s|$)/i.test(normalize(textContent(n))));
  if(archiveTopic.test(group.title)||/[$€£]\s*\d/.test(group.title)||containsLegacyPlanHeadings&&/[$€£]\s*\d/.test(full)||/“|”/.test(full)&&/software engineer|podcast user|graphic designer/i.test(full)){legacyCount++;continue;}
  const visible:Node[]=[];
  let narrativeNodes=group.nodes;
  if(/faq|questions/i.test(group.title)){
   const significant=group.nodes.filter(n=>normalize(textContent(n)).length>0);
   narrativeNodes=[];
   for(let i=0;i<significant.length;i++){
    const question=significant[i],answer=significant[i+1];
    const q=normalize(textContent(question)),a=answer?normalize(textContent(answer)):'';
    if(name(question)==='p'&&q.endsWith('?')&&answer&&name(answer)==='p'&&a.length>20&&!a.endsWith('?')){
     i++;
     // Reconstruct only explicit adjacent question/answer paragraphs. A
     // superseded answer quarantines its question too, never its replacement.
     if(riskyText.test(q+' '+a)||/confirmed reservation|instant booking|automatically.*confirm|immediate.*access/i.test(a))continue;
     const summary='children' in question?render(question.children):'';
     narrativeNodes.push(...parseDocument('<details><summary>'+summary+'</summary>'+render(answer)+'</details>').children);
    }else narrativeNodes.push(question);
   }
  }
  for(const n of narrativeNodes){
   const value=normalize(textContent(n)),tag=name(n),key=value.toLowerCase();
   if(!value||['img','figure','video','source','table'].includes(tag)||riskyText.test(value))continue;
   if(options.informational){
    // Imported counters, stock staff identities and obsolete contact details
    // remain in the exact source archive, never as current company facts.
    if(/^(?:0\s*\+?|[\d,.]+\s*\+?|sq\.?\s*ft\.? of flexible workspace|professionals? & businesses served|workspace & meeting solutions|integrated business ecosystem)$/i.test(value))continue;
    if(/Mariam Sanchez|Dorian Huxley|Head of Customer Solution|@[a-z0-9.-]+\.[a-z]{2,}|1[–-]2 business days|\b(?:hundreds|thousands)\b.*(?:professionals|members|businesses)/i.test(value))continue;
    if(tag==='a'&&'attribs' in n&&/^(?:mailto:|tel:)/i.test(n.attribs.href||''))continue;
    if(/^(?:\+?1[ .()-]*)?(?:\(?\d{3}\)?[ .()-]*){2}\d{4}$/.test(value))continue;
    if(/customer solution|service quotes|send us a message|our team|meet.*team/i.test(group.title)&&value.length<90)continue;
   }
   if(tag==='a'&&/^(start now|schedule|book|learn more|read post|view|about detail|details)/i.test(value))continue;
   if(seen.has(key))continue;
   seen.add(key);
   // Remove source IDs only from extracted copies to prevent duplicate IDs.
   const clone=parseDocument(render(n));
   const clean=(items:Node[])=>{for(const item of items){if('attribs' in item)delete item.attribs.id;if('children' in item)clean(item.children)}};
   clean(clone.children);visible.push(...clone.children);
  }
  if(!visible.some(n=>!heading(n)&&normalize(textContent(n)).length>35))continue;
  // Feature cards use exact adjacent source heading/paragraph pairs.
  for(let i=0;i<visible.length-1;i++){
   const a=visible[i],b=visible[i+1],title=normalize(textContent(a)),copy=normalize(textContent(b));
   if(/^h[3-6]$/.test(name(a))&&name(b)==='p'&&title.length>=10&&title.length<70&&title.split(' ').length<=8&&!/questions?|ways to|how to|work.*home|pricing|membership overview|bronze|silver|gold|platinum/i.test(title)&&copy.length>=45&&copy.length<300&&features.length<6)features.push({title,copy});
  }
  const html=render(visible);
  if(!overview&&visible.some(n=>name(n)==='p')&&index<3){overview=html;continue;}
  sections.push({title:group.title,html,key:'topic-'+index});
 }
 return {overview,sections,features,legacyCount};
}
