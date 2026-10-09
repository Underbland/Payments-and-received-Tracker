import '@fontsource/figtree/400.css';
import '@fontsource/figtree/500.css';
import '@fontsource/figtree/600.css';
import '@fontsource/figtree/700.css';
import '@fontsource/noto-sans-lao/400.css';
import '@fontsource/noto-sans-lao/600.css';
import '@fontsource/noto-sans-lao/700.css';
import './styles.css';
import { Capacitor } from '@capacitor/core';
import { T, CATS, BANKS } from './i18n.js';
import { parseD, parseBankText, parseBankEntries, cleanEntries, sameTx, dedupeList } from './parse.js';
import { localStore } from './store.js';
import { cloudEnabled } from './config.js';
var currencySymbols = {
  USD: '$',
  LAK: '₭',
  THB: '฿',
  EUR: '€',
  GBP: '£',
  VND: '₫',
  JPY: '¥',
  CAD: 'C$',
  AUD: 'A$',
  CNY: '¥',
  INR: '₨'
};

var $ = function (s) { return document.querySelector(s); };

function initialLang() {
  try { var l = localStorage.getItem('bt-lang'); if (l === 'lo' || l === 'en') return l; } catch (e) {}
  var n = String(navigator.language || 'en').toLowerCase();
  return n.indexOf('lo') === 0 ? 'lo' : 'en';
}
var state = { bills: [], txs: [], lang: initialLang(), currency: null, tab: 'topay', sort: 'priority', mode: 'connecting', ready: false, editing: null, editingTx: null, paying: null, confirmId: null, goals: { monthlyBudget: 0, budgetCurrency: 'USD', targetDate: '', savedAmount: 0, monthlyNeeded: 0, convertAmount: 0, fromCurrency: 'USD', toCurrency: 'USD', convertedAmount: 0, incomeAmount: 0, taxRate: 0, taxAmount: 0, netAmount: 0 } };
state.currency = state.lang === 'lo' ? 'LAK' : 'USD';
var store = null;
var PRI = { high: { off: -7 }, medium: { off: 0 }, low: { off: 7 } };

function t(k, v) {
  var s = (T[state.lang] && T[state.lang][k]) || T.en[k] || k;
  if (v) Object.keys(v).forEach(function (n) { s = s.split('{' + n + '}').join(v[n]); });
  return s;
}

/* ---------- helpers ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
var LO_MONTHS = ['ມັງກອນ', 'ກຸມພາ', 'ມີນາ', 'ເມສາ', 'ພຶດສະພາ', 'ມິຖຸນາ', 'ກໍລະກົດ', 'ສິງຫາ', 'ກັນຍາ', 'ຕຸລາ', 'ພະຈິກ', 'ທັນວາ'];
function fmtDate(s) {
  var d = parseD(s); if (!d) return '';
  var showYear = d.getFullYear() !== new Date().getFullYear();
  if (state.lang === 'lo') return d.getDate() + ' ' + LO_MONTHS[d.getMonth()] + (showYear ? ' ' + d.getFullYear() : '');
  var o = { day: 'numeric', month: 'short' };
  if (showYear) o.year = 'numeric';
  try { return d.toLocaleDateString('en-GB-u-ca-gregory-nu-latn', o); } catch (e) { return s; }
}
function money(n, currency) {
  var useCurrency = currency || state.currency;
  try {
    var zero = useCurrency === 'LAK' || useCurrency === 'VND';
    return new Intl.NumberFormat((state.lang === 'lo' ? 'lo-LA' : 'en-US') + '-u-nu-latn', { style: 'currency', currency: useCurrency, maximumFractionDigits: zero ? 0 : 2 }).format(n);
  } catch (e) { return useCurrency + ' ' + n; }
}
function count(n, kind) {
  if (state.lang === 'lo') return n + ' ' + t('n_' + kind);
  return n + ' ' + t(n === 1 ? 'n_' + kind : (kind === 'entry' ? 'n_entries' : 'n_bills'));
}
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function daysLeft(b) { return daysBetween(today(), parseD(b.due)); }
function score(b) { return daysLeft(b) + (PRI[b.priority] || PRI.medium).off; }
function dueText(d) {
  if (d < 0) return d === -1 ? t('overdue_by_1') : t('overdue_by', { n: -d });
  if (d === 0) return t('due_today');
  if (d === 1) return t('due_tomorrow');
  return t('due_in', { n: d });
}
function bankLabel(v) { return v === 'Cash' ? t('bank_cash') : v === 'Other' ? t('bank_other') : (v || ''); }
var toastTimer;
function toast(msg) {
  var el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3500);
}

function loadGoals() {
  try {
    const g = localStorage.getItem('bt-goals');
    if (g) {
      state.goals = JSON.parse(g);
    }
  } catch (e) {
    console.error('Failed to load goals', e);
  }
}

function saveGoals() {
  try {
    localStorage.setItem('bt-goals', JSON.stringify(state.goals));
  } catch (e) {
    console.error('Failed to save goals', e);
  }
}

/* ---------- saving ---------- */
function listFor(item) { return item.type === 'tx' ? state.txs : state.bills; }
async function persist(item) {
  if (!store) { toast(t('t_wait')); return; }
  var l = listFor(item);
  var i = l.findIndex(function (x) { return x.id === item.id; });
  if (i >= 0) l[i] = item; else l.push(item);
  renderAll();
  try { await store.save(item); } catch (e) { toast(t('t_saveerr')); }
}
async function removeItem(item) {
  if (item.type === 'tx') state.txs = state.txs.filter(function (x) { return x.id !== item.id; });
  else state.bills = state.bills.filter(function (x) { return x.id !== item.id; });
  state.confirmId = null;
  renderAll();
  try { await store.remove(item); } catch (e) { toast(t('t_delerr')); }
}
function saveSettings() {
  if (store) store.setSettings({ currency: state.currency, lang: state.lang }).catch(function () { toast(t('t_setterr')); });
}
function makeTx(bill, paidOn, bank, existingId) {
  return { id: existingId || ('tx-' + newId()), type: 'tx', direction: 'out', amount: bill.amount, date: paidOn, bank: bank, note: bill.name, billId: bill.id, currency: bill.currency };
}
function markUnpaid(b) {
  var n = Object.assign({}, b, { status: 'received' }); delete n.paidOn; delete n.bank;
  persist(n);
  state.txs.filter(function (x) { return x.billId === b.id; }).forEach(removeItem);
  toast(t('t_unpaid'));
}

