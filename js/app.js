// js/app.js

// デッキの保存キー
const STORAGE_KEY = "vocabDecks_v1";

// デッキ構造: { id: string, name: string, items: [ [left, right], ... ] }
let decks = [];
let currentStudyDeck = null;

// 学習設定
let currentDirection = "forward"; // "forward" | "reverse"
let currentMode = "input";        // "input" | "view"

// 学習状態
let isStudyStarted = false;

// ラウンド管理（1周分）
let sessionIndices = [];   // 今のラウンドで出題する index 列（元デッキの index）
let sessionPosition = 0;   // sessionIndices 内での現在位置
let currentStudyIndex = 0; // 実際に参照しているデッキ index

// 結果集計
let studyStartTime = null; // ms
let correctCount = 0;
let wrongCount = 0;
let answeredCount = 0;
let wrongIndices = [];     // このラウンドで誤答した index 一覧（元デッキ）

// 直近の回答結果
let lastResultType = null; // "correct" | "wrong" | null

// 自動で次へ進むためのタイマーID
let nextTimerId = null;

document.addEventListener("DOMContentLoaded", () => {
  loadDecksFromStorage();
  renderDeckList();
  initHome();
  initStudy();
  initEditor();
});

/* ======================
 * ホーム
 * ====================== */

function initHome() {
  const importBtn = document.getElementById("import-csv-btn");
  importBtn.addEventListener("click", handleImportCsv);

  const openEditorBtn = document.getElementById("open-editor-btn");
  openEditorBtn.addEventListener("click", () => {
    openModal("editor-modal");
  });
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
  const tbody = document.getElementById("deck-list");
  const badge = document.getElementById("deck-count-badge");
  tbody.innerHTML = "";

  if (decks.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.textContent = "保存されている単語帳はまだありません。";
    td.style.textAlign = "center";
    tr.appendChild(td);
    tbody.appendChild(tr);
    if (badge) badge.textContent = "0件";
    return;
  }

  if (badge) badge.textContent = `${decks.length}件`;

  decks.forEach((deck) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.className = "deck-name-cell col-name";
    nameTd.textContent = deck.name;

    const countTd = document.createElement("td");
    countTd.className = "col-count";
    countTd.textContent = deck.items.length;

    const actionTd = document.createElement("td");
    actionTd.className = "col-action";
    const btn = document.createElement("button");
    btn.className = "primary-btn";
    btn.textContent = "学習";
    btn.addEventListener("click", () => {
      openModal("study-modal");
      populateStudyDeckSelect(deck.id);
      isStudyStarted = false;
      showStudySetup();
    });
    actionTd.appendChild(btn);

    tr.appendChild(nameTd);
    tr.appendChild(countTd);
    tr.appendChild(actionTd);
    tbody.appendChild(tr);
  });
}

/* ======================
 * モーダル制御（アニメーション + 背景クリックで閉じる）
 * ====================== */

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  const panel = modal.querySelector(".modal-panel-bottom");

  modal.classList.remove("hidden");
  modal.classList.add("is-open", "is-opening");
  modal.classList.remove("is-closing");

  if (panel) {
    panel.classList.add("is-opening");
    panel.classList.remove("is-closing");
  }

  const backdropClickHandler = (event) => {
    if (event.target === modal) {
      closeModal(id);
    }
  };
  // 簡易的に onclick をリセットしてから追加（多重登録防止）
  modal.onclick = null;
  modal.addEventListener("click", backdropClickHandler, { once: false });
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  const panel = modal.querySelector(".modal-panel-bottom");

  modal.classList.remove("is-opening");
  modal.classList.add("is-closing");

  if (panel) {
    panel.classList.remove("is-opening");
    panel.classList.add("is-closing");
  }

  const handleAnimationEnd = (event) => {
    if (event.target !== modal) return;

    modal.classList.add("hidden");
    modal.classList.remove("is-open", "is-closing", "is-opening");

    if (panel) {
      panel.classList.remove("is-closing", "is-opening");
    }

    modal.removeEventListener("animationend", handleAnimationEnd);
  };

  modal.addEventListener("animationend", handleAnimationEnd, { once: true });
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
 * 学習モーダル
 * ====================== */

