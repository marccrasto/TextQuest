const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fs = require('fs');
const pdfParse = require('pdf-parse')
const cors = require('cors');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pdfToImages = require('./pdfToImages');
const prisma = require('./lib/db');
require('dotenv').config();

const fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));
const GraphPersistence = require('./lib/persistence');
const TopicGraphGenerator = require('./lib/graphGenerator');
const EmbeddingsManager = require('./lib/embeddings');

// Configure storage for uploaded files
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Files will be saved in the 'uploads/' directory
  },
  filename: function (req, file, cb) {
    const sanitized = file.originalname.replace(/\s+/g, '_')
    cb(null, `${sanitized}`);
  }
});
const upload = multer({ storage: storage });

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-8b-8192';
const SESSION_COOKIE_NAME = 'textquest_session';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-session-secret';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const APP_MODE = process.env.APP_MODE === 'demo' ? 'demo' : 'local';
const IS_DEMO = APP_MODE === 'demo';
const FEATURE_FLAGS = {
  local: {
    pdfUpload: true,
    ocr: true,
    largeUploads: true,
    conceptGraph: true,
    deepAnalytics: true,
    maxInputChars: 50000,
  },
  demo: {
    pdfUpload: false,
    ocr: false,
    largeUploads: false,
    conceptGraph: false,
    deepAnalytics: false,
    maxInputChars: 12000,
  },
};
const activeFeatures = FEATURE_FLAGS[APP_MODE];
const DATA_DIR = path.join(__dirname, 'data', 'graphs');

const persistence = new GraphPersistence(DATA_DIR);
const embeddingsManager = new EmbeddingsManager({
  apiKey: process.env.OPENAI_API_KEY,
});

const sampleStructure = {
  levels: [
    {
      name: 'Chapter 1 - Cell Biology',
      overview: 'Explore the microscopic city inside every cell.',
      quests: [
        {
          title: 'Understanding Organelles',
          description: 'Meet the mitochondria, ribosomes, and nucleus to learn how they keep the cell alive.',
          items: ['Ribosome', 'Mitochondria'],
          abilities: ['Cell Division Spell'],
          dependencies: [],
        },
      ],
    },
    {
      name: 'Chapter 2 - Energy Flow',
      overview: 'Track how glucose becomes ATP power.',
      quests: [
        {
          title: 'Photosynthesis Primer',
          description: 'Travel to the chloroplast forest to activate the light reactions.',
          items: ['Photon Cape'],
          abilities: ['Chlorophyll Burst'],
          dependencies: ['Understanding Organelles'],
        },
      ],
    },
  ],
  vocabulary: [
    { term: 'Mitochondria', type: 'item', description: 'Power-core that boosts stamina and understanding of ATP.' },
    { term: 'Chlorophyll', type: 'skill', description: 'Lets you sense light puzzles throughout the map.' },
  ],
};

const sampleNarrative = {
  introduction:
    'Welcome to Cytopolis, a living city formed inside a single cell. As the Apprentice Biologist, your job is to stabilize the cell before it divides.',
  regions: [
    {
      name: 'Nucleus Plaza',
      npc: 'Archivist Helix',
      questHook: 'Recover the transcription scrolls to unlock advanced gene abilities.',
    },
    {
      name: 'Mitochondria Forge',
      npc: 'Engineer ATP-42',
      questHook: 'Charge three ATP cores by solving energy puzzles.',
    },
  ],
  encounters: [
    {
      name: 'Misconception Shade',
      mechanic: 'Multiple-choice riddle comparing chloroplasts and mitochondria.',
      reward: 'Blueprint for the Electron Transport skill.',
    },
  ],
  rewards: [
    {
      name: 'Concept Compass',
      benefit: 'Highlights missing quests linked to prerequisite knowledge.',
    },
  ],
};

persistence.initializeDirectory().catch((error) => {
  console.error('Failed to initialize graph data directory', error);
});

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(attachCurrentUser);
app.use(blockLocalOnlyStatic);
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    features: ['process', 'narrative', 'concept-graphs', 'embeddings'],
    embeddingsMode: embeddingsManager.method,
    mode: APP_MODE,
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    mode: APP_MODE,
    isDemo: IS_DEMO,
    features: activeFeatures,
  });
});

