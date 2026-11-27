// ====================================================================
// 3空間感性・観光地推薦 検証プロトタイプ
// （ステップ1〜5明示 / 時系列レイアウト / 神戸・京都対応 最終版）
// ====================================================================

const DATASETS = {
  kobe: {
    label: "神戸",
    sqlPath: "./data_kobe.sql",
    defaultRadius: 2.0,
    presets: [
      { label: "三ノ宮駅 (34.6946, 135.1950)", lat: 34.6946, lng: 135.1950 },
      { label: "新神戸駅 (34.7064, 135.1959)", lat: 34.7064, lng: 135.1959 },
      { label: "元町駅 (34.6895, 135.1871)", lat: 34.6895, lng: 135.1871 },
      { label: "神戸ポートタワー (34.6826, 135.1867)", lat: 34.6826, lng: 135.1867 },
      { label: "須磨海浜公園 (34.6423, 135.1198)", lat: 34.6423, lng: 135.1198 },
      { label: "舞子駅周辺 (34.6334, 135.0341)", lat: 34.6334, lng: 135.0341 }
    ]
  },
  kyoto: {
    label: "京都",
    sqlPath: "./data_kyoto.sql",
    defaultRadius: 2.0,
    presets: [
      { label: "京都駅 (34.9858, 135.7588)", lat: 34.9858, lng: 135.7588 },
      { label: "四条河原町 (35.0038, 135.7693)", lat: 35.0038, lng: 135.7693 },
      { label: "清水寺周辺 (34.9949, 135.7850)", lat: 34.9949, lng: 135.7850 },
      { label: "嵐山・渡月橋 (35.0134, 135.6778)", lat: 35.0134, lng: 135.6778 },
      { label: "金閣寺周辺 (35.0394, 135.7292)", lat: 35.0394, lng: 135.7292 },
      { label: "伏見稲荷大社 (34.9671, 135.7727)", lat: 34.9671, lng: 135.7727 },
      { label: "宇治・平等院 (34.8893, 135.8077)", lat: 34.8893, lng: 135.8077 },
      { label: "天橋立 (35.5698, 135.1918)", lat: 35.5698, lng: 135.1918 }
    ]
  }
};

const MS_WORDS = [
  "スムーズな", "賑やかな", "単調な", "道に迷わない", "開放的な",
  "交通手段が便利", "勾配がある", "殺風景な", "歩行空間にゆとりがある", "道幅が広い",
  "歴史的な", "緑豊かな", "安心感がある", "非日常的な", "落ち着いた",
  "きれい", "快適", "見晴らしの良い", "静寂な"
];

const SS_WORDS = [
  "快適", "荘厳な", "落ち着いた", "非日常的な", "洋風な",
  "和風な", "きれい", "モダンな", "開放的な", "こぢんまりした",
  "平坦な", "静寂な", "緑豊かな", "明るい", "見晴らしの良い",
  "雨が避けられる", "賑やかな"
];

const AS_WORDS = [
  "楽しい", "賑やかな", "はしゃぐ", "ワイワイ", "ワクワク",
  "ゆっくり", "落ち着いた", "癒す", "まったり", "ゆったりとした",
  "晴れる気がする", "田舎", "きれい", "おいしい", "文化的な",
  "歴史的な", "面白い", "非日常的な"
];

const DEFAULT_SELECTED = ["スムーズな", "快適", "落ち着いた", "静寂な", "ゆっくり", "非日常的な"];

// 大局観の重みを (1.0, 1.0, 1.0) に設定
const EVAL_TYPES = [
  { key: "taikyoku", label: "(i) 大局観 (1.0, 1.0, 1.0)", wMS: 1.0, wSS: 1.0, wAS: 1.0 },
  { key: "move",     label: "(ii) 移動型 (1.0, 0.1, 0.1)", wMS: 1.0, wSS: 0.1, wAS: 0.1 },
  { key: "stay",     label: "(iii) 滞在型 (0.1, 1.0, 0.1)", wMS: 0.1, wSS: 1.0, wAS: 0.1 },
  { key: "act",      label: "(iv) 活動型 (0.1, 0.1, 1.0)", wMS: 0.1, wSS: 0.1, wAS: 1.0 },
  { key: "ms_ss",    label: "(v) 移動・滞在型 (0.5, 0.5, 0.1)", wMS: 0.5, wSS: 0.5, wAS: 0.1 },
  { key: "ms_as",    label: "(vi) 移動・活動型 (0.5, 0.1, 0.5)", wMS: 0.5, wSS: 0.1, wAS: 0.5 },
  { key: "ss_as",    label: "(vii) 滞在・活動型 (0.1, 0.5, 0.5)", wMS: 0.1, wSS: 0.5, wAS: 0.5 }
];

