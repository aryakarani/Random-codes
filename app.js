import {
  hasValidConfig,
  db,
  auth,
  doc,
  serverTimestamp,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  deleteDoc,
  signInAnonymously,
  onAuthStateChanged
} from './firebase.js';

const STORAGE_KEYS = {
  userId: 'compat_user_id',
  sessionId: 'compat_session_id',
  role: 'compat_role',
  draftPrefix: 'compat_draft_'
};

const CATEGORY_KEYS = {
  personality: 'Personality alignment',
  attachment: 'Attachment/Security alignment',
  conflict: 'Conflict & repair style alignment',
  values: 'Values & life priorities alignment',
  boundaries: 'Boundaries & trust alignment'
};

const CATEGORY_WEIGHTS = {
  personality: 1,
  attachment: 1,
  conflict: 1,
  values: 1,
  boundaries: 1
};

const QUESTIONS = [
  { id: 1, category: 'personality', text: 'I like planning routines and following through on commitments consistently.' },
  { id: 2, category: 'personality', text: 'I enjoy trying new experiences and ideas, even when they feel unfamiliar.' },
  { id: 3, category: 'personality', text: 'In daily life, I stay emotionally steady under stress.' },
  { id: 4, category: 'attachment', text: 'When I feel distance in a relationship, I need clear reassurance to feel secure.' },
  { id: 5, category: 'attachment', text: 'I feel comfortable with emotional closeness without feeling trapped.' },
  { id: 6, category: 'attachment', text: 'I can tolerate healthy independence without assuming rejection.' },
  { id: 7, category: 'conflict', text: 'During conflict, I stay engaged instead of shutting down or disappearing.' },
  { id: 8, category: 'conflict', text: 'After disagreements, I try repair (apology, affection, or problem-solving) quickly.' },
  { id: 9, category: 'conflict', text: 'I can discuss difficult topics without insults, threats, or score-keeping.' },
  { id: 10, category: 'values', text: 'I prefer a similar approach to long-term money decisions (saving vs spending).' },
  { id: 11, category: 'values', text: 'Shared life priorities (career, family, lifestyle) matter strongly to me.' },
  { id: 12, category: 'values', text: 'I am willing to actively protect couple time, even when life gets busy.' },
  { id: 13, category: 'boundaries', text: 'I am comfortable with clear boundaries around close friendships with exes.' },
  { id: 14, category: 'boundaries', text: 'I value transparency (not surveillance) about social interactions that could affect trust.' },
  { id: 15, category: 'boundaries', text: 'I feel okay when my partner has close friends of any gender, if boundaries are respected.' }
];

// Nuance questions: moderate differences can still work in some dynamics (e.g., social energy/novelty).
const COMPLEMENTARY_TOLERANCE_IDS = new Set([2, 3, 15]);

const state = {
  userId: getOrCreateUserId(),
  authUid: null,
  sessionId: localStorage.getItem(STORAGE_KEYS.sessionId) || null,
  role: localStorage.getItem(STORAGE_KEYS.role) || null,
  currentQuestionIndex: 0,
  answers: Array(QUESTIONS.length).fill(null),
  sessionData: null,
  unsubscribe: null
};

