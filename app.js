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
  if (tabName === 'history') renderHistoryTab();
}

tabButtons.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

// ── Settings ──
function getSettings() {
  const defaults = {
    proteinTarget: 105,
    caloriesTarget: 1700,
    carbsTarget: 170,
    fatTarget: 57,
    bodyWeight: 140,
    startDate: '2026-03-31',
    travelMode: false,
    workoutPointer: 1,
  };
  const saved = LS.get('settings');
  return saved ? Object.assign({}, defaults, saved) : defaults;
}
function saveSettings(s) { LS.set('settings', s); }

// ── Program Week ──
function getProgramWeek() {
  const settings = getSettings();
  if (settings.travelMode && settings.travelStartWeek) {
    return settings.travelStartWeek;
  }
  const stored = LS.get('programWeek');
  if (stored) return stored;
  // Compute from startDate
  const start = new Date((settings.startDate || '2026-03-31') + 'T12:00:00');
  const today = new Date();
  const days = Math.floor((today - start) / 86400000);
  const week = Math.max(1, Math.min(12, Math.floor(days / 7) + 1));
  return week;
}
function setProgramWeek(w) { LS.set('programWeek', Math.max(1, Math.min(12, w))); }

function toggleTravelMode() {
  const settings = getSettings();
  if (!settings.travelMode) {
    // Turning ON — capture week BEFORE setting flag
    settings.travelStartWeek = getProgramWeek();
    settings.travelStartDate = todayKey();
    settings.travelMode = true;
  } else {
    // Turning OFF — shift startDate forward by elapsed travel days
    const today = new Date();
    const start = new Date(settings.travelStartDate);
    const daysElapsed = Math.round((today - start) / 86400000);
    const startDate = new Date(settings.startDate);
    startDate.setDate(startDate.getDate() + daysElapsed);
    settings.startDate = startDate.getFullYear() + '-' + String(startDate.getMonth()+1).padStart(2,'0') + '-' + String(startDate.getDate()).padStart(2,'0');
    settings.travelMode = false;
    delete settings.travelStartWeek;
    delete settings.travelStartDate;
  }
  saveSettings(settings);
  renderToday();
  const banner = document.getElementById('travel-banner');
  if (banner) banner.style.display = settings.travelMode ? '' : 'none';
  updateTravelBtn();
}

function updateTravelBtn() {
  const btn = document.getElementById('travelModeBtn');
  const banner = document.getElementById('travel-banner');
  if (!btn) return;
  const settings = getSettings();
  if (settings.travelMode) {
    btn.textContent = 'Exit Travel Mode';
    btn.classList.add('travel-mode-active');
    if (banner) banner.style.display = '';
  } else {
    btn.textContent = '✈ Travel Mode';
    btn.classList.remove('travel-mode-active');
    if (banner) banner.style.display = 'none';
  }
}