// 全40語（重複除去・出現順）
const ALL_WORDS = [];
const WORD_SPACES = {};
for (const w of [...MS_WORDS, ...SS_WORDS, ...AS_WORDS]) {
  if (!WORD_SPACES[w]) {
    ALL_WORDS.push(w);
    WORD_SPACES[w] = {
      ms: MS_WORDS.includes(w),
      ss: SS_WORDS.includes(w),
      as: AS_WORDS.includes(w)
    };
  }
}

let SQL = null;
let db = null;
let currentDatasetKey = "kobe";
const sqlTextCache = {};
let lastRows = [];

// --------------------------------------------------------------------
// 初期化
// --------------------------------------------------------------------
async function initApp() {
  applyChronologicalLayout();
  buildEvalSelect();
  buildWordsGrid();
  bindEvents();

  setStatus("SQLiteエンジン起動中...", "loading");
  try {
    SQL = await initSqlJs({
      locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
    });
    await loadDataset("kobe");
  } catch (err) {
    console.error(err);
    setStatus(`初期化エラー: ${err.message}`, "error");
  }
}

// 計算手順どおりの時系列順（②空間別相関量 → ③評価関数GE → ③-2一括比較）へ配置変更
function applyChronologicalLayout() {
  const top5Section = document.getElementById("top5-table")?.closest("section.card");
  const compareSection = document.getElementById("compare-table")?.closest("section.card");
  const allRankingSection = document.getElementById("all-ranking-table")?.closest("section.card");

  if (top5Section && compareSection && allRankingSection && top5Section.parentElement) {
    // 空間別相関量ランキングを評価関数GEより前に配置
    top5Section.parentElement.insertBefore(allRankingSection, top5Section);

    // 見出し番号を時系列に更新
    const allTitle = allRankingSection.querySelector(".section-title");
    if (allTitle) {
      allTitle.innerHTML = '② 空間別相関量ランキング（絞り込み全件）<span id="hit-count" class="hit-count"></span>';
    }
    const top5Title = top5Section.querySelector(".section-title");
    if (top5Title) {
      top5Title.textContent = "③ 評価関数 GE による推薦結果（上位5位）";
    }
    const compareTitle = compareSection.querySelector(".section-title");
    if (compareTitle) {
      compareTitle.textContent = "③-2 全7タイプ + 総合空間（比較基準）一括比較（上位5位）";
    }

    // ②の全件テーブルを縦スクロール枠（ヘッダー固定）にする
    const wrap = allRankingSection.querySelector(".table-wrap");
    if (wrap) {
      wrap.style.maxHeight = "340px";
      wrap.style.overflowY = "auto";
      wrap.style.borderBottom = "1px solid #e5e7eb";
    }
    allRankingSection.querySelectorAll("#all-ranking-table thead th").forEach((th) => {
      th.style.position = "sticky";
      th.style.top = "0";
      th.style.zIndex = "1";
    });
  }
}

function setStatus(text, type) {
  const el = document.getElementById("db-status");
  el.textContent = text;
  el.className = `status-badge ${type}`;
}

async function loadDataset(datasetKey) {
  const cfg = DATASETS[datasetKey];
  if (!cfg || !SQL) return;
  currentDatasetKey = datasetKey;

  setStatus(`${cfg.label}データ読み込み中... (${cfg.sqlPath})`, "loading");
  try {
    if (!sqlTextCache[datasetKey]) {
      const res = await fetch(cfg.sqlPath);
      if (!res.ok) throw new Error(`${cfg.sqlPath} の読み込みに失敗しました (HTTP ${res.status})`);
      sqlTextCache[datasetKey] = await res.text();
    }

    if (db) db.close();
    db = new SQL.Database();
    registerMathFunctions(db);
    db.run(sqlTextCache[datasetKey]);

    const countRes = db.exec("SELECT COUNT(*) FROM spots;");
    const spotCount = countRes[0].values[0][0];

    populatePresets(cfg);
    document.getElementById("radius-input").value = cfg.defaultRadius.toFixed(1);

    setStatus(`DB準備完了（登録スポット：${spotCount.toLocaleString()}地点 / ${cfg.sqlPath}）`, "ready");
    runCalculation();
  } catch (err) {
    console.error(err);
    setStatus(`読み込みエラー: ${err.message}`, "error");
  }
}

