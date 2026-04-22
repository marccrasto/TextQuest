import mockUser from './mockUserData.js';

// ----------------- Dashboard State -----------------
let currentUser = mockUser;

// ----------------- Main Initialization -----------------
function initializeDashboard() {
    try {
        // Populate hero section
        populateHeroSection();

        // Populate drawer sections
        populateLevelProgress();
        populateVocabularyProgress();
        populateQuestDetails();
        populateAssessmentDetails();
        populateBadges();

        // Set initial drawer states (all open by default, or load from preferences)
        setInitialDrawerStates();

        console.log('Dashboard initialized successfully!');
    } catch (error) {
        console.error('Error initializing dashboard:', error);
    }
}

// ----------------- Hero Section -----------------
function populateHeroSection() {
    document.getElementById('userName').textContent = currentUser.name || 'Player';

    const currentRegion = currentUser.RegionProgress[currentUser.currentRegionIndex];
    document.getElementById('currentRegion').textContent = currentRegion?.name || 'Unknown Region';

    document.getElementById('currentQuest').textContent = currentUser.currentQuest || 'No active quest';
}

// ----------------- Level Progress -----------------
function populateLevelProgress() {
    const container = document.getElementById('levelProgressContent');
    const levels = currentUser.levelProgress;

    if (!levels || levels.length === 0) {
        container.innerHTML = '<p class="no-content">No levels available.</p>';
        return;
    }

    container.innerHTML = levels.map((level, index) => {
        const isCompleted = level.isCompleted;
        const isActive = index === currentUser.currentLevel - 1;
        const isLocked = index > currentUser.currentLevel - 1;

        const icon = isCompleted ? '✔' : isActive ? '▶' : '🔒';
        const statusClass = isCompleted ? 'completed' : isActive ? 'active' : 'locked';
        const statusText = isCompleted ? 'Completed' : isActive ? 'In Progress' : 'Locked';

        const completedQuests = level.quests.filter(q => q.isCompleted).length;
        const totalQuests = level.quests.length;

        return `
            <div class="level-item">
                <div class="level-icon">${icon}</div>
                <div class="level-info">
                    <h4 class="level-name">${level.name}</h4>
                    <p class="level-quests">${completedQuests} / ${totalQuests} Quests Completed</p>
                </div>
                <span class="level-status ${statusClass}">${statusText}</span>
            </div>
        `;
    }).join('');
}

// ----------------- Vocabulary Progress -----------------
function populateVocabularyProgress() {
    const vocab = currentUser.vocabularyProgress;
    const learnedCount = vocab.filter(v => v.isLearned).length;
    const totalCount = vocab.length;

    document.getElementById('vocabCount').textContent = `${learnedCount} / ${totalCount}`;

    const vocabList = document.getElementById('vocabList');
    vocabList.innerHTML = vocab.map(word => `
        <div class="vocab-item ${word.isLearned ? 'learned' : ''}">
            <div class="vocab-term">
                <span>${word.term}</span>
                <span class="vocab-type">${word.type}</span>
            </div>
            <p class="vocab-description">${word.description}</p>
        </div>
    `).join('');
}

// ----------------- Quest Details -----------------
function populateQuestDetails() {
    const container = document.getElementById('questDetailsContent');

    // Find current quest
    let currentQuestObj = null;
    for (const level of currentUser.levelProgress) {
        const quest = level.quests.find(q => q.title === currentUser.currentQuest);
        if (quest) {
            currentQuestObj = quest;
            break;
        }
    }

    if (!currentQuestObj) {
        container.innerHTML = '<p class="no-content">No active quest found.</p>';
        return;
    }

    container.innerHTML = `
        <h4 class="quest-title">${currentQuestObj.title}</h4>
        <p class="quest-description">${currentQuestObj.description}</p>
        
        ${currentQuestObj.items && currentQuestObj.items.length > 0 ? `
        <div class="quest-section">
            <h4>Items to Collect</h4>
            <ul class="quest-list">
                ${currentQuestObj.items.map(item => `<li>${item}</li>`).join('')}
            </ul>
        </div>
        ` : ''}
        
        ${currentQuestObj.abilities && currentQuestObj.abilities.length > 0 ? `
        <div class="quest-section">
            <h4>Abilities to Master</h4>
            <ul class="quest-list">
                ${currentQuestObj.abilities.map(ability => `<li>${ability}</li>`).join('')}
            </ul>
        </div>
        ` : ''}
        
        ${currentQuestObj.dependencies && currentQuestObj.dependencies.length > 0 ? `
        <div class="quest-section">
            <h4>Prerequisites</h4>
            <ul class="quest-list">
                ${currentQuestObj.dependencies.map(dep => `<li>${dep}</li>`).join('')}
            </ul>
        </div>
        ` : ''}
    `;
}

