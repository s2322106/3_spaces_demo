// =========================================================================
// 設定エリア（将来データセットや語彙を入れ替える場合はここを変更）
// =========================================================================
const DATA_SQL_PATH = "./data_kobe.sql";

// 各空間の印象語定義（移動 → 滞在 → 活動 の順で統一）
const MOVE_WORDS = [
  "スムーズな", "賑やかな", "単調な", "道に迷わない", "開放的な",
  "交通手段が便利", "勾配がある", "殺風景な", "歩行空間にゆとりがある", "道幅が広い",
  "歴史的な", "緑豊かな", "安心感がある", "非日常的な", "落ち着いた",
  "きれい", "快適", "見晴らしの良い", "静寂な"
];

const STAY_WORDS = [
  "快適", "荘厳な", "落ち着いた", "非日常的な", "洋風な",
  "和風な", "きれい", "モダンな", "開放的な", "こぢんまりした",
  "平坦な", "静寂な", "緑豊かな", "明るい", "見晴らしの良い",
  "雨が避けられる", "賑やかな"
];

const SPACE_WORDS = [
  "楽しい", "賑やかな", "はしゃぐ", "ワイワイ", "ワクワク",
  "ゆっくり", "落ち着いた", "癒す", "まったり", "ゆったりとした",
  "晴れる気がする", "田舎", "きれい", "おいしい", "文化的な",
  "歴史的な", "面白い", "非日常的な"
];

// 評価関数 GE の7タイプ定義（移動 w_MS, 滞在 w_SS, 活動 w_AS）
const GE_TYPES = [
  { key: "grand",      label: "(i) 大局観",        w: [0.5, 0.5, 0.5], col: "grand_score" },
  { key: "move",       label: "(ii) 移動型",       w: [1.0, 0.1, 0.1], col: "move_score" },
  { key: "stay",       label: "(iii) 滞在型",      w: [0.1, 1.0, 0.1], col: "stay_score" },
  { key: "space",      label: "(iv) 活動型",       w: [0.1, 0.1, 1.0], col: "space_score" },
  { key: "move_stay",  label: "(v) 移動・滞在型",  w: [0.5, 0.5, 0.1], col: "mv_st_score" },
  { key: "move_space", label: "(vi) 移動・活動型", w: [0.5, 0.1, 0.5], col: "mv_sp_score" },
  { key: "stay_space", label: "(vii) 滞在・活動型",w: [0.1, 0.5, 0.5], col: "st_sp_score" }
];

// 実験用デフォルト6語（DB Fiddle検証と同じ語彙）
const DEFAULT_WORDS = ["スムーズな", "快適", "落ち着いた", "静寂な", "ゆっくり", "非日常的な"];

// 全40ユニーク語リストを自動構築
const UNIQUE_WORDS = Array.from(new Set([...MOVE_WORDS, ...STAY_WORDS, ...SPACE_WORDS]));

let db = null;
let lastRows = []; // 最新のSQL計算結果（全件）

// =========================================================================
// 初期化処理（sql.js ロード ＋ data_kobe.sql 読み込み）
// =========================================================================
async function init() {
  buildWordUI();
  bindEvents();

  const statusEl = document.getElementById("db-status");
  try {
    const SQL = await initSqlJs({
      locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
    });
    db = new SQL.Database();

    // SQLite上で大円距離・正規化内積をそのまま実行できるよう数学関数を登録
    db.create_function("RADIANS", (deg) => (deg * Math.PI) / 180.0);
    db.create_function("SIN", (x) => Math.sin(x));
    db.create_function("COS", (x) => Math.cos(x));
    db.create_function("ACOS", (x) => Math.acos(x));
    db.create_function("SQRT", (x) => Math.sqrt(x));
    db.create_function("POW", (x, y) => Math.pow(x, y));

    const res = await fetch(DATA_SQL_PATH);
    if (!res.ok) throw new Error(`${DATA_SQL_PATH} の読み込みに失敗しました (HTTP ${res.status})`);
    const sqlText = await res.text();
    db.run(sqlText);

    // 入力・現在地テーブルを確実に再作成（data_kobe.sqlに含まれていても上書き）
    setupInputTables();

    const cntRes = db.exec("SELECT COUNT(*) FROM spots;");
    const totalSpots = cntRes[0].values[0][0];

    statusEl.textContent = `DB準備完了（登録スポット：${totalSpots}地点 / ${DATA_SQL_PATH}）`;
    statusEl.className = "status ready";
    document.getElementById("btn-run").disabled = false;

    // 初期選択状態で1回自動実行
    selectPresetWords(DEFAULT_WORDS);
    runCalculation();
  } catch (err) {
    console.error(err);
    statusEl.textContent = `エラー: ${err.message}（※ローカル実行時は簡易HTTPサーバ経由で開いてください）`;
    statusEl.className = "status error";
  }
}

