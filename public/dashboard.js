const dashboardGate = document.getElementById('dashboardGate');
const dashboardGateTitle = document.getElementById('dashboardGateTitle');
const dashboardGateText = document.getElementById('dashboardGateText');
const dashboardContent = document.getElementById('dashboardContent');

async function loadCurrentUser() {
  try {
    const response = await fetch('/api/me');
    const result = await response.json();
    return result?.authenticated ? result.user : null;
  } catch (error) {
    console.warn('Failed to load current user for dashboard.', error);
    return null;
  }
}

async function loadWorlds() {
  const response = await fetch('/api/worlds');

  if (response.status === 401) {
    return [];
  }

  if (!response.ok) {
    throw new Error('Failed to load saved RPG worlds.');
  }

  const result = await response.json();
  return Array.isArray(result?.worlds) ? result.worlds : [];
}

function showGate(title, text) {
  dashboardGateTitle.textContent = title;
  dashboardGateText.textContent = text;
  dashboardGate.classList.remove('hidden');
  dashboardContent.classList.add('hidden');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPercent(value) {
  return `${Number(value) || 0}%`;
}

function renderWorldCard(world) {
  const character = world.character;
  const currentQuest = world.currentQuest?.title || 'First quest not started yet';
  const focus = world.focus || 'General subject';

  return `
    <article class="card world-card">
      <div class="world-card__header">
        <div>
          <p class="world-card__label">RPG World</p>
          <h3>${escapeHtml(world.title)}</h3>
        </div>
        <span class="status-dot">${escapeHtml(world.status)}</span>
      </div>
      <p class="world-card__focus">${escapeHtml(focus)}</p>
      <div class="world-card__stats">
        <div>
          <span class="world-card__stat-label">Your protagonist</span>
          <strong>${escapeHtml(character?.name || 'Unassigned')}</strong>
          <span>${escapeHtml(character?.className || 'Scholar')}</span>
        </div>
        <div>
          <span class="world-card__stat-label">Learning mastery</span>
          <strong>${world.questProgress.completed} / ${world.questProgress.total} quests</strong>
          <span>Mastery ${formatPercent(world.masteryPercent)}</span>
        </div>
        <div>
          <span class="world-card__stat-label">Current scene</span>
          <strong>${escapeHtml(currentQuest)}</strong>
          <span>Level ${character?.level || 1} · ${character?.xp || 0} XP</span>
        </div>
      </div>
      <div class="button-row">
        <a class="secondary-button" href="/world.html?id=${encodeURIComponent(world.id)}">Open world</a>
      </div>
    </article>
  `;
}

function renderDashboard(user, worlds) {
  const name = user.displayName || user.email || 'Player';
  const averageMastery = worlds.length
    ? Math.round(worlds.reduce((sum, world) => sum + (Number(world.masteryPercent) || 0), 0) / worlds.length)
    : 0;
  const activeWorld = worlds.find((world) => world.currentQuest) || worlds[0] || null;
  const activeQuestTitle = activeWorld?.currentQuest?.title || 'Generate your first RPG world';

  dashboardContent.innerHTML = `
    <div class="dashboard-nav">
      <a href="/" class="back-button">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back to Main Page
      </a>
    </div>

    <header class="dashboard-hero">
      <div class="welcome-section">
        <h1>Welcome back, <span>${escapeHtml(name)}</span></h1>
        <div class="hero-stats">
          <div class="stat-item">
            <span class="stat-label">RPG Worlds</span>
            <span class="stat-value">${worlds.length}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Average Mastery</span>
            <span class="stat-value">${formatPercent(averageMastery)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Active Quest</span>
            <span class="stat-value">${escapeHtml(activeQuestTitle)}</span>
          </div>
        </div>
      </div>
    </header>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Your RPG Library</h3>
          <p>Each textbook section becomes its own RPG world. In every world, you play as that world's protagonist character and build a separate mastery track.</p>
        </div>
      </div>
      ${
        worlds.length
          ? `<div class="world-grid">${worlds.map((world) => renderWorldCard(world)).join('')}</div>`
          : `<div class="empty-state"><p>No saved RPG worlds yet. Generate one from the home page and it will appear here.</p></div>`
      }
    </section>
  `;
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await loadCurrentUser();

  if (!user) {
    showGate(
      'Sign in required',
      'This dashboard shows saved RPG worlds and player progress. Sign in from the home page to use it.'
    );
    return;
  }

  try {
    const worlds = await loadWorlds();
    dashboardGate.classList.add('hidden');
    dashboardContent.classList.remove('hidden');
    renderDashboard(user, worlds);
  } catch (error) {
    showGate('Could not load dashboard', error.message || 'Please try again.');
  }
});
