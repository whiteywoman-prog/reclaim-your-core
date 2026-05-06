/* ========================================
   Reclaim Your Core — App Logic
   ======================================== */

// ── Utility ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const _memStore = {};
const _lsOk = (() => { try { const t = '__t'; window['local'+'Storage'].setItem(t, '1'); window['local'+'Storage'].removeItem(t); return true; } catch { return false; } })();
const _ls = _lsOk ? window['local'+'Storage'] : null;

// ── Cloud sync (Supabase) ──
// Strategy: localStorage stays source of truth for UI reads (instant, offline-OK).
// Every LS.set queues a debounced save of the whole blob to Supabase.
// On sign-in, we pull the cloud blob and merge it with local data.
const SUPABASE_URL = 'https://osqmfjpspjcqnpbtsywu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KUGATGbP7oBLa6g3Velf3w_rl2gXWRn';

// All app data lives under these LS keys — we mirror this set to the cloud.
const SYNC_KEYS = [
  'settings', 'programWeek', 'workouts', 'skipped_days',
  'supplements', 'nutrition', 'theme'
];

const CloudSync = {
  session: null,
  status: 'offline', // 'offline' | 'syncing' | 'synced' | 'error'
  saveTimer: null,
  isApplyingRemote: false, // when true, LS.set won't push back to cloud

  async _fetch(path, opts = {}) {
    const headers = Object.assign({
      'apikey': SUPABASE_KEY,
      'Content-Type': 'application/json',
    }, opts.headers || {});
    if (this.session) headers['Authorization'] = 'Bearer ' + this.session.access_token;
    const res = await fetch(SUPABASE_URL + path, Object.assign({}, opts, { headers }));
    return res;
  },

  loadSession() {
    try {
      const raw = _ls ? _ls.getItem('rcyc_session') : null;
      if (raw) {
        const s = JSON.parse(raw);
        // expires_at is a unix epoch in seconds
        if (s.expires_at && s.expires_at * 1000 > Date.now()) {
          this.session = s;
          return true;
        }
      }
    } catch {}
    return false;
  },
  saveSession(s) {
    if (_ls) {
      if (s) _ls.setItem('rcyc_session', JSON.stringify(s));
      else _ls.removeItem('rcyc_session');
    }
    this.session = s;
  },
  isSignedIn() { return !!this.session; },
  email() { return this.session && this.session.user && this.session.user.email; },

  async signUp(email, password) {
    const res = await this._fetch('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.msg || j.error_description || 'Sign-up failed');
    if (j.access_token) this.saveSession(j);
    return j;
  },
  async signIn(email, password) {
    const res = await this._fetch('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.msg || j.error_description || 'Sign-in failed');
    if (j.access_token) this.saveSession(j);
    return j;
  },
  async signOut() {
    try { await this._fetch('/auth/v1/logout', { method: 'POST' }); } catch {}
    this.saveSession(null);
    this.status = 'offline';
  },

  // Pull the cloud blob
  async pull() {
    if (!this.session) return null;
    const res = await this._fetch('/rest/v1/app_data?select=data,updated_at');
    if (!res.ok) throw new Error('Pull failed: ' + res.status);
    const rows = await res.json();
    return rows[0] || null;
  },

  // Push the entire blob (calls the save_app_data RPC)
  async push(blob) {
    if (!this.session) return;
    this.status = 'syncing';
    this._badge();
    const res = await this._fetch('/rest/v1/rpc/save_app_data', {
      method: 'POST',
      body: JSON.stringify({ payload: blob }),
    });
    if (!res.ok) {
      this.status = 'error';
      this._badge();
      throw new Error('Push failed: ' + res.status);
    }
    this.status = 'synced';
    this._badge();
  },

  // Build the current LS blob to upload
  buildLocalBlob() {
    const blob = {};
    SYNC_KEYS.forEach(k => {
      const raw = _ls ? _ls.getItem('rcyc_' + k) : _memStore['rcyc_' + k];
      if (raw != null) {
        try { blob[k] = JSON.parse(raw); } catch { blob[k] = raw; }
      }
    });
    return blob;
  },

  // Apply a cloud blob into LS, merging where it's safe
  applyRemote(remote) {
    if (!remote) return;
    this.isApplyingRemote = true;
    try {
      SYNC_KEYS.forEach(k => {
        if (!(k in remote)) return;
        // For keyed maps (workouts, skipped_days, supplements, nutrition), merge by key
        if (['workouts', 'skipped_days', 'supplements', 'nutrition'].indexOf(k) !== -1) {
          const local = LS.get(k) || {};
          const merged = Object.assign({}, local, remote[k]);
          LS.set(k, merged);
        } else {
          // For singletons (settings, programWeek, theme), prefer cloud
          LS.set(k, remote[k]);
        }
      });
    } finally {
      this.isApplyingRemote = false;
    }
  },

  // Schedule a debounced push (after 1.2s of quiet)
  scheduleSave() {
    if (!this.session || this.isApplyingRemote) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.push(this.buildLocalBlob()).catch(err => {
        console.warn('Cloud sync error:', err.message);
      });
    }, 1200);
  },

  // First-run sync: pull, merge, push back the merged result
  async initialSync() {
    if (!this.session) return;
    try {
      this.status = 'syncing';
      this._badge();
      const cloud = await this.pull();
      if (cloud && cloud.data && Object.keys(cloud.data).length > 0) {
        this.applyRemote(cloud.data);
      }
      // Push the merged result so cloud has everything local had
      await this.push(this.buildLocalBlob());
      this.status = 'synced';
      this._badge();
    } catch (err) {
      console.warn('Initial sync error:', err.message);
      this.status = 'error';
      this._badge();
    }
  },

  _badge() {
    const el = document.getElementById('sync-badge');
    if (!el) return;
    if (!this.session) { el.textContent = ''; el.className = 'sync-badge'; return; }
    const text = { syncing: 'Syncing…', synced: 'Synced', error: 'Sync error', offline: '' }[this.status] || '';
    el.textContent = text;
    el.className = 'sync-badge sync-' + this.status;
  },
};

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
    if (SYNC_KEYS.indexOf(key) !== -1) CloudSync.scheduleSave();
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

