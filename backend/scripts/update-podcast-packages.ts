import {readFileSync, writeFileSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {PODCAST_FORMATS, PODCAST_HOURS, podcastPlanSlug} from '../../lib/podcast-packages';

const db = new PrismaClient();
const [, , mode, backupPath] = process.argv;
const plans = PODCAST_FORMATS.flatMap((format, index) => PODCAST_HOURS.map(hours => ({
  slug: podcastPlanSlug(format.key, hours), name: `${format.name} · ${hours} ${hours === 1 ? 'hour' : 'hours'}`,
  description: '', unitAmountCents: format.amounts[hours - 1] * 100, currency: 'usd', billingUnit: 'PER_BOOKING' as const,
  durationMinutes: hours * 60, durationDays: null, minQuantity: 1, maxQuantity: 1,
  capacityText: format.capacity, capacityMin: format.people === null ? null : 1, capacityMax: format.people,
  sortOrder: index * 3 + hours, active: true, archivedAt: null,
})));
const select = {slug:true, serviceId:true, name:true, description:true, unitAmountCents:true, currency:true, billingUnit:true,
  durationMinutes:true, durationDays:true, minQuantity:true, maxQuantity:true, capacityText:true, capacityMin:true,
  capacityMax:true, sortOrder:true, active:true, archivedAt:true} as const;
type Saved = Awaited<ReturnType<typeof savedPlans>>;
function savedPlans() {return db.catalogPlan.findMany({where:{slug:{in:plans.map(p => p.slug)}},select});}

async function main() {
  if (!backupPath || !['apply','rollback'].includes(mode)) throw new Error('Expected apply|rollback and a backup path');
  const service = await db.serviceCategory.findUniqueOrThrow({where:{slug:'podcast-studio'},select:{id:true,reservationPolicies:{where:{archivedAt:null},select:{id:true}}}});
  if (mode === 'apply') {
    const previous = await savedPlans();
    if (previous.some(p => p.serviceId !== service.id) || service.reservationPolicies.length) throw new Error('Unexpected catalog scope or active reservation policy');
    writeFileSync(backupPath, JSON.stringify(previous), {flag:'wx',mode:0o600});
    await db.$transaction(plans.map(({slug,...data}) => db.catalogPlan.upsert({where:{slug},create:{slug,serviceId:service.id,...data},update:data})));
  } else {
    const previous = JSON.parse(readFileSync(backupPath,'utf8')) as Saved;
    if (previous.some(p => p.serviceId !== service.id || !plans.some(plan => plan.slug === p.slug))) throw new Error('Unexpected backup scope');
    const created = plans.filter(p => !previous.some(old => old.slug === p.slug)).map(p => p.slug);
    await db.$transaction([db.catalogPlan.updateMany({where:{serviceId:service.id,slug:{in:created}},data:{active:false}}),
      ...previous.map(({serviceId,slug,...data}) => db.catalogPlan.update({where:{slug},data}))]);
  }
  console.log(`Podcast catalog ${mode} complete`);
}
main().catch(error => {console.error(error instanceof Error ? error.message.split('\n')[0] : 'Catalog update failed');process.exitCode=1;}).finally(() => db.$disconnect());
