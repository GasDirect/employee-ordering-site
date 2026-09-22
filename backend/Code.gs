/**
 * Google Apps Script backend for the Store Order Reference app.
 *
 * Deploy as a Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * The recipient is fixed server-side so the browser cannot redirect order emails.
 * No password, Gmail credential, API key, or private key belongs in the website.
 */

const RECIPIENT = 'lpgasbilling@gmail.com';
const TIME_ZONE = 'America/New_York';
const MAX_ITEMS = 150;
const MAX_QTY = 999;
const DUPLICATE_WINDOW_SECONDS = 600; // 10 minutes
const RATE_WINDOW_SECONDS = 3600; // 1 hour
const RATE_LIMIT_PER_CLIENT = 12;

function doGet() {
  return HtmlService.createHtmlOutput('Store Order backend is running.');
}

function doPost(e) {
  let requestId = '';
  try {
    const raw = e && e.parameter ? e.parameter.payload : '';
    if (!raw || raw.length > 120000) throw new Error('Invalid submission payload.');

    const payload = JSON.parse(raw);
    requestId = clean(payload.requestId, 100);
    validatePayload(payload);

    const cache = CacheService.getScriptCache();
    enforceRateLimit(cache, clean(payload.clientId, 120));

    const duplicateKey = 'dup:' + hashOrder(payload);
    if (cache.get(duplicateKey)) {
      return callback({ source: 'store-order-backend', ok: true, duplicate: true, requestId: requestId });
    }

    const mail = buildEmail(payload);
    MailApp.sendEmail({
      to: RECIPIENT,
      subject: mail.subject,
      body: mail.text,
      htmlBody: mail.html,
      name: 'Store Order Requests'
    });

    cache.put(duplicateKey, '1', DUPLICATE_WINDOW_SECONDS);
    return callback({ source: 'store-order-backend', ok: true, duplicate: false, requestId: requestId });
  } catch (error) {
    console.error(error);
    return callback({
      source: 'store-order-backend',
      ok: false,
      requestId: requestId,
      message: friendlyError(error)
    });
  }
}

function validatePayload(p) {
  if (!p || typeof p !== 'object') throw new Error('Invalid request.');
  if (clean(p.honeypot, 200)) throw new Error('Spam check failed.');

  const now = Date.now();
  const started = Number(p.startedAt || 0);
  if (started && now - started < 1500) throw new Error('Please wait a moment and try again.');
  if (started && now - started > 7 * 24 * 60 * 60 * 1000) throw new Error('This order draft is too old. Refresh the page and try again.');

  const store = clean(p.store, 100);
  const employee = clean(p.employeeName, 100);
  if (!store) throw new Error('Store location is required.');
  if (!employee) throw new Error('Employee name is required.');

  if (!Array.isArray(p.items) || p.items.length < 1 || p.items.length > MAX_ITEMS) throw new Error('Select at least one valid product.');
  p.items.forEach(item => {
    if (!clean(item.productName, 180)) throw new Error('A selected product is missing its name.');
    if (!['Sam\'s Club','Walmart'].includes(clean(item.retailer, 40))) throw new Error('Invalid retailer.');
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new Error('A product has an invalid quantity.');
    clean(item.note, 300);
  });
  clean(p.generalNotes, 1000);
}

function enforceRateLimit(cache, clientId) {
  if (!clientId) throw new Error('Client validation failed.');
  const key = 'rate:' + digest(clientId).slice(0, 24);
  const current = Number(cache.get(key) || 0);
  if (current >= RATE_LIMIT_PER_CLIENT) throw new Error('Too many requests were sent from this device. Please wait and try again later.');
  cache.put(key, String(current + 1), RATE_WINDOW_SECONDS);
}

function hashOrder(p) {
  const normalized = {
    store: clean(p.store, 100).toLowerCase(),
    employeeName: clean(p.employeeName, 100).toLowerCase(),
    generalNotes: clean(p.generalNotes, 1000),
    startedAt: Number(p.startedAt || 0),
    items: p.items.map(item => ({
      id: clean(item.id, 80),
      name: clean(item.productName, 180),
      quantity: Number(item.quantity),
      note: clean(item.note, 300)
    })).sort((a,b) => (a.id || a.name).localeCompare(b.id || b.name))
  };
  return digest(JSON.stringify(normalized));
}

