const express = require('express');
const multer = require('multer');
const fs = require('fs');
const pdfParse = require('pdf-parse')
const cors = require('cors');
const path = require('path');
const { execSync } = require('child_process');
const pdfToImages = require('./pdfToImages');
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
  });
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

app.post('/api/process', async (req, res) => {
  const { text, title = 'Untitled Textbook', focus = 'biology' } = req.body ?? {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Text is required' });
  }

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
    const { content, usage } = await callGroq(messages, { responseFormat: 'json_object', retry: { maxRetries: 3 } });

    const structured = safeJSON(content);
    const responsePayload = { title, structured: structured ?? { raw: content }, usage, via: 'groq' };

    if (!structured) { responsePayload.warnings = ['GROQ_PARSE_ERROR']; }

    return res.json(responsePayload);
  }
  catch (error) {
    if (isMissingKeyError(error)) {
      return res.json({ title, structured: sampleStructure, via: 'mock', message: 'Set GROQ_API_KEY to replace mock data.' });
    }

    if (error instanceof GroqError) {
      console.error('[process] GroqError', { type: error.type, status: error.status });

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
    console.error('[process] Failed', error);
    return res.status(500).json({ error: 'Failed to build RPG structure', code: 'UNKNOWN_SERVER_ERROR' });
  }
});

app.post('/api/narrative', async (req, res) => {
  const { structured, learningGoal = 'Keep the player curious about the topic.' } = req.body ?? {};
  if (!structured) {
    return res.status(400).json({ error: 'Structured RPG data is required' });
  }

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
    const { content, usage } = await callGroq(messages, { responseFormat: 'json_object', retry: { maxRetries: 3 } });
    const narrative = safeJSON(content);
    const responsePayload = { narrative: narrative ?? { raw: content }, usage, via: 'groq' };

    if (!narrative) {
      responsePayload.warnings = ['GROQ_PARSE_ERROR'];
    }

    return res.json(responsePayload);
  }
  catch (error) {
    if (isMissingKeyError(error)) {
      return res.json({
        narrative: sampleNarrative,
        via: 'mock',
        message: 'Set GROQ_API_KEY to replace mock data.',
      });
    }

    if (error instanceof GroqError) {
      console.error(
        '[narrative] GroqError',
        { type: error.type, status: error.status }
      );

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

    console.error('[narrative] Failed', error);
    return res.status(500).json({ error: 'Failed to craft narrative content', code: 'UNKNOWN_SERVER_ERROR' });
  }
});


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

app.post('/upload', upload.single('uploadFile'), async (req, res) => {
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



app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