function initStudy() {
  const deckSelect = document.getElementById("study-deck-select");
  const directionSelect = document.getElementById("direction-select");
  const modeSelect = document.getElementById("mode-select");

  deckSelect.addEventListener("change", () => {
    const deckId = deckSelect.value;
    currentStudyDeck = decks.find((d) => d.id === deckId) || null;
  });

  directionSelect.addEventListener("change", () => {
    currentDirection = directionSelect.value;
  });

  modeSelect.addEventListener("change", () => {
    currentMode = modeSelect.value;
    updateStudyModeUI();
  });

  // この設定で開始（フルセット）
  document.getElementById("study-start-btn").addEventListener("click", () => {
    const statusEl = document.getElementById("study-setup-status");
    statusEl.textContent = "";
    statusEl.className = "status-message";

    if (!currentStudyDeck || currentStudyDeck.items.length === 0) {
      statusEl.textContent = "有効な単語帳が選択されていません。";
      statusEl.classList.add("error");
      return;
    }

    startNewSessionAll();
  });

  // 設定に戻る
  document.getElementById("study-back-to-setup-btn").addEventListener("click", () => {
    cancelNextTimer();
    isStudyStarted = false;
    showStudySetup();
  });

  // 閉じる
  document.getElementById("study-close-btn").addEventListener("click", () => {
    cancelNextTimer();
    closeModal("study-modal");
    isStudyStarted = false;
    showStudySetup();
  });

  // 結果画面のボタン
  const retryWrongBtn = document.getElementById("result-retry-wrong");
  const retryAllBtn = document.getElementById("result-retry-all");
  const resultBackBtn = document.getElementById("result-back-to-setup");

  if (retryWrongBtn) {
    retryWrongBtn.addEventListener("click", () => {
      cancelNextTimer();
      if (!currentStudyDeck || wrongIndices.length === 0) {
        startNewSessionAll();
      } else {
        startNewSessionWrongOnly();
      }
    });
  }

  if (retryAllBtn) {
    retryAllBtn.addEventListener("click", () => {
      cancelNextTimer();
      startNewSessionAll();
    });
  }

  if (resultBackBtn) {
    resultBackBtn.addEventListener("click", () => {
      cancelNextTimer();
      isStudyStarted = false;
      showStudySetup();
    });
  }

  // 記述モード: ボタン
  document.getElementById("input-submit-btn").addEventListener("click", () => {
    handleInputSubmitAndScheduleNext();
  });

  // 記述欄: Enter で答え合わせ（改行はさせない）
  const inputAnswer = document.getElementById("input-answer");
  inputAnswer.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleInputSubmitAndScheduleNext();
    }
  });

  // 閲覧モード
  document.getElementById("view-know-btn").addEventListener("click", () => {
    lastResultType = "correct";
    showViewAnswer();
    scheduleNextQuestion();
  });
  document.getElementById("view-dont-know-btn").addEventListener("click", () => {
    lastResultType = "wrong";
    const resultEl = document.getElementById("view-result");
    resultEl.textContent = "わからない → 誤りとして記録します。";
    resultEl.className = "result-text wrong";
    showViewAnswer();
    scheduleNextQuestion();
  });
  document.getElementById("view-correct-btn").addEventListener("click", () => {
    lastResultType = "correct";
    const resultEl = document.getElementById("view-result");
    resultEl.textContent = "正解として記録しました。";
    resultEl.className = "result-text correct";
  });
  document.getElementById("view-wrong-btn").addEventListener("click", () => {
    lastResultType = "wrong";
    const resultEl = document.getElementById("view-result");
    resultEl.textContent = "誤りとして記録しました。";
    resultEl.className = "result-text wrong";
  });

  populateStudyDeckSelect();
  updateStudyModeUI();
  updateStudyProgress();
  showStudySetup();
}