function registerMathFunctions(database) {
  database.create_function("RADIANS", (deg) => (deg * Math.PI) / 180);
  database.create_function("SIN", (x) => Math.sin(x));
  database.create_function("COS", (x) => Math.cos(x));
  database.create_function("ACOS", (x) => Math.acos(Math.max(-1, Math.min(1, x))));
  database.create_function("SQRT", (x) => Math.sqrt(Math.max(0, x)));
  database.create_function("POW", (x, y) => Math.pow(x, y));
}

// --------------------------------------------------------------------
// UI構築
// --------------------------------------------------------------------
function populatePresets(cfg) {
  const sel = document.getElementById("preset-select");
  sel.innerHTML = "";
  cfg.presets.forEach((p, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = p.label;
    sel.appendChild(opt);
  });
  if (cfg.presets.length > 0) {
    document.getElementById("lat-input").value = cfg.presets[0].lat.toFixed(4);
    document.getElementById("lng-input").value = cfg.presets[0].lng.toFixed(4);
  }
}

function buildEvalSelect() {
  const sel = document.getElementById("eval-type-select");
  sel.innerHTML = "";
  EVAL_TYPES.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.key;
    opt.textContent = t.label;
    if (t.key === "move") opt.selected = true;
    sel.appendChild(opt);
  });
}

function buildWordsGrid() {
  const grid = document.getElementById("words-grid");
  grid.innerHTML = "";
  ALL_WORDS.forEach((w) => {
    const sp = WORD_SPACES[w];
    const label = document.createElement("label");
    label.className = "word-chip";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = w;
    cb.checked = DEFAULT_SELECTED.includes(w);
    if (cb.checked) label.classList.add("selected");

    cb.addEventListener("change", () => {
      label.classList.toggle("selected", cb.checked);
      runCalculation();
    });

    const textSpan = document.createElement("span");
    textSpan.className = "word-text";
    textSpan.textContent = w;

    const badges = document.createElement("span");
    badges.className = "badge-group";
    if (sp.ms) badges.innerHTML += '<span class="badge ms">移</span>';
    if (sp.ss) badges.innerHTML += '<span class="badge ss">滞</span>';
    if (sp.as) badges.innerHTML += '<span class="badge as">活</span>';

    label.appendChild(cb);
    label.appendChild(textSpan);
    label.appendChild(badges);
    grid.appendChild(label);
  });
}

function bindEvents() {
  document.getElementById("preset-select").addEventListener("change", (e) => {
    const idx = Number(e.target.value);
    const p = DATASETS[currentDatasetKey].presets[idx];
    if (p) {
      document.getElementById("lat-input").value = p.lat.toFixed(4);
      document.getElementById("lng-input").value = p.lng.toFixed(4);
      runCalculation();
    }
  });

  ["lat-input", "lng-input", "radius-input"].forEach((id) => {
    document.getElementById(id).addEventListener("input", runCalculation);
  });

  document.querySelectorAll('input[name="combined-mode"]').forEach((r) => {
    r.addEventListener("change", runCalculation);
  });

  document.querySelectorAll('input[name="dataset-mode"]').forEach((r) => {
    r.addEventListener("change", (e) => {
      loadDataset(e.target.value);
    });
  });

  document.getElementById("eval-type-select").addEventListener("change", renderTables);

  document.getElementById("default-words-btn").addEventListener("click", () => {
    setSelectedWords(DEFAULT_SELECTED);
    runCalculation();
  });

  document.getElementById("clear-words-btn").addEventListener("click", () => {
    setSelectedWords([]);
    runCalculation();
  });

  document.getElementById("gps-btn").addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("このブラウザはGPS取得に対応していません。");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        document.getElementById("lat-input").value = pos.coords.latitude.toFixed(4);
        document.getElementById("lng-input").value = pos.coords.longitude.toFixed(4);
        runCalculation();
      },
      (err) => alert(`位置情報の取得に失敗しました: ${err.message}`)
    );
  });

  document.getElementById("copy-compare-csv").addEventListener("click", () => copyTableCsv("compare-table"));
  document.getElementById("copy-all-csv").addEventListener("click", () => copyTableCsv("all-ranking-table"));
}

function setSelectedWords(wordList) {
  const set = new Set(wordList);
  document.querySelectorAll("#words-grid input[type='checkbox']").forEach((cb) => {
    cb.checked = set.has(cb.value);
    cb.closest(".word-chip").classList.toggle("selected", cb.checked);
  });
}

