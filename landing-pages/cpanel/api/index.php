<?php
/**
 * /thanks-giving/api/*  router (cPanel / LiteSpeed). Same endpoints as the Node server:
 *   GET  health | GET config | POST checkout | GET checkout/status | POST webhooks/stripe | POST enquiry
 */
declare(strict_types=1);
require __DIR__ . '/../private/lib.php';
$cfg = require __DIR__ . '/../private/config.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Cache-Control: no-store');

function out(int $code, array $body): never {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($body, JSON_UNESCAPED_SLASHES);
  if (function_exists('litespeed_finish_request')) litespeed_finish_request();
  elseif (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
  exit;
}
function client_ip(): string { return $_SERVER['REMOTE_ADDR'] ?? 'unknown'; }
function origin_ok(array $cfg): bool {
  $o = $_SERVER['HTTP_ORIGIN'] ?? '';
  return $o !== '' && in_array($o, $cfg['allowed_origins'], true);
}
function json_body(int $limit = 16384): mixed {
  if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') === false) out(415, ['error'=>'Expected JSON.']);
  $raw = file_get_contents('php://input', false, null, 0, $limit + 1);
  if ($raw === false || strlen($raw) > $limit) out(413, ['error'=>'Request too large.']);
  $d = json_decode($raw, true);
  if (!is_array($d)) out(400, ['error'=>'Invalid request.']);
  return $d;
}

$route = trim((string)($_GET['route'] ?? ''), '/');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$sk = $cfg['stripe']['secret_key']; $pk = $cfg['stripe']['publishable_key']; $whsec = $cfg['stripe']['webhook_secret'];
$mode = str_contains($sk, '_live_') ? 'live' : (str_contains($sk, '_test_') ? 'test' : 'unset');

try {
  if ($route === 'health' && $method === 'GET') {
    out(200, ['ok'=>true, 'stripe'=>$sk !== '' && $pk !== '', 'mode'=>$mode, 'webhook'=>$whsec !== '', 'mail'=>true, 'runtime'=>'php']);
  }

  if ($route === 'config' && $method === 'GET') {
    $promos = [];
    foreach (wj_plans() as $id => $_) { $p = wj_plan($id); $s = wj_promo($p, $cfg); if ($s) $promos[$id] = $s; }
    out(200, ['publishableKey'=>$pk ?: null, 'paymentsEnabled'=>$sk !== '' && $pk !== '', 'enquiriesEnabled'=>true, 'customerEmails'=>!empty($cfg['mail']['customer_emails']), 'catalog'=>wj_public_catalog(), 'promos'=>$promos]);
  }

  if ($route === 'checkout' && $method === 'POST') {
    if (!origin_ok($cfg)) out(403, ['error'=>'Origin not allowed.']);
    if (wj_rate_limited('co:' . client_ip(), 10, 600)) out(429, ['error'=>'Too many attempts. Please wait a few minutes and try again.']);
    if ($sk === '' || $pk === '') out(503, ['error'=>'Online payments are not available right now. Please call (773) 986-1908.']);
    $v = wj_validate_checkout(json_body());
    if (isset($v['error'])) out(400, ['error'=>$v['error']]);
    $v = $v['value']; $plan = $v['plan'];
    $promo = wj_promo($plan, $cfg);
    if ($promo && $promo['remaining'] <= 0) out(409, ['error'=>"All {$promo['limit']} promotional spots are currently taken. Call (773) 986-1908 to join the waitlist."]);
    $orderId = 'lp_' . bin2hex(random_bytes(16));
    try {
      $s = wj_stripe('POST', '/checkout/sessions', wj_session_params($v, $orderId, $cfg['public_url']), $sk, 'lp-checkout:' . $orderId);
    } catch (Throwable $e) {
      wj_log('error', 'checkout_session_failed', ['orderId'=>$orderId, 'plan'=>$plan['id'], 'error'=>$e->getMessage()]);
      out(502, ['error'=>'We could not start the secure payment form. Please try again or call (773) 986-1908.']);
    }
    if ($promo) wj_hold($orderId, $plan['id']);
    $order = ['orderId'=>$orderId, 'sessionId'=>$s['id'], 'planId'=>$plan['id'], 'offer'=>$plan['offer'], 'quantity'=>$v['quantity'], 'mode'=>$plan['mode'],
      'amountExpected'=>$plan['unitAmount'] * $v['quantity'], 'currency'=>'usd', 'status'=>'pending',
      'customer'=>['name'=>$v['name'], 'email'=>$v['email'], 'phone'=>$v['phone'] ?: null], 'preferredDate'=>$v['date'] ?: null, 'notes'=>$v['notes'] ?: null];
    wj_append($order);
    wj_log('info', 'checkout_session_created', ['orderId'=>$orderId, 'plan'=>$plan['id'], 'qty'=>$v['quantity']]);
    // Respond first, then notify the team (litespeed_finish_request flushes the response).
    http_response_code(200); header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['orderId'=>$orderId, 'clientSecret'=>$s['client_secret'], 'publishableKey'=>$pk]);
    if (function_exists('litespeed_finish_request')) litespeed_finish_request();
    $rows = wj_order_rows($order, $plan); $t = 'Checkout started: ' . $plan['name'];
    wj_mail($cfg, $cfg['mail']['notify'], "[Thanksgiving] $t - {$v['name']}", wj_text($t, $rows, 'Not paid yet. If no "paid" email follows, this is an abandoned checkout worth a follow-up call.'),
      wj_layout($t, 'Someone opened the secure payment form. <strong>Not paid yet.</strong> If no "paid" email follows, it is an abandoned checkout worth a follow-up.', $rows), null, 'team_checkout_started');
    exit;
  }

  if ($route === 'checkout/status' && $method === 'GET') {
    if (wj_rate_limited('st:' . client_ip(), 60, 60)) out(429, ['error'=>'Too many requests.']);
    $sid = (string)($_GET['session_id'] ?? '');
    if (!preg_match('/^cs_(test|live)_[A-Za-z0-9]{10,200}$/', $sid)) out(400, ['error'=>'Invalid session.']);
    try { $s = wj_stripe('GET', '/checkout/sessions/' . rawurlencode($sid), null, $sk); }
    catch (Throwable $e) { out($e->getCode() === 404 ? 404 : 502, ['error'=>$e->getCode() === 404 ? 'Session not found.' : 'Could not check payment status.']); }
    $order = wj_order_by_session($sid) ?? (!empty($s['client_reference_id']) ? wj_order($s['client_reference_id']) : null);
    $plan = wj_plan($s['metadata']['planId'] ?? null);
    $paid = ($s['status'] ?? '') === 'complete' && in_array($s['payment_status'] ?? '', ['paid', 'no_payment_required'], true);
    $email = $s['customer_details']['email'] ?? null;
    $resp = ['status'=>$s['status'] ?? null, 'paymentStatus'=>$s['payment_status'] ?? null, 'mode'=>$s['mode'] ?? null,
      'planName'=>$plan['name'] ?? null, 'offer'=>$plan['offer'] ?? null, 'page'=>$plan['page'] ?? null,
      'quantity'=>(int)($s['metadata']['quantity'] ?? 1), 'amountTotal'=>$s['amount_total'] ?? null, 'currency'=>$s['currency'] ?? 'usd',
      'email'=>$email ? preg_replace('/^(.)[^@]*(@.*)$/', '$1***$2', $email) : null, 'orderId'=>$s['client_reference_id'] ?? null];
    http_response_code(200); header('Content-Type: application/json; charset=utf-8'); echo json_encode($resp);
    if (function_exists('litespeed_finish_request')) litespeed_finish_request();
    if ($paid && $order && (($order['status'] ?? '') !== 'paid' || empty($order['notifiedPaid']))) {
      wj_mark_paid($cfg, $order['orderId'], ['amountTotal'=>$s['amount_total'] ?? null, 'currency'=>$s['currency'] ?? 'usd', 'paymentIntent'=>$s['payment_intent'] ?? null, 'subscription'=>$s['subscription'] ?? null], 'return_url');
    }
    exit;
  }

  if ($route === 'webhooks/stripe' && $method === 'POST') {
    $payload = (string)file_get_contents('php://input', false, null, 0, 1048576);
    try { $event = wj_verify_webhook($payload, (string)($_SERVER['HTTP_STRIPE_SIGNATURE'] ?? ''), $whsec); }
    catch (Throwable $e) { wj_log('error', 'webhook_rejected', ['reason'=>$e->getMessage()]); out(400, ['error'=>'Invalid signature']); }
    $state = wj_orders();
    if (isset($state['events'][$event['id'] ?? ''])) out(200, ['received'=>true, 'duplicate'=>true]);
    $s = $event['data']['object'] ?? [];
    $orderId = $s['client_reference_id'] ?? ($s['metadata']['orderId'] ?? '');
    $ours = ($s['metadata']['source'] ?? '') === 'landing-pages';
    $type = $event['type'] ?? '';
    if ($ours && $orderId) {
      if ($type === 'checkout.session.completed') {
        $m = $s['metadata'];
        if (!wj_order($orderId)) wj_append(['orderId'=>$orderId, 'planId'=>$m['planId'] ?? null, 'offer'=>$m['offer'] ?? null, 'status'=>'pending', 'quantity'=>(int)($m['quantity'] ?? 1),
          'customer'=>['name'=>$m['customerName'] ?? null, 'email'=>$s['customer_details']['email'] ?? null, 'phone'=>($m['phone'] ?? '-') !== '-' ? $m['phone'] : null],
          'preferredDate'=>($m['preferredDate'] ?? '-') !== '-' ? $m['preferredDate'] : null, 'notes'=>($m['notes'] ?? '-') !== '-' ? $m['notes'] : null]);
        $fields = ['eventId'=>$event['id'], 'sessionId'=>$s['id'] ?? null, 'amountTotal'=>$s['amount_total'] ?? null, 'currency'=>$s['currency'] ?? 'usd',
          'paymentIntent'=>$s['payment_intent'] ?? null, 'subscription'=>$s['subscription'] ?? null, 'customerEmail'=>$s['customer_details']['email'] ?? null];
        if (in_array($s['payment_status'] ?? '', ['paid', 'no_payment_required'], true)) wj_mark_paid($cfg, $orderId, $fields, 'webhook');
        else wj_append(['orderId'=>$orderId] + $fields + ['status'=>'processing']);
      } elseif ($type === 'checkout.session.async_payment_succeeded') {
        wj_mark_paid($cfg, $orderId, ['eventId'=>$event['id'], 'amountTotal'=>$s['amount_total'] ?? null], 'webhook');
      } elseif ($type === 'checkout.session.async_payment_failed') {
        wj_mark_closed($cfg, $orderId, 'failed', $event['id']);
      } elseif ($type === 'checkout.session.expired') {
        wj_mark_closed($cfg, $orderId, 'expired', $event['id']);
      }
    }
    out(200, ['received'=>true]);
  }

  if ($route === 'enquiry' && $method === 'POST') {
    if (!origin_ok($cfg)) out(403, ['error'=>'Origin not allowed.']);
    if (wj_rate_limited('eq:' . client_ip(), 6, 600)) out(429, ['error'=>'Too many messages. Please call (773) 986-1908.']);
    $b = json_body();
    if (wj_clean($b['website'] ?? '', 200) !== '') out(200, ['ok'=>true]); // honeypot
    $q = ['id'=>'eq_' . bin2hex(random_bytes(10)), 'type'=>($b['type'] ?? '') === 'tour' ? 'tour' : 'enquiry',
      'offer'=>wj_clean($b['offer'] ?? '', 120) ?: 'Landing pages', 'request'=>wj_clean($b['request'] ?? '', 120) ?: 'General question',
      'name'=>wj_clean($b['name'] ?? '', 120), 'email'=>strtolower(wj_clean($b['email'] ?? '', 200)), 'phone'=>wj_clean($b['phone'] ?? '', 40),
      'preferredDate'=>wj_clean($b['preferredDate'] ?? '', 10), 'notes'=>wj_clean($b['notes'] ?? '', 1500)];
    if (mb_strlen($q['name']) < 2) out(400, ['error'=>'Please enter your full name.']);
    if (!preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/', $q['email'])) out(400, ['error'=>'Please enter a valid email address.']);
    if ($q['phone'] !== '' && !preg_match('/^[0-9+().\-\s]{7,40}$/', $q['phone'])) out(400, ['error'=>'Please enter a valid phone number.']);
    if ($q['preferredDate'] !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $q['preferredDate'])) out(400, ['error'=>'Please enter a valid date.']);
    wj_append(['enquiryId'=>$q['id'], 'kind'=>'enquiry'] + $q);
    $title = $q['type'] === 'tour' ? 'New tour request' : 'New enquiry';
    $rows = [['Page', $q['offer']], ['Request', $q['request']], ['Name', $q['name']], ['Email', $q['email']], ['Phone', $q['phone']], ['Preferred date', $q['preferredDate']], ['Message', $q['notes']], ['Ref', $q['id']]];
    $ok = wj_mail($cfg, $cfg['mail']['notify'], "[Thanksgiving] $title: {$q['request']} - {$q['name']}", wj_text($title, $rows),
      wj_layout($title, 'Submitted from the Thanksgiving landing pages. Reply to this email to answer the customer directly.', $rows), $q['email'], 'team_enquiry');
    if (!$ok) out(502, ['error'=>'We could not send your message. Please call (773) 986-1908.']);
    http_response_code(200); header('Content-Type: application/json; charset=utf-8'); echo json_encode(['ok'=>true, 'id'=>$q['id']]);
    if (function_exists('litespeed_finish_request')) litespeed_finish_request();
    if (empty($cfg['mail']['customer_emails'])) exit; // team contacts the customer manually
    $first = explode(' ', $q['name'])[0] ?: 'there';
    $ack = $q['type'] === 'tour' ? 'We got your tour request' : 'We got your message';
    wj_mail($cfg, [$q['email']], "$ack - Workspace Junction", wj_text("Hi $first, " . strtolower($ack) . '.', [['Request', $q['request']], ['Preferred date', $q['preferredDate']]], 'Our team will get back to you within one business day.'),
      wj_layout($ack, 'Hi ' . wj_e($first) . ', thanks for reaching out. Our team will get back to you within one business day. Need us sooner? Call ' . wj_e(WJ_PHONE) . '.', [['Request', $q['request']], ['Preferred date', $q['preferredDate']]]), null, 'customer_enquiry_ack');
    exit;
  }

  if ($method === 'OPTIONS') out(204, []);
  out(404, ['error'=>'Not found']);
} catch (Throwable $e) {
  wj_log('error', 'unhandled', ['route'=>$route, 'error'=>$e->getMessage()]);
  out(500, ['error'=>'Something went wrong.']);
}
