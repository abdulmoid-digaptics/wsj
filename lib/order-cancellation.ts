export type CancellationOrder = {
  status?: string; mode?: string; paymentMethod?: string; paidAt?: string | null;
  recurringAmount?: number; dueNowAmount?: number;
  items?: Array<{billingType?: string}>; subscriptionIds?: string[];
};

/** A preliminary UI check only. The server verifies checkout, charge and refund state. */
export function orderCancellationEligibility(order: CancellationOrder, now = Date.now()): {allowed: boolean; reason?: string} {
  if (order.status !== 'PENDING' && order.status !== 'PAID') return {allowed: false};
  if (order.paymentMethod !== 'STRIPE') return {allowed: false, reason: 'This payment cannot be cancelled automatically. Contact support for help.'};
  if (order.status === 'PENDING') return {allowed: true};
  if (order.mode !== 'PAYMENT' || typeof order.recurringAmount !== 'number' || order.recurringAmount > 0 || !Array.isArray(order.items) || order.items.some(item => item.billingType === 'RECURRING') || !Array.isArray(order.subscriptionIds) || order.subscriptionIds.length > 0) return {allowed: false, reason: 'Recurring purchases require support to cancel the subscription and review any refund.'};
  if (typeof order.dueNowAmount !== 'number' || order.dueNowAmount <= 0) return {allowed: false, reason: 'This payment cannot be refunded automatically. Contact support for help.'};
  const paid = order.paidAt ? Date.parse(order.paidAt) : NaN;
  if (!Number.isFinite(paid) || paid > now || now - paid > 5 * 24 * 60 * 60 * 1000) return {allowed: false, reason: 'The five-day refund period has passed or the payment date cannot be verified. Contact support for help.'};
  return {allowed: true};
}
