const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../calculator.js');
const makeup = require('../make-up.js');

const SMALL_DENOMS = calc.DENOMINATIONS.filter((denom) => denom.ticks <= 40);

function amountForTicks(ticks) {
  return ticks % 2 === 0 ? String(ticks / 2) : `${Math.floor(ticks / 2)}.5`;
}

function enumerateReference(targetTicks, denoms) {
  const ordered = [...denoms].sort((a, b) => a.ticks - b.ticks);
  const counts = Object.fromEntries(ordered.map(({ id }) => [id, 0]));
  const solutions = [];

  function visit(index, remaining) {
    if (index === ordered.length) {
      if (remaining === 0) solutions.push({ ...counts });
      return;
    }
    const denom = ordered[index];
    for (let count = 0; count <= Math.floor(remaining / denom.ticks); count += 1) {
      counts[denom.id] = count;
      visit(index + 1, remaining - count * denom.ticks);
    }
    counts[denom.id] = 0;
  }

  visit(0, targetTicks);
  return solutions;
}

function sumCounts(counts, denoms) {
  return denoms.reduce((sum, denom) => sum + counts[denom.id] * denom.ticks, 0);
}

function totalPieces(counts, denoms) {
  return denoms.reduce((sum, denom) => sum + counts[denom.id], 0);
}

function totalNotes(counts, denoms) {
  return denoms.reduce((sum, denom) => sum + (denom.kind === 'note' ? counts[denom.id] : 0), 0);
}

function totalCoins(counts, denoms) {
  return denoms.reduce((sum, denom) => sum + (denom.kind === 'coin' ? counts[denom.id] : 0), 0);
}

