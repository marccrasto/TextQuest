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

let currentStructure = null;

processButton.addEventListener('click', async () => {

  clearStructure();
  setStatus(processStatus, 'Generating...', true);
  toggleButtons(true);
  try {
    const payload = {
      title: titleInput.value.trim(),
      focus: focusInput.value.trim(),
      text: textInput.value.trim(),
    };

    const response = await fetch('/api/process', {
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
  }
  catch (error) {
    structureOutput.classList.remove('empty-state');
    structureOutput.innerHTML = `<div class="card"><h4>Error</h4><p>${error.message}</p></div>`;
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
  if (!currentStructure) return;
  setStatus(narrativeStatus, 'Generating...', true);
  narrativeButton.disabled = true;
  try {
    const payload = {
      structured: currentStructure,
      learningGoal: goalInput.value.trim(),
    };
    const response = await fetch('/api/narrative', {
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
      const friendly = result?.error || 'Failed to generate narrative layer.';
      const code = result?.code;
      const message = code ? `${friendly} (${code})` : friendly;
      throw new Error(message);
    }

    if (Array.isArray(result.warnings) && result.warnings.includes('GROQ_PARSE_ERROR')) {
      showToast('AI response was slightly malformed. Showing best-effort narrative.', 'warning');
    }

    renderNarrative(result);
  } catch (error) {
    narrativeOutput.classList.remove('empty-state');
    narrativeOutput.innerHTML = `<div class="card"><h4>Error</h4><p>${error.message}</p></div>`;

    if (!navigator.onLine) {
      showToast('You appear to be offline. Please check your internet connection.', 'error');
    } else if (error?.message) {
      showToast(error.message, 'error');
    } else {
      showToast('Something went wrong while generating the narrative.', 'error');
    }
  } finally {
    narrativeButton.disabled = false;
    setStatus(narrativeStatus, 'Idle', false);
  }
});

graphButton.addEventListener('click', async () => {
  if (!currentStructure) return;
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
    graphOutput.innerHTML = `<div class="card"><h4>Error</h4><p>${error.message}</p></div>`;
  } finally {
    graphButton.disabled = !currentStructure;
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

  try {
    const extractedText = await extractTextFromFile(file);
    textInput.value = extractedText;
    uploadMessage.textContent = `Loaded ${file.name} (${extractedText.length.toLocaleString()} chars)`;
  } catch (error) {
    uploadMessage.textContent = `Could not read ${file.name}: ${error.message}`;
  } finally {
    uploadMessage.classList.remove('loading');
  }
});

clearInputButton?.addEventListener('click', () => {
  textInput.value = '';
  uploadInput.value = '';
  uploadMessage.textContent = '';
});

if (form) {
  form.addEventListener('change', () => {
    form.dispatchEvent(new Event('submit'));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const fileInput = document.getElementById('uploadFile');
    const file = fileInput.files[0];

    const formData = new FormData();
    formData.append('uploadFile', file);

    try {
      const response = await fetch('/upload?forceOCR=1', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      document.getElementById('message').innerText = data.message;

      if (data.extractedText) {
        textInput.value = data.extractedText
      }

    } catch (error) {
      console.error('Error uploading file:', error);
      document.getElementById('message').innerText = 'Error uploading file.';
    }
  });
}
function renderStructure(result) {
  const { structured, via, title } = result;
  currentStructure = structured;
  narrativeButton.disabled = false;
  graphButton.disabled = false;
  structureOutput.classList.remove('empty-state');
  graphOutput.classList.add('empty-state');
  graphOutput.innerHTML = '<p>Build a concept graph to see dependencies.</p>';
  if (structured) {
    localStorage.setItem('textquest_structure', JSON.stringify(structured));
  }
  let html = '';

  if (structured?.levels?.length) {
    html += `<div class="badge">Source: ${title || 'Untitled'} | ${via}</div>`;
    structured.levels.forEach((level) => {
      html += `
        <article class="card">
          <h4>${level.name}</h4>
          <p>${level.overview || ''}</p>
          ${renderQuests(level.quests)}
        </article>
      `;
    });
  }

  if (structured?.vocabulary?.length) {
    html += `<article class="card"><h4>Vocabulary</h4>${structured.vocabulary
      .map((entry) => `<p><strong>${entry.term}</strong> (${entry.type}) - ${entry.description}</p>`)
      .join('')}</article>`;
  }

  if (structured?.assessments?.length) {
    html += `<article class="card"><h4>Assessments</h4>${structured.assessments
      .map((assessment) => `<p><strong>${assessment.name}</strong> | ${assessment.format} | ${assessment.success_condition}</p>`)
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
          <h4>${quest.title}</h4>
          <p>${quest.description || ''}</p>
          <p><strong>Items:</strong> ${quest.items?.join(', ') || 'None'}</p>
          <p><strong>Abilities:</strong> ${quest.abilities?.join(', ') || 'None'}</p>
          <p><strong>Dependencies:</strong> ${quest.dependencies?.join(', ') || 'None'}</p>
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
  let html = `<div class="badge">Narrative | ${via}</div>`;
  if (narrative?.introduction) {
    html += `<article class="card"><h4>Overview</h4><p>${narrative.introduction}</p></article>`;
  }

  if (narrative?.regions?.length) {
    html += `<article class="card"><h4>Regions & NPCs</h4>${narrative.regions
      .map((region) => `<p><strong>${region.name}</strong> - ${region.npc}: ${region.questHook}</p>`)
      .join('')}</article>`;
  }

  if (narrative?.encounters?.length) {
    html += `<article class="card"><h4>Encounters</h4>${narrative.encounters
      .map((encounter) => `<p><strong>${encounter.name}</strong> - ${encounter.mechanic}. Reward: ${encounter.reward}</p>`)
      .join('')}</article>`;
  }

  if (narrative?.rewards?.length) {
    html += `<article class="card"><h4>Rewards</h4>${narrative.rewards
      .map((reward) => `<p><strong>${reward.name}</strong> - ${reward.benefit}</p>`)
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
    <h4>Overview</h4>
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
  localStorage.removeItem('textquest_structure');
  localStorage.removeItem('textquest_graph');
  narrativeButton.disabled = true;
  graphButton.disabled = true;
  structureOutput.classList.add('empty-state');
  structureOutput.innerHTML = '<p>Crunching blueprint...</p>';
  narrativeOutput.innerHTML = '<p>Narrative results will appear here.</p>';
  narrativeOutput.classList.add('empty-state');
  graphOutput.innerHTML = '<p>Concept graph will appear here.</p>';
  graphOutput.classList.add('empty-state');
}

function toggleButtons(isLoading) {
  processButton.disabled = isLoading;
  narrativeButton.disabled = isLoading || !currentStructure;
  graphButton.disabled = isLoading || !currentStructure;
}

function setStatus(el, text, loading) {
  el.textContent = text;
  el.classList.toggle('loading', loading);
}

async function extractTextFromFile(file) {
  const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    return extractTextFromPdf(file);
  }
  if (typeof file.text === 'function') {
    return file.text();
  }
  throw new Error('Unsupported file type');
}

async function extractTextFromPdf(file) {
  if (!window.pdfjsLib) {
    throw new Error('PDF.js failed to load');
  }

  const workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.js';
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

  const buffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;

  let text = '';
  const maxPages = Math.min(pdf.numPages, 10);

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(' ') + '\n';
    if (text.length > 20000) break;
  }

  return text.trim();
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
