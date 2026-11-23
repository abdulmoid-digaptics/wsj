<?php
/**
 * Workspace Junction "thanks-giving" landing pages: PHP port of the Node checkout server
 * for cPanel / LiteSpeed shared hosting. Same API contract as landing-pages/server.
 * This folder is blocked from the web by .htaccess.
 */
declare(strict_types=1);

const WJ_STRIPE_VERSION = '2026-10-28.endive';
const WJ_HOLD_MINUTES = 35;
const WJ_ADDRESS = '1S280 Summit Ave Unit E2, Suite 1, Oakbrook Terrace, IL 60181';
const WJ_PHONE = '(773) 986-1908';

/* ---------------- Catalog (server prices in cents; the browser never sends a price) ---------------- */
function wj_plans(): array {
  return [
    'podcast-starter' => ['offer'=>'podcast','offerName'=>'Podcast Studio Thanksgiving Special','name'=>'Podcast Studio - Starter','description'=>'Professional studio setup, high-quality audio & video. Thanksgiving rate, 3-hour minimum.','unitAmount'=>12000,'mode'=>'payment','unitLabel'=>'hour','min'=>3,'max'=>12,'default'=>3,'image'=>'podcast-hero.webp','page'=>'podcast-studio'],
    'podcast-standard' => ['offer'=>'podcast','offerName'=>'Podcast Studio Thanksgiving Special','name'=>'Podcast Studio - Standard','description'=>'Studio setup, high-quality audio & video, raw recording files. Thanksgiving rate, 3-hour minimum.','unitAmount'=>15000,'mode'=>'payment','unitLabel'=>'hour','min'=>3,'max'=>12,'default'=>3,'image'=>'podcast-hero.webp','page'=>'podcast-studio'],
    'podcast-premium' => ['offer'=>'podcast','offerName'=>'Podcast Studio Thanksgiving Special','name'=>'Podcast Studio - Premium','description'=>'Studio setup, audio & video, raw files, editing options, content batching. Thanksgiving rate, 3-hour minimum.','unitAmount'=>19900,'mode'=>'payment','unitLabel'=>'hour','min'=>3,'max'=>12,'default'=>3,'image'=>'podcast-hero.webp','page'=>'podcast-studio'],
    'conference-5h' => ['offer'=>'conference','offerName'=>'Conference Room Thanksgiving Special','name'=>'Conference Room - 5-Hour Package','description'=>'5 prepaid conference room hours at $25/hour. Use across multiple meetings, subject to available slots.','unitAmount'=>12500,'mode'=>'payment','unitLabel'=>'package','min'=>1,'max'=>4,'default'=>1,'image'=>'conference-hero.webp','page'=>'conference-room'],
    'boardroom-5h' => ['offer'=>'boardroom','offerName'=>'Thanksgiving Boardroom Special','name'=>'Boardroom - 5-Hour Package','description'=>'5 prepaid boardroom hours at $50/hour (regular $70). Schedule 1-, 2-, or 3-hour meetings later.','unitAmount'=>25000,'mode'=>'payment','unitLabel'=>'package','min'=>1,'max'=>4,'default'=>1,'image'=>'boardroom-video-call.webp','page'=>'boardroom'],
    'dedicated-desk' => ['offer'=>'desk','offerName'=>'Black Friday Dedicated Desk Offer','name'=>'Dedicated Desk - Black Friday Rate','description'=>'Reserved workstation, 24/7 access, business WiFi, meeting room credits. 12-month membership.','unitAmount'=>25000,'mode'=>'subscription','interval'=>'month','unitLabel'=>'month','min'=>1,'max'=>1,'default'=>1,'commitment'=>12,'promoKey'=>'desk','image'=>'desk-hero.webp','page'=>'dedicated-desk'],
    'mailbox' => ['offer'=>'mailbox','offerName'=>'Black Friday Mailbox Offer','name'=>'Business Mailbox - Black Friday Rate','description'=>'Real street address, secure mail & package handling. 12-month contract.','unitAmount'=>2500,'mode'=>'subscription','interval'=>'month','unitLabel'=>'month','min'=>1,'max'=>1,'default'=>1,'commitment'=>12,'promoKey'=>'mailbox','image'=>'mailbox-hero.webp','page'=>'mailbox'],
  ];
}
function wj_plan(?string $id): ?array { $p = wj_plans(); return ($id !== null && isset($p[$id])) ? ['id'=>$id] + $p[$id] : null; }

