/* ========================================
   Reclaim Your Core — App Logic
   ======================================== */

// ── Utility ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const _memStore = {};
const _lsOk = (() => { try { const t = '__t'; window['local'+'Storage'].setItem(t, '1'); window['local'+'Storage'].removeItem(t); return true; } catch { return false; } })();
const _ls = _lsOk ? window['local'+'Storage'] : null;
const LS = {
  get(key) {
    try {
      const raw = _ls ? _ls.getItem('rcyc_' + key) : _memStore['rcyc_' + key];
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  set(key, val) {
    const s = JSON.stringify(val);
    if (_ls) { try { _ls.setItem('rcyc_' + key, s); } catch { _memStore['rcyc_' + key] = s; } }
    else { _memStore['rcyc_' + key] = s; }
  },
};
function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function weekKey() {
  const d = new Date();
  const oneJan = new Date(d.getFullYear(), 0, 1);
  return d.getFullYear() + '-W' + String(Math.ceil(((d - oneJan) / 86400000 + oneJan.getDay() + 1) / 7)).padStart(2,'0');
}

// ── Theme ──
(function initTheme() {
  const saved = LS.get('theme');
  const prefer = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const theme = saved || prefer;
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);
})();
window._lsOk = _lsOk; // expose for debugging

function updateThemeIcon(theme) {
  const btn = $('[data-theme-toggle]');
  if (!btn) return;
  btn.innerHTML = theme === 'dark'
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}

$('[data-theme-toggle]').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  LS.set('theme', next);
  updateThemeIcon(next);
  // Redraw charts
  drawProteinRing();
  drawMeasurementChart();
  drawLiftChart();
});

// ── Tab Navigation ──
const tabButtons = $$('[data-tab]');
const tabContents = $$('.tab-content');

function switchTab(tabName) {
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  tabContents.forEach(c => c.classList.toggle('active', c.id === 'tab-' + tabName));
  // Refresh data on tab switch
  if (tabName === 'today') renderToday();
  if (tabName === 'nutrition') renderNutrition();
  if (tabName === 'progress') renderProgress();
  if (tabName === 'supplements') renderSupplements();
}

tabButtons.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

// ── Settings ──
function getSettings() {
  return LS.get('settings') || {
    proteinTarget: 105,
    caloriesTarget: 1700,
    carbsTarget: 170,
    fatTarget: 57,
    bodyWeight: 140,
    startDate: todayKey()
  };
}
function saveSettings(s) { LS.set('settings', s); }

// ── Program Week ──
function getProgramWeek() {
  return LS.get('programWeek') || 1;
}
function setProgramWeek(w) { LS.set('programWeek', Math.max(1, Math.min(12, w))); }

