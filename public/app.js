const titleInput = document.getElementById('titleInput');
const focusInput = document.getElementById('focusInput');
const textInput = document.getElementById('textInput');
const goalInput = document.getElementById('goalInput');
const processButton = document.getElementById('processButton');
const narrativeButton = document.getElementById('narrativeButton');
const useSampleButton = document.getElementById('useSample');
const structureOutput = document.getElementById('structureOutput');
const narrativeOutput = document.getElementById('narrativeOutput');
const processStatus = document.getElementById('processStatus');
const narrativeStatus = document.getElementById('narrativeStatus');
const uploadInput = document.getElementById('uploadFile');
const uploadMessage = document.getElementById('uploadMessage');
const clearInputButton = document.getElementById('clearInput');
const graphButton = document.getElementById('graphButton');
const graphStatus = document.getElementById('graphStatus');
const graphOutput = document.getElementById('graphOutput');
const form = document.getElementById('uploadForm');
const toastContainer = document.getElementById('toastContainer');
const demoNotice = document.getElementById('demoNotice');
const uploadRow = document.getElementById('uploadRow');
const graphSection = document.getElementById('graphSection');
const dashboardLink = document.getElementById('dashboardLink');
const rpgsLink = document.getElementById('rpgsLink');
const authStatus = document.getElementById('authStatus');
const authSummary = document.getElementById('authSummary');
const authSummaryText = document.getElementById('authSummaryText');
const authForms = document.getElementById('authForms');
const registerForm = document.getElementById('registerForm');
const loginForm = document.getElementById('loginForm');
const logoutButton = document.getElementById('logoutButton');
const registerDisplayName = document.getElementById('registerDisplayName');
const registerEmail = document.getElementById('registerEmail');
const registerPassword = document.getElementById('registerPassword');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');

let currentStructure = null;
let currentWorldId = null;
let currentUser = null;
let appConfig = {
  mode: 'local',
  isDemo: false,
  features: {
    pdfUpload: true,
    ocr: true,
    largeUploads: true,
    conceptGraph: true,
    deepAnalytics: true,
    maxInputChars: 50000,
  },
};

loadAppConfig();
loadCurrentUser();

processButton.addEventListener('click', async () => {

  clearStructure();
  setStatus(processStatus, 'Generating...', true);
  toggleButtons(true);
  try {
    const text = textInput.value.trim();
    const maxInputChars = appConfig.features.maxInputChars;

    if (text.length > maxInputChars) {
      throw new Error(`Text is too long for ${appConfig.mode} mode. Please keep it under ${maxInputChars.toLocaleString()} characters.`);
    }

    const payload = {
      title: titleInput.value.trim(),
      focus: focusInput.value.trim(),
      text,
    };
    const endpoint = currentUser ? '/api/worlds/generate' : '/api/process';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let result;
    try {
      result = await response.json();
    } catch (parseError) {
      showToast('Received an unexpected response from the server. Please try again.', 'error');
      throw new Error('Unexpected server response');
    }

    if (!response.ok) {
      const friendly = result?.error || 'Failed to generate RPG blueprint.';
      const code = result?.code;
      const message = code ? `${friendly} (${code})` : friendly;

      throw new Error(message);
    }

    if (Array.isArray(result.warnings) && result.warnings.includes('GROQ_PARSE_ERROR')) {
      showToast('AI response was slightly malformed. Showing best-effort result.', 'warning');
    }

    renderStructure(result);

    if (result.saved && result.world && result.character) {
      showToast(`Saved "${result.world.title}". You now play as ${result.character.name}, this world's protagonist.`, 'info');
    } else if (!currentUser) {
      showToast('Sign in to save this RPG world and its character to your library.', 'info');
    }
  }
  catch (error) {
    structureOutput.classList.remove('empty-state');
    structureOutput.innerHTML = `<div class="card"><h4>Error</h4><p>${formatValue(error.message)}</p></div>`;
    if (!navigator.onLine) {
      showToast('You appear to be offline. Please check your internet connection.', 'error');
    } else if (error?.message) {
      showToast(error.message, 'error');
    } else {
      showToast('Something went wrong while generating the RPG blueprint.', 'error');
    }
  } finally {
    toggleButtons(false);
    setStatus(processStatus, 'Idle', false);
  }
});

