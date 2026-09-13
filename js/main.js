// js/app.js

// デッキの保存キー
const STORAGE_KEY = "vocabDecks_v1";

// デッキ構造: { id: string, name: string, items: [ [left, right], ... ] }
let decks = [];
let currentStudyDeck = null;
let currentStudyIndex = 0;
let currentDirection = "forward"; // "forward" | "reverse"
let currentMode = "input";        // "input" | "view"

document.addEventListener("DOMContentLoaded", () => {
  initViews();
  loadDecksFromStorage();
  renderDeckList();
  populateStudyDeckSelect();
  initHome();
  initStudy();
  initEditor();
});

/* ======================
 * ビュー切り替え
 * ====================== */

function initViews() {
  const tabs = document.querySelectorAll(".nav-tab");
  const views = document.querySelectorAll(".view");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.view;

      tabs.forEach((t) => t.classList.remove("active"));
      views.forEach((v) => v.classList.remove("active"));

      tab.classList.add("active");
      document.getElementById(target).classList.add("active");
    });
  });

  // ホームから制作ページへ
  document.getElementById("go-editor-btn").addEventListener("click", () => {
    switchView("editor-view");
  });
}

function switchView(viewId) {
  const tabs = document.querySelectorAll(".nav-tab");
  const views = document.querySelectorAll(".view");

  views.forEach((v) => v.classList.remove("active"));
  document.getElementById(viewId).classList.add("active");

  tabs.forEach((tab) => {
    if (tab.dataset.view === viewId) {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  });
}

/* ======================
 * ローカルストレージ
 * ====================== */

function loadDecksFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      decks = [];
      return;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      decks = parsed;
    } else {
      decks = [];
    }
  } catch (e) {
    console.error("Failed to load decks", e);
    decks = [];
  }
}

function saveDecksToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

/* ======================
 * ホーム（CSVインポート・一覧）
 * ====================== */

function initHome() {
  const importBtn = document.getElementById("import-csv-btn");
  importBtn.addEventListener("click", handleImportCsv);

  renderDeckList();
}

function handleImportCsv() {
  const fileInput = document.getElementById("csv-input");
  const nameInput = document.getElementById("csv-deck-name");
  const statusEl = document.getElementById("import-status");

  statusEl.textContent = "";
  statusEl.className = "status-message";

  const file = fileInput.files[0];
  if (!file) {
    statusEl.textContent = "CSVファイルを選択してください。";
    statusEl.classList.add("error");
    return;
  }

  const deckName = nameInput.value.trim() || file.name;
  const reader = new FileReader();

  reader.onload = (e) => {
    const text = e.target.result;
    const items = parseCsv(text);
    if (items.length === 0) {
      statusEl.textContent = "有効なデータが見つかりませんでした。";
      statusEl.classList.add("error");
      return;
    }

    const newDeck = {
      id: generateId(),
      name: deckName,
      items
    };

    decks.push(newDeck);
    saveDecksToStorage();
    renderDeckList();
    populateStudyDeckSelect();

    statusEl.textContent = "インポートしました。";
    statusEl.classList.add("success");
    fileInput.value = "";
    nameInput.value = "";
  };

  reader.onerror = () => {
    statusEl.textContent = "ファイルの読み込みに失敗しました。";
    statusEl.classList.add("error");
  };

  reader.readAsText(file, "utf-8");
}

function renderDeckList() {
  const listEl = document.getElementById("deck-list");
  listEl.innerHTML = "";

  if (decks.length === 0) {
    listEl.textContent = "保存されている単語帳はまだありません。";
    return;
  }

  decks.forEach((deck) => {
    const pill = document.createElement("div");
    pill.className = "deck-pill";
    pill.textContent = `${deck.name} (${deck.items.length})`;
    pill.addEventListener("click", () => {
      switchView("study-view");
      const select = document.getElementById("study-deck-select");
      select.value = deck.id;
      onStudyDeckChange();
    });
    listEl.appendChild(pill);
  });
}

