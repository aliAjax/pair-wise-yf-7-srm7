const storageKey = "zfl16-movable-type-workshop";

const starterInventory = [
  { id: crypto.randomUUID(), char: "山", style: "宋体旧字", size: 30, quantity: 4, wear: "微磨" },
  { id: crypto.randomUUID(), char: "月", style: "宋体旧字", size: 30, quantity: 3, wear: "旧痕" },
  { id: crypto.randomUUID(), char: "风", style: "楷体木刻", size: 28, quantity: 2, wear: "微磨" },
  { id: crypto.randomUUID(), char: "花", style: "楷体木刻", size: 28, quantity: 2, wear: "新" },
  { id: crypto.randomUUID(), char: "茶", style: "黑体铅字", size: 24, quantity: 3, wear: "旧痕" },
  { id: crypto.randomUUID(), char: "雨", style: "仿宋细字", size: 22, quantity: 4, wear: "新" }
];

const defaultState = {
  inventory: starterInventory,
  selectedTypeId: starterInventory[0].id,
  placements: [],
  drafts: [],
  settings: {
    paperSize: "postcard",
    flowMode: "horizontal",
    gridGap: 8,
    workTitle: "晚风小笺"
  }
};

let state = loadState();

const els = {
  paperSize: document.querySelector("#paperSize"),
  flowMode: document.querySelector("#flowMode"),
  gridGap: document.querySelector("#gridGap"),
  workTitle: document.querySelector("#workTitle"),
  stage: document.querySelector("#stage"),
  typeList: document.querySelector("#typeList"),
  typeForm: document.querySelector("#typeForm"),
  charInput: document.querySelector("#charInput"),
  styleInput: document.querySelector("#styleInput"),
  sizeInput: document.querySelector("#sizeInput"),
  quantityInput: document.querySelector("#quantityInput"),
  wearInput: document.querySelector("#wearInput"),
  inventorySearch: document.querySelector("#inventorySearch"),
  styleFilter: document.querySelector("#styleFilter"),
  selectedTypeLabel: document.querySelector("#selectedTypeLabel"),
  shortageBadge: document.querySelector("#shortageBadge"),
  usageList: document.querySelector("#usageList"),
  draftList: document.querySelector("#draftList"),
  placedCount: document.querySelector("#placedCount"),
  inventoryCount: document.querySelector("#inventoryCount"),
  saveDraftBtn: document.querySelector("#saveDraftBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  exportNotice: document.querySelector("#exportNotice"),
  clearBoardBtn: document.querySelector("#clearBoardBtn")
};

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return structuredClone(defaultState);
  try {
    const parsed = JSON.parse(saved);
    const next = {
      ...structuredClone(defaultState),
      ...parsed,
      settings: { ...defaultState.settings, ...parsed.settings }
    };
    next.placements = normalizePlacements(next.placements, next.inventory);
    next.drafts = (next.drafts || []).map((draft) => ({
      ...draft,
      placements: normalizePlacements(draft.placements, next.inventory)
    }));
    return next;
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function describeType(item) {
  return item ? `${item.char} · ${item.style}（${item.size}px · ${item.wear}）` : "";
}

function findTypeBySignature(char, style) {
  return state.inventory.find((item) => item.char === char && item.style === style) || null;
}

function snapshotType(item) {
  return { char: item.char, style: item.style, size: item.size, wear: item.wear };
}

// 旧草稿只存了 typeId，补记字模快照，载入后缺字格仍能保留原字。
function normalizePlacements(placements, inventory) {
  return (placements || []).map((placement) => {
    const type = inventory.find((item) => item.id === placement.typeId);
    return {
      row: placement.row,
      col: placement.col,
      typeId: placement.typeId,
      char: placement.char ?? type?.char ?? "缺",
      style: placement.style ?? type?.style ?? "未知风格",
      size: placement.size ?? type?.size ?? null,
      wear: placement.wear ?? type?.wear ?? null
    };
  });
}

// 字模被撤走又补回同款（同字同风格）时，自动把草稿重新接回库中字模。
function healPlacements(placements) {
  let changed = false;
  for (const placement of placements) {
    if (state.inventory.some((item) => item.id === placement.typeId)) continue;
    const match = findTypeBySignature(placement.char, placement.style);
    if (match) {
      placement.typeId = match.id;
      changed = true;
    }
  }
  return changed;
}

function reconcileState() {
  let changed = false;
  if (healPlacements(state.placements)) changed = true;
  for (const draft of state.drafts) {
    if (healPlacements(draft.placements)) changed = true;
  }
  if (state.selectedTypeId && !getSelectedType()) {
    state.selectedTypeId = state.inventory[0]?.id || null;
    changed = true;
  }
  if (changed) saveState();
}

function analyzePlacements(placements) {
  const usage = {};
  for (const placement of placements) {
    usage[placement.typeId] = (usage[placement.typeId] || 0) + 1;
  }
  const groups = [];
  const groupBy = new Map();
  for (const placement of placements) {
    if (!groupBy.has(placement.typeId)) {
      const group = {
        typeId: placement.typeId,
        char: placement.char,
        style: placement.style,
        used: 0,
        quantity: 0,
        cells: 0,
        status: "gone",
        candidates: []
      };
      groupBy.set(placement.typeId, group);
      groups.push(group);
    }
    groupBy.get(placement.typeId).used += 1;
  }
  for (const group of groups) {
    const type = state.inventory.find((item) => item.id === group.typeId);
    if (type) {
      group.quantity = type.quantity;
      group.status = group.used > type.quantity ? "short" : "ok";
    } else {
      group.char = placements.find((item) => item.typeId === group.typeId)?.char || "缺";
      group.style = placements.find((item) => item.typeId === group.typeId)?.style || "未知风格";
      // 同字同风格的字模已在 heal 阶段自动接回；这里列的是同字不同款，供手动换用。
      group.candidates = state.inventory.filter((item) => item.char === group.char);
    }
  }
  groups.sort((a, b) => {
    const rank = { gone: 0, short: 1, ok: 2 };
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return `${a.char}${a.style}`.localeCompare(`${b.char}${b.style}`, "zh-CN");
  });

  const goneKeys = new Set();
  const shortageById = new Map();
  for (const group of groups) {
    if (group.status === "gone") {
      group.cells = group.used;
    } else if (group.status === "short") {
      group.cells = group.used - group.quantity;
      shortageById.set(group.typeId, group.cells);
    }
  }
  // 阅读顺序（先行后列）中靠后的超用格子标为待补，保证稳定可预期。
  const sorted = [...placements].sort((a, b) => a.row - b.row || a.col - b.col || a.typeId.localeCompare(b.typeId));
  const remain = new Map(shortageById);
  const shortKeys = new Set();
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const left = remain.get(sorted[i].typeId) || 0;
    if (left > 0) {
      shortKeys.add(placementKey(sorted[i].row, sorted[i].col));
      remain.set(sorted[i].typeId, left - 1);
    }
  }
  for (const placement of placements) {
    if (!state.inventory.some((item) => item.id === placement.typeId)) {
      goneKeys.add(placementKey(placement.row, placement.col));
    }
  }
  const pendingKeys = new Set([...goneKeys, ...shortKeys]);
  const missingCells = groups.reduce((sum, group) => sum + group.cells, 0);
  return { groups, pendingKeys, missingCells, hasGap: missingCells > 0 };
}

function getGrid() {
  const size = state.settings.paperSize;
  if (size === "bookmark") return { cols: 7, rows: 18 };
  if (size === "square") return { cols: 12, rows: 12 };
  return { cols: 16, rows: 10 };
}

function placementKey(row, col) {
  return `${row}:${col}`;
}

function getSelectedType() {
  return state.inventory.find((item) => item.id === state.selectedTypeId) || null;
}

function getUsage() {
  return state.placements.reduce((acc, placement) => {
    acc[placement.typeId] = (acc[placement.typeId] || 0) + 1;
    return acc;
  }, {});
}

function renderSettings() {
  els.paperSize.value = state.settings.paperSize;
  els.flowMode.value = state.settings.flowMode;
  els.gridGap.value = state.settings.gridGap;
  els.workTitle.value = state.settings.workTitle;
}

function renderStyleFilter() {
  const current = els.styleFilter.value || "all";
  const styles = [...new Set(state.inventory.map((item) => item.style))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  els.styleFilter.innerHTML = `<option value="all">全部风格</option>${styles
    .map((style) => `<option value="${escapeHtml(style)}">${escapeHtml(style)}</option>`)
    .join("")}`;
  els.styleFilter.value = styles.includes(current) ? current : "all";
}

function renderInventory() {
  const keyword = els.inventorySearch.value.trim();
  const style = els.styleFilter.value;
  const usage = getUsage();
  const items = state.inventory.filter((item) => {
    const matchesKeyword = !keyword || `${item.char}${item.style}${item.wear}`.includes(keyword);
    const matchesStyle = style === "all" || item.style === style;
    return matchesKeyword && matchesStyle;
  });

  els.inventoryCount.textContent = `${state.inventory.length}枚字模`;
  els.typeList.innerHTML = items
    .map((item) => {
      const used = usage[item.id] || 0;
      const selected = item.id === state.selectedTypeId ? "selected" : "";
      const shortage = used > item.quantity ? ` · <em class="lack">缺${used - item.quantity}枚</em>` : "";
      return `
        <article class="type-card ${selected}" draggable="true" data-type-id="${item.id}">
          <div class="glyph" style="font-size:${Math.min(item.size, 36)}px">${escapeHtml(item.char)}</div>
          <div class="type-meta">
            <strong>${escapeHtml(item.char)} · ${escapeHtml(item.style)}</strong>
            <span>${item.size}px · ${escapeHtml(item.wear)} · 已用${used}/${item.quantity}${shortage}</span>
          </div>
          <div class="type-actions">
            <button class="mini-btn" title="增补1枚" data-restock-type="${item.id}" type="button">＋</button>
            <button class="mini-btn" title="删除字模" data-delete-type="${item.id}" type="button">×</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderStage(analysis) {
  const { cols, rows } = getGrid();
  const map = new Map(state.placements.map((item) => [placementKey(item.row, item.col), item]));
  els.stage.className = `stage ${state.settings.paperSize}`;
  els.stage.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  els.stage.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  els.stage.style.gap = `${state.settings.gridGap}px`;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cellKey = placementKey(row, col);
      const placement = map.get(cellKey);
      const type = placement ? state.inventory.find((item) => item.id === placement.typeId) : null;
      const vertical = state.settings.flowMode === "vertical" ? "vertical" : "";
      const pending = placement && analysis.pendingKeys.has(cellKey);
      const cellClass = ["cell"];
      let glyph = "";
      let label = `第${row + 1}行第${col + 1}列`;
      if (placement) {
        if (type) {
          glyph = escapeHtml(type.char);
          cellClass.push("used");
        } else {
          // 字模已被清走：保留原字并标成待补，而不是留空。
          glyph = escapeHtml(placement.char || "缺");
          cellClass.push("pending", "gone");
          label = `第${row + 1}行第${col + 1}列，待补${placement.char || "缺"}`;
        }
        if (pending && type) {
          cellClass.push("pending", "short");
          label = `第${row + 1}行第${col + 1}列，待补${type.char}（数量不足）`;
        }
      }
      cellClass.push(vertical);
      cells.push(`
        <button class="${cellClass.join(" ")}" data-row="${row}" data-col="${col}" type="button" aria-label="${label}">
          <span class="cell-glyph">${glyph}</span>
          ${pending ? '<span class="pending-flag">待补</span>' : ""}
        </button>
      `);
    }
  }
  els.stage.innerHTML = cells.join("");
}

function groupReason(group) {
  if (group.status === "gone") return `库中已清走 · 缺${group.cells}枚`;
  if (group.status === "short") return `库存不足 · 缺${group.cells}枚`;
  return "齐备";
}

function renderUsage(analysis) {
  els.placedCount.textContent = `${state.placements.length}个落字`;

  const gapGroups = analysis.groups.filter((group) => group.status !== "ok");
  if (analysis.hasGap) {
    const gone = gapGroups.filter((group) => group.status === "gone").length;
    const short = gapGroups.filter((group) => group.status === "short").length;
    const bits = [];
    if (gone) bits.push(`${gone}款已清走`);
    if (short) bits.push(`${short}款数量不足`);
    els.shortageBadge.textContent = `缺字${analysis.missingCells}枚 · ${bits.join("，")}`;
    els.shortageBadge.className = "badge warn";
  } else {
    els.shortageBadge.textContent = "字模齐备";
    els.shortageBadge.className = "badge ok";
  }

  const selectedType = getSelectedType();
  els.selectedTypeLabel.textContent = selectedType ? `当前：${selectedType.char} · ${selectedType.style}` : "未选择字模";

  els.usageList.innerHTML =
    analysis.groups
      .map((group) => {
        const warn = group.status === "ok" ? "" : "warn";
        const count = group.status === "gone" ? `${group.used}/0` : `${group.used}/${group.quantity}`;
        return `
          <div class="usage-item ${warn}">
            <strong>${escapeHtml(group.char)} ${escapeHtml(group.style)}</strong>
            <span>${count} · ${groupReason(group)}</span>
          </div>
        `;
      })
      .join("") || `<p class="empty">还没有落字。</p>`;
}

function renderDrafts() {
  els.draftList.innerHTML =
    state.drafts
      .map((draft) => {
        const analysis = analyzePlacements(draft.placements);
        const lines = analysis.groups
          .filter((group) => group.status !== "ok")
          .map((group) => {
            const reason = groupReason(group);
            const candidate = group.candidates[0];
            const swap =
              candidate
                ? `<button type="button" class="swap-link" data-swap-draft="${draft.id}" data-swap-from="${escapeHtml(group.typeId)}" data-swap-to="${candidate.id}">换用现有字模</button>`
                : "";
            const hint = candidate
              ? `<em class="candidate">库内有同字字模可换：${escapeHtml(describeType(candidate))}</em>${swap}`
              : `<em class="candidate">补齐该款字模后自动复核</em>`;
            return `
              <div class="draft-shortage">
                <strong>《${escapeHtml(draft.title)}》缺 ${escapeHtml(group.char)} · ${escapeHtml(group.style)} ${group.cells}枚</strong>
                <span>${reason}</span>
                ${hint}
              </div>
            `;
          })
          .join("");
        const summary = analysis.hasGap
          ? `<div class="draft-lack-summary">共缺 ${analysis.missingCells} 枚字模，载入后缺字格标为待补</div>`
          : `<div class="draft-ok-summary">字模齐备，可直接载入</div>`;
        return `
          <article class="draft-item ${analysis.hasGap ? "has-gap" : ""}">
            <strong>${escapeHtml(draft.title)}</strong>
            <span>${draft.placements.length}个落字 · ${new Date(draft.savedAt).toLocaleString("zh-CN")}</span>
            ${analysis.hasGap ? lines : ""}
            ${summary}
            <div class="draft-actions">
              <button type="button" data-load-draft="${draft.id}">载入</button>
              <button type="button" data-delete-draft="${draft.id}">删除</button>
            </div>
          </article>
        `;
      })
      .join("") || `<p class="empty">还没有保存草稿。</p>`;
}

function renderAll() {
  reconcileState();
  saveState();
  const analysis = analyzePlacements(state.placements);
  renderSettings();
  renderStyleFilter();
  renderInventory();
  renderStage(analysis);
  renderUsage(analysis);
  renderDrafts();
  // 提示已展开时，补齐一部分缺口也要立刻刷新文案与剩余条目。
  renderExportNotice(analysis, !els.exportNotice.hidden && els.exportNotice.innerHTML !== "");
}

function placeType(row, col, typeId = state.selectedTypeId) {
  if (!typeId) return;
  const type = state.inventory.find((item) => item.id === typeId);
  if (!type) return;
  const existingIndex = state.placements.findIndex((item) => item.row === row && item.col === col);
  if (existingIndex >= 0) {
    if (state.placements[existingIndex].typeId === typeId) {
      state.placements.splice(existingIndex, 1);
    } else {
      state.placements[existingIndex] = { row, col, ...snapshotType(type), typeId };
    }
  } else {
    state.placements.push({ row, col, ...snapshotType(type), typeId });
  }
  renderAll();
}

function addType(event) {
  event.preventDefault();
  const item = {
    char: els.charInput.value.trim(),
    style: els.styleInput.value.trim(),
    size: Number(els.sizeInput.value),
    quantity: Number(els.quantityInput.value),
    wear: els.wearInput.value
  };
  if (!item.char || !item.style) return;
  // 增补完全同款（同字/风格/字号/磨损）的字模时，直接累加库存枚数。
  const existing = state.inventory.find(
    (entry) =>
      entry.char === item.char && entry.style === item.style && entry.size === item.size && entry.wear === item.wear
  );
  if (existing) {
    existing.quantity += item.quantity;
    state.selectedTypeId = existing.id;
  } else {
    const created = { id: crypto.randomUUID(), ...item };
    state.inventory.unshift(created);
    state.selectedTypeId = created.id;
  }
  els.typeForm.reset();
  els.sizeInput.value = 24;
  els.quantityInput.value = 3;
  renderAll();
}

function saveDraft() {
  const title = state.settings.workTitle.trim() || "未命名作品";
  state.drafts.unshift({
    id: crypto.randomUUID(),
    title,
    settings: structuredClone(state.settings),
    placements: structuredClone(state.placements),
    savedAt: new Date().toISOString()
  });
  state.drafts = state.drafts.slice(0, 8);
  renderAll();
}

function buildGapLines(analysis) {
  return analysis.groups
    .filter((group) => group.status !== "ok")
    .map((group) => {
      const label = `${group.char} · ${group.style}`;
      if (group.status === "gone") {
        return `《${state.settings.workTitle || "未命名作品"}》字模「${label}」已从库中清走，还缺 ${group.cells} 枚`;
      }
      return `《${state.settings.workTitle || "未命名作品"}》字模「${label}」库存不足，已用 ${group.used} 枚、库存 ${group.quantity} 枚，还缺 ${group.cells} 枚`;
    });
}

function renderExportNotice(analysis, forceShow) {
  if (!analysis.hasGap) {
    els.exportNotice.hidden = true;
    els.exportNotice.innerHTML = "";
    els.exportBtn.classList.remove("blocked");
    return;
  }
  els.exportBtn.classList.add("blocked");
  if (!forceShow) return;
  const lines = buildGapLines(analysis)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");
  els.exportNotice.innerHTML = `
    <div class="notice-head">
      <strong>无法导出：仍有 ${analysis.missingCells} 枚缺字（${buildGapLines(analysis).length} 款字模）</strong>
      <button type="button" class="mini-btn" id="closeExportNotice" title="知道了">×</button>
    </div>
    <p>补齐缺字或换用库中现有字模后才能导出，当前不会生成漏字预览图。</p>
    <ul>${lines}</ul>
  `;
  els.exportNotice.hidden = false;
}

function exportPreview() {
  const analysis = analyzePlacements(state.placements);
  if (analysis.hasGap) {
    renderExportNotice(analysis, true);
    els.exportNotice.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  renderExportNotice(analysis, false);
  const { cols, rows } = getGrid();
  const cell = state.settings.paperSize === "bookmark" ? 44 : 56;
  const gap = state.settings.gridGap;
  const margin = 48;
  const width = cols * cell + (cols - 1) * gap + margin * 2;
  const height = rows * cell + (rows - 1) * gap + margin * 2 + 70;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fffaf1";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#2f2921";
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, width - 36, height - 36);
  ctx.fillStyle = "#22201c";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(state.settings.workTitle || "未命名作品", margin, 50);
  ctx.font = "bold 30px serif";
  state.placements.forEach((placement) => {
    const type = state.inventory.find((item) => item.id === placement.typeId);
    // 存在缺口时导出已被拦截，这里再守一道，绝不画出缺字格。
    if (!type) return;
    const x = margin + placement.col * (cell + gap);
    const y = margin + 45 + placement.row * (cell + gap);
    ctx.fillStyle = "#2f2921";
    ctx.fillRect(x, y, cell, cell);
    ctx.fillStyle = "#fff5df";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${Math.min(type.size + 8, 42)}px serif`;
    ctx.fillText(type.char, x + cell / 2, y + cell / 2);
  });
  const link = document.createElement("a");
  link.download = `${state.settings.workTitle || "movable-type"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.paperSize.addEventListener("change", () => {
  state.settings.paperSize = els.paperSize.value;
  const { cols, rows } = getGrid();
  state.placements = state.placements.filter((item) => item.row < rows && item.col < cols);
  renderAll();
});

els.flowMode.addEventListener("change", () => {
  state.settings.flowMode = els.flowMode.value;
  renderAll();
});

els.gridGap.addEventListener("input", () => {
  state.settings.gridGap = Number(els.gridGap.value);
  renderAll();
});

els.workTitle.addEventListener("input", () => {
  state.settings.workTitle = els.workTitle.value;
  saveState();
});

els.typeForm.addEventListener("submit", addType);
els.inventorySearch.addEventListener("input", renderInventory);
els.styleFilter.addEventListener("change", renderInventory);
els.saveDraftBtn.addEventListener("click", saveDraft);
els.exportBtn.addEventListener("click", exportPreview);
els.clearBoardBtn.addEventListener("click", () => {
  state.placements = [];
  renderAll();
});

els.typeList.addEventListener("click", (event) => {
  const restockButton = event.target.closest("[data-restock-type]");
  if (restockButton) {
    const type = state.inventory.find((item) => item.id === restockButton.dataset.restockType);
    if (type) {
      type.quantity += 1;
      renderAll();
    }
    return;
  }
  const deleteButton = event.target.closest("[data-delete-type]");
  if (deleteButton) {
    const typeId = deleteButton.dataset.deleteType;
    state.inventory = state.inventory.filter((item) => item.id !== typeId);
    // 撤走字模不清空落字：格子保留原字并标成待补，补回同款字模后自动接回。
    if (state.selectedTypeId === typeId) state.selectedTypeId = state.inventory[0]?.id || null;
    renderAll();
    return;
  }
  const card = event.target.closest("[data-type-id]");
  if (!card) return;
  state.selectedTypeId = card.dataset.typeId;
  renderAll();
});

els.typeList.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-type-id]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.typeId);
});

els.stage.addEventListener("dragover", (event) => {
  if (event.target.closest(".cell")) event.preventDefault();
});

els.stage.addEventListener("drop", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  event.preventDefault();
  placeType(Number(cell.dataset.row), Number(cell.dataset.col), event.dataTransfer.getData("text/plain"));
});

els.stage.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  const placement = state.placements.find((item) => item.row === row && item.col === col);
  const typeGone = placement && !state.inventory.some((item) => item.id === placement.typeId);
  // 待补格且当前没选字模时，点击可移除该格；选了字模则换用所选字模。
  if (typeGone && !state.selectedTypeId) {
    state.placements = state.placements.filter((item) => !(item.row === row && item.col === col));
    renderAll();
    return;
  }
  placeType(row, col);
});

els.exportNotice.addEventListener("click", (event) => {
  if (event.target.closest("#closeExportNotice")) {
    els.exportNotice.hidden = true;
  }
});

els.draftList.addEventListener("click", (event) => {
  const loadButton = event.target.closest("[data-load-draft]");
  const deleteButton = event.target.closest("[data-delete-draft]");
  const swapButton = event.target.closest("[data-swap-draft]");
  if (swapButton) {
    const draft = state.drafts.find((item) => item.id === swapButton.dataset.swapDraft);
    const target = state.inventory.find((item) => item.id === swapButton.dataset.swapTo);
    if (!draft || !target) return;
    for (const placement of draft.placements) {
      if (placement.typeId === swapButton.dataset.swapFrom) {
        placement.typeId = target.id;
        Object.assign(placement, snapshotType(target));
      }
    }
    renderAll();
    return;
  }
  if (loadButton) {
    const draft = state.drafts.find((item) => item.id === loadButton.dataset.loadDraft);
    if (!draft) return;
    state.settings = structuredClone(draft.settings);
    state.placements = structuredClone(draft.placements);
    // 草稿纸张与当前网格不符时，剔除落在网格外的格子。
    const { cols, rows } = getGrid();
    state.placements = state.placements.filter((item) => item.row < rows && item.col < cols);
    renderAll();
  }
  if (deleteButton) {
    state.drafts = state.drafts.filter((item) => item.id !== deleteButton.dataset.deleteDraft);
    renderAll();
  }
});

renderAll();