narrativeButton.addEventListener('click', async () => {
  if (!currentWorldId) return;
  window.location.href = `/world.html?id=${encodeURIComponent(currentWorldId)}#narrative`;
});

graphButton.addEventListener('click', async () => {
  if (!currentStructure) return;
  if (!appConfig.features.conceptGraph) {
    showToast('Concept graphs are available in local mode only.', 'info');
    return;
  }

  setStatus(graphStatus, 'Building...', true);
  graphButton.disabled = true;
  try {
    const payload = {
      structured: currentStructure,
      title: titleInput.value.trim(),
      focus: focusInput.value.trim(),
      savePersistently: true,
    };

    const response = await fetch('/api/graphs/from-structure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error('Failed to generate concept graph.');
    }

    const result = await response.json();
    renderGraph(result);
  } catch (error) {
    graphOutput.classList.remove('empty-state');
    graphOutput.innerHTML = `<div class="card"><h4>Error</h4><p>${formatValue(error.message)}</p></div>`;
  } finally {
    graphButton.disabled = !currentStructure || !appConfig.features.conceptGraph;
    setStatus(graphStatus, 'Idle', false);
  }
});

useSampleButton.addEventListener('click', () => {
  titleInput.value = 'Database Design - Cardinality';
  focusInput.value = 'University Database Course';
  textInput.value = sampleExcerpt;
});

uploadInput?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  uploadMessage.textContent = 'Extracting text...';
  uploadMessage.classList.add('loading');
  document.getElementById('message').innerText = '';

  try {
    const extractedText = await extractTextFromFile(file);
    textInput.value = extractedText;
    uploadMessage.textContent = `Loaded ${file.name} (${extractedText.length.toLocaleString()} chars)`;
    document.getElementById('message').innerText = 'File loaded and parsed successfully';
  } catch (error) {
    uploadMessage.textContent = `Could not read ${file.name}: ${error.message}`;
    document.getElementById('message').innerText = '';
  } finally {
    uploadMessage.classList.remove('loading');
  }
});

registerForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: registerDisplayName.value.trim(),
        email: registerEmail.value.trim(),
        password: registerPassword.value,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || 'Failed to create account.');
    }

    currentUser = result.user;
    syncAuthUI();
    registerForm.reset();
    loginForm?.reset();
    showToast('Account created. You are now signed in.', 'info');
  } catch (error) {
    showToast(error.message || 'Failed to create account.', 'error');
  }
});

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: loginEmail.value.trim(),
        password: loginPassword.value,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || 'Failed to log in.');
    }

    currentUser = result.user;
    syncAuthUI();
    loginForm.reset();
    showToast('Welcome back.', 'info');
  } catch (error) {
    showToast(error.message || 'Failed to log in.', 'error');
  }
});

logoutButton?.addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
    });
  } catch (error) {
    console.warn('Logout request failed', error);
  }

  currentUser = null;
  syncAuthUI();
  showToast('Signed out.', 'info');
});

async function loadAppConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) return;
    appConfig = await response.json();
    applyAppConfig();
  } catch (error) {
    console.warn('Failed to load app config; using local defaults.', error);
  }
}

function applyAppConfig() {
  const { features, isDemo, mode } = appConfig;
  const maxInputChars = features.maxInputChars;

  textInput.maxLength = maxInputChars;

  if (isDemo) {
    demoNotice?.classList.remove('hidden');
    uploadRow?.classList.add('hidden');
    graphSection?.classList.add('hidden');
    uploadMessage.textContent = '';
    document.getElementById('message').innerText = '';
    document.querySelector('label.full-width span').textContent = 'Textbook section';
    textInput.placeholder = `Paste a textbook section for the hosted demo (${maxInputChars.toLocaleString()} characters max)...`;
  } else {
    demoNotice?.classList.add('hidden');
    uploadRow?.classList.toggle('hidden', !features.pdfUpload);
    graphSection?.classList.toggle('hidden', !features.conceptGraph);
    document.querySelector('label.full-width span').textContent = 'Textbook excerpt';
    textInput.placeholder = 'Paste chapter text or upload a snippet...';
  }

  if (!features.conceptGraph) {
    graphButton.disabled = true;
    graphOutput.innerHTML = `<p>Concept graph tools are available in local mode.</p>`;
  }

  console.log(`TextQuest running in ${mode} mode`, features);
}

