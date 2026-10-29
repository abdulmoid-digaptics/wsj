import {publicItems} from '@/lib/site';
import {PricingGrid,type PublicPlan} from './pricing-grid';
export async function Pricing({service,eyebrow='PLANS & PRICING',title='A plan that works for you.',intro='Explore published packages, then talk to our team about the right fit. Availability is confirmed personally.'}:{service?:string;eyebrow?:string;title?:string;intro?:string}) {
 const serviceKey=service?({'mail-box':'virtual-mailbox','membership-plans':'memberships','monthly_memberships':'memberships'} as Record<string,string>)[service]||service:undefined;
 const data=await publicItems('pricing');
 let plans=(data||[]) as unknown as PublicPlan[];
 if(serviceKey)plans=plans.filter(p=>p.metadata?.service===serviceKey||(!p.metadata?.service&&JSON.stringify(p).toLowerCase().includes(serviceKey.toLowerCase())));
 plans=plans.filter(p=>!p.metadata?.requiresReview&&p.metadata?.enabled!==false&&(p.metadata?.price!==undefined||p.metadata?.amount!==undefined));
 if(!plans.length)return null;
 plans=plans.map(p=>{const m=p.metadata||{};return {id:p.id,title:p.title,excerpt:p.excerpt,metadata:{price:m.price,amount:m.amount,currency:m.currency,billingPeriod:m.billingPeriod,features:m.features,featured:m.featured,ctaUrl:m.ctaUrl,ctaLabel:m.ctaLabel,offer:m.offer,service:m.service}}});
 return <section className="section pricing-section container" id="pricing"><div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><p>{intro}</p></div><PricingGrid plans={plans}/></section>;
}