// ── Workout Data ──
const WORKOUTS = {
  1: { // Monday — Upper Push
    name: 'Upper Body Push',
    exercises: [
      // Warm-up (8 min)
      { name: 'Foam Roll Thoracic Spine + Lats', sets: '2 min', section: 'warmup' },
      { name: 'Band Pull-Aparts', sets: '2×15', section: 'warmup' },
      { name: 'Arm Circles + Shoulder CARs', sets: '2 min', section: 'warmup' },
      // Main Lifts — Heavy, 3–5 reps
      { name: 'Barbell Bench Press', sets: '4×4–5 @ 80–85% 1RM', section: 'main' },
      { name: 'Barbell Overhead Press', sets: '4×4–5 @ 80–85% 1RM', section: 'main' },
      // Accessory Work — Moderate, 8–12 reps
      { name: 'Incline DB Press', sets: '3×8–10', section: 'accessory' },
      { name: 'Cable Lateral Raises', sets: '3×10–12', section: 'accessory' },
      { name: 'Tricep Dips', sets: '3×8–10', section: 'accessory' },
      // Finisher
      { name: 'Plank Hold', sets: '3×30–45s', section: 'finisher' },
    ]
  },
  2: { // Tuesday — Lower Body (Quad/Glute Focus)
    name: 'Lower Body (Quad/Glute)',
    exercises: [
      // Warm-up (8 min)
      { name: 'Foam Roll Quads, Adductors, Glutes', sets: '3 min', section: 'warmup' },
      { name: 'Bodyweight Squats', sets: '2×10', section: 'warmup' },
      { name: 'Banded Glute Bridges', sets: '2×15', section: 'warmup' },
      // Main Lifts
      { name: 'Barbell Back Squat', sets: '4×4–5 @ 80–85% 1RM', section: 'main' },
      { name: 'Front Squat or Goblet Squat', sets: '3×6–8', section: 'main' },
      // Accessory
      { name: 'Bulgarian Split Squat (DB)', sets: '3×8–10 each', section: 'accessory' },
      { name: 'Leg Press', sets: '3×10–12', section: 'accessory' },
      { name: 'Hip Thrust (Barbell)', sets: '3×8–10', section: 'accessory' },
      // Finisher
      { name: 'Pallof Press', sets: '3×10 each side', section: 'finisher' },
    ]
  },
  3: { // Wednesday — Active Recovery
    name: 'Active Recovery — Vagus Nerve + Fascia',
    exercises: [
      // Vagus Nerve Reset
      { name: 'Cold Water Face Splash', sets: '30 sec', section: 'warmup' },
      { name: 'Deep Breathing (4-7-8 Pattern)', sets: '3 min', section: 'warmup' },
      { name: 'Humming / Chanting', sets: '2–3 min', section: 'warmup' },
      // Core
      { name: 'Planks', sets: '3×30–60s', section: 'main' },
      { name: 'Pallof Press', sets: '3×10 each', section: 'main' },
      { name: 'Bird Dogs', sets: '3×10 each', section: 'main' },
      // Fascia Release
      { name: 'Foam Roll IT Band + Thoracic Spine', sets: '5 min', section: 'accessory' },
      { name: 'Lacrosse Ball — Glutes + Plantar Fascia', sets: '4 min', section: 'accessory' },
      { name: 'Gentle Yoga (Cat-Cow, Child\'s Pose, Thread the Needle)', sets: '5 min', section: 'finisher' },
    ]
  },
  4: { // Thursday — Upper Pull
    name: 'Upper Body Pull',
    exercises: [
      // Warm-up (8 min)
      { name: 'Foam Roll Lats + Pecs', sets: '2 min', section: 'warmup' },
      { name: 'Band Pull-Aparts', sets: '2×15', section: 'warmup' },
      { name: 'Scapular Wall Slides', sets: '2×10', section: 'warmup' },
      // Main Lifts
      { name: 'Barbell Bent-Over Row', sets: '4×4–5 @ 80–85% 1RM', section: 'main' },
      { name: 'Weighted Pull-ups or Lat Pulldown', sets: '4×4–6', section: 'main' },
      // Accessory
      { name: 'Seated Cable Row', sets: '3×8–10', section: 'accessory' },
      { name: 'Face Pulls', sets: '3×12–15', section: 'accessory' },
      { name: 'Barbell or DB Bicep Curls', sets: '3×8–10', section: 'accessory' },
      // Finisher
      { name: 'Dead Bug', sets: '3×8 each side', section: 'finisher' },
    ]
  },
  5: { // Friday — Lower Body (Hinge/Posterior Chain)
    name: 'Lower Body (Hinge/Posterior)',
    exercises: [
      // Warm-up (8 min)
      { name: 'Foam Roll Hamstrings, Calves, Piriformis', sets: '3 min', section: 'warmup' },
      { name: 'Hip 90/90 Mobility', sets: '2×5 each side', section: 'warmup' },
      { name: 'Banded Monster Walks', sets: '2×12 each direction', section: 'warmup' },
      // Main Lifts
      { name: 'Barbell Deadlift', sets: '4×3–5 @ 80–90% 1RM', section: 'main' },
      { name: 'Romanian Deadlift', sets: '3×6–8', section: 'main' },
      // Accessory
      { name: 'Single-Leg RDL (DB)', sets: '3×8–10 each', section: 'accessory' },
      { name: 'Glute-Ham Raise or Nordic Curl', sets: '3×6–8', section: 'accessory' },
      { name: 'Standing Calf Raises', sets: '3×12–15', section: 'accessory' },
      // Finisher
      { name: 'Hanging Leg Raises', sets: '3×8–10', section: 'finisher' },
    ]
  }
};

const HABITS = [
  '10-min morning walk',
  'Vagus nerve reset (cold splash, humming, breathing)',
  'Magnesium supplement (evening)',
  '7+ hours sleep target',
  'Stress management activity',
  'Hydration (8+ glasses)',
];

// ── Supplements Data ──
const SUPPLEMENTS = [
  { name: 'Creatine Monohydrate', dose: '3–5g', timing: 'morning' },
  { name: 'Magnesium Glycinate', dose: '300–400mg', timing: 'evening' },
  { name: 'Ashwagandha KSM-66', dose: '300–600mg', timing: 'with food' },
  { name: 'L-Theanine', dose: '200mg', timing: 'evening' },
  { name: 'Omega-3 EPA/DHA', dose: '2–3g', timing: 'with food' },
  { name: 'Vitamin D3+K2', dose: '2000–5000 IU', timing: 'with fat' },
];

function getSupplementsData() {
  const key = todayKey();
  const allSupps = LS.get('supplements') || {};
  return allSupps[key] || {};
}