/* ---------- translating the page ---------- */
function bankOptionsHtml() { return BANKS.map(function (b) { return '<option value="' + esc(b) + '">' + esc(bankLabel(b)) + '</option>'; }).join(''); }
function applyI18n() {
  document.documentElement.lang = state.lang;
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
  document.querySelectorAll('[data-i18n-aria]').forEach(function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
  document.querySelectorAll('.bank-select').forEach(function (sel) { var v = sel.value; sel.innerHTML = bankOptionsHtml(); if (v) sel.value = v; });
  document.querySelectorAll('[data-lang]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === state.lang)); });
}

/* ---------- drawing the page ---------- */
function renderStatus() {
  var map = { connecting: 'status_connecting', db: 'status_db', local: 'status_local', error: 'status_error' };
  $('#status').setAttribute('data-mode', state.mode);
  $('#statusText').textContent = t(map[state.mode] || 'status_connecting');
  $('#currency').value = state.currency;
  $('#currency').title = state.currency;
  var warn = $('#warn');
  if (state.mode === 'local') { warn.textContent = t('warn_local'); warn.className = 'warn'; warn.hidden = false; }
  else if (state.mode === 'error') { warn.textContent = t('warn_error'); warn.className = 'warn err'; warn.hidden = false; }
  else warn.hidden = true;
  var add = $('#addBtn');
  add.disabled = !state.ready;
  add.textContent = '+ ' + t(state.tab === 'history' ? 'add_entry' : 'add_bill');

  // Update FAB aria-label
  var fab = $('#fab');
  if (fab) {
    fab.setAttribute('aria-label', t(state.tab === 'history' ? 'add_entry' : 'add_bill'));
  }
}
function sum(a, f) { return a.reduce(function (n, x) { return n + (+x[f || 'amount'] || 0); }, 0); }
function stat(cls, label, amount, n, kind, signed) {
  var txt = money(Math.abs(amount));
  if (signed) txt = (amount < 0 ? '−' : amount > 0 ? '+' : '') + txt;
  return '<div class="stat ' + cls + '"><div class="label">' + esc(label) + '</div><div class="value">' + esc(txt) + '</div>' + (n == null ? '' : '<div class="count">' + count(n, kind) + '</div>') + '</div>';
}
function renderSummary() {
  var el = $('#summary');
  var ym = iso(today()).slice(0, 7);
  // Filter by selected currency
  var filteredBills = state.bills.filter(function (b) { return b.currency === state.currency; });
  var filteredTx = state.txs.filter(function (x) { return x.currency === state.currency; });
  if (state.tab === 'history') {
    var inn = filteredTx.filter(function (x) { return x.direction === 'in' && (x.date || '').indexOf(ym) === 0; });
    var out = filteredTx.filter(function (x) { return x.direction !== 'in' && (x.date || '').indexOf(ym) === 0; });
    el.className = 'summary three';
    el.innerHTML = stat('ok', t('st_in'), sum(inn), inn.length, 'entry') + stat('', t('st_out'), sum(out), out.length, 'entry') + stat('', t('st_net'), sum(inn) - sum(out), null, 'entry', true);
    return;
  }
  var unpaid = filteredBills.filter(function (b) { return b.status !== 'paid'; });
  var over = unpaid.filter(function (b) { return daysLeft(b) < 0; });
  var soon = unpaid.filter(function (b) { var d = daysLeft(b); return d >= 0 && d <= 7; });
  var paidM = filteredBills.filter(function (b) { return b.status === 'paid' && (b.paidOn || '').indexOf(ym) === 0; });
  el.className = 'summary';
  el.innerHTML = stat('', t('st_left'), sum(unpaid), unpaid.length, 'bill') + stat('over', t('st_over'), sum(over), over.length, 'bill') +
    stat('soon', t('st_week'), sum(soon), soon.length, 'bill') + stat('ok', t('st_paidm'), sum(paidM), paidM.length, 'bill');
}
function actBtn(cls, act, id, label) { return '<button class="btn sm ' + cls + '" data-act="' + act + '" data-id="' + esc(id) + '">' + esc(label) + '</button>'; }
function delBtn(id) {
  var armed = state.confirmId === id;
  return '<button class="btn sm danger' + (armed ? ' armed' : '') + '" data-act="del" data-id="' + esc(id) + '">' + esc(t(armed ? 'confirm_del' : 'del')) + '</button>';
}
function billHtml(b, rank, paid) {
  var d = daysLeft(b);
  var cls = paid ? 'u-paid' : d < 0 ? 'u-over' : d <= 7 ? 'u-soon' : '';
  var meta = [];
  if (b.category) meta.push(esc(b.category));
  if (b.received) meta.push(esc(t('received_on', { d: fmtDate(b.received) })));
  if (b.note) meta.push(esc(b.note));
  var line2, acts;
  if (paid) {
    var late = b.paidOn ? daysBetween(parseD(b.due), parseD(b.paidOn)) : 0;
    line2 = '<span class="due">' + esc(t('paid_on', { d: fmtDate(b.paidOn) })) + (b.bank ? ' · ' + esc(bankLabel(b.bank)) : '') + '</span>' +
      '<span class="meta">' + esc(late > 1 ? t('late', { n: late }) : late === 1 ? t('late_1') : t('on_time')) + ' · ' + esc(t('was_due', { d: fmtDate(b.due) })) + '</span>';
    acts = actBtn('', 'unpay', b.id, t('undo'));
  } else {
    line2 = '<span class="due">' + esc(dueText(d)) + '</span><span class="meta">' + esc(t('due_on', { d: fmtDate(b.due) })) + '</span>' +
      '<span class="pri ' + esc(b.priority) + '">' + esc(t('pri_' + (b.priority || 'medium'))) + '</span>';
    acts = actBtn('pay', 'pay', b.id, t('mark_paid'));
  }
  acts += actBtn('', 'edit', b.id, t('edit')) + delBtn(b.id);
  return '<li class="bill ' + cls + '"><div class="rank" aria-hidden="true">' + (rank || '') + '</div><div class="body">' +
    '<div class="line1"><span class="name">' + esc(b.name) + '</span><span class="amt">' + esc(money(+b.amount || 0, b.currency)) + '</span></div>' +
    '<div class="line2">' + line2 + '</div>' +
    (meta.length ? '<div class="meta">' + meta.join(' · ') + '</div>' : '') +
    '<div class="acts">' + acts + '</div></div></li>';
}
function txHtml(x) {
  var inn = x.direction === 'in';
  var meta = [t(inn ? 'tx_in' : 'tx_out')];
  if (x.bank) meta.push(bankLabel(x.bank));
  meta.push(fmtDate(x.date));
  return '<li class="tx' + (inn ? ' in' : '') + '"><div class="sign' + (inn ? ' in' : '') + '" aria-hidden="true">' + (inn ? '+' : '−') + '</div><div class="body">' +
    '<div class="line1"><span class="name">' + esc(x.note || t(inn ? 'tx_in' : 'tx_out')) + '</span><span class="amt' + (inn ? ' in' : '') + '">' + esc((inn ? '+' : '−') + money(+x.amount || 0, x.currency)) + '</span></div>' +
    '<div class="meta">' + meta.map(esc).join(' · ') + '</div>' +
    '<div class="acts">' + actBtn('', 'edittx', x.id, t('edit')) + delBtn(x.id) + '</div></div></li>';
}
function emptyHtml(kind) {
  var extra = kind === 'topay' ? '<br><button class="btn primary" data-act="add" style="margin-top:12px">' + esc(t('add_bill')) + '</button>' :
    kind === 'history' ? '<br><button class="btn primary" data-act="add" style="margin-top:12px">' + esc(t('add_entry')) + '</button>' : '';
  return '<li class="empty"><strong>' + esc(t('empty_' + kind + '_t')) + '</strong>' + esc(t('empty_' + kind)) + extra + '</li>';
}
function renderList() {
  var el = $('#list');
  el.className = 'list' + (state.tab === 'topay' && state.sort === 'priority' ? '' : ' no-rank');
  if (!state.ready) { el.innerHTML = '<li class="empty">…</li>'; return; }
  if (state.tab === 'history') {
    var xs = state.txs.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id); });
    el.innerHTML = xs.length ? xs.map(txHtml).join('') : emptyHtml('history');
    return;
  }
  var isTo = state.tab === 'topay';
  var items = state.bills.filter(function (b) { return isTo ? b.status !== 'paid' : b.status === 'paid'; });
  if (isTo) {
    if (state.sort === 'priority') {
      items.sort(function (a, b) { return score(a) - score(b) || a.due.localeCompare(b.due) || (b.amount - a.amount); });
    } else if (state.sort === 'due') {
      items.sort(function (a, b) { return a.due.localeCompare(b.due); });
    } else {
      items.sort(function (a, b) { return b.amount - a.amount; });
    }
  } else {
    items.sort(function (a, b) { return (b.paidOn || '').localeCompare(a.paidOn || ''); });
  }
  el.innerHTML = items.length ? items.map(function (b, i) { return billHtml(b, i + 1, !isTo); }).join('') : emptyHtml(isTo ? 'topay' : 'paid');
}
function renderTabs() {
  var to = state.bills.filter(function (b) { return b.status !== 'paid'; }).length;
  var paid = state.bills.length - to;
  $('#tabTopay').textContent = t('tab_topay') + ' (' + to + ')';
  $('#tabPaid').textContent = t('tab_paid') + ' (' + paid + ')';
  $('#tabHistory').textContent = t('tab_history') + ' (' + state.txs.length + ')';
  ['topay', 'paid', 'history'].forEach(function (k) { $('#tab' + k.charAt(0).toUpperCase() + k.slice(1)).setAttribute('aria-selected', String(state.tab === k)); });
  $('#sortWrap').hidden = state.tab !== 'topay';
  $('#sort').value = state.sort;
  // Update title attribute of sort select
  const sortSelect = $('#sort');
  const selectedOption = sortSelect.options[sortSelect.selectedIndex];
  sortSelect.title = t('order_by') + ' ' + selectedOption.textContent;
  var hint = state.tab === 'topay' ? (state.sort === 'priority' ? t('hint_priority') : '') : state.tab === 'paid' ? t('hint_paid') : t('hint_history');
  $('#hint').textContent = hint; $('#hint').hidden = !hint;
}
function renderAll() { renderStatus(); renderAccount(); renderSummary(); renderTabs(); renderList(); }