function getSelectedWords() {
  const selected = new Set();
  document.querySelectorAll("#words-grid input[type='checkbox']:checked").forEach((cb) => {
    selected.add(cb.value);
  });
  return selected;
}

// --------------------------------------------------------------------
// SQL生成・実行（ステップ1〜4をCTEで明示的に段階実行）
// --------------------------------------------------------------------
function buildDotExpr(alias, words, selectedSet, prefix = "") {
  const terms = words
    .filter((w) => selectedSet.has(w))
    .map((w) => `${alias}.\`${prefix}${w}\``);
  return terms.length > 0 ? terms.join(" + ") : "0.0";
}

function buildNormSqExpr(alias, words, prefix = "") {
  return words
    .map((w) => `(${alias}.\`${prefix}${w}\` * ${alias}.\`${prefix}${w}\`)`)
    .join(" + ");
}

function runCalculation() {
  if (!db) return;
  const lat = parseFloat(document.getElementById("lat-input").value);
  const lng = parseFloat(document.getElementById("lng-input").value);
  const radius = parseFloat(document.getElementById("radius-input").value);
  if (Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(radius)) return;

  const selected = getSelectedWords();
  const mode = document.querySelector('input[name="combined-mode"]:checked').value;

  const qMSCount = MS_WORDS.filter((w) => selected.has(w)).length;
  const qSSCount = SS_WORDS.filter((w) => selected.has(w)).length;
  const qASCount = AS_WORDS.filter((w) => selected.has(w)).length;

  // ステップ4用：各空間の正規化内積
  const dotMS = buildDotExpr("m", MS_WORDS, selected);
  const dotSS = buildDotExpr("s", SS_WORDS, selected);
  const dotAS = buildDotExpr("a", AS_WORDS, selected);

  const normSqMS = buildNormSqExpr("m", MS_WORDS);
  const normSqSS = buildNormSqExpr("s", SS_WORDS);
  const normSqAS = buildNormSqExpr("a", AS_WORDS);

  const xMSExpr = qMSCount === 0
    ? "0.0"
    : `CASE WHEN (${normSqMS}) = 0 THEN 0.0 ELSE (${dotMS}) * 1.0 / (SQRT(${normSqMS}) * SQRT(${qMSCount})) END`;

  const xSSExpr = qSSCount === 0
    ? "0.0"
    : `CASE WHEN (${normSqSS}) = 0 THEN 0.0 ELSE (${dotSS}) * 1.0 / (SQRT(${normSqSS}) * SQRT(${qSSCount})) END`;

  const xASExpr = qASCount === 0
    ? "0.0"
    : `CASE WHEN (${normSqAS}) = 0 THEN 0.0 ELSE (${dotAS}) * 1.0 / (SQRT(${normSqAS}) * SQRT(${qASCount})) END`;

  // ステップ3用：総合空間マトリクス（M'_T）の列定義 & ステップ4の正規化内積
  let combinedSelectCols = "";
  let xAllExpr = "0.0";

  if (mode === "54") {
    const cols = [
      ...MS_WORDS.map((w) => `m.\`${w}\` AS \`ms_${w}\``),
      ...SS_WORDS.map((w) => `s.\`${w}\` AS \`ss_${w}\``),
      ...AS_WORDS.map((w) => `a.\`${w}\` AS \`as_${w}\``)
    ];
    combinedSelectCols = cols.join(",\n      ");

    const q54Count = qMSCount + qSSCount + qASCount;
    if (q54Count > 0) {
      const dot54 = `(${buildDotExpr("c", MS_WORDS, selected, "ms_")}) + (${buildDotExpr("c", SS_WORDS, selected, "ss_")}) + (${buildDotExpr("c", AS_WORDS, selected, "as_")})`;
      const normSq54 = `(${buildNormSqExpr("c", MS_WORDS, "ms_")}) + (${buildNormSqExpr("c", SS_WORDS, "ss_")}) + (${buildNormSqExpr("c", AS_WORDS, "as_")})`;
      xAllExpr = `CASE WHEN (${normSq54}) = 0 THEN 0.0 ELSE (${dot54}) * 1.0 / (SQRT(${normSq54}) * SQRT(${q54Count})) END`;
    }
  } else {
    const cols = ALL_WORDS.map((w) => {
      const parts = [];
      if (WORD_SPACES[w].ms) parts.push(`m.\`${w}\``);
      if (WORD_SPACES[w].ss) parts.push(`s.\`${w}\``);
      if (WORD_SPACES[w].as) parts.push(`a.\`${w}\``);
      return parts.length === 1
        ? `(${parts[0]} * 1.0) AS \`${w}\``
        : `((${parts.join(" + ")}) * 1.0 / ${parts.length}) AS \`${w}\``;
    });
    combinedSelectCols = cols.join(",\n      ");

    const q40Count = selected.size;
    if (q40Count > 0) {
      const dot40 = buildDotExpr("c", ALL_WORDS, selected);
      const normSq40 = buildNormSqExpr("c", ALL_WORDS);
      xAllExpr = `CASE WHEN (${normSq40}) = 0 THEN 0.0 ELSE (${dot40}) * 1.0 / (SQRT(${normSq40}) * SQRT(${q40Count})) END`;
    }
  }

  const distExpr = `6371.0 * ACOS(COS(RADIANS(${lat})) * COS(RADIANS(sp.緯度)) * COS(RADIANS(sp.経度) - RADIANS(${lng})) + SIN(RADIANS(${lat})) * SIN(RADIANS(sp.緯度)))`;

  // 論文のシステム構成図（ステップ1〜4）に完全対応したSQL
  const sql = `
    WITH
    -- ステップ1：観光地絞り込み（大円距離フィルタ）
    step1_spots AS (
      SELECT
        sp.観光地名,
        ${distExpr} AS dist
      FROM spots sp
      WHERE ${distExpr} <= ${radius}
    ),
    -- ステップ2：各空間マトリクスのフィルタリング（M'_m, M'_s, M'_a）
    step2_move AS (
      SELECT m.*
      FROM move_matrix m
      INNER JOIN step1_spots f ON m.観光地名 = f.観光地名
    ),
    step2_stay AS (
      SELECT s.*
      FROM stay_matrix s
      INNER JOIN step1_spots f ON s.観光地名 = f.観光地名
    ),
    step2_act AS (
      SELECT a.*
      FROM space_matrix a
      INNER JOIN step1_spots f ON a.観光地名 = f.観光地名
    ),
    -- ステップ3：各マトリクスを結合して総合空間マトリクス（M'_T）を生成
    step3_combined AS (
      SELECT
        f.観光地名,
        ${combinedSelectCols}
      FROM step1_spots f
      INNER JOIN step2_move m ON f.観光地名 = m.観光地名
      INNER JOIN step2_stay s ON f.観光地名 = s.観光地名
      INNER JOIN step2_act  a ON f.観光地名 = a.観光地名
    )
    -- ステップ4：各空間および総合空間の相関量計算（正規化内積）
    SELECT
      f.観光地名 AS name,
      f.dist AS dist,
      ${xMSExpr} AS x_ms,
      ${xSSExpr} AS x_ss,
      ${xASExpr} AS x_as,
      ${xAllExpr} AS x_all
    FROM step1_spots f
    INNER JOIN step2_move m ON f.観光地名 = m.観光地名
    INNER JOIN step2_stay s ON f.観光地名 = s.観光地名
    INNER JOIN step2_act  a ON f.観光地名 = a.観光地名
    INNER JOIN step3_combined c ON f.観光地名 = c.観光地名
    ORDER BY f.dist ASC, f.観光地名 ASC;
  `;

  try {
    const res = db.exec(sql);
    if (!res.length) {
      lastRows = [];
    } else {
      lastRows = res[0].values.map(([name, dist, x_ms, x_ss, x_as, x_all]) => {
        const row = { name, dist, x_ms, x_ss, x_as, x_all, scores: {} };
        // ステップ5：重み付け表によるタイプ別計算
        EVAL_TYPES.forEach((t) => {
          row.scores[t.key] = t.wMS * x_ms + t.wSS * x_ss + t.wAS * x_as;
        });
        return row;
      });
    }
    renderTables();
  } catch (err) {
    console.error("SQL Error:", err);
  }
}

