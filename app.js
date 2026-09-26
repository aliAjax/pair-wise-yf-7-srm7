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
let boardAnalysis = { entries: [], pendingKeys: new Set(), totalMissing: 0, usedCount: 0 };

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
  clearBoardBtn: document.querySelector("#clearBoardBtn"),
  exportNotice: document.querySelector("#exportNotice")
};

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return structuredClone(defaultState);
  try {
    const parsed = JSON.parse(saved);
    const merged = {
      ...structuredClone(defaultState),
      ...parsed,
      settings: { ...defaultState.settings, ...parsed.settings }
    };
    merged.placements ||= [];
    merged.drafts ||= [];
    // 旧版落字记录没有字模快照，按当前字模库补齐，补不上的只能留空
    merged.placements.forEach((placement) => {
      if (!placement.snapshot) {
        const type = merged.inventory.find((item) => item.id === placement.typeId);
        placement.snapshot = type ? snapshotOf(type) : { char: "", style: "", size: null, wear: "" };
      }
    });
    merged.drafts.forEach((draft) => {
      (draft.placements || []).forEach((placement) => {
        if (!placement.snapshot) {
          const type = merged.inventory.find((item) => item.id === placement.typeId);
          placement.snapshot = type ? snapshotOf(type) : { char: "", style: "", size: null, wear: "" };
        }
      });
    });
    return merged;
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
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

function typeSignature(char, style) {
  return `${char}__${style}`;
}

function snapshotOf(type) {
  return { char: type.char, style: type.style, size: type.size, wear: type.wear };
}

function getSelectedType() {
  return state.inventory.find((item) => item.id === state.selectedTypeId) || null;
}

function placementSnapshot(placement) {
  const type = state.inventory.find((item) => item.id === placement.typeId);
  if (type) {
    placement.snapshot = snapshotOf(type);
    return placement.snapshot;
  }
  return placement.snapshot || { char: "", style: "", size: null, wear: "" };
}

/**
 * 让一份落字记录与当前字模库对账：
 * - 字模被清走时，落字保留原字模信息，只标记待补；
 * - 库里补进同字同风格的新字模（或同款增补余量）时，按阅读顺序把待补落字挂回去；
 * - 尽量粘住原有绑定，只有超量/缺料的尾部落字才挪给有余量的同款字模。
 */
function reconcilePlacements(placements) {
  const ordered = [...placements].sort((a, b) => a.row - b.row || a.col - b.col);
  const groups = new Map();
  ordered.forEach((placement) => {
    if (!placement.snapshot) placement.snapshot = { char: "", style: "", size: null, wear: "" };
    const sig = typeSignature(placement.snapshot.char || "", placement.snapshot.style || "");
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(placement);
  });

  groups.forEach((pool) => {
    // 失效绑定（字模已清走）先摘钩
    pool.forEach((placement) => {
      if (placement.typeId && !state.inventory.some((item) => item.id === placement.typeId)) {
        placement.typeId = null;
      }
    });

    const countUsed = () => {
      const used = new Map();
      pool.forEach((placement) => {
        if (placement.typeId) used.set(placement.typeId, (used.get(placement.typeId) || 0) + 1);
      });
      return used;
    };

    // 可挪动：已摘钩的，或挂在现有字模上但超出该款枚数的尾部落字
    const isMovable = (placement, used) => {
      if (!placement.typeId) return true;
      const card = state.inventory.find((item) => item.id === placement.typeId);
      return card ? (used.get(card.id) || 0) > card.quantity : true;
    };

    pool.forEach((placement) => {
      const used = countUsed();
      if (!isMovable(placement, used)) return;
      const snap = placement.snapshot;
      const targets = state.inventory
        .filter(
          (item) =>
            item.style === snap.style &&
            item.char === snap.char &&
            item.id !== placement.typeId &&
            (used.get(item.id) || 0) < item.quantity
        )
        .sort((a, b) => {
          const sizeA = snap.size === a.size ? 1 : 0;
          const sizeB = snap.size === b.size ? 1 : 0;
          if (sizeA !== sizeB) return sizeB - sizeA;
          return b.quantity - (used.get(b.id) || 0) - (a.quantity - (used.get(a.id) || 0));
        });
      const target = targets[0];
      if (!target) return;
      placement.typeId = target.id;
      placement.snapshot = snapshotOf(target);
    });
  });
}

/**
 * 统计一份落字记录相对当前字模库的缺口：
 * 待补格按阅读顺序取每组落字的尾部，保证标红的就是溢出/缺料的那几枚。
 */
function analyzePlacements(placements) {
  const ordered = [...placements].sort((a, b) => a.row - b.row || a.col - b.col);
  const buckets = new Map();
  ordered.forEach((placement) => {
    const key = placement.typeId || `ghost:${typeSignature(
      placement.snapshot?.char || "",
      placement.snapshot?.style || ""
    )}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(placement);
  });

  const entries = [];
  const pendingKeys = new Set();
  let totalMissing = 0;

  buckets.forEach((items, key) => {
    const type = key.startsWith("ghost:")
      ? null
      : state.inventory.find((item) => item.id === key) || null;
    const snapshot = items[0].snapshot || { char: "", style: "", size: null, wear: "" };
    const quantity = type ? type.quantity : 0;
    const used = items.length;
    const missing = Math.max(0, used - quantity);
    if (missing > 0) {
      totalMissing += missing;
      items.slice(-missing).forEach((item) => pendingKeys.add(placementKey(item.row, item.col)));
    }
    entries.push({
      key,
      type,
      char: type ? type.char : snapshot.char || "?",
      style: type ? type.style : snapshot.style || "未知风格",
      size: type ? type.size : snapshot.size,
      wear: type ? type.wear : snapshot.wear,
      quantity,
      used,
      missing,
      removed: !type
    });
  });

  entries.sort((a, b) => {
    if (b.missing - a.missing !== 0) return b.missing - a.missing;
    return a.char.localeCompare(b.char, "zh-CN");
  });

  return { entries, pendingKeys, totalMissing, usedCount: placements.length };
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
  const boardUsage = new Map(boardAnalysis.entries.map((entry) => [entry.key, entry.used]));
  const items = state.inventory.filter((item) => {
    const matchesKeyword = !keyword || `${item.char}${item.style}${item.wear}`.includes(keyword);
    const matchesStyle = style === "all" || item.style === style;
    return matchesKeyword && matchesStyle;
  });

  els.inventoryCount.textContent = `${state.inventory.length}枚字模`;
  els.typeList.innerHTML = items
    .map((item) => {
      const used = boardUsage.get(item.id) || 0;
      const selected = item.id === state.selectedTypeId ? "selected" : "";
      const short = used > item.quantity ? "short" : "";
      return `
        <article class="type-card ${selected} ${short}" draggable="true" data-type-id="${item.id}">
          <div class="glyph" style="font-size:${Math.min(item.size, 36)}px">${escapeHtml(item.char)}</div>
          <div class="type-meta">
            <strong>${escapeHtml(item.char)} · ${escapeHtml(item.style)}</strong>
            <span>${item.size}px · ${escapeHtml(item.wear)} · 已用${used}/${item.quantity}</span>
          </div>
          <button class="mini-btn" title="删除字模" data-delete-type="${item.id}" type="button">×</button>
        </article>
      `;
    })
    .join("");
}

function renderStage() {
  const { cols, rows } = getGrid();
  const map = new Map(state.placements.map((item) => [placementKey(item.row, item.col), item]));
  els.stage.className = `stage ${state.settings.paperSize}`;
  els.stage.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  els.stage.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  els.stage.style.gap = `${state.settings.gridGap}px`;
  const vertical = state.settings.flowMode === "vertical" ? "vertical" : "";
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const key = placementKey(row, col);
      const placement = map.get(key);
      if (!placement) {
        cells.push(`
          <button class="cell ${vertical}" data-row="${row}" data-col="${col}" type="button" aria-label="第${row + 1}行第${col + 1}列空格"></button>
        `);
        continue;
      }
      const pending = boardAnalysis.pendingKeys.has(key);
      const type = state.inventory.find((item) => item.id === placement.typeId);
      const snap = placementSnapshot(placement);
      const char = type ? type.char : snap.char;
      const stateClass = pending ? "pending" : "used";
      const label = pending
        ? `第${row + 1}行第${col + 1}列：待补「${char}」，点击用当前字模替换`
        : `第${row + 1}行第${col + 1}列：${char}`;
      cells.push(`
        <button class="cell ${stateClass} ${vertical}" data-row="${row}" data-col="${col}" type="button" aria-label="${escapeHtml(label)}">
          <span class="cell-glyph">${escapeHtml(char)}</span>
          ${pending ? '<span class="cell-tag">待补</span>' : ""}
        </button>
      `);
    }
  }
  els.stage.innerHTML = cells.join("");
}

function renderUsage() {
  els.placedCount.textContent = boardAnalysis.totalMissing
    ? `${boardAnalysis.usedCount}个落字 · 缺${boardAnalysis.totalMissing}枚`
    : `${boardAnalysis.usedCount}个落字`;

  els.shortageBadge.textContent = boardAnalysis.totalMissing
    ? `缺字 ${boardAnalysis.totalMissing} 枚`
    : "数量充足";
  els.shortageBadge.className = `badge ${boardAnalysis.totalMissing ? "warn" : "ok"}`;

  const selectedType = getSelectedType();
  els.selectedTypeLabel.textContent = selectedType
    ? `当前：${selectedType.char} · ${selectedType.style}`
    : "未选择字模";

  els.usageList.innerHTML =
    boardAnalysis.entries
      .map((entry) => {
        const classes = ["usage-item"];
        if (entry.missing > 0) classes.push("warn");
        if (entry.removed) classes.push("removed");
        const meta = entry.removed
          ? `字模已清走 · 缺${entry.missing}枚`
          : entry.missing
            ? `${entry.used}/${entry.quantity} · 缺${entry.missing}枚`
            : `${entry.used}/${entry.quantity}`;
        return `
          <div class="${classes.join(" ")}">
            <strong>${escapeHtml(entry.char)} · ${escapeHtml(entry.style)}</strong>
            <span>${escapeHtml(meta)}</span>
          </div>
        `;
      })
      .join("") || `<p class="empty">还没有落字。</p>`;
}

function renderDrafts() {
  els.draftList.innerHTML =
    state.drafts
      .map((draft) => {
        const report = analyzePlacements(draft.placements);
        let status;
        if (report.totalMissing) {
          const details = report.entries
            .filter((entry) => entry.missing > 0)
            .map((entry) => {
              const reason = entry.removed ? "已清走" : "不足";
              return `${escapeHtml(entry.char)}·${escapeHtml(entry.style)}（${reason}，缺${entry.missing}枚）`;
            })
            .join("；");
          status = `<span class="draft-status gap">缺字 ${report.totalMissing} 枚：${details}</span>`;
        } else {
          status = `<span class="draft-status ok">字模齐备，可导出</span>`;
        }
        return `
          <article class="draft-item ${report.totalMissing ? "has-gap" : ""}">
            <strong>${escapeHtml(draft.title)}</strong>
            <span>${draft.placements.length}个落字 · ${new Date(draft.savedAt).toLocaleString("zh-CN")}</span>
            ${status}
            <div class="draft-actions">
              <button type="button" data-load-draft="${draft.id}">载入</button>
              <button type="button" data-delete-draft="${draft.id}">删除</button>
            </div>
          </article>
        `;
      })
      .join("") || `<p class="empty">还没有保存草稿。</p>`;
}

function renderExportNotice(mode = "idle") {
  if (mode === "success" && !boardAnalysis.totalMissing) {
    els.exportNotice.hidden = false;
    els.exportNotice.className = "export-notice ok show";
    els.exportNotice.innerHTML = `
      <strong>已导出预览图</strong>
      <span>《${escapeHtml(state.settings.workTitle || "未命名作品")}》字模齐备，PNG 预览已生成下载。</span>
    `;
    return;
  }
  if (boardAnalysis.totalMissing) {
    const lines = boardAnalysis.entries
      .filter((entry) => entry.missing > 0)
      .map((entry) => {
        const reason = entry.removed ? "该款字模已被清走" : "库存不足";
        return `<li>「${escapeHtml(entry.char)}」${escapeHtml(entry.style)} — ${reason}，缺 <strong>${entry.missing}</strong> 枚（已用 ${entry.used}/${entry.quantity}）</li>`;
      })
      .join("");
    els.exportNotice.hidden = false;
    els.exportNotice.className = `export-notice gap ${mode === "blocked" ? "show pulse" : "show"}`;
    els.exportNotice.innerHTML = `
      <strong>尚有 ${boardAnalysis.totalMissing} 枚缺字，不能导出预览</strong>
      <ul>${lines}</ul>
      <span>请补齐相应字模，或把标红的待补格换用现有字模后再导出。</span>
    `;
    return;
  }
  els.exportNotice.hidden = true;
  els.exportNotice.className = "export-notice";
  els.exportNotice.innerHTML = "";
}

function renderAll(noticeMode = "idle") {
  reconcilePlacements(state.placements);
  state.drafts.forEach((draft) => reconcilePlacements(draft.placements));
  // 归补后刷新字模快照（同款字模可能换了枚数或磨损）
  state.placements.forEach((placement) => placementSnapshot(placement));
  boardAnalysis = analyzePlacements(state.placements);
  saveState();
  renderSettings();
  renderStyleFilter();
  renderInventory();
  renderStage();
  renderUsage();
  renderDrafts();
  renderExportNotice(noticeMode);
}

function placeType(row, col, typeId = state.selectedTypeId) {
  if (!typeId) return;
  const existingIndex = state.placements.findIndex((item) => item.row === row && item.col === col);
  if (existingIndex >= 0) {
    if (state.placements[existingIndex].typeId === typeId) {
      state.placements.splice(existingIndex, 1);
    } else {
      state.placements[existingIndex].typeId = typeId;
      const type = state.inventory.find((item) => item.id === typeId);
      state.placements[existingIndex].snapshot = type ? snapshotOf(type) : state.placements[existingIndex].snapshot;
    }
  } else {
    const type = state.inventory.find((item) => item.id === typeId);
    state.placements.push({ row, col, typeId, snapshot: type ? snapshotOf(type) : { char: "", style: "", size: null, wear: "" } });
  }
  renderAll();
}

function addType(event) {
  event.preventDefault();
  const item = {
    id: crypto.randomUUID(),
    char: els.charInput.value.trim(),
    style: els.styleInput.value.trim(),
    size: Number(els.sizeInput.value),
    quantity: Number(els.quantityInput.value),
    wear: els.wearInput.value
  };
  if (!item.char || !item.style) return;
  state.inventory.unshift(item);
  state.selectedTypeId = item.id;
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

function exportPreview() {
  if (boardAnalysis.totalMissing) {
    renderExportNotice("blocked");
    els.exportNotice.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }

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
  state.placements.forEach((placement) => {
    const type = state.inventory.find((item) => item.id === placement.typeId);
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
  renderExportNotice("success");
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
  const { rows, cols } = getGrid();
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
  const deleteButton = event.target.closest("[data-delete-type]");
  if (deleteButton) {
    const typeId = deleteButton.dataset.deleteType;
    state.inventory = state.inventory.filter((item) => item.id !== typeId);
    // 不再连带删除落字：它们保留原字并转为待补，等补字模或换用现有字模
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
  placeType(Number(cell.dataset.row), Number(cell.dataset.col));
});

els.draftList.addEventListener("click", (event) => {
  const loadButton = event.target.closest("[data-load-draft]");
  const deleteButton = event.target.closest("[data-delete-draft]");
  if (loadButton) {
    const draft = state.drafts.find((item) => item.id === loadButton.dataset.loadDraft);
    if (!draft) return;
    state.settings = structuredClone(draft.settings);
    state.placements = structuredClone(draft.placements);
    renderAll();
  }
  if (deleteButton) {
    state.drafts = state.drafts.filter((item) => item.id !== deleteButton.dataset.deleteDraft);
    renderAll();
  }
});

renderAll();