/* ---------- dialogs ---------- */
function openDlg(id) { var d = $('#' + id); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
function closeDlg(id) { var d = $('#' + id); if (d.close) d.close(); else d.removeAttribute('open'); }

function openBill(b) {
  state.editing = b || null;
  $('#billTitle').textContent = t(b ? 'f_title_edit' : 'f_title_add');
  $('#fName').value = b ? b.name : '';
  $('#fAmount').value = b ? b.amount : '';
  $('#fCat').value = b ? (b.category || '') : '';
  $('#fReceived').value = b ? (b.received || '') : iso(today());
  $('#fPri').value = b ? (b.priority || 'medium') : 'medium';
  $('#fNote').value = b ? (b.note || '') : '';
  $('#fCurrency').value = b ? (b.currency || state.currency) : state.currency;
  var paid = !!(b && b.status === 'paid');
  $('#paidFields').hidden = !paid;
  $('#fPaid').value = paid ? (b.paidOn || '') : '';
  $('#fBank').value = paid && b.bank ? b.bank : 'Other';
  $('#billErr').textContent = '';
  openDlg('billDlg'); $('#fName').focus();
}
function openPay(b) {
  state.paying = b;
  $('#payFor').textContent = b.name + ' · ' + money(+b.amount || 0);
  $('#pPaidOn').value = iso(today());
  $('#pBank').value = 'BCEL One';
  $('#payErr').textContent = '';
  openDlg('payDlg');
}
function openTx(x) {
  state.editingTx = x || null;
  $('#txTitle').textContent = t(x ? 'tx_title_edit' : 'tx_title_add');
  $('#xDir').value = x ? (x.direction === 'in' ? 'in' : 'out') : 'out';
  $('#xAmount').value = x ? x.amount : '';
  $('#xBank').value = x && x.bank ? x.bank : 'BCEL One';
  $('#xDate').value = x ? (x.date || iso(today())) : iso(today());
  $('#xNote').value = x ? (x.note || '') : '';
  $('#xCurrency').value = x ? x.currency : state.currency;
  $('#xPaste').value = ''; $('#pasteNote').textContent = ''; ('pasteBox').open = false; ('ocrBox').open = false;
  ('xRef').value = x && x.ref ? x.ref : ''; ('ocrNote').textContent = ''; ('xImage').value = '';
  ('txErr').textContent = '';
  openDlg('txDlg');
}
function openGoalsDlg() {
    // Populate currency selects
    const budgetCurrencySelect = $('#gBudgetCurrency');
    const fromCurrencySelect = $('#gFromCurrency');
    const toCurrencySelect = $('#gToCurrency');

    // Clear existing options
    budgetCurrencySelect.innerHTML = '';
    fromCurrencySelect.innerHTML = '';
    toCurrencySelect.innerHTML = '';

    // Populate with the same options as the main currency select
    const mainCurrencySelect = $('#currency');
    for (let i = 0; i < mainCurrencySelect.options.length; i++) {
      const option = mainCurrencySelect.options[i];
      const clonedOption = option.cloneNode(true);
      budgetCurrencySelect.appendChild(clonedOption.cloneNode(true));
      fromCurrencySelect.appendChild(clonedOption.cloneNode(true));
      toCurrencySelect.appendChild(clonedOption.cloneNode(true));
    }

    // Load current goals into the form
    $('#gMonthlyBudget').value = state.goals.monthlyBudget || '';
    $('#gBudgetCurrency').value = state.goals.budgetCurrency || state.currency;
    $('#gTargetDate').value = state.goals.targetDate || '';
    $('#gSavedAmount').value = state.goals.savedAmount || '';
    // Monthly needed will be calculated
    $('#gConvertAmount').value = state.goals.convertAmount || '';
    $('#gFromCurrency').value = state.goals.fromCurrency || state.currency;
    $('#gToCurrency').value = state.goals.toCurrency || state.currency;
    // Converted amount will be calculated
    $('#gIncomeAmount').value = state.goals.incomeAmount || '';
    $('#gTaxRate').value = state.goals.taxRate || '';
    // Tax and net amounts will be calculated

    // Trigger initial calculations
    calculateMonthlyNeeded();
    calculateConvertedAmount();
    calculateTaxAmount();

    // Attach event listeners for inputs that affect calculations
    $('#gMonthlyBudget').addEventListener('input', calculateMonthlyNeeded);
    $('#gSavedAmount').addEventListener('input', calculateMonthlyNeeded);
    $('#gTargetDate').addEventListener('input', calculateMonthlyNeeded);
    $('#gConvertAmount').addEventListener('input', calculateConvertedAmount);
    $('#gFromCurrency').addEventListener('input', calculateConvertedAmount);
    $('#gToCurrency').addEventListener('input', calculateConvertedAmount);
    $('#gIncomeAmount').addEventListener('input', calculateTaxAmount);
    $('#gTaxRate').addEventListener('input', calculateTaxAmount);

    openDlg('goalsDlg');
  }

function calculateMonthlyNeeded() {
  const budget = parseFloat($('#gMonthlyBudget').value) || 0;
  const saved = parseFloat($('#gSavedAmount').value) || 0;
  const targetDateStr = $('#gTargetDate').value;
  let monthlyNeeded = budget - saved; // default if no target date or past target

  if (targetDateStr) {
    const targetDate = new Date(targetDateStr);
    const today = new Date();
    today.setHours(0,0,0,0);
    targetDate.setHours(0,0,0,0);
    if (targetDate > today) {
      const diffTime = targetDate - today;
      const diffMonths = diffTime / (1000 * 60 * 60 * 24 * 30); // approximate months
      if (diffMonths > 0) {
        monthlyNeeded = (budget - saved) / diffMonths;
      }
    }
  }

  // Display in the budget currency
  const budgetCurrency = $('#gBudgetCurrency').value;
  $('#gMonthlyNeeded').value = money(monthlyNeeded, budgetCurrency);
}

function calculateConvertedAmount() {
  const amount = parseFloat($('#gConvertAmount').value) || 0;
  const fromCurrency = $('#gFromCurrency').value;
  const toCurrency = $('#gToCurrency').value;
  // Placeholder: use 1:1 conversion rate
  const convertedAmount = amount; // same as input for now

  $('#gConvertedAmount').value = money(convertedAmount, toCurrency);
}

function calculateTaxAmount() {
  const income = parseFloat($('#gIncomeAmount').value) || 0;
  const taxRate = parseFloat($('#gTaxRate').value) || 0;
  const taxAmount = income * (taxRate / 100);
  const netAmount = income - taxAmount;

  // Assume income is in the budget currency? We'll use the budget currency for display
  const budgetCurrency = $('#gBudgetCurrency').value;
  $('#gTaxAmount').value = money(taxAmount, budgetCurrency);
  $('#gNetAmount').value = money(netAmount, budgetCurrency);
}

$('#billForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var name = $('#fName').value.trim(), amount = parseFloat($('#fAmount').value), due = $('#fDue').value, err = $('#billErr');
  if (!name) { err.textContent = t('err_name'); $('#fName').focus(); return; }
  if (!isFinite(amount) || amount < 0) { err.textContent = t('err_amount'); $('#fAmount').focus(); return; }
  if (!due) { err.textContent = t('err_due'); $('#fDue').focus(); return; }
  var ed = state.editing;
  var b = { id: ed ? ed.id : 'b' + newId(), name: name, amount: amount, category: $('#fCat').value.trim(), received: $('#fReceived').value || iso(today()), due: due, priority: $('#fPri').value, note: $('#fNote').value.trim(), currency: $('#fCurrency').value, status: ed ? ed.status : 'received' };
  if (ed && ed.status === 'paid') { b.paidOn = $('#fPaid').value || ed.paidOn || iso(today()); b.bank = $('#fBank').value; }
  closeDlg('billDlg');
  persist(b);
  if (ed && ed.status === 'paid') {
    var linked = state.txs.find(function (x) { return x.billId === b.id; });
    if (linked) persist(makeTx(b, b.paidOn, b.bank, linked.id));
  }
  toast(t(ed ? 't_updated' : 't_added'));
});
$('#payForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var b = state.paying; if (!b) return;
  var paidOn = $('#pPaidOn').value;
  if (!paidOn) { $('#payErr').textContent = t('err_date'); return; }
  var bank = $('#pBank').value;
  closeDlg('payDlg');
  persist(Object.assign({}, b, { status: 'paid', paidOn: paidOn, bank: bank }));
  persist(makeTx(b, paidOn, bank));
  toast(t('t_paid'));
});
$('#txForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var amount = parseFloat($('#xAmount').value), date = $('#xDate').value, err = $('#txErr');
  if (!isFinite(amount) || amount < 0 || $('#xAmount').value === '') { err.textContent = t('err_amount'); $('#xAmount').focus(); return; }
  if (!date) { err.textContent = t('err_date'); $('#xDate').focus(); return; }
  var ed = state.editingTx;
  var x = { id: ed ? ed.id : 'tx-' + newId(), type: 'tx', direction: $('#xDir').value, amount: amount, date: date, bank: $('#xBank').value, note: $('#xNote').value.trim(), currency: $('#xCurrency').value };
  if (ed && ed.billId) x.billId = ed.billId;
  var rf = $('#xRef').value; if (rf) x.ref = rf;
  if (!ed && isDup(x)) { err.textContent = t('dup_msg'); return; }
  $('#xPaste').value = '';
  closeDlg('txDlg');
  persist(x);
  toast(t(ed ? 't_entry_updated' : 't_entry_added'));
});
document.querySelectorAll('[data-close]').forEach(function (b) {
  b.addEventListener('click', function () { var id = b.getAttribute('data-close'); if (id === 'txDlg') $('#xPaste').value = ''; closeDlg(id); });
});