const ui = {
  message: document.getElementById('globalMessage'),
  screens: {
    landing: document.getElementById('screen-landing'),
    pairing: document.getElementById('screen-pairing'),
    questionnaire: document.getElementById('screen-questionnaire'),
    results: document.getElementById('screen-results')
  },
  inviteIdDisplay: document.getElementById('inviteIdDisplay'),
  copyInviteBtn: document.getElementById('copyInviteBtn'),
  whatsappShareBtn: document.getElementById('whatsappShareBtn'),
  joinInviteInput: document.getElementById('joinInviteInput'),
  joinInviteBtn: document.getElementById('joinInviteBtn'),
  goToPairingBtn: document.getElementById('goToPairingBtn'),
  pairingStatusText: document.getElementById('pairingStatusText'),
  participantAStatus: document.getElementById('participantAStatus'),
  participantBStatus: document.getElementById('participantBStatus'),
  startTestBtn: document.getElementById('startTestBtn'),
  backToLandingBtn: document.getElementById('backToLandingBtn'),
  questionProgressText: document.getElementById('questionProgressText'),
  progressBar: document.getElementById('progressBar'),
  questionCategory: document.getElementById('questionCategory'),
  questionText: document.getElementById('questionText'),
  likertOptions: document.getElementById('likertOptions'),
  prevQuestionBtn: document.getElementById('prevQuestionBtn'),
  nextQuestionBtn: document.getElementById('nextQuestionBtn'),
  overallScore: document.getElementById('overallScore'),
  breakdownGrid: document.getElementById('breakdownGrid'),
  strengthsList: document.getElementById('strengthsList'),
  frictionList: document.getElementById('frictionList'),
  deleteSessionBtn: document.getElementById('deleteSessionBtn'),
  newSessionBtn: document.getElementById('newSessionBtn')
};

init().catch((error) => {
  console.error(error);
  showMessage('Unexpected startup error. Refresh and try again.', 'error');
});

async function init() {
  bindEvents();

  if (!hasValidConfig) {
    ui.inviteIdDisplay.textContent = 'SET FIREBASE';
    disableActionsForConfig();
    showMessage('Add Firebase config in firebase.js to enable pairing and sync.', 'error');
    return;
  }

  const user = await waitForAnonymousAuth();
  state.authUid = user.uid;

  if (state.sessionId) {
    startSessionListener(state.sessionId);
    loadLocalDraft();
  } else {
    await createSessionAsA();
  }
}

function bindEvents() {
  ui.copyInviteBtn.addEventListener('click', copyInviteId);
  ui.joinInviteBtn.addEventListener('click', joinByInviteId);
  ui.goToPairingBtn.addEventListener('click', () => showScreen('pairing'));
  ui.backToLandingBtn.addEventListener('click', () => showScreen('landing'));
  ui.startTestBtn.addEventListener('click', () => showScreen('questionnaire'));
  ui.prevQuestionBtn.addEventListener('click', () => changeQuestion(-1));
  ui.nextQuestionBtn.addEventListener('click', onNextQuestion);
  ui.newSessionBtn.addEventListener('click', resetAndCreateNewSession);
  ui.deleteSessionBtn.addEventListener('click', deleteCurrentSession);
}

function disableActionsForConfig() {
  [ui.copyInviteBtn, ui.joinInviteBtn, ui.goToPairingBtn, ui.startTestBtn].forEach((btn) => {
    btn.disabled = true;
  });
}