async function loadCurrentUser() {
  try {
    const response = await fetch('/api/me');
    const result = await response.json();
    currentUser = result?.authenticated ? result.user : null;
  } catch (error) {
    console.warn('Failed to load current user.', error);
    currentUser = null;
  }

  syncAuthUI();
}

function syncAuthUI() {
  if (currentUser) {
    authStatus.textContent = 'Signed In';
    authSummary.classList.remove('hidden');
    authForms.classList.add('hidden');
    authSummaryText.textContent = `${currentUser.displayName || currentUser.email} • ${currentUser.email}`;
    dashboardLink?.classList.remove('hidden');
    rpgsLink?.classList.remove('hidden');
  } else {
    authStatus.textContent = 'Guest';
    authSummary.classList.add('hidden');
    authForms.classList.remove('hidden');
    authSummaryText.textContent = '';
    dashboardLink?.classList.add('hidden');
    rpgsLink?.classList.add('hidden');
  }
}

clearInputButton?.addEventListener('click', () => {
  textInput.value = '';
  uploadInput.value = '';
  uploadMessage.textContent = '';
});

form?.addEventListener('submit', (event) => {
  event.preventDefault();
});

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
    return formatList(value, fallback);
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

function formatList(value, fallback = 'None') {
  if (!Array.isArray(value) || value.length === 0) {
    return fallback;
  }

  const rendered = value
    .map((item) => formatValue(item))
    .filter(Boolean);

  return rendered.length ? rendered.join(', ') : fallback;
}

function formatPair(primary, secondary, separator = ' - ') {
  const first = formatValue(primary);
  const second = formatValue(secondary);

  if (first && second) return `${first}${separator}${second}`;
  return first || second;
}

function renderStructure(result) {
  const { structured, via, title, world, character } = result;
  currentStructure = structured;
  narrativeButton.disabled = false;
  graphButton.disabled = !appConfig.features.conceptGraph;
  structureOutput.classList.remove('empty-state');
  graphOutput.classList.add('empty-state');
  graphOutput.innerHTML = '<p>Build a knowledge map to see concept dependencies and mastery paths.</p>';
  if (structured) {
    localStorage.setItem('textquest_structure', JSON.stringify(structured));
  }
  let html = '';

  if (world && character) {
    currentWorldId = world.id;
    html += `
      <article class="card">
        <h4>Your protagonist is ready</h4>
        <p>You are now playing as <strong>${formatValue(character.name, 'Your character')}</strong> in <strong>${formatValue(world.title, title || 'this RPG world')}</strong>.</p>
        <p><strong>Role:</strong> ${formatValue(character.className, 'Scholar')} | <strong>Mastery track:</strong> this character owns the progress for this world.</p>
        <div class="button-row">
          <a class="secondary-button" href="/world.html?id=${encodeURIComponent(world.id)}">Open world details</a>
        </div>
      </article>
    `;
  } else {
    currentWorldId = null;
  }

  if (structured?.levels?.length) {
    html += `<div class="badge">Source: ${formatValue(title, 'Untitled')} | ${formatValue(via, 'unknown')}</div>`;
    structured.levels.forEach((level) => {
      html += `
        <article class="card">
          <h4>${formatValue(level.name, 'Untitled level')}</h4>
          <p>${formatValue(level.overview)}</p>
          ${renderQuests(level.quests)}
        </article>
      `;
    });
  }

  if (structured?.vocabulary?.length) {
    html += `<article class="card"><h4>Vocabulary</h4>${structured.vocabulary
      .map(
        (entry) =>
          `<p><strong>${formatValue(entry.term, 'Term')}</strong> (${formatValue(entry.type, 'concept')}) - ${formatValue(
            entry.description
          )}</p>`
      )
      .join('')}</article>`;
  }

  if (structured?.assessments?.length) {
    html += `<article class="card"><h4>Assessments</h4>${structured.assessments
      .map(
        (assessment) =>
          `<p><strong>${formatValue(assessment.name, 'Assessment')}</strong> | ${formatValue(
            assessment.format,
            'format TBD'
          )} | ${formatValue(assessment.success_condition, 'success condition TBD')}</p>`
      )
      .join('')}</article>`;
  }

  if (!html) {
    html = `<pre>${JSON.stringify(structured, null, 2)}</pre>`;
  }
  structureOutput.innerHTML = html;
}

