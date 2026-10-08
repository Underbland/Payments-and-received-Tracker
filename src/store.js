// Storage used when nobody is signed in: this device only (localStorage).
const KEY = 'bill-tracker:v1';

export function localStore() {
  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      var d = raw ? JSON.parse(raw) : {};
      d.bills = d.bills || []; d.txs = d.txs || [];
      return d;
    } catch (e) { return { bills: [], txs: [] }; }
  }
  var data = read();
  function write() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} }
  function listOf(item) { return item.type === 'tx' ? data.txs : data.bills; }
  return {
    mode: 'local',
    load: function (cb) { cb(data.bills.slice(), data.txs.slice(), { currency: data.currency || null, lang: data.lang || null }); },
    save: function (item) {
      var l = listOf(item), i = l.findIndex(function (x) { return x.id === item.id; });
      if (i >= 0) l[i] = item; else l.push(item);
      write(); return Promise.resolve();
    },
    remove: function (item) {
      var l = listOf(item), i = l.findIndex(function (x) { return x.id === item.id; });
      if (i >= 0) l.splice(i, 1);
      write(); return Promise.resolve();
    },
    setSettings: function (s) { data.currency = s.currency; data.lang = s.lang; write(); return Promise.resolve(); },
    // used once after sign-in to move device-only data into the account
    all: function () { return data.bills.concat(data.txs); },
    clear: function () { data.bills = []; data.txs = []; write(); }
  };
}