async function waitForAnonymousAuth() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Auth timeout')), 10000);

    onAuthStateChanged(auth, async (user) => {
      if (user) {
        clearTimeout(timeout);
        resolve(user);
        return;
      }
      try {
        await signInAnonymously(auth);
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

async function createSessionAsA() {
  let sessionId = generateSessionId();
  let sessionRef = doc(db, 'sessions', sessionId);

  // Retry a few times to avoid very unlikely short-code collisions.
  for (let i = 0; i < 5; i += 1) {
    const existing = await getDoc(sessionRef);
    if (!existing.exists()) break;
    sessionId = generateSessionId();
    sessionRef = doc(db, 'sessions', sessionId);
  }

  await setDoc(sessionRef, {
    createdAt: serverTimestamp(),
    participants: {
      A: { userId: state.userId, authUid: state.authUid, joinedAt: serverTimestamp() },
      B: null
    },
    answers: { A: Array(QUESTIONS.length).fill(null), B: Array(QUESTIONS.length).fill(null) },
    completed: { A: false, B: false },
    computed: null,
    deleted: false
  });

  persistSession(sessionId, 'A');
  startSessionListener(sessionId);
}

function persistSession(sessionId, role) {
  state.sessionId = sessionId;
  state.role = role;
  localStorage.setItem(STORAGE_KEYS.sessionId, sessionId);
  localStorage.setItem(STORAGE_KEYS.role, role);
  ui.inviteIdDisplay.textContent = sessionId;
  updateWhatsappLink();
}

function startSessionListener(sessionId) {
  if (state.unsubscribe) state.unsubscribe();
  const sessionRef = doc(db, 'sessions', sessionId);

  state.unsubscribe = onSnapshot(sessionRef, (snapshot) => {
    if (!snapshot.exists()) {
      showMessage('Session not found or deleted. Please create a new Invite ID.', 'error');
      return;
    }

    state.sessionData = snapshot.data();
    hydrateFromRemoteAnswers();
    refreshPairingUI();

    const bothDone = state.sessionData.completed?.A && state.sessionData.completed?.B;
    if (bothDone) {
      const computed = state.sessionData.computed || computeCompatibility(state.sessionData.answers?.A || [], state.sessionData.answers?.B || []);
      if (!state.sessionData.computed) {
        updateDoc(sessionRef, {
          computed: {
            compatibility: computed.overall,
            breakdown: computed.breakdown,
            timestamp: serverTimestamp()
          }
        });
      }
      renderResults(computed);
      showScreen('results');
    }
  });
}

function refreshPairingUI() {
  const data = state.sessionData;
  if (!data) return;

  const hasA = Boolean(data.participants?.A?.userId);
  const hasB = Boolean(data.participants?.B?.userId);

  ui.participantAStatus.textContent = hasA ? 'Joined' : 'Not joined';
  ui.participantBStatus.textContent = hasB ? 'Joined' : 'Not joined';

  if (hasA && hasB) {
    ui.pairingStatusText.textContent = 'Great — both partners are connected. You can start the test.';
    ui.startTestBtn.disabled = false;
  } else {
    ui.pairingStatusText.textContent = 'Waiting for partner to join this Invite ID...';
    ui.startTestBtn.disabled = true;
  }
}

async function joinByInviteId() {
  const invite = ui.joinInviteInput.value.trim().toUpperCase();
  if (!invite) {
    showMessage('Please enter an Invite ID.', 'error');
    return;
  }

  const sessionRef = doc(db, 'sessions', invite);
  const snap = await getDoc(sessionRef);
  if (!snap.exists()) {
    showMessage('Invite ID not found. Check and try again.', 'error');
    return;
  }

  const data = snap.data();
  if (data.deleted) {
    showMessage('This session was deleted.', 'error');
    return;
  }

  if (data.participants?.B?.userId && data.participants.B.userId !== state.userId && data.participants.B.authUid !== state.authUid) {
    showMessage('Session full. Ask your partner for a new Invite ID.', 'error');
    return;
  }

  let role = 'A';
  if (data.participants?.A?.userId === state.userId || data.participants?.A?.authUid === state.authUid) {
    role = 'A';
  } else if (data.participants?.B?.userId === state.userId || data.participants?.B?.authUid === state.authUid) {
    role = 'B';
  } else if (!data.participants?.B) {
    role = 'B';
    await updateDoc(sessionRef, {
      participants: {
        ...data.participants,
        B: { userId: state.userId, authUid: state.authUid, joinedAt: serverTimestamp() }
      }
    });
  }

  persistSession(invite, role);
  showMessage(`Joined session ${invite}.`, 'info');
  startSessionListener(invite);
  loadLocalDraft();
  showScreen('pairing');
}

function copyInviteId() {
  if (!state.sessionId) return;
  navigator.clipboard.writeText(state.sessionId)
    .then(() => showMessage('Invite ID copied.', 'info'))
    .catch(() => showMessage('Could not copy automatically. Please copy manually.', 'error'));
}

function updateWhatsappLink() {
  const text = encodeURIComponent(`Join my Couple Compatibility Test. Invite ID: ${state.sessionId}`);
  ui.whatsappShareBtn.href = `https://wa.me/?text=${text}`;
}

function showScreen(name) {
  Object.entries(ui.screens).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });

  if (name === 'questionnaire') {
    renderQuestion();
  }
}

function renderQuestion() {
  const q = QUESTIONS[state.currentQuestionIndex];
  ui.questionCategory.textContent = CATEGORY_KEYS[q.category];
  ui.questionText.textContent = q.text;
  ui.questionProgressText.textContent = `Q${state.currentQuestionIndex + 1}/${QUESTIONS.length}`;
  ui.progressBar.style.width = `${((state.currentQuestionIndex + 1) / QUESTIONS.length) * 100}%`;

  ui.likertOptions.innerHTML = '';
  for (let i = 1; i <= 7; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    btn.className = state.answers[state.currentQuestionIndex] === i ? 'selected' : '';
    btn.addEventListener('click', () => {
      state.answers[state.currentQuestionIndex] = i;
      saveDraft();
      debouncedSyncAnswers();
      renderQuestion();
    });
    ui.likertOptions.appendChild(btn);
  }

  ui.prevQuestionBtn.disabled = state.currentQuestionIndex === 0;
  ui.nextQuestionBtn.textContent = state.currentQuestionIndex === QUESTIONS.length - 1 ? 'Finish' : 'Next';
}

function changeQuestion(direction) {
  const next = state.currentQuestionIndex + direction;
  if (next >= 0 && next < QUESTIONS.length) {
    state.currentQuestionIndex = next;
    renderQuestion();
  }
}

async function onNextQuestion() {
  if (state.answers[state.currentQuestionIndex] == null) {
    showMessage('Choose a rating from 1 to 7 before continuing.', 'error');
    return;
  }

  if (state.currentQuestionIndex < QUESTIONS.length - 1) {
    state.currentQuestionIndex += 1;
    renderQuestion();
    return;
  }

  await pushAnswers(true);
  showMessage('You are done. Waiting for your partner to finish...', 'info');
  showScreen('pairing');
}

function loadLocalDraft() {
  if (!state.sessionId || !state.role) return;
  const key = `${STORAGE_KEYS.draftPrefix}${state.sessionId}_${state.role}`;
  const raw = localStorage.getItem(key);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === QUESTIONS.length) {
      state.answers = parsed;
    }
  } catch (_) {
    // Ignore malformed draft
  }
}

