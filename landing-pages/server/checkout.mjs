/** Builds the Stripe Checkout Session request for a validated order. Pure: no I/O. */
import { CURRENCY } from './catalog.mjs';

export const HOLD_MINUTES = 35; // Stripe requires >= 30 minutes; promo holds last the same time.

const money = c => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

export function buildSessionParams({ plan, quantity, name, email, phone, notes, preferredDate }, { orderId, publicUrl, now = Date.now() }) {
  const meta = {
    orderId, planId: plan.id, offer: plan.offer, quantity: String(quantity), source: 'landing-pages',
    customerName: name, phone: phone || '-', preferredDate: preferredDate || '-', notes: notes || '-',
    ...(plan.commitmentMonths ? { commitmentMonths: String(plan.commitmentMonths) } : {})
  };
  const https = publicUrl.startsWith('https://');
  const lineItem = {
    quantity,
    price_data: {
      currency: CURRENCY,
      unit_amount: plan.unitAmount,
      product_data: {
        name: plan.name,
        description: plan.description.slice(0, 300),
        /* Stripe fetches product images itself, so only send them from a public https origin. */
        ...(https ? { images: [`${publicUrl}/assets/img/${plan.image}`] } : {})
      },
      ...(plan.mode === 'subscription' ? { recurring: { interval: plan.interval, interval_count: 1 } } : {})
    }
  };
  const submitMessage = plan.mode === 'subscription'
    ? `You are starting a ${plan.commitmentMonths}-month commitment at ${money(plan.unitAmount)}/${plan.interval}, billed monthly. Our team will contact you to finish setup.`
    : 'After payment, our team will contact you to confirm your dates and times, subject to availability.';

  return {
    mode: plan.mode,
    ui_mode: 'embedded_page',
    return_url: `${publicUrl}/checkout-complete.html?session_id={CHECKOUT_SESSION_ID}`,
    client_reference_id: orderId,
    customer_email: email,
    line_items: [lineItem],
    metadata: meta,
    allow_promotion_codes: true,
    /* Charge exactly the USD price advertised on the page (no automatic local-currency conversion). */
    adaptive_pricing: { enabled: false },
    billing_address_collection: 'auto',
    phone_number_collection: { enabled: true },
    expires_at: Math.floor(now / 1000) + HOLD_MINUTES * 60,
    custom_text: { submit: { message: submitMessage } },
    ...(plan.mode === 'subscription'
      ? { subscription_data: { metadata: meta, description: `${plan.name} - ${plan.commitmentMonths}-month commitment` } }
      : {
          payment_intent_data: { metadata: meta, description: `${plan.name} x${quantity}` },
          invoice_creation: { enabled: true, invoice_data: { metadata: { orderId } } }
        })
  };
}
