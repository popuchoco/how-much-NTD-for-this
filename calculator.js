(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NTDCalculator = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => api.mount(document), { once: true });
    } else {
      api.mount(document);
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SETTINGS_KEY = 'cash-how-to-split.preferences.v1';
  const MAX_AMOUNT_TWD = 200000;
  const MAX_CHANGE_TWD = 20;
  const MAX_CHANGE_TICKS = MAX_CHANGE_TWD * 2;
  const LIST_LIMIT = 100;
  const MAX_LIST_LIMIT = 500;
  const DP_INFINITY = 0x3fffffff;
  const CALCULATION_DEBOUNCE_MS = 140;
  const DENOMINATIONS = [
    { id: 'note-2000', kind: 'note', value: 2000, ticks: 4000, label: '$2,000', type: '鈔' },
    { id: 'note-1000', kind: 'note', value: 1000, ticks: 2000, label: '$1,000', type: '鈔' },
    { id: 'note-500', kind: 'note', value: 500, ticks: 1000, label: '$500', type: '鈔' },
    { id: 'note-200', kind: 'note', value: 200, ticks: 400, label: '$200', type: '鈔' },
    { id: 'note-100', kind: 'note', value: 100, ticks: 200, label: '$100', type: '鈔' },
    { id: 'coin-50', kind: 'coin', value: 50, ticks: 100, label: '$50', type: '幣' },
    { id: 'coin-20', kind: 'coin', value: 20, ticks: 40, label: '$20', type: '幣' },
    { id: 'coin-10', kind: 'coin', value: 10, ticks: 20, label: '$10', type: '幣' },
    { id: 'coin-5', kind: 'coin', value: 5, ticks: 10, label: '$5', type: '幣' },
    { id: 'coin-1', kind: 'coin', value: 1, ticks: 2, label: '$1', type: '幣' },
    { id: 'coin-half', kind: 'coin', value: 0.5, ticks: 1, label: '$0.5', type: '幣' },
  ];
  const DEFAULT_SELECTED = DENOMINATIONS.filter((denom) => denom.id !== 'coin-half').map((denom) => denom.id);

  function gcd(a, b) {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y) [x, y] = [y, x % y];
    return x;
  }

  function parseAmount(raw, allowHalf, maximum = MAX_AMOUNT_TWD) {
    const input = String(raw ?? '').trim();
    if (!input) return { ok: false, reason: '請先輸入金額。' };
    const grouped = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.5)?$/;
    const wholeOnly = /^(?:\d{1,3}(?:,\d{3})+|\d+)$/;
    if (!(allowHalf ? grouped : wholeOnly).test(input)) {
      return { ok: false, reason: allowHalf ? '請輸入整數或以 .5 結尾的金額。' : '目前未啟用 5 角，請輸入整數金額。' };
    }
    const normalized = input.replaceAll(',', '');
    const [wholePart, decimalPart = ''] = normalized.split('.');
    const whole = Number(wholePart);
    if (!Number.isSafeInteger(whole) || whole * 2 + (decimalPart ? 1 : 0) > maximum * 2) {
      return { ok: false, reason: `單筆金額上限為 NT$${maximum.toLocaleString('zh-TW')}。` };
    }
    const ticks = whole * 2 + (decimalPart ? 1 : 0);
    if (ticks <= 0) return { ok: false, reason: '金額需大於 0。' };
    return { ok: true, ticks, whole, half: Boolean(decimalPart) };
  }

  function denominationChoices(selection, mode, halfEnabled) {
    const selected = selection instanceof Set ? selection : new Set(selection || []);
    return DENOMINATIONS.filter((denom) => {
      if (!selected.has(denom.id)) return false;
      if (denom.id === 'coin-half' && !halfEnabled) return false;
      if (mode === 'notes' && denom.kind !== 'note') return false;
      if (mode === 'coins' && denom.kind !== 'coin') return false;
      return true;
    });
  }

  function syncHalfDollarSelection(preferences) {
    if (preferences.halfEnabled) preferences.selected.add('coin-half');
    else preferences.selected.delete('coin-half');
    return preferences;
  }

  function createCombinationTable(maxTicks, denoms) {
    if (!denoms.length || maxTicks < 0) return { count: () => 0n };
    const common = denoms.reduce((value, denom) => gcd(value, denom.ticks), 0);
    const maxTarget = Math.floor(maxTicks / common);
    const values = denoms.map((denom) => denom.ticks / common).sort((a, b) => a - b);
    const ways = new Array(maxTarget + 1).fill(0n);
    ways[0] = 1n;
    for (const value of values) {
      for (let amount = value; amount <= maxTarget; amount += 1) ways[amount] += ways[amount - value];
    }
    return {
      count(targetTicks) {
        if (targetTicks < 0 || targetTicks % common !== 0) return 0n;
        const target = targetTicks / common;
        return target <= maxTarget ? ways[target] : 0n;
      },
    };
  }

  function countCombinations(targetTicks, denoms) {
    if (targetTicks < 0 || !denoms.length) return 0n;
    return createCombinationTable(targetTicks, denoms).count(targetTicks);
  }

  function createExtremeSolver(maxTicks, denoms) {
    if (!denoms.length || maxTicks < 0) return () => null;
    const common = denoms.reduce((value, denom) => gcd(value, denom.ticks), 0);
    const maxTarget = Math.floor(maxTicks / common);
    const values = denoms.map((denom) => ({ ...denom, scaled: denom.ticks / common }));
    const fewestPieces = new Int32Array(maxTarget + 1);
    const fewestNotes = new Int32Array(maxTarget + 1);
    const mostCoins = new Int32Array(maxTarget + 1);
    const prevFewestPieces = new Int32Array(maxTarget + 1);
    const prevFewestNotes = new Int32Array(maxTarget + 1);
    const prevMostCoins = new Int32Array(maxTarget + 1);
    fewestPieces.fill(DP_INFINITY);
    fewestNotes.fill(DP_INFINITY);
    mostCoins.fill(-1);
    fewestPieces[0] = 0;
    fewestNotes[0] = 0;
    mostCoins[0] = 0;

    for (const denom of values) {
      for (let amount = denom.scaled; amount <= maxTarget; amount += 1) {
        const prior = amount - denom.scaled;
        if (fewestPieces[prior] !== DP_INFINITY && fewestPieces[prior] + 1 < fewestPieces[amount]) {
          fewestPieces[amount] = fewestPieces[prior] + 1;
          prevFewestPieces[amount] = denom.scaled;
        }
        const noteCost = denom.kind === 'note' ? 1 : 0;
        const notesCandidate = fewestNotes[prior] + noteCost;
        if (fewestNotes[prior] !== DP_INFINITY && (notesCandidate < fewestNotes[amount] || (notesCandidate === fewestNotes[amount] && !prevFewestNotes[amount]))) {
          fewestNotes[amount] = notesCandidate;
          prevFewestNotes[amount] = denom.scaled;
        }
        const coinCost = denom.kind === 'coin' ? 1 : 0;
        const coinsCandidate = mostCoins[prior] + coinCost;
        if (mostCoins[prior] >= 0 && (coinsCandidate > mostCoins[amount] || (coinsCandidate === mostCoins[amount] && !prevMostCoins[amount]))) {
          mostCoins[amount] = coinsCandidate;
          prevMostCoins[amount] = denom.scaled;
        }
      }
    }

    const byScaledValue = new Map(values.map((denom) => [denom.scaled, denom.id]));
    function reconstruct(predecessors, target, reachable) {
      if (!reachable) return null;
      const counts = Object.fromEntries(denoms.map((denom) => [denom.id, 0]));
      let remaining = target;
      while (remaining > 0) {
        const value = predecessors[remaining];
        if (!value || value > remaining || !byScaledValue.has(value)) return null;
        counts[byScaledValue.get(value)] += 1;
        remaining -= value;
      }
      return counts;
    }

    return function solve(targetTicks) {
      if (targetTicks < 0 || targetTicks % common !== 0) return null;
      const target = targetTicks / common;
      if (target > maxTarget || fewestPieces[target] === DP_INFINITY) return null;
      return {
        fewestPieces: reconstruct(prevFewestPieces, target, true),
        fewestNotes: reconstruct(prevFewestNotes, target, fewestNotes[target] !== DP_INFINITY),
        mostCoins: reconstruct(prevMostCoins, target, mostCoins[target] >= 0),
      };
    };
  }

  function buildExtremes(targetTicks, denoms) {
    return createExtremeSolver(targetTicks, denoms)(targetTicks);
  }

  function countSummary(counts, denoms) {
    let pieces = 0;
    let notes = 0;
    let coins = 0;
    for (const denom of denoms) {
      const count = counts[denom.id] || 0;
      pieces += count;
      if (denom.kind === 'note') notes += count;
      else coins += count;
    }
    return { pieces, notes, coins };
  }

  function createSolutions(targetTicks, denoms, exactCount, limit = LIST_LIMIT) {
    const overflow = exactCount > BigInt(limit);
    const ordered = [...denoms].sort((a, b) => b.ticks - a.ticks || a.id.localeCompare(b.id));
    const common = ordered.reduce((value, denom) => gcd(value, denom.ticks), 0);
    if (targetTicks % common !== 0) return [];
    const target = targetTicks / common;
    const scaled = ordered.map((denom) => ({ ...denom, scaled: denom.ticks / common }));
    const counts = Object.fromEntries(ordered.map((denom) => [denom.id, 0]));
    const result = [];
    let stopped = false;

    function visit(index, remaining) {
      if (stopped) return;
      if (index === scaled.length - 1) {
        const denom = scaled[index];
        if (remaining % denom.scaled !== 0) return;
        const count = remaining / denom.scaled;
        counts[denom.id] = count;
        result.push({ ...counts });
        counts[denom.id] = 0;
        if (result.length >= limit && overflow) stopped = true;
        return;
      }
      const denom = scaled[index];
      const maximum = Math.floor(remaining / denom.scaled);
      for (let count = maximum; count >= 0; count -= 1) {
        counts[denom.id] = count;
        visit(index + 1, remaining - count * denom.scaled);
        if (stopped) break;
      }
      counts[denom.id] = 0;
    }

    if (scaled.length) visit(0, target);
    return result.map((solution) => ({ counts: solution, summary: countSummary(solution, denoms) }));
  }

  function rankSolutions(solutions) {
    return [...solutions].sort((a, b) => {
      if (a.summary.pieces !== b.summary.pieces) return a.summary.pieces - b.summary.pieces;
      if (a.summary.notes !== b.summary.notes) return a.summary.notes - b.summary.notes;
      if (a.summary.coins !== b.summary.coins) return b.summary.coins - a.summary.coins;
      return 0;
    });
  }

  function calculateExactly(parsed, denoms, listLimit, allowChange = false) {
    if (!denoms.length) {
      return {
        ok: true,
        parsed,
        denoms,
        ways: 0n,
        solutions: [],
        extremes: null,
        truncated: false,
        allowChange,
        noSolutionReason: '目前沒有可用面額，請選擇至少一種紙鈔或硬幣。',
      };
    }
    const commonUnitTicks = denoms.reduce((value, denom) => gcd(value, denom.ticks), 0);
    if (parsed.ticks % commonUnitTicks !== 0) {
      const commonUnit = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 }).format(commonUnitTicks / 2);
      return {
        ok: true,
        parsed,
        denoms,
        ways: 0n,
        solutions: [],
        extremes: null,
        truncated: false,
        allowChange,
        noSolutionReason: `目前面額的共同單位為 NT$${commonUnit}，無法整除這筆金額；請啟用更小面額或 5 角。`,
      };
    }
    const ways = countCombinations(parsed.ticks, denoms);
    if (ways === 0n) {
      return {
        ok: true,
        parsed,
        denoms,
        ways,
        solutions: [],
        extremes: null,
        truncated: false,
        allowChange,
        noSolutionReason: '這些面額的共同單位可整除該金額，但仍無法以目前面額組成；請加入較小面額。',
      };
    }
    const extremes = buildExtremes(parsed.ticks, denoms);
    const solutions = createSolutions(parsed.ticks, denoms, ways, listLimit);
    return { ok: true, parsed, denoms, ways, solutions: rankSolutions(solutions), extremes, truncated: ways > BigInt(listLimit), allowChange };
  }

  function calculateAllowingChange(parsed, denoms, listLimit) {
    const maximumPaymentTicks = parsed.ticks + MAX_CHANGE_TICKS;
    const countsAt = createCombinationTable(maximumPaymentTicks, denoms);
    const extremesAt = createExtremeSolver(maximumPaymentTicks, denoms);
    const payableTotals = [];
    let ways = 0n;

    for (let changeTicks = 0; changeTicks <= MAX_CHANGE_TICKS; changeTicks += 1) {
      const paymentTicks = parsed.ticks + changeTicks;
      const count = countsAt.count(paymentTicks);
      if (count === 0n) continue;
      const extremes = extremesAt(paymentTicks);
      if (!extremes) continue;
      payableTotals.push({ paymentTicks, changeTicks, ways: count, extremes });
      ways += count;
    }

    if (!payableTotals.length) {
      return {
        ok: true,
        parsed,
        denoms,
        ways: 0n,
        solutions: [],
        extremes: null,
        truncated: false,
        allowChange: true,
        maxChangeTicks: MAX_CHANGE_TICKS,
        noSolutionReason: `目前選取的面額在找零上限 NT$${MAX_CHANGE_TWD} 內仍無可用的付款組合；可重新選擇面額或切換使用方式。`,
      };
    }

    const solutions = [];
    for (const payable of payableTotals) {
      if (solutions.length >= listLimit) break;
      const rows = rankSolutions(createSolutions(payable.paymentTicks, denoms, payable.ways, listLimit));
      for (const solution of rows) {
        if (solutions.length >= listLimit) break;
        solutions.push({ ...solution, paymentTicks: payable.paymentTicks, changeTicks: payable.changeTicks });
      }
    }

    return {
      ok: true,
      parsed,
      denoms,
      ways,
      solutions,
      extremes: payableTotals[0].extremes,
      truncated: ways > BigInt(solutions.length),
      allowChange: true,
      maxChangeTicks: MAX_CHANGE_TICKS,
      bestPaymentTicks: payableTotals[0].paymentTicks,
    };
  }

  function calculate({ amount, allowHalf, mode = 'all', selection = DEFAULT_SELECTED, listLimit = LIST_LIMIT, allowChange = false }) {
    const parsed = parseAmount(amount, allowHalf);
    if (!parsed.ok) return { ok: false, error: parsed.reason };
    const denoms = denominationChoices(selection, mode, allowHalf);
    return allowChange
      ? calculateAllowingChange(parsed, denoms, listLimit)
      : calculateExactly(parsed, denoms, listLimit);
  }

  function mount(doc) {
    if (!doc || doc.getElementById('calculator-form')?.dataset.mounted === 'true') return;
    const form = doc.getElementById('calculator-form');
    const amountInput = doc.getElementById('amount');
    const error = doc.getElementById('amount-error');
    const noteContainer = doc.getElementById('note-denominations');
    const coinContainer = doc.getElementById('coin-denominations');
    const resultPanel = doc.querySelector('.results-panel');
    if (!form || !amountInput || !noteContainer || !coinContainer) return;
    form.dataset.mounted = 'true';

    let preferences = readPreferences();
    let visibleLimit = LIST_LIMIT;
    let debounceTimer;

    function readPreferences() {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { selected: new Set(DEFAULT_SELECTED), halfEnabled: false, mode: 'all', allowChange: false };
        const stored = JSON.parse(raw);
        const valid = Array.isArray(stored.selected) ? stored.selected.filter((id) => DENOMINATIONS.some((denom) => denom.id === id)) : DEFAULT_SELECTED;
        const selected = new Set(valid);
        if (!selected.size) DEFAULT_SELECTED.forEach((id) => selected.add(id));
        return syncHalfDollarSelection({
          selected,
          halfEnabled: Boolean(stored.halfEnabled),
          mode: ['all', 'notes', 'coins'].includes(stored.mode) ? stored.mode : 'all',
          allowChange: Boolean(stored.allowChange),
        });
      } catch {
        return { selected: new Set(DEFAULT_SELECTED), halfEnabled: false, mode: 'all', allowChange: false };
      }
    }

    function savePreferences() {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({
          selected: [...preferences.selected],
          halfEnabled: preferences.halfEnabled,
          mode: preferences.mode,
          allowChange: preferences.allowChange,
        }));
      } catch { /* Storage can be unavailable in private browsing; calculation remains usable. */ }
    }

    function renderDenominationOptions() {
      const renderGroup = (group, target) => {
        target.replaceChildren();
        for (const denom of DENOMINATIONS.filter((item) => item.kind === group && item.id !== 'coin-half')) {
          const label = doc.createElement('label');
          label.className = 'denomination-chip';
          const input = doc.createElement('input');
          input.type = 'checkbox';
          input.value = denom.id;
          input.checked = preferences.selected.has(denom.id);
          input.setAttribute('aria-label', `${group === 'note' ? '紙鈔' : '硬幣'} ${denom.value} 元`);
          input.addEventListener('change', () => {
            if (input.checked) preferences.selected.add(denom.id);
            else preferences.selected.delete(denom.id);
            updateSelectionSummary();
            savePreferences();
            scheduleCalculation(false);
          });
          const icon = createMoneyIcon(denom, 'money-icon');
          if (denom.kind === 'coin') icon.classList.add('coin-icon');
          const text = doc.createElement('span');
          text.textContent = denom.label;
          label.append(input, icon, text);
          target.append(label);
        }
      };
      renderGroup('note', noteContainer);
      renderGroup('coin', coinContainer);
      updateSelectionSummary();
    }

    function updateSelectionSummary() {
      const notes = DENOMINATIONS.filter((denom) => denom.kind === 'note' && preferences.selected.has(denom.id)).length;
      const coins = DENOMINATIONS.filter((denom) => denom.kind === 'coin' && denom.id !== 'coin-half' && preferences.selected.has(denom.id)).length;
      doc.getElementById('selection-summary').textContent = `${notes} 種鈔票・${coins + (preferences.halfEnabled ? 1 : 0)} 種硬幣`;
    }

    function currentOptions() {
      return {
        amount: amountInput.value,
        allowHalf: preferences.halfEnabled,
        mode: preferences.mode,
        selection: preferences.selected,
        listLimit: visibleLimit,
        allowChange: preferences.allowChange,
      };
    }

    function formatCurrency(ticks) {
      const value = ticks / 2;
      return `NT$${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 }).format(value)}`;
    }

    function solutionSignature(counts, denoms) {
      return denoms.map((denom) => `${denom.id}:${counts[denom.id] || 0}`).join('|');
    }

    function createMoneyIcon(denom, className = 'money-icon') {
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', denom.kind === 'note' ? '0 0 138 80' : '0 0 64 64');
      svg.setAttribute('focusable', 'false');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('class', className);
      const use = doc.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `./assets/cash-icons.svg#${denom.id}`);
      svg.append(use);
      return svg;
    }

    function describeCounts(counts, denoms) {
      return denoms.filter((denom) => counts[denom.id] > 0).map((denom) => `${denom.label} × ${counts[denom.id]} ${denom.type}`).join('、') || '無需找零';
    }

    function makeBreakdown(counts, denoms) {
      const fragment = doc.createDocumentFragment();
      for (const denom of denoms) {
        const count = counts[denom.id] || 0;
        if (!count) continue;
        const token = doc.createElement('span');
        token.className = `denom-token${denom.kind === 'note' ? ' note' : ''}`;
        token.append(createMoneyIcon(denom, `money-icon${denom.kind === 'coin' ? ' coin-icon' : ''}`));
        const amount = doc.createElement('strong');
        amount.textContent = `${count}×`;
        token.append(amount, doc.createTextNode(`${denom.label} ${denom.type}`));
        fragment.append(token);
      }
      return fragment;
    }

    function renderExtreme(container, label, mark, counts, denoms, measure, unit, primary = false, paymentInfo = '') {
      const summary = countSummary(counts, denoms);
      const card = doc.createElement('article');
      card.className = `extreme-card${primary ? ' primary' : ''}`;
      const title = doc.createElement('div');
      title.className = 'extreme-label';
      const marker = doc.createElement('span');
      marker.className = 'label-mark';
      marker.textContent = mark;
      const titleText = doc.createElement('span');
      titleText.textContent = label;
      title.append(marker, titleText);
      const total = doc.createElement('p');
      total.className = 'extreme-total';
      total.append(`${summary[measure]}`, Object.assign(doc.createElement('small'), { textContent: unit }));
      const detail = doc.createElement('p');
      detail.className = 'extreme-detail';
      detail.textContent = describeCounts(counts, denoms);
      card.append(title, total, detail);
      if (paymentInfo) {
        const payment = doc.createElement('p');
        payment.className = 'extreme-payment';
        payment.textContent = paymentInfo;
        card.append(payment);
      }
      container.append(card);
    }

    function renderResult(result) {
      const empty = doc.getElementById('empty-state');
      const content = doc.getElementById('result-content');
      const noSolution = doc.getElementById('no-solution');
      const status = doc.getElementById('result-status');
      const errorMessage = result?.ok === false ? result.error : '';
      error.textContent = errorMessage;
      error.hidden = !errorMessage;
      if (result?.ok === false || !result) {
        empty.hidden = false;
        content.hidden = true;
        noSolution.hidden = true;
        status.classList.remove('is-ready');
        status.lastChild.textContent = errorMessage ? '檢查金額' : '等待金額';
        resultPanel.setAttribute('aria-busy', 'false');
        return;
      }
      if (result.ways === 0n) {
        empty.hidden = true;
        content.hidden = true;
        noSolution.hidden = false;
        doc.getElementById('no-solution-title').textContent = result.allowChange
          ? '找零上限內沒有可用付款組合'
          : '目前的面額無法剛好湊出';
        doc.getElementById('no-solution-message').textContent = result.noSolutionReason || '請試著開啟更小的面額，或切換紙鈔與硬幣的使用方式。';
        status.classList.remove('is-ready');
        status.lastChild.textContent = result.allowChange ? '找零上限內無解' : '無法精確湊出';
        resultPanel.setAttribute('aria-busy', 'false');
        return;
      }

      empty.hidden = true;
      noSolution.hidden = true;
      content.hidden = false;
      status.classList.add('is-ready');
      status.lastChild.textContent = result.allowChange ? '已找到付款組合' : '完成計算';
      doc.getElementById('result-label').textContent = result.allowChange ? '目標金額' : '拆分金額';
      doc.getElementById('result-amount').textContent = formatCurrency(result.parsed.ticks);
      doc.getElementById('combination-count').textContent = `${result.ways.toLocaleString('zh-TW')} 種組合`;
      const modeNote = doc.getElementById('result-mode-note');
      modeNote.hidden = !result.allowChange;
      modeNote.textContent = result.allowChange
        ? `最多可找零 NT$${MAX_CHANGE_TWD}；配法依找零金額由少到多排列，付剛好優先。代表解以找零最少的付款額計算。`
        : '';

      const extremes = doc.getElementById('extremes');
      extremes.replaceChildren();
      const fewestSignature = solutionSignature(result.extremes.fewestPieces, result.denoms);
      const mostCoinsSignature = solutionSignature(result.extremes.mostCoins, result.denoms);
      const fewestNotesSignature = solutionSignature(result.extremes.fewestNotes, result.denoms);
      const paymentInfo = result.allowChange
        ? `支付 ${formatCurrency(result.bestPaymentTicks)}・找零 ${formatCurrency(result.bestPaymentTicks - result.parsed.ticks)}`
        : '';
      renderExtreme(extremes, '最小解・件數最少', '少', result.extremes.fewestPieces, result.denoms, 'pieces', '件', true, paymentInfo);
      renderExtreme(extremes, '硬幣最多', '幣', result.extremes.mostCoins, result.denoms, 'coins', '枚', false, paymentInfo);
      renderExtreme(extremes, '最大解・紙鈔最少', '鈔', result.extremes.fewestNotes, result.denoms, 'notes', '張', false, paymentInfo);

      const list = doc.getElementById('combination-list');
      list.replaceChildren();
      const displayDenoms = [...result.denoms].sort((a, b) => b.ticks - a.ticks);
      result.solutions.forEach((solution, index) => {
        const signature = solutionSignature(solution.counts, result.denoms);
        const isRepresentative = signature === fewestSignature || signature === mostCoinsSignature || signature === fewestNotesSignature;
        const row = doc.createElement('article');
        row.className = `combination-row${isRepresentative ? ' best' : ''}`;
        const number = doc.createElement('span');
        number.className = 'row-number';
        number.textContent = String(index + 1).padStart(2, '0');
        const body = doc.createElement('div');
        body.className = 'row-body';
        const summary = doc.createElement('div');
        summary.className = 'row-summary';
        const pieces = doc.createElement('span');
        pieces.className = 'piece-total';
        pieces.textContent = `${solution.summary.pieces} 件`;
        const split = doc.createElement('span');
        split.className = 'piece-split';
        split.textContent = `${solution.summary.notes} 張紙鈔，${solution.summary.coins} 枚硬幣`;
        summary.append(pieces, split);
        const breakdown = doc.createElement('div');
        breakdown.className = 'row-breakdown';
        breakdown.append(makeBreakdown(solution.counts, displayDenoms));
        body.append(summary, breakdown);
        const value = doc.createElement('span');
        value.className = `row-value${result.allowChange ? ' row-value-change' : ''}`;
        if (result.allowChange) {
          const payment = doc.createElement('strong');
          payment.textContent = `支付 ${formatCurrency(solution.paymentTicks)}`;
          const change = doc.createElement('span');
          change.textContent = `找零 ${formatCurrency(solution.changeTicks)}`;
          value.append(payment, change);
        } else {
          value.textContent = formatCurrency(result.parsed.ticks);
        }
        row.append(number, body, value);
        list.append(row);
      });

      const countText = result.ways.toLocaleString('zh-TW');
      doc.getElementById('list-count').textContent = `${result.solutions.length.toLocaleString('zh-TW')} / ${countText} 組`;
      doc.getElementById('list-caption').textContent = result.allowChange
        ? '依找零金額由少到多排列；付剛好優先，同找零再按件數排序'
        : result.truncated ? '依面額由大到小列出可見組合' : '依總件數由少到多排列';
      const note = doc.getElementById('truncation-note');
      note.hidden = !result.truncated;
      const loadMore = doc.getElementById('load-more');
      const reachedDisplayLimit = result.solutions.length >= MAX_LIST_LIMIT;
      note.textContent = result.truncated
        ? reachedDisplayLimit
          ? `${result.allowChange ? `找零上限 NT$${MAX_CHANGE_TWD} 內共有 ${countText} 種付款組合` : `共有 ${countText} 種精確組合`}；為保持頁面流暢，明細最多載入 ${MAX_LIST_LIMIT.toLocaleString('zh-TW')} 種。可取消部分面額篩選，縮小組合範圍。代表解仍依計算結果完整範圍計算。`
          : `${result.allowChange ? `找零上限 NT$${MAX_CHANGE_TWD} 內共有 ${countText} 種付款組合` : `共有 ${countText} 種精確組合`}，目前顯示 ${result.solutions.length.toLocaleString('zh-TW')} 種。代表解仍依計算結果完整範圍計算。`
        : '';
      loadMore.hidden = !result.truncated || reachedDisplayLimit;
      loadMore.textContent = `再顯示 100 組（${result.solutions.length.toLocaleString('zh-TW')} / ${countText}）`;
      resultPanel.setAttribute('aria-busy', 'false');
    }

    function calculateNow(showError) {
      const raw = amountInput.value.trim();
      if (!raw) {
        renderResult(null);
        return;
      }
      const result = calculate(currentOptions());
      if (!result.ok && !showError) {
        renderResult(null);
        error.textContent = '';
        error.hidden = true;
        return;
      }
      renderResult(result);
    }

    function scheduleCalculation(showError, resetList = false) {
      clearTimeout(debounceTimer);
      if (resetList) visibleLimit = LIST_LIMIT;
      debounceTimer = setTimeout(() => calculateNow(showError), CALCULATION_DEBOUNCE_MS);
    }

    renderDenominationOptions();
    doc.getElementById('half-dollar').checked = preferences.halfEnabled;
    const modeControl = form.querySelector(`input[name="mode"][value="${preferences.mode}"]`);
    if (modeControl) modeControl.checked = true;
    form.querySelectorAll('input[name="payment-scenario"]').forEach((control) => {
      control.checked = (control.value === 'consumer') === preferences.allowChange;
      control.addEventListener('change', () => {
        preferences.allowChange = control.value === 'consumer';
        savePreferences();
        scheduleCalculation(true, true);
      });
    });

    amountInput.addEventListener('input', () => scheduleCalculation(false, true));
    amountInput.addEventListener('blur', () => {
      const parsed = parseAmount(amountInput.value, preferences.halfEnabled);
      if (parsed.ok) amountInput.value = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 }).format(parsed.ticks / 2);
    });
    doc.getElementById('half-dollar').addEventListener('change', (event) => {
      preferences.halfEnabled = event.currentTarget.checked;
      syncHalfDollarSelection(preferences);
      updateSelectionSummary();
      savePreferences();
      scheduleCalculation(true, true);
    });
    form.querySelectorAll('input[name="mode"]').forEach((control) => {
      control.addEventListener('change', () => {
        preferences.mode = control.value;
        savePreferences();
        scheduleCalculation(true, true);
      });
    });
    doc.querySelectorAll('[data-select-group], [data-clear-group]').forEach((button) => {
      button.addEventListener('click', () => {
        const group = button.dataset.selectGroup || button.dataset.clearGroup;
        const shouldSelect = Boolean(button.dataset.selectGroup);
        const kind = group === 'notes' ? 'note' : 'coin';
        DENOMINATIONS.filter((denom) => denom.kind === kind && denom.id !== 'coin-half').forEach((denom) => {
          if (shouldSelect) preferences.selected.add(denom.id);
          else preferences.selected.delete(denom.id);
        });
        renderDenominationOptions();
        savePreferences();
        scheduleCalculation(true, true);
      });
    });
    doc.getElementById('load-more').addEventListener('click', () => {
      visibleLimit = Math.min(visibleLimit + LIST_LIMIT, MAX_LIST_LIMIT);
      calculateNow(true);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      visibleLimit = LIST_LIMIT;
      calculateNow(true);
    });

    const linkedAmount = new URLSearchParams(doc.defaultView?.location?.search || '').get('amount');
    if (linkedAmount) {
      const parsed = parseAmount(linkedAmount, preferences.halfEnabled);
      if (parsed.ok) {
        amountInput.value = parsed.half ? `${parsed.whole}.5` : String(parsed.whole);
        calculateNow(false);
      }
    }
  }

  return {
    DENOMINATIONS,
    DEFAULT_SELECTED,
    MAX_AMOUNT_TWD,
    MAX_CHANGE_TWD,
    LIST_LIMIT,
    MAX_LIST_LIMIT,
    parseAmount,
    denominationChoices,
    syncHalfDollarSelection,
    countCombinations,
    buildExtremes,
    createSolutions,
    calculate,
    mount,
  };
});
