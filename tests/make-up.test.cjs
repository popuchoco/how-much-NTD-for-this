const test = require('node:test');
const assert = require('node:assert/strict');
const makeup = require('../make-up.js');

class MockElement {
  constructor(doc, tagName = 'div') {
    this.doc = doc;
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
  }

  set id(value) {
    this._id = value;
    if (value) this.doc.elements.set(value, this);
  }

  get id() { return this._id; }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, listener) { this.listeners[name] = listener; }
}

class MockDocument {
  constructor() { this.elements = new Map(); }

  createElement(tagName) { return new MockElement(this, tagName); }
  createElementNS(_namespace, tagName) { return this.createElement(tagName); }
  getElementById(id) { return this.elements.get(id) || null; }
  addElement(id, tagName) {
    const element = this.createElement(tagName);
    element.id = id;
    return element;
  }
}

function createMountDocument() {
  const doc = new MockDocument();
  const ids = [
    'makeup-form', 'makeup-target', 'makeup-current-total', 'inventory-total-panel',
    'inventory-counts-panel', 'inventory-counts', 'makeup-results-panel', 'makeup-status',
    'makeup-target-error', 'makeup-inventory-error', 'makeup-load-more', 'makeup-half-dollar',
  ];
  ids.forEach((id) => doc.addElement(id, id.includes('form') || id.includes('panel') || id.includes('counts') ? 'form' : 'div'));

  const form = doc.getElementById('makeup-form');
  const inventoryMethodInputs = [doc.createElement('input'), doc.createElement('input')];
  inventoryMethodInputs[0].checked = true;
  const modeInputs = [doc.createElement('input'), doc.createElement('input'), doc.createElement('input')];
  modeInputs[0].checked = true;
  form.querySelectorAll = (selector) => selector.includes('inventory-method') ? inventoryMethodInputs : modeInputs;
  return doc;
}

test('mount creates half-dollar controls before looking them up and binds form submission', () => {
  const doc = createMountDocument();

  assert.doesNotThrow(() => makeup.mount(doc));
  assert.equal(doc.getElementById('coin-half-count-row').hidden, true);
  assert.equal(doc.getElementById('count-coin-half').disabled, true);
  assert.equal(typeof doc.getElementById('makeup-form').listeners.submit, 'function');
});

test('parses held totals including zero, grouped thousands, and optional half dollars', () => {
  assert.deepEqual(makeup.parseInventoryAmount('0', false), { ok: true, ticks: 0n });
  assert.equal(makeup.parseInventoryAmount('1,200.5', true).ticks, 2401n);
  assert.equal(makeup.parseInventoryAmount('1,200.5', false).ok, false);
  assert.equal(makeup.parseInventoryAmount('1,20', true).ok, false);
});

test('rejects empty, non-numeric, malformed, non-positive, and over-limit targets', () => {
  const invalidTargets = ['', 'abc', '1.23', '1,28', '-100', '0', '200,001', '9'.repeat(400)];
  for (const target of invalidTargets) {
    const result = makeup.calculateTopUp({ target, currentAmount: '0' });
    assert.equal(result.ok, false, `target should be rejected: ${JSON.stringify(target)}`);
    assert.equal(result.field, 'target');
    assert.ok(result.error);
  }

  const empty = makeup.calculateTopUp({ target: '', currentAmount: '0' });
  assert.match(empty.error, /請先輸入金額/);
  const zero = makeup.calculateTopUp({ target: '0', currentAmount: '0' });
  assert.match(zero.error, /金額需大於 0/);
  const maximum = makeup.calculateTopUp({ target: '200,000', currentAmount: '200,000' });
  assert.equal(maximum.ok, true);
  assert.equal(maximum.status, 'exact');
});

test('rejects malformed current totals and preserves the current-amount error field', () => {
  for (const currentAmount of ['', 'abc', '1.23', '1,28', '-100', '1e3']) {
    const result = makeup.calculateTopUp({ target: '100', currentAmount });
    assert.equal(result.ok, false, `current total should be rejected: ${JSON.stringify(currentAmount)}`);
    assert.equal(result.field, 'current-amount');
    assert.ok(result.error);
  }

  assert.equal(makeup.calculateTopUp({ target: '100', currentAmount: '1,000' }).status, 'surplus');
});

test('adds denomination counts by value and rejects disabled half-dollar counts', () => {
  const counts = { 'note-100': '2', 'coin-20': '1', 'coin-1': '3' };
  assert.equal(makeup.sumDenominationCounts(counts, false).ticks, 446n); // NT$223
  assert.equal(makeup.sumDenominationCounts({ ...counts, 'coin-half': '2' }, false).ok, false);
  assert.equal(makeup.sumDenominationCounts({ ...counts, 'coin-half': '2' }, true).ticks, 448n);
});

test('rejects non-integer and overlong denomination counts with the offending field', () => {
  for (const count of ['abc', '-1', '1.5', '1,000', '9'.repeat(13)]) {
    const result = makeup.sumDenominationCounts({ 'note-100': count }, false);
    assert.equal(result.ok, false, `count should be rejected: ${JSON.stringify(count)}`);
    assert.equal(result.field, 'note-100');
    assert.match(result.error, /數量請輸入/);
  }

  const maximum = makeup.sumDenominationCounts({ 'note-100': '999999999999' }, false);
  assert.equal(maximum.ok, true);
  assert.equal(maximum.ticks, 199999999999800n);
});

test('treats an empty denomination count as zero and identifies disabled half-dollar counts', () => {
  assert.equal(makeup.sumDenominationCounts({ 'note-100': '' }, false).ticks, 0n);
  const half = makeup.sumDenominationCounts({ 'coin-half': '1' }, false);
  assert.equal(half.ok, false);
  assert.equal(half.field, 'coin-half');
  assert.match(half.error, /請開啟「計算 5 角」/);
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