function renderQuests(quests = []) {
  if (!quests.length) return '';
  return `
    <div>
      ${quests
      .map(
        (quest) => `
        <div class="card">
          <h4>${formatValue(quest.title, 'Untitled quest')}</h4>
          <p>${formatValue(quest.description)}</p>
          <p><strong>Items:</strong> ${formatList(quest.items)}</p>
          <p><strong>Abilities:</strong> ${formatList(quest.abilities)}</p>
          <p><strong>Dependencies:</strong> ${formatList(quest.dependencies)}</p>
        </div>
      `
      )
      .join('')}
    </div>
  `;
}

function renderNarrative(result) {
  const { narrative, via } = result;
  narrativeOutput.classList.remove('empty-state');
  let html = `<div class="badge">Narrative | ${formatValue(via, 'unknown')}</div>`;
  html += `<article class="card"><h4>Playable Layer</h4><p>This material becomes the scenes, NPCs, and encounter framing your protagonist experiences while learning.</p></article>`;
  if (narrative?.introduction) {
  html += `<article class="card"><h4>Scene Overview</h4><p>${formatValue(narrative.introduction)}</p></article>`;
  }

  if (narrative?.regions?.length) {
    html += `<article class="card"><h4>Regions & NPCs</h4>${narrative.regions
      .map((region) => {
        const npcAndHook = formatPair(region.npc, region.questHook, ': ');
        return `<p><strong>${formatValue(region.name, 'Region')}</strong>${npcAndHook ? ` - ${npcAndHook}` : ''}</p>`;
      })
      .join('')}</article>`;
  }

  if (narrative?.encounters?.length) {
    html += `<article class="card"><h4>Encounters</h4>${narrative.encounters
      .map((encounter) => {
        const mechanic = formatValue(encounter.mechanic);
        const reward = formatValue(encounter.reward);
        return `<p><strong>${formatValue(encounter.name, 'Encounter')}</strong>${mechanic ? ` - ${mechanic}` : ''}${
          reward ? `. Reward: ${reward}` : ''
        }</p>`;
      })
      .join('')}</article>`;
  }

  if (narrative?.rewards?.length) {
    html += `<article class="card"><h4>Rewards</h4>${narrative.rewards
      .map((reward) => `<p><strong>${formatValue(reward.name, 'Reward')}</strong> - ${formatValue(reward.benefit)}</p>`)
      .join('')}</article>`;
  }

  if (!html) {
    html = `<pre>${JSON.stringify(narrative, null, 2)}</pre>`;
  }

  narrativeOutput.innerHTML = html;
}

function renderGraph(result) {
  const { graph, persistence } = result ?? {};
  if (!graph) {
    graphOutput.classList.remove('empty-state');
    graphOutput.innerHTML = `<div class="card"><h4>No graph returned</h4><p>Try building again.</p></div>`;
    return;
  }

  const topics = Object.entries(graph.metadata?.topics || {});
  const nodesPreview = (graph.nodes || []).slice(0, 6);

  graphOutput.classList.remove('empty-state');
  let html = `<div class="badge">Concept graph | ${graph.metadata?.embeddingModel || 'mock'}${persistence?.filename ? ' · saved' : ''
    }</div>`;

  html += `<article class="card">
    <h4>Knowledge Map Overview</h4>
    <p>${graph.metadata?.totalConcepts || 0} concepts · ${graph.metadata?.totalEdges || 0} links</p>
  </article>`;

  if (topics.length) {
    html += `<article class="card"><h4>Topics</h4>${topics
      .map(([topic, data]) => {
        const avg = typeof data.avgDifficulty === 'number' ? data.avgDifficulty.toFixed(1) : 'n/a';
        return `<p><strong>${topic}</strong> · ${data.nodeCount} concepts · avg difficulty ${avg} · types: ${data.types?.join(', ') || 'n/a'
          }</p>`;
      })
      .join('')}</article>`;
  }

  if (nodesPreview.length) {
    html += `<article class="card"><h4>Highlights</h4>${nodesPreview
      .map(
        (node) =>
          `<p><strong>${node.name}</strong> (${node.type}) · ${node.topic || 'Topic'} · difficulty ${node.difficulty}</p>`
      )
      .join('')}</article>`;
  }

  graphOutput.innerHTML = html;
  localStorage.setItem('textquest_graph', JSON.stringify(graph));
}

