/* ——— LISTE DES SÉRIES ——— */
const SESSIONS = [
  { id: "def",      label: "Définitions",                      src: "json/adv_open_definition.json" },
  { id: "re",       label: "Réglementation Européenne",        src: "json/adv_open_reglementation-europeenne.json" },
  { id: "geozones", label: "Zones Géographiques - Géozones",   src: "json/adv_open_zones-geographiques-geozones.json" },
  { id: "met",      label: "Météorologie",                     src: "json/adv_open_meteorologie.json" },
];

/* ——— CONFIG ——— */
const PASS_THRESHOLD = 0.75;

/* ——— Paramètres persistés ——— */
const DEFAULT_SETTINGS = { instant:true, shuffle:true, limit:false, count:10, timer:false, tsec:30, keys:true };
let SETTINGS = loadSettings();

/* ——— Sélection persistée (multi) ——— */
const DEFAULT_SELECTION = SESSIONS.map(s=>s.id);
let SELECTED = loadSelection();

/* ——— ÉTAT ——— */
let BANK = [];
let asked = new Set();
let score = 0;
let current = null;
let QUIZ_ENDED = false;

let RUN = [];
let IDX = -1;
const ANSWERS = new Map();

/* ——— DOM ——— */
const $ = s => document.querySelector(s);
const card = $('#card'), statusEl = $('#status');
const qEl = $('#question'), optsEl = $('#opts'), whyEl = $('#why');
const progressEl = $('#progress'), scoreEl = $('#score'), nextBtn = $('#next'), prevBtn = $('#prev');
const meterFill = $('#meterFill');
const rowEl = document.querySelector('.row');

/* ——— START PANE ——— */
const startPane = $('#startPane');
const btnStart  = $('#btnStart');

const settingsMenu = $('#settingsMenu');
const swInstant = $('#swInstant');
const swShuffle = $('#swShuffle');
const swLimit   = $('#swLimit');
const swKeys    = $('#swKeys');
const rowCount  = $('#rowCount');
const qCount    = $('#qCount');

const swTimer  = $('#swTimer');
const rowTimer = $('#rowTimer');
const timerSec = $('#timerSec');
const timerBox = $('#timer');
const timerLeft = $('#timerLeft');

const seriesMenu  = $('#seriesMenu');
const seriesList  = $('#seriesList');
const seriesLabel = $('#seriesLabel');
const btnToggle   = $('#btnToggle');
const reloadButton= $('#reloadCurrent');

let OPT_NODES = [];
const SESSION_STATUS = new Map();

/* ——— PANE ERREUR (facultatif si présent dans le HTML) ——— */
const errPane   = document.getElementById('cardError');
const errTitle  = document.getElementById('cardErrorTitle');
const errMsg    = document.getElementById('cardErrorMsg');
const btnRetry  = document.getElementById('btnRetry');
const btnDetail = document.getElementById('btnDetails');

let LAST_LOAD_ERROR_DETAILS = "";

/* ——— Helpers show/hide ——— */
function hide(el){
  if(el){
    el.hidden = true;
    el.style.display = 'none';
  }
}
function show(el){
  if(el){
    el.hidden = false;
    el.style.display = '';
  }
}

/* ——— UI STATE HELPERS ——— */
function setCardStateError(title, message, details, onRetry){
  hide(card);
  hide(startPane);

  LAST_LOAD_ERROR_DETAILS = details || '';

  if (errPane && errTitle && errMsg){
    errTitle.textContent = title || 'Erreur';
    errMsg.textContent   = message || 'Un problème est survenu.';

    if (btnDetail){
      btnDetail.hidden = !LAST_LOAD_ERROR_DETAILS;
      btnDetail.onclick = () => alert(LAST_LOAD_ERROR_DETAILS);
    }
    if (btnRetry){
      btnRetry.onclick = () => { if (typeof onRetry === 'function') onRetry(); };
    }

    show(errPane);
    hide(statusEl);
    return;
  }

  if (statusEl){
    statusEl.className = 'err';
    statusEl.textContent = `${title || 'Erreur'} — ${message || ''}`;
    show(statusEl);
  }
}
function clearCardError(){
  hide(errPane);
  hide(statusEl);
}
function setCardStateLoading(text){
  hide(card);
  hide(startPane);
  hide(errPane);
  if (statusEl){
    statusEl.className = '';
    statusEl.textContent = text || 'Chargement...';
    show(statusEl);
  }
}