/* ---- セッション開始系 ---- */

function startNewSessionAll() {
  if (!currentStudyDeck || currentStudyDeck.items.length === 0) return;

  sessionIndices = Array.from({ length: currentStudyDeck.items.length }, (_, i) => i);
  sessionPosition = 0;
  currentStudyIndex = sessionIndices[0];

  prepareNewRoundState();
  showStudySession();
  loadCurrentQuestion();
  updateStudyProgress();
}

function startNewSessionWrongOnly() {
  if (!currentStudyDeck || wrongIndices.length === 0) {
    startNewSessionAll();
    return;
  }

  sessionIndices = wrongIndices.slice();
  sessionPosition = 0;
  currentStudyIndex = sessionIndices[0];

  prepareNewRoundState();
  showStudySession();
  loadCurrentQuestion();
  updateStudyProgress();
}

function prepareNewRoundState() {
  isStudyStarted = true;
  studyStartTime = Date.now();
  correctCount = 0;
  wrongCount = 0;
  answeredCount = 0;
  wrongIndices = [];
  lastResultType = null;

  cancelNextTimer();
  clearStudyMessages();
  hideStudyResult();
}

/* ---- 画面切り替え ---- */

function populateStudyDeckSelect(preferId = null) {
  const select = document.getElementById("study-deck-select");
  const prevValue = preferId || select.value;
  select.innerHTML = "";

  if (decks.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "単語帳がありません";
    select.appendChild(opt);
    currentStudyDeck = null;
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
}

function showStudySetup() {
  const setup = document.getElementById("study-setup");
  const session = document.getElementById("study-session");
  const resultSec = document.getElementById("study-result");

  setup.classList.remove("hidden");
  session.classList.add("hidden");
  if (resultSec) resultSec.classList.add("hidden");
}

function showStudySession() {
  const setup = document.getElementById("study-setup");
  const session = document.getElementById("study-session");
  const resultSec = document.getElementById("study-result");

  setup.classList.add("hidden");
  session.classList.remove("hidden");
  if (resultSec) resultSec.classList.add("hidden");
}

function showStudyResult() {
  const setup = document.getElementById("study-setup");
  const session = document.getElementById("study-session");
  const resultSec = document.getElementById("study-result");

  if (setup) setup.classList.add("hidden");
  if (session) session.classList.add("hidden");
  if (resultSec) resultSec.classList.remove("hidden");
}

function hideStudyResult() {
  const resultSec = document.getElementById("study-result");
  if (resultSec) resultSec.classList.add("hidden");
}
/* ======================
 * ラウンド進行・結果表示
 * ====================== */

function resetStudyIndex() {
  sessionPosition = 0;
  if (sessionIndices.length > 0) {
    currentStudyIndex = sessionIndices[0];
  } else if (currentStudyDeck) {
    currentStudyIndex = 0;
  }
  clearStudyMessages();
  loadCurrentQuestion();
  updateStudyProgress();
}

function clearStudyMessages() {
  const inputResult = document.getElementById("input-result");
  if (inputResult) {
    inputResult.textContent = "";
    inputResult.className = "result-text";
  }
  const ansInput = document.getElementById("input-answer");
  if (ansInput) ansInput.value = "";

  const viewResult = document.getElementById("view-result");
  if (viewResult) {
    viewResult.textContent = "";
    viewResult.className = "result-text";
  }
  const answerArea = document.getElementById("view-answer-area");
  if (answerArea) answerArea.classList.add("hidden");
  const answerEl = document.getElementById("view-answer");
  if (answerEl) answerEl.textContent = "";

  lastResultType = null;
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

  if (isStudyStarted) {
    clearStudyMessages();
    loadCurrentQuestion();
  }
}

function loadCurrentQuestion() {
  const inputQuestionEl = document.getElementById("input-question");
  const viewQuestionEl = document.getElementById("view-question");

  if (!currentStudyDeck || currentStudyDeck.items.length === 0) {
    inputQuestionEl.textContent = "問題がありません。";
    viewQuestionEl.textContent = "問題がありません。";
    return;
  }

  if (sessionIndices.length === 0) {
    sessionIndices = Array.from({ length: currentStudyDeck.items.length }, (_, i) => i);
  }
  if (sessionPosition >= sessionIndices.length) {
    sessionPosition = sessionIndices.length - 1;
  }
  if (sessionPosition < 0) sessionPosition = 0;

  currentStudyIndex = sessionIndices[sessionPosition];

  const [left, right] = currentStudyDeck.items[currentStudyIndex];
  const question = currentDirection === "forward" ? left : right;

  inputQuestionEl.textContent = question;
  viewQuestionEl.textContent = question;
}

/* ---- 記述モード: 判定＋自動で次へ ---- */

function handleInputSubmitAndScheduleNext() {
  if (!isStudyStarted) return;
  if (!currentStudyDeck || currentStudyDeck.items.length === 0) return;

  handleInputSubmit();
  scheduleNextQuestion();
}

function handleInputSubmit() {
  const userInput = document.getElementById("input-answer").value.trim();
  const resultEl = document.getElementById("input-result");

  const [left, right] = currentStudyDeck.items[currentStudyIndex];
  const correct = currentDirection === "forward" ? right : left;
  const normalizedUser = userInput.replace(/\s+/g, " ");
  const normalizedCorrect = String(correct).trim().replace(/\s+/g, " ");

  if (normalizedUser !== "" && normalizedUser === normalizedCorrect) {
    lastResultType = "correct";
    resultEl.textContent = "正解です。";
    resultEl.className = "result-text correct";
  } else {
    lastResultType = "wrong";
    resultEl.textContent = `不正解です。正解: ${correct}`;
    resultEl.className = "result-text wrong";
  }
}

/* ---- 閲覧モード: 解答表示 ---- */

function showViewAnswer() {
  if (!isStudyStarted) return;
  if (!currentStudyDeck || currentStudyDeck.items.length === 0) return;

  const [left, right] = currentStudyDeck.items[currentStudyIndex];
  const answer = currentDirection === "forward" ? right : left;

  const area = document.getElementById("view-answer-area");
  const answerEl = document.getElementById("view-answer");

  answerEl.textContent = String(answer);
  area.classList.remove("hidden");
}

/* ---- 次の問題へ（5秒後自動） ---- */

function scheduleNextQuestion() {
  cancelNextTimer();
  nextTimerId = setTimeout(() => {
    nextQuestion();
  }, 5000);
}

function cancelNextTimer() {
  if (nextTimerId != null) {
    clearTimeout(nextTimerId);
    nextTimerId = null;
  }
}

function nextQuestion() {
  if (!isStudyStarted) return;
  if (!currentStudyDeck || currentStudyDeck.items.length === 0) return;

  // 直前の問題の結果を集計
  if (lastResultType === "correct") {
    correctCount++;
    answeredCount++;
  } else if (lastResultType === "wrong") {
    wrongCount++;
    answeredCount++;
    if (!wrongIndices.includes(currentStudyIndex)) {
      wrongIndices.push(currentStudyIndex);
    }
  }
  lastResultType = null;

  // 次の問題へ進む or 結果表示
  sessionPosition++;
  if (sessionPosition >= sessionIndices.length) {
    finishSession();
    return;
  }

  clearStudyMessages();
  loadCurrentQuestion();
  updateStudyProgress();
}

/* ---- 終了 → 結果表示 ---- */

function finishSession() {
  isStudyStarted = false;
  cancelNextTimer();

  const endTime = Date.now();
  const elapsedMs = studyStartTime ? endTime - studyStartTime : 0;

  const total = sessionIndices.length;
  const correct = correctCount;
  const wrong = wrongCount;
  const rate = total > 0 ? Math.round((correct / total) * 100) : 0;

  const timeEl = document.getElementById("result-time");
  const totalEl = document.getElementById("result-total");
  const correctEl = document.getElementById("result-correct");
  const wrongEl = document.getElementById("result-wrong");
  const rateEl = document.getElementById("result-rate");

  if (timeEl) timeEl.textContent = formatElapsedTime(elapsedMs);
  if (totalEl) totalEl.textContent = String(total);
  if (correctEl) correctEl.textContent = String(correct);
  if (wrongEl) wrongEl.textContent = String(wrong);
  if (rateEl) rateEl.textContent = `${rate}%`;

  showStudyResult();
}

/* ---- 進捗表示 ---- */

function updateStudyProgress() {
  const progressEl = document.getElementById("study-progress");
  if (!currentStudyDeck || currentStudyDeck.items.length === 0 || !isStudyStarted) {
    if (progressEl) progressEl.textContent = "";
    return;
  }
  const total = sessionIndices.length || currentStudyDeck.items.length;
  if (progressEl) {
    progressEl.textContent = `問題 ${sessionPosition + 1} / ${total}`;
  }
}

/* ---- 経過時間フォーマット ---- */

function formatElapsedTime(ms) {
  if (!ms || ms < 0) return "-";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) {
    return `${sec}秒`;
  }
  return `${min}分${sec}秒`;
}

