import {type CatalogPlan, type ServiceDetail} from './catalog';

/** Match only known legacy record IDs. Never guess from a partial package title. */
const aliases: Record<string, string> = {
  'csb-llc-basic-package': 'llc-basic-package',
  'csb-llc-professional-package': 'llc-professional-package',
  'csb-llc-premium-package': 'llc-premium-package',
  'csb-business-address-business-address': 'business-address-monthly',
  'csb-virtual-office-virtual-office': 'virtual-office-standard',
  'csb-virtual-office-virtual-office-plus': 'virtual-office-plus',
};
const groups = { 'llc-setup': true, 'business-address': true, 'virtual-office': true };
export function usesCheckoutPricing(service: string) { return Object.hasOwn(groups, service); }
export function publicCheckoutPrice<T extends {slug?: string; metadata?: {price?: string|number; amount?: number; currency?: string; billingPeriod?: string; service?: string}}>(row: T, detail?: ServiceDetail | null): T | null {
  const m = row.metadata;
  if (!m?.service || !usesCheckoutPricing(m.service)) return row;
  const key = row.slug?.replace(/^approved-(llc-setup|business-address|virtual-office)-/, '') || '';
  const plan: CatalogPlan | undefined = detail?.plans.find(p => p.slug === (aliases[key] || key));
  if (detail?.slug !== m.service || !plan || plan.unitAmountCents <= 0) return null;
  const billingPeriod = m.service === 'llc-setup' ? 'plus state filing fee' : plan.unitLabel.replace(/^per\s+/i, '');
  return {...row, metadata: {...m, price: plan.unitAmountCents / 100, amount: undefined, currency: plan.currency.toUpperCase(), billingPeriod}};
}