app.get('/api/me', (req, res) => {
  if (!req.currentUser) {
    return res.status(401).json({ authenticated: false, user: null });
  }

  return res.json({
    authenticated: true,
    user: sanitizeUser(req.currentUser),
  });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, displayName } = req.body ?? {};
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        displayName: normalizeDisplayName(displayName),
        passwordHash,
      },
    });

    await createSession(res, user.id);

    return res.status(201).json({
      authenticated: true,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('[auth] Failed to register user', error);
    return res.status(500).json({ error: 'Failed to create account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    await createSession(res, user.id);

    return res.json({
      authenticated: true,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('[auth] Failed to log in user', error);
    return res.status(500).json({ error: 'Failed to log in.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME];

  try {
    if (rawToken) {
      await prisma.session.deleteMany({
        where: { tokenHash: hashSessionToken(rawToken) },
      });
    }
  } catch (error) {
    console.error('[auth] Failed to clear session', error);
  }

  clearSessionCookie(res);
  return res.json({ authenticated: false });
});

app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  console.log('Serving index.html from:', indexPath);

  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('index.html not found at: ' + indexPath);
  }
});

// Dashboard route
app.get('/dashboard', (req, res) => {
  const dashboardPath = path.join(__dirname, 'public', 'dashboard.html');
  console.log('Serving dashboard.html from:', dashboardPath);
  console.log('File exists?', fs.existsSync(dashboardPath));

  if (fs.existsSync(dashboardPath)) {
    res.sendFile(dashboardPath);
  } else {
    res.status(404).send(`
      <h1>Dashboard Not Found</h1>
      <p>Looking for: ${dashboardPath}</p>
      <p>Please ensure dashboard.html exists in the public folder.</p>
      <p><a href="/">Return to Main App</a></p>
    `);
  }
});

app.post('/api/worlds/generate', requireAuth, async (req, res) => {
  const input = validateGenerationInput(req.body ?? {});
  if (input.error) {
    return res.status(input.status).json(input.body);
  }

  try {
    const generation = await generateStructurePayload(input.payload);
    const saved = await saveGeneratedWorld({
      userId: req.currentUser.id,
      title: input.payload.title,
      focus: input.payload.focus,
      text: input.payload.text,
      structured: generation.structured,
      via: generation.via,
      usage: generation.usage,
      warnings: generation.warnings,
    });

    return res.status(201).json({
      saved: true,
      title: input.payload.title,
      via: generation.via,
      usage: generation.usage,
      warnings: generation.warnings,
      structured: generation.structured,
      world: formatWorldSummary(saved.world),
      character: saved.character
        ? {
          id: saved.character.id,
          name: saved.character.name,
          className: saved.character.className,
          level: saved.character.level,
          xp: saved.character.xp,
          currentQuestId: saved.character.currentQuestId,
        }
        : null,
    });
  } catch (error) {
    return handleGenerationError(res, 'worlds.generate', error, 'Failed to save RPG world');
  }
});

app.get('/api/worlds', requireAuth, async (req, res) => {
  try {
    const worlds = await prisma.rpgWorld.findMany({
      where: { userId: req.currentUser.id },
      orderBy: { updatedAt: 'desc' },
      include: worldIncludeForUser(req.currentUser.id),
    });

    return res.json({
      worlds: worlds.map((world) => formatWorldSummary(world)),
    });
  } catch (error) {
    console.error('[worlds.list] Failed', error);
    return res.status(500).json({ error: 'Failed to load saved RPG worlds.' });
  }
});

app.get('/api/worlds/:worldId', requireAuth, async (req, res) => {
  try {
    const world = await prisma.rpgWorld.findFirst({
      where: {
        id: req.params.worldId,
        userId: req.currentUser.id,
      },
      include: worldIncludeForUser(req.currentUser.id),
    });

    if (!world) {
      return res.status(404).json({ error: 'RPG world not found.' });
    }

    return res.json({
      world: formatWorldDetail(world),
    });
  } catch (error) {
    console.error('[worlds.detail] Failed', error);
    return res.status(500).json({ error: 'Failed to load RPG world details.' });
  }
});

app.post('/api/worlds/:worldId/narrative', requireAuth, async (req, res) => {
  const learningGoal = normalizeTextField(
    req.body?.learningGoal,
    'Keep the player curious about the topic.'
  );

  try {
    const world = await prisma.rpgWorld.findFirst({
      where: {
        id: req.params.worldId,
        userId: req.currentUser.id,
      },
      include: worldIncludeForUser(req.currentUser.id),
    });

    if (!world) {
      return res.status(404).json({ error: 'RPG world not found.' });
    }

    const structured = world.generatedJson?.structured ?? world.generatedJson;
    if (!structured) {
      return res.status(400).json({ error: 'This RPG world does not have a saved blueprint yet.' });
    }

    const narrativePayload = await generateNarrativePayload({
      structured,
      learningGoal,
    });

    await prisma.rpgWorld.update({
      where: { id: world.id },
      data: {
        narrativeJson: {
          narrative: narrativePayload.narrative,
          via: narrativePayload.via,
          usage: narrativePayload.usage ?? null,
          warnings: narrativePayload.warnings ?? [],
          learningGoal,
        },
      },
    });

    return res.json({
      saved: true,
      learningGoal,
      ...narrativePayload,
    });
  } catch (error) {
    return handleNarrativeError(res, 'worlds.narrative', error);
  }
});

app.post('/api/process', async (req, res) => {
  const input = validateGenerationInput(req.body ?? {});
  if (input.error) {
    return res.status(input.status).json(input.body);
  }

  try {
    const responsePayload = await generateStructurePayload(input.payload);
    return res.json(responsePayload);
  } catch (error) {
    return handleGenerationError(res, 'process', error, 'Failed to build RPG structure');
  }
});

app.post('/api/narrative', async (req, res) => {
  const { structured, learningGoal = 'Keep the player curious about the topic.' } = req.body ?? {};
  if (!structured) {
    return res.status(400).json({ error: 'Structured RPG data is required' });
  }

  try {
    const responsePayload = await generateNarrativePayload({ structured, learningGoal });
    return res.json(responsePayload);
  } catch (error) {
    return handleNarrativeError(res, 'narrative', error);
  }
});


app.use('/api/graphs', requireFeature('conceptGraph'));

app.post('/api/graphs/from-structure', async (req, res) => {
  const { structured, title = 'Untitled Textbook', focus = 'general', savePersistently = false } = req.body ?? {};
  if (!structured) {
    return res.status(400).json({ error: 'Structured RPG data is required' });
  }

  try {
    const generator = new TopicGraphGenerator(structured, embeddingsManager);
    const graph = await generator.generateGraph();

    let persistenceResult = null;
    if (savePersistently) {
      persistenceResult = await persistence.saveGraph(graph, title, { focus, source: 'structured' });
    }

    return res.json({
      success: true,
      graph,
      persistence: persistenceResult,
    });
  } catch (error) {
    console.error('[graphs] Failed to generate graph', error);
    return res.status(500).json({ error: 'Failed to generate graph' });
  }
});

app.get('/api/graphs/list', async (_req, res) => {
  try {
    const graphs = await persistence.listGraphs();
    return res.json({ success: true, count: graphs.length, graphs });
  } catch (error) {
    console.error('[graphs] Failed to list graphs', error);
    return res.status(500).json({ error: 'Failed to list graphs' });
  }
});

app.get('/api/graphs/:filename/export', async (req, res) => {
  try {
    const { filename } = req.params;
    const { format = 'json' } = req.query;
    const exported = await persistence.exportGraph(filename, format);

    if (format === 'gexf') {
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.gexf"`);
    } else if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    } else {
      res.setHeader('Content-Type', 'application/json');
    }

    return res.send(exported);
  } catch (error) {
    console.error('[graphs] Failed to export graph', error);
    return res.status(500).json({ error: 'Failed to export graph' });
  }
});

app.get('/api/graphs/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const graph = await persistence.loadGraph(filename);
    return res.json({ success: true, graph });
  } catch (error) {
    console.error('[graphs] Failed to load graph', error);
    return res.status(404).json({ error: 'Graph not found' });
  }
});