/* ——— ÉCRAN DE DÉMARRAGE ——— */
function showStartPane(){
  stopTimer();
  hide(card);
  hide(errPane);
  if (statusEl) statusEl.hidden = true;
  show(startPane);
}
function startQuiz(){
  clearCardError();
  hide(startPane);
  show(card);
  askFirstQuestion();
}

/* ——— INIT ——— */
init().catch(err=>{
  setCardStateError(
    'Erreur de chargement...',
    'Impossible de charger les données. Erreur code: 382974',
    err?.message || String(err),
    () => {
      setCardStateLoading('Nouvelle tentative…');
      init().catch(e => {
        setCardStateError('Toujours en échec', 'La nouvelle tentative a échoué.', e?.message || String(e), () => location.reload());
      });
    }
  );
});

async function init(){
  setCardStateLoading('Chargement des séries…');
  clearCardError();

  buildSeriesMenu();
  applySettingsUI();

  await loadBankForSelection(SELECTED);

  if (statusEl) statusEl.hidden = true;

  resetQuiz();
  showStartPane();                // ⟵ on affiche l’écran de démarrage
  bindSettings();
  bindSeriesMenu();

  // Clic sur "Commencer"
  btnStart?.addEventListener('click', startQuiz);

  // Si certaines séries ont échoué, on affiche un avertissement non bloquant
  if (LAST_LOAD_ERROR_DETAILS){
    setTimeout(()=>{
      setCardStateError(
        'Attention',
        'Certaines séries n’ont pas été chargées. Le questionnaire utilise celles disponibles.',
        LAST_LOAD_ERROR_DETAILS,
        async () => {
          setCardStateLoading('Rechargement des séries…');
          try{
            await loadBankForSelection(SELECTED);
            clearCardError();
            restartQuiz(); // retour à l’écran de démarrage
          }catch(e){
            setCardStateError('Erreur', 'Toujours des erreurs au chargement.', e?.message || String(e));
          }
        }
      );
      // Masque l’alerte après 2s (optionnel)
      setTimeout(()=> clearCardError(), 2000);
    }, 0);
  }
}