function wj_public_catalog(): array {
  $out = [];
  foreach (wj_plans() as $id => $p) {
    $out[] = ['id'=>$id,'offer'=>$p['offer'],'name'=>$p['name'],'unitAmount'=>$p['unitAmount'],'currency'=>'usd','mode'=>$p['mode'],
      'interval'=>$p['interval'] ?? null,'unitLabel'=>$p['unitLabel'],'minQuantity'=>$p['min'],'maxQuantity'=>$p['max'],
      'defaultQuantity'=>$p['default'],'commitmentMonths'=>$p['commitment'] ?? null];
  }
  return $out;
}

function wj_clean(mixed $v, int $max): string {
  if (!is_string($v)) return '';
  $v = preg_replace('/[\x00-\x1F\x7F]/u', ' ', $v) ?? '';
  return mb_substr(trim($v), 0, $max);
}

function wj_validate_checkout(mixed $b): array {
  if (!is_array($b)) return ['error'=>'Invalid request.'];
  $plan = wj_plan(is_string($b['planId'] ?? null) ? $b['planId'] : null);
  if (!$plan) return ['error'=>'Please choose a valid package.'];
  $q = array_key_exists('quantity', $b) ? $b['quantity'] : $plan['default'];
  if (!is_int($q) || $q < $plan['min'] || $q > $plan['max']) {
    return ['error'=> $plan['unitLabel'] === 'hour' ? "Please choose between {$plan['min']} and {$plan['max']} hours." : "Please choose a quantity between {$plan['min']} and {$plan['max']}."];
  }
  $name = wj_clean($b['name'] ?? '', 120);
  $email = strtolower(wj_clean($b['email'] ?? '', 200));
  $phone = wj_clean($b['phone'] ?? '', 40);
  $notes = wj_clean($b['notes'] ?? '', 450);
  $date = wj_clean($b['preferredDate'] ?? '', 10);
  if (mb_strlen($name) < 2) return ['error'=>'Please enter your full name.'];
  if (!preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/', $email)) return ['error'=>'Please enter a valid email address.'];
  if ($phone !== '' && !preg_match('/^[0-9+().\-\s]{7,40}$/', $phone)) return ['error'=>'Please enter a valid phone number.'];
  if ($date !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) return ['error'=>'Please enter a valid date.'];
  if (!empty($plan['commitment']) && ($b['acceptTerms'] ?? null) !== true) return ['error'=>"Please confirm the {$plan['commitment']}-month commitment."];
  return ['value'=>compact('plan','name','email','phone','notes','date') + ['quantity'=>$q]];
}

function wj_money(int $c): string { return '$' . ($c % 100 ? number_format($c / 100, 2) : number_format($c / 100, 0)); }

function wj_session_params(array $v, string $orderId, string $publicUrl): array {
  $plan = $v['plan'];
  $meta = ['orderId'=>$orderId,'planId'=>$plan['id'],'offer'=>$plan['offer'],'quantity'=>(string)$v['quantity'],'source'=>'landing-pages',
    'customerName'=>$v['name'],'phone'=>$v['phone'] ?: '-','preferredDate'=>$v['date'] ?: '-','notes'=>$v['notes'] ?: '-'];
  if (!empty($plan['commitment'])) $meta['commitmentMonths'] = (string)$plan['commitment'];
  $price = ['currency'=>'usd','unit_amount'=>$plan['unitAmount'],
    'product_data'=>['name'=>$plan['name'],'description'=>mb_substr($plan['description'],0,300),'images'=>[$publicUrl.'/assets/img/'.$plan['image']]]];
  if ($plan['mode'] === 'subscription') $price['recurring'] = ['interval'=>$plan['interval'],'interval_count'=>1];
  $submit = $plan['mode'] === 'subscription'
    ? "You are starting a {$plan['commitment']}-month commitment at ".wj_money($plan['unitAmount'])."/{$plan['interval']}, billed monthly. Our team will contact you to finish setup."
    : 'After payment, our team will contact you to confirm your dates and times, subject to availability.';
  $p = ['mode'=>$plan['mode'],'ui_mode'=>'embedded_page',
    'return_url'=>$publicUrl.'/checkout-complete?session_id={CHECKOUT_SESSION_ID}',
    'client_reference_id'=>$orderId,'customer_email'=>$v['email'],
    'line_items'=>[['quantity'=>$v['quantity'],'price_data'=>$price]],
    'metadata'=>$meta,'allow_promotion_codes'=>'true','adaptive_pricing'=>['enabled'=>'false'],
    'billing_address_collection'=>'auto','phone_number_collection'=>['enabled'=>'true'],
    'expires_at'=>time() + WJ_HOLD_MINUTES * 60,'custom_text'=>['submit'=>['message'=>$submit]]];
  if ($plan['mode'] === 'subscription') $p['subscription_data'] = ['metadata'=>$meta,'description'=>"{$plan['name']} - {$plan['commitment']}-month commitment"];
  else { $p['payment_intent_data'] = ['metadata'=>$meta,'description'=>"{$plan['name']} x{$v['quantity']}"]; $p['invoice_creation'] = ['enabled'=>'true','invoice_data'=>['metadata'=>['orderId'=>$orderId]]]; }
  return $p;
}

/* ---------------- Stripe REST ---------------- */
function wj_stripe(string $method, string $path, ?array $params, string $sk, ?string $idem = null): array {
  $url = 'https://api.stripe.com/v1' . $path;
  $body = $params ? http_build_query($params, '', '&', PHP_QUERY_RFC3986) : null;
  if ($method === 'GET' && $body) { $url .= '?' . $body; $body = null; }
  $headers = ['Authorization: Bearer '.$sk, 'Stripe-Version: '.WJ_STRIPE_VERSION, 'Content-Type: application/x-www-form-urlencoded'];
  if ($idem) $headers[] = 'Idempotency-Key: '.$idem;
  for ($i = 0; $i <= 2; $i++) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_CUSTOMREQUEST=>$method, CURLOPT_HTTPHEADER=>$headers, CURLOPT_TIMEOUT=>20, CURLOPT_CONNECTTIMEOUT=>8]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $raw = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch);
    $json = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
    if ($code >= 200 && $code < 300) return $json;
    $retry = ($raw === false || $code === 429 || $code >= 500) && $i < 2;
    if ($retry) { usleep((int)(400000 * (2 ** $i))); continue; }
    $e = $json['error'] ?? [];
    throw new RuntimeException(($e['type'] ?? 'api_error') . ': ' . ($e['message'] ?? ($err ?: "HTTP $code")), $code ?: 502);
  }
  throw new RuntimeException('api_connection_error', 502);
}