function setupInputTables() {
  const makeCols = (words) => words.map((w) => `\`${w}\` DOUBLE`).join(", ");
  db.run(`
    DROP TABLE IF EXISTS input_move;
    DROP TABLE IF EXISTS input_stay;
    DROP TABLE IF EXISTS input_space;
    DROP TABLE IF EXISTS current_location;
    CREATE TABLE input_move (${makeCols(MOVE_WORDS)});
    CREATE TABLE input_stay (${makeCols(STAY_WORDS)});
    CREATE TABLE input_space (${makeCols(SPACE_WORDS)});
    CREATE TABLE current_location (
      現在地名 VARCHAR(50) PRIMARY KEY,
      緯度 DOUBLE,
      経度 DOUBLE,
      検索半径_km DOUBLE
    );
  `);
}

// =========================================================================
// UI生成・イベント設定
// =========================================================================
function buildWordUI() {
  const grid = document.getElementById("word-grid");
  grid.innerHTML = "";

  UNIQUE_WORDS.forEach((word) => {
    const inMv = MOVE_WORDS.includes(word);
    const inSt = STAY_WORDS.includes(word);
    const inSp = SPACE_WORDS.includes(word);

    const label = document.createElement("label");
    label.className = "word-chip";
    label.innerHTML = `
      <input type="checkbox" value="${word}" />
      <span>${word}</span>
      <span class="badges">
        ${inMv ? '<span class="badge b-mv">移</span>' : ""}
        ${inSt ? '<span class="badge b-st">滞</span>' : ""}
        ${inSp ? '<span class="badge b-sp">活</span>' : ""}
      </span>
    `;
    const cb = label.querySelector("input");
    cb.addEventListener("change", () => {
      label.classList.toggle("selected", cb.checked);
      updateSelectedSummary();
    });
    grid.appendChild(label);
  });
}

function getSelectedWords() {
  return Array.from(document.querySelectorAll('#word-grid input[type="checkbox"]:checked'))
    .map((el) => el.value);
}

function selectPresetWords(words) {
  const set = new Set(words);
  document.querySelectorAll('#word-grid .word-chip').forEach((label) => {
    const cb = label.querySelector("input");
    cb.checked = set.has(cb.value);
    label.classList.toggle("selected", cb.checked);
  });
  updateSelectedSummary();
}

function updateSelectedSummary() {
  const selected = new Set(getSelectedWords());
  const mvCnt = MOVE_WORDS.filter((w) => selected.has(w)).length;
  const stCnt = STAY_WORDS.filter((w) => selected.has(w)).length;
  const spCnt = SPACE_WORDS.filter((w) => selected.has(w)).length;

  document.getElementById("selected-summary").textContent =
    `選択中：${selected.size}語（自動マッピング → 移動空間: ${mvCnt}語 / 滞在空間: ${stCnt}語 / 活動空間: ${spCnt}語）`;
}

