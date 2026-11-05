const test = require('node:test');
const assert = require('node:assert/strict');
const makeup = require('../make-up.js');

test('parses held totals including zero, grouped thousands, and optional half dollars', () => {
  assert.deepEqual(makeup.parseInventoryAmount('0', false), { ok: true, ticks: 0n });
  assert.equal(makeup.parseInventoryAmount('1,200.5', true).ticks, 2401n);
  assert.equal(makeup.parseInventoryAmount('1,200.5', false).ok, false);
  assert.equal(makeup.parseInventoryAmount('1,20', true).ok, false);
});

test('adds denomination counts by value and rejects disabled half-dollar counts', () => {
  const counts = { 'note-100': '2', 'coin-20': '1', 'coin-1': '3' };
  assert.equal(makeup.sumDenominationCounts(counts, false).ticks, 446n); // NT$223
  assert.equal(makeup.sumDenominationCounts({ ...counts, 'coin-half': '2' }, false).ok, false);
  assert.equal(makeup.sumDenominationCounts({ ...counts, 'coin-half': '2' }, true).ticks, 448n);
});

test('calculates the remaining amount from a known current total', () => {
  const result = makeup.calculateTopUp({ target: '1,000', currentAmount: '250' });
  assert.equal(result.status, 'needs-more');
  assert.equal(result.targetTicks, 2000n);
  assert.equal(result.currentTicks, 500n);
  assert.equal(result.remainingTicks, 1500n);
  assert.ok(result.calculation.ways > 0n);
  for (const solution of result.calculation.solutions) {
    const ticks = result.calculation.denoms.reduce((sum, denom) => sum + solution.counts[denom.id] * denom.ticks, 0);
    assert.equal(ticks, 1500);
  }
});

test('calculates inventory from individual notes and coins', () => {
  const result = makeup.calculateTopUp({
    target: '300',
    inventoryMethod: 'denominations',
    counts: { 'note-100': '2', 'coin-50': '1' },
  });
  assert.equal(result.currentTicks, 500n);
  assert.equal(result.remainingTicks, 100n);
  assert.ok(result.calculation.ways > 1n);
  assert.equal(result.calculation.extremes.fewestPieces['coin-50'], 1);
});

test('reports exact completion and surplus without trying to make a negative remainder', () => {
  const exact = makeup.calculateTopUp({ target: '100', currentAmount: '100' });
  const surplus = makeup.calculateTopUp({ target: '100', currentAmount: '125' });
  assert.equal(exact.status, 'exact');
  assert.equal(exact.remainingTicks, 0n);
  assert.equal(surplus.status, 'surplus');
  assert.equal(surplus.surplusTicks, 50n);
});

test('respects note-only mode and can top up a half-dollar remainder', () => {
  const impossible = makeup.calculateTopUp({ target: '1,000', currentAmount: '950', mode: 'notes' });
  assert.equal(impossible.calculation.ways, 0n);
  const half = makeup.calculateTopUp({ target: '10.5', currentAmount: '10', allowHalf: true, mode: 'coins' });
  assert.equal(half.remainingTicks, 1n);
  assert.equal(half.calculation.ways, 1n);
  assert.equal(half.calculation.solutions[0].counts['coin-half'], 1);
});