function clearStructure() {
  currentStructure = null;
  currentWorldId = null;
  localStorage.removeItem('textquest_structure');
  localStorage.removeItem('textquest_graph');
  narrativeButton.disabled = true;
  graphButton.disabled = true;
  structureOutput.classList.add('empty-state');
  structureOutput.innerHTML = '<p>Crunching blueprint...</p>';
  narrativeOutput.innerHTML = '<p>Save a world first, then generate its narrative from the world detail page.</p>';
  narrativeOutput.classList.add('empty-state');
  graphOutput.innerHTML = '<p>Knowledge map will appear here.</p>';
  graphOutput.classList.add('empty-state');
}

function toggleButtons(isLoading) {
  processButton.disabled = isLoading;
  narrativeButton.disabled = isLoading || !currentWorldId;
  graphButton.disabled = isLoading || !currentStructure || !appConfig.features.conceptGraph;
}

function setStatus(el, text, loading) {
  el.textContent = text;
  el.classList.toggle('loading', loading);
}

async function extractTextFromFile(file) {
  const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    return uploadPdfForExtraction(file);
  }
  if (typeof file.text === 'function') {
    return file.text();
  }
  throw new Error('Unsupported file type');
}

async function uploadPdfForExtraction(file) {
  const formData = new FormData();
  formData.append('uploadFile', file);

  const response = await fetch('/upload?forceOCR=1', {
    method: 'POST',
    body: formData,
  });

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error('Unexpected upload response');
  }

  if (!response.ok) {
    throw new Error(data?.message || 'PDF upload failed');
  }

  if (!data?.extractedText) {
    throw new Error('No text was extracted from the PDF');
  }

  return data.extractedText;
}

function showToast(message, type = 'info') {
  if (!toastContainer || !message) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;

  // click to dismiss
  toast.addEventListener('click', () => {
    toast.remove();
  });

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 5000);
}