app.delete('/api/graphs/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const result = await persistence.deleteGraph(filename);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('[graphs] Failed to delete graph', error);
    return res.status(500).json({ error: 'Failed to delete graph' });
  }
});

app.use('/api/embeddings', requireFeature('deepAnalytics'));

app.post('/api/embeddings/similarity', async (req, res) => {
  const { texts } = req.body ?? {};
  if (!Array.isArray(texts) || texts.length < 2) {
    return res.status(400).json({ error: 'At least two texts are required' });
  }

  try {
    const { embeddings, matrix } = await embeddingsManager.getSimilarityMatrix(texts);
    return res.json({
      success: true,
      texts,
      similarityMatrix: matrix,
    });
  } catch (error) {
    console.error('[embeddings] Failed to compute similarity', error);
    return res.status(500).json({ error: 'Failed to compute similarity' });
  }
});

async function runOCR(pdfPath) {
  try {
    const images = await pdfToImages(pdfPath);
    let fullText = "";

    const pythonPath = path.join(__dirname, "ocr_env", "Scripts", "python.exe");

    for (const img of images) {
      console.log("Running OCR on:", img);
      const command = `"${pythonPath}" ocr.py "${img}"`;
      const output = execSync(command, { encoding: "utf-8" });
      console.log("OCR raw output:", output);

      const jsonOut = JSON.parse(output);
      fullText += jsonOut.ocr_text + "\n";
    }

    return fullText.trim();
  } catch (err) {
    console.error("OCR failed:", err);
    return "";
  }
}

