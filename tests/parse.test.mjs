// Run with: npm test
import assert from 'node:assert/strict';
import { toNum, parseBankText, parseBankEntries, cleanEntries, sameTx, dedupeList } from '../src/parse.js';

// number formats
assert.equal(toNum('250,000'), 250000);
assert.equal(toNum('1,250,000.50'), 1250000.5);
assert.equal(toNum('45.50'), 45.5);
assert.equal(toNum('1.250.000'), 1250000);

// three entries in the layout of an APB Meporm history screen
const statement = [
  'ໄດ້ຮັບເງິນ', '+500,000 LAK', 'ວັນທີ່: 08/10/2026 12:27',
  'ເນື້ອໃນທຸລະກຳ: LMPS IN|QR|BCEL|12101200000000006020001|APB|08010000000237|BONEBCWVQVLST15Y',
  'ຍອດເງິນຄົງເຫຼືອ : 705,363.86 LAK', 'ລະຫັດທຸລະກຳ : 20261008260233',
  'ໂອນເງິນ', '-1,000 LAK', 'ວັນທີ່: 07/10/2026 13:32', 'ເນື້ອໃນທຸລະກຳ: CHARGE FEE - LAPNET,Ref No.',
  'ຍອດເງິນຄົງເຫຼືອ : 205,363.86 LAK', 'ລະຫັດທຸລະກຳ : 20261007546160',
  'ໂອນຂ້າມທະນາຄານ', '-77,000 LAK', 'ວັນທີ່: 07/10/2026 13:32',
  'ເນື້ອໃນທຸລະກຳ: LMPS OUT|QR|LAP08TISJLCF98FE|APB|08010000000237|MEPORM|BCEL|QR|NAME MR|67',
  'ຍອດເງິນຄົງເຫຼືອ : 206,363.86 LAK', 'ລະຫັດທຸລະກຳ : 20261007546160'
].join('\n');

const many = parseBankEntries(statement);
assert.equal(many.length, 3);
assert.deepEqual(many.map((e) => [e.direction, e.amount, e.date]), [['in', 500000, '2026-10-08'], ['out', 1000, '2026-10-07'], ['out', 77000, '2026-10-07']]);
assert.equal(many[0].bank, 'APB Meporm');
assert.equal(many[2].bank, 'APB Meporm');
assert.equal(many[0].currency, 'LAK');

// the fee and the transfer share one transaction code but are different payments
const [fee, transfer] = [many[1], many[2]];
assert.equal(fee.ref, transfer.ref);
assert.equal(sameTx(fee, transfer), false);
assert.equal(sameTx(transfer, { ...transfer }), true);

// a single message
const one = parseBankText('+500,000 LAK 08/10/2026 12:27 LMPS IN|QR|BCEL|1210|APB|0801');
assert.equal(one.amount, 500000);
assert.equal(one.direction, 'in');
assert.equal(one.date, '2026-10-08');
const plain = parseBankText('BCEL One: You paid 45,000 LAK to Shop on 2026-10-05');
assert.equal(plain.amount, 45000);
assert.equal(plain.direction, 'out');
assert.equal(plain.bank, 'BCEL One');

// cleaning: bad rows are dropped, account numbers never reach the note
const cleaned = cleanEntries([
  { direction: 'in', amount: 10, date: '2026-10-01', bank: 'LDB', note: 'From 1234567890123 account' },
  { direction: 'sideways', amount: 10, date: '2026-10-01' },
  { direction: 'out', amount: 'abc', date: '2026-10-01' },
  { direction: 'out', amount: 5, date: 'not a date' }
]);
assert.equal(cleaned.length, 1);
assert.ok(!/\d{6,}/.test(cleaned[0].note));

// text as the on-device reader returns it from a real screenshot: Lao labels come out as junk, digits and Latin text are fine
const ocrText = `| 08 aan 2026

ldsuiju +500,000 LAK
Sui: 08/10/2026 12:27 =
Wistunazm : LMPS INIQRIBCEL]
0000000000000000000000]APBI00000000000000|
BONEBCWVQVLSTISY

goajualie : 705,363.86 LAK

ERI NES 1 20261008260233

| 07 aa 2026

Touiju -1,000 LAK
Swi: 07/10/2026 13:32 A
Wistumnazi : CHARGE FEE - LAPNET,Ref No.

goajualie : 205,363.86 LAK

a:uiana=m 1 20261007546160
Toujuzwun:nan -77,000 LAK
Sui: 07/10/2026 13:32 a
welunazm : LMPS OUTIQRILAPOSTISJLCFO8FE|APB]
00000000000000|MEPORMIBCELIQRIPERSON
NAME MRI67

gaaljudilie : 206,363.86 LAK

asianazm : 20261007546160
`;
const fromOcr = parseBankEntries(ocrText);
assert.equal(fromOcr.length, 3);
assert.deepEqual(fromOcr.map((e) => [e.direction, e.amount, e.date]), [['in', 500000, '2026-10-08'], ['out', 1000, '2026-10-07'], ['out', 77000, '2026-10-07']]);
assert.equal(fromOcr[0].bank, 'APB Meporm');   // "|APBI0000" must still count as APB, not BCEL
assert.equal(fromOcr[0].ref, '20261008260233');
assert.equal(dedupeList(cleanEntries(fromOcr.concat(fromOcr))).length, 3);   // two overlapping screenshots do not double up

console.log('All parser tests passed');
