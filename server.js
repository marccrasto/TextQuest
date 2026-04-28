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
const SAMPLE_PDF_MATCHER = /^Relational-Databases.*\.pdf$/i;

const persistence = new GraphPersistence(DATA_DIR);
const embeddingsManager = new EmbeddingsManager({
  apiKey: process.env.OPENAI_API_KEY,
});
let pdfToImages = null;

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

app.get('/api/sample-pdf', requireFeature('pdfUpload'), (req, res) => {
  const samplePdfPath = getSamplePdfPath();
  if (!samplePdfPath) {
    return res.status(404).json({
      error: 'Sample PDF not found.',
      code: 'SAMPLE_PDF_NOT_FOUND',
    });
  }

  return res.download(samplePdfPath, path.basename(samplePdfPath));
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

app.delete('/api/worlds/:worldId', requireAuth, async (req, res) => {
  try {
    const world = await prisma.rpgWorld.findFirst({
      where: {
        id: req.params.worldId,
        userId: req.currentUser.id,
      },
      select: { id: true, title: true },
    });

    if (!world) {
      return res.status(404).json({ error: 'RPG world not found.' });
    }

    await prisma.rpgWorld.delete({
      where: { id: world.id },
    });

    return res.json({
      deleted: true,
      worldId: world.id,
      title: world.title,
    });
  } catch (error) {
    console.error('[worlds.delete] Failed', error);
    return res.status(500).json({ error: 'Failed to delete RPG world.' });
  }
});

app.post('/api/worlds/:worldId/narrative', requireAuth, async (req, res) => {
  const learningGoal = normalizeTextField(
    req.body?.learningGoal,
    'Keep the player curious about the topic.'
  );
  const restartFromBeginning = req.body?.restartFromBeginning === true;

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

    if (world.narrativeJson && isWorldStarted(world) && !restartFromBeginning) {
      return res.status(409).json({
        error: 'This world has already started. Regenerating the narrative now would require restarting the protagonist from the beginning.',
        code: 'NARRATIVE_LOCKED',
        restartRequired: true,
      });
    }

    const narrativePayload = await generateNarrativePayload({
      structured,
      learningGoal,
    });
    const refreshedQuestChallenges = buildQuestChallengesForWorld(world, structured, narrativePayload.narrative);

    await prisma.$transaction(async (tx) => {
      if (restartFromBeginning) {
        await resetWorldProgress(tx, world);
      }

      await tx.rpgWorld.update({
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

      for (const questUpdate of refreshedQuestChallenges) {
        await tx.quest.update({
          where: { id: questUpdate.id },
          data: {
            challengeJson: questUpdate.challengeJson,
          },
        });
      }
    });

    return res.json({
      saved: true,
      learningGoal,
      restarted: restartFromBeginning,
      ...narrativePayload,
    });
  } catch (error) {
    return handleNarrativeError(res, 'worlds.narrative', error);
  }
});

app.get('/api/worlds/:worldId/play', requireAuth, async (req, res) => {
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

    if (!hasPlayableNarrative(world)) {
      return res.status(409).json({
        error: 'Generate a narrative for this world before you start playing it.',
        code: 'NARRATIVE_REQUIRED',
      });
    }

    const playState = buildPlayState(world, req.query?.questId);
    if (!playState) {
      return res.status(400).json({ error: 'This world does not have a playable quest sequence yet.' });
    }

    return res.json({
      play: playState,
    });
  } catch (error) {
    console.error('[worlds.play] Failed', error);
    return res.status(500).json({ error: 'Failed to load the play experience.' });
  }
});

app.post('/api/worlds/:worldId/play/answer', requireAuth, async (req, res) => {
  const answer = normalizeTextField(req.body?.answer, '');
  const requestedQuestId = normalizeTextField(req.body?.questId, '');

  if (!answer) {
    return res.status(400).json({ error: 'An answer is required.' });
  }

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

    if (!hasPlayableNarrative(world)) {
      return res.status(409).json({
        error: 'Generate a narrative for this world before you start playing it.',
        code: 'NARRATIVE_REQUIRED',
      });
    }

    const active = getQuestBundle(world, requestedQuestId);
    if (!active) {
      return res.status(400).json({ error: 'No active quest is available for this world.' });
    }

    const step = active.steps[active.currentStepIndex];
    if (!step) {
      return res.status(400).json({ error: 'There is no active step to answer right now.' });
    }

    const correct = normalizeAnswer(step.correctAnswer) === normalizeAnswer(answer);
    const xpGained = correct ? (step.phase === 'final' ? 30 : 15) : 0;
    const masteryDelta = correct ? (step.phase === 'final' ? 10 : 5) : 0;
    const nextScore = correct ? active.progress.score + 1 : active.progress.score;
    const questCompleted = correct && nextScore >= active.steps.length;
    const nextStatus = questCompleted
      ? 'COMPLETED'
      : active.progress.status === 'AVAILABLE'
        ? 'IN_PROGRESS'
        : active.progress.status || 'IN_PROGRESS';

    await prisma.$transaction(async (tx) => {
      await tx.characterProgress.update({
        where: { id: active.progress.id },
        data: {
          attempts: { increment: 1 },
          score: correct ? { increment: 1 } : undefined,
          status: nextStatus,
          completedAt: questCompleted ? new Date() : null,
        },
      });

      if (xpGained > 0) {
        const nextXp = (active.character.xp ?? 0) + xpGained;
        await tx.character.update({
          where: { id: active.character.id },
          data: {
            xp: nextXp,
            level: Math.floor(nextXp / 100) + 1,
          },
        });
      }

      if (masteryDelta > 0 && Array.isArray(step.relatedConcepts) && step.relatedConcepts.length) {
        await applyMasteryDelta(tx, active.character.id, world.concepts, step.relatedConcepts, masteryDelta);
      }

      if (questCompleted) {
        await unlockNextQuest(tx, active.character, world.quests, active.quest);
      }
    });

    const refreshedWorld = await prisma.rpgWorld.findFirst({
      where: {
        id: world.id,
        userId: req.currentUser.id,
      },
      include: worldIncludeForUser(req.currentUser.id),
    });

    return res.json({
      correct,
      answer,
      feedback: correct ? step.successText : step.failureText,
      explanation: step.explanation,
      xpGained,
      masteryDelta,
      questCompleted,
      play: buildPlayState(
        refreshedWorld,
        questCompleted ? (active.nextQuest?.id ?? active.quest.id) : active.quest.id
      ),
    });
  } catch (error) {
    console.error('[worlds.play.answer] Failed', error);
    return res.status(500).json({ error: 'Failed to process the encounter answer.' });
  }
});

app.post('/api/worlds/:worldId/play/replay', requireAuth, async (req, res) => {
  const questId = normalizeTextField(req.body?.questId, '');
  if (!questId) {
    return res.status(400).json({ error: 'A quest is required to replay.' });
  }

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

    if (!hasPlayableNarrative(world)) {
      return res.status(409).json({
        error: 'Generate a narrative for this world before you start playing it.',
        code: 'NARRATIVE_REQUIRED',
      });
    }

    const bundle = getQuestBundle(world, questId);
    if (!bundle) {
      return res.status(404).json({ error: 'Quest not found or not yet unlocked.' });
    }

    const preserveCompletion = Array.isArray(bundle.character.progress)
      && bundle.character.progress.length > 0
      && bundle.character.progress.every((entry) => entry.completedAt || entry.status === 'COMPLETED');

    await prisma.$transaction(async (tx) => {
      await tx.characterProgress.update({
        where: { id: bundle.progress.id },
        data: {
          status: preserveCompletion ? 'IN_PROGRESS' : 'AVAILABLE',
          attempts: 0,
          score: 0,
          completedAt: preserveCompletion ? bundle.progress.completedAt : null,
        },
      });

      await tx.character.update({
        where: { id: bundle.character.id },
        data: { currentQuestId: bundle.quest.id },
      });
    });

    const refreshedWorld = await prisma.rpgWorld.findFirst({
      where: {
        id: world.id,
        userId: req.currentUser.id,
      },
      include: worldIncludeForUser(req.currentUser.id),
    });

    return res.json({
      replayed: true,
      play: buildPlayState(refreshedWorld, questId),
    });
  } catch (error) {
    console.error('[worlds.play.replay] Failed', error);
    return res.status(500).json({ error: 'Failed to replay this quest.' });
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
    if (process.platform !== 'win32') {
      console.warn('[ocr] OCR is only supported in local Windows mode. Skipping OCR.');
      return "";
    }
    if (!pdfToImages) {
      pdfToImages = require('./pdfToImages');
    }
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

function getSamplePdfPath() {
  const uploadsDir = path.join(__dirname, 'uploads');

  try {
    const entries = fs.readdirSync(uploadsDir, { withFileTypes: true });
    const match = entries.find((entry) => entry.isFile() && SAMPLE_PDF_MATCHER.test(entry.name));
    return match ? path.join(uploadsDir, match.name) : null;
  } catch (error) {
    console.warn('[sample-pdf] Could not read uploads directory', error);
    return null;
  }
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
          'You are TextQuest, an AI designer that turns textbooks into lightweight RPG learning blueprints. Respond ONLY with valid JSON including levels, quests, and vocabulary. Keep quest names distinct, evocative, and useful for a short demo.',
      },
      {
        role: 'user',
        content: `Source textbook: ${title}\nFocus topic: ${focus}\nBuild an RPG-friendly JSON with:\n- levels: [{name, overview, quests[]}]\n- quests: {title, description, items, abilities, dependencies}\n- vocabulary: [{term, type, description}]\nBase it on this excerpt:\n"""${bookExcerpt}"""`,
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
          'You are an imaginative yet accurate RPG writer. Given structured learning data, write concise lore, memorable place names, distinct NPC hooks, and encounter ideas that reinforce the knowledge. Make the world feel cohesive enough for a short demo playthrough.',
      },
      {
        role: 'user',
        content: `Structured data:\n${trimmedStructure}\nLearning goal: ${learningGoal}\nReturn JSON with introduction, regions (name, npc, questHook), encounters (name, mechanic, reward), and rewards (name, benefit). Keep region names and hooks vivid, specific, and tonally consistent with one another.`,
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

    const questRows = buildQuestRows(structured, world.id, text);
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

function buildQuestRows(structured, rpgWorldId, sourceText = '') {
  const levels = Array.isArray(structured?.levels) ? structured.levels : [];
  const conceptPool = buildConceptPool(structured);
  const rows = [];
  let sortOrder = 0;

  levels.forEach((level, levelIndex) => {
    const quests = Array.isArray(level?.quests) ? level.quests : [];
    quests.forEach((quest, questIndex) => {
      const challengeJson = buildQuestChallengeSequence({
        level,
        quest,
        questIndex: sortOrder,
        conceptPool,
      });

      rows.push({
        rpgWorldId,
        levelName: valueOrNull(level?.name),
        title: normalizeTextField(quest?.title, `Path ${levelIndex + 1}.${questIndex + 1}`),
        description: valueOrNull(quest?.description),
        learningGoal: valueOrNull(level?.overview),
        sortOrder,
        rewardJson: {
          items: arrayOrEmpty(quest?.items),
          abilities: arrayOrEmpty(quest?.abilities),
        },
        dependencyJson: arrayOrEmpty(quest?.dependencies),
        challengeJson,
        generatedJson: quest ?? {},
      });
      sortOrder += 1;
    });
  });

  return rows;
}

function buildChapterQuestRows(structured, rpgWorldId, sourceText = '') {
  const levels = Array.isArray(structured?.levels) ? structured.levels : [];
  const conceptPool = buildConceptPool(structured);
  const sourceSections = extractSourceSections(sourceText, Math.max(1, levels.length));
  const rows = [];

  levels.forEach((level, levelIndex) => {
    const chapterTitle = normalizeTextField(level?.name, `Chapter ${levelIndex + 1}`);
    const questList = Array.isArray(level?.quests) ? level.quests : [];
    const questTitles = questList
      .map((quest) => normalizeTextField(quest?.title, ''))
      .filter(Boolean);
    const chapterDescription = valueOrNull(level?.overview)
      || valueOrNull(questList[0]?.description)
      || `Work through the ideas in ${chapterTitle} and use the chapter details to solve the region's conflict.`;
    const sourceExcerpt = sourceSections[levelIndex] || sourceText.trim().slice(0, 1600);
    const chapterQuest = {
      title: chapterTitle,
      description: chapterDescription,
      items: questTitles.slice(0, 4),
      abilities: [`Navigate ${chapterTitle}`],
      dependencies: levelIndex > 0 ? [normalizeTextField(levels[levelIndex - 1]?.name, `Chapter ${levelIndex}`)] : [],
      sourceExcerpt,
    };

    rows.push({
      rpgWorldId,
      levelName: chapterTitle,
      title: chapterTitle,
      description: chapterDescription,
      learningGoal: chapterDescription,
      sortOrder: levelIndex,
      rewardJson: {
        items: questTitles.slice(0, 4),
        abilities: [`Navigate ${chapterTitle}`],
      },
      dependencyJson: levelIndex > 0 ? [normalizeTextField(levels[levelIndex - 1]?.name, `Chapter ${levelIndex}`)] : [],
      challengeJson: buildQuestChallengeSequence({
        level,
        quest: chapterQuest,
        questIndex: levelIndex,
        conceptPool,
        sourceExcerpt,
      }),
      generatedJson: {
        title: chapterTitle,
        description: chapterDescription,
        sourceExcerpt,
        chapterTopics: questTitles,
        chapterIndex: levelIndex,
      },
    });
  });

  return rows;
}

function buildQuestChallengesForWorld(world, structured, narrativeOverride = null) {
  const conceptPool = buildConceptPool(structured);
  const narrative = narrativeOverride || world?.narrativeJson?.narrative || world?.narrativeJson || null;
  const regions = Array.isArray(narrative?.regions) ? narrative.regions : [];
  const encounters = Array.isArray(narrative?.encounters) ? narrative.encounters : [];
  const introduction = formatNarrativeValue(narrative?.introduction);
  const sortedQuests = Array.isArray(world?.quests)
    ? world.quests.slice().sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    : [];

  return sortedQuests.map((quest, questIndex) => ({
    id: quest.id,
    challengeJson: buildQuestChallengeSequence({
      level: {
        name: quest.levelName,
        overview: quest.learningGoal,
      },
      quest: {
        ...(quest.generatedJson ?? {
          title: quest.title,
          description: quest.description,
        }),
        },
        questIndex,
        conceptPool,
        narrativeRegion: regions[questIndex % Math.max(1, regions.length)] ?? null,
        narrativeEncounter: encounters[questIndex % Math.max(1, encounters.length)] ?? null,
        worldIntroduction: introduction,
      }),
    }));
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

function buildConceptPool(structured) {
  const vocabulary = Array.isArray(structured?.vocabulary) ? structured.vocabulary : [];
  const entries = vocabulary
    .map((entry) => ({
      term: normalizeTextField(entry?.term, ''),
      description: valueOrNull(entry?.description) || 'This concept supports the quest.',
      type: normalizeTextField(entry?.type, 'concept'),
    }))
    .filter((entry) => entry.term);

  if (entries.length) {
    return entries;
  }

  const fallbackTerms = [];
  const levels = Array.isArray(structured?.levels) ? structured.levels : [];
  levels.forEach((level) => {
    const quests = Array.isArray(level?.quests) ? level.quests : [];
    quests.forEach((quest) => {
      fallbackTerms.push(
        ...arrayOrEmpty(quest?.items).map((item) => ({
          term: normalizeTextField(String(item), ''),
          description: `A quest item tied to ${normalizeTextField(quest?.title, 'this quest')}.`,
          type: 'item',
        })),
        ...arrayOrEmpty(quest?.abilities).map((ability) => ({
          term: normalizeTextField(String(ability), ''),
          description: `An ability used during ${normalizeTextField(quest?.title, 'this quest')}.`,
          type: 'ability',
        }))
      );
    });
  });

  return fallbackTerms.filter((entry) => entry.term);
}

function extractSourceSections(sourceText, desiredSections) {
  const normalized = String(sourceText || '').replace(/\r/g, '').trim();
  if (!normalized) {
    return [];
  }

  const paragraphSections = normalized
    .split(/\n\s*\n+/)
    .map((section) => section.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (paragraphSections.length >= desiredSections) {
    return paragraphSections.slice(0, desiredSections).map((section) => section.slice(0, 900));
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (!sentences.length) {
    return [normalized.slice(0, 900)];
  }

  const sectionSize = Math.max(1, Math.ceil(sentences.length / Math.max(1, desiredSections)));
  const sections = [];
  for (let index = 0; index < sentences.length; index += sectionSize) {
    sections.push(sentences.slice(index, index + sectionSize).join(' ').slice(0, 900));
  }

  return sections;
}

function buildQuestChallengeSequence({
  level,
  quest,
  questIndex,
  conceptPool,
  sourceExcerpt = '',
  narrativeRegion = null,
  narrativeEncounter = null,
  worldIntroduction = '',
}) {
  const questTitle = normalizeTextField(quest?.title, `Quest ${questIndex + 1}`);
  const locationName = formatNarrativeValue(narrativeRegion?.name)
    || normalizeTextField(level?.name, `Region ${questIndex + 1}`);
  const npcName = formatNarrativeValue(narrativeRegion?.npc) || buildNpcName(questTitle, locationName);
  const questDescription = formatNarrativeValue(narrativeRegion?.questHook)
    || valueOrNull(quest?.description)
    || `The fate of ${locationName} depends on how well you can handle ${questTitle}.`;
  const activeExcerpt = normalizeTextField(sourceExcerpt || quest?.sourceExcerpt || quest?.generatedJson?.sourceExcerpt, '');
  const encounterMechanic = formatNarrativeValue(narrativeEncounter?.mechanic);
  const encounterReward = formatNarrativeValue(narrativeEncounter?.reward);
  const flavorText = [
    worldIntroduction,
    locationName,
    npcName,
    questDescription,
    encounterMechanic,
    encounterReward,
  ].filter(Boolean).join(' ');
  const selectedConcepts = pickConceptsForQuest(quest, conceptPool);
  const practiceConcepts = selectedConcepts.slice(0, Math.min(2, selectedConcepts.length));
  const finalConcepts = selectedConcepts.slice(Math.min(2, selectedConcepts.length));
  const usableFinalConcepts = finalConcepts.length
    ? finalConcepts
    : selectedConcepts.slice(0, Math.min(3, selectedConcepts.length));
  const practiceSteps = practiceConcepts.map((concept, index) =>
    buildChoiceStep({
      phase: 'practice',
      questTitle,
        locationName,
        questDescription,
        sourceExcerpt: activeExcerpt,
        themeText: flavorText,
        concept,
        distractors: conceptPool,
        stepIndex: index,
    })
  );
  const finalSteps = usableFinalConcepts.map((concept, index) =>
    buildChoiceStep({
      phase: 'final',
      questTitle,
        locationName,
        questDescription,
        sourceExcerpt: activeExcerpt,
        themeText: flavorText,
        concept,
        distractors: conceptPool,
        stepIndex: practiceSteps.length + index,
    })
  );
  const dialogueConcepts = selectedConcepts.slice(0, 3);

  return {
      scene: {
        locationName,
        npcName,
        title: questTitle,
        introText: `${npcName} guides you through ${locationName}. Read the scene, learn the patterns, and survive the final encounter in ${questTitle}.`,
        environmentSeed: `${locationName}-${questIndex}`,
        dialogue: buildQuestDialogue({
          questTitle,
        locationName,
        npcName,
          quest,
          questDescription,
          sourceExcerpt: activeExcerpt,
          encounterMechanic,
          encounterReward,
          worldIntroduction,
          concepts: dialogueConcepts,
        }),
      },
      practiceSteps,
      finalEncounter: {
        name: `${questTitle} Trial`,
        summary: encounterMechanic
          ? `A multi-step challenge shaped around ${encounterMechanic.toLowerCase()}.`
          : 'A multi-step challenge that tests whether you can apply the world’s ideas under pressure.',
        steps: finalSteps,
      },
  };
}

function buildQuestDialogue({
  questTitle,
  locationName,
  npcName,
  quest,
  questDescription,
  sourceExcerpt,
  encounterMechanic,
  encounterReward,
  worldIntroduction,
  concepts,
}) {
  const protagonistName = 'You';
  const opening = questDescription || `Something in ${locationName} has gone wrong, and the only way through is understanding the lesson behind ${questTitle}.`;
  const conceptA = concepts[0];
  const conceptB = concepts[1] || concepts[0];
  const conceptC = concepts[2] || conceptB;
  const roleLine = buildNpcRoleLine(npcName, locationName, worldIntroduction, opening);

  const lines = [
    {
      speaker: npcName,
      role: 'npc',
      text: roleLine,
    },
    {
      speaker: protagonistName,
      role: 'player',
      text: 'Before I step in, show me what to watch for so I can read the scene instead of guessing.',
    },
  ];

  if (conceptA) {
    lines.push({
      speaker: npcName,
      role: 'npc',
      text: buildTeachingLine({
        concept: conceptA,
        questTitle,
        locationName,
        questDescription,
        sourceExcerpt,
        emphasis: 'foundation',
      }),
    });
  }

  if (conceptB && conceptB.term !== conceptA?.term) {
    lines.push({
      speaker: npcName,
      role: 'npc',
      text: buildTeachingLine({
        concept: conceptB,
        questTitle,
        locationName,
        questDescription,
        sourceExcerpt,
        emphasis: 'connection',
      }),
    });
  }

  if (conceptC && conceptC.term !== conceptA?.term && conceptC.term !== conceptB?.term) {
    lines.push({
      speaker: npcName,
      role: 'npc',
      text: buildTeachingLine({
        concept: conceptC,
        questTitle,
        locationName,
        questDescription,
        sourceExcerpt,
        emphasis: 'warning',
      }),
    });
  }

  lines.push({
    speaker: protagonistName,
    role: 'player',
    text: 'Got it. I need to read the situation, not just memorize terms. Let me practice before I face the final trial.',
  });

  if (encounterMechanic || encounterReward) {
    lines.push({
      speaker: npcName,
      role: 'npc',
      text: `When the trial starts, expect ${encounterMechanic || 'a layered test'}.${encounterReward ? ` Hold your nerve and you’ll earn ${encounterReward}.` : ''}`,
    });
  }

  return lines;
}

function pickConceptsForQuest(quest, conceptPool) {
  if (!conceptPool.length) {
    return [{
      term: normalizeTextField(quest?.title, 'Core concept'),
      description: valueOrNull(quest?.description) || 'Use what you learned in this quest.',
      type: 'concept',
    }];
  }

  const questText = [
    normalizeTextField(quest?.title, ''),
    valueOrNull(quest?.description),
    ...arrayOrEmpty(quest?.items).map(String),
    ...arrayOrEmpty(quest?.abilities).map(String),
    ...arrayOrEmpty(quest?.dependencies).map(String),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const matched = conceptPool.filter((concept) => questText.includes(concept.term.toLowerCase()));
  if (matched.length >= 3) {
    return matched.slice(0, 5);
  }

  const combined = [...matched];
  for (const concept of conceptPool) {
    if (!combined.find((entry) => entry.term === concept.term)) {
      combined.push(concept);
    }
    if (combined.length >= 5) break;
  }

  return combined;
}

function buildChoiceStep({
  phase,
  questTitle,
  locationName,
  questDescription,
  sourceExcerpt,
  themeText = '',
  concept,
  distractors,
  stepIndex,
}) {
  const choices = buildChoiceList(concept, distractors);
  const isFinal = phase === 'final';
  const scenario = buildScenarioPrompt({
    phase,
    questTitle,
    locationName,
    questDescription,
    sourceExcerpt,
    themeText,
    concept,
  });

  return {
    id: `${phase}-${stepIndex + 1}`,
    phase,
    prompt: scenario,
    choices,
    correctAnswer: concept.term,
    explanation: `${concept.term} fits because ${buildAppliedExplanation(concept, locationName, questTitle)}`,
    successText: isFinal
      ? `You held the line in ${locationName} by applying ${concept.term}.`
      : `Good read. ${concept.term} is one of the key ideas for this quest.`,
    failureText: isFinal
      ? `Not quite. The encounter is asking you to apply the idea, not just repeat its definition.`
      : `Close, but look for what the situation is really asking you to notice or preserve.`,
    relatedConcepts: [concept.term],
  };
}

function buildNpcRoleLine(npcName, locationName, worldIntroduction, opening) {
  const intro = normalizeTextField(worldIntroduction, '');
  const compactIntro = intro ? `${intro.replace(/\s+/g, ' ').trim()} ` : '';
  return `${compactIntro}I keep watch over ${locationName}, and right now ${opening}`;
}

function buildTeachingLine({ concept, questTitle, locationName, questDescription, sourceExcerpt, emphasis }) {
  const conceptName = normalizeTextField(concept?.term, 'This concept');
  const desc = normalizeTextField(concept?.description, `${conceptName} matters in this quest.`);
  const summary = summarizeDescription(desc);
  const contextualProblem = normalizeTextField(
    questDescription,
    `${questTitle} is in trouble and ${locationName} needs a careful reader.`
  );

  if (emphasis === 'foundation') {
    return `${contextualProblem} Start by watching for ${conceptName.toLowerCase()}: it matters when ${summary}.`;
  }

  if (emphasis === 'connection') {
    return `Do not treat ${conceptName} like a flashcard answer. In ${locationName}, it changes how you read the whole situation because ${summary}.`;
  }

  return `One warning before the trial: players usually slip when the scene gets noisy. That is exactly when ${conceptName.toLowerCase()} matters, because ${summary}.`;
}

function buildScenarioPrompt({ phase, questTitle, locationName, questDescription, sourceExcerpt, themeText = '', concept }) {
  const setup = normalizeTextField(
    questDescription,
    `${questTitle} is forcing everyone in ${locationName} to make a difficult choice.`
  );
  const challenge = buildAppliedScenario(concept, locationName, questDescription, questTitle, themeText);
  const questionTail = phase === 'final'
    ? 'Which idea should guide your decision here?'
    : 'Which idea are you actually seeing in this situation?';

  if (phase === 'final') {
    return `${locationName} reaches its breaking point during ${questTitle}. ${setup} ${challenge} ${questionTail}`;
  }

  return `While preparing for ${questTitle}, your mentor points to this case in ${locationName}: ${challenge} ${questionTail}`;
}

function buildAppliedScenario(concept, locationName, questDescription = '', questTitle = '', themeText = '') {
  const term = normalizeTextField(concept?.term, 'the concept').toLowerCase();
  const description = normalizeTextField(concept?.description, '').toLowerCase();
  const subject = buildScenarioSubject(locationName, questDescription, questTitle, themeText);

  if (term.includes('one-to-one') || description.includes('one-to-one')) {
    return `A ${subject.anchor} in ${locationName} only works if each ${subject.unitSingular} is paired with exactly one counterpart, and any extra pairing breaks the system.`;
  }

  if (term.includes('one-to-many') || description.includes('one-to-many')) {
    return `One ${subject.leader} in ${locationName} can direct many ${subject.unitPlural}, but each ${subject.unitSingular} still reports back to just one ${subject.leader}.`;
  }

  if (term.includes('many-to-many') || description.includes('many-to-many')) {
    return `Several ${subject.groupPlural} in ${locationName} interact with several ${subject.targetPlural} at once, and the keepers need a way to track every crossing without losing detail.`;
  }

  if (term.includes('recursive') || description.includes('recursive')) {
    return `In ${locationName}, ${subject.creaturePlural} can guide, report to, or depend on other ${subject.creaturePlural} of the same kind.`;
  }

  if (description.includes('relationship')) {
    return `Two parts of the problem in ${locationName} clearly affect one another, and the wrong interpretation would make the whole system inconsistent.`;
  }

  if (description.includes('process') || description.includes('cycle')) {
    return `The challenge in ${locationName} unfolds in stages, and missing how one stage feeds the next would make the final answer collapse.`;
  }

  return `A guide in ${locationName} shows you a situation where the surface details are distracting, but one underlying idea determines which choice actually works.`;
}

function buildScenarioSubject(locationName, questDescription = '', questTitle = '', themeText = '') {
  const text = `${locationName} ${questDescription} ${questTitle} ${themeText}`.toLowerCase();

  if (/(cursed|crypt|grave|spirit|swamp|shadow|haunt|gargoyle|wraith|forest)/.test(text)) {
    return {
      anchor: 'rune gate',
      unitSingular: 'gargoyle',
      unitPlural: 'gargoyles',
      leader: 'grave-keeper',
      groupPlural: 'spirits',
      targetPlural: 'relics',
      creaturePlural: 'gargoyles',
    };
  }

  if (/(archive|library|record|ledger|scribe)/.test(text)) {
    return {
      anchor: 'vault seal',
      unitSingular: 'record',
      unitPlural: 'records',
      leader: 'archivist',
      groupPlural: 'scribes',
      targetPlural: 'ledgers',
      creaturePlural: 'records',
    };
  }

  if (/(cell|mitochondria|chloroplast|biology|organ|membrane|enzyme|gene)/.test(text)) {
    return {
      anchor: 'membrane lock',
      unitSingular: 'cell',
      unitPlural: 'cells',
      leader: 'signal protein',
      groupPlural: 'enzymes',
      targetPlural: 'reactions',
      creaturePlural: 'organelles',
    };
  }

  if (/(market|economy|trade|finance|price|supply|demand)/.test(text)) {
    return {
      anchor: 'exchange charter',
      unitSingular: 'merchant',
      unitPlural: 'merchants',
      leader: 'guild broker',
      groupPlural: 'traders',
      targetPlural: 'contracts',
      creaturePlural: 'brokers',
    };
  }

  return {
    anchor: 'safeguard',
    unitSingular: 'agent',
    unitPlural: 'agents',
    leader: 'coordinator',
    groupPlural: 'teams',
    targetPlural: 'missions',
    creaturePlural: 'members',
  };
}

function buildAppliedExplanation(concept, locationName, questTitle) {
  const conceptName = normalizeTextField(concept?.term, 'This concept');
  const summary = summarizeDescription(concept?.description);
  return `${conceptName} is the right lens here because the scene in ${locationName} only makes sense when you notice that ${summary} during ${questTitle}.`;
}

function summarizeDescription(description) {
  const raw = normalizeTextField(description, 'the underlying rule of the scene matters more than the surface wording');
  const trimmed = raw.replace(/\.$/, '');

  if (/^a\s+/i.test(trimmed) || /^an\s+/i.test(trimmed) || /^the\s+/i.test(trimmed)) {
    return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  }

  return trimmed;
}

function buildExcerptClue(sourceExcerpt, index = 0) {
  const normalized = normalizeTextField(sourceExcerpt, '');
  if (!normalized) {
    return 'the author is signaling an important pattern rather than handing you the answer directly';
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (!sentences.length) {
    return normalized.slice(0, 180);
  }

  return sentences[index % sentences.length].slice(0, 180);
}

function buildChoiceList(correctConcept, conceptPool) {
  const choices = [correctConcept.term];
  const ranked = conceptPool
    .filter((concept) => concept.term !== correctConcept.term && !choices.includes(concept.term))
    .map((concept) => ({
      concept,
      score: scoreDistractorFit(correctConcept, concept),
    }))
    .sort((left, right) => right.score - left.score);

  for (const entry of ranked) {
    if (choices.length >= 4) break;
    choices.push(entry.concept.term);
  }

  return shuffleArray(choices);
}

function scoreDistractorFit(correctConcept, candidateConcept) {
  let score = 0;
  if (
    normalizeTextField(correctConcept?.type, '')
    && normalizeTextField(correctConcept?.type, '') === normalizeTextField(candidateConcept?.type, '')
  ) {
    score += 4;
  }

  const correctWords = new Set(tokenizeForSimilarity(`${correctConcept?.term || ''} ${correctConcept?.description || ''}`));
  const candidateWords = tokenizeForSimilarity(`${candidateConcept?.term || ''} ${candidateConcept?.description || ''}`);
  for (const word of candidateWords) {
    if (correctWords.has(word)) {
      score += 2;
    }
  }

  if (
    normalizeTextField(candidateConcept?.term, '').split(/\s+/).length
    === normalizeTextField(correctConcept?.term, '').split(/\s+/).length
  ) {
    score += 1;
  }

  return score;
}

function tokenizeForSimilarity(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2);
}

function buildNpcName(questTitle, locationName) {
  const source = `${questTitle} ${locationName}`.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const first = source[0] || 'Quest';
  const second = source[1] || 'Guide';
  return `${capitalizeWord(first)} ${capitalizeWord(second)}`;
}

function shuffleArray(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function capitalizeWord(value) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function resetWorldProgress(tx, world) {
  const character = world?.characters?.[0];
  const quests = Array.isArray(world?.quests) ? world.quests : [];

  if (!character) {
    return;
  }

  await tx.characterSkill.deleteMany({
    where: { characterId: character.id },
  });

  await tx.conceptMastery.updateMany({
    where: { characterId: character.id },
    data: {
      masteryScore: 0,
      timesPracticed: 0,
      lastPracticedAt: null,
    },
  });

  const firstQuestId = quests[0]?.id ?? null;
  await tx.character.update({
    where: { id: character.id },
    data: {
      level: 1,
      xp: 0,
      currentQuestId: firstQuestId,
    },
  });

  for (const [index, quest] of quests.entries()) {
    await tx.characterProgress.updateMany({
      where: {
        characterId: character.id,
        questId: quest.id,
      },
      data: {
        status: index === 0 ? 'AVAILABLE' : 'LOCKED',
        attempts: 0,
        score: 0,
        completedAt: null,
      },
    });
  }
}

function deriveWorldDescription(structured, focus) {
  const firstLevelOverview = valueOrNull(structured?.levels?.[0]?.overview);
  return firstLevelOverview || `A TextQuest RPG world built around ${normalizeTextField(focus, 'this topic')}.`;
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
  const started = isWorldStarted(world);

  return {
    id: world.id,
    title: world.title,
    focus: world.focus,
    description: world.description,
    status: world.status,
    createdAt: world.createdAt,
    updatedAt: world.updatedAt,
    hasNarrative: Boolean(world?.narrativeJson),
    isStarted: started,
    masteryPercent: calculateMasteryPercent(concepts, progress, world?.quests ?? []),
    questProgress: {
      completed: progress.filter((entry) => entry.status === 'COMPLETED' || entry.completedAt).length,
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
        locked: isWorldStarted(world),
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

function calculateMasteryPercent(concepts, progress = [], quests = []) {
  const hasConcepts = Array.isArray(concepts) && concepts.length > 0;
  const hasProgress = Array.isArray(progress) && progress.length > 0;

  if (!hasConcepts && !hasProgress) {
    return 0;
  }

  const conceptAverage = hasConcepts
    ? concepts.reduce((sum, concept) => sum + (Number(concept.masteryScore) || 0), 0) / concepts.length
    : 0;

  const totalQuestSteps = hasProgress
    ? progress.reduce((sum, entry) => {
      const matchingQuest = Array.isArray(quests) ? quests.find((quest) => quest.id === entry.questId) : null;
      const challenge = matchingQuest?.challengeJson || null;
      const stepCount = flattenQuestSteps(challenge).length;
      return sum + stepCount;
    }, 0)
    : 0;
  const completedSteps = hasProgress
    ? progress.reduce((sum, entry) => sum + Math.max(0, Number(entry.score) || 0), 0)
    : 0;
  const progressAverage = totalQuestSteps > 0
    ? Math.min(100, Math.round((completedSteps / totalQuestSteps) * 100))
    : 0;

  if (hasProgress && progress.every((entry) => entry.completedAt || entry.status === 'COMPLETED')) {
    return 100;
  }

  return Math.max(Math.round(conceptAverage), progressAverage);
}

function isWorldStarted(world) {
  const character = world?.characters?.[0];
  if (!character) return false;
  if ((character.xp ?? 0) > 0 || (character.level ?? 1) > 1) return true;

  const progress = Array.isArray(character.progress) ? character.progress : [];
  return progress.some((entry) =>
    (entry.attempts ?? 0) > 0 ||
    (entry.score ?? 0) > 0 ||
    entry.status === 'IN_PROGRESS' ||
    entry.status === 'COMPLETED' ||
    entry.completedAt
  );
}

function buildPlayState(world, requestedQuestId = '') {
  const bundle = getQuestBundle(world, requestedQuestId);
  if (!bundle) return null;

  const scene = deriveSceneData(world, bundle);
  const encounter = bundle.quest.challengeJson?.finalEncounter ?? {};
  const progressSummary = {
    completedQuests: bundle.character.progress.filter((entry) => entry.status === 'COMPLETED' || entry.completedAt).length,
    totalQuests: world.quests.length,
    completedSteps: bundle.progress.score,
    totalSteps: bundle.steps.length,
  };

  return {
    world: {
      id: world.id,
      title: world.title,
      focus: world.focus,
      description: world.description,
      masteryPercent: calculateMasteryPercent(
        bundle.character.conceptMasteries,
        bundle.character.progress,
        world?.quests ?? []
      ),
    },
    character: {
      id: bundle.character.id,
      name: bundle.character.name,
      className: bundle.character.className,
      level: bundle.character.level,
      xp: bundle.character.xp,
      portraitUrl: buildPortraitUrl(bundle.character.name, 'adventurer-neutral'),
    },
    quest: {
      id: bundle.quest.id,
      title: bundle.quest.title,
      description: bundle.quest.description,
      learningGoal: bundle.quest.learningGoal,
      status: bundle.progress.status,
      currentStepIndex: bundle.currentStepIndex,
      totalSteps: bundle.steps.length,
      completed: bundle.currentStepIndex >= bundle.steps.length,
    },
    scene: {
      locationName: scene.locationName,
      title: scene.title,
      introText: scene.introText,
      environmentSeed: scene.environmentSeed,
      npcName: scene.npcName,
      npcPortraitUrl: buildPortraitUrl(scene.npcName, 'open-peeps'),
      dialogue: scene.dialogue,
    },
    practice: {
      totalSteps: Array.isArray(bundle.quest.challengeJson?.practiceSteps) ? bundle.quest.challengeJson.practiceSteps.length : 0,
    },
    finalEncounter: {
      name: encounter.name ?? `${bundle.quest.title} Trial`,
      summary: encounter.summary ?? 'A final test of what you learned in this region.',
      totalSteps: Array.isArray(encounter.steps) ? encounter.steps.length : 0,
    },
    currentStep: bundle.steps[bundle.currentStepIndex] ?? null,
    steps: bundle.steps.map((step, index) => ({
      id: step.id,
      phase: step.phase,
      label: step.phase === 'final' ? `Encounter ${index + 1}` : `Practice ${index + 1}`,
      completed: index < bundle.currentStepIndex,
      current: index === bundle.currentStepIndex,
    })),
    map: buildQuestMap(world, bundle.character, bundle.quest.id),
    progressSummary,
    nextQuest: bundle.nextQuest
      ? {
        id: bundle.nextQuest.id,
        title: bundle.nextQuest.title,
      }
      : null,
    canAnswer: bundle.currentStepIndex < bundle.steps.length,
  };
}

function getQuestBundle(world, requestedQuestId = '') {
  const character = world?.characters?.[0];
  if (!character) return null;

  const progressByQuestId = new Map(character.progress.map((entry) => [entry.questId, entry]));
  const accessibleQuestIds = character.progress
    .filter((entry) => entry.status !== 'LOCKED')
    .map((entry) => entry.questId);

  const questId = requestedQuestId && accessibleQuestIds.includes(requestedQuestId)
    ? requestedQuestId
    : character.currentQuestId
      || character.progress.find((entry) => entry.status === 'AVAILABLE' || entry.status === 'IN_PROGRESS')?.questId
      || character.progress.find((entry) => entry.status !== 'COMPLETED')?.questId
      || character.progress.find((entry) => entry.status === 'COMPLETED')?.questId;

  if (!questId) return null;

  const questRecord = world.quests.find((entry) => entry.id === questId);
  const progress = progressByQuestId.get(questId);
  if (!questRecord || !progress) return null;

  const challengeJson = ensureQuestChallenge(world, questRecord);
  const quest = {
    ...questRecord,
    challengeJson,
  };
  const steps = flattenQuestSteps(challengeJson);
  const currentStepIndex = Math.min(progress.score ?? 0, steps.length);

  return {
    world,
    character,
    quest,
    progress,
    steps,
    currentStepIndex,
    nextQuest: world.quests.find((entry) => entry.sortOrder > quest.sortOrder)
      ? {
        ...world.quests.find((entry) => entry.sortOrder > quest.sortOrder),
      }
      : null,
  };
}

function ensureQuestChallenge(world, quest) {
  if (quest.challengeJson) {
    return quest.challengeJson;
  }

  const conceptPool = buildConceptPool(world.generatedJson?.structured ?? world.generatedJson ?? {});
  return buildQuestChallengeSequence({
    level: { name: quest.levelName, overview: quest.learningGoal },
    quest: quest.generatedJson ?? { title: quest.title, description: quest.description },
    questIndex: quest.sortOrder ?? 0,
    conceptPool,
  });
}

function flattenQuestSteps(challengeJson) {
  if (!challengeJson) return [];
  const practiceSteps = Array.isArray(challengeJson.practiceSteps) ? challengeJson.practiceSteps : [];
  const finalSteps = Array.isArray(challengeJson.finalEncounter?.steps) ? challengeJson.finalEncounter.steps : [];
  return [...practiceSteps, ...finalSteps];
}

function buildQuestMap(world, character, selectedQuestId) {
  const progressByQuestId = new Map(character.progress.map((entry) => [entry.questId, entry]));
  return world.quests
    .slice()
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map((quest) => {
      const progress = progressByQuestId.get(quest.id);
      const status = progress?.status ?? 'LOCKED';
      const region = getNarrativeRegionForQuest(world, quest);
      const scene = ensureQuestChallenge(world, quest)?.scene ?? {};
      return {
        id: quest.id,
        title: quest.title,
        locationName: region?.name || scene.locationName || quest.levelName || quest.title,
        questHook: region?.questHook || quest.description || '',
        status,
        selected: quest.id === selectedQuestId,
        accessible: status !== 'LOCKED',
        completed: status === 'COMPLETED',
      };
    });
}

function deriveSceneData(world, bundle) {
  const baseScene = bundle.quest.challengeJson?.scene ?? {};
  const region = getNarrativeRegionForQuest(world, bundle.quest);
  const encounter = getNarrativeEncounterForQuest(world, bundle.quest);
  const concepts = collectSceneConcepts(bundle.steps);

  return {
    locationName: region?.name || baseScene.locationName || bundle.quest.levelName || 'Unknown Region',
    title: bundle.quest.title,
    introText: region?.questHook || baseScene.introText || bundle.quest.description || 'Your journey continues.',
    environmentSeed: `${world.id}-${(region?.name || baseScene.locationName || bundle.quest.title).replace(/\s+/g, '-')}`,
    npcName: region?.npc || baseScene.npcName || 'Guide',
    dialogue: buildSceneDialogueForPlay({
      world,
      quest: bundle.quest,
      baseScene,
      region,
      encounter,
      concepts,
    }),
  };
}

function getNarrativeRegionForQuest(world, quest) {
  const regions = Array.isArray(world?.narrativeJson?.narrative?.regions)
    ? world.narrativeJson.narrative.regions
    : Array.isArray(world?.narrativeJson?.regions)
      ? world.narrativeJson.regions
      : [];
  if (!regions.length) return null;

  const sortedQuests = world.quests.slice().sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
  const index = sortedQuests.findIndex((entry) => entry.id === quest.id);
  return regions[index % regions.length] ?? regions[0];
}

function getNarrativeEncounterForQuest(world, quest) {
  const encounters = Array.isArray(world?.narrativeJson?.narrative?.encounters)
    ? world.narrativeJson.narrative.encounters
    : Array.isArray(world?.narrativeJson?.encounters)
      ? world.narrativeJson.encounters
      : [];
  if (!encounters.length) return null;

  const sortedQuests = world.quests.slice().sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
  const index = sortedQuests.findIndex((entry) => entry.id === quest.id);
  return encounters[index % encounters.length] ?? encounters[0];
}

function collectSceneConcepts(steps) {
  const concepts = [];
  for (const step of steps) {
    for (const concept of step.relatedConcepts ?? []) {
      if (!concepts.includes(concept)) {
        concepts.push(concept);
      }
    }
  }
  return concepts.slice(0, 4);
}

function buildSceneDialogueForPlay({ world, quest, baseScene, region, encounter, concepts }) {
  const npcName = formatNarrativeValue(region?.npc) || formatNarrativeValue(baseScene.npcName) || 'Guide';
  const protagonistName = 'You';
  const worldIntro = formatNarrativeValue(world?.narrativeJson?.narrative?.introduction)
    || formatNarrativeValue(world?.narrativeJson?.introduction)
    || `This world is built around ${world.title}.`;
  const hook = formatNarrativeValue(region?.questHook) || formatNarrativeValue(baseScene.introText) || quest.description || `The path through ${quest.title} is uncertain.`;
  const mechanics = formatNarrativeValue(encounter?.mechanic) || 'a layered knowledge trial';
  const reward = formatNarrativeValue(encounter?.reward);
  const regionName = formatNarrativeValue(region?.name) || formatNarrativeValue(baseScene.locationName) || quest.levelName || quest.title;

  const lines = [
    {
      speaker: npcName,
      role: 'npc',
      text: `${worldIntro} Here in ${regionName}, ${hook}`,
    },
    {
      speaker: protagonistName,
      role: 'player',
      text: 'Before I step into the encounter, help me understand what actually matters here.',
    },
  ];

  concepts.slice(0, 3).forEach((concept, index) => {
    const conceptRecord = world.concepts.find((entry) => entry.name.toLowerCase() === String(concept).toLowerCase());
    lines.push({
      speaker: npcName,
      role: 'npc',
      text: buildTeachingLine({
        concept: {
          term: conceptRecord?.name || concept,
          description: conceptRecord?.description || `${concept} is one of the ideas this region was built around.`,
        },
        questTitle: quest.title,
        locationName: regionName,
        questDescription: hook,
        emphasis: index === 0 ? 'foundation' : index === 1 ? 'connection' : 'warning',
      }),
    });
  });

  lines.push({
    speaker: npcName,
    role: 'npc',
    text: `When the trial begins, expect ${mechanics}. ${reward ? `If you succeed, you earn ${reward}.` : ''}`.trim(),
  });
  lines.push({
    speaker: protagonistName,
    role: 'player',
    text: `Got it. I need to read the situation, not just memorize a definition. Let me practice the ideas first, then I’ll face the final encounter.`,
  });

  return lines;
}

function formatNarrativeValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((entry) => formatNarrativeValue(entry)).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const preferredKeys = ['name', 'title', 'description', 'benefit', 'mechanic', 'text', 'value'];
    for (const key of preferredKeys) {
      if (value[key]) return formatNarrativeValue(value[key]);
    }
    return Object.values(value).filter((entry) => typeof entry !== 'object' && entry !== null && entry !== undefined).join(' - ');
  }
  return '';
}

async function applyMasteryDelta(tx, characterId, concepts, relatedConcepts, masteryDelta) {
  const normalized = new Set(relatedConcepts.map((concept) => concept.toLowerCase()));
  const matchingConcepts = concepts.filter((concept) => normalized.has(concept.name.toLowerCase()));

  for (const concept of matchingConcepts) {
    const mastery = await tx.conceptMastery.findUnique({
      where: {
        characterId_conceptId: {
          characterId,
          conceptId: concept.id,
        },
      },
    });

    if (!mastery) continue;

    await tx.conceptMastery.update({
      where: { id: mastery.id },
      data: {
        masteryScore: Math.min(100, (mastery.masteryScore ?? 0) + masteryDelta),
        timesPracticed: { increment: 1 },
        lastPracticedAt: new Date(),
      },
    });
  }
}

async function unlockNextQuest(tx, character, quests, completedQuest) {
  const nextQuest = quests.find((quest) => quest.sortOrder > completedQuest.sortOrder);
  if (!nextQuest) {
    await tx.character.update({
      where: { id: character.id },
      data: { currentQuestId: null },
    });
    return;
  }

  await tx.characterProgress.updateMany({
    where: {
      characterId: character.id,
      questId: nextQuest.id,
      status: 'LOCKED',
    },
    data: {
      status: 'AVAILABLE',
    },
  });

  await tx.character.update({
    where: { id: character.id },
    data: { currentQuestId: nextQuest.id },
  });
}

function buildPortraitUrl(seed, style = 'adventurer') {
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed || 'TextQuest')}`;
}

function normalizeAnswer(value) {
  return String(value ?? '').trim().toLowerCase();
}

function hasPlayableNarrative(world) {
  return Boolean(world?.narrativeJson?.narrative || world?.narrativeJson);
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