function bindEvents() {
  document.getElementById("preset-select").addEventListener("change", (e) => {
    const [lat, lng] = e.target.value.split(",");
    document.getElementById("input-lat").value = lat;
    document.getElementById("input-lng").value = lng;
  });

  document.getElementById("btn-gps").addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("このブラウザは位置情報取得に対応していません。");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        document.getElementById("input-lat").value = pos.coords.latitude.toFixed(6);
        document.getElementById("input-lng").value = pos.coords.longitude.toFixed(6);
      },
      (err) => alert("現在地を取得できませんでした: " + err.message)
    );
  });

  document.getElementById("btn-preset-words").addEventListener("click", () => {
    selectPresetWords(DEFAULT_WORDS);
  });

  document.getElementById("btn-clear-words").addEventListener("click", () => {
    selectPresetWords([]);
  });

  document.getElementById("btn-run").addEventListener("click", runCalculation);

  // 評価タイプ変更時は即座に個別Top-5を再描画
  document.getElementById("ge-mode").addEventListener("change", renderSingleTop5);

  // 総合空間の計算方式（54語/40語）切替時も即再計算
  document.querySelectorAll('input[name="total-mode"]').forEach((r) => {
    r.addEventListener("change", () => {
      if (db) runCalculation();
    });
  });

  document.getElementById("btn-copy-all7").addEventListener("click", () => copyTableCSV("table-all7"));
  document.getElementById("btn-copy-spaces").addEventListener("click", () => copyTableCSV("table-spaces"));
}

// =========================================================================
// SQL生成と実行（大円距離・正規化内積・評価関数GE）
// =========================================================================
function buildCosineExpr(aliasMat, aliasIn, words) {
  const num = words.map((w) => `(${aliasMat}.\`${w}\` * ${aliasIn}.\`${w}\`)`).join(" + ");
  const denMat = words.map((w) => `POW(${aliasMat}.\`${w}\`, 2)`).join(" + ");
  const denIn = words.map((w) => `POW(${aliasIn}.\`${w}\`, 2)`).join(" + ");
  return `ROUND(COALESCE((${num}) / NULLIF(SQRT(${denMat}) * SQRT(${denIn}), 0), 0), 4)`;
}

function buildTotalCosineExpr(mode) {
  if (mode === "54") {
    // 54語連結モデル（重複許容・元データ-1/0/1を加工せず連結）
    const termsNum = [
      ...MOVE_WORDS.map((w) => `(mv.\`${w}\` * imv.\`${w}\`)`),
      ...STAY_WORDS.map((w) => `(st.\`${w}\` * ist.\`${w}\`)`),
      ...SPACE_WORDS.map((w) => `(sp.\`${w}\` * isp.\`${w}\`)`)
    ].join(" + ");

    const termsMat = [
      ...MOVE_WORDS.map((w) => `POW(mv.\`${w}\`, 2)`),
      ...STAY_WORDS.map((w) => `POW(st.\`${w}\`, 2)`),
      ...SPACE_WORDS.map((w) => `POW(sp.\`${w}\`, 2)`)
    ].join(" + ");

    const termsIn = [
      ...MOVE_WORDS.map((w) => `POW(imv.\`${w}\`, 2)`),
      ...STAY_WORDS.map((w) => `POW(ist.\`${w}\`, 2)`),
      ...SPACE_WORDS.map((w) => `POW(isp.\`${w}\`, 2)`)
    ].join(" + ");

    return `ROUND(COALESCE((${termsNum}) / NULLIF(SQRT(${termsMat}) * SQRT(${termsIn}), 0), 0), 4)`;
  }

  // 40語統合モデル（共通語は平均値で1次元に統合）
  const numParts = [];
  const matParts = [];
  const inParts = [];

  UNIQUE_WORDS.forEach((w) => {
    const mats = [];
    const ins = [];
    if (MOVE_WORDS.includes(w)) { mats.push(`mv.\`${w}\``); ins.push(`imv.\`${w}\``); }
    if (STAY_WORDS.includes(w)) { mats.push(`st.\`${w}\``); ins.push(`ist.\`${w}\``); }
    if (SPACE_WORDS.includes(w)) { mats.push(`sp.\`${w}\``); ins.push(`isp.\`${w}\``); }

    const matExpr = mats.length === 1 ? mats[0] : `((${mats.join(" + ")}) / ${mats.length}.0)`;
    const inExpr = ins.length === 1 ? ins[0] : `MAX(${ins.join(", ")})`;

    numParts.push(`(${matExpr} * ${inExpr})`);
    matParts.push(`POW(${matExpr}, 2)`);
    inParts.push(`POW(${inExpr}, 2)`);
  });

  return `ROUND(COALESCE((${numParts.join(" + ")}) / NULLIF(SQRT(${matParts.join(" + ")}) * SQRT(${inParts.join(" + ")}), 0), 0), 4)`;
}