function saveSupplementsData(data) {
  const key = todayKey();
  const allSupps = LS.get('supplements') || {};
  allSupps[key] = data;
  LS.set('supplements', allSupps);
}

// ── Nutrition Data (full macros) ──
const QUICK_FOODS = [
  { name: 'Chicken breast (4oz)', protein: 31, calories: 140, carbs: 0, fat: 3 },
  { name: 'Collagen peptides', protein: 18, calories: 70, carbs: 0, fat: 0 },
  { name: 'Hemp seeds (3 tbsp)', protein: 10, calories: 170, carbs: 2, fat: 14 },
  { name: 'Salmon (4oz)', protein: 25, calories: 230, carbs: 0, fat: 14 },
  { name: 'Cottage cheese (1 cup)', protein: 14, calories: 110, carbs: 5, fat: 5 },
  { name: 'Protein shake', protein: 30, calories: 150, carbs: 5, fat: 2 },
  { name: 'Lentils (1 cup)', protein: 18, calories: 230, carbs: 40, fat: 1 },
  { name: 'Tofu block (4oz)', protein: 20, calories: 180, carbs: 4, fat: 11 },
  { name: 'Beef (4oz)', protein: 28, calories: 220, carbs: 0, fat: 12 },
];

const LIFTS = ['Squat', 'Deadlift', 'Bench Press', 'Overhead Press', 'Bent-over Row'];

// ── TODAY Tab ──
function renderToday() {
  const now = new Date();
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayOfWeek = now.getDay();
  const dateStr = dayNames[dayOfWeek] + ', ' + monthNames[now.getMonth()] + ' ' + now.getDate();
  $('#today-date').textContent = dateStr;

  // KPI
  renderKPIs();

  // Workout
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    renderCyclingDay();
  } else {
    renderWorkout(dayOfWeek);
  }

  // Habits
  renderHabits();
}