/* ======================
 * 学習ビュー
 * ====================== */

function initStudy() {
  const deckSelect = document.getElementById("study-deck-select");
  const directionSelect = document.getElementById("direction-select");
  const modeSelect = document.getElementById("mode-select");

  deckSelect.addEventListener("change", onStudyDeckChange);
  directionSelect.addEventListener("change", () => {
    currentDirection = directionSelect.value;
    resetStudyIndex();
  });
  modeSelect.addEventListener("change", () => {
    currentMode = modeSelect.value;
    updateStudyModeUI();
  });

  // 記述モード
  document.getElementById("input-submit-btn").addEventListener("click", handleInputSubmit);
  document.getElementById("input-next-btn").addEventListener("click", nextQuestion);

  // 閲覧モード
  document.getElementById("view-know-btn").addEventListener("click", () => {
    // わかる → 解答を表示して自己判定
    showViewAnswer();
  });
  document.getElementById("view-dont-know-btn").addEventListener("click", () => {
    // わからない → 誤り扱い
    const resultEl = document.getElementById("view-result");
    resultEl.textContent = "わからない → 誤りとして記録します。";
    resultEl.className = "result-text wrong";
    showViewAnswer();
  });
  document.getElementById("view-correct-btn").addEventListener("click", () => {
    const resultEl = document.getElementById("view-result");
    resultEl.textContent = "正解として記録しました。";
    resultEl.className = "result-text correct";
  });
  document.getElementById("view-wrong-btn").addEventListener("click", () => {
    const resultEl = document.getElementById("view-result");
    resultEl.textContent = "誤りとして記録しました。";
    resultEl.className = "result-text wrong";
  });
  document.getElementById("view-next-btn").addEventListener("click", nextQuestion);

  updateStudyModeUI();
  updateStudyProgress();
}

function populateStudyDeckSelect() {
  const select = document.getElementById("study-deck-select");
  const prevValue = select.value;
  select.innerHTML = "";

  if (decks.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "単語帳がありません";
    select.appendChild(opt);
    currentStudyDeck = null;
    updateStudyAreaDisabled(true);
    return;
  }

  decks.forEach((deck) => {
    const opt = document.createElement("option");
    opt.value = deck.id;
    opt.textContent = `${deck.name} (${deck.items.length})`;
    select.appendChild(opt);
  });

  const match = decks.find((d) => d.id === prevValue);
  if (match) {
    select.value = prevValue;
    currentStudyDeck = match;
  } else {
    select.value = decks[0].id;
    currentStudyDeck = decks[0];
  }

  updateStudyAreaDisabled(false);
  resetStudyIndex();
}

function updateStudyAreaDisabled(disabled) {
  const controls = document.querySelectorAll("#study-view select, #study-view button, #study-view input");
  controls.forEach((el) => {
    if (el.id === "study-deck-select") return;
    el.disabled = disabled;
  });
  if (disabled) {
    document.getElementById("study-progress").textContent = "利用可能な単語帳がありません。";
  } else {
    updateStudyProgress();
  }
}

function onStudyDeckChange() {
  const select = document.getElementById("study-deck-select");
  const deckId = select.value;
  currentStudyDeck = decks.find((d) => d.id === deckId) || null;
  resetStudyIndex();
}

function resetStudyIndex() {
  currentStudyIndex = 0;
  clearStudyMessages();
  loadCurrentQuestion();
  updateStudyProgress();
}

function clearStudyMessages() {
  // 記述
  const inputResult = document.getElementById("input-result");
  inputResult.textContent = "";
  inputResult.className = "result-text";
  document.getElementById("input-answer").value = "";

  // 閲覧
  const viewResult = document.getElementById("view-result");
  viewResult.textContent = "";
  viewResult.className = "result-text";
  document.getElementById("view-answer-area").classList.add("hidden");
  document.getElementById("view-answer").textContent = "";
}