// ----------------- Assessment Details -----------------
function populateAssessmentDetails() {
    const container = document.getElementById('assessmentContent');
    const nextAssessment = currentUser.assessmentProgress[currentUser.currentAssessmentIndex];

    if (!nextAssessment) {
        container.innerHTML = '<p class="no-content">No upcoming assessments.</p>';
        return;
    }

    const completedAssessments = currentUser.assessmentProgress.filter(a => a.isPassed).length;
    const totalAssessments = currentUser.assessmentProgress.length;
    const progressPercent = (completedAssessments / totalAssessments) * 100;

    container.innerHTML = `
        <div class="assessment-info">
            <div class="assessment-field">
                <label>Assessment Name</label>
                <div class="value">${nextAssessment.name}</div>
            </div>
            <div class="assessment-field">
                <label>Format</label>
                <div class="value">${nextAssessment.format}</div>
            </div>
            <div class="assessment-field">
                <label>Success Condition</label>
                <div class="value">${nextAssessment.success_condition}</div>
            </div>
        </div>
        
        <div class="assessment-progress">
            <label>Overall Assessment Progress (${completedAssessments} / ${totalAssessments})</label>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${progressPercent}%"></div>
            </div>
        </div>
    `;
}

// ----------------- Badges -----------------
function populateBadges() {
    const container = document.getElementById('badgesContent');
    const badges = currentUser.rewardGained;

    if (!badges || badges.length === 0) {
        container.innerHTML = '<p class="no-badges">No badges earned yet. Complete quests to earn rewards!</p>';
        return;
    }

    container.innerHTML = badges.map(badge => `
        <div class="badge-item">
            <div class="badge-icon">🏆</div>
            <div class="badge-name">${badge.name}</div>
            <div class="badge-benefit">${badge.benefit}</div>
        </div>
    `).join('');
}

// ----------------- Drawer Toggle Logic -----------------
function setupDrawerToggles() {
    const drawers = document.querySelectorAll('.drawer');

    drawers.forEach(drawer => {
        const header = drawer.querySelector('.drawer-header');
        const toggle = drawer.querySelector('.drawer-toggle');

        const toggleDrawer = (e) => {
            e.stopPropagation();
            drawer.classList.toggle('collapsed');

            // Save state to localStorage
            const drawerId = drawer.getAttribute('data-drawer');
            const isCollapsed = drawer.classList.contains('collapsed');
            localStorage.setItem(`drawer_${drawerId}`, isCollapsed ? 'collapsed' : 'expanded');
        };

        header.addEventListener('click', toggleDrawer);
        toggle.addEventListener('click', toggleDrawer);
    });
}

function setInitialDrawerStates() {
    const drawers = document.querySelectorAll('.drawer');

    drawers.forEach(drawer => {
        const drawerId = drawer.getAttribute('data-drawer');
        const savedState = localStorage.getItem(`drawer_${drawerId}`);

        // Default to expanded if no saved state
        if (savedState === 'collapsed') {
            drawer.classList.add('collapsed');
        }
    });
}

// ----------------- Game Toggle Logic -----------------
function setupGameToggle() {
    const btn = document.getElementById('playGameBtn');
    const container = document.getElementById('gameContainer');
    const frame = document.getElementById('gameFrame');

    if (btn && container && frame) {
        btn.addEventListener('click', () => {
            if (container.style.display === 'none') {
                container.style.display = 'block';
                // Only load the game if it hasn't been loaded yet
                if (!frame.src) {
                    frame.src = '/game.html';
                }
                btn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 0.5rem;">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    Close Game
                `;
                // Scroll to game
                container.scrollIntoView({ behavior: 'smooth' });
            } else {
                container.style.display = 'none';
                btn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 0.5rem;">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                    Play Surfer Mode
                `;
                // Stop the game by clearing src? Or just hide?
                // If we clear src, it resets state. If we hide, it pauses?
                // For performance, maybe better to keep it?
                // But if user wants to restart?
                // Let's keep it.
            }
        });
    }
}

export { initializeDashboard, currentUser };

document.addEventListener('DOMContentLoaded', () => {
    initializeDashboard();
    setupDrawerToggles();
    setupGameToggle();
});