function isDup(e) { return state.txs.some(function (x) { return sameTx(x, e); }); }

// Turns pasted or screen-read text into entries. 'many' = review list opened, 'one' = form filled, 'none' = nothing found.
function importFromText(txt) {
  var many = parseBankEntries(txt);
  if (many) {
    var fb = $('#xBank').value;
    many.forEach(function (r) { if (r.bank && fb === $('#xBank').value) fb = r.bank; });
    var list = dedupeList(cleanEntries(many.map(function (r) {
      return { direction: r.direction, amount: r.amount, date: r.date || iso(today()), bank: r.bank || fb, ref: r.ref || '', note: '', currency: r.currency || state.currency };
    })));
  if (list.length) { closeDlg('txDlg'); openImport(list); return 'many'; }
  }
  var r = parseBankText(txt);
  if (r.amount == null) return 'none';
  $('#xAmount').value = r.amount;
  if (r.direction) $('#xDir').value = r.direction;
  if (r.bank) $('#xBank').value = r.bank;
  if (r.date && parseD(r.date) && !isNaN(parseD(r.date))) $('#xDate').value = r.date;
  $('#xRef').value = r.ref || '';
  $('#xCurrency').value = r.currency || state.currency;
  return 'one';
}

$('#pasteBtn').addEventListener('click', function () {
  var res = importFromText($('#xPaste').value);
  if (res !== 'none') $('#xPaste').value = '';
  $('#pasteNote').textContent = res === 'none' ? t('paste_none') : res === 'one' ? t('paste_done') : '';
});

