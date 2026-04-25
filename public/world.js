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
    const response = await fetch(`/api/worlds/${encodeURIComponent(currentWorldId)}/narrative`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        learningGoal: worldGoalInput.value.trim(),
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || 'Failed to generate world narrative.');
    }

    renderNarrative(result.narrative, result.via);
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
  worldGate.classList.add('hidden');
  worldContent.classList.remove('hidden');

  const character = world.character;
  const currentQuest = world.currentQuest?.title || 'No active scene yet';

  worldHero.innerHTML = `
    <div class="panel-header">
      <div>
        <h3>${escapeHtml(world.title)}</h3>
        <p>${escapeHtml(world.description || 'A textbook-born RPG world.')}</p>
      </div>
      <span class="status-dot">${escapeHtml(world.status)}</span>
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
        <p>${world.questProgress.completed} / ${world.questProgress.total} quests completed</p>
      </div>
      <div class="card">
        <h4>Current Scene</h4>
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
}

function renderBlueprint(world) {
  const structured = world.structured || {};
  let html = '';

  if (structured?.levels?.length) {
    html += `<div class="badge">Blueprint overview</div>`;
    structured.levels.forEach((level) => {
      html += `
        <article class="card">
          <h4>${escapeHtml(level.name || 'Untitled level')}</h4>
          <p>${escapeHtml(level.overview || '')}</p>
          ${
            Array.isArray(level.quests) && level.quests.length
              ? `<div class="world-mini-list">${level.quests
                .map((quest) => `<p><strong>${escapeHtml(quest.title || 'Quest')}</strong> - ${escapeHtml(quest.description || '')}</p>`)
                .join('')}</div>`
              : ''
          }
        </article>
      `;
    });
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

  if (Array.isArray(narrative?.encounters) && narrative.encounters.length) {
    html += `<article class="card"><h4>Encounter Moments</h4>${narrative.encounters
      .map((encounter) => {
        const mechanic = formatValue(encounter.mechanic);
        const reward = formatValue(encounter.reward);
        return `<p><strong>${formatValue(encounter.name, 'Encounter')}</strong>${mechanic ? ` - ${mechanic}` : ''}${reward ? `. Reward: ${reward}` : ''}</p>`;
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