function runCalculation() {
  const lat = parseFloat(document.getElementById("input-lat").value);
  const lng = parseFloat(document.getElementById("input-lng").value);
  const radius = parseFloat(document.getElementById("input-radius").value);
  const selected = new Set(getSelectedWords());
  const totalMode = document.querySelector('input[name="total-mode"]:checked').value;

  if (isNaN(lat) || isNaN(lng) || isNaN(radius) || radius <= 0) {
    alert("緯度・経度・検索半径を正しく入力してください。");
    return;
  }
  if (selected.size === 0) {
    alert("印象語を1つ以上選択してください。");
    return;
  }

  // ユーザー入力テーブルと現在地テーブルを更新
  const mvVals = MOVE_WORDS.map((w) => (selected.has(w) ? 1 : 0)).join(", ");
  const stVals = STAY_WORDS.map((w) => (selected.has(w) ? 1 : 0)).join(", ");
  const spVals = SPACE_WORDS.map((w) => (selected.has(w) ? 1 : 0)).join(", ");

  db.run(`
    DELETE FROM current_location;
    INSERT INTO current_location VALUES ('指定現在地', ${lat}, ${lng}, ${radius});
    DELETE FROM input_move;
    INSERT INTO input_move VALUES (${mvVals});
    DELETE FROM input_stay;
    INSERT INTO input_stay VALUES (${stVals});
    DELETE FROM input_space;
    INSERT INTO input_space VALUES (${spVals});
  `);

  const totalExpr = buildTotalCosineExpr(totalMode);
  const mvExpr = buildCosineExpr("mv", "imv", MOVE_WORDS);
  const stExpr = buildCosineExpr("st", "ist", STAY_WORDS);
  const spExpr = buildCosineExpr("sp", "isp", SPACE_WORDS);

  // 大円距離絞り込み ＋ 4空間相関量 ＋ 評価関数GE（7タイプ）を一括算出するSQL
  const query = `
WITH nearby_spots AS (
  SELECT
    s.観光地名,
    s.緯度,
    s.経度,
    ROUND(
      6371.0 * ACOS(
        MIN(1.0, MAX(-1.0,
          COS(RADIANS(c.緯度)) * COS(RADIANS(s.緯度)) * COS(RADIANS(s.経度) - RADIANS(c.経度))
          + SIN(RADIANS(c.緯度)) * SIN(RADIANS(s.緯度))
        ))
      ), 3
    ) AS 距離_km
  FROM spots s
  CROSS JOIN current_location c
  WHERE (
    6371.0 * ACOS(
      MIN(1.0, MAX(-1.0,
        COS(RADIANS(c.緯度)) * COS(RADIANS(s.緯度)) * COS(RADIANS(s.経度) - RADIANS(c.経度))
        + SIN(RADIANS(c.緯度)) * SIN(RADIANS(s.緯度))
      ))
    )
  ) <= c.検索半径_km
),
all_scores AS (
  SELECT
    s.観光地名,
    s.距離_km,
    ${totalExpr} AS total_corr,
    ${mvExpr} AS mv_corr,
    ${stExpr} AS st_corr,
    ${spExpr} AS sp_corr
  FROM nearby_spots s
  JOIN move_matrix mv ON s.観光地名 = mv.観光地名
  JOIN stay_matrix st ON s.観光地名 = st.観光地名
  JOIN space_matrix sp ON s.観光地名 = sp.観光地名
  CROSS JOIN input_move imv
  CROSS JOIN input_stay ist
  CROSS JOIN input_space isp
)
SELECT
  観光地名,
  距離_km,
  total_corr,
  mv_corr,
  st_corr,
  sp_corr,
  ROUND(0.5 * mv_corr + 0.5 * st_corr + 0.5 * sp_corr, 4) AS grand_score,
  ROUND(1.0 * mv_corr + 0.1 * st_corr + 0.1 * sp_corr, 4) AS move_score,
  ROUND(0.1 * mv_corr + 1.0 * st_corr + 0.1 * sp_corr, 4) AS stay_score,
  ROUND(0.1 * mv_corr + 0.1 * st_corr + 1.0 * sp_corr, 4) AS space_score,
  ROUND(0.5 * mv_corr + 0.5 * st_corr + 0.1 * sp_corr, 4) AS mv_st_score,
  ROUND(0.5 * mv_corr + 0.1 * st_corr + 0.5 * sp_corr, 4) AS mv_sp_score,
  ROUND(0.1 * mv_corr + 0.5 * st_corr + 0.5 * sp_corr, 4) AS st_sp_score
FROM all_scores;
  `.trim();

  document.getElementById("sql-preview").textContent = query;

  const res = db.exec(query);
  const resultsArea = document.getElementById("results-area");
  resultsArea.classList.remove("hidden");

  if (!res.length || res[0].values.length === 0) {
    lastRows = [];
    document.getElementById("filter-summary").textContent =
      `現在地 (${lat}, ${lng}) から半径 ${radius} km 以内に該当スポットがありませんでした。検索半径を広げるかプリセット位置をお試しください。`;
    document.getElementById("table-single-top5").innerHTML = "";
    document.getElementById("table-all7").innerHTML = "";
    document.getElementById("table-spaces").innerHTML = "";
    return;
  }

  const cols = res[0].columns;
  lastRows = res[0].values.map((row) => {
    const obj = {};
    cols.forEach((c, idx) => (obj[c] = row[idx]));
    return obj;
  });

  const modeLabel = totalMode === "54" ? "54語連結モデル（重複許容）" : "40語統合モデル（平均値）";
  document.getElementById("filter-summary").textContent =
    `絞り込み結果：現在地 (${lat}, ${lng}) から半径 ${radius} km 以内に ${lastRows.length} 地点が該当（総合空間：${modeLabel}）`;

  renderSingleTop5();
  renderAll7Comparison();
  renderSpaceRankings();
}