var ocrBusy = false;
$('#ocrBtn').addEventListener('click', async function () {
  var note = $('#ocrNote');
  if (ocrBusy) return;
  var files = Array.prototype.slice.call($('#xImage').files || []);
  if (!files.length) { note.textContent = t('ocr_pick'); return; }
  ocrBusy = true; $('#ocrBtn').disabled = true; note.textContent = t('ocr_busy');
  try {
    var ocr = await import('./ocr.js');
    var text = await ocr.readImagesText(files, function (p) { note.textContent = t('ocr_busy') + ' ' + Math.round(p * 100) + '%'; });
    var res = importFromText(text);
    if (res === 'none') note.textContent = t('ocr_none');
    else { note.textContent = res === 'one' ? t('paste_done') : ''; $('#xImage').value = ''; }
  } catch (e) { note.textContent = t('ocr_err'); }
  finally { ocrBusy = false; $('#ocrBtn').disabled = false; }
});

/* ---------- reviewing entries before they are added ---------- */
var importList = [], importCur = null;
function renderImport() {
  $('#impList').innerHTML = importList.map(function (e, i) {
    var dup = isDup(e);
    var meta = [t(e.direction === 'in' ? 'tx_in' : 'tx_out'), bankLabel(e.bank), fmtDate(e.date)];
    if (e.note) meta.push(e.note);
    if (dup) meta.push(t('imp_dup'));
    return '<li class="imp"><label><input type="checkbox" data-i="' + i + '"' + (dup ? '' : ' checked') + '><span><strong>' +
      esc((e.direction === 'in' ? '+' : '−') + money(e.amount, e.currency)) + '</strong><br><span class="meta">' + esc(meta.join(' · ')) + '</span></span></label></li>';
  }).join('');
  $('#impAdd').textContent = t('imp_add');
}
function openImport(list) {
  importList = list;
  $('#impTitle').textContent = t('imp_title', { n: list.length });
  var cur = null;
  list.forEach(function (e) { if (!cur && e.currency) cur = e.currency; });
  var warn = $('#impCur');
  importCur = cur;
  if (cur && cur !== state.currency && ['USD', 'LAK', 'THB', 'EUR', 'GBP', 'VND'].indexOf(cur) >= 0) {
    warn.innerHTML = '<span>' + esc(t('imp_cur', { a: cur, b: state.currency })) + '</span><button type="button" class="btn sm" id="impSwitch">' + esc(t('imp_switch', { a: cur })) + '</button>';
    warn.hidden = false;
  } else warn.hidden = true;
  renderImport();
  openDlg('impDlg');
  // Handle impSwitch click to change app currency based on imported data
  document.addEventListener('click', function (e) {
    if (e.target.id === 'impSwitch') {
      state.currency = importCur;
      saveSettings();
      $('#impCur').hidden = true;
      renderAll();
      renderImport();
    }
  });
}
$('#impForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var n = 0;
  document.querySelectorAll('#impList input[type=checkbox]').forEach(function (cb) {
    if (!cb.checked) return;
    var it = importList[+cb.getAttribute('data-i')];
    var x = { id: 'tx-' + newId(), type: 'tx', direction: it.direction, amount: it.amount, date: it.date, bank: it.bank, note: it.note };
    if (it.ref) x.ref = it.ref;
    persist(x); n++;
  });
  closeDlg('impDlg');
  if (n) { state.tab = 'history'; renderAll(); toast(t('t_imported', { n: n })); }
});

