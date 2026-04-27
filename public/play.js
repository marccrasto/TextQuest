const toastContainer = document.getElementById('toastContainer');
const playGate = document.getElementById('playGate');
const playGateTitle = document.getElementById('playGateTitle');
const playGateText = document.getElementById('playGateText');
const playContent = document.getElementById('playContent');
const playHero = document.getElementById('playHero');
const sceneVisual = document.getElementById('sceneVisual');
const sceneNarrative = document.getElementById('sceneNarrative');
const sceneMeta = document.getElementById('sceneMeta');
const encounterMeta = document.getElementById('encounterMeta');
const stepTracker = document.getElementById('stepTracker');
const encounterPrompt = document.getElementById('encounterPrompt');
const choiceList = document.getElementById('choiceList');
const encounterFeedback = document.getElementById('encounterFeedback');
const answerForm = document.getElementById('answerForm');
const submitAnswerButton = document.getElementById('submitAnswerButton');
const playStatus = document.getElementById('playStatus');
const playManageLink = document.getElementById('playManageLink');

let currentWorldId = null;
let currentQuestId = '';
let currentPlay = null;
let selectedAnswer = '';

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const worldId = params.get('id');

  if (!worldId) {
    showGate('World not found', 'No RPG world was selected. Open a world from the dashboard first.');
    return;
  }

  currentWorldId = worldId;
  currentQuestId = params.get('questId') || '';
  playManageLink.href = `/world.html?id=${encodeURIComponent(worldId)}`;
  await loadPlay();
});

answerForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentWorldId || !selectedAnswer) {
    showToast('Choose an answer before submitting.', 'warning');
    return;
  }

  setStatus(playStatus, 'Resolving...', true);
  submitAnswerButton.disabled = true;

  try {
    const response = await fetch(`/api/worlds/${encodeURIComponent(currentWorldId)}/play/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questId: currentQuestId,
        answer: selectedAnswer,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || 'Failed to resolve the encounter.');
    }

    currentPlay = result.play;
    currentQuestId = currentPlay?.quest?.id || currentQuestId;
    syncUrl();
    renderPlay(currentPlay, result);
  } catch (error) {
    showToast(error.message || 'Failed to resolve the encounter.', 'error');
  } finally {
    submitAnswerButton.disabled = false;
    setStatus(playStatus, 'Idle', false);
  }
});

async function loadPlay() {
  try {
    const url = new URL(`/api/worlds/${encodeURIComponent(currentWorldId)}/play`, window.location.origin);
    if (currentQuestId) {
      url.searchParams.set('questId', currentQuestId);
    }

    const response = await fetch(url);
    if (response.status === 401) {
      showGate('Sign in required', 'Sign in to continue this RPG world.');
      return;
    }

    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409 && result?.code === 'NARRATIVE_REQUIRED') {
        showGate(
          'Generate narrative first',
          'This world needs a saved narrative before play begins. Open world management and generate the narrative layer first.'
        );
        return;
      }

      throw new Error(result?.error || 'Failed to load the play experience.');
    }

    currentPlay = result.play;
    currentQuestId = currentPlay?.quest?.id || currentQuestId;
    syncUrl();
    renderPlay(currentPlay);
  } catch (error) {
    showGate('Could not load adventure', error.message || 'Please try again.');
  }
}

function renderPlay(play, resolution = null) {
  playGate.classList.add('hidden');
  playContent.classList.remove('hidden');

  const completed = !play.currentStep;
  selectedAnswer = '';

  playHero.innerHTML = `
    <div class="panel-header">
      <div>
        <h3>${escapeHtml(play.world.title)}</h3>
        <p>${escapeHtml(play.scene.locationName)} · ${escapeHtml(play.quest.title)}</p>
      </div>
      <span class="status-dot">${completed ? 'Sequence Cleared' : 'In Scene'}</span>
    </div>
    ${completed ? `
      <div class="button-row">
        <button id="heroReplayQuestButton" class="secondary-button" type="button">Replay this sequence</button>
        ${play.nextQuest ? `<button id="heroNextQuestButton" class="ghost-button" type="button">Go to ${escapeHtml(play.nextQuest.title)}</button>` : ''}
      </div>
    ` : ''}
    <div class="play-hero-grid">
      <div class="card play-profile-card">
        <img class="play-portrait" src="${escapeHtml(play.character.portraitUrl)}" alt="${escapeHtml(play.character.name)} portrait" />
        <div>
          <h4>${escapeHtml(play.character.name)}</h4>
          <p>${escapeHtml(play.character.className || 'Scholar')}</p>
        </div>
      </div>
      <div class="card">
        <h4>Mastery</h4>
        <p><strong>${play.world.masteryPercent}%</strong></p>
        <p>${play.progressSummary.completedQuests} / ${play.progressSummary.totalQuests} sequences cleared</p>
      </div>
      <div class="card">
        <h4>Progress</h4>
        <p><strong>Level ${play.character.level}</strong> · ${play.character.xp} XP</p>
        <p>${play.progressSummary.completedSteps} / ${play.progressSummary.totalSteps} steps in this sequence</p>
      </div>
    </div>
    <div class="play-progress">
      <div class="play-progress__bar">
        <div class="play-progress__fill" style="width: ${Math.round((play.progressSummary.completedSteps / Math.max(1, play.progressSummary.totalSteps)) * 100)}%"></div>
      </div>
      <p>${play.progressSummary.completedSteps} of ${play.progressSummary.totalSteps} steps completed</p>
    </div>
  `;

  const sceneSeed = play.scene.environmentSeed || `${play.world.id}-${play.quest.id}`;
  sceneVisual.style.background = buildEnvironmentBackground(sceneSeed);
  sceneVisual.innerHTML = `
    <div class="play-scene-overlay">
      <img class="play-scene-npc" src="${escapeHtml(play.scene.npcPortraitUrl)}" alt="${escapeHtml(play.scene.npcName)} portrait" />
      <div>
        <p class="world-card__label">${escapeHtml(play.scene.locationName)}</p>
        <h3>${escapeHtml(play.scene.title)}</h3>
        <p><strong>${escapeHtml(play.scene.npcName)}</strong> is waiting for you here.</p>
      </div>
      <img class="play-scene-npc play-scene-npc--player" src="${escapeHtml(play.character.portraitUrl)}" alt="${escapeHtml(play.character.name)} portrait" />
    </div>
  `;

  sceneMeta.textContent = `${play.scene.locationName} · ${play.quest.title}`;
  encounterMeta.textContent = play.finalEncounter.summary;

  document.getElementById('heroReplayQuestButton')?.addEventListener('click', replayCurrentQuest);
  document.getElementById('heroNextQuestButton')?.addEventListener('click', async () => {
    if (!play.nextQuest) return;
    currentQuestId = play.nextQuest.id;
    syncUrl();
    await loadPlay();
  });

  sceneNarrative.innerHTML = `
    <article class="card">
      <h4>Learning Flow</h4>
      <p>Work through the conversation, answer the prompts, and build mastery across the ideas in this world.</p>
    </article>
  `;
  renderDialogue(play.scene.dialogue);
  renderStepTracker(play.steps);

  if (completed) {
    renderCompletionState(play);
  } else {
    renderEncounterStep(play.currentStep, play.finalEncounter.name);
  }

  if (resolution) {
    renderFeedback(resolution, play);
  } else {
    encounterFeedback.classList.add('empty-state');
    encounterFeedback.innerHTML = '<p>Talk through the scene, answer the current step, and the result will appear here.</p>';
  }
}

function renderDialogue(dialogue) {
  const lines = Array.isArray(dialogue) ? dialogue : [];
  const dialogueHtml = lines.map((line) => {
    const isPlayer = line.role === 'player';
    const portrait = isPlayer ? currentPlay.character.portraitUrl : currentPlay.scene.npcPortraitUrl;
    const speaker = formatSpeaker(line.speaker);
    return `
      <article class="card play-dialogue ${isPlayer ? 'play-dialogue--player' : ''}">
        <img class="play-dialogue__portrait" src="${escapeHtml(portrait)}" alt="${escapeHtml(speaker)} portrait" />
        <div>
          <h4>${escapeHtml(speaker)}</h4>
          <p>${escapeHtml(line.text)}</p>
        </div>
      </article>
    `;
  }).join('');

  sceneNarrative.insertAdjacentHTML('beforeend', `
    <article class="card">
      <h4>Conversation</h4>
      <div class="play-dialogue-list">${dialogueHtml}</div>
    </article>
  `);
}

function renderStepTracker(steps) {
  stepTracker.innerHTML = steps.map((step) => `
    <div class="play-step ${step.completed ? 'play-step--complete' : ''} ${step.current ? 'play-step--current' : ''}">
      <span>${escapeHtml(step.label)}</span>
    </div>
  `).join('');
}

function renderEncounterStep(step, finalEncounterName) {
  answerForm.classList.remove('hidden');
  encounterPrompt.innerHTML = `
    <h4>${step.phase === 'final' ? finalEncounterName : 'Practice Prompt'}</h4>
    <p>${escapeHtml(step.prompt)}</p>
  `;

  choiceList.innerHTML = step.choices.map((choice) => `
    <label class="play-choice">
      <input type="radio" name="answerChoice" value="${escapeHtml(choice)}" />
      <span>${escapeHtml(choice)}</span>
    </label>
  `).join('');

  choiceList.querySelectorAll('input[name="answerChoice"]').forEach((input) => {
    input.addEventListener('change', () => {
      selectedAnswer = input.value;
    });
  });

  submitAnswerButton.disabled = false;
  submitAnswerButton.textContent = step.phase === 'final' ? 'Resolve encounter' : 'Answer prompt';
}

function renderCompletionState(play) {
  answerForm.classList.add('hidden');
  const mastered = play.world.masteryPercent >= 100 || play.progressSummary.completedQuests >= play.progressSummary.totalQuests;
  const nextQuestButton = play.nextQuest
    ? `<button class="primary-button" type="button" id="continueQuestButton">Continue to ${escapeHtml(play.nextQuest.title)}</button>`
    : '';
  const replayOptions = buildReplayOptions(play);

  encounterPrompt.innerHTML = `
    <h4>Sequence complete</h4>
    <p>You cleared the final encounter in ${escapeHtml(play.scene.locationName)}.</p>
  `;
    choiceList.innerHTML = `
      <div class="card">
        <h4>What next?</h4>
        <div class="button-row">
          ${mastered ? '' : nextQuestButton}
          ${mastered ? '<a class="primary-button" href="/">Build a new world</a>' : ''}
          <a class="ghost-button" href="/world.html?id=${encodeURIComponent(currentWorldId)}">Return to world</a>
        </div>
        ${mastered ? `
          <div class="output-grid">
            <article class="card">
            <h4>Replay any completed sequence</h4>
            <div class="button-row">${replayOptions}</div>
          </article>
        </div>
      ` : ''}
    </div>
  `;

  document.getElementById('continueQuestButton')?.addEventListener('click', async () => {
    if (!play.nextQuest) return;
    currentQuestId = play.nextQuest.id;
    syncUrl();
    await loadPlay();
  });
  wireReplaySelectors();
}

function renderFeedback(result, play) {
  const tone = result.correct ? 'Success' : 'Not Yet';
  const mastered = play.world.masteryPercent >= 100 || play.progressSummary.completedQuests >= play.progressSummary.totalQuests;
  const replayOptions = buildReplayOptions(play);
  encounterFeedback.classList.remove('empty-state');
  encounterFeedback.innerHTML = `
    <article class="card">
      <h4>${tone}</h4>
      <p>${escapeHtml(result.feedback || '')}</p>
      <p>${escapeHtml(result.explanation || '')}</p>
        <p><strong>XP:</strong> ${result.xpGained} | <strong>Mastery:</strong> +${result.masteryDelta}</p>
        ${result.questCompleted
          ? `<p><strong>Sequence cleared.</strong> ${play.nextQuest ? `The next sequence, ${escapeHtml(play.nextQuest.title)}, is now unlocked.` : 'You have cleared the available learning sequences in this world.'}</p>
             ${mastered ? `
               <div class="button-row">
                 <a class="primary-button" href="/">Build a new world</a>
               </div>
               <article class="card">
                 <h4>Replay any completed sequence</h4>
                 <div class="button-row">${replayOptions}</div>
               </article>
             ` : ''}`
          : ''
        }
      </article>
    `;

  wireReplaySelectors();

  showToast(result.correct ? 'Step cleared.' : 'Not quite. Use the dialogue and explanation to try again.', result.correct ? 'info' : 'warning');
}

async function replayCurrentQuest() {
  if (!currentQuestId) return;

  try {
    const response = await fetch(`/api/worlds/${encodeURIComponent(currentWorldId)}/play/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questId: currentQuestId }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || 'Failed to replay this quest.');
    }

    currentPlay = result.play;
    currentQuestId = result.play?.quest?.id || currentQuestId;
    syncUrl();
    renderPlay(currentPlay);
    showToast('Sequence restarted from the beginning.', 'info');
  } catch (error) {
    showToast(error.message || 'Failed to replay this sequence.', 'error');
  }
}

