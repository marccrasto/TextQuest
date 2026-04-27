const toastContainer = document.getElementById('toastContainer');
const worldGate = document.getElementById('worldGate');
const worldGateTitle = document.getElementById('worldGateTitle');
const worldGateText = document.getElementById('worldGateText');
const worldContent = document.getElementById('worldContent');
const worldHero = document.getElementById('worldHero');
const worldBlueprint = document.getElementById('worldBlueprint');
const worldNarrativeOutput = document.getElementById('worldNarrativeOutput');
const worldNarrativeButton = document.getElementById('worldNarrativeButton');
const worldNarrativeStatus = document.getElementById('worldNarrativeStatus');
const worldGoalInput = document.getElementById('worldGoalInput');

let currentWorldId = null;
let currentWorld = null;

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const worldId = params.get('id');

  if (!worldId) {
    showGate('World not found', 'No RPG world was selected. Open one from the dashboard.');
    return;
  }

  currentWorldId = worldId;
  await loadWorld(worldId);
});

worldNarrativeButton?.addEventListener('click', async () => {
  if (!currentWorldId) return;

  setStatus(worldNarrativeStatus, 'Generating...', true);
  worldNarrativeButton.disabled = true;

  try {
    const response = await regenerateNarrative(false);

    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409 && result?.code === 'NARRATIVE_LOCKED') {
        const confirmed = window.confirm(
          'This world has already started. Regenerating the narrative will restart this protagonist from the beginning. Continue?'
        );

        if (!confirmed) {
          return;
        }

        const restartedResponse = await regenerateNarrative(true);
        const restartedResult = await restartedResponse.json();

        if (!restartedResponse.ok) {
          throw new Error(restartedResult?.error || 'Failed to regenerate world narrative.');
        }

        renderNarrative(restartedResult.narrative, restartedResult.via);
        showToast('World narrative regenerated. Your protagonist has been reset to the beginning.', 'info');
        await loadWorld(currentWorldId);
        return;
      }

      throw new Error(result?.error || 'Failed to generate world narrative.');
    }

    renderNarrative(result.narrative, result.via);
    if (result.restarted) {
      showToast('World narrative regenerated. Your protagonist has been reset to the beginning.', 'info');
      await loadWorld(currentWorldId);
      return;
    }

    await loadWorld(currentWorldId);
    showToast('World narrative generated and saved to this RPG world.', 'info');
  } catch (error) {
    worldNarrativeOutput.classList.remove('empty-state');
    worldNarrativeOutput.innerHTML = `<div class="card"><h4>Error</h4><p>${escapeHtml(error.message || 'Failed to generate narrative.')}</p></div>`;
    showToast(error.message || 'Failed to generate world narrative.', 'error');
  } finally {
    worldNarrativeButton.disabled = false;
    setStatus(worldNarrativeStatus, 'Idle', false);
  }
});

async function regenerateNarrative(restartFromBeginning = false) {
  const response = await fetch(`/api/worlds/${encodeURIComponent(currentWorldId)}/narrative`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      learningGoal: worldGoalInput.value.trim(),
      restartFromBeginning,
    }),
  });

  return response;
}

async function loadWorld(worldId) {
  try {
    const response = await fetch(`/api/worlds/${encodeURIComponent(worldId)}`);

    if (response.status === 401) {
      showGate('Sign in required', 'Open this world after signing in so we can load your protagonist and saved narrative.');
      return;
    }

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || 'Failed to load world.');
    }

    renderWorld(result.world);
  } catch (error) {
    showGate('Could not load world', error.message || 'Please try again.');
  }
}

function renderWorld(world) {
  currentWorld = world;
  worldGate.classList.add('hidden');
  worldContent.classList.remove('hidden');

  const character = world.character;
  const currentQuest = world.currentQuest?.title || 'No active focus yet';
  const narrativeLocked = Boolean(world.narrativeMeta?.locked && world.hasNarrative);
  const playHref = world.hasNarrative
    ? `/play.html?id=${encodeURIComponent(world.id)}`
    : '#worldNarrativeButton';
  const playLabel = world.hasNarrative
    ? (world.isStarted ? 'Continue adventure' : 'Play world')
    : 'Generate narrative to play';

  worldHero.innerHTML = `
    <div class="panel-header">
      <div>
        <h3>${escapeHtml(world.title)}</h3>
        <p>${escapeHtml(world.description || 'A textbook-born RPG world.')}</p>
      </div>
      <span class="status-dot">${escapeHtml(world.status)}</span>
    </div>
    <div class="button-row">
      <a href="${playHref}" class="secondary-button">${playLabel}</a>
      <button id="deleteWorldButton" class="ghost-button" type="button">Delete world</button>
    </div>
    <div class="world-hero-grid">
      <div class="card">
        <h4>Your Protagonist</h4>
        <p><strong>${escapeHtml(character?.name || 'Unassigned')}</strong></p>
        <p>${escapeHtml(character?.className || 'Scholar')}</p>
      </div>
      <div class="card">
        <h4>Learning Mastery</h4>
        <p><strong>${world.masteryPercent || 0}%</strong></p>
        <p>${world.questProgress.completed} / ${world.questProgress.total} learning paths completed</p>
      </div>
      <div class="card">
        <h4>Current Focus</h4>
        <p><strong>${escapeHtml(currentQuest)}</strong></p>
        <p>Level ${character?.level || 1} · ${character?.xp || 0} XP</p>
      </div>
    </div>
  `;

  renderBlueprint(world);
  renderNarrative(world.narrative, world.narrativeMeta?.via || 'saved');

  if (world.narrativeMeta?.learningGoal) {
    worldGoalInput.value = world.narrativeMeta.learningGoal;
  }

  worldNarrativeButton.textContent = narrativeLocked ? 'Regenerate narrative (restart world)' : 'Generate world narrative';
  const deleteButton = document.getElementById('deleteWorldButton');
  deleteButton?.addEventListener('click', handleDeleteWorld);
}