// ── Phase / Progression ──
// Source: 12-week periodization in Reclaim Your Core program
// Foundation 1–2: ~75% 1RM, form focus
// Building 3–4: +2–5 lbs main lifts if form solid
// Intensify 5–8: 80–85% 1RM main lifts
// Week 9: Deload (40–50% off)
// Peak 10–12: push to new PRs
function getPhase(week) {
  if (!week) week = getProgramWeek();
  if (week <= 2) {
    return { id: 'foundation', name: 'Foundation', weeks: 'Wk 1–2', mainPct: '~75% 1RM',
      mainBumpLb: 0, accessoryBumpLb: 0, deload: false,
      headline: 'Nail your form. Stay at ~75% 1RM on main lifts.',
      tip: 'Match last week. Form first.' };
  }
  if (week <= 4) {
    return { id: 'building', name: 'Building', weeks: 'Wk 3–4', mainPct: '~78–80% 1RM',
      mainBumpLb: 5, accessoryBumpLb: 2.5, deload: false,
      headline: 'Add 2–5 lbs to main lifts if last week’s form was solid.',
      tip: '+5 lb main, +2.5 lb accessory.' };
  }
  if (week <= 8) {
    return { id: 'intensify', name: 'Build / Intensify', weeks: 'Wk 5–8', mainPct: '80–85% 1RM',
      mainBumpLb: 5, accessoryBumpLb: 2.5, deload: false,
      headline: 'Working at 80–85% 1RM on main lifts. Heaviest stretch.',
      tip: '+5 lb main when all reps clean. Hold accessory or +2.5 lb.' };
  }
  if (week === 9) {
    return { id: 'deload', name: 'Deload', weeks: 'Wk 9', mainPct: '~50% prior load',
      mainBumpLb: 0, accessoryBumpLb: 0, deload: true,
      headline: 'Deload week — cut all weights ~50% to recover before Peak.',
      tip: 'Use ~50% of last working weight on every lift.' };
  }
  return { id: 'peak', name: 'Peak / PR', weeks: 'Wk 10–12', mainPct: '85%+ 1RM',
    mainBumpLb: 5, accessoryBumpLb: 2.5, deload: false,
    headline: 'Push for new PRs. Recover hard between sessions.',
    tip: '+5–10 lb main on a feels-good day. Accessory +2.5 lb.' };
}

// Round to nearest 5 lb (or 2.5 for small accessory bumps)
function roundToPlate(lb, increment) {
  const inc = increment || 5;
  return Math.round(lb / inc) * inc;
}

// Last logged weight for a given exercise name across all saved workouts
function getLastWeightForExercise(exerciseName) {
  const history = getLiftHistoryAuto();
  const arr = history[exerciseName];
  if (!arr || arr.length === 0) return null;
  return { weight: arr[arr.length - 1].weight, date: arr[arr.length - 1].date };
}