// ランキング並び替え（SQLの ORDER BY score DESC, 距離_km ASC, 観光地名 ASC と同一規則）
function sortByScore(rows, scoreKey) {
  return [...rows].sort((a, b) => {
    if (b[scoreKey] !== a[scoreKey]) return b[scoreKey] - a[scoreKey];
    if (a.距離_km !== b.距離_km) return a.距離_km - b.距離_km;
    return a.観光地名.localeCompare(b.観光地名, "ja");
  });
}

// =========================================================================
// テーブル描画
// =========================================================================
function renderSingleTop5() {
  if (!lastRows.length) return;
  const modeKey = document.getElementById("ge-mode").value;
  const ge = GE_TYPES.find((g) => g.key === modeKey);
  const [wMs, wSs, wAs] = ge.w;

  document.getElementById("ge-formula-desc").textContent =
    `計算式：T = ${wMs} × x_MS（移動） + ${wSs} × x_SS（滞在） + ${wAs} × x_AS（活動）`;

  const top5 = sortByScore(lastRows, ge.col).slice(0, 5);
  const table = document.getElementById("table-single-top5");

  table.innerHTML = `
    <thead>
      <tr>
        <th>順位</th>
        <th>観光地名</th>
        <th>評価スコア T</th>
        <th>距離 (km)</th>
        <th>移動相関 (x_MS)</th>
        <th>滞在相関 (x_SS)</th>
        <th>活動相関 (x_AS)</th>
        <th class="col-base">参考：総合空間</th>
      </tr>
    </thead>
    <tbody>
      ${top5.map((r, i) => `
        <tr>
          <td class="rank">${i + 1}</td>
          <td>${r.観光地名}</td>
          <td class="num"><strong>${Number(r[ge.col]).toFixed(4)}</strong></td>
          <td class="num">${Number(r.距離_km).toFixed(3)}</td>
          <td class="num">${Number(r.mv_corr).toFixed(4)}</td>
          <td class="num">${Number(r.st_corr).toFixed(4)}</td>
          <td class="num">${Number(r.sp_corr).toFixed(4)}</td>
          <td class="num">${Number(r.total_corr).toFixed(4)}</td>
        </tr>
      `).join("")}
    </tbody>
  `;
}