function updateStudyModeUI() {
  const inputModeEl = document.getElementById("input-mode");
  const viewModeEl = document.getElementById("view-mode");

  if (currentMode === "input") {
    inputModeEl.style.display = "block";
    viewModeEl.style.display = "none";
  } else {
    inputModeEl.style.display = "none";
    viewModeEl.style.display = "block";
  }

  clearStudyMessages();
  loadCurrentQuestion();
}

function loadCurrentQuestion() {
  const inputQuestionEl = document.getElementById("input-question");
  const viewQuestionEl = document.getElementById("view-question");

  if (!currentStudyDeck || currentStudyDeck.items.length === 0) {
    inputQuestionEl.textContent = "問題がありません。";
    viewQuestionEl.textContent = "問題がありません。";
    return;
  }

  if (currentStudyIndex >= currentStudyDeck.items.length) {
    currentStudyIndex = currentStudyDeck.items.length - 1;
  }
  if (currentStudyIndex < 0) {
    currentStudyIndex = 0;
  }

  const [left, right] = currentStudyDeck.items[currentStudyIndex];
  const question = currentDirection === "forward" ? left : right;

  inputQuestionEl.textContent = question;
  viewQuestionEl.textContent = question;
}

function handleInputSubmit() {
  if (!currentStudyDeck || currentStudyDeck.items.length === 0) return;

  const userInput = document.getElementById("input-answer").value.trim();
  const resultEl = document.getElementById("input-result");

  const [left, right] = currentStudyDeck.items[currentStudyIndex];
  const correct = currentDirection === "forward" ? right : left;
  const normalizedUser = userInput.replace(/\s+/g, " ");
  const normalizedCorrect = String(correct).trim().replace(/\s+/g, " ");

  if (normalizedUser !== "" && normalizedUser === normalizedCorrect) {
    resultEl.textContent = "正解です。";
    resultEl.className = "result-text correct";
  } else {
    resultEl.textContent = `不正解です。正解: ${correct}`;
    resultEl.className = "result-text wrong";
  }
}

function showViewAnswer() {
  if (!currentStudyDeck || currentStudyDeck.items.length === 0) return;

  const [left, right] = currentStudyDeck.items[currentStudyIndex];
  const answer = currentDirection === "forward" ? right : left;

  const area = document.getElementById("view-answer-area");
  const answerEl = document.getElementById("view-answer");

  answerEl.textContent = String(answer);
  area.classList.remove("hidden");
}

function nextQuestion() {
  if (!currentStudyDeck || currentStudyDeck.items.length === 0) return;

  currentStudyIndex++;
  if (currentStudyIndex >= currentStudyDeck.items.length) {
    currentStudyIndex = 0; // ループさせる
  }
  clearStudyMessages();
  loadCurrentQuestion();
  updateStudyProgress();
}

function updateStudyProgress() {
  const progressEl = document.getElementById("study-progress");
  if (!currentStudyDeck || currentStudyDeck.items.length === 0) {
    progressEl.textContent = "";
    return;
  }
  progressEl.textContent = `問題 ${currentStudyIndex + 1} / ${currentStudyDeck.items.length}`;
}

/* ======================
 * 制作ビュー
 * ====================== */

function initEditor() {
  const addRowBtn = document.getElementById("add-row-btn");
  const saveDeckBtn = document.getElementById("save-deck-btn");
  const downloadCsvBtn = document.getElementById("download-csv-btn");

  addRowBtn.addEventListener("click", addEditorRow);
  saveDeckBtn.addEventListener("click", handleSaveDeckFromEditor);
  downloadCsvBtn.addEventListener("click", handleDownloadCsvFromEditor);

  // 初期行を1つだけ追加
  addEditorRow();
}