function buildReplayOptions(play) {
  const options = Array.isArray(play.map) ? play.map.filter((node) => node.accessible) : [];
  return options
    .map((node) => `
      <button class="ghost-button replay-select-button" type="button" data-replay-id="${escapeHtml(node.id)}">
        ${escapeHtml(node.title)}
      </button>
    `)
    .join('');
}

function wireReplaySelectors() {
  document.querySelectorAll('.replay-select-button').forEach((button) => {
    button.addEventListener('click', async () => {
      currentQuestId = button.dataset.replayId;
      await replayCurrentQuest();
    });
  });
}

function buildEnvironmentBackground(seed) {
  const hash = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const hueA = hash % 360;
  const hueB = (hash * 1.7) % 360;
  const hueC = (hash * 2.3) % 360;
  const backdropUrl = `https://picsum.photos/seed/${encodeURIComponent(seed)}/1200/700`;

  return `
    linear-gradient(180deg, rgba(4, 7, 17, 0.18), rgba(4, 7, 17, 0.82)),
    radial-gradient(circle at 20% 20%, hsla(${hueA}, 90%, 65%, 0.42), transparent 32%),
    radial-gradient(circle at 80% 18%, hsla(${hueB}, 85%, 55%, 0.35), transparent 28%),
    linear-gradient(160deg, hsla(${hueC}, 70%, 12%, 1), rgba(5, 9, 18, 0.96) 62%),
    url("${backdropUrl}")
  `;
}

function syncUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('id', currentWorldId);
  if (currentQuestId) {
    url.searchParams.set('questId', currentQuestId);
  } else {
    url.searchParams.delete('questId');
  }
  window.history.replaceState({}, '', url);
}

function showGate(title, text) {
  playGateTitle.textContent = title;
  playGateText.textContent = text;
  playGate.classList.remove('hidden');
  playContent.classList.add('hidden');
}

function setStatus(el, text, loading) {
  el.textContent = text;
  el.classList.toggle('loading', loading);
}

function formatSpeaker(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (value && typeof value === 'object') {
    const keys = ['name', 'title', 'label', 'text', 'value'];
    for (const key of keys) {
      if (typeof value[key] === 'string' && value[key].trim()) {
        return value[key].trim();
      }
    }
  }

  return 'Guide';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message, type = 'info') {
  if (!toastContainer || !message) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  toast.addEventListener('click', () => toast.remove());
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}