function renderAll7Comparison() {
  if (!lastRows.length) return;
  const maxRank = Math.min(5, lastRows.length);

  const columns = [
    { label: "総合空間（基準）", key: "total_corr", isBase: true },
    ...GE_TYPES.map((g) => ({ label: g.label, key: g.col, isBase: false }))
  ];

  const rankedLists = columns.map((col) => sortByScore(lastRows, col.key).slice(0, maxRank));
  const table = document.getElementById("table-all7");

  const thead = `
    <thead>
      <tr>
        <th>順位</th>
        ${columns.map((c) => `<th class="${c.isBase ? "col-base" : ""}">${c.label}</th>`).join("")}
      </tr>
    </thead>
  `;

  let tbody = "<tbody>";
  for (let i = 0; i < maxRank; i++) {
    tbody += `<tr><td class="rank">${i + 1}</td>`;
    columns.forEach((col, cIdx) => {
      const r = rankedLists[cIdx][i];
      tbody += `
        <td class="spot-cell">
          ${r.観光地名}
          <span class="score-sub">${Number(r[col.key]).toFixed(4)} (${Number(r.距離_km).toFixed(2)}km)</span>
        </td>
      `;
    });
    tbody += "</tr>";
  }
  tbody += "</tbody>";

  table.innerHTML = thead + tbody;
}

function renderSpaceRankings() {
  if (!lastRows.length) return;
  const rTot = sortByScore(lastRows, "total_corr");
  const rMv = sortByScore(lastRows, "mv_corr");
  const rSt = sortByScore(lastRows, "st_corr");
  const rSp = sortByScore(lastRows, "sp_corr");

  const table = document.getElementById("table-spaces");
  let tbody = "<tbody>";
  for (let i = 0; i < lastRows.length; i++) {
    tbody += `
      <tr>
        <td class="rank">${i + 1}</td>
        <td class="spot-cell">${rTot[i].観光地名}</td>
        <td class="num">${Number(rTot[i].total_corr).toFixed(4)}</td>
        <td class="spot-cell">${rMv[i].観光地名}</td>
        <td class="num">${Number(rMv[i].mv_corr).toFixed(4)}</td>
        <td class="spot-cell">${rSt[i].観光地名}</td>
        <td class="num">${Number(rSt[i].st_corr).toFixed(4)}</td>
        <td class="spot-cell">${rSp[i].観光地名}</td>
        <td class="num">${Number(rSp[i].sp_corr).toFixed(4)}</td>
      </tr>
    `;
  }
  tbody += "</tbody>";

  table.innerHTML = `
    <thead>
      <tr>
        <th>順位</th>
        <th class="col-base">総合空間_観光地</th>
        <th class="col-base">総合_相関量</th>
        <th>移動空間_観光地</th>
        <th>移動 (x_MS)</th>
        <th>滞在空間_観光地</th>
        <th>滞在 (x_SS)</th>
        <th>活動空間_観光地</th>
        <th>活動 (x_AS)</th>
      </tr>
    </thead>
    ${tbody}
  `;
}

// =========================================================================
// 論文・Excel転用用 CSVコピー
// =========================================================================
function copyTableCSV(tableId) {
  const table = document.getElementById(tableId);
  const rows = Array.from(table.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.querySelectorAll("th, td"))
      .map((cell) => `"${cell.innerText.replace(/\s+/g, " ").trim().replace(/"/g, '""')}"`)
      .join(",")
  );
  navigator.clipboard.writeText(rows.join("\n")).then(() => {
    alert("CSV形式でクリップボードにコピーしました。Excelやスプレッドシートに貼り付けられます。");
  });
}

window.addEventListener("DOMContentLoaded", init);
