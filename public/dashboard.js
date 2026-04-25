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

function showGate(title, text) {
    dashboardGateTitle.textContent = title;
    dashboardGateText.textContent = text;
    dashboardGate.classList.remove('hidden');
    dashboardContent.classList.add('hidden');
}

function renderSignedInPlaceholder(user) {
    const name = user.displayName || user.email || 'Player';

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
                <h1>Welcome back, <span>${name}</span></h1>
                <div class="hero-stats">
                    <div class="stat-item">
                        <span class="stat-label">RPG Worlds</span>
                        <span class="stat-value">Coming next</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Character Progress</span>
                        <span class="stat-value">Coming next</span>
                    </div>
                </div>
            </div>
        </header>

        <section class="panel">
            <div class="panel-header">
                <div>
                    <h3>Your RPG Library</h3>
                    <p>Account sessions are live. Saved worlds, characters, and progress will appear here once Milestone 3 is wired in.</p>
                </div>
            </div>
            <div class="empty-state">
                <p>No saved RPG worlds yet.</p>
            </div>
        </section>
    `;
};

document.addEventListener('DOMContentLoaded', async () => {
    const user = await loadCurrentUser();

    if (!user) {
        showGate(
            'Sign in required',
            'This dashboard shows saved RPG worlds and player progress. Sign in from the home page to use it.'
        );
        return;
    }

    dashboardGate.classList.add('hidden');
    dashboardContent.classList.remove('hidden');
    renderSignedInPlaceholder(user);
});