app.post('/upload', requireFeature('pdfUpload'), upload.single('uploadFile'), async (req, res) => {
  const forceOCR = req.query.forceOCR === "1";

  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  try {
    const dataBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(dataBuffer);

    let extractedText = pdfData.text || "";

    const isWeak = extractedText.trim().length < 50;
    const hasSuspectPages = pdfData.numpages > 0 && extractedText.split("\n").length < 5;

    if (forceOCR || isWeak || hasSuspectPages) {
      console.log("Forcing OCR...");
      const ocrText = await runOCR(req.file.path);
      extractedText = ocrText || extractedText;
    }

    res.status(200).json({
      message: "File Uploaded and Parsed Successfully",
      extractedText
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to extract PDF content.' });
  }
});

app.use((req, res) => {
  res.status(404).send(`
    <h1>404 - Page Not Found</h1>
    <p>Path: ${req.path}</p>
    <p><a href="/">Go to Main App</a></p>
    <p><a href="/dashboard">Go to Dashboard</a></p>
  `);
});

app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(`✓ TextQuest MVP server running on port ${PORT}`);
  console.log('='.repeat(60));
  console.log(`Main app:  http://localhost:${PORT}/`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`Health:    http://localhost:${PORT}/api/health`);
  console.log('='.repeat(60));

  // Check if required files exist
  const publicDir = path.join(__dirname, 'public');
  const requiredFiles = ['index.html', 'dashboard.html', 'dashboard.js', 'dashboard.css', 'data_class.js', 'mockUserData.js'];

  console.log('\nChecking required files:');
  requiredFiles.forEach(file => {
    const filePath = path.join(publicDir, file);
    const exists = fs.existsSync(filePath);
    console.log(`  ${exists ? '✓' : '✗'} ${file}`);
  });
  console.log('='.repeat(60));
});

class GroqError extends Error {
  constructor(message, { status, body, type } = {}) {
    super(message);
    this.name = 'GroqError';
    this.status = status ?? null;
    this.body = body ?? null;
    this.type = type ?? 'UNKNOWN';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffDelayMs(attemptIndex, baseMs = 500, factor = 2, jitterMs = 250) {
  const exp = baseMs * Math.pow(factor, attemptIndex);
  const jitter = Math.random() * jitterMs;
  return Math.round(exp + jitter);
}

async function callGroq(messages, { responseFormat, retry = {} } = {}) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY missing');
  }

  const body = {
    model: GROQ_MODEL,
    messages,
    temperature: 0.4,
  };

  if (responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' };
  }

  const maxRetries = retry?.maxRetries ?? 3;
  const baseDelayMs = retry?.baseDelayMs ?? 500;
  const backoffFactor = retry?.backoffFactor ?? 2;
  const jitterMs = retry?.jitterMs ?? 250;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptNumber = attempt + 1;

    try {
      // Error Testing
      if (process.env.SIMULATE_GROQ === 'rate_limit') {
        throw new GroqError("Simulated rate limit", { status: 429, type: "RATE_LIMIT" });
      }
      if (process.env.SIMULATE_GROQ === 'parse_error') {
        throw new GroqError("Simulated malformed JSON", { status: 200, type: "PARSE_ERROR" });
      }
      if (process.env.SIMULATE_GROQ === 'server_error') {
        throw new GroqError("Simulated upstream failure", { status: 503, type: "SERVER_ERROR" });
      }
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      const rawBody = await response.text().catch(() => '');

      if (!response.ok) {
        const status = response.status;
        const type =
          status === 429
            ? 'RATE_LIMIT'
            : status >= 500
              ? 'SERVER_ERROR'
              : 'HTTP_ERROR';

        const error = new GroqError(
          `Groq API error: ${status}`,
          { status, body: rawBody, type }
        );

        const retryable = status === 429 || (status >= 500 && status < 600);
        if (retryable && attempt < maxRetries) {
          const delay = getBackoffDelayMs(attempt, baseDelayMs, backoffFactor, jitterMs);
          console.warn(
            `[groq] Attempt ${attemptNumber} failed (status=${status}, type=${type}). Retrying in ${delay}ms`
          );
          await sleep(delay);
          lastError = error;
          continue;
        }

        console.error(
          `[groq] Giving up after attempt ${attemptNumber}. status=${status} type=${type}`,
          error
        );
        throw error;
      }

      let data;
      try {
        data = JSON.parse(rawBody);
      } catch (parseError) {
        const error = new GroqError('Failed to parse Groq API JSON response', {
          status: response.status,
          body: rawBody,
          type: 'PARSE_ERROR',
        });
        console.error('[groq] JSON parse error on Groq response', error);
        throw error;
      }

      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        const error = new GroqError('Groq API returned no content', {
          status: response.status,
          body: rawBody,
          type: 'NO_CONTENT',
        });
        console.error('[groq] No content from Groq', error);
        throw error;
      }