function wj_verify_webhook(string $payload, string $header, string $secret, int $tolerance = 300): array {
  if ($secret === '') throw new RuntimeException('Webhook secret not configured');
  if ($header === '') throw new RuntimeException('Missing Stripe-Signature header');
  $t = null; $sigs = [];
  foreach (explode(',', $header) as $part) {
    [$k, $v] = array_pad(explode('=', trim($part), 2), 2, '');
    if ($k === 't') $t = (int)$v; elseif ($k === 'v1' && $v !== '') $sigs[] = $v;
  }
  if (!$t || !$sigs) throw new RuntimeException('Malformed Stripe-Signature header');
  if (abs(time() - $t) > $tolerance) throw new RuntimeException('Webhook timestamp outside tolerance');
  $expected = hash_hmac('sha256', $t . '.' . $payload, $secret);
  foreach ($sigs as $s) if (hash_equals($expected, $s)) return json_decode($payload, true) ?: [];
  throw new RuntimeException('Webhook signature mismatch');
}

/* ---------------- Order log (append-only JSONL) + promo holds ---------------- */
function wj_data_dir(): string { $d = __DIR__ . '/data'; if (!is_dir($d)) @mkdir($d, 0700, true); return $d; }
function wj_append(array $rec): void {
  $rec['at'] = gmdate('c');
  file_put_contents(wj_data_dir() . '/orders.jsonl', json_encode($rec, JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
}
function wj_orders(): array {
  static $cache = null;
  $f = wj_data_dir() . '/orders.jsonl';
  $orders = []; $events = [];
  if (is_file($f)) {
    foreach (file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
      $r = json_decode($line, true); if (!is_array($r)) continue;
      if (!empty($r['eventId'])) $events[$r['eventId']] = true;
      if (!empty($r['orderId'])) $orders[$r['orderId']] = array_replace_recursive($orders[$r['orderId']] ?? [], $r);
    }
  }
  return ['orders'=>$orders, 'events'=>$events];
}
function wj_order(string $id): ?array { return wj_orders()['orders'][$id] ?? null; }
function wj_order_by_session(string $sid): ?array { foreach (wj_orders()['orders'] as $o) if (($o['sessionId'] ?? '') === $sid) return $o; return null; }
function wj_paid_count(string $planId): int { $n = 0; foreach (wj_orders()['orders'] as $o) if (($o['planId'] ?? '') === $planId && ($o['status'] ?? '') === 'paid') $n++; return $n; }

function wj_holds(callable $fn) {
  $f = wj_data_dir() . '/holds.json';
  $h = fopen($f, 'c+'); flock($h, LOCK_EX);
  $data = json_decode((string)stream_get_contents($h), true) ?: [];
  $now = time(); foreach ($data as $k => $v) if (($v['exp'] ?? 0) <= $now) unset($data[$k]);
  $res = $fn($data);
  ftruncate($h, 0); rewind($h); fwrite($h, json_encode($data)); fflush($h); flock($h, LOCK_UN); fclose($h);
  return $res;
}
function wj_hold(string $orderId, string $planId): void { wj_holds(function (&$d) use ($orderId, $planId) { $d[$orderId] = ['plan'=>$planId, 'exp'=>time() + WJ_HOLD_MINUTES * 60]; }); }
function wj_release(string $orderId): void { wj_holds(function (&$d) use ($orderId) { unset($d[$orderId]); }); }
function wj_held_count(string $planId): int { return wj_holds(function (&$d) use ($planId) { $n = 0; foreach ($d as $v) if ($v['plan'] === $planId) $n++; return $n; }); }

function wj_promo(array $plan, array $cfg): ?array {
  if (empty($plan['promoKey'])) return null;
  $limit = (int)($cfg['promo'][$plan['promoKey']]['limit'] ?? 0);
  $base = (int)($cfg['promo'][$plan['promoKey']]['claimed_base'] ?? 0);
  $claimed = min($limit, $base + wj_paid_count($plan['id']));
  return ['limit'=>$limit, 'claimed'=>$claimed, 'remaining'=>max(0, $limit - $claimed - wj_held_count($plan['id']))];
}

function wj_rate_limited(string $key, int $max, int $window): bool {
  $dir = wj_data_dir() . '/rl'; if (!is_dir($dir)) @mkdir($dir, 0700, true);
  $f = $dir . '/' . sha1($key) . '.json';
  $h = fopen($f, 'c+'); flock($h, LOCK_EX);
  $d = json_decode((string)stream_get_contents($h), true) ?: [];
  $now = time();
  if (($d['reset'] ?? 0) <= $now) $d = ['n'=>0, 'reset'=>$now + $window];
  $d['n']++;
  ftruncate($h, 0); rewind($h); fwrite($h, json_encode($d)); fflush($h); flock($h, LOCK_UN); fclose($h);
  if (mt_rand(1, 200) === 1) foreach (glob($dir . '/*.json') ?: [] as $old) if (filemtime($old) < $now - 86400) @unlink($old);
  return $d['n'] > $max;
}

/* ---------------- Email (local MTA via mail(); hosting blocks outbound SMTP) ---------------- */
function wj_e(mixed $s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

function wj_mail(array $cfg, array $to, string $subject, string $text, string $html, ?string $replyTo = null, string $kind = 'mail'): bool {
  $intended = array_values(array_filter($to));
  if (!$intended) return false;
  $redirect = array_values(array_filter($cfg['mail']['redirect_to'] ?? []));
  $final = $redirect ?: $intended;
  if ($redirect && array_diff(array_map('strtolower', $intended), array_map('strtolower', $redirect))) $subject = '[TEST to ' . implode(', ', $intended) . '] ' . $subject;
  /* Preferred: HTTPS relay (Google Apps Script under the Gmail account the main app uses).
     This host blocks outbound SMTP and its own mail server is not authenticated for the domain. */
  $relay = $cfg['mail']['relay_url'] ?? '';
  if ($relay !== '') {
    $payload = json_encode(['secret'=>$cfg['mail']['relay_secret'] ?? '', 'to'=>$final, 'subject'=>$subject, 'text'=>$text, 'html'=>$html,
      'replyTo'=>$replyTo ?: ($cfg['mail']['reply_to'] ?? '')]);
    for ($i = 0; $i < 2; $i++) {
      $ch = curl_init($relay);
      curl_setopt_array($ch, [CURLOPT_POST=>true, CURLOPT_POSTFIELDS=>$payload, CURLOPT_HTTPHEADER=>['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER=>true, CURLOPT_FOLLOWLOCATION=>true, CURLOPT_POSTREDIR=>0, CURLOPT_TIMEOUT=>25, CURLOPT_CONNECTTIMEOUT=>8]);
      $raw = curl_exec($ch); curl_close($ch);
      $res = is_string($raw) ? json_decode($raw, true) : null;
      if (is_array($res) && !empty($res['ok'])) { wj_log('info', 'mail_sent', ['kind'=>$kind, 'via'=>'relay', 'redirected'=>(bool)$redirect, 'quota_left'=>$res['remaining'] ?? null]); return true; }
      wj_log('error', 'mail_relay_failed', ['kind'=>$kind, 'attempt'=>$i + 1, 'response'=>is_string($raw) ? mb_substr($raw, 0, 200) : 'no response']);
    }
  }
  $from = $cfg['mail']['from'];
  preg_match('/<([^>]+)>/', $from, $m); $fromAddr = $m[1] ?? $from;
  $b = 'wj_' . bin2hex(random_bytes(12));
  $headers = [
    'From: ' . $from, 'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="' . $b . '"',
    'Message-ID: <' . bin2hex(random_bytes(16)) . '@' . (explode('@', $fromAddr)[1] ?? 'localhost') . '>',
    'X-Mailer: WJ-Landing', 'Reply-To: ' . ($replyTo ?: ($cfg['mail']['reply_to'] ?? $fromAddr)),
  ];
  $body = "--$b\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text)) .
          "--$b\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html)) . "--$b--\r\n";
  $encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
  $ok = @mail(implode(', ', $final), $encSubject, $body, implode("\r\n", $headers), '-f' . $fromAddr);
  wj_log($ok ? 'info' : 'error', $ok ? 'mail_sent' : 'mail_failed', ['kind'=>$kind, 'via'=>'local_mta', 'redirected'=>(bool)$redirect]);
  return $ok;
}

function wj_log(string $level, string $msg, array $extra = []): void {
  error_log(json_encode(['t'=>gmdate('c'), 'level'=>$level, 'msg'=>$msg] + $extra) . "\n", 3, wj_data_dir() . '/app.log');
}

function wj_layout(string $title, string $intro, array $rows, string $extra = '', ?array $cta = null): string {
  $r = '';
  foreach ($rows as [$k, $v]) { if ($v === null || $v === '') continue;
    $r .= '<tr><td style="padding:8px 0;color:#4A5C52;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;width:38%;vertical-align:top">' . wj_e($k) . '</td><td style="padding:8px 0;color:#10271C;font-size:15px;font-weight:600;vertical-align:top">' . wj_e($v) . '</td></tr>'; }
  return '<!doctype html><html><body style="margin:0;background:#F7F4ED;font-family:Segoe UI,Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F4ED;padding:24px 12px"><tr><td align="center">'
    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFDF8;border-radius:20px;overflow:hidden">'
    . '<tr><td style="background:#0E3421;padding:22px 28px;color:#fff;font-size:20px;font-weight:800">WORKSPACE JUNCTION<div style="color:#D7902A;font-size:13px;font-weight:600;font-style:italic;margin-top:2px">Create · Collaborate · Grow</div></td></tr>'
    . '<tr><td style="padding:28px"><h1 style="margin:0 0 10px;color:#0E3421;font-size:24px;line-height:1.25">' . wj_e($title) . '</h1>'
    . ($intro ? '<p style="margin:0 0 18px;color:#4A5C52;font-size:15px;line-height:1.6">' . $intro . '</p>' : '')
    . ($r ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e6e2d8;border-bottom:1px solid #e6e2d8;margin:6px 0 18px">' . $r . '</table>' : '')
    . $extra . ($cta ? '<p style="margin:22px 0 0"><a href="' . wj_e($cta[1]) . '" style="display:inline-block;background:#D7902A;color:#06140D;text-decoration:none;font-weight:800;padding:13px 24px;border-radius:999px">' . wj_e($cta[0]) . '</a></p>' : '')
    . '</td></tr><tr><td style="background:#092317;padding:18px 28px;color:rgba(255,255,255,.75);font-size:13px;line-height:1.6">' . wj_e(WJ_ADDRESS) . '<br>' . wj_e(WJ_PHONE) . ' · grow@workspacejunction.com</td></tr></table></td></tr></table></body></html>';
}
function wj_text(string $title, array $rows, string $extra = ''): string {
  $l = [$title, ''];
  foreach ($rows as [$k, $v]) if ($v !== null && $v !== '') $l[] = "$k: $v";
  if ($extra) { $l[] = ''; $l[] = $extra; }
  $l[] = ''; $l[] = 'Workspace Junction · ' . WJ_ADDRESS . ' · ' . WJ_PHONE;
  return implode("\n", $l);
}
function wj_order_rows(array $o, ?array $plan): array {
  $qty = $o['quantity'] ?? null;
  $unit = $plan && $plan['unitLabel'] === 'hour' ? 'hours' : ($plan && $plan['mode'] === 'subscription' ? 'membership' : 'package(s)');
  $amount = isset($o['amountTotal']) ? wj_money((int)$o['amountTotal']) . (($plan['mode'] ?? '') === 'subscription' ? ' today, then monthly' : '') : (isset($o['amountExpected']) ? wj_money((int)$o['amountExpected']) : null);
  return [['Offer', $plan['offerName'] ?? ($o['offer'] ?? null)], ['Package', $plan['name'] ?? ($o['planId'] ?? null)], ['Quantity', $qty ? "$qty $unit" : null], ['Amount', $amount],
    ['Billing', $plan && $plan['mode'] === 'subscription' ? wj_money($plan['unitAmount']) . "/{$plan['interval']}, {$plan['commitment']}-month commitment" : 'One-time payment'],
    ['Customer', $o['customer']['name'] ?? null], ['Email', $o['customer']['email'] ?? ($o['customerEmail'] ?? null)], ['Phone', $o['customer']['phone'] ?? null],
    ['Preferred date', $o['preferredDate'] ?? null], ['Notes', $o['notes'] ?? null], ['Order ref', $o['orderId'] ?? null], ['Stripe session', $o['sessionId'] ?? null]];
}

function wj_mark_paid(array $cfg, string $orderId, array $fields, string $source): void {
  $o = wj_order($orderId); if (!$o) return;
  if (($o['status'] ?? '') !== 'paid' || !empty($fields['eventId'])) wj_append(['orderId'=>$orderId] + $fields + ['status'=>'paid', 'confirmedBy'=>$source]);
  wj_release($orderId);
  $o = wj_order($orderId);
  if (!empty($o['notifiedPaid'])) return;
  wj_append(['orderId'=>$orderId, 'notifiedPaid'=>true]);
  $plan = wj_plan($o['planId'] ?? null);
  $rows = array_merge(wj_order_rows($o, $plan), [['Confirmed by', $source === 'webhook' ? 'Stripe webhook' : 'Return page check']]);
  $t = 'New paid order: ' . ($plan['name'] ?? '');
  wj_mail($cfg, $cfg['mail']['notify'], '[Thanksgiving] PAID ' . wj_money((int)($o['amountTotal'] ?? 0)) . ' - ' . ($plan['name'] ?? '') . ' - ' . ($o['customer']['name'] ?? ''),
    wj_text($t, $rows, 'Next: contact the customer within one business day to confirm dates / start date.'),
    wj_layout($t, 'Payment received through the Thanksgiving landing pages. <strong>Next:</strong> contact the customer within one business day.', $rows, '', ['Open Stripe payments', 'https://dashboard.stripe.com/payments']), null, 'team_order_paid');
  $buyer = $o['customer']['email'] ?? ($o['customerEmail'] ?? '');
  /* Customer emails are off on the live site: the team contacts customers manually. */
  if ($buyer && !empty($cfg['mail']['customer_emails'])) {
    $first = explode(' ', (string)($o['customer']['name'] ?? 'there'))[0] ?: 'there';
    $next = ($plan['mode'] ?? '') === 'subscription' ? 'Our team will contact you within one business day to finish setup and agree your start date.' : 'Our team will contact you within one business day to schedule your time, subject to availability.';
    $crow = array_slice(wj_order_rows(array_diff_key($o, ['notes'=>1, 'sessionId'=>1]), $plan), 0, 5);
    wj_mail($cfg, [$buyer], 'Confirmed: ' . ($plan['name'] ?? 'your Workspace Junction order'), wj_text("Hi $first, your booking is confirmed.", $crow, "$next\nStripe sends your payment receipt separately."),
      wj_layout('Your booking is confirmed', 'Hi ' . wj_e($first) . ', thank you! ' . wj_e($next) . ' Stripe sends your payment receipt separately.', $crow, '<p style="margin:0;color:#4A5C52;font-size:14px">Find us at <strong>' . wj_e(WJ_ADDRESS) . '</strong>. Free on-site parking.</p>'), null, 'customer_order_paid');
  }
}

function wj_mark_closed(array $cfg, string $orderId, string $status, ?string $eventId): void {
  $o = wj_order($orderId);
  if (!$o || ($o['status'] ?? '') === 'paid') { if ($eventId) wj_append(['eventId'=>$eventId]); return; }
  wj_append(['eventId'=>$eventId, 'orderId'=>$orderId, 'status'=>$status]);
  wj_release($orderId);
  $o = wj_order($orderId);
  if (!empty($o['notifiedClosed'])) return;
  wj_append(['orderId'=>$orderId, 'notifiedClosed'=>true]);
  $plan = wj_plan($o['planId'] ?? null);
  $label = $status === 'failed' ? 'Payment failed' : 'Checkout expired (not paid)';
  $rows = wj_order_rows($o, $plan);
  wj_mail($cfg, $cfg['mail']['notify'], "[Thanksgiving] $label - " . ($o['customer']['name'] ?? ''), wj_text("$label: " . ($plan['name'] ?? ''), $rows, 'No money was taken. Consider a follow-up.'),
    wj_layout("$label: " . ($plan['name'] ?? ''), 'No money was taken. This customer showed intent, so a quick follow-up may win the booking.', $rows), null, 'team_order_' . $status);
}
