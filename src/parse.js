// Reads bank messages and statement text. No screen code in here, so it can be tested on its own.
import { BANKS } from './i18n.js';

export function parseD(s) { if (!s) return null; var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }

export function toNum(s) {
  s = String(s).replace(/[^0-9.,]/g, '');
  var lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) { var dec = lc > ld ? ',' : '.'; var other = dec === ',' ? '.' : ','; s = s.split(other).join('').replace(dec, '.'); }
  else if (lc > -1) { if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, ''); else s = s.replace(',', '.'); }
  else if (ld > -1) { if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); }
  return parseFloat(s);
}
export function parseBankText(txt) {
  var r = {};
  var signed = txt.match(/([+\-\u2212\u2013])\s*([0-9][0-9.,]*)\s*(?:LAK|THB|USD|₭|฿|kip|ກີບ)/i);
  if (signed) {
    var sn = toNum(signed[2]);
    if (isFinite(sn)) { r.amount = sn; r.direction = signed[1] === '+' ? 'in' : 'out'; }
  } else {
    var m = txt.match(/(?:LAK|THB|USD|₭|฿|\$)\s*([0-9][0-9.,]*)/i) || txt.match(/([0-9][0-9.,]*)\s*(?:LAK|THB|USD|₭|฿|\$|kip|ກີບ)/i) ||
      txt.match(/([0-9]{1,3}(?:[,.][0-9]{3})+(?:[.,][0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/);
    if (m) { var n = toNum(m[1]); if (isFinite(n)) r.amount = n; }
  }
  if (!r.direction) {
    if (/LMPS\s*IN/i.test(txt)) r.direction = 'in';
    else if (/LMPS\s*OUT/i.test(txt)) r.direction = 'out';
    else {
      var isIn = /(received|credited|credit|deposit|incoming|ໄດ້ຮັບ|ເງິນເຂົ້າ|ໂອນເຂົ້າ)/i.test(txt);
      var isOut = /(paid|payment|debited|debit|withdraw|purchase|sent|transfer(?:red)? to|ຈ່າຍ|ຖອນ|ໂອນອອກ|ຊຳລະ)/i.test(txt);
      if (isIn && !isOut) r.direction = 'in'; else if (isOut && !isIn) r.direction = 'out';
    }
  }
  if (/meporm/i.test(txt)) r.bank = 'APB Meporm';
  else if (/onepay|bcel\s*one/i.test(txt)) r.bank = 'BCEL One';
  else if (/\bLDB\b/i.test(txt)) r.bank = 'LDB';
  else if (/(^|[^A-Za-z])APB/i.test(txt)) r.bank = 'APB Meporm';   // also matches "|APB|" and text-reader slips like "APBI"
  else if (/BCEL/i.test(txt)) r.bank = 'BCEL One';
  if (/\bLAK\b|₭|\bkip\b|ກີບ/i.test(txt)) r.currency = 'LAK';
  else if (/\bTHB\b|฿|baht/i.test(txt)) r.currency = 'THB';
  else if (/\bUSD\b|\$/i.test(txt)) r.currency = 'USD';
  var rf = txt.match(/ລະຫັດທຸລະກຳ\s*:?\s*(\d{8,})/) || txt.match(/\b(20\d{12})\b/);
  if (rf) r.ref = rf[1];
  var d = txt.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (d) r.date = d[0];
  else { d = txt.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/); if (d) r.date = d[3] + '-' + String(d[2]).padStart(2, '0') + '-' + String(d[1]).padStart(2, '0'); }
  return r;
}
// Several entries pasted at once: every entry has a signed amount (+500,000 LAK / -1,000 LAK); balances are unsigned.
export function parseBankEntries(txt) {
  var re = /([+\-\u2212\u2013])\s*([0-9][0-9.,]*)\s*(?:LAK|THB|USD|₭|฿|kip|ກີບ)/gi, hits = [], m;
  while ((m = re.exec(txt))) hits.push({ i: m.index, dir: m[1] === '+' ? 'in' : 'out', amt: toNum(m[2]) });
  if (hits.length < 2) return null;
  return hits.map(function (h, k) {
    var r = parseBankText(txt.slice(h.i, k + 1 < hits.length ? hits[k + 1].i : txt.length));
    r.direction = h.dir; r.amount = h.amt;
    return r;
  });
}
export function cleanEntries(raw) {
  if (raw && !Array.isArray(raw) && Array.isArray(raw.entries)) raw = raw.entries;
  if (!Array.isArray(raw)) return [];
  var out = [];
  raw.forEach(function (r) {
    if (!r) return;
    var amount = Number(r.amount), date = String(r.date || '');
    var dir = r.direction === 'in' ? 'in' : r.direction === 'out' ? 'out' : null;
    if (!dir || !isFinite(amount) || amount < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(parseD(date))) return;
    out.push({
      direction: dir, amount: amount, date: date,
      bank: BANKS.indexOf(r.bank) >= 0 ? r.bank : 'Other',
      ref: r.ref ? String(r.ref).replace(/\D/g, '').slice(0, 30) : '',
      note: String(r.note || '').replace(/\d{6,}/g, '').trim().slice(0, 80),
      currency: /^[A-Z]{3}$/.test(r.currency || '') ? r.currency : null
    });
  });
  return out;
}
export function sameTx(a, b) {
  return (+a.amount === +b.amount) && ((a.direction === 'in') === (b.direction === 'in')) &&
    ((a.ref && b.ref) ? a.ref === b.ref : (a.date === b.date && (a.bank || '') === (b.bank || '')));
}

// Drops entries that appear twice in one list (for example two screenshots that overlap).
export function dedupeList(list) {
  var out = [];
  list.forEach(function (e) { if (!out.some(function (x) { return sameTx(x, e); })) out.push(e); });
  return out;
}