// ── Workout Data ──
const WORKOUTS = {
  1: { // Monday — Upper Push
    name: 'Upper Body Push',
    exercises: [
      // Warm-up
      { name: 'Aletha Range — Upper Traps + Pecs', sets: '90 sec each side', section: 'warmup' },
      { name: 'Foam Roll Thoracic Spine (broad)', sets: '2 min', section: 'warmup' },
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
      // Warm-up
      { name: 'Aletha Mark — Hip Flexors / Psoas', sets: '90 sec each side', section: 'warmup' },
      { name: 'Aletha Orbit — Glutes + Piriformis', sets: '90 sec each side', section: 'warmup' },
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
      { name: 'Aletha Mark — Hip Flexors / Psoas', sets: '90 sec each side', section: 'accessory' },
      { name: 'Aletha Orbit — Piriformis + Glutes', sets: '90 sec each side', section: 'accessory' },
      { name: 'Aletha Range — Upper Traps + Suboccipitals', sets: '90 sec each side', section: 'accessory' },
      { name: 'Foam Roll IT Band + Thoracic Spine (broad)', sets: '5 min', section: 'accessory' },
      { name: 'Gentle Yoga (Cat-Cow, Child\'s Pose, Thread the Needle)', sets: '5 min', section: 'finisher' },
    ]
  },
  4: { // Thursday — Upper Pull
    name: 'Upper Body Pull',
    exercises: [
      // Warm-up
      { name: 'Aletha Range — Upper Traps + Suboccipitals', sets: '90 sec each side', section: 'warmup' },
      { name: 'Foam Roll Lats (broad)', sets: '2 min', section: 'warmup' },
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
      // Warm-up
      { name: 'Aletha Mark — Hip Flexors / Psoas', sets: '90 sec each side', section: 'warmup' },
      { name: 'Aletha Orbit — Glutes + Piriformis', sets: '90 sec each side', section: 'warmup' },
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

// ── Travel Workouts ──
const TRAVEL_WORKOUTS = {
  1: { // Monday — Upper Push (Travel)
    name: 'Travel — Upper Push',
    exercises: [
      { name: 'Aletha Range — Upper Traps + Pecs', sets: '90 sec each side', section: 'warmup' },
      { name: 'Band Pull-Aparts', sets: '2×15', section: 'warmup' },
      { name: 'Arm Circles + Shoulder CARs', sets: '2 min', section: 'warmup' },
      { name: 'Push-ups (or Decline Push-ups)', sets: '4×10–15', section: 'main' },
      { name: 'Pike Push-ups (shoulder focus)', sets: '4×8–12', section: 'main' },
      { name: 'Banded Chest Press', sets: '3×12–15', section: 'accessory' },
      { name: 'Banded Lateral Raises', sets: '3×12–15', section: 'accessory' },
      { name: 'Tricep Dips on Chair', sets: '3×8–12', section: 'accessory' },
      { name: 'Plank Hold', sets: '3×30–45s', section: 'finisher' },
    ]
  },
  2: { // Tuesday — Lower Body (Travel)
    name: 'Travel — Lower Body (Quad/Glute)',
    exercises: [
      { name: 'Aletha Mark — Hip Flexors', sets: '90 sec each side', section: 'warmup' },
      { name: 'Aletha Orbit — Glutes', sets: '90 sec each side', section: 'warmup' },
      { name: 'Bodyweight Squats', sets: '2×10', section: 'warmup' },
      { name: 'Banded Glute Bridges', sets: '2×15', section: 'warmup' },
      { name: 'Bulgarian Split Squat (bodyweight)', sets: '4×10–12 each', section: 'main' },
      { name: 'Goblet Squat (suitcase or backpack)', sets: '4×12–15', section: 'main' },
      { name: 'Banded Lateral Walks', sets: '3×15 each direction', section: 'accessory' },
      { name: 'Single-Leg Glute Bridge', sets: '3×10 each', section: 'accessory' },
      { name: 'Banded Clamshells', sets: '3×15 each side', section: 'accessory' },
      { name: 'Pallof Press (banded)', sets: '3×10 each side', section: 'finisher' },
    ]
  },
  3: { // Wednesday — Active Recovery (Travel)
    name: 'Active Recovery — Vagus + Fascia',
    exercises: [
      { name: 'Cold Water Face Splash', sets: '30 sec', section: 'warmup' },
      { name: 'Deep Breathing (4-7-8 Pattern)', sets: '3 min', section: 'warmup' },
      { name: 'Humming / Chanting', sets: '2–3 min', section: 'warmup' },
      { name: 'Planks', sets: '3×30–60s', section: 'main' },
      { name: 'Pallof Press (banded)', sets: '3×10 each', section: 'main' },
      { name: 'Bird Dogs', sets: '3×10 each', section: 'main' },
      { name: 'Aletha Mark — Hip Flexors / Psoas', sets: '90 sec each side', section: 'accessory' },
      { name: 'Aletha Orbit — Piriformis + Glutes', sets: '90 sec each side', section: 'accessory' },
      { name: 'Aletha Range — Neck + Shoulders', sets: '90 sec each side', section: 'accessory' },
      { name: 'Gentle Yoga (Cat-Cow, Child\'s Pose, Thread the Needle)', sets: '5 min', section: 'finisher' },
    ]
  },
  4: { // Thursday — Upper Pull (Travel)
    name: 'Travel — Upper Pull',
    exercises: [
      { name: 'Aletha Range — Upper Traps + Suboccipitals', sets: '90 sec each side', section: 'warmup' },
      { name: 'Band Pull-Aparts', sets: '2×15', section: 'warmup' },
      { name: 'Scapular Wall Slides', sets: '2×10', section: 'warmup' },
      { name: 'Banded Pull-Aparts (heavy band)', sets: '4×12–15', section: 'main' },
      { name: 'Banded Bent-Over Row', sets: '4×10–12', section: 'main' },
      { name: 'Banded Lat Pulldown (anchor band high)', sets: '3×10–12', section: 'accessory' },
      { name: 'Banded Face Pulls', sets: '3×12–15', section: 'accessory' },
      { name: 'Banded Bicep Curls', sets: '3×10–12', section: 'accessory' },
      { name: 'Dead Bug', sets: '3×8 each side', section: 'finisher' },
    ]
  },
  5: { // Friday — Lower Body Hinge (Travel)
    name: 'Travel — Lower Body (Hinge/Posterior)',
    exercises: [
      { name: 'Aletha Mark — Hip Flexors', sets: '90 sec each side', section: 'warmup' },
      { name: 'Aletha Orbit — Glutes', sets: '90 sec each side', section: 'warmup' },
      { name: 'Hip 90/90 Mobility', sets: '2×5 each side', section: 'warmup' },
      { name: 'Banded Monster Walks', sets: '2×12 each direction', section: 'warmup' },
      { name: 'Single-Leg RDL (bodyweight or suitcase)', sets: '4×10 each', section: 'main' },
      { name: 'Banded Good Mornings', sets: '4×12–15', section: 'main' },
      { name: 'Banded Hip Thrusts', sets: '3×15', section: 'accessory' },
      { name: 'Glute Bridge March', sets: '3×10 each', section: 'accessory' },
      { name: 'Standing Calf Raises', sets: '3×15–20', section: 'accessory' },
      { name: 'Hanging Leg Raises (or Reverse Crunch)', sets: '3×10', section: 'finisher' },
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

  // Travel mode UI update
  updateTravelBtn();

  // Workout — locked to day of week (Mon=1..Fri=5, Sat/Sun=cycling)
  const settings = getSettings();
  const workoutId = getWorkoutIdForDate(now);
  if (settings.travelMode) {
    if (workoutId === null) {
      renderTravelRecoveryDay();
    } else {
      renderWorkout(workoutId);
    }
  } else {
    if (workoutId === null) {
      renderCyclingDay();
    } else {
      renderWorkout(workoutId);
    }
  }

  // Habits
  renderHabits();

  // History
  renderWorkoutHistory();
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

// ── Bodyweight / Finisher Weight Helpers ──
function isBodyweightExercise(name) {
  const bw = ['Foam Roll', 'Vagus', 'Bird Dog', 'Bodyweight', 'Banded', 'Band Pull', 'Arm Circle', 'Scapular', 'Hip 90', 'Monster Walk', 'Cold Water', 'Deep Breathing', 'Humming', 'Lacrosse', 'Gentle Yoga', 'Aletha', 'Push-up', 'Pike Push', 'Tricep Dip', 'Bodyweight Squat', 'Single-Leg Glute'];
  return bw.some(kw => name.includes(kw));
}

function finisherUsesWeight(name) {
  return ['Plank Hold', 'Hanging Leg', 'Dead Bug', 'Pallof'].some(kw => name.includes(kw));
}

function renderWorkout(workoutId) {
  const settings = getSettings();
  const workoutSet = settings.travelMode ? TRAVEL_WORKOUTS : WORKOUTS;
  const workout = workoutSet[workoutId];
  if (!workout) return;

  const key = todayKey();
  const workouts = LS.get('workouts') || {};
  const saved = workouts[key] || { exercises: {}, completed: false };

  $('#workout-title').textContent = workout.name;

  // Travel mode visual treatment
  const card = $('#workout-card');
  if (card) {
    card.style.display = '';
    if (settings.travelMode) {
      card.classList.add('workout-travel-mode');
    } else {
      card.classList.remove('workout-travel-mode');
    }
  }
  // Travel chip + subtitle
  const existingChip = document.getElementById('travel-mode-chip');
  if (existingChip) existingChip.remove();
  if (settings.travelMode) {
    const chip = document.createElement('div');
    chip.id = 'travel-mode-chip';
    chip.className = 'travel-mode-chip';
    chip.innerHTML = '🏝 TRAVEL &mdash; <span style="font-weight:400">Bodyweight &amp; mini-band only &mdash; equipment-free</span>';
    const titleEl = document.getElementById('workout-title');
    if (titleEl && titleEl.parentNode) {
      titleEl.parentNode.insertBefore(chip, titleEl.nextSibling);
    }
  }

  // Section labels — workout 3 (Active Recovery) uses different labels
  const sectionLabels = {
    warmup: 'Warm-up',
    main: 'Main Lifts — Heavy',
    accessory: 'Accessory Work',
    finisher: 'Finisher',
  };
  const wedLabels = {
    warmup: 'Vagus Nerve Reset',
    main: 'Core Work',
    accessory: 'Fascia Release',
    finisher: 'Cool Down',
  };
  const isRecovery = workout.name.includes('Recovery') || workout.name.includes('Vagus');
  const labels = isRecovery ? wedLabels : sectionLabels;

  let html = '';
  let lastSection = '';
  workout.exercises.forEach((ex, i) => {
    const exKey = 'ex_' + i;
    const checked = saved.exercises[exKey]?.done ? 'checked' : '';
    const weight = saved.exercises[exKey]?.weight || '';
    const section = ex.section || 'main';

    if (section !== lastSection) {
      html += `<div class="exercise-section-label">${labels[section] || section}</div>`;
      lastSection = section;
    }

    // Show weight input for main/accessory (not BW) + specific weighted finishers
    const showWeight = (section === 'main' || section === 'accessory' ||
      (section === 'finisher' && finisherUsesWeight(ex.name))) && !isBodyweightExercise(ex.name);

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

  // Skip / Mark Complete buttons (toggleable)
  const actionRow = document.getElementById('workout-action-row');
  if (actionRow) {
    const skippedDays = LS.get('skipped_days') || {};
    const isSkipped = !!skippedDays[key];
    const isComplete = !!saved.completed;

    actionRow.innerHTML = `
      <button class="btn-skip ${isSkipped ? 'btn-skip-active' : ''}" id="skipDayBtn">
        ${isSkipped ? '\u2713 Day Skipped (tap to undo)' : 'Skip Day'}
      </button>
      <button class="btn-complete ${isComplete ? 'btn-complete-active' : ''}" id="markCompleteBtn">
        ${isComplete ? '\u2713 Workout Complete (tap to undo)' : 'Mark Complete'}
      </button>
    `;

    const skipBtn = document.getElementById('skipDayBtn');
    const completeBtn = document.getElementById('markCompleteBtn');

    // Day-of-week locked workout for today
    const todayWorkoutId = getWorkoutIdForDate(new Date()) || workoutId;

    skipBtn.addEventListener('click', () => {
      const sk = LS.get('skipped_days') || {};
      if (sk[key]) {
        delete sk[key]; // un-skip
        LS.set('skipped_days', sk);
      } else {
        // If currently complete, clear complete when skipping
        const wos = LS.get('workouts') || {};
        if (wos[key] && wos[key].completed) {
          wos[key].completed = false;
          LS.set('workouts', wos);
        }
        sk[key] = { workoutId: todayWorkoutId, workoutName: getWorkoutName(todayWorkoutId, settings.travelMode) };
        LS.set('skipped_days', sk);
      }
      renderToday();
    });

    completeBtn.addEventListener('click', () => {
      const wos = LS.get('workouts') || {};
      if (wos[key] && wos[key].completed) {
        // un-complete
        wos[key].completed = false;
        LS.set('workouts', wos);
      } else {
        // Clear skip if present
        const sk = LS.get('skipped_days') || {};
        if (sk[key]) { delete sk[key]; LS.set('skipped_days', sk); }
        saveWorkoutState(true);
        // Store workoutName + workoutId on the saved record for history
        const wos2 = LS.get('workouts') || {};
        if (wos2[key]) {
          wos2[key].workoutId = todayWorkoutId;
          wos2[key].workoutName = getWorkoutName(todayWorkoutId, settings.travelMode);
          wos2[key].travelMode = !!settings.travelMode;
          LS.set('workouts', wos2);
        }
      }
      renderToday();
    });
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

function saveWorkoutState(forceComplete) {
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

  workouts[key] = { exercises, completed: forceComplete || allDone };
  LS.set('workouts', workouts);
}

function renderTravelRecoveryDay() {
  $('#workout-title').textContent = '🏝 Travel Recovery Day';
  $('#workout-exercises').innerHTML = `
    <div class="travel-recovery-card">
      <div class="travel-recovery-text">Active recovery while traveling: 20-min walk, full-body stretch sequence, or a Travel &mdash; Active Recovery session if you have time.</div>
      <button class="btn-complete" style="margin-top:12px" onclick="renderWorkout(3)">Do Active Recovery Workout</button>
    </div>
  `;
  const card = $('#workout-card');
  if (card) {
    card.style.display = '';
    card.classList.add('workout-travel-mode');
  }
  const actionRow = document.getElementById('workout-action-row');
  if (actionRow) actionRow.innerHTML = '';
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

// ── HISTORY Tab ──
function renderHistoryTab() {
  const filter = LS.get('history_filter') || 'all';
  // sync active state on filter buttons
  document.querySelectorAll('.history-filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === filter);
  });

  const workouts = LS.get('workouts') || {};
  const skipped = LS.get('skipped_days') || {};

  // Build last 60 days
  const rows = [];
  for (let i = 0; i < 60; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    const wo = workouts[key];
    const sk = skipped[key];
    if (!wo && !sk) continue;
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dateLabel = dayName + ', ' + monthNames[d.getMonth()] + ' ' + d.getDate();

    let status = 'partial';
    let statusLabel = 'In Progress';
    if (wo && wo.completed) { status = 'completed'; statusLabel = 'Completed'; }
    else if (sk) { status = 'skipped'; statusLabel = 'Skipped'; }
    else if (wo) {
      const exCount = Object.values(wo.exercises || {}).filter(e => e.done).length;
      statusLabel = exCount + ' exercises done';
    }

    if (filter !== 'all' && filter !== status) continue;

    // Always derive workout name from day-of-week (locked mapping)
    const dowWorkoutId = getWorkoutIdForDate(key);
    const isTravel = (wo && wo.travelMode) || false;
    const woName = dowWorkoutId === null
      ? 'Cycling Day'
      : getWorkoutName(dowWorkoutId, isTravel);

    rows.push({ key, dateLabel, status, statusLabel, woName });
  }

  // Ensure detail view is hidden and list card is visible
  const detailView = document.getElementById('history-detail-view');
  if (detailView) detailView.style.display = 'none';
  const listCard = document.getElementById('history-tab-list');
  if (listCard && listCard.parentElement) listCard.parentElement.style.display = '';

  const list = document.getElementById('history-tab-list');
  if (!list) return;
  if (rows.length === 0) {
    list.innerHTML = '<div class="empty-state">No workouts logged yet.</div>';
    return;
  }
  list.innerHTML = rows.map(r => `
    <div class="history-tab-row" data-key="${r.key}">
      <div class="history-tab-row-left">
        <div class="history-tab-date">${r.dateLabel}</div>
        <div class="history-tab-name">${r.woName}</div>
      </div>
      <div class="history-tab-row-right">
        <span class="badge badge-${r.status}">${r.statusLabel}</span>
        <span class="history-tab-chevron">›</span>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.history-tab-row').forEach(row => {
    row.addEventListener('click', () => {
      openHistoryDetail(row.dataset.key);
    });
  });

  document.querySelectorAll('.history-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      LS.set('history_filter', btn.dataset.filter);
      renderHistoryTab();
    });
  });
}

function openHistoryDetail(key) {
  const workouts = LS.get('workouts') || {};
  const skipped = LS.get('skipped_days') || {};
  const wo = workouts[key];
  const sk = skipped[key];

  // Determine workout strictly from day-of-week (locked mapping)
  const workoutId = getWorkoutIdForDate(key);
  const travelMode = (wo && wo.travelMode) || false;

  if (workoutId === null) {
    // Weekend — cycling/recovery, no detail to show
    document.getElementById('history-detail-content').innerHTML =
      '<div class="history-detail-header"><div class="history-detail-workout">' +
      (sk ? 'Cycling Day (Skipped)' : 'Cycling Day') +
      '</div></div><div class="empty-state">Saturdays and Sundays are cycling/recovery days — no structured workout to log.</div>';
    document.getElementById('history-detail-view').style.display = '';
    const listCard0 = document.getElementById('history-tab-list');
    if (listCard0 && listCard0.parentElement) listCard0.parentElement.style.display = 'none';
    document.getElementById('historyBackBtn').onclick = () => {
      document.getElementById('history-detail-view').style.display = 'none';
      if (listCard0 && listCard0.parentElement) listCard0.parentElement.style.display = '';
      renderHistoryTab();
    };
    return;
  }

  const workoutSet = travelMode ? TRAVEL_WORKOUTS : WORKOUTS;
  const workout = workoutSet[workoutId];
  if (!workout) return;

  // Hide list card, show detail card
  const listCard = document.getElementById('history-tab-list');
  if (listCard && listCard.parentElement) listCard.parentElement.style.display = 'none';

  const detail = document.getElementById('history-detail-view');
  detail.style.display = '';

  const saved = wo || { exercises: {}, completed: false };
  const isSkipped = !!sk;

  const dayName = new Date(key + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const sectionLabels = { warmup: 'Warm-up', main: 'Main Lifts', accessory: 'Accessory Work', finisher: 'Finisher' };
  const wedLabels = { warmup: 'Vagus Nerve Reset', main: 'Core Work', accessory: 'Fascia Release', finisher: 'Cool Down' };
  const isRecovery = workout.name.includes('Recovery') || workout.name.includes('Vagus');
  const labels = isRecovery ? wedLabels : sectionLabels;

  let exHtml = '';
  let lastSection = '';
  workout.exercises.forEach((ex, i) => {
    const exKey = 'ex_' + i;
    const checked = saved.exercises[exKey] && saved.exercises[exKey].done ? 'checked' : '';
    const weight = saved.exercises[exKey] && saved.exercises[exKey].weight ? saved.exercises[exKey].weight : '';
    const section = ex.section || 'main';
    if (section !== lastSection) {
      exHtml += `<div class="exercise-section-label">${labels[section] || section}</div>`;
      lastSection = section;
    }
    const showWeight = (section === 'main' || section === 'accessory' ||
      (section === 'finisher' && finisherUsesWeight(ex.name))) && !isBodyweightExercise(ex.name);
    exHtml += `
      <div class="exercise-item ${section === 'warmup' ? 'exercise-warmup' : ''} ${section === 'finisher' ? 'exercise-finisher' : ''}">
        <input type="checkbox" class="hist-ex-check" data-key="${key}" data-ex="${exKey}" ${checked}>
        <div class="exercise-info">
          <div class="exercise-name">${ex.name}</div>
          <div class="exercise-detail">${ex.sets}</div>
        </div>
        ${showWeight ? `
        <div class="exercise-weight">
          <input type="number" class="hist-weight-input" data-key="${key}" data-ex="${exKey}" value="${weight}" placeholder="lbs" min="0" step="5">
          <span class="weight-unit">lbs</span>
        </div>` : '<div></div>'}
      </div>
    `;
  });

  document.getElementById('history-detail-content').innerHTML = `
    <div class="history-detail-header">
      <div class="history-detail-date">${dayName}</div>
      <div class="history-detail-workout">${workout.name}</div>
      <div class="history-detail-status">
        ${saved.completed ? '<span class="badge badge-completed">Completed</span>' : ''}
        ${isSkipped ? '<span class="badge badge-skipped">Skipped</span>' : ''}
        ${!saved.completed && !isSkipped && Object.keys(saved.exercises||{}).length ? '<span class="badge badge-partial">In Progress</span>' : ''}
      </div>
    </div>
    <div class="history-detail-exercises">${exHtml}</div>
    <div class="workout-action-row">
      <button class="btn-skip ${isSkipped ? 'btn-skip-active' : ''}" id="histSkipBtn">${isSkipped ? '\u2713 Skipped (tap to undo)' : 'Mark as Skipped'}</button>
      <button class="btn-complete ${saved.completed ? 'btn-complete-active' : ''}" id="histCompleteBtn">${saved.completed ? '\u2713 Completed (tap to undo)' : 'Mark Complete'}</button>
    </div>
  `;

  // Wire up exercise check / weight inputs
  document.querySelectorAll('.hist-ex-check').forEach(cb => {
    cb.addEventListener('change', () => saveHistoryWorkoutState(key, workoutId, travelMode));
  });
  document.querySelectorAll('.hist-weight-input').forEach(inp => {
    inp.addEventListener('change', () => saveHistoryWorkoutState(key, workoutId, travelMode));
    inp.addEventListener('blur', () => saveHistoryWorkoutState(key, workoutId, travelMode));
  });

  // Wire skip / complete buttons
  document.getElementById('histSkipBtn').addEventListener('click', () => {
    const sk2 = LS.get('skipped_days') || {};
    const wos2 = LS.get('workouts') || {};
    if (sk2[key]) {
      delete sk2[key];
    } else {
      sk2[key] = { workoutId, workoutName: getWorkoutName(workoutId, travelMode) };
      if (wos2[key]) { wos2[key].completed = false; LS.set('workouts', wos2); }
    }
    LS.set('skipped_days', sk2);
    openHistoryDetail(key);
  });
  document.getElementById('histCompleteBtn').addEventListener('click', () => {
    const wos2 = LS.get('workouts') || {};
    const sk2 = LS.get('skipped_days') || {};
    if (wos2[key] && wos2[key].completed) {
      wos2[key].completed = false;
    } else {
      if (!wos2[key]) wos2[key] = { exercises: {}, completed: false };
      wos2[key].completed = true;
      wos2[key].workoutId = workoutId;
      wos2[key].workoutName = getWorkoutName(workoutId, travelMode);
      wos2[key].travelMode = !!travelMode;
      if (sk2[key]) { delete sk2[key]; LS.set('skipped_days', sk2); }
    }
    LS.set('workouts', wos2);
    openHistoryDetail(key);
  });

  document.getElementById('historyBackBtn').onclick = () => {
    detail.style.display = 'none';
    const listCard2 = document.getElementById('history-tab-list');
    if (listCard2 && listCard2.parentElement) listCard2.parentElement.style.display = '';
    renderHistoryTab();
  };
}

function saveHistoryWorkoutState(key, workoutId, travelMode) {
  const wos = LS.get('workouts') || {};
  const exercises = {};
  document.querySelectorAll(`.hist-ex-check[data-key="${key}"]`).forEach(cb => {
    const exKey = cb.dataset.ex;
    const wInput = document.querySelector(`.hist-weight-input[data-key="${key}"][data-ex="${exKey}"]`);
    exercises[exKey] = {
      done: cb.checked,
      weight: wInput ? parseFloat(wInput.value) || 0 : 0,
    };
  });
  const existing = wos[key] || {};
  wos[key] = {
    ...existing,
    exercises,
    completed: existing.completed || false,
    workoutId,
    workoutName: getWorkoutName(workoutId, travelMode),
    travelMode: !!travelMode,
  };
  LS.set('workouts', wos);
}

// ── Day-of-week workout mapping (locked) ──
// Mon→1, Tue→2, Wed→3, Thu→4, Fri→5, Sat/Sun→null (cycling/recovery)
function getWorkoutIdForDate(dateLike) {
  const d = (dateLike instanceof Date) ? dateLike : new Date(dateLike + 'T12:00:00');
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return null;
  return dow; // Mon=1..Fri=5
}

// ── Workout History (Today tab mini-view) ──
function getWorkoutName(workoutId, travelMode) {
  const ws = travelMode ? TRAVEL_WORKOUTS : WORKOUTS;
  return (ws[workoutId] && ws[workoutId].name) || 'Workout ' + workoutId;
}

function renderWorkoutHistory() {
  const histSection = document.getElementById('workout-history-section');
  if (!histSection) return;

  const workouts = LS.get('workouts') || {};
  const skipped = LS.get('skipped_days') || {};

  // Build last 14 days
  const rows = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    const wo = workouts[key];
    const sk = skipped[key];
    if (!wo && !sk) continue;
    const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
    const dateLabel = dayName + ' ' + (d.getMonth()+1) + '/' + d.getDate();
    rows.push({ key, dateLabel, wo, sk });
  }

  if (rows.length === 0) {
    histSection.innerHTML = '<div class="empty-state" style="font-size:13px;">No workout history yet</div>';
    return;
  }

  let html = '';
  rows.forEach(({ key, dateLabel, wo, sk }) => {
    let statusBadge = '';
    let workoutLabel = '';
    if (sk) {
      statusBadge = '<span class="badge badge-skipped">Skipped</span>';
      workoutLabel = sk.workoutId ? getWorkoutName(sk.workoutId, false) : 'Workout';
    } else if (wo && wo.completed) {
      statusBadge = '<span class="badge badge-done">✓ Done</span>';
      workoutLabel = wo.workoutName || 'Workout';
    } else if (wo) {
      const total = Object.keys(wo.exercises || {}).length;
      const done = Object.values(wo.exercises || {}).filter(e => e.done).length;
      statusBadge = `<span class="badge badge-partial">${done}/${total}</span>`;
      workoutLabel = wo.workoutName || 'Workout';
    }
    html += `
      <div class="history-row" data-key="${key}">
        <span class="history-date">${dateLabel}</span>
        <span class="history-name">${workoutLabel}</span>
        ${statusBadge}
        <button class="history-expand-btn" data-key="${key}">${document.getElementById('hist-detail-' + key) ? '▴ Hide' : '▾ View'}</button>
      </div>
      <div class="history-detail" id="hist-detail-${key}" style="display:none"></div>
    `;
  });
  histSection.innerHTML = html;

  // Attach expand buttons
  histSection.querySelectorAll('.history-expand-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleHistoryDetail(btn.dataset.key, btn));
  });
}

function toggleHistoryDetail(key, btn) {
  const detail = document.getElementById('hist-detail-' + key);
  if (!detail) return;
  const isOpen = detail.style.display !== 'none';
  if (isOpen) {
    detail.style.display = 'none';
    btn.textContent = '▾ View';
    return;
  }
  // Build detail view
  const workouts = LS.get('workouts') || {};
  const skipped = LS.get('skipped_days') || {};
  const wo = workouts[key];
  const sk = skipped[key];
  if (sk) {
    detail.innerHTML = '<div class="history-detail-inner"><em>Day was skipped.</em></div>';
  } else if (wo) {
    // Find the workout exercises — we'll re-render a simplified view
    let inner = '<div class="history-detail-inner">';
    const exEntries = Object.entries(wo.exercises || {});
    if (exEntries.length === 0) {
      inner += '<em>No exercise data saved.</em>';
    } else {
      inner += '<table class="history-ex-table"><thead><tr><th>Exercise</th><th>Weight</th><th>Done</th></tr></thead><tbody>';
      exEntries.forEach(([exKey, ex]) => {
        inner += `<tr>
          <td>${exKey}</td>
          <td>${ex.weight ? ex.weight + ' lbs' : '—'}</td>
          <td>${ex.done ? '✓' : '–'}</td>
        </tr>`;
      });
      inner += '</tbody></table>';
    }
    inner += '</div>';
    detail.innerHTML = inner;
  }
  detail.style.display = '';
  btn.textContent = '▴ Hide';
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
  renderMyFoodsGrid();
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

// ── My Foods (saved custom entries) ──
function getMyFoods() {
  return LS.get('myFoods') || [];
}
function saveMyFoods(foods) {
  LS.set('myFoods', foods);
}
function addToMyFoods(name, protein, calories, carbs, fat) {
  const foods = getMyFoods();
  const existing = foods.find(f => f.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.protein = protein;
    existing.calories = calories;
    existing.carbs = carbs;
    existing.fat = fat;
    existing.uses = (existing.uses || 1) + 1;
  } else {
    foods.push({ name, protein, calories, carbs, fat, uses: 1 });
  }
  saveMyFoods(foods);
}
function removeFromMyFoods(index) {
  const foods = getMyFoods();
  foods.splice(index, 1);
  saveMyFoods(foods);
  renderMyFoodsGrid();
}
function renderMyFoodsGrid() {
  const foods = getMyFoods().sort((a, b) => (b.uses || 1) - (a.uses || 1));
  const grid = $('#myFoodsGrid');
  const empty = $('#myFoodsEmpty');
  if (foods.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  let html = '';
  foods.forEach((food, i) => {
    html += `
      <button class="quick-add-btn my-food-btn" data-food="${food.name}" data-protein="${food.protein}" data-calories="${food.calories}" data-carbs="${food.carbs}" data-fat="${food.fat}" data-idx="${i}">
        ${food.name}
        <span class="quick-add-grams">${food.protein}g protein</span>
        <span class="my-food-remove" data-idx="${i}" aria-label="Remove">&times;</span>
      </button>
    `;
  });
  grid.innerHTML = html;

  $$('.my-food-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (e.target.classList.contains('my-food-remove')) return;
      addNutritionEntry(
        btn.dataset.food,
        parseInt(btn.dataset.protein) || 0,
        parseInt(btn.dataset.calories) || 0,
        parseInt(btn.dataset.carbs) || 0,
        parseInt(btn.dataset.fat) || 0
      );
    });
  });
  $$('.my-food-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromMyFoods(parseInt(btn.dataset.idx));
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
    addToMyFoods(name, protein, calories, carbs, fat);
    renderMyFoodsGrid();
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

// ── Auto-derive all weighted exercises from WORKOUTS ──
function getAllWeightedExercises() {
  const set = new Set();
  Object.values(WORKOUTS).forEach(w => {
    w.exercises.forEach(ex => {
      const show = (ex.section === 'main' || ex.section === 'accessory' ||
        (ex.section === 'finisher' && finisherUsesWeight(ex.name))) && !isBodyweightExercise(ex.name);
      if (show) set.add(ex.name);
    });
  });
  return Array.from(set);
}

// Build per-exercise weight history from saved workouts
function getLiftHistoryAuto() {
  const workouts = LS.get('workouts') || {};
  const history = {}; // { exerciseName: [{date, weight}, ...] }

  // We need to map exKey index -> exercise name per workout id
  // Workout entries don't currently store which workout was rendered,
  // so we cross-reference by matching weights across all WORKOUTS
  const allExByWorkout = {};
  [WORKOUTS, TRAVEL_WORKOUTS].forEach(ws => {
    Object.values(ws).forEach(w => {
      w.exercises.forEach((ex, i) => {
        const show = (ex.section === 'main' || ex.section === 'accessory' ||
          (ex.section === 'finisher' && finisherUsesWeight(ex.name))) && !isBodyweightExercise(ex.name);
        if (!show) return;
        const exKey = 'ex_' + i;
        if (!allExByWorkout[w.name]) allExByWorkout[w.name] = {};
        allExByWorkout[w.name][exKey] = ex.name;
      });
    });
  });

  // For each saved workout day, try to attribute weights to exercise names
  Object.entries(workouts).sort(([a],[b]) => a.localeCompare(b)).forEach(([date, wo]) => {
    if (!wo || !wo.exercises) return;
    // Try each workout definition to find one whose key count matches this saved workout
    const savedKeys = Object.keys(wo.exercises);
    // Match by finding a workout whose total exercise count is >= max index in saved keys
    // Best heuristic: use the workout that has the most matching indices with weight > 0
    let bestWorkoutExMap = null;
    let bestScore = -1;
    Object.values(allExByWorkout).forEach(exMap => {
      const score = savedKeys.filter(k => exMap[k]).length;
      if (score > bestScore) { bestScore = score; bestWorkoutExMap = exMap; }
    });
    if (!bestWorkoutExMap) return;
    savedKeys.forEach(exKey => {
      const ex = wo.exercises[exKey];
      if (!ex || !ex.weight || ex.weight <= 0) return;
      const name = bestWorkoutExMap[exKey];
      if (!name) return;
      if (!history[name]) history[name] = [];
      history[name].push({ date, weight: ex.weight });
    });
  });

  return history;
}

function renderLiftTable() {
  const allExercises = getAllWeightedExercises();
  const history = getLiftHistoryAuto();

  // Also include legacy manually-entered lifts
  const legacyLifts = LS.get('lifts') || {};
  const legacyKeys = Object.keys(legacyLifts).sort();

  // Determine section grouping per exercise
  const sectionMap = {}; // name -> section
  Object.values(WORKOUTS).forEach(w => {
    w.exercises.forEach(ex => {
      if (!sectionMap[ex.name]) sectionMap[ex.name] = ex.section;
    });
  });

  // Group exercises
  const mainExs = allExercises.filter(n => sectionMap[n] === 'main');
  const accessoryExs = allExercises.filter(n => sectionMap[n] === 'accessory');
  const finisherExs = allExercises.filter(n => sectionMap[n] === 'finisher' && finisherUsesWeight(n));

  function buildRows(names) {
    return names.map(name => {
      const hist = history[name] || [];
      const cur = hist.length > 0 ? hist[hist.length - 1].weight : null;
      const prev = hist.length > 1 ? hist[hist.length - 2].weight : null;

      // Also check legacy manual lifts
      const lKey = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z_]/g,'');
      let legacyCur = null, legacyPrev = null;
      if (legacyKeys.length > 0) {
        const ll = legacyLifts[legacyKeys[legacyKeys.length - 1]];
        const lp = legacyKeys.length > 1 ? legacyLifts[legacyKeys[legacyKeys.length - 2]] : {};
        legacyCur = ll && ll[lKey] ? ll[lKey] : null;
        legacyPrev = lp && lp[lKey] ? lp[lKey] : null;
      }
      const finalCur = cur || legacyCur;
      const finalPrev = prev || legacyPrev;

      let trend = '<span class="trend-neutral">—</span>';
      if (finalCur && finalPrev) {
        if (finalCur > finalPrev) trend = '<span class="trend-up">↑</span>';
        else if (finalCur < finalPrev) trend = '<span class="trend-down">↓</span>';
        else trend = '<span class="trend-neutral">—</span>';
      }
      return `<tr>
        <td>${name}</td>
        <td>${finalCur ? finalCur + ' lb' : '—'}</td>
        <td class="text-muted">${finalPrev ? finalPrev + ' lb' : '—'}</td>
        <td>${trend}</td>
      </tr>`;
    }).join('');
  }

  let html = '';
  if (mainExs.length > 0) {
    html += `<tr class="lift-section-header"><td colspan="4">Main Lifts</td></tr>`;
    html += buildRows(mainExs);
  }
  if (accessoryExs.length > 0) {
    html += `<tr class="lift-section-header"><td colspan="4">Accessory Lifts</td></tr>`;
    html += buildRows(accessoryExs);
  }
  if (finisherExs.length > 0) {
    html += `<tr class="lift-section-header"><td colspan="4">Finisher Lifts</td></tr>`;
    html += buildRows(finisherExs);
  }

  if (html === '') {
    html = '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:12px;">Log workouts with weights to see progress here</td></tr>';
  }

  $('#liftTableBody').innerHTML = html;
}

// Keep save button wired for legacy manual entry fallback
const saveLiftsBtnEl = document.getElementById('saveLiftsBtn');
if (saveLiftsBtnEl) saveLiftsBtnEl.addEventListener('click', () => {
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

  ctx.clearRect(0, 0, w, h);

  // Use auto-derived history for main LIFTS
  const autoHistory = getLiftHistoryAuto();
  // Also include legacy manual lifts
  const legacyLifts = LS.get('lifts') || {};

  // Collect data per main lift across dates
  const liftData = {};
  const allDates = new Set();

  LIFTS.forEach(lift => {
    const hist = autoHistory[lift] || [];
    liftData[lift] = {};
    hist.slice(-8).forEach(entry => {
      liftData[lift][entry.date] = entry.weight;
      allDates.add(entry.date);
    });
    // Supplement with legacy data
    const lKey = lift.toLowerCase().replace(/\s+/g, '_');
    Object.entries(legacyLifts).forEach(([date, data]) => {
      if (data[lKey]) {
        liftData[lift][date] = data[lKey];
        allDates.add(date);
      }
    });
  });

  const keys = Array.from(allDates).sort().slice(-8);

  if (keys.length < 1) {
    ctx.fillStyle = textColor;
    ctx.font = '14px Satoshi, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Log workouts with weights to see chart', w/2, h/2);
    return;
  }

  let allVals = [];
  keys.forEach(k => {
    LIFTS.forEach(lift => { if (liftData[lift][k]) allVals.push(liftData[lift][k]); });
  });

  if (allVals.length === 0) {
    ctx.fillStyle = textColor;
    ctx.font = '14px Satoshi, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Log workouts with weights to see chart', w/2, h/2);
    return;
  }

  const minV = Math.min(...allVals) - 10;
  const maxV = Math.max(...allVals) + 10;
  const rangeV = maxV - minV || 1;

  const pad = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

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

  const colors = isDark
    ? ['#4F98A3', '#BB653B', '#6DAA45', '#797876', '#CDCCCA']
    : ['#01696F', '#A84B2F', '#437A22', '#7A7974', '#28251D'];

  LIFTS.forEach((lift, li) => {
    ctx.beginPath();
    ctx.strokeStyle = colors[li];
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    let started = false;
    keys.forEach((k, i) => {
      const val = liftData[lift][k];
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
window.toggleTravelMode = toggleTravelMode;

// ── Init ──
// One-time migration: set correct startDate
(function migrateStartDate() {
  const s = getSettings();
  if (!s.startDateMigratedV3) {
    s.startDate = '2026-03-31';
    s.startDateMigratedV3 = true;
    saveSettings(s);
    // Clear any stale programWeek so it recomputes from startDate
    LS.set('programWeek', null);
  }
})();

// V4 migration: rewrite past workout/skipped records so workoutId + name match day-of-week
(function migrateWorkoutsToDayOfWeek() {
  const s = getSettings();
  if (s.workoutsMigratedV4) return;

  const workouts = LS.get('workouts') || {};
  Object.keys(workouts).forEach(key => {
    const dowId = getWorkoutIdForDate(key);
    if (dowId !== null) {
      const isTravel = !!workouts[key].travelMode;
      workouts[key].workoutId = dowId;
      workouts[key].workoutName = getWorkoutName(dowId, isTravel);
    }
  });
  LS.set('workouts', workouts);

  const skipped = LS.get('skipped_days') || {};
  Object.keys(skipped).forEach(key => {
    const dowId = getWorkoutIdForDate(key);
    if (dowId !== null) {
      skipped[key].workoutId = dowId;
      skipped[key].workoutName = getWorkoutName(dowId, false);
    } else {
      // Weekend day — normalize to Cycling Day
      skipped[key].workoutId = null;
      skipped[key].workoutName = 'Cycling Day';
    }
  });
  LS.set('skipped_days', skipped);

  s.workoutsMigratedV4 = true;
  // Reset workoutPointer — no longer used for routing, but keep clean
  s.workoutPointer = 1;
  saveSettings(s);
})();

renderToday();
renderNutrition();
renderProgress();