      return { content, usage: data.usage };
    } catch (error) {
      const isGroqError = error instanceof GroqError;
      const status = isGroqError ? error.status : null;
      const type = isGroqError ? error.type : 'UNEXPECTED';

      const retryable = status === 429 || (status >= 500 && status < 600) || status === null;

      if (retryable && attempt < maxRetries) {
        const delay = getBackoffDelayMs(attempt, baseDelayMs, backoffFactor, jitterMs);
        console.warn(
          `[groq] Attempt ${attemptNumber} failed (status=${status}, type=${type}). Retrying in ${delay}ms`
        );
        await sleep(delay);
        lastError = error;
        continue;
      }

      console.error(
        `[groq] Giving up after attempt ${attemptNumber}. status=${status} type=${type} message=${error.message}`
      );
      throw error;
    }
  }

  throw lastError ?? new Error('Unknown Groq failure');
}

function safeJSON(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn('Failed to parse JSON response', error);
    return null;
  }
}

function isMissingKeyError(error) {
  return typeof error?.message === 'string' && error.message.includes('GROQ_API_KEY');
}

async function attachCurrentUser(req, _res, next) {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
  req.currentUser = null;
  req.session = null;

  if (!rawToken) {
    return next();
  }

  try {
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(rawToken) },
      include: { user: true },
    });

    if (!session || session.expiresAt <= new Date()) {
      if (session) {
        await prisma.session.delete({
          where: { id: session.id },
        });
      }
      return next();
    }

    req.session = session;
    req.currentUser = session.user;
  } catch (error) {
    console.error('[auth] Failed to attach current user', error);
  }

  return next();
}

function requireAuth(req, res, next) {
  if (!req.currentUser) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  return next();
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function normalizeTextField(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 160) : fallback;
}

function normalizeDisplayName(displayName) {
  if (typeof displayName !== 'string') return null;
  const trimmed = displayName.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function valueOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value.filter((entry) => entry !== null && entry !== undefined && entry !== '') : [];
}

function sanitizeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
  };
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashSessionToken(token) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(token)
    .digest('hex');
}

async function createSession(res, userId) {
  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

function requireFeature(featureName) {
  return (_req, res, next) => {
    if (activeFeatures[featureName]) {
      return next();
    }

    return res.status(403).json({
      error: `This feature is only available in local mode.`,
      code: 'LOCAL_ONLY_FEATURE',
      feature: featureName,
      mode: APP_MODE,
    });
  };
}

function blockLocalOnlyStatic(req, res, next) {
  const localOnlyPaths = new Set([
    '/quest-graph-panel.html',
  ]);

  if (localOnlyPaths.has(req.path) && !activeFeatures.conceptGraph) {
    return res.status(403).send(`
      <h1>Local-only feature</h1>
      <p>The concept graph viewer is disabled in demo mode.</p>
      <p><a href="/">Return to TextQuest</a></p>
    `);
  }

  return next();
}



function validateGenerationInput(body) {
  const title = normalizeTextField(body.title, 'Untitled Textbook');
  const focus = normalizeTextField(body.focus, 'general');
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!text) {
    return {
      error: true,
      status: 400,
      body: { error: 'Text is required' },
    };
  }

  if (text.length > activeFeatures.maxInputChars) {
    return {
      error: true,
      status: 413,
      body: {
        error: `Text is too long for ${APP_MODE} mode. Please keep it under ${activeFeatures.maxInputChars.toLocaleString()} characters.`,
        code: 'INPUT_TOO_LARGE',
        maxInputChars: activeFeatures.maxInputChars,
      },
    };
  }

  return {
    error: false,
    payload: { title, focus, text },
  };
}

async function generateStructurePayload({ title, focus, text }) {
  const bookExcerpt = text.trim().slice(0, 5000);
  const messages = [
    {
      role: 'system',
      content:
        'You are TextQuest, an AI narrative designer that turns textbooks into lightweight RPG blueprints. Respond ONLY with valid JSON including levels, quests, vocabulary, and suggested assessments.',
    },
    {
      role: 'user',
      content: `Source textbook: ${title}\nFocus topic: ${focus}\nBuild an RPG-friendly JSON with:\n- levels: [{name, overview, quests[]}]\n- quests: {title, description, items, abilities, dependencies}\n- vocabulary: [{term, type, description}]\n- assessments: [{name, format, success_condition}]\nBase it on this excerpt:\n"""${bookExcerpt}"""`,
    },
  ];

  try {
    const { content, usage } = await callGroq(messages, {
      responseFormat: 'json_object',
      retry: { maxRetries: 3 },
    });

    const structured = safeJSON(content);
    const responsePayload = {
      title,
      structured: structured ?? { raw: content },
      usage,
      via: 'groq',
    };

    if (!structured) {
      responsePayload.warnings = ['GROQ_PARSE_ERROR'];
    }

    return responsePayload;
  } catch (error) {
    if (isMissingKeyError(error)) {
      return {
        title,
        structured: sampleStructure,
        via: 'mock',
        message: 'Set GROQ_API_KEY to replace mock data.',
      };
    }

    throw error;
  }
}