/* ---------- events ---------- */
$('#addBtn').addEventListener('click', function () { if (state.tab === 'history') openTx(null); else openBill(null); });
$('#fab').addEventListener('click', function () { if (state.tab === 'history') openTx(null); else openBill(null); });
$('#currency').addEventListener('change', function (e) { state.currency = e.target.value; renderAll(); saveSettings(); });
$('#sort').addEventListener('change', function (e) {
  state.sort = e.target.value;
  // Update title to show current sort option
  const sortSelect = $('#sort');
  const selectedOption = sortSelect.options[sortSelect.selectedIndex];
  sortSelect.title = t('order_by') + ' ' + selectedOption.textContent;
  renderAll();
});
document.querySelectorAll('[data-lang]').forEach(function (b) {
  b.addEventListener('click', function () {
    state.lang = b.getAttribute('data-lang');
    try { localStorage.setItem('bt-lang', state.lang); } catch (e) {}
    applyI18n(); renderAll(); saveSettings();
  });
});
document.querySelectorAll('.tab').forEach(function (tb) {
  tb.addEventListener('click', function () { state.tab = tb.getAttribute('data-tab'); state.confirmId = null; renderAll(); });
});
$('#list').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-act]'); if (!btn) return;
  var act = btn.getAttribute('data-act'), id = btn.getAttribute('data-id');
  if (act === 'add') { if (state.tab === 'history') openTx(null); else openBill(null); return; }
  var b = state.bills.find(function (x) { return x.id === id; });
  var x = state.txs.find(function (y) { return y.id === id; });
  if (act === 'pay' && b) openPay(b);
  else if (act === 'unpay' && b) markUnpaid(b);
  else if (act === 'edit' && b) openBill(b);
  else if (act === 'edittx' && x) openTx(x);
  else if (act === 'del' && (b || x)) {
    if (state.confirmId === id) removeItem(b || x);
    else {
      state.confirmId = id; renderList();
      setTimeout(function () { if (state.confirmId === id) { state.confirmId = null; renderList(); } }, 4000);
    }
  }
});