// Suggested target weight for an exercise this session, given last log + phase
function getTargetWeight(exerciseName, section) {
  const last = getLastWeightForExercise(exerciseName);
  if (!last) return null; // no history yet — user picks a starting weight
  const phase = getPhase();
  if (phase.deload) {
    return { weight: roundToPlate(last.weight * 0.5, 5), basis: 'deload', last: last.weight };
  }
  const bump = section === 'main' ? phase.mainBumpLb : phase.accessoryBumpLb;
  if (!bump) return { weight: roundToPlate(last.weight, 5), basis: 'hold', last: last.weight };
  return { weight: roundToPlate(last.weight + bump, section === 'main' ? 5 : 2.5), basis: 'bump', last: last.weight };
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

  // Phase guidance card — only on weighted (non-recovery) workouts
  const existingPhase = document.getElementById('phase-guide-card');
  if (existingPhase) existingPhase.remove();
  const isRecoveryDay = workout.name.includes('Recovery') || workout.name.includes('Vagus');
  if (!isRecoveryDay && !settings.travelMode) {
    const wk = getProgramWeek();
    const ph = getPhase(wk);
    const phaseCard = document.createElement('div');
    phaseCard.id = 'phase-guide-card';
    phaseCard.className = 'phase-guide-card phase-' + ph.id;
    phaseCard.innerHTML = `
      <div class="phase-guide-row">
        <span class="phase-guide-name">${ph.name}</span>
        <span class="phase-guide-week">Week ${wk} · ${ph.weeks}</span>
      </div>
      <div class="phase-guide-headline">${ph.headline}</div>
      <div class="phase-guide-tip">Main lifts: ${ph.mainPct} · ${ph.tip}</div>
    `;
    // Insert above the card-header (full-width), not as a sibling of the title (which is in a flex row)
    const workoutCard = document.getElementById('workout-card');
    const cardHeader = workoutCard ? workoutCard.querySelector('.card-header') : null;
    if (workoutCard && cardHeader) {
      workoutCard.insertBefore(phaseCard, cardHeader);
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

    // Phase-aware target weight suggestion (based on last logged weight)
    let targetHtml = '';
    if (showWeight) {
      const t = getTargetWeight(ex.name, section);
      if (t) {
        const basisLabel = t.basis === 'deload' ? 'deload ✓'
          : t.basis === 'bump' ? `+${t.weight - t.last} lb`
          : 'hold';
        targetHtml = `<div class="exercise-target" data-target-for="${exKey}" title="Tap to use">Target: ${t.weight} lb · ${basisLabel}</div>`;
      } else {
        targetHtml = `<div class="exercise-target exercise-target-empty">No history yet — log your starting weight</div>`;
      }
    }

    html += `
      <div class="exercise-item ${section === 'warmup' ? 'exercise-warmup' : ''} ${section === 'finisher' ? 'exercise-finisher' : ''}">
        <input type="checkbox" class="exercise-check" data-ex="${exKey}" ${checked}>
        <div class="exercise-info">
          <div class="exercise-name">${ex.name}</div>
          <div class="exercise-detail">${ex.sets}</div>
          ${targetHtml}
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
  // Tap target chip → prefill the matching input
  $$('.exercise-target[data-target-for]').forEach(chip => {
    chip.addEventListener('click', () => {
      const exKey = chip.getAttribute('data-target-for');
      const inp = $(`.weight-input[data-ex="${exKey}"]`);
      if (!inp) return;
      const m = chip.textContent.match(/Target:\s*(\d+(?:\.\d+)?)/);
      if (m) {
        inp.value = m[1];
        inp.dispatchEvent(new Event('change'));
      }
    });
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

  // Build every day from program start (or 60 days back, whichever is later) up to today
  const settings = getSettings();
  const programStart = new Date((settings.startDate || '2026-03-31') + 'T12:00:00');
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  sixtyDaysAgo.setHours(12, 0, 0, 0);
  const rangeStart = programStart > sixtyDaysAgo ? programStart : sixtyDaysAgo;

  const rows = [];
  const cursor = new Date(today);
  while (cursor >= rangeStart) {
    const key = cursor.getFullYear() + '-' + String(cursor.getMonth()+1).padStart(2,'0') + '-' + String(cursor.getDate()).padStart(2,'0');
    const wo = workouts[key];
    const sk = skipped[key];
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][cursor.getDay()];
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dateLabel = dayName + ', ' + monthNames[cursor.getMonth()] + ' ' + cursor.getDate();

    let status = 'unlogged';
    let statusLabel = 'Not Logged';
    if (wo && wo.completed) { status = 'completed'; statusLabel = 'Completed'; }
    else if (sk) { status = 'skipped'; statusLabel = 'Skipped'; }
    else if (wo) {
      const exCount = Object.values(wo.exercises || {}).filter(e => e.done).length;
      if (exCount > 0) { status = 'partial'; statusLabel = exCount + ' exercises done'; }
    }

    cursor.setDate(cursor.getDate() - 1);

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
    // Weekend — cycling day. Show simple status with skip/complete toggles.
    const dayNameW = new Date(key + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const wasComplete = !!(wo && wo.completed);
    const wasSkipped = !!sk;
    document.getElementById('history-detail-content').innerHTML = `
      <div class="history-detail-header">
        <div class="history-detail-date">${dayNameW}</div>
        <div class="history-detail-workout">Cycling Day</div>
        <div class="history-detail-status">
          ${wasComplete ? '<span class="badge badge-completed">Completed</span>' : ''}
          ${wasSkipped ? '<span class="badge badge-skipped">Skipped</span>' : ''}
        </div>
      </div>
      <div class="empty-state" style="padding:16px 0;">Cycling day — no structured workout. Mark complete if you rode, or skip if you took a rest day.</div>
      <div class="workout-action-row">
        <button class="btn-skip ${wasSkipped ? 'btn-skip-active' : ''}" id="histSkipBtn">${wasSkipped ? '\u2713 Skipped (tap to undo)' : 'Mark as Skipped'}</button>
        <button class="btn-complete ${wasComplete ? 'btn-complete-active' : ''}" id="histCompleteBtn">${wasComplete ? '\u2713 Completed (tap to undo)' : 'Mark Complete'}</button>
      </div>
    `;
    document.getElementById('history-detail-view').style.display = '';
    const listCard0 = document.getElementById('history-tab-list');
    if (listCard0 && listCard0.parentElement) listCard0.parentElement.style.display = 'none';

    document.getElementById('histSkipBtn').addEventListener('click', () => {
      const sk2 = LS.get('skipped_days') || {};
      const wos2 = LS.get('workouts') || {};
      if (sk2[key]) { delete sk2[key]; }
      else {
        sk2[key] = { workoutId: null, workoutName: 'Cycling Day' };
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
        wos2[key].workoutId = null;
        wos2[key].workoutName = 'Cycling Day';
        wos2[key].travelMode = false;
        if (sk2[key]) { delete sk2[key]; LS.set('skipped_days', sk2); }
      }
      LS.set('workouts', wos2);
      openHistoryDetail(key);
    });

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

  // Current phase guidance
  const ph = getPhase(week);
  html += `
    <div class="phase-guide-card phase-${ph.id}" style="margin-top:12px;">
      <div class="phase-guide-row">
        <span class="phase-guide-name">${ph.name}</span>
        <span class="phase-guide-week">Week ${week} · ${ph.weeks}</span>
      </div>
      <div class="phase-guide-headline">${ph.headline}</div>
      <div class="phase-guide-tip">Main lifts: ${ph.mainPct} · ${ph.tip}</div>
    </div>
  `;

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

// Build per-exercise weight history from saved workouts.
// PRECISE matching: each saved record has workoutId/workoutName from v4 onward,
// so we look up the exact workout definition and map ex_0..ex_n -> exercise name.
// Fallback for legacy records (no workoutName): infer workoutId from the date's day-of-week.
function getLiftHistoryAuto() {
  const workouts = LS.get('workouts') || {};
  const history = {}; // { exerciseName: [{date, weight}, ...] }

  // Build name→workoutDef lookup across both regular and travel workout sets
  const nameToWorkout = {};
  [WORKOUTS, TRAVEL_WORKOUTS].forEach(ws => {
    Object.values(ws).forEach(w => { nameToWorkout[w.name] = w; });
  });

  Object.entries(workouts).sort(([a],[b]) => a.localeCompare(b)).forEach(([date, wo]) => {
    if (!wo || !wo.exercises) return;

    // 1) Resolve which workout definition this record came from
    let workoutDef = null;
    if (wo.workoutName && nameToWorkout[wo.workoutName]) {
      workoutDef = nameToWorkout[wo.workoutName];
    } else {
      // Fallback: derive workoutId from the date's day-of-week
      const dowId = getWorkoutIdForDate(date);
      if (dowId !== null && WORKOUTS[dowId]) workoutDef = WORKOUTS[dowId];
    }
    if (!workoutDef) return;

    // 2) For each saved entry, look up the EXACT exercise at that index
    Object.entries(wo.exercises).forEach(([exKey, ex]) => {
      if (!ex || !ex.weight || ex.weight <= 0) return;
      const idx = parseInt(exKey.replace('ex_', ''), 10);
      if (isNaN(idx)) return;
      const exDef = workoutDef.exercises[idx];
      if (!exDef) return;
      // Only track weighted lifts (skip warmups/bodyweight)
      const tracks = (exDef.section === 'main' || exDef.section === 'accessory' ||
        (exDef.section === 'finisher' && finisherUsesWeight(exDef.name))) &&
        !isBodyweightExercise(exDef.name);
      if (!tracks) return;
      const name = exDef.name;
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

// ── Auth UI wiring ──
(function initAuth() {
  const modal = document.getElementById('authModal');
  const sheet = document.getElementById('accountSheet');
  const form = document.getElementById('authForm');
  const email = document.getElementById('authEmail');
  const password = document.getElementById('authPassword');
  const submit = document.getElementById('authSubmit');
  const skip = document.getElementById('authSkip');
  const errEl = document.getElementById('authError');
  let mode = 'signin';

  function setMode(m) {
    mode = m;
    document.querySelectorAll('.auth-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.authMode === m);
    });
    submit.textContent = m === 'signup' ? 'Create account' : 'Sign in';
    password.setAttribute('autocomplete', m === 'signup' ? 'new-password' : 'current-password');
    errEl.hidden = true;
  }
  document.querySelectorAll('.auth-tab').forEach(b => {
    b.addEventListener('click', () => setMode(b.dataset.authMode));
  });

  function showAuthModal() { modal.hidden = false; }
  function hideAuthModal() { modal.hidden = true; }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    submit.disabled = true;
    const oldText = submit.textContent;
    submit.textContent = mode === 'signup' ? 'Creating…' : 'Signing in…';
    try {
      if (mode === 'signup') {
        await CloudSync.signUp(email.value.trim(), password.value);
      } else {
        await CloudSync.signIn(email.value.trim(), password.value);
      }
      hideAuthModal();
      await CloudSync.initialSync();
      // Re-render every tab so freshly-pulled data shows up
      try { renderToday(); } catch {}
      try { renderNutrition(); } catch {}
      try { renderProgress(); } catch {}
      try { renderProgram(); } catch {}
      try { renderSupplements(); } catch {}
      try { renderHistoryTab(); } catch {}
    } catch (err) {
      errEl.textContent = err.message || 'Something went wrong. Try again.';
      errEl.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = oldText;
    }
  });

  skip.addEventListener('click', () => {
    hideAuthModal();
    LS.set('auth_skipped', true);
  });

  // Account sheet (when signed in)
  function showAccountSheet() {
    document.getElementById('accountEmail').textContent = CloudSync.email() || '';
    const statusEl = document.getElementById('accountStatus');
    const map = { syncing: 'Syncing…', synced: 'All changes saved', error: 'Sync error — will retry', offline: 'Offline' };
    statusEl.textContent = map[CloudSync.status] || '';
    sheet.hidden = false;
  }
  function hideAccountSheet() { sheet.hidden = true; }
  document.getElementById('accountClose').addEventListener('click', hideAccountSheet);
  document.getElementById('accountSignOut').addEventListener('click', async () => {
    await CloudSync.signOut();
    hideAccountSheet();
    showAuthModal();
    CloudSync._badge();
  });
  document.getElementById('accountSyncNow').addEventListener('click', async () => {
    try {
      await CloudSync.push(CloudSync.buildLocalBlob());
      const cloud = await CloudSync.pull();
      if (cloud && cloud.data) CloudSync.applyRemote(cloud.data);
      try { renderToday(); } catch {}
      try { renderProgress(); } catch {}
      try { renderHistoryTab(); } catch {}
      showAccountSheet();
    } catch (err) {
      alert('Sync failed: ' + err.message);
    }
  });

  // Account icon: opens sign-in if signed out, account sheet if signed in
  const accountBtn = document.getElementById('accountBtn');
  if (accountBtn) {
    accountBtn.addEventListener('click', () => {
      if (CloudSync.isSignedIn()) showAccountSheet();
      else showAuthModal();
    });
  }

  // Tap outside to dismiss
  modal.addEventListener('click', (e) => { if (e.target === modal) hideAuthModal(); });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) hideAccountSheet(); });

  // Boot: try to restore session, do initial sync, otherwise prompt to sign in
  if (CloudSync.loadSession()) {
    CloudSync._badge();
    CloudSync.initialSync().then(() => {
      try { renderToday(); } catch {}
      try { renderProgress(); } catch {}
      try { renderHistoryTab(); } catch {}
    });
  } else if (!LS.get('auth_skipped')) {
    // First-time visitor: gently surface the sign-in prompt
    setTimeout(showAuthModal, 250);
  }
})();

renderToday();
renderNutrition();
renderProgress();