function assertCountsValid(counts, denoms, targetTicks, context) {
  assert.equal(sumCounts(counts, denoms), targetTicks, `${context}: amount must match`);
  for (const [id, count] of Object.entries(counts)) {
    assert.ok(Number.isInteger(count) && count >= 0, `${context}: invalid count for ${id}`);
    if (!denoms.some((denom) => denom.id === id)) assert.equal(count, 0, `${context}: unselected denomination ${id}`);
  }
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('deterministic differential checks match a small independent combination oracle', () => {
  const random = seededRandom(0x4e5444);

  for (let iteration = 0; iteration < 72; iteration += 1) {
    const allowHalf = random() < 0.5;
    let amountTicks = 1 + Math.floor(random() * 50);
    if (!allowHalf && amountTicks % 2) amountTicks += 1;
    const selectedIds = SMALL_DENOMS.filter(() => random() < 0.45).map(({ id }) => id);
    if (!selectedIds.length) selectedIds.push(SMALL_DENOMS[Math.floor(random() * SMALL_DENOMS.length)].id);
    const mode = ['all', 'notes', 'coins'][Math.floor(random() * 3)];
    const selection = new Set(selectedIds);
    const denoms = calc.DENOMINATIONS.filter((denom) => {
      if (!selection.has(denom.id)) return false;
      if (denom.id === 'coin-half' && !allowHalf) return false;
      if (mode === 'notes' && denom.kind !== 'note') return false;
      if (mode === 'coins' && denom.kind !== 'coin') return false;
      return true;
    });
    const amount = amountForTicks(amountTicks);

    const exactReference = enumerateReference(amountTicks, denoms);
    const exact = calc.calculate({ amount, allowHalf, mode, selection, listLimit: calc.MAX_LIST_LIMIT });
    assert.equal(exact.ok, true, `exact input should parse at case ${iteration}`);
    assert.equal(exact.ways, BigInt(exactReference.length), `exact count mismatch at case ${iteration}`);
    assert.equal(exact.solutions.length, exactReference.length, `exact rows mismatch at case ${iteration}`);

    const seen = new Set();
    for (const [index, row] of exact.solutions.entries()) {
      assertCountsValid(row.counts, denoms, amountTicks, `case ${iteration}, exact row ${index}`);
      assert.equal(row.summary.pieces, totalPieces(row.counts, denoms));
      assert.equal(row.summary.notes, totalNotes(row.counts, denoms));
      assert.equal(row.summary.coins, totalCoins(row.counts, denoms));
      const key = denoms.map(({ id }) => row.counts[id]).join(',');
      assert.ok(!seen.has(key), `duplicate solution at case ${iteration}`);
      seen.add(key);
    }

    if (exactReference.length) {
      const fewestPieces = Math.min(...exactReference.map((counts) => totalPieces(counts, denoms)));
      const fewestNotes = Math.min(...exactReference.map((counts) => totalNotes(counts, denoms)));
      const mostCoins = Math.max(...exactReference.map((counts) => totalCoins(counts, denoms)));
      assert.equal(totalPieces(exact.extremes.fewestPieces, denoms), fewestPieces, `fewest-pieces mismatch at case ${iteration}`);
      assert.equal(totalNotes(exact.extremes.fewestNotes, denoms), fewestNotes, `fewest-notes mismatch at case ${iteration}`);
      assert.equal(totalCoins(exact.extremes.mostCoins, denoms), mostCoins, `most-coins mismatch at case ${iteration}`);
      for (const [name, counts] of Object.entries(exact.extremes)) {
        assertCountsValid(counts, denoms, amountTicks, `case ${iteration}, extreme ${name}`);
      }
    } else {
      assert.equal(exact.extremes, null);
    }

    const changeReference = [];
    for (let changeTicks = 0; changeTicks <= calc.MAX_CHANGE_TWD * 2; changeTicks += 1) {
      for (const counts of enumerateReference(amountTicks + changeTicks, denoms)) {
        changeReference.push({ counts, changeTicks });
      }
    }
    const change = calc.calculate({ amount, allowHalf, mode, selection, allowChange: true, listLimit: calc.MAX_LIST_LIMIT });
    assert.equal(change.ok, true, `change input should parse at case ${iteration}`);
    assert.equal(change.ways, BigInt(changeReference.length), `change count mismatch at case ${iteration}`);
    assert.equal(change.truncated, changeReference.length > change.solutions.length);

    let previousChange = -1;
    for (const [index, row] of change.solutions.entries()) {
      assertCountsValid(row.counts, denoms, row.paymentTicks, `case ${iteration}, change row ${index}`);
      assert.equal(row.paymentTicks, amountTicks + row.changeTicks);
      assert.ok(row.changeTicks >= 0 && row.changeTicks <= calc.MAX_CHANGE_TWD * 2);
      assert.ok(row.changeTicks >= previousChange, `change amounts must be nondecreasing at case ${iteration}`);
      previousChange = row.changeTicks;
    }
  }
});

test('malformed and adversarial amount input never crashes public parsers', () => {
  const invalidInputs = [
    undefined, null, '', ' ', 'abc', 'NaN', 'Infinity', '-1', '+1', '1e3', '0x10',
    '1.0', '1.50', '.50', '1..5', '1,', '1,00', '10,00,000', '１２０', '١٢٣',
    '1\u00a0000', '1 000', '9'.repeat(400),
  ];

  for (const input of invalidInputs) {
    assert.doesNotThrow(() => calc.parseAmount(input, true), `calculator parser threw for ${String(input).slice(0, 30)}`);
    assert.equal(calc.parseAmount(input, true).ok, false, `calculator accepted ${String(input).slice(0, 30)}`);
    assert.doesNotThrow(() => makeup.parseInventoryAmount(input, true), `inventory parser threw for ${String(input).slice(0, 30)}`);
    if (input === '9'.repeat(400)) {
      assert.equal(makeup.parseInventoryAmount(input, true).ok, true, 'large held totals are supported with BigInt');
      const surplus = makeup.calculateTopUp({ target: '1', currentAmount: input });
      assert.equal(surplus.status, 'surplus', 'large held totals should be classified without entering denomination DP');
    } else {
      assert.equal(makeup.parseInventoryAmount(input, true).ok, false, `inventory parser accepted ${String(input).slice(0, 30)}`);
    }
    assert.doesNotThrow(() => calc.calculate({ amount: input }), `calculator API threw for ${String(input).slice(0, 30)}`);
    assert.equal(makeup.calculateTopUp({ target: input }).ok, false, `top-up API accepted ${String(input).slice(0, 30)}`);
  }
});

test('maximum amount and capped listing remain bounded in consumer change mode', () => {
  const result = calc.calculate({
    amount: String(calc.MAX_AMOUNT_TWD),
    allowHalf: false,
    selection: new Set(['note-2000', 'note-1000', 'note-500', 'note-200', 'note-100', 'coin-50', 'coin-20', 'coin-10', 'coin-5', 'coin-1']),
    allowChange: true,
    listLimit: calc.MAX_LIST_LIMIT,
  });
  assert.equal(result.ok, true);
  assert.ok(result.ways > 0n);
  assert.equal(result.solutions.length, calc.MAX_LIST_LIMIT);
  assert.equal(result.truncated, true);
  assert.ok(result.solutions.every((row) => row.changeTicks >= 0 && row.changeTicks <= calc.MAX_CHANGE_TWD * 2));
});