function renderBlueprint(world) {
  const structured = world.structured || {};
  let html = '';

  if (structured?.levels?.length) {
    html += `<div class="badge">Blueprint overview</div>`;
    const overview = structured.levels
      .map((level) => escapeHtml(level.overview || ''))
      .filter(Boolean)
      .join(' ');
    html += `
      <article class="card">
        <h4>Learning overview</h4>
        <p>${overview || 'This blueprint summarizes the major ideas that shape the world.'}</p>
      </article>
    `;
  }

  if (structured?.vocabulary?.length) {
    html += `<article class="card"><h4>Vocabulary</h4>${structured.vocabulary
      .map((entry) => `<p><strong>${escapeHtml(entry.term || 'Term')}</strong> - ${escapeHtml(entry.description || '')}</p>`)
      .join('')}</article>`;
  }

  if (!html) {
    html = '<p>No blueprint data is available for this world yet.</p>';
  }

  worldBlueprint.classList.remove('empty-state');
  worldBlueprint.innerHTML = html;
}

function renderNarrative(narrative, via = 'unknown') {
  if (!narrative) {
    worldNarrativeOutput.classList.add('empty-state');
    worldNarrativeOutput.innerHTML = '<p>No world narrative yet. Generate one when you are ready to turn this blueprint into scenes and encounters.</p>';
    return;
  }

  let html = `<div class="badge">Narrative | ${escapeHtml(via)}</div>`;

  if (narrative?.introduction) {
    html += `<article class="card"><h4>Scene Overview</h4><p>${formatValue(narrative.introduction)}</p></article>`;
  }

  if (Array.isArray(narrative?.regions) && narrative.regions.length) {
    html += `<article class="card"><h4>Regions & NPCs</h4>${narrative.regions
      .map((region) => {
        const npcAndHook = formatPair(region.npc, region.questHook, ': ');
        return `<p><strong>${formatValue(region.name, 'Region')}</strong>${npcAndHook ? ` - ${npcAndHook}` : ''}</p>`;
      })
      .join('')}</article>`;
  }

  if (Array.isArray(narrative?.rewards) && narrative.rewards.length) {
    html += `<article class="card"><h4>World Rewards</h4>${narrative.rewards
      .map((reward) => `<p><strong>${formatValue(reward.name, 'Reward')}</strong> - ${formatValue(reward.benefit)}</p>`)
      .join('')}</article>`;
  }

  worldNarrativeOutput.classList.remove('empty-state');
  worldNarrativeOutput.innerHTML = html;
}

async function handleDeleteWorld() {
  if (!currentWorldId || !currentWorld) return;

  const confirmed = window.confirm(
    `Delete "${currentWorld.title}"? This removes the world, protagonist, progress, and saved narrative.`
  );

  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch(`/api/worlds/${encodeURIComponent(currentWorldId)}`, {
      method: 'DELETE',
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || 'Failed to delete world.');
    }

    showToast(`Deleted "${result.title}".`, 'info');
    window.location.href = '/dashboard';
  } catch (error) {
    showToast(error.message || 'Failed to delete world.', 'error');
  }
}

function showGate(title, text) {
  worldGateTitle.textContent = title;
  worldGateText.textContent = text;
  worldGate.classList.remove('hidden');
  worldContent.classList.add('hidden');
}

function setStatus(el, text, loading) {
  el.textContent = text;
  el.classList.toggle('loading', loading);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatValue(value, fallback = '') {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => formatValue(entry)).filter(Boolean).join(', ') || fallback;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return escapeHtml(value);
  }

  if (typeof value === 'object') {
    const preferredKeys = [
      'name',
      'title',
      'term',
      'label',
      'description',
      'benefit',
      'mechanic',
      'questHook',
      'text',
      'value',
    ];

    for (const key of preferredKeys) {
      if (value[key]) {
        return formatValue(value[key], fallback);
      }
    }

    const readableValues = Object.values(value)
      .filter((item) => item !== null && item !== undefined && typeof item !== 'object')
      .map((item) => escapeHtml(item));

    return readableValues.length ? readableValues.join(' - ') : escapeHtml(JSON.stringify(value));
  }

  return escapeHtml(value);
}

function formatPair(primary, secondary, separator = ' - ') {
  const first = formatValue(primary);
  const second = formatValue(secondary);

  if (first && second) return `${first}${separator}${second}`;
  return first || second;
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