async function generateNarrativePayload({ structured, learningGoal }) {
  const trimmedStructure = JSON.stringify(structured).slice(0, 8000);
  const messages = [
    {
      role: 'system',
      content:
        'You are an imaginative yet accurate RPG writer. Given structured learning data, write concise lore, NPC hooks, and encounter ideas that reinforce the knowledge.',
    },
    {
      role: 'user',
      content: `Structured data:\n${trimmedStructure}\nLearning goal: ${learningGoal}\nReturn JSON with introduction, regions (name, npc, questHook), encounters (name, mechanic, reward), and rewards (name, benefit).`,
    },
  ];

  try {
    const { content, usage } = await callGroq(messages, {
      responseFormat: 'json_object',
      retry: { maxRetries: 3 },
    });
    const narrative = safeJSON(content);
    const responsePayload = {
      narrative: narrative ?? { raw: content },
      usage,
      via: 'groq',
    };

    if (!narrative) {
      responsePayload.warnings = ['GROQ_PARSE_ERROR'];
    }

    return responsePayload;
  } catch (error) {
    if (isMissingKeyError(error)) {
      return {
        narrative: sampleNarrative,
        via: 'mock',
        message: 'Set GROQ_API_KEY to replace mock data.',
      };
    }

    throw error;
  }
}

async function saveGeneratedWorld({ userId, title, focus, text, structured, via, usage, warnings }) {
  return prisma.$transaction(async (tx) => {
    const sourceDocument = await tx.sourceDocument.create({
      data: {
        userId,
        title,
        sourceType: 'PASTED_TEXT',
        originalText: text,
        extractedText: text,
        textHash: crypto.createHash('sha256').update(text).digest('hex'),
      },
    });

    const worldDescription = deriveWorldDescription(structured, focus);

    const world = await tx.rpgWorld.create({
      data: {
        userId,
        sourceDocumentId: sourceDocument.id,
        title,
        focus,
        description: worldDescription,
        status: 'READY',
        generatedJson: {
          structured,
          via,
          usage: usage ?? null,
          warnings: warnings ?? [],
        },
      },
    });

    const questRows = buildQuestRows(structured, world.id);
    const createdQuests = [];
    for (const questRow of questRows) {
      const quest = await tx.quest.create({ data: questRow });
      createdQuests.push(quest);
    }

    const conceptRows = buildConceptRows(structured, world.id);
    const createdConcepts = [];
    for (const conceptRow of conceptRows) {
      const concept = await tx.concept.create({ data: conceptRow });
      createdConcepts.push(concept);
    }

    const skillRows = buildSkillRows(structured, world.id);
    for (const skillRow of skillRows) {
      await tx.skill.create({ data: skillRow });
    }

    const starterIdentity = buildStarterCharacter(title, focus, structured);
    const firstQuestId = createdQuests[0]?.id ?? null;
    const character = await tx.character.create({
      data: {
        userId,
        rpgWorldId: world.id,
        name: starterIdentity.name,
        className: starterIdentity.className,
        currentQuestId: firstQuestId,
      },
    });

    if (createdQuests.length) {
      await tx.characterProgress.createMany({
        data: createdQuests.map((quest, index) => ({
          characterId: character.id,
          questId: quest.id,
          status: index === 0 ? 'AVAILABLE' : 'LOCKED',
        })),
      });
    }

    if (createdConcepts.length) {
      await tx.conceptMastery.createMany({
        data: createdConcepts.map((concept) => ({
          characterId: character.id,
          conceptId: concept.id,
          masteryScore: 0,
          timesPracticed: 0,
        })),
      });
    }

    const hydratedWorld = await tx.rpgWorld.findUnique({
      where: { id: world.id },
      include: worldIncludeForUser(userId),
    });

    return {
      sourceDocument,
      world: hydratedWorld,
      character,
    };
  });
}

function buildQuestRows(structured, rpgWorldId) {
  const levels = Array.isArray(structured?.levels) ? structured.levels : [];
  const rows = [];
  let sortOrder = 0;

  levels.forEach((level, levelIndex) => {
    const quests = Array.isArray(level?.quests) ? level.quests : [];
    quests.forEach((quest, questIndex) => {
      rows.push({
        rpgWorldId,
        levelName: valueOrNull(level?.name),
        title: normalizeTextField(quest?.title, `Quest ${levelIndex + 1}.${questIndex + 1}`),
        description: valueOrNull(quest?.description),
        learningGoal: valueOrNull(level?.overview),
        sortOrder,
        rewardJson: {
          items: arrayOrEmpty(quest?.items),
          abilities: arrayOrEmpty(quest?.abilities),
        },
        dependencyJson: arrayOrEmpty(quest?.dependencies),
        generatedJson: quest ?? {},
      });
      sortOrder += 1;
    });
  });

  return rows;
}