/* ======================
 * 制作モーダル
 * ====================== */

function initEditor() {
  const addRowBtn = document.getElementById("add-row-btn");
  const saveDeckBtn = document.getElementById("save-deck-btn");
  const downloadCsvBtn = document.getElementById("download-csv-btn");
  const editorCloseBtn = document.getElementById("editor-close-btn");

  addRowBtn.addEventListener("click", () => addEditorRow());
  saveDeckBtn.addEventListener("click", handleSaveDeckFromEditor);
  downloadCsvBtn.addEventListener("click", handleDownloadCsvFromEditor);

  editorCloseBtn.addEventListener("click", () => {
    closeModal("editor-modal");
  });

  addEditorRow();
}

function addEditorRow(leftValue = "", rightValue = "") {
  const tbody = document.getElementById("editor-tbody");
  const tr = document.createElement("tr");

  const tdLeft = document.createElement("td");
  tdLeft.className = "center-cell";
  const inputLeft = document.createElement("input");
  inputLeft.type = "text";
  inputLeft.className = "editor-row-input";
  inputLeft.value = leftValue;
  tdLeft.appendChild(inputLeft);

  const tdRight = document.createElement("td");
  tdRight.className = "center-cell";
  const inputRight = document.createElement("input");
  inputRight.type = "text";
  inputRight.className = "editor-row-input";
  inputRight.value = rightValue;
  tdRight.appendChild(inputRight);

  const tdOp = document.createElement("td");
  tdOp.className = "center-cell";
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

  nameInput.value = "";
  const tbody = document.getElementById("editor-tbody");
  tbody.innerHTML = "";
  addEditorRow();
}

function handleDownloadCsvFromEditor() {
  const rows = getEditorRows();
  const statusEl = document.getElementById("editor-status");

  if (rows.length === 0) {
    statusEl.textContent = "CSVに書き出す行がありません。";
    statusEl.className = "status-message error";
    return;
  }

  const csv = rows
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
    .join("\n");

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

  statusEl.textContent = "CSVをダウンロードしました。";
  statusEl.className = "status-message success";
}

/* ======================
 * CSVユーティリティ
 * ====================== */

function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  const items = [];

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    const cells = splitCsvLine(line);
    if (cells.length < 2) continue;

    const left = cells[0].trim();
    const right = cells[1].trim();
    if (left === "" && right === "") continue;

    items.push([left, right]);
  }

  return items;
}

// 1行をカンマで区切る（簡易クオート対応）
function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
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