const sampleExcerpt = `7.4.3: Cardinality
Cardinality is a constraint on a relationship specifying the number of entity instances that a specific
entity may be related to via the relationship. Suppose we have the following rules for departments
and employees:
•A department can have several employees that work in the department
•An em ployee is assigned to work in one department.
From these rules we know the cardinalities for the works in relationship and we express them with
the cardinality symbols 7 and n below.
Employee
n
1
works in
Department
Figure 7.19: One-to-many relationships are most common
The n represents an arbitrary number ofinstances, and the 1 represents at most one instance. For
the above works in relationship we have
a specific employee works in at most only one department, and
a specific departme nt may have many (zero or more) employees who work there.
n, m, N, and M are common symbols used in ER diagrams for representing an arbitrary number of
occurrences; however, any alphabetic character will suffice.
Based on cardinality there are three types of binary relationships: one-to-one, one-to- many, and
many-to-many.
One-to-One
One-to-one relationships have 7 specified for both cardinalities. Suppose we have two entity types
Driver and Vehicle. Assume that we are only concerned with the current driver of a vehicle, and that
we are only concerned with the current vehicle that a driver is operating. Our two rules associate an
instance of one entity type with at most one instance of the other entity type:
•adriver operates at most one vehicle, and
•avehicle is operated by at most one driver.
And so, the relationship is one-to-one.
1
1
Driver
operates
Vehicle
Figure 7.20: One-to-one relationship
7.4.3: Cardinality |159
One-to-Many
One-to-many relationships are the most common ones in database designs. Suppose we have
customer entities and invoice entities and:
•an invoice is for exactly one customer, and
a customer could have any number (zero or more) of invoices at any point in time.
Customer
1
n
Invoice
Figure 7.2t One-to-many relationship
Because one instance of an Invoice can only be associated with a single instance of Customer,
and because one instance of Customer can be associated with any number of Invoice instances
this is a one-to-many relationship:
Many-to-Many
Suppose we are interested in courses and students and the fact that students register for courses
Our two rule statements are:
·any student may enroll in several courses,
·acourse may be taken by several students.
This situation is represented asa many-to-many relationship between Course and Student:
Student
n
enrolls in
m
Course
Figure 7.22: Many-to-many relationship
As will be discussed again later, a many-to-many relationship is implemented in a relational
database in a separate relation. Ina relational database for the above,there would be three relations
one for Student, one for Course, and one for the many-to-many. (Sometimes this 3rd relation is
called an intersection table,a composite table, a bridge table.)
is on
m
Enrollment
m
has
1
1
Student
Course
Figure 7.23: Many-to-many becomes two one-to-many relationships
160|7.4.3: Cardinality
Partly because of the need for a separate structure when the database is implemented, many
modellers will 'resolve'a many-to-many relationship into two one-to-many relationships as they
are modelling. We can restructure the above many-to-many as two one-to-many relationships
where we have 'invented' a new entity type called Enrollment:
Astudent can have many enrollments, and each course may have many enrollments.
An enrollment entity is rel ated to one student entity and to one course entity
7.4.3:Cardinality|161
7.4.4: Recursive Relationships
A relationship is recursive if the same entity type appears more than once. A typical business
example is a rule such as "an employee supervises other employees". The supervises relationship
is recursive; each instance of supervises will specify two employees, one of which is considered a
supervisor and the other the supervised. In the following diagram the relationship symbol joins
to the Employee entity type twice by two separate lines. Note the relationship is one-to-many: an
employee may supervise many employees, and an employee may be supervised by at most one
other employee.
1
Employee
supervises
N
Figure 7.24:Recursive relationship involving Employee twice
With recursive relationships it is appropriate to name the roles each entity type plays. Suppose we
have an instance of the relationship
John supervises Terry
Then with respect to this instance, John is the supervisor employee and Terry is the supervised
employee. We can show these two roles that entity types play in a relationship by placing labels on
the relationship line:
Employee
supervisor
supervises
1
N
supervised
Figure 7.25: Recursive relationship with role names
This one-to-many supervises relationship can be visualized as a hierarchy. In the following we show
five instances of the relationship: John supervises Lee, John supervises Peter, Peter supervises Don
Peter supervises Mary, and John supervises Noel
162|7.4.4: Recursive Relationships
John
Lee
Peter
Noel
Don
Mary
Figure 7.26: The supervising hierarchy
In the above example note the participation constraint at both ends of supervises is optional This
must be the case because some employee will not be supervised, and, for some employees there
are no employees they supervise.
Generally recursive relationships are difficult to master. Some other situations where
recursive relationships can be used:
•A person marries another person
•A person is the parent of a person
•A team plays against another team
•An organizational unit reports to another organizational unit
•A part is composed of other parts.
7.4.4: Recursive Relationships | 163
7.4.5: Identifying Relationships
When entity types were first introduced, we discussed an example where a department offers
courses and that a course must existin the context of a department. In that case the Course enity
type is considered a weak entity type as it is existence-dependent on Department. It is typical
in such situations that the key of the strong entity type is used in the identification scheme for
the weak entity type. For example, courses could be identified as MATH-123 or PHYS-329,or as
Mathematics-123 or Physics-329. In order to convey the composite identification scheme for a weak
entity type we specify the relationship as an identifying relationship which is visualized using a
double-lined diamond symbol:
Additionally, in situations where we have an identifying relationship we usually have
a weak entity type with a partial key
•a weak entity type that must participate in the relationship (total participation) and so the ERD for
our hypothetical educational institution could be:
Neme
chair
conreNa
title
creditHoms
Department
1
offers
n
Course
Figure 7.27:An identifying relationship
Note the keys for the strong entity type appear only at the strong entity type. The identifying
relationship tells one that a department key will be needed to complete the identification of a
course.
164|7.4.5:Identifying Relationships`;
