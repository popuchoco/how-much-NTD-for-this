(function (root, factory) {
  const calculator = typeof module === 'object' && module.exports ? require('./calculator.js') : root.NTDCalculator;
  const api = factory(calculator);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NTDMakeUp = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => api.mount(document), { once: true });
    else api.mount(document);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (calculator) {
  'use strict';

  const LIST_LIMIT = 100;
  const MAX_LIST_LIMIT = 500;
  const INPUT_AMOUNT_PATTERN = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.5)?$/;
  const WHOLE_AMOUNT_PATTERN = /^(?:\d{1,3}(?:,\d{3})+|\d+)$/;

  function parseInventoryAmount(raw, allowHalf) {
    const rawInput = String(raw ?? '').trim();
    const input = allowHalf && rawInput === '.5' ? '0.5' : rawInput;
    if (input === '0') return { ok: true, ticks: 0n };
    const pattern = allowHalf ? INPUT_AMOUNT_PATTERN : WHOLE_AMOUNT_PATTERN;
    if (!pattern.test(input)) {
      return { ok: false, error: allowHalf ? '請輸入整數或以 .5 結尾的金額；沒有持有金額可填 0。' : '請輸入整數金額；沒有持有金額可填 0。' };
    }
    const normalized = input.replaceAll(',', '');
    const [wholePart, fractionalPart = ''] = normalized.split('.');
    return { ok: true, ticks: BigInt(wholePart) * 2n + (fractionalPart ? 1n : 0n) };
  }

  function sumDenominationCounts(counts, allowHalf) {
    let ticks = 0n;
    const normalizedCounts = {};
    for (const denom of calculator.DENOMINATIONS) {
      const raw = String(counts?.[denom.id] ?? '0').trim() || '0';
      if (!/^\d{1,12}$/.test(raw)) {
        return { ok: false, error: `${denom.label}數量請輸入 0 至 999,999,999,999 的整數。`, field: denom.id };
      }
      const count = BigInt(raw);
      if (denom.id === 'coin-half' && !allowHalf && count > 0n) {
        return { ok: false, error: '輸入了 5 角數量；請開啟「計算 5 角」後再試。', field: denom.id };
      }
      ticks += count * BigInt(denom.ticks);
      normalizedCounts[denom.id] = count;
    }
    return { ok: true, ticks, counts: normalizedCounts };
  }

  function ticksToAmountInput(ticks) {
    const whole = ticks / 2n;
    return ticks % 2n ? `${whole}.5` : String(whole);
  }

  function normalizeListLimit(value) {
    let parsed;
    try {
      parsed = Number(value);
    } catch {
      return LIST_LIMIT;
    }
    if (!Number.isFinite(parsed)) return LIST_LIMIT;
    return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(parsed)));
  }

  function calculateTopUp(options = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const {
      target,
      inventoryMethod = 'total',
      currentAmount = '0',
      counts = {},
      allowHalf = false,
      mode = 'all',
      listLimit = LIST_LIMIT,
    } = safeOptions;
    const parsedTarget = calculator.parseAmount(target, allowHalf);
    if (!parsedTarget.ok) return { ok: false, error: parsedTarget.reason, field: 'target' };
    const targetTicks = BigInt(parsedTarget.ticks);
    let currentTicks;
    if (inventoryMethod === 'denominations') {
      const total = sumDenominationCounts(counts, allowHalf);
      if (!total.ok) return total;
      currentTicks = total.ticks;
    } else {
      const parsedCurrent = parseInventoryAmount(currentAmount, allowHalf);
      if (!parsedCurrent.ok) return { ...parsedCurrent, field: 'current-amount' };
      currentTicks = parsedCurrent.ticks;
    }

    if (currentTicks >= targetTicks) {
      return {
        ok: true,
        status: currentTicks === targetTicks ? 'exact' : 'surplus',
        targetTicks,
        currentTicks,
        remainingTicks: 0n,
        surplusTicks: currentTicks - targetTicks,
      };
    }

    const remainingTicks = targetTicks - currentTicks;
    const selection = new Set(calculator.DEFAULT_SELECTED);
    if (allowHalf) selection.add('coin-half');
    const calculation = calculator.calculate({
      amount: ticksToAmountInput(remainingTicks),
      allowHalf,
      mode: ['all', 'notes', 'coins'].includes(mode) ? mode : 'all',
      selection,
      listLimit: normalizeListLimit(listLimit),
    });
    if (!calculation.ok) return { ok: false, error: calculation.error, field: 'target' };
    return { ok: true, status: 'needs-more', targetTicks, currentTicks, remainingTicks, calculation };
  }

  function mount(doc) {
    const form = doc?.getElementById('makeup-form');
    if (!form || form.dataset.mounted === 'true') return;
    form.dataset.mounted = 'true';

    const targetInput = doc.getElementById('makeup-target');
    const currentInput = doc.getElementById('makeup-current-total');
    const inventoryMethodInputs = [...form.querySelectorAll('input[name="inventory-method"]')];
    const modeInputs = [...form.querySelectorAll('input[name="makeup-mode"]')];
    const allowHalfInput = doc.getElementById('makeup-half-dollar');
    const inventoryTotalPanel = doc.getElementById('inventory-total-panel');
    const inventoryCountsPanel = doc.getElementById('inventory-counts-panel');
    const inventoryCounts = doc.getElementById('inventory-counts');
    const resultPanel = doc.getElementById('makeup-results-panel');
    const status = doc.getElementById('makeup-status');
    const targetError = doc.getElementById('makeup-target-error');
    const inventoryError = doc.getElementById('makeup-inventory-error');

    let visibleLimit = LIST_LIMIT;
    let lastResult = null;

    function currentInventoryMethod() {
      return inventoryMethodInputs.find((input) => input.checked)?.value || 'total';
    }

    function currentMode() {
      return modeInputs.find((input) => input.checked)?.value || 'all';
    }

    function clearErrors() {
      targetError.hidden = true;
      targetError.textContent = '';
      inventoryError.hidden = true;
      inventoryError.textContent = '';
      targetInput.removeAttribute('aria-invalid');
      currentInput.removeAttribute('aria-invalid');
      inventoryCounts.removeAttribute('aria-invalid');
      inventoryCounts.querySelectorAll('input').forEach((input) => input.removeAttribute('aria-invalid'));
    }

    function setInputPanels() {
      const method = currentInventoryMethod();
      inventoryTotalPanel.hidden = method !== 'total';
      inventoryCountsPanel.hidden = method !== 'denominations';
    }

    function updateHalfCountRow() {
      const halfCountRow = doc.getElementById('coin-half-count-row');
      const halfInput = doc.getElementById('count-coin-half');
      if (!halfCountRow || !halfInput) return;
      halfCountRow.hidden = !allowHalfInput.checked;
      halfInput.disabled = !allowHalfInput.checked;
      if (!allowHalfInput.checked) halfInput.value = '0';
    }

    function formatCurrency(ticks) {
      const value = typeof ticks === 'bigint' ? ticks : BigInt(ticks);
      const whole = value / 2n;
      return `NT$${whole.toLocaleString('zh-TW')}${value % 2n ? '.5' : ''}`;
    }

    function clearResult(message = '等待輸入') {
      lastResult = null;
      doc.getElementById('makeup-empty-state').hidden = false;
      doc.getElementById('makeup-result-content').hidden = true;
      status.lastChild.textContent = message;
      resultPanel.setAttribute('aria-busy', 'false');
    }

    function markDirty() {
      clearErrors();
      clearResult('輸入已變更，請重新計算');
    }

    function displayError(result) {
      clearResult('請檢查輸入');
      if (result.field === 'target') {
        targetError.textContent = result.error;
        targetError.hidden = false;
        targetInput.setAttribute('aria-invalid', 'true');
        targetInput.focus();
      } else {
        inventoryError.textContent = result.error;
        inventoryError.hidden = false;
        inventoryCountsPanel.hidden = currentInventoryMethod() !== 'denominations';
        if (result.field === 'current-amount') {
          currentInput.setAttribute('aria-invalid', 'true');
          currentInput.focus();
        } else if (result.field) {
          const field = doc.getElementById(`count-${result.field}`);
          if (field) {
            field.setAttribute('aria-invalid', 'true');
            field.focus();
          }
          inventoryCounts.setAttribute('aria-invalid', 'true');
        }
      }
    }

    function breakdownTokens(counts, denoms) {
      const fragment = doc.createDocumentFragment();
      denoms.filter((denom) => counts[denom.id] > 0).forEach((denom) => {
        const token = doc.createElement('span');
        token.className = `denom-token${denom.kind === 'note' ? ' note' : ''}`;
        const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('class', `money-icon${denom.kind === 'coin' ? ' coin-icon' : ''}`);
        icon.setAttribute('viewBox', denom.kind === 'note' ? '0 0 138 80' : '0 0 64 64');
        icon.setAttribute('aria-hidden', 'true');
        const use = doc.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', `./assets/cash-icons.svg#${denom.id}`);
        icon.append(use);
        const label = doc.createElement('span');
        label.textContent = `NT${denom.label}`;
        const quantity = doc.createElement('strong');
        quantity.textContent = `${counts[denom.id]}${denom.kind === 'note' ? '張' : '枚'}`;
        token.append(icon, label, quantity);
        fragment.append(token);
      });
      return fragment;
    }

    function renderExtreme(container, title, tag, counts, denoms, measure, unit) {
      if (measure === 'coins' && !denoms.some((denom) => denom.kind === 'coin')) return;
      if (measure === 'notes' && !denoms.some((denom) => denom.kind === 'note')) return;
      const pieces = denoms.reduce((sum, denom) => sum + counts[denom.id], 0);
      const noteCount = denoms.filter((denom) => denom.kind === 'note').reduce((sum, denom) => sum + counts[denom.id], 0);
      const coinCount = denoms.filter((denom) => denom.kind === 'coin').reduce((sum, denom) => sum + counts[denom.id], 0);
      const card = doc.createElement('article');
      card.className = 'makeup-extreme-card';
      const label = doc.createElement('span');
      label.className = 'extreme-label';
      label.textContent = title;
      const badge = doc.createElement('span');
      badge.className = 'extreme-tag';
      badge.textContent = tag;
      const total = doc.createElement('strong');
      total.className = 'extreme-total';
      const measureValue = measure === 'coins' ? coinCount : measure === 'notes' ? noteCount : pieces;
      total.textContent = `${measureValue}${unit}`;
      const detail = doc.createElement('p');
      detail.className = 'extreme-detail';
      detail.textContent = `${pieces} 件：${noteCount} 張紙鈔、${coinCount} 枚硬幣`;
      card.append(label, badge, total, detail);
      container.append(card);
    }

    function renderSolutions(result) {
      const list = doc.getElementById('makeup-combination-list');
      list.replaceChildren();
      const denoms = [...result.denoms].sort((a, b) => b.ticks - a.ticks);
      const fewestCounts = result.extremes.fewestPieces;
      const signature = (counts) => denoms.map((denom) => `${denom.id}:${counts[denom.id]}`).join('|');
      const representative = signature(fewestCounts);
      result.solutions.forEach((solution, index) => {
        const isFewest = signature(solution.counts) === representative;
        const row = doc.createElement('article');
        row.className = `combination-row${isFewest ? ' best' : ''}`;
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
        const breakdown = doc.createElement('div');
        breakdown.className = 'row-breakdown';
        breakdown.append(breakdownTokens(solution.counts, denoms));
        summary.append(pieces, split);
        body.append(summary, breakdown);
        const value = doc.createElement('span');
        value.className = 'row-value';
        value.textContent = formatCurrency(result.parsed.ticks);
        row.append(number, body, value);
        list.append(row);
      });

      const countText = result.ways.toLocaleString('zh-TW');
      doc.getElementById('makeup-combination-count').textContent = `${result.solutions.length.toLocaleString('zh-TW')} / ${countText} 組`;
      const note = doc.getElementById('makeup-truncation-note');
      const maxed = result.solutions.length >= MAX_LIST_LIMIT;
      note.hidden = !result.truncated;
      note.textContent = result.truncated
        ? maxed
          ? `共有 ${countText} 種配法；明細最多列出 ${MAX_LIST_LIMIT.toLocaleString('zh-TW')} 組，代表解仍依全部配法計算。`
          : `共有 ${countText} 種配法，目前顯示 ${result.solutions.length.toLocaleString('zh-TW')} 組；代表解仍依全部配法計算。`
        : '';
      const loadMore = doc.getElementById('makeup-load-more');
      loadMore.hidden = !result.truncated || maxed;
      loadMore.textContent = `再顯示 100 組（${result.solutions.length.toLocaleString('zh-TW')} / ${countText}）`;
    }

    function renderResult(result) {
      const empty = doc.getElementById('makeup-empty-state');
      const content = doc.getElementById('makeup-result-content');
      const needMore = doc.getElementById('makeup-needs-more');
      const alreadyEnough = doc.getElementById('makeup-already-enough');
      const noSolution = doc.getElementById('makeup-no-solution');
      const extremes = doc.getElementById('makeup-extremes');
      const solutionSection = doc.getElementById('makeup-solutions-section');

      empty.hidden = true;
      content.hidden = false;
      needMore.hidden = true;
      alreadyEnough.hidden = true;
      noSolution.hidden = true;
      extremes.hidden = true;
      solutionSection.hidden = true;
      doc.getElementById('makeup-target-value').textContent = formatCurrency(result.targetTicks);
      doc.getElementById('makeup-current-value').textContent = formatCurrency(result.currentTicks);
      doc.getElementById('makeup-remaining-value').textContent = formatCurrency(result.remainingTicks);

      if (result.status === 'exact' || result.status === 'surplus') {
        alreadyEnough.hidden = false;
        doc.getElementById('makeup-surplus-value').textContent = result.status === 'exact'
          ? '剛好達標，不需要再補金額。'
          : `已超過目標 ${formatCurrency(result.surplusTicks)}；目前金額足夠。`;
        status.lastChild.textContent = result.status === 'exact' ? '剛好達標' : '目前金額足夠';
        return;
      }

      needMore.hidden = false;
      const calculation = result.calculation;
      doc.getElementById('makeup-remaining-value').textContent = formatCurrency(result.remainingTicks);
      if (calculation.ways === 0n) {
        noSolution.hidden = false;
        doc.getElementById('makeup-no-solution-message').textContent = calculation.noSolutionReason;
        status.lastChild.textContent = '目前面額無法湊出';
        return;
      }

      extremes.hidden = false;
      extremes.replaceChildren();
      renderExtreme(extremes, '件數最少', '少', calculation.extremes.fewestPieces, calculation.denoms, 'pieces', '件');
      renderExtreme(extremes, '硬幣最多', '幣', calculation.extremes.mostCoins, calculation.denoms, 'coins', '枚');
      renderExtreme(extremes, '紙鈔最少', '鈔', calculation.extremes.fewestNotes, calculation.denoms, 'notes', '張');
      solutionSection.hidden = false;
      renderSolutions(calculation);
      status.lastChild.textContent = '已找到補足配法';
    }

    function collectCounts() {
      const counts = {};
      for (const denom of calculator.DENOMINATIONS) {
        const input = doc.getElementById(`count-${denom.id}`);
        counts[denom.id] = input.disabled ? '0' : input.value;
      }
      return counts;
    }

    function calculateNow() {
      clearErrors();
      resultPanel.setAttribute('aria-busy', 'true');
      visibleLimit = LIST_LIMIT;
      const method = currentInventoryMethod();
      const result = calculateTopUp({
        target: targetInput.value,
        inventoryMethod: method,
        currentAmount: currentInput.value,
        counts: collectCounts(),
        allowHalf: allowHalfInput.checked,
        mode: currentMode(),
        listLimit: visibleLimit,
      });
      if (!result.ok) {
        displayError(result);
        resultPanel.setAttribute('aria-busy', 'false');
        return;
      }
      lastResult = result;
      renderResult(result);
      resultPanel.setAttribute('aria-busy', 'false');
    }

    function renderCountInputs() {
      const groups = [
        { id: 'notes', title: '紙鈔', denoms: calculator.DENOMINATIONS.filter((denom) => denom.kind === 'note') },
        { id: 'coins', title: '硬幣', denoms: calculator.DENOMINATIONS.filter((denom) => denom.kind === 'coin') },
      ];
      groups.forEach((group) => {
        const fieldset = doc.createElement('fieldset');
        fieldset.className = 'count-group';
        const legend = doc.createElement('legend');
        legend.textContent = group.title;
        const grid = doc.createElement('div');
        grid.className = 'count-grid';
        group.denoms.forEach((denom) => {
          const wrapper = doc.createElement('div');
          wrapper.className = `count-field${denom.id === 'coin-half' ? ' half-count-field' : ''}`;
          if (denom.id === 'coin-half') wrapper.id = 'coin-half-count-row';
          const label = doc.createElement('label');
          label.htmlFor = `count-${denom.id}`;
          const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
          icon.setAttribute('class', `money-icon${denom.kind === 'coin' ? ' coin-icon' : ''}`);
          icon.setAttribute('viewBox', denom.kind === 'note' ? '0 0 138 80' : '0 0 64 64');
          icon.setAttribute('aria-hidden', 'true');
          const use = doc.createElementNS('http://www.w3.org/2000/svg', 'use');
          use.setAttribute('href', `./assets/cash-icons.svg#${denom.id}`);
          icon.append(use);
          const labelText = doc.createElement('span');
          labelText.textContent = `NT${denom.label} ${denom.kind === 'note' ? '張' : '枚'}`;
          label.append(icon, labelText);
          const input = doc.createElement('input');
          input.id = `count-${denom.id}`;
          input.name = denom.id;
          input.type = 'text';
          input.inputMode = 'numeric';
          input.pattern = '[0-9]*';
          input.maxLength = 12;
          input.value = '0';
          input.autocomplete = 'off';
          input.setAttribute('aria-label', `${denom.label} ${denom.kind === 'note' ? '紙鈔張數' : '硬幣枚數'}`);
          if (denom.id === 'coin-half') input.disabled = true;
          wrapper.append(label, input);
          grid.append(wrapper);
        });
        fieldset.append(legend, grid);
        inventoryCounts.append(fieldset);
      });
      const hint = doc.createElement('p');
      hint.className = 'count-hint';
      hint.textContent = '每格填張數或枚數；不持有的面額填 0。';
      inventoryCounts.append(hint);
    }

    renderCountInputs();
    setInputPanels();
    updateHalfCountRow();
    inventoryMethodInputs.forEach((input) => input.addEventListener('change', () => { setInputPanels(); markDirty(); }));
    modeInputs.forEach((input) => input.addEventListener('change', markDirty));
    allowHalfInput.addEventListener('change', () => { updateHalfCountRow(); markDirty(); });
    form.addEventListener('input', (event) => {
      if (event.target === targetInput || event.target === currentInput || event.target.matches('#inventory-counts input')) markDirty();
    });
    form.addEventListener('submit', (event) => { event.preventDefault(); calculateNow(); });
    doc.getElementById('makeup-load-more').addEventListener('click', () => {
      if (!lastResult || lastResult.status !== 'needs-more' || lastResult.calculation.ways === 0n) return;
      visibleLimit = Math.min(visibleLimit + LIST_LIMIT, MAX_LIST_LIMIT);
      const method = currentInventoryMethod();
      lastResult = calculateTopUp({
        target: targetInput.value,
        inventoryMethod: method,
        currentAmount: currentInput.value,
        counts: collectCounts(),
        allowHalf: allowHalfInput.checked,
        mode: currentMode(),
        listLimit: visibleLimit,
      });
      if (lastResult.ok) renderResult(lastResult);
    });
  }

  return {
    LIST_LIMIT,
    MAX_LIST_LIMIT,
    parseInventoryAmount,
    sumDenominationCounts,
    ticksToAmountInput,
    calculateTopUp,
    mount,
  };
});