function saveDraft() {
  if (!state.sessionId || !state.role) return;
  const key = `${STORAGE_KEYS.draftPrefix}${state.sessionId}_${state.role}`;
  localStorage.setItem(key, JSON.stringify(state.answers));
}

function hydrateFromRemoteAnswers() {
  if (!state.role || !state.sessionData?.answers) return;
  const remoteAnswers = state.sessionData.answers[state.role];
  if (Array.isArray(remoteAnswers) && remoteAnswers.length === QUESTIONS.length) {
    const hasAnyLocal = state.answers.some((a) => a != null);
    if (!hasAnyLocal || state.sessionData.completed?.[state.role]) {
      state.answers = remoteAnswers;
      saveDraft();
    }
  }
}

const debouncedSyncAnswers = debounce(() => pushAnswers(false), 450);

async function pushAnswers(markComplete) {
  if (!state.sessionId || !state.role) return;
  const sessionRef = doc(db, 'sessions', state.sessionId);
  const snapshot = await getDoc(sessionRef);
  if (!snapshot.exists()) return;

  const data = snapshot.data();
  const answers = {
    ...(data.answers || {}),
    [state.role]: state.answers
  };
  const completed = {
    ...(data.completed || {}),
    [state.role]: markComplete ? true : state.answers.every((a) => a != null)
  };

  await updateDoc(sessionRef, { answers, completed });
}