/* ---------- choosing where data is kept: account (cloud) when signed in, this device otherwise ---------- */
var cloud = null, currentUser = null, unsubStore = null, firstLoad = true;

function useStore(s) {
  if (unsubStore) { try { unsubStore(); } catch (e) {} unsubStore = null; }
  store = s; state.mode = s.mode; state.ready = false; firstLoad = true;
  renderAll();
  var u = s.load(onData, function () { state.mode = 'error'; state.ready = true; renderAll(); });
  if (typeof u === 'function') unsubStore = u;
}
function onData(bills, txs, settings) {
  bills.concat(txs).forEach(function (x) { if (x.bank === 'APB') x.bank = 'APB Meporm'; });
  state.bills = bills; state.txs = txs;
  if (settings && settings.currency) state.currency = settings.currency;
  var wasFirst = firstLoad; firstLoad = false;
  if (wasFirst && settings && settings.lang && settings.lang !== state.lang) {
    state.lang = settings.lang;
    try { localStorage.setItem('bt-lang', state.lang); } catch (e) {}
    applyI18n();
  }
  state.ready = true;
  if (state.mode !== 'error') state.mode = store.mode;
  renderAll();
  if (wasFirst && store.mode === 'db') migrateLocal(bills.concat(txs));
}
// After sign-in: if items were saved on this device while signed out, ASK what to do with them. Never move them silently.
var pendingLocal = [];
function migrateLocal(cloudItems) {
  var local = localStore(), items = local.all();
  var have = {};
  cloudItems.forEach(function (x) { have[x.id] = true; });
  var fresh = items.filter(function (x) { return !have[x.id]; });
  if (!fresh.length) { if (items.length) local.clear(); return; }   // already in the account
  pendingLocal = fresh;
  $('#mergeText').textContent = t('merge_text', { n: fresh.length });
  openDlg('mergeDlg');
}
$('#mergeAdd').addEventListener('click', async function () {
  var b = $('#mergeAdd'); b.disabled = true;
  try {
    for (var i = 0; i < pendingLocal.length; i++) await store.save(pendingLocal[i]);
    localStore().clear();
    pendingLocal = [];
    closeDlg('mergeDlg');
    toast(t('t_migrated'));
  } catch (e) { toast(t('t_saveerr')); }
  finally { b.disabled = false; }
});
$('#mergeDelete').addEventListener('click', function () { localStore().clear(); pendingLocal = []; closeDlg('mergeDlg'); });
$('#mergeLater').addEventListener('click', function () { closeDlg('mergeDlg'); });