function buildConceptRows(structured, rpgWorldId) {
  const vocabulary = Array.isArray(structured?.vocabulary) ? structured.vocabulary : [];
  const rows = [];
  const seen = new Set();

  vocabulary.forEach((entry) => {
    const name = normalizeTextField(entry?.term, '');
    if (!name) return;

    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    rows.push({
      rpgWorldId,
      name,
      type: valueOrNull(entry?.type),
      description: valueOrNull(entry?.description),
    });
  });

  return rows;
}

function buildSkillRows(structured, rpgWorldId) {
  const rows = [];
  const seen = new Set();

  const registerSkill = (name, description, source) => {
    const normalizedName = normalizeTextField(name, '');
    if (!normalizedName) return;

    const key = normalizedName.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    rows.push({
      rpgWorldId,
      name: normalizedName,
      description: valueOrNull(description),
      source,
    });
  };

  const vocabulary = Array.isArray(structured?.vocabulary) ? structured.vocabulary : [];
  vocabulary.forEach((entry) => {
    if (String(entry?.type || '').toLowerCase() === 'skill') {
      registerSkill(entry?.term, entry?.description, 'vocabulary');
    }
  });

  const levels = Array.isArray(structured?.levels) ? structured.levels : [];
  levels.forEach((level) => {
    const quests = Array.isArray(level?.quests) ? level.quests : [];
    quests.forEach((quest) => {
      arrayOrEmpty(quest?.abilities).forEach((ability) => {
        registerSkill(ability, `Unlocked through ${normalizeTextField(quest?.title, 'a quest')}.`, 'quest_ability');
      });
    });
  });

  return rows;
}

function buildStarterCharacter(title, focus, structured) {
  const levels = Array.isArray(structured?.levels) ? structured.levels : [];
  const firstQuestTitle = levels[0]?.quests?.[0]?.title;
  const firstFocusWord = normalizeTextField(focus, '').split(/[,\s]+/).filter(Boolean)[0];
  const worldKeyword = normalizeTextField(firstFocusWord || title, 'TextQuest')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');

  return {
    name: `${worldKeyword || 'Quest'} Seeker`,
    className: firstQuestTitle ? 'Scholar Adventurer' : 'Scholar',
  };
}

function deriveWorldDescription(structured, focus) {
  const firstLevelOverview = valueOrNull(structured?.levels?.[0]?.overview);
  const firstAssessment = valueOrNull(structured?.assessments?.[0]?.name);

  return firstLevelOverview || firstAssessment || `A TextQuest RPG world built around ${normalizeTextField(focus, 'this topic')}.`;
}

function worldIncludeForUser(userId) {
  return {
    sourceDocument: true,
    quests: {
      orderBy: { sortOrder: 'asc' },
    },
    concepts: {
      orderBy: { name: 'asc' },
    },
    skills: {
      orderBy: { name: 'asc' },
    },
    characters: {
      where: { userId },
      include: {
        progress: {
          include: {
            quest: true,
          },
        },
        conceptMasteries: {
          include: {
            concept: true,
          },
        },
        skills: {
          include: {
            skill: true,
          },
        },
      },
      take: 1,
    },
  };
}

function formatWorldSummary(world) {
  const character = world?.characters?.[0] ?? null;
  const progress = Array.isArray(character?.progress) ? character.progress : [];
  const concepts = Array.isArray(character?.conceptMasteries) ? character.conceptMasteries : [];
  const currentQuest = findCurrentQuest(world, character);

  return {
    id: world.id,
    title: world.title,
    focus: world.focus,
    description: world.description,
    status: world.status,
    createdAt: world.createdAt,
    updatedAt: world.updatedAt,
    masteryPercent: calculateMasteryPercent(concepts),
    questProgress: {
      completed: progress.filter((entry) => entry.status === 'COMPLETED').length,
      total: Array.isArray(world.quests) ? world.quests.length : 0,
    },
    counts: {
      concepts: Array.isArray(world.concepts) ? world.concepts.length : 0,
      skills: Array.isArray(world.skills) ? world.skills.length : 0,
    },
    currentQuest: currentQuest
      ? {
        id: currentQuest.id,
        title: currentQuest.title,
      }
      : null,
    character: character
      ? {
        id: character.id,
        name: character.name,
        className: character.className,
        level: character.level,
        xp: character.xp,
        currentQuestId: character.currentQuestId,
      }
      : null,
  };
}

