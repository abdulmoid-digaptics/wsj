/* Confirmation page: shows the real outcome of a Stripe Checkout Session. */
(function () {
  'use strict';
  var card = document.getElementById('status');
  if (!card) return;
  var q = function (s) { return card.querySelector(s); };
  var sessionId = new URLSearchParams(location.search).get('session_id') || '';
  var api = (function () {
    var s = document.querySelector('script[src*="checkout-complete.js"]');
    try { return new URL('../../api/', s.src).href; } catch (e) { return 'api/'; }
  })();

  function money(cents, currency) {
    if (typeof cents !== 'number') return '-';
    return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 });
  }
  function render(state, title, message, icon) {
    card.setAttribute('data-state', state);
    q('[data-title]').textContent = title;
    q('[data-message]').textContent = message;
    q('[data-icon]').innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-' + icon + '"/></svg>';
    document.title = title + ' | Workspace Junction';
  }
  function details(d) {
    q('[data-details]').hidden = false;
    q('[data-plan]').textContent = (d.planName || 'Workspace Junction offer') + (d.quantity > 1 ? ' x ' + d.quantity : '');
    q('[data-amount]').textContent = money(d.amountTotal, d.currency) + (d.mode === 'subscription' ? ' today, then billed monthly' : '');
    q('[data-email]').textContent = d.email || '-';
    q('[data-order]').textContent = d.orderId || '-';
    if (d.page) { var back = q('[data-back-link]'); back.href = d.page; back.textContent = 'Back to the offer'; }
  }

  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    render('error', 'No payment found', 'This link is missing its payment reference. If you were charged, call us at (773) 986-1908 and we will sort it out.', 'info');
    return;
  }

  var tries = 0;
  function check() {
    tries++;
    fetch(api + 'checkout/status?session_id=' + encodeURIComponent(sessionId), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'status'); return j; }); })
      .then(function (d) {
        if (d.status === 'complete' && (d.paymentStatus === 'paid' || d.paymentStatus === 'no_payment_required')) {
          render('paid', 'Payment confirmed. Thank you!', 'Your ' + (d.mode === 'subscription' ? 'membership is active' : 'package is reserved') + '. Our team will contact you within one business day to confirm the details.', 'check');
          details(d);
          q('[data-next]').hidden = false;
          return;
        }
        if (d.status === 'complete') {
          render('processing', 'Payment processing', 'Your payment was submitted and is still being confirmed by your bank. Our team will contact you as soon as it clears.', 'clock');
          details(d);
          if (tries < 8) setTimeout(check, 2500);
          return;
        }
        if (d.status === 'expired') {
          render('error', 'This checkout expired', 'No payment was taken. You can start again from the offer page.', 'info');
          if (d.page) { var b = q('[data-back-link]'); b.href = d.page; b.textContent = 'Try again'; }
          return;
        }
        render('error', 'Payment not completed', 'No payment was taken. You can go back and try again, or call us for help.', 'info');
        if (d.page) { var bb = q('[data-back-link]'); bb.href = d.page; bb.textContent = 'Try again'; }
      })
      .catch(function () {
        if (tries < 4) { setTimeout(check, 2000); return; }
        render('error', 'We could not check your payment', 'If you completed payment, our team will confirm it with you shortly. Call (773) 986-1908 with any questions.', 'info');
      });
  }
  check();
})();