function buildEmail(p) {
  const store = clean(p.store, 100);
  const employee = clean(p.employeeName, 100);
  const notes = clean(p.generalNotes, 1000);
  const submittedLocal = clean(p.submittedLocal, 100);
  const timeZone = clean(p.timeZone, 80);
  const received = Utilities.formatDate(new Date(), TIME_ZONE, 'MMM d, yyyy, h:mm a z');
  const dateForSubject = Utilities.formatDate(new Date(), TIME_ZONE, 'MMM d, yyyy');
  const subject = 'Order Request – ' + store + ' – ' + dateForSubject;

  const grouped = groupItems(p.items);
  const htmlSections = [];
  const textSections = [];

  Object.keys(grouped).forEach(retailer => {
    htmlSections.push('<h2 style="margin:24px 0 8px;font-size:20px;color:#17384c">' + esc(retailer) + '</h2>');
    textSections.push('\n' + retailer.toUpperCase());
    Object.keys(grouped[retailer]).forEach(category => {
      htmlSections.push('<h3 style="margin:16px 0 6px;font-size:14px;color:#0f7b68">' + esc(category) + '</h3>');
      htmlSections.push('<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">');
      textSections.push('\n  ' + category);
      grouped[retailer][category].forEach(item => {
        const name = clean(item.productName, 180);
        const pack = [clean(item.packCount, 80), clean(item.individualSize, 80)].filter(Boolean).join(' / ');
        const productNumber = clean(item.productNumber, 80);
        const note = clean(item.note, 300);
        htmlSections.push(
          '<tr>' +
          '<td style="padding:10px 8px 10px 0;border-top:1px solid #dde4e1;vertical-align:top">' +
          '<div style="font-weight:700;color:#17384c">' + esc(name) + '</div>' +
          (pack ? '<div style="font-size:12px;color:#61737f;margin-top:3px">' + esc(pack) + '</div>' : '') +
          (productNumber ? '<div style="font-size:12px;color:#81909a;margin-top:2px">Item # ' + esc(productNumber) + '</div>' : '') +
          (note ? '<div style="font-size:12px;color:#526777;margin-top:5px"><b>Note:</b> ' + esc(note) + '</div>' : '') +
          '</td>' +
          '<td style="padding:10px 0;border-top:1px solid #dde4e1;vertical-align:top;text-align:right;white-space:nowrap">' +
          '<span style="display:inline-block;background:#e7f3ef;color:#095d4f;border-radius:10px;padding:6px 9px;font-weight:800">Qty ' + Number(item.quantity) + '</span>' +
          '</td></tr>'
        );
        textSections.push('    - ' + name + (pack ? ' | ' + pack : '') + ' | Qty ' + Number(item.quantity) + (productNumber ? ' | Item # ' + productNumber : '') + (note ? ' | Note: ' + note : ''));
      });
      htmlSections.push('</table>');
    });
  });

  const html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;max-width:720px;margin:0 auto;color:#17384c">' +
    '<div style="background:#f7f4ee;border:1px solid #dde4e1;border-radius:18px;padding:18px">' +
    '<div style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#0f7b68">EMPLOYEE ORDER REQUEST</div>' +
    '<h1 style="font-size:25px;margin:6px 0 14px">' + esc(store) + '</h1>' +
    '<table role="presentation" style="font-size:13px;color:#526777"><tr><td style="padding:2px 16px 2px 0"><b>Employee</b></td><td>' + esc(employee) + '</td></tr>' +
    '<tr><td style="padding:2px 16px 2px 0"><b>Submitted</b></td><td>' + esc(submittedLocal || received) + (timeZone ? ' (' + esc(timeZone) + ')' : '') + '</td></tr>' +
    '<tr><td style="padding:2px 16px 2px 0"><b>Received</b></td><td>' + esc(received) + '</td></tr></table>' +
    (notes ? '<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:#fff"><b>General notes:</b><br>' + esc(notes).replace(/\n/g,'<br>') + '</div>' : '') +
    '</div>' + htmlSections.join('') +
    '<p style="margin-top:24px;font-size:11px;color:#81909a">This is an internal order request. It does not place an order with Sam\'s Club or Walmart.</p>' +
    '</div>';

  const text = 'ORDER REQUEST\nStore: ' + store + '\nEmployee: ' + employee + '\nSubmitted: ' + (submittedLocal || received) + (timeZone ? ' (' + timeZone + ')' : '') + '\nReceived: ' + received + (notes ? '\nGeneral notes: ' + notes : '') + '\n' + textSections.join('\n');

  return { subject: subject, html: html, text: text };
}

function groupItems(items) {
  const out = {};
  items.forEach(item => {
    const retailer = clean(item.retailer, 40);
    const category = clean(item.category, 80) || 'Other items';
    if (!out[retailer]) out[retailer] = {};
    if (!out[retailer][category]) out[retailer][category] = [];
    out[retailer][category].push(item);
  });
  return out;
}

function callback(data) {
  const safeJson = JSON.stringify(data).replace(/</g, '\\u003c');

  return HtmlService.createHtmlOutput(
    '<!doctype html>' +
    '<html><head><meta charset="utf-8"></head><body>' +
    '<script>' +
    '(function(){' +
    'var data=' + safeJson + ';' +
    'try { window.top.postMessage(data, "*"); } catch(e) {}' +
    'try { window.parent.postMessage(data, "*"); } catch(e) {}' +
    '})();' +
    '<\/script>' +
    '</body></html>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function clean(value, maxLen) {
  const s = String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (s.length > maxLen) throw new Error('A submitted field is too long.');
  return s;
}

function esc(value) {
  return String(value || '').replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

function digest(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return bytes.map(function(b) { const v = (b + 256) % 256; return ('0' + v.toString(16)).slice(-2); }).join('');
}

function friendlyError(error) {
  const msg = String(error && error.message ? error.message : 'Unknown error');
  if (/Service invoked too many times|quota/i.test(msg)) return 'Email sending is temporarily unavailable because the daily email limit was reached. Your selections are still saved; try again later.';
  if (/Authorization|permission/i.test(msg)) return 'The email backend needs authorization. Reopen the Apps Script project, authorize MailApp, and redeploy the web app.';
  return msg.slice(0, 240);
}