function renderAccount() {
  var btn = $('#acctBtn'), who = $('#who');
  if (!cloudEnabled) { btn.hidden = true; who.hidden = true; return; }
  btn.hidden = false;
  if (currentUser) {
    who.hidden = true;
    var name = currentUser.displayName || currentUser.email || '';
    var initials = '';
    if (name) {
      var parts = name.split(' ').filter(function(part) { return part.length > 0; });
      if (parts.length >= 2) {
        initials = parts[0][0] + parts[parts.length-1][0];
      } else if (parts.length === 1) {
        initials = parts[0][0];
      }
    }
    initials = initials.toUpperCase();
    btn.textContent = initials;
    btn.title = name;
    btn.setAttribute('aria-label', t('sign_out') + ' ' + name);
  } else {
    who.hidden = true;
    btn.textContent = t('sign_in');
    btn.title = '';
    btn.setAttribute('aria-label', t('sign_in'));
  }
}
$('#acctBtn').addEventListener('click', async function () {
  if (!cloud) { toast(t('t_wait')); return; }
  if (currentUser) { try { await cloud.signOut(); } catch (e) { toast(t('sign_err')); } return; }
  $('#signErr').textContent = '';
  $('#signGoogle').hidden = cloud.providers.indexOf('google') < 0;
  $('#signFacebook').hidden = cloud.providers.indexOf('facebook') < 0;
  openDlg('signDlg');
});
$('#goalsBtn').addEventListener('click', openGoalsDlg);
[['#signGoogle', 'google'], ['#signFacebook', 'facebook']].forEach(function (pair) {
  $(pair[0]).addEventListener('click', async function () {
    if (!cloud) return;
    var b = $(pair[0]); b.disabled = true; $('#signErr').textContent = '';
    try { await cloud.signIn(pair[1]); closeDlg('signDlg'); }
    catch (e) { if (!(e && e.cancelled)) $('#signErr').textContent = t('sign_err'); }
    finally { b.disabled = false; }
  });
});

async function startCloud() {
  try {
    cloud = await import('./cloud.js');
    cloud.watchAuth(function (user) {
      currentUser = user;
      useStore(user ? cloud.cloudStore(user.uid) : localStore());
    });
  } catch (e) { cloud = null; useStore(localStore()); }
}

applyI18n();
loadGoals();
renderAll();
if (cloudEnabled) startCloud(); else useStore(localStore());

// Installable web version (not used inside the Android app).
if ('serviceWorker' in navigator && !Capacitor.isNativePlatform() && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); });
}

// Goals form submit
$('#goalsForm').addEventListener('submit', function (e) {
  e.preventDefault();
  // Update state.goals with input values
  state.goals.monthlyBudget = parseFloat($('#gMonthlyBudget').value) || 0;
  state.goals.budgetCurrency = $('#gBudgetCurrency').value;
  state.goals.targetDate = $('#gTargetDate').value;
  state.goals.savedAmount = parseFloat($('#gSavedAmount').value) || 0;
  state.goals.convertAmount = parseFloat($('#gConvertAmount').value) || 0;
  state.goals.fromCurrency = $('#gFromCurrency').value;
  state.goals.toCurrency = $('#gToCurrency').value;
  state.goals.incomeAmount = parseFloat($('#gIncomeAmount').value) || 0;
  state.goals.taxRate = parseFloat($('#gTaxRate').value) || 0;
  // Trigger calculations to update the form fields (so the user sees the calculated values)
  calculateMonthlyNeeded();
  calculateConvertedAmount();
  calculateTaxAmount();
  // Now update state.goals with the calculated fields from the form
  // We'll recalculate for consistency and to avoid parsing formatted strings

  // Recalculate monthly needed
  const budget = parseFloat($('#gMonthlyBudget').value) || 0;
  const saved = parseFloat($('#gSavedAmount').value) || 0;
  const targetDateStr = $('#gTargetDate').value;
  let monthlyNeeded = budget - saved;
  if (targetDateStr) {
    const targetDate = new Date(targetDateStr);
    const today = new Date();
    today.setHours(0,0,0,0);
    targetDate.setHours(0,0,0,0);
    if (targetDate > today) {
      const diffTime = targetDate - today;
      const diffMonths = diffTime / (1000 * 60 * 60 * 24 * 30); // approximate months
      if (diffMonths > 0) {
        monthlyNeeded = (budget - saved) / diffMonths;
      }
    }
  }
  state.goals.monthlyNeeded = monthlyNeeded;

  // Recalculate converted amount (placeholder 1:1)
  const amount = parseFloat($('#gConvertAmount').value) || 0;
  const fromCurrency = $('#gFromCurrency').value;
  const toCurrency = $('#gToCurrency').value;
  const convertedAmount = amount; // placeholder
  state.goals.convertedAmount = convertedAmount;

  // Recalculate tax amount
  const income = parseFloat($('#gIncomeAmount').value) || 0;
  const taxRate = parseFloat($('#gTaxRate').value) || 0;
  const taxAmount = income * (taxRate / 100);
  const netAmount = income - taxAmount;
  state.goals.taxAmount = taxAmount;
  state.goals.netAmount = netAmount;

  // Save the goals
  saveGoals();
  toast('Goals saved');
  closeDlg('goalsDlg');
});