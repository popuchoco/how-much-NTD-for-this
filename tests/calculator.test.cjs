const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../calculator.js');

const byIds = (...ids) => calc.DENOMINATIONS.filter((denom) => ids.includes(denom.id));
const sumTicks = (counts, denoms) => denoms.reduce((sum, denom) => sum + (counts[denom.id] || 0) * denom.ticks, 0);

test('parses whole-dollar amounts and grouped thousands', () => {
  assert.equal(calc.parseAmount('1280', false).ticks, 2560);
  assert.equal(calc.parseAmount('1,280', false).ticks, 2560);
  assert.equal(calc.parseAmount('1,280.5', true).ticks, 2561);
  assert.equal(calc.parseAmount('200,000', false).ok, true);
  assert.equal(calc.parseAmount('200,001', false).ok, false);
  assert.equal(calc.parseAmount('12.5', false).ok, false);
  assert.equal(calc.parseAmount('1,28', true).ok, false);
  assert.equal(calc.parseAmount('0', false).ok, false);
  assert.equal(calc.parseAmount('200,000.5', true).ok, false);
});

test('empty denomination selection returns a clear no-solution reason', () => {
  const result = calc.calculate({ amount: '1', allowHalf: false, selection: new Set() });
  assert.equal(result.ok, true);
  assert.equal(result.ways, 0n);
  assert.match(result.noSolutionReason, /沒有可用面額/);
  assert.deepEqual(result.solutions, []);
});

test('exact maximum amount works with a single largest denomination', () => {
  const selection = new Set(['note-2000']);
  const result = calc.calculate({ amount: '200,000', allowHalf: false, mode: 'notes', selection });
  assert.equal(result.ok, true);
  assert.equal(result.ways, 1n);
  assert.equal(result.solutions.length, 1);
  assert.equal(result.solutions[0].counts['note-2000'], 100);
  assert.equal(result.extremes.fewestPieces['note-2000'], 100);
  assert.equal(calc.calculate({ amount: '200,001', allowHalf: false, mode: 'notes', selection }).ok, false);
});

test('counts all unordered combinations for a simple coin set', () => {
  const denoms = byIds('coin-5', 'coin-1');
  assert.equal(calc.countCombinations(12, denoms), 2n); // $6: 5+1 or six $1 coins
  const result = calc.calculate({ amount: '6', allowHalf: false, selection: new Set(denoms.map((d) => d.id)) });
  assert.equal(result.ways, 2n);
  assert.equal(result.solutions.length, 2);
  for (const solution of result.solutions) assert.equal(sumTicks(solution.counts, denoms), 12);
});

test('supports half-dollar calculations only when enabled', () => {
  const result = calc.calculate({
    amount: '1.5',
    allowHalf: true,
    mode: 'coins',
    selection: new Set(['coin-1', 'coin-half']),
  });
  assert.equal(result.ways, 2n);
  assert.ok(result.solutions.some((solution) => solution.counts['coin-half'] === 3));
  assert.ok(result.solutions.some((solution) => solution.counts['coin-1'] === 1 && solution.counts['coin-half'] === 1));
});

test('keeps the 5-jiao toggle and selected denomination in sync', () => {
  const preferences = { selected: new Set(['coin-1']), halfEnabled: true };
  calc.syncHalfDollarSelection(preferences);
  assert.equal(preferences.selected.has('coin-half'), true);
  const result = calc.calculate({ amount: '1.5', allowHalf: preferences.halfEnabled, mode: 'coins', selection: preferences.selected });
  assert.ok(result.solutions.some((solution) => solution.counts['coin-half'] > 0));

  preferences.halfEnabled = false;
  calc.syncHalfDollarSelection(preferences);
  assert.equal(preferences.selected.has('coin-half'), false);
});

test('mode and custom denomination filters are honored', () => {
  const selected = new Set(['note-500', 'note-200', 'note-100', 'coin-50', 'coin-1']);
  const notesOnly = calc.denominationChoices(selected, 'notes', false);
  assert.deepEqual(notesOnly.map((denom) => denom.id), ['note-500', 'note-200', 'note-100']);
  assert.equal(calc.calculate({ amount: '300', allowHalf: false, mode: 'notes', selection: selected }).ways, 2n);
  assert.equal(calc.calculate({ amount: '50', allowHalf: false, mode: 'notes', selection: selected }).ways, 0n);
  assert.equal(calc.DENOMINATIONS.some((denom) => denom.id === 'note-50'), false);
});

test('explains amounts outside the selected denominations common unit', () => {
  const result = calc.calculate({ amount: '1', allowHalf: false, selection: new Set(['coin-20', 'coin-50']) });
  assert.equal(result.ways, 0n);
  assert.match(result.noSolutionReason, /共同單位為 NT\$10/);
});

test('explains gaps that remain even when the common unit divides the amount', () => {
  const result = calc.calculate({ amount: '10', allowHalf: false, selection: new Set(['coin-20', 'coin-50']) });
  assert.equal(result.ways, 0n);
  assert.match(result.noSolutionReason, /共同單位可整除該金額/);
});

test('representative solutions are exact and optimize their named measures', () => {
  const selected = new Set(['note-100', 'coin-50', 'coin-20', 'coin-10', 'coin-5', 'coin-1']);
  const result = calc.calculate({ amount: '105', allowHalf: false, selection: selected });
  assert.ok(result.ways > 0n);
  const extremes = result.extremes;
  for (const counts of Object.values(extremes)) assert.equal(sumTicks(counts, result.denoms), 210);
  const fewest = extremes.fewestPieces;
  const fewestItems = result.denoms.reduce((sum, denom) => sum + fewest[denom.id], 0);
  assert.equal(fewestItems, 2); // $100 note + $5 coin
  const mostCoins = extremes.mostCoins;
  assert.equal(mostCoins['note-100'], 0);
  const fewestNotes = extremes.fewestNotes;
  assert.equal(fewestNotes['note-100'], 0); // coins can make the whole amount
});

test('large combination spaces keep an exact count and bound rendered rows', () => {
  const denoms = byIds('coin-5', 'coin-1');
  const result = calc.calculate({ amount: '500', allowHalf: false, selection: new Set(denoms.map((d) => d.id)), listLimit: 10 });
  assert.ok(result.ways > 10n);
  assert.equal(result.solutions.length, 10);
  assert.equal(result.truncated, true);
});