function formatWorldDetail(world) {
  const summary = formatWorldSummary(world);
  const character = world?.characters?.[0] ?? null;
  const progressByQuestId = new Map(
    (character?.progress ?? []).map((entry) => [entry.questId, entry])
  );
  const masteryByConceptId = new Map(
    (character?.conceptMasteries ?? []).map((entry) => [entry.conceptId, entry])
  );
  const unlockedSkillIds = new Set(
    (character?.skills ?? []).map((entry) => entry.skillId)
  );

  return {
    ...summary,
    structured: world.generatedJson?.structured ?? world.generatedJson ?? null,
    narrative: world.narrativeJson?.narrative ?? world.narrativeJson ?? null,
    narrativeMeta: world.narrativeJson
      ? {
        via: world.narrativeJson.via ?? null,
        learningGoal: world.narrativeJson.learningGoal ?? null,
        warnings: world.narrativeJson.warnings ?? [],
      }
      : null,
    sourceDocument: world.sourceDocument
      ? {
        id: world.sourceDocument.id,
        title: world.sourceDocument.title,
        sourceType: world.sourceDocument.sourceType,
        createdAt: world.sourceDocument.createdAt,
      }
      : null,
    quests: (world.quests ?? []).map((quest) => {
      const progress = progressByQuestId.get(quest.id);
      return {
        id: quest.id,
        levelName: quest.levelName,
        title: quest.title,
        description: quest.description,
        learningGoal: quest.learningGoal,
        sortOrder: quest.sortOrder,
        status: progress?.status ?? 'LOCKED',
        attempts: progress?.attempts ?? 0,
        score: progress?.score ?? 0,
        completedAt: progress?.completedAt ?? null,
        rewards: quest.rewardJson ?? null,
        dependencies: quest.dependencyJson ?? [],
      };
    }),
    concepts: (world.concepts ?? []).map((concept) => {
      const mastery = masteryByConceptId.get(concept.id);
      return {
        id: concept.id,
        name: concept.name,
        type: concept.type,
        description: concept.description,
        difficulty: concept.difficulty,
        masteryScore: mastery?.masteryScore ?? 0,
        timesPracticed: mastery?.timesPracticed ?? 0,
      };
    }),
    skills: (world.skills ?? []).map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: skill.source,
      unlocked: unlockedSkillIds.has(skill.id),
    })),
  };
}

function findCurrentQuest(world, character) {
  if (!character?.currentQuestId) return null;
  return (world?.quests ?? []).find((quest) => quest.id === character.currentQuestId) ?? null;
}

function calculateMasteryPercent(concepts) {
  if (!Array.isArray(concepts) || concepts.length === 0) {
    return 0;
  }

  const total = concepts.reduce((sum, concept) => sum + (Number(concept.masteryScore) || 0), 0);
  return Math.round(total / concepts.length);
}

function handleGenerationError(res, scope, error, fallbackMessage) {
  if (error instanceof GroqError) {
    console.error(`[${scope}] GroqError`, { type: error.type, status: error.status });

    if (error.type === 'RATE_LIMIT' || error.status === 429) {
      return res.status(503).json({
        error: 'TextQuest is temporarily rate limited by the AI provider. Please wait a moment and try again.',
        code: 'GROQ_RATE_LIMIT',
        status: error.status,
      });
    }

    if (error.type === 'PARSE_ERROR') {
      return res.status(502).json({
        error: 'We had trouble understanding the AI response. Please try again.',
        code: 'GROQ_PARSE_ERROR',
        status: error.status,
      });
    }

    return res.status(502).json({
      error: 'The AI service is currently unavailable. Please try again.',
      code: 'GROQ_UPSTREAM_ERROR',
      status: error.status,
    });
  }

  console.error(`[${scope}] Failed`, error);
  return res.status(500).json({
    error: fallbackMessage,
    code: 'UNKNOWN_SERVER_ERROR',
  });
}

function handleNarrativeError(res, scope, error) {
  if (error instanceof GroqError) {
    console.error(`[${scope}] GroqError`, { type: error.type, status: error.status });

    if (error.type === 'RATE_LIMIT' || error.status === 429) {
      return res.status(503).json({
        error: 'Narrative generation is temporarily rate limited. Please wait a moment and try again.',
        code: 'GROQ_RATE_LIMIT',
        status: error.status,
      });
    }

    if (error.type === 'PARSE_ERROR') {
      return res.status(502).json({
        error: 'We had trouble understanding the AI response for narrative. Please try again.',
        code: 'GROQ_PARSE_ERROR',
        status: error.status,
      });
    }

    return res.status(502).json({
      error: 'The AI narrative service is currently unavailable. Please try again.',
      code: 'GROQ_UPSTREAM_ERROR',
      status: error.status,
    });
  }

  console.error(`[${scope}] Failed`, error);
  return res.status(500).json({
    error: 'Failed to craft narrative content',
    code: 'UNKNOWN_SERVER_ERROR',
  });
}