function computeCompatibility(answersA, answersB) {
  const byCategory = {
    personality: [],
    attachment: [],
    conflict: [],
    values: [],
    boundaries: []
  };

  QUESTIONS.forEach((q, idx) => {
    const a = answersA[idx];
    const b = answersB[idx];
    if (a == null || b == null) return;

    const diff = Math.abs(a - b);
    let similarity;

    if (COMPLEMENTARY_TOLERANCE_IDS.has(q.id)) {
      // Mild tolerance band: differences <=2 stay high; beyond that decline faster.
      if (diff <= 2) {
        similarity = 1 - ((diff / 2) * 0.2); // 100, 90, 80 for diff 0,1,2
      } else {
        similarity = Math.max(0, 0.8 - ((diff - 2) / 4) * 0.8);
      }
    } else {
      similarity = 1 - (diff / 6);
    }

    byCategory[q.category].push(similarity * 100);
  });

  const breakdown = {};
  Object.entries(byCategory).forEach(([key, arr]) => {
    breakdown[key] = arr.length ? average(arr) : 0;
  });

  const totalWeight = Object.values(CATEGORY_WEIGHTS).reduce((sum, w) => sum + w, 0);
  const weighted = Object.entries(breakdown).reduce((sum, [key, score]) => {
    return sum + (score * (CATEGORY_WEIGHTS[key] || 1));
  }, 0);

  return {
    overall: Math.round(weighted / totalWeight),
    breakdown: Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, Math.round(v)]))
  };
}

function renderResults(computed) {
  ui.overallScore.textContent = `${computed.compatibility || computed.overall}%`;
  const breakdown = computed.breakdown;

  ui.breakdownGrid.innerHTML = '';
  Object.entries(CATEGORY_KEYS).forEach(([key, label]) => {
    const value = breakdown[key] ?? 0;
    const card = document.createElement('div');
    card.className = 'breakdown-card';
    card.innerHTML = `<h4>${label}</h4><strong>${value}%</strong>`;
    ui.breakdownGrid.appendChild(card);
  });

  const sorted = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  ui.strengthsList.innerHTML = '';
  sorted.slice(0, 2).forEach(([key, val]) => {
    const li = document.createElement('li');
    li.textContent = `${CATEGORY_KEYS[key]} (${val}%)`;
    ui.strengthsList.appendChild(li);
  });

  ui.frictionList.innerHTML = '';
  sorted.slice(-2).forEach(([key, val]) => {
    const li = document.createElement('li');
    li.textContent = `${CATEGORY_KEYS[key]} (${val}%)`;
    ui.frictionList.appendChild(li);
  });
}

async function deleteCurrentSession() {
  if (!state.sessionId) return;
  const confirmed = window.confirm('Delete this session and all stored answers? This cannot be undone.');
  if (!confirmed) return;

  await deleteDoc(doc(db, 'sessions', state.sessionId));
  clearSessionStorage();
  showMessage('Session deleted.', 'info');
  await createSessionAsA();
  showScreen('landing');
}

async function resetAndCreateNewSession() {
  clearSessionStorage();
  state.answers = Array(QUESTIONS.length).fill(null);
  state.currentQuestionIndex = 0;
  if (state.unsubscribe) state.unsubscribe();
  await createSessionAsA();
  showScreen('landing');
}

function clearSessionStorage() {
  if (state.sessionId && state.role) {
    localStorage.removeItem(`${STORAGE_KEYS.draftPrefix}${state.sessionId}_${state.role}`);
  }
  localStorage.removeItem(STORAGE_KEYS.sessionId);
  localStorage.removeItem(STORAGE_KEYS.role);
  state.sessionId = null;
  state.role = null;
}

function showMessage(text, type = 'info') {
  ui.message.classList.remove('hidden', 'info', 'error');
  ui.message.classList.add(type);
  ui.message.textContent = text;
}

function getOrCreateUserId() {
  const existing = localStorage.getItem(STORAGE_KEYS.userId);
  if (existing) return existing;

  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : fallbackUuid();

  localStorage.setItem(STORAGE_KEYS.userId, id);
  return id;
}

function fallbackUuid() {
  return 'u-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
}

function generateSessionId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function average(arr) {
  return arr.reduce((sum, n) => sum + n, 0) / arr.length;
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