function renderKPIs() {
  const settings = getSettings();
  const nutrition = getNutritionData();
  const habits = getHabitsData();
  const completedHabits = habits.filter(h => h.done).length;
  const workoutsThisWeek = countWorkoutsThisWeek();
  const week = getProgramWeek();
  const phase = week <= 4 ? 1 : week <= 8 ? 2 : 3;

  // Supplements KPI
  const suppData = getSupplementsData();
  const suppDone = SUPPLEMENTS.filter((_, i) => suppData['s_' + i]).length;

  // Calories KPI (show alongside protein)
  const cals = nutrition.totals.calories;
  const calTarget = settings.caloriesTarget;

  $('#kpi-grid').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Protein</div>
      <div class="kpi-value">${nutrition.totals.protein}<span class="kpi-unit">/ ${settings.proteinTarget}g</span></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Calories</div>
      <div class="kpi-value">${cals}<span class="kpi-unit">/ ${calTarget}</span></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Habits</div>
      <div class="kpi-value">${completedHabits}<span class="kpi-unit">/ ${HABITS.length}</span></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Supps</div>
      <div class="kpi-value">${suppDone}<span class="kpi-unit">/ ${SUPPLEMENTS.length}</span></div>
    </div>
  `;
}

function countWorkoutsThisWeek() {
  const workouts = LS.get('workouts') || {};
  const now = new Date();
  const day = now.getDay();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  startOfWeek.setHours(0,0,0,0);

  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    if (workouts[key] && workouts[key].completed) count++;
  }
  return count;
}

function renderWorkout(dayOfWeek) {
  const workout = WORKOUTS[dayOfWeek];
  if (!workout) return;

  const key = todayKey();
  const workouts = LS.get('workouts') || {};
  const saved = workouts[key] || { exercises: {}, completed: false };

  $('#workout-title').textContent = workout.name;
  let html = '';
  let lastSection = '';
  const sectionLabels = {
    warmup: 'Warm-up',
    main: 'Main Lifts — Heavy',
    accessory: 'Accessory Work',
    finisher: 'Finisher',
  };
  // Wednesday has different section labels
  const wedLabels = {
    warmup: 'Vagus Nerve Reset',
    main: 'Core Work',
    accessory: 'Fascia Release',
    finisher: 'Cool Down',
  };
  const labels = dayOfWeek === 3 ? wedLabels : sectionLabels;

  workout.exercises.forEach((ex, i) => {
    const exKey = 'ex_' + i;
    const checked = saved.exercises[exKey]?.done ? 'checked' : '';
    const weight = saved.exercises[exKey]?.weight || '';
    const section = ex.section || 'main';

    // Section header
    if (section !== lastSection) {
      html += `<div class="exercise-section-label">${labels[section] || section}</div>`;
      lastSection = section;
    }

    // Only show weight input for main lifts and accessory work (not warmup/finisher)
    const showWeight = (section === 'main' || section === 'accessory') && !isBodyweightExercise(ex.name);
    html += `
      <div class="exercise-item ${section === 'warmup' ? 'exercise-warmup' : ''} ${section === 'finisher' ? 'exercise-finisher' : ''}">
        <input type="checkbox" class="exercise-check" data-ex="${exKey}" ${checked}>
        <div class="exercise-info">
          <div class="exercise-name">${ex.name}</div>
          <div class="exercise-detail">${ex.sets}</div>
        </div>
        ${showWeight ? `
        <div class="exercise-weight">
          <input type="number" class="weight-input" data-ex="${exKey}" value="${weight}" placeholder="lbs" min="0" step="5">
          <span class="weight-unit">lbs</span>
        </div>` : '<div></div>'}
      </div>
    `;
  });
  $('#workout-exercises').innerHTML = html;
  $('#workout-card').style.display = '';

  function isBodyweightExercise(name) {
    const bw = ['Plank', 'Foam Roll', 'Vagus', 'Bird Dog', 'Pallof', 'Dead Bug', 'Hanging Leg', 'Bodyweight', 'Banded', 'Band Pull', 'Arm Circle', 'Scapular', 'Hip 90', 'Monster Walk', 'Cold Water', 'Deep Breathing', 'Humming', 'Lacrosse', 'Gentle Yoga'];
    return bw.some(kw => name.includes(kw));
  }

  // Event listeners
  $$('.exercise-check').forEach(cb => {
    cb.addEventListener('change', () => saveWorkoutState());
  });
  $$('.weight-input').forEach(inp => {
    inp.addEventListener('change', () => saveWorkoutState());
    inp.addEventListener('blur', () => saveWorkoutState());
  });
}

function saveWorkoutState() {
  const key = todayKey();
  const workouts = LS.get('workouts') || {};
  const exercises = {};
  let allDone = true;

  $$('.exercise-check').forEach(cb => {
    const exKey = cb.dataset.ex;
    const weightInput = $(`.weight-input[data-ex="${exKey}"]`);
    exercises[exKey] = {
      done: cb.checked,
      weight: weightInput ? parseFloat(weightInput.value) || 0 : 0
    };
    if (!cb.checked) allDone = false;
  });

  workouts[key] = { exercises, completed: allDone };
  LS.set('workouts', workouts);
}

function renderCyclingDay() {
  $('#workout-title').textContent = 'Cycling Day';
  $('#workout-exercises').innerHTML = `
    <div class="cycling-card">
      <div class="cycling-emoji">🚴‍♀️</div>
      <div class="cycling-title">Cycling Day</div>
      <div class="cycling-text">Enjoy your ride! Remember pre-ride nutrition (15–20g protein + 30–40g carbs) and post-ride recovery (30–40g protein + 40–60g carbs within 45 minutes).</div>
    </div>
  `;
}

function renderHabits() {
  const key = todayKey();
  const allHabits = LS.get('habits') || {};
  const todayHabits = allHabits[key] || {};

  let html = '';
  HABITS.forEach((habit, i) => {
    const hKey = 'h_' + i;
    const checked = todayHabits[hKey] ? 'checked' : '';
    html += `
      <div class="habit-item">
        <input type="checkbox" class="habit-check" id="${hKey}" data-habit="${hKey}" ${checked}>
        <label class="habit-label" for="${hKey}">${habit}</label>
      </div>
    `;
  });
  $('#habits-list').innerHTML = html;

  $$('.habit-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const key = todayKey();
      const allHabits = LS.get('habits') || {};
      const todayHabits = allHabits[key] || {};
      todayHabits[cb.dataset.habit] = cb.checked;
      allHabits[key] = todayHabits;
      LS.set('habits', allHabits);
      renderKPIs();
    });
  });
}

function getHabitsData() {
  const key = todayKey();
  const allHabits = LS.get('habits') || {};
  const todayHabits = allHabits[key] || {};
  return HABITS.map((h, i) => ({ name: h, done: !!todayHabits['h_' + i] }));
}

// ── NUTRITION Tab (full macros) ──

// Migration: detect old protein-only format and convert
function migrateNutritionData(data) {
  if (!data) return { entries: [], totals: { protein: 0, calories: 0, carbs: 0, fat: 0 } };
  // Old format: has numeric `total` and entries with `grams`
  if (typeof data.total === 'number') {
    return {
      entries: data.entries.map(e => ({
        name: e.name,
        protein: e.grams || 0,
        calories: 0,
        carbs: 0,
        fat: 0,
        time: e.time || '',
      })),
      totals: {
        protein: data.total,
        calories: 0,
        carbs: 0,
        fat: 0,
      }
    };
  }
  // Already new format
  if (!data.totals) {
    data.totals = { protein: 0, calories: 0, carbs: 0, fat: 0 };
  }
  return data;
}

function getNutritionData() {
  const key = todayKey();
  const allProtein = LS.get('protein') || {};
  const raw = allProtein[key] || null;
  return migrateNutritionData(raw);
}

function saveNutritionData(data) {
  const key = todayKey();
  const allProtein = LS.get('protein') || {};
  allProtein[key] = data;
  LS.set('protein', allProtein);
}

function calcTotals(entries) {
  return entries.reduce((acc, e) => {
    acc.protein += (e.protein || 0);
    acc.calories += (e.calories || 0);
    acc.carbs += (e.carbs || 0);
    acc.fat += (e.fat || 0);
    return acc;
  }, { protein: 0, calories: 0, carbs: 0, fat: 0 });
}

function addNutritionEntry(name, protein, calories, carbs, fat) {
  const data = getNutritionData();
  data.entries.push({
    name,
    protein,
    calories,
    carbs,
    fat,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
  data.totals = calcTotals(data.entries);
  saveNutritionData(data);
  renderNutrition();
  renderKPIs();
}

function removeNutritionEntry(index) {
  const data = getNutritionData();
  data.entries.splice(index, 1);
  data.totals = calcTotals(data.entries);
  saveNutritionData(data);
  renderNutrition();
  renderKPIs();
}

// Backward-compatible alias used by old clearDayBtn handler
function getProteinData() { return getNutritionData(); }

function renderNutrition() {
  const settings = getSettings();
  const data = getNutritionData();
  const t = data.totals;

  // Protein ring
  $('#proteinTargetLabel').textContent = settings.proteinTarget + 'g';
  $('#proteinTargetDisplay').textContent = settings.proteinTarget + 'g';
  $('#proteinRingValue').textContent = t.protein + 'g';
  const remaining = Math.max(0, settings.proteinTarget - t.protein);
  $('#proteinRemaining').textContent = remaining > 0 ? remaining + 'g remaining' : 'Target reached!';
  $('#proteinRemaining').style.color = remaining === 0 ? 'var(--color-success)' : '';

  drawProteinRing();

  // Macro bars
  const calPct = Math.min(t.calories / (settings.caloriesTarget || 1700) * 100, 100).toFixed(1);
  const carbPct = Math.min(t.carbs / (settings.carbsTarget || 170) * 100, 100).toFixed(1);
  const fatPct = Math.min(t.fat / (settings.fatTarget || 57) * 100, 100).toFixed(1);

  $('#caloriesCurrent').textContent = t.calories;
  $('#caloriesTarget').textContent = settings.caloriesTarget || 1700;
  $('#caloriesBar').style.width = calPct + '%';

  $('#carbsCurrent').textContent = t.carbs;
  $('#carbsTarget').textContent = settings.carbsTarget || 170;
  $('#carbsBar').style.width = carbPct + '%';

  $('#fatCurrent').textContent = t.fat;
  $('#fatTarget').textContent = settings.fatTarget || 57;
  $('#fatBar').style.width = fatPct + '%';

  // Macro target inputs
  $('#proteinTargetInput').value = settings.proteinTarget;
  $('#caloriesTargetInput').value = settings.caloriesTarget || 1700;
  $('#carbsTargetInput').value = settings.carbsTarget || 170;
  $('#fatTargetInput').value = settings.fatTarget || 57;

  renderQuickAddGrid();
  renderMealLog();
}

function drawProteinRing() {
  const canvas = $('#proteinRingCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = 160;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.scale(dpr, dpr);

  const settings = getSettings();
  const data = getNutritionData();
  const pct = Math.min(data.totals.protein / settings.proteinTarget, 1);

  const cx = size / 2;
  const cy = size / 2;
  const r = 62;
  const lineWidth = 10;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const bgColor = isDark ? '#393836' : '#D4D1CA';
  const fgColor = isDark ? '#4F98A3' : '#01696F';

  ctx.clearRect(0, 0, size, size);

  // Background ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = bgColor;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Progress ring
  if (pct > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
    ctx.strokeStyle = fgColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

function renderQuickAddGrid() {
  let html = '';
  QUICK_FOODS.forEach(food => {
    html += `
      <button class="quick-add-btn" data-food="${food.name}" data-protein="${food.protein}" data-calories="${food.calories}" data-carbs="${food.carbs}" data-fat="${food.fat}">
        ${food.name}
        <span class="quick-add-grams">${food.protein}g protein</span>
      </button>
    `;
  });
  $('#quickAddGrid').innerHTML = html;

  $$('.quick-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      addNutritionEntry(
        btn.dataset.food,
        parseInt(btn.dataset.protein) || 0,
        parseInt(btn.dataset.calories) || 0,
        parseInt(btn.dataset.carbs) || 0,
        parseInt(btn.dataset.fat) || 0
      );
    });
  });
}

function renderMealLog() {
  const data = getNutritionData();
  if (data.entries.length === 0) {
    $('#mealLog').innerHTML = '<div class="empty-state">No entries yet today</div>';
    return;
  }

  let html = '';
  data.entries.forEach((entry, i) => {
    html += `
      <div class="meal-log-item">
        <span class="meal-log-name">${entry.name}</span>
        <span class="meal-log-grams">${entry.calories}kcal &middot; ${entry.protein}g</span>
        <button class="meal-log-delete" data-index="${i}" aria-label="Remove entry">×</button>
      </div>
    `;
  });
  $('#mealLog').innerHTML = html;

  $$('.meal-log-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      removeNutritionEntry(parseInt(btn.dataset.index));
    });
  });
}

// Custom entry
$('#customAddBtn').addEventListener('click', () => {
  const name = $('#customFoodName').value.trim();
  const calories = parseInt($('#customFoodCalories').value) || 0;
  const protein = parseInt($('#customFoodProtein').value) || 0;
  const carbs = parseInt($('#customFoodCarbs').value) || 0;
  const fat = parseInt($('#customFoodFat').value) || 0;
  if (name && (calories > 0 || protein > 0 || carbs > 0 || fat > 0)) {
    addNutritionEntry(name, protein, calories, carbs, fat);
    $('#customFoodName').value = '';
    $('#customFoodCalories').value = '';
    $('#customFoodProtein').value = '';
    $('#customFoodCarbs').value = '';
    $('#customFoodFat').value = '';
  }
});

// Clear day
$('#clearDayBtn').addEventListener('click', () => {
  if (confirm('Clear all macro entries for today?')) {
    saveNutritionData({ entries: [], totals: { protein: 0, calories: 0, carbs: 0, fat: 0 } });
    renderNutrition();
    renderKPIs();
  }
});

// Macro targets save
$('#saveMacroTargetsBtn').addEventListener('click', () => {
  const s = getSettings();
  const cal = parseInt($('#caloriesTargetInput').value);
  const prot = parseInt($('#proteinTargetInput').value);
  const carb = parseInt($('#carbsTargetInput').value);
  const fatV = parseInt($('#fatTargetInput').value);
  if (prot >= 50 && prot <= 300) s.proteinTarget = prot;
  if (cal >= 800 && cal <= 4000) s.caloriesTarget = cal;
  if (carb >= 0 && carb <= 600) s.carbsTarget = carb;
  if (fatV >= 0 && fatV <= 200) s.fatTarget = fatV;
  saveSettings(s);
  renderNutrition();
  renderKPIs();
});

// ── SUPPLEMENTS Tab ──
function renderSupplements() {
  const suppData = getSupplementsData();

  let html = '';
  SUPPLEMENTS.forEach((supp, i) => {
    const sKey = 's_' + i;
    const checked = suppData[sKey] ? 'checked' : '';
    html += `
      <div class="supp-item">
        <input type="checkbox" class="supp-check" id="${sKey}" data-supp="${sKey}" ${checked}>
        <label class="supp-label-wrap" for="${sKey}">
          <span class="supp-label">${supp.name} <span class="supp-timing">(${supp.dose})</span></span>
          <span class="supp-timing">${supp.timing}</span>
        </label>
      </div>
    `;
  });
  $('#supplements-list').innerHTML = html;

  $$('.supp-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const data = getSupplementsData();
      data[cb.dataset.supp] = cb.checked;
      saveSupplementsData(data);
      renderKPIs();
    });
  });
}

// ── PROGRESS Tab ──
function renderProgress() {
  renderPhaseTimeline();
  renderWeekSelector();
  drawMeasurementChart();
  renderLiftTable();
  drawLiftChart();
}

function renderPhaseTimeline() {
  const week = getProgramWeek();
  const phases = [
    { name: 'Foundation', weeks: '1–4', range: [1,4] },
    { name: 'Build', weeks: '5–8', range: [5,8] },
    { name: 'Peak', weeks: '9–12', range: [9,12] },
  ];

  let html = '';
  phases.forEach(p => {
    const isActive = week >= p.range[0] && week <= p.range[1];
    const isCompleted = week > p.range[1];
    const cls = isActive ? 'active' : isCompleted ? 'completed' : '';
    html += `
      <div class="phase-block ${cls}">
        <div class="phase-name">${p.name}</div>
        <div class="phase-weeks">Wk ${p.weeks}</div>
      </div>
    `;
  });
  $('#phaseTimeline').innerHTML = html;
}

function renderWeekSelector() {
  const week = getProgramWeek();
  $('#weekDisplay').textContent = 'Week ' + week;
}

$('#weekPrev').addEventListener('click', () => {
  setProgramWeek(getProgramWeek() - 1);
  renderProgress();
});
$('#weekNext').addEventListener('click', () => {
  setProgramWeek(getProgramWeek() + 1);
  renderProgress();
});

// Measurements
$('#saveMeasurementsBtn').addEventListener('click', () => {
  const weight = parseFloat($('#weightInput').value);
  const waist = parseFloat($('#waistInput').value);
  if (!weight && !waist) return;

  const key = todayKey();
  const measurements = LS.get('measurements') || {};
  measurements[key] = {
    weight: weight || (measurements[key]?.weight || 0),
    waist: waist || (measurements[key]?.waist || 0),
  };
  LS.set('measurements', measurements);
  $('#weightInput').value = '';
  $('#waistInput').value = '';
  drawMeasurementChart();
});

function drawMeasurementChart() {
  const canvas = $('#measurementChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = rect.width;
  const h = 200;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(dpr, dpr);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#797876' : '#7A7974';
  const gridColor = isDark ? '#393836' : '#D4D1CA';
  const tealColor = isDark ? '#4F98A3' : '#01696F';
  const terraColor = isDark ? '#BB653B' : '#A84B2F';

  const measurements = LS.get('measurements') || {};
  const keys = Object.keys(measurements).sort().slice(-12);

  ctx.clearRect(0, 0, w, h);

  if (keys.length < 2) {
    ctx.fillStyle = textColor;
    ctx.font = '14px Satoshi, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Add at least 2 measurements to see chart', w/2, h/2);
    return;
  }

  const pad = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const weights = keys.map(k => measurements[k].weight).filter(v => v > 0);
  const waists = keys.map(k => measurements[k].waist).filter(v => v > 0);

  // Draw weight line
  if (weights.length >= 2) {
    const minW = Math.min(...weights) - 2;
    const maxW = Math.max(...weights) + 2;
    const rangeW = maxW - minW || 1;

    // Grid lines
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = textColor;
      ctx.font = '11px Satoshi, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText((maxW - (rangeW / 4) * i).toFixed(0) + ' lb', pad.left - 6, y + 4);
    }

    // Weight line
    ctx.beginPath();
    ctx.strokeStyle = tealColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    let idx = 0;
    keys.forEach((k, i) => {
      if (measurements[k].weight > 0) {
        const x = pad.left + (i / (keys.length - 1)) * chartW;
        const y = pad.top + (1 - (measurements[k].weight - minW) / rangeW) * chartH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        idx++;
      }
    });
    ctx.stroke();

    // Dots
    idx = 0;
    keys.forEach((k, i) => {
      if (measurements[k].weight > 0) {
        const x = pad.left + (i / (keys.length - 1)) * chartW;
        const y = pad.top + (1 - (measurements[k].weight - minW) / rangeW) * chartH;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = tealColor;
        ctx.fill();
        idx++;
      }
    });
  }

  // Date labels
  ctx.fillStyle = textColor;
  ctx.font = '10px Satoshi, sans-serif';
  ctx.textAlign = 'center';
  keys.forEach((k, i) => {
    if (i % Math.ceil(keys.length / 6) === 0 || i === keys.length - 1) {
      const x = pad.left + (i / (keys.length - 1)) * chartW;
      const parts = k.split('-');
      ctx.fillText(parts[1] + '/' + parts[2], x, h - pad.bottom + 18);
    }
  });

  // Legend
  ctx.font = '11px Satoshi, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = tealColor;
  ctx.fillRect(pad.left, h - 12, 12, 3);
  ctx.fillText('Weight', pad.left + 16, h - 8);

  if (waists.length >= 2) {
    ctx.fillStyle = terraColor;
    ctx.fillRect(pad.left + 80, h - 12, 12, 3);
    ctx.fillText('Waist', pad.left + 96, h - 8);
  }
}

function renderLiftTable() {
  const lifts = LS.get('lifts') || {};
  const keys = Object.keys(lifts).sort();
  const latest = keys.length > 0 ? lifts[keys[keys.length - 1]] : {};
  const prev = keys.length > 1 ? lifts[keys[keys.length - 2]] : {};

  let html = '';
  LIFTS.forEach(lift => {
    const lKey = lift.toLowerCase().replace(/\s+/g, '_');
    const cur = latest[lKey] || '';
    const p = prev[lKey] || '';
    html += `
      <tr>
        <td>${lift}</td>
        <td><input type="number" class="lift-input" data-lift="${lKey}" value="${cur}" placeholder="—" min="0" step="5"></td>
        <td class="text-muted">${p ? p + ' lbs' : '—'}</td>
      </tr>
    `;
  });
  $('#liftTableBody').innerHTML = html;
}

$('#saveLiftsBtn').addEventListener('click', () => {
  const key = todayKey();
  const lifts = LS.get('lifts') || {};
  const data = {};
  let hasData = false;
  $$('.lift-input').forEach(inp => {
    const val = parseFloat(inp.value);
    if (val > 0) {
      data[inp.dataset.lift] = val;
      hasData = true;
    }
  });
  if (hasData) {
    lifts[key] = data;
    LS.set('lifts', lifts);
    renderLiftTable();
    drawLiftChart();
  }
});

function drawLiftChart() {
  const canvas = $('#liftChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = rect.width;
  const h = 200;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(dpr, dpr);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#797876' : '#7A7974';
  const gridColor = isDark ? '#393836' : '#D4D1CA';

  const lifts = LS.get('lifts') || {};
  const keys = Object.keys(lifts).sort().slice(-8);

  ctx.clearRect(0, 0, w, h);

  if (keys.length < 1) {
    ctx.fillStyle = textColor;
    ctx.font = '14px Satoshi, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Save lift data to see progress chart', w/2, h/2);
    return;
  }

  const pad = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  // Gather all values to find range
  let allVals = [];
  keys.forEach(k => {
    LIFTS.forEach(lift => {
      const lKey = lift.toLowerCase().replace(/\s+/g, '_');
      if (lifts[k][lKey]) allVals.push(lifts[k][lKey]);
    });
  });

  if (allVals.length === 0) {
    ctx.fillStyle = textColor;
    ctx.font = '14px Satoshi, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Save lift data to see progress chart', w/2, h/2);
    return;
  }

  const minV = Math.min(...allVals) - 10;
  const maxV = Math.max(...allVals) + 10;
  const rangeV = maxV - minV || 1;

  // Grid
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = textColor;
    ctx.font = '11px Satoshi, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText((maxV - (rangeV/4)*i).toFixed(0), pad.left - 6, y + 4);
  }

  // Lines for each lift
  const colors = isDark
    ? ['#4F98A3', '#BB653B', '#6DAA45', '#797876', '#CDCCCA']
    : ['#01696F', '#A84B2F', '#437A22', '#7A7974', '#28251D'];

  LIFTS.forEach((lift, li) => {
    const lKey = lift.toLowerCase().replace(/\s+/g, '_');
    ctx.beginPath();
    ctx.strokeStyle = colors[li];
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    let started = false;
    keys.forEach((k, i) => {
      const val = lifts[k][lKey];
      if (val) {
        const x = keys.length === 1 ? pad.left + chartW / 2 : pad.left + (i / (keys.length - 1)) * chartW;
        const y = pad.top + (1 - (val - minV) / rangeV) * chartH;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  });

  // Legend
  ctx.font = '10px Satoshi, sans-serif';
  ctx.textAlign = 'left';
  const legendY = h - 8;
  let legendX = pad.left;
  LIFTS.forEach((lift, li) => {
    ctx.fillStyle = colors[li];
    ctx.fillRect(legendX, legendY - 3, 10, 3);
    ctx.fillText(lift.split(' ')[0], legendX + 13, legendY);
    legendX += ctx.measureText(lift.split(' ')[0]).width + 22;
  });

  // Date labels
  ctx.fillStyle = textColor;
  ctx.font = '10px Satoshi, sans-serif';
  ctx.textAlign = 'center';
  keys.forEach((k, i) => {
    const x = keys.length === 1 ? pad.left + chartW / 2 : pad.left + (i / (keys.length - 1)) * chartW;
    const parts = k.split('-');
    ctx.fillText(parts[1] + '/' + parts[2], x, pad.top + chartH + 16);
  });
}

// ── Export ──
$('#exportBtn').addEventListener('click', () => {
  const data = {};
  const prefix = 'rcyc_';
  if (_ls) {
    for (let i = 0; i < _ls.length; i++) {
      const key = _ls.key(i);
      if (key.startsWith(prefix)) {
        try { data[key] = JSON.parse(_ls.getItem(key)); }
        catch { data[key] = _ls.getItem(key); }
      }
    }
  } else {
    Object.keys(_memStore).forEach(key => {
      if (key.startsWith(prefix)) {
        try { data[key] = JSON.parse(_memStore[key]); }
        catch { data[key] = _memStore[key]; }
      }
    });
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'reclaim-your-core-data-' + todayKey() + '.json';
  a.click();
  URL.revokeObjectURL(url);
});

// ── Accordion Toggle ──
function toggleAccordion(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}
// Make global
window.toggleAccordion = toggleAccordion;

// ── Init ──
renderToday();
renderNutrition();
renderProgress();