/* ——— Fetch JSON (robuste) ——— */
async function fetchJSON(url){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000); // 10s

  try{
    const r = await fetch(url, {cache:'no-store', signal: ctrl.signal});
    if(!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} — ${url}`);
    return await r.json();
  }catch(e){
    if (e.name === 'AbortError') throw new Error(`Délai dépassé (timeout) lors du chargement: ${url}`);
    throw new Error(`Échec de chargement: ${url}\n${e.message || e}`);
  }finally{
    clearTimeout(timer);
  }
}

/* ——— Charger la banque ——— */
async function loadBankForSelection(selIds){
  const valid = new Set(SESSIONS.map(s=>s.id));
  let ids = Array.isArray(selIds) ? selIds.filter(id=>valid.has(id)) : [];
  if (ids.length === 0) ids = [...valid];

  updateSeriesHeader(ids);
  updateToggleButton();

  const index = new Map(SESSIONS.map(s=>[s.id, s]));
  const jobs = ids.map(id => fetchJSON(index.get(id).src));
  const settled = await Promise.allSettled(jobs);

  const loaded = [];
  const errors = [];

  settled.forEach((res, i) => {
    const sid = ids[i];
    if (res.status === 'fulfilled') {
      const arr = res.value;
      if (Array.isArray(arr)) {
        arr.forEach(q => q._session_id = sid);
        loaded.push(...arr);
      } else {
        errors.push(`Format invalide pour « ${sid} » : le JSON racine doit être un tableau.`);
      }
    } else {
      errors.push(`Impossible de charger « ${sid} » : ${res.reason?.message || res.reason}`);
    }
  });

  if (!loaded.length){
    const detail = errors.join('\n• ');
    throw new Error(`Aucune série disponible.\n• ${detail}`);
  }

  LAST_LOAD_ERROR_DETAILS = errors.length ? errors.join('\n• ') : '';

  validateBank(loaded);

  BANK = loaded.map((q,i)=> {
    const base = (q && q.id != null) ? String(q.id) : String(i+1);
    const prefix = q._session_id || "mix";
    return { ...q, id: `${prefix}:${base}` };
  });

  if (qCount){
    qCount.max = String(BANK.length || 1);
    if (SETTINGS.limit && SETTINGS.count > BANK.length) SETTINGS.count = BANK.length;
  }
  applySettingsUI();
}

function updateSeriesHeader(ids){
  if (ids.length === SESSIONS.length) {
    seriesLabel.textContent = "Tout (mélangé)";
  } else if (ids.length === 1) {
    seriesLabel.textContent = SESSIONS.find(s=>s.id===ids[0])?.label || "Session";
  } else {
    seriesLabel.textContent = `Mix personnalisé (${ids.length})`;
  }
}
function updateToggleButton(){
  if (!btnToggle) return;
  const inputs = seriesList.querySelectorAll('input[name="series"]');
  const total = inputs.length;
  const checked = Array.from(inputs).filter(b => b.checked).length;
  btnToggle.textContent = (checked === total && total > 0) ? 'Tout désélectionner' : 'Tout sélectionner';
}

/* ——— Validation ——— */
function validateBank(arr){
  if(!Array.isArray(arr) || !arr.length) throw new Error('Le JSON doit être un tableau non vide');
  for(let i=0;i<arr.length;i++){
    const q=arr[i];
    if(!q || typeof q.q!=='string' || !Array.isArray(q.opts) || !('ans' in q))
      throw new Error(`Élément ${i} invalide (requis: q:string, opts:[], ans)`);
    if(!q.opts.length) throw new Error(`Élément ${i}: opts[] vide`);
  }
}

/* ——— Settings ——— */
function loadSettings(){
  try{
    const raw = localStorage.getItem('qcm_settings');
    if(!raw) return {...DEFAULT_SETTINGS};
    const obj = JSON.parse(raw);
    return {...DEFAULT_SETTINGS, ...obj};
  }catch{ return {...DEFAULT_SETTINGS}; }
}
function saveSettings(){ localStorage.setItem('qcm_settings', JSON.stringify(SETTINGS)); }

/* ——— UI Settings ——— */
function applySettingsUI(){
  swInstant?.classList.toggle('on', SETTINGS.instant);
  swShuffle?.classList.toggle('on', SETTINGS.shuffle);
  swLimit  ?.classList.toggle('on', SETTINGS.limit);
  swKeys?.classList.toggle('on', SETTINGS.keys);
  swKeys?.setAttribute('aria-checked', String(!!SETTINGS.keys));
  scoreEl.classList.toggle('hidden', !SETTINGS.instant);

  if (rowCount) rowCount.style.display = SETTINGS.limit ? 'flex' : 'none';
  if (qCount){
    qCount.disabled = !SETTINGS.limit;
    qCount.max = String(BANK.length || 1);
    qCount.value = SETTINGS.count ?? '';
    qCount.placeholder = BANK.length ? `max ${BANK.length}` : '';
  }

  // TIMER
  swTimer?.classList.toggle('on', SETTINGS.timer);
  if (rowTimer) rowTimer.style.display = SETTINGS.timer ? 'flex' : 'none';
  if (timerSec){
    timerSec.disabled = !SETTINGS.timer;
    timerSec.value = SETTINGS.tsec ?? 30;
    timerSec.placeholder = 'ex: 30';
  }
  if (timerBox){
    const show = !!(SETTINGS.timer && current && !QUIZ_ENDED && !ANSWERS.get(current?.id));
    timerBox.hidden = !show;
  }
}

/* ——— Bind paramètres ——— */
function bindSettings(){
  const toggle = (el, key) => {
    if(!el) return;
    el.addEventListener('click', () => {
      SETTINGS[key] = !SETTINGS[key];
      saveSettings(); applySettingsUI();
      if (key === 'instant' || key === 'shuffle') return;
    });
  };
  toggle(swInstant, 'instant');
  toggle(swShuffle, 'shuffle');

  // limite
  swLimit?.addEventListener('click', () => {
    SETTINGS.limit = !SETTINGS.limit;
    if (SETTINGS.limit && !(SETTINGS.count >= 1)) {
      SETTINGS.count = Math.min(10, BANK.length || 10);
    }
    if (SETTINGS.count > BANK.length) SETTINGS.count = BANK.length;
    saveSettings(); applySettingsUI(); restartQuiz();
  });

  qCount?.addEventListener('change', () => {
    if (!SETTINGS.limit) return;
    const n = Math.floor(Number(qCount.value));
    if (Number.isFinite(n) && n >= 1){
      SETTINGS.count = Math.min(n, BANK.length || 1);
      saveSettings(); applySettingsUI(); restartQuiz();
    } else {
      applySettingsUI();
    }
  });
  qCount?.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ e.preventDefault(); qCount.dispatchEvent(new Event('change')); }
  });

  // TIMER
  swTimer?.addEventListener('click', ()=>{
    SETTINGS.timer = !SETTINGS.timer;
    saveSettings(); applySettingsUI();
    stopTimer();
    if (SETTINGS.timer && current && !ANSWERS.get(current.id) && !QUIZ_ENDED) {
      startQuestionTimer();
    }
  });
  timerSec?.addEventListener('change', ()=>{
    const n = Math.floor(Number(timerSec.value));
    if (Number.isFinite(n) && n >= 5){
      SETTINGS.tsec = n;
      saveSettings(); applySettingsUI();
      if (SETTINGS.timer && current && !ANSWERS.get(current.id) && !QUIZ_ENDED) {
        startQuestionTimer(true);
      }
    } else {
      timerSec.value = SETTINGS.tsec ?? 30;
    }
  });

  // fermeture au clic extérieur / Échap
  document.addEventListener('click', (e) => {
    if (settingsMenu?.open && !settingsMenu.contains(e.target)) settingsMenu.open = false;
    if (seriesMenu?.open && !seriesMenu.contains(e.target)) seriesMenu.open = false;
  });
  settingsMenu?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { settingsMenu.open = false; settingsMenu.querySelector('summary')?.focus(); }
  });
  seriesMenu?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { seriesMenu.open = false; seriesMenu.querySelector('summary')?.focus(); }
  });

  toggle(swKeys, 'keys');
}

/* ——— Sélecteur multi-séries (auto-apply) ——— */
function buildSeriesMenu(){
  seriesList.innerHTML = '';
  for (const s of SESSIONS){
    const wrap = document.createElement('label');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '8px';
    wrap.style.cursor = 'pointer';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'series';
    input.value = s.id;
    input.checked = SELECTED.includes(s.id);
    input.addEventListener('change', onSeriesChanged);

    const span = document.createElement('span');
    span.textContent = s.label;

    wrap.appendChild(input);
    wrap.appendChild(span);
    seriesList.appendChild(wrap);
  }
  updateSeriesHeader(SELECTED);
  updateToggleButton();
}
function checkedSeries(){
  const arr = [];
  seriesList.querySelectorAll('input[name="series"]').forEach(b=>{ if(b.checked) arr.push(b.value); });
  return arr.length ? arr : SESSIONS.map(s=>s.id);
}
async function onSeriesChanged(){
  try{
    SELECTED = checkedSeries();
    saveSelection(SELECTED);
    if (statusEl){
      statusEl.hidden = false;
      statusEl.textContent = 'Chargement de la sélection...';
    }
    updateToggleButton();
    await loadBankForSelection(SELECTED);
    restartQuiz();
    if (statusEl) statusEl.hidden = true;
  }catch(err){
    setCardStateError(
      'Erreur de sélection',
      'Impossible de charger la sélection demandée.',
      err?.message || String(err),
      () => { setCardStateLoading('Nouvelle tentative…'); onSeriesChanged(); }
    );
  }
}
function bindSeriesMenu(){
  btnToggle?.addEventListener('click', ()=>{
    const inputs = seriesList.querySelectorAll('input[name="series"]');
    const allChecked = Array.from(inputs).every(b=>b.checked);
    inputs.forEach(b=> b.checked = !allChecked);
    onSeriesChanged();
  });

  reloadButton?.addEventListener('click', async ()=>{
    try{
      if (seriesMenu) seriesMenu.open = false;
      if (statusEl){
        statusEl.hidden = false;
        statusEl.textContent = 'Rechargement...';
      }
      await loadBankForSelection(SELECTED);
      restartQuiz();
      if (statusEl) statusEl.hidden = true;
    }catch(err){
      setCardStateError(
        'Échec du rechargement',
        'Les séries n’ont pas pu être rechargées.',
        err?.message || String(err),
        async () => {
          setCardStateLoading('Rechargement…');
          try{
            await loadBankForSelection(SELECTED);
            clearCardError();
            restartQuiz();
          }catch(e){
            setCardStateError('Échec', 'Nouvelle tentative ratée.', e?.message || String(e));
          }
        }
      );
    }
  });
}

/* ——— Persistance sélection ——— */
function loadSelection(){
  try{
    const raw = localStorage.getItem('qcm_selection_multi');
    if(!raw) return [...DEFAULT_SELECTION];
    const arr = JSON.parse(raw);
    return (Array.isArray(arr) && arr.length) ? arr : [...DEFAULT_SELECTION];
  }catch{ return [...DEFAULT_SELECTION]; }
}
function saveSelection(selArr){
  localStorage.setItem('qcm_selection_multi', JSON.stringify(selArr));
}

/* ——— Limite active ——— */
function getQuestionLimit(){
  if (!BANK.length) return 0;
  if (!SETTINGS.limit) return BANK.length;
  return Math.min(Math.max(1, SETTINGS.count||1), BANK.length);
}

/* ——— TIMER ——— */
let TIMER_ID = null;
let TIMER_LEFT = 0;
let AUTO_ADVANCE_ID = null;
function clearAutoAdvance(){ if (AUTO_ADVANCE_ID){ clearTimeout(AUTO_ADVANCE_ID); AUTO_ADVANCE_ID = null; } }

function formatSec(s){
  s = Math.max(0, Math.floor(s||0));
  const m = Math.floor(s/60);
  const ss = s % 60;
  return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}
function updateTimerUI(){
  if (!timerBox) return;
  const show = !!(SETTINGS.timer && current && !QUIZ_ENDED && !ANSWERS.get(current?.id));
  timerBox.hidden = !show;
  if (!show) return;
  if (timerLeft) timerLeft.textContent = formatSec(TIMER_LEFT);
}
function stopTimer(){
  if (TIMER_ID){ clearInterval(TIMER_ID); TIMER_ID = null; }
  clearAutoAdvance();
}
function startQuestionTimer(){
  if (!SETTINGS.timer) return;
  stopTimer();
  TIMER_LEFT = Math.max(5, Number(SETTINGS.tsec)||30);
  updateTimerUI();
  TIMER_ID = setInterval(()=>{
    TIMER_LEFT--;
    updateTimerUI();
    if (TIMER_LEFT <= 0){
      stopTimer();
      onTimeUp();
    }
  }, 1000);
}
function onTimeUp(){
  if (!current || ANSWERS.get(current.id)) return;

  const rows = Array.from(optsEl.querySelectorAll('.choice'));
  rows.forEach(r=> r.disabled = true);

  if (SETTINGS.instant){
    rows.forEach(r=>{
      const val = r.getAttribute('data-val');
      if(eq(val, current.ans)) r.classList.add('correct');
    });
    if (current.why) whyEl.style.display = 'block';
  } else {
    whyEl.style.display = 'none';
    AUTO_ADVANCE_ID = setTimeout(()=>{ if (!QUIZ_ENDED) goNext(); }, 600);
  }

  ANSWERS.set(current.id, { picked:null, why: current.why || '' });
  rowEl.style.display = 'flex';
  nextBtn.hidden = false;

  updateTimerUI();
}

/* ——— Tirage & navigation ——— */
function nextNewRandom(){
  const LIMIT = getQuestionLimit();
  if(asked.size === LIMIT){ endQuiz(); return; }
  let q;
  do { q = BANK[(Math.random()*BANK.length)|0]; } while(asked.has(q.id));
  asked.add(q.id);
  RUN.push(q);
  IDX = RUN.length - 1;
  current = q;
  render(q);
}
function goNext(){
  stopTimer();
  if (IDX < RUN.length - 1){
    IDX++; current = RUN[IDX]; render(current);
  } else {
    const LIMIT = getQuestionLimit();
    if(asked.size === LIMIT) endQuiz();
    else nextNewRandom();
  }
}
function goPrev(){
  stopTimer();
  if (IDX > 0){
    IDX--; current = RUN[IDX]; render(current);
  }
}

/* ——— Rendu ——— */
function render(q){
  stopTimer();

  const nAll = getQuestionLimit() || BANK.length || 1;
  const cur = Math.min(IDX + 1, nAll);
  progressEl.textContent = `Question ${Math.max(1, cur)} / ${nAll}`;
  meterFill.style.width = `${(cur / Math.max(1, nAll)) * 100}%`;
  scoreEl.textContent = `Score: ${score}`;
  qEl.textContent = q.q;

  const prev = ANSWERS.get(q.id) || null;

  const showWhy = (!!prev && SETTINGS.instant) || QUIZ_ENDED;
  whyEl.style.display = (showWhy && q.why) ? 'block' : 'none';
  whyEl.textContent = q.why || '';

  const showRow = (!!prev) || QUIZ_ENDED;
  rowEl.style.display = showRow ? 'flex' : 'none';
  nextBtn.hidden = !(!!prev || QUIZ_ENDED);
  prevBtn.disabled = (IDX<=0);

  const opts = q.opts.slice();
  if(SETTINGS.shuffle){
    for(let i=opts.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [opts[i],opts[j]]=[opts[j],opts[i]]; }
  }
  optsEl.innerHTML = '';
  OPT_NODES = [];

  opts.forEach((text, idx)=>{
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'choice';
    row.setAttribute('data-val', text);

    const badge = document.createElement('div'); badge.className = 'badge';
    badge.textContent = String.fromCharCode(65+idx);
    const label = document.createElement('div'); label.className = 'label'; label.textContent = text;

    row.appendChild(badge); row.appendChild(label);

    const prevRec = prev;

    if(prevRec){
      row.disabled = true;
      if(QUIZ_ENDED || SETTINGS.instant){
        if(eq(text, q.ans)) row.classList.add('correct');
        if(eq(text, prevRec.picked) && !eq(text, q.ans)) row.classList.add('wrong');
      }else{
        if(eq(text, prevRec.picked)) row.classList.add('picked');
      }
    }else{
      row.addEventListener('click', ()=>{
        if(!nextBtn.hidden && SETTINGS.instant) return;
        checkAnswer(text, q);
      });
    }

    optsEl.appendChild(row);
    OPT_NODES.push(row);
  });

  scoreEl.classList.toggle('hidden', !SETTINGS.instant);

  if (!ANSWERS.get(q.id) && !QUIZ_ENDED){
    startQuestionTimer();
  } else {
    updateTimerUI();
  }
}

/* ——— Correction ——— */
function checkAnswer(picked, q){
  stopTimer();

  const rows = Array.from(optsEl.querySelectorAll('.choice'));
  rows.forEach(r=> r.disabled = true);

  if(SETTINGS.instant){
    rows.forEach(r=>{
      const val = r.getAttribute('data-val');
      if(eq(val, q.ans)) r.classList.add('correct');
      if(eq(val, picked) && !eq(val, q.ans)) r.classList.add('wrong');
    });
    const correct = eq(picked, q.ans);
    if(correct) {
      score++;
      scoreEl.textContent = `Score: ${score}`;
    }
    if(q.why) whyEl.style.display = 'block';
    ANSWERS.set(q.id, {picked, why:q.why||''});
    rowEl.style.display = 'flex';
    nextBtn.hidden = false;
  }else{
    rows.forEach(r=>{
      const val = r.getAttribute('data-val');
      if(eq(val, picked)) r.classList.add('picked');
    });
    whyEl.style.display = 'none';
    ANSWERS.set(q.id, {picked, why:q.why||''});

    rowEl.style.display = 'none';
    nextBtn.hidden = true;

    clearAutoAdvance();
    setTimeout(()=>{ if (!QUIZ_ENDED) goNext(); }, 100);
  }
}

/* ——— Fin ——— */
function endQuiz(){
  stopTimer();

  if(!SETTINGS.instant){
    score = 0;
    for(const q of RUN){
      const rec = ANSWERS.get(q.id);
      if(rec && eq(rec.picked, q.ans)) score++;
    }
  }
  QUIZ_ENDED = true;

  scoreEl.textContent = `Score: ${score}`;

  const nAll = getQuestionLimit() || 0;
  const ok = score;
  const pct = Math.round((ok / Math.max(1,nAll)) * 100);
  const pctFail = 100 - pct;
  const passed = (ok / Math.max(1,nAll)) >= PASS_THRESHOLD;

  const badgeClass = passed ? 'result-pass' : 'result-fail';
  const badgeLabel = passed ? 'Réussi' : 'Échec';

  progressEl.textContent = `Terminé`;
  meterFill.style.width = `100%`;
  qEl.innerHTML = `Séance terminée <span class="result-badge ${badgeClass}">${badgeLabel}</span>`;

  optsEl.innerHTML = `
    <div class="summary">
      <div class="kpis">
        <div class="kpi"><strong>${ok} / ${nAll}</strong><span>réponses correctes</span></div>
        <div class="kpi"><strong>${pct}%</strong><span>réussite</span></div>
        <div class="kpi"><strong>${pctFail}%</strong><span>échec</span></div>
      </div>
      <p class="tip muted">Utilise ← / → pour revoir tes réponses <em>avec les corrections</em>.</p>
      <button class="restart-btn" onclick="restartQuiz()">Recommencer</button>
    </div>
  `;
  whyEl.style.display = 'none';
  rowEl.style.display = 'none';
  nextBtn.hidden = true;

  if (timerBox) timerBox.hidden = true;
}

/* ——— Utils ——— */
function resetQuiz(){
  stopTimer();
  asked.clear(); score = 0; current=null; QUIZ_ENDED = false;
  RUN = []; IDX = -1; ANSWERS.clear();
  scoreEl.textContent='Score: 0'; meterFill.style.width='0%';
  updateTimerUI();
}
function eq(a,b){ return String(a).trim()===String(b).trim(); }
function askFirstQuestion(){ nextNewRandom(); }

/* ——— Raccourcis clavier ——— */
function pickIndex(i){
  const node = OPT_NODES[i];
  if(!node) return;
  if(SETTINGS.instant && !nextBtn.hidden) return;
  const val = node.getAttribute('data-val');
  checkAnswer(val, current);
}

document.addEventListener('keydown', (e)=>{
  const t = e.target;
  const isEditable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if(isEditable) return;

  // Si l'écran de démarrage est visible, Enter lance le quiz
  if (!startPane?.hidden && btnStart){
    if (e.key === 'Enter'){
      e.preventDefault();
      btnStart.click();
      return;
    }
  }

  const k = e.key;
  if(k === 'Enter' || k === 'ArrowRight'){
    if(!nextBtn.hidden){ e.preventDefault(); goNext(); }
    return;
  }
  if(k === 'ArrowLeft'){
    if(!prevBtn.disabled){ e.preventDefault(); goPrev(); }
    return;
  }
  if(k.length === 1){
    const code = k.toUpperCase().charCodeAt(0);
    if (SETTINGS.keys && code >= 65 && code <= 90) {
      const idx = code - 65; // A=0, B=1, C=2, D=3, ...
      if (OPT_NODES[idx]) { e.preventDefault(); pickIndex(idx); }
    }
  }
});

/* ——— Events ——— */
nextBtn.addEventListener('click', goNext);
prevBtn.addEventListener('click', goPrev);

function restartQuiz(){
  resetQuiz();
  showStartPane(); // ⟵ on revient à l’écran de démarrage
}

/* ——— Bonus UX : offline ——— */
window.addEventListener('offline', ()=>{
  setCardStateError(
    'Offline',
    'You are offline. Please reconnect and try again.',
    '',
    () => location.reload()
  );
});