function sortByMetric(rows, getter) {
  return [...rows].sort((a, b) => {
    const diff = getter(b) - getter(a);
    if (Math.abs(diff) > 1e-12) return diff;
    const distDiff = a.dist - b.dist;
    if (Math.abs(distDiff) > 1e-12) return distDiff;
    return a.name.localeCompare(b.name, "ja");
  });
}

// --------------------------------------------------------------------
// 結果テーブル描画
// --------------------------------------------------------------------
function renderTables() {
  const evalKey = document.getElementById("eval-type-select").value;
  const evalObj = EVAL_TYPES.find((t) => t.key === evalKey) || EVAL_TYPES[0];

  document.getElementById("formula-text").textContent =
    `計算式：T = ${evalObj.wMS} × x_MS (移動) + ${evalObj.wSS} × x_SS (滞在) + ${evalObj.wAS} × x_AS (活動)`;
  document.getElementById("hit-count").textContent = `（該当：${lastRows.length}件）`;

  // ② 空間別相関量ランキング（絞り込み全件）
  const allBody = document.querySelector("#all-ranking-table tbody");
  if (lastRows.length === 0) {
    allBody.innerHTML = '<tr><td colspan="9" class="empty-cell">該当データなし</td></tr>';
  } else {
    const byAll = sortByMetric(lastRows, (r) => r.x_all);
    const byMS  = sortByMetric(lastRows, (r) => r.x_ms);
    const bySS  = sortByMetric(lastRows, (r) => r.x_ss);
    const byAS  = sortByMetric(lastRows, (r) => r.x_as);

    allBody.innerHTML = lastRows.map((_, i) => `
      <tr>
        <td class="num bold">${i + 1}</td>
        <td>${escapeHtml(byAll[i].name)}</td>
        <td class="num">${byAll[i].x_all.toFixed(4)}</td>
        <td>${escapeHtml(byMS[i].name)}</td>
        <td class="num">${byMS[i].x_ms.toFixed(4)}</td>
        <td>${escapeHtml(bySS[i].name)}</td>
        <td class="num">${bySS[i].x_ss.toFixed(4)}</td>
        <td>${escapeHtml(byAS[i].name)}</td>
        <td class="num">${byAS[i].x_as.toFixed(4)}</td>
      </tr>
    `).join("");
  }

  // ③ 評価関数 GE による推薦結果（上位5位）
  const top5Body = document.querySelector("#top5-table tbody");
  const sortedEval = sortByMetric(lastRows, (r) => r.scores[evalKey]).slice(0, 5);
  if (sortedEval.length === 0) {
    top5Body.innerHTML = '<tr><td colspan="8" class="empty-cell">指定範囲内にスポットがありません（検索半径を広げるか、現在地を変更してください）</td></tr>';
  } else {
    top5Body.innerHTML = sortedEval.map((r, i) => `
      <tr>
        <td class="num bold">${i + 1}</td>
        <td>${escapeHtml(r.name)}</td>
        <td class="num bold">${r.scores[evalKey].toFixed(4)}</td>
        <td class="num">${r.dist.toFixed(3)}</td>
        <td class="num">${r.x_ms.toFixed(4)}</td>
        <td class="num">${r.x_ss.toFixed(4)}</td>
        <td class="num">${r.x_as.toFixed(4)}</td>
        <td class="num">${r.x_all.toFixed(4)}</td>
      </tr>
    `).join("");
  }

  // ③-2 全7タイプ + 総合空間 一括比較（上位5位）
  const compareBody = document.querySelector("#compare-table tbody");
  if (lastRows.length === 0) {
    compareBody.innerHTML = '<tr><td colspan="9" class="empty-cell">該当データなし</td></tr>';
  } else {
    const colLists = [
      sortByMetric(lastRows, (r) => r.x_all).map((r) => ({ name: r.name, val: r.x_all, dist: r.dist })),
      ...EVAL_TYPES.map((t) =>
        sortByMetric(lastRows, (r) => r.scores[t.key]).map((r) => ({ name: r.name, val: r.scores[t.key], dist: r.dist }))
      )
    ];
    const maxRank = Math.min(5, lastRows.length);
    let html = "";
    for (let rank = 0; rank < maxRank; rank++) {
      html += `<tr><td class="num bold">${rank + 1}</td>`;
      for (const list of colLists) {
        const item = list[rank];
        html += `<td><div class="spot-name">${escapeHtml(item.name)}</div><div class="spot-meta">${item.val.toFixed(4)} (${item.dist.toFixed(2)}km)</div></td>`;
      }
      html += "</tr>";
    }
    compareBody.innerHTML = html;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

function copyTableCsv(tableId) {
  const rows = Array.from(document.querySelectorAll(`#${tableId} tr`));
  const csv = rows.map((tr) =>
    Array.from(tr.children).map((cell) => {
      const txt = cell.innerText.replace(/\s+/g, " ").trim().replace(/"/g, '""');
      return `"${txt}"`;
    }).join(",")
  ).join("\n");

  navigator.clipboard.writeText(csv).then(() => {
    alert("CSVをクリップボードにコピーしました。");
  });
}

document.addEventListener("DOMContentLoaded", initApp);