function addEditorRow(leftValue = "", rightValue = "") {
  const tbody = document.getElementById("editor-tbody");
  const tr = document.createElement("tr");

  const tdLeft = document.createElement("td");
  const inputLeft = document.createElement("input");
  inputLeft.type = "text";
  inputLeft.className = "editor-row-input";
  inputLeft.value = leftValue;
  tdLeft.appendChild(inputLeft);

  const tdRight = document.createElement("td");
  const inputRight = document.createElement("input");
  inputRight.type = "text";
  inputRight.className = "editor-row-input";
  inputRight.value = rightValue;
  tdRight.appendChild(inputRight);

  const tdOp = document.createElement("td");
  const delBtn = document.createElement("button");
  delBtn.textContent = "削除";
  delBtn.className = "delete-row-btn";
  delBtn.addEventListener("click", () => {
    tbody.removeChild(tr);
  });
  tdOp.appendChild(delBtn);

  tr.appendChild(tdLeft);
  tr.appendChild(tdRight);
  tr.appendChild(tdOp);

  tbody.appendChild(tr);
}

function getEditorRows() {
  const tbody = document.getElementById("editor-tbody");
  const rows = [];
  tbody.querySelectorAll("tr").forEach((tr) => {
    const inputs = tr.querySelectorAll("input");
    if (inputs.length >= 2) {
      const left = inputs[0].value.trim();
      const right = inputs[1].value.trim();
      if (left !== "" || right !== "") {
        rows.push([left, right]);
      }
    }
  });
  return rows;
}

function handleSaveDeckFromEditor() {
  const nameInput = document.getElementById("editor-deck-name");
  const statusEl = document.getElementById("editor-status");

  statusEl.textContent = "";
  statusEl.className = "status-message";

  const deckName = nameInput.value.trim();
  if (!deckName) {
    statusEl.textContent = "単語帳名を入力してください。";
    statusEl.classList.add("error");
    return;
  }

  const rows = getEditorRows();
  if (rows.length === 0) {
    statusEl.textContent = "1行以上データを入力してください。";
    statusEl.classList.add("error");
    return;
  }

  const newDeck = {
    id: generateId(),
    name: deckName,
    items: rows
  };

  decks.push(newDeck);
  saveDecksToStorage();
  renderDeckList();
  populateStudyDeckSelect();

  statusEl.textContent = "単語帳を保存しました。";
  statusEl.classList.add("success");

  // エディタをクリア
  nameInput.value = "";
  const tbody = document.getElementById("editor-tbody");
  tbody.innerHTML = "";
  addEditorRow();
}

function handleDownloadCsvFromEditor() {
  const rows = getEditorRows();
  if (rows.length === 0) {
    const statusEl = document.getElementById("editor-status");
    statusEl.textContent = "CSVに書き出す行がありません。";
    statusEl.className = "status-message error";
    return;
  }

  const csv = rows.map((row) => {
    return row
      .map((cell) => escapeCsvCell(cell))
      .join(",");
  }).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;

  const nameInput = document.getElementById("editor-deck-name");
  const fileNameBase = nameInput.value.trim() || "deck";
  a.download = fileNameBase + ".csv";
  a.style.display = "none";

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ======================
 * CSVユーティリティ
 * ====================== */

// 単純な 2 列 CSV パーサー（カンマ区切り・改行区切り）
function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  const items = [];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // 簡易処理: ダブルクオート対応だが厳密ではない
    const cells = splitCsvLine(line);
    if (cells.length < 2) continue;

    const left = cells[0].trim();
    const right = cells[1].trim();
    if (left === "" && right === "") continue;

    items.push([left, right]);
  }

  return items;
}

// 1 行をカンマで区切る（クオート対応の簡易版）
function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // 連続する "" はエスケープされた "
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// CSVセルのエスケープ
function escapeCsvCell(cell) {
  if (cell == null) return "";
  const str = String(cell);
  if (/[",\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/* ======================
 * 汎用ユーティリティ
 * ====================== */

function generateId() {
  return "deck_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
}
