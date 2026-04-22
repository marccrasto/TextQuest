/**
 * Enhanced API Server with Topic Graph Generation
 * Integrates Groq AI, Embeddings, Clustering, and Graph Persistence
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const TopicGraphGenerator = require('./lib/graphGenerator');
const EmbeddingsManager = require('./lib/embeddings');
const GraphPersistence = require('./lib/persistence');

const fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize persistence and embeddings
const persistence = new GraphPersistence('./data/graphs');
const embeddingsManager = new EmbeddingsManager(OPENAI_API_KEY, 'openai');

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============ Health & Status ============

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    features: ['text-processing', 'topic-graphs', 'embeddings', 'clustering'],
  });
});

// ============ Topic Graph API ============

/**
 * POST /api/graphs/generate
 * Generate a topic graph from text using Groq AI analysis
 * 
 * Request body:
 * {
 *   text: string (required),
 *   title: string (optional),
 *   focus: string (optional),
 *   useEmbeddings: boolean (default: true),
 *   savePersistently: boolean (default: true)
 * }
 */
app.post('/api/graphs/generate', async (req, res) => {
  try {
    const {
      text,
      title = 'Untitled Textbook',
      focus = 'general',
      useEmbeddings = true,
      savePersistently = true,
    } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Step 1: Analyze text with Groq AI
    console.log('Step 1: Analyzing text with Groq AI...');
    const groqAnalysis = await analyzeWithGroq(text, title, focus);

    if (!groqAnalysis) {
      return res.status(500).json({
        error: 'Failed to analyze text with Groq AI',
      });
    }

    // Step 2: Generate topic graph with embeddings and clustering
    console.log('Step 2: Generating topic graph with embeddings...');
    const generator = new TopicGraphGenerator(groqAnalysis, embeddingsManager);
    const topicGraph = await generator.generateGraph();

    // Step 3: Optionally persist the graph
    let persistenceResult = null;
    if (savePersistently) {
      console.log('Step 3: Persisting graph...');
      persistenceResult = await persistence.saveGraph(topicGraph, title, {
        focus,
        textLength: text.length,
        useEmbeddings,
      });
    }

    res.json({
      success: true,
      message: 'Topic graph generated successfully',
      graph: topicGraph,
      analysis: groqAnalysis,
      persistence: persistenceResult,
    });
  } catch (error) {
    console.error('Error generating topic graph:', error);
    res.status(500).json({
      error: 'Failed to generate topic graph',
      details: error.message,
    });
  }
});

/**
 * GET /api/graphs/list
 * List all saved topic graphs
 */
app.get('/api/graphs/list', async (_req, res) => {
  try {
    const graphs = await persistence.listGraphs();
    res.json({
      success: true,
      count: graphs.length,
      graphs,
    });
  } catch (error) {
    console.error('Error listing graphs:', error);
    res.status(500).json({ error: 'Failed to list graphs' });
  }
});

/**
 * GET /api/graphs/:filename
 * Load a specific saved graph
 */
app.get('/api/graphs/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const graph = await persistence.loadGraph(filename);
    res.json({
      success: true,
      graph,
    });
  } catch (error) {
    console.error('Error loading graph:', error);
    res.status(404).json({ error: 'Graph not found' });
  }
});

/**
 * GET /api/graphs/:filename/export
 * Export a graph to alternative format
 * Query param: format (json, cytoscape, gexf, csv)
 */
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

    res.send(exported);
  } catch (error) {
    console.error('Error exporting graph:', error);
    res.status(500).json({ error: 'Failed to export graph' });
  }
});

/**
 * DELETE /api/graphs/:filename
 * Delete a saved graph
 */
app.delete('/api/graphs/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const result = await persistence.deleteGraph(filename);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error deleting graph:', error);
    res.status(500).json({ error: 'Failed to delete graph' });
  }
});

// ============ Embeddings API ============

/**
 * POST /api/embeddings/generate
 * Generate embeddings for a list of texts
 */
app.post('/api/embeddings/generate', async (req, res) => {
  try {
    const { texts } = req.body;

    if (!Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({ error: 'texts array is required' });
    }

    const embeddings = await embeddingsManager.getEmbeddings(texts);

    res.json({
      success: true,
      count: embeddings.length,
      embeddings: texts.map((text, idx) => ({
        text,
        embedding: embeddings[idx],
      })),
    });
  } catch (error) {
    console.error('Error generating embeddings:', error);
    res.status(500).json({
      error: 'Failed to generate embeddings',
      details: error.message,
    });
  }
});

/**
 * POST /api/embeddings/similarity
 * Calculate similarity between texts
 */
app.post('/api/embeddings/similarity', async (req, res) => {
  try {
    const { texts } = req.body;

    if (!Array.isArray(texts) || texts.length < 2) {
      return res.status(400).json({
        error: 'At least 2 texts required for similarity calculation',
      });
    }

    const { embeddings, matrix } = await embeddingsManager.getSimilarityMatrix(texts);

    res.json({
      success: true,
      texts,
      similarityMatrix: matrix,
      pairwiseSimilarities: texts
        .slice(0, -1)
        .flatMap((text1, i) =>
          texts.slice(i + 1).map((text2, j) => ({
            text1,
            text2,
            similarity: parseFloat(matrix[i][i + j + 1].toFixed(3)),
          }))
        ),
    });
  } catch (error) {
    console.error('Error calculating similarity:', error);
    res.status(500).json({
      error: 'Failed to calculate similarity',
      details: error.message,
    });
  }
});

// ============ Helper Functions ============

/**
 * Analyze text with Groq AI
 */
async function analyzeWithGroq(text, title, focus) {
  if (!GROQ_API_KEY) {
    console.warn('GROQ_API_KEY not set, using mock analysis');
    return createMockAnalysis(text, title, focus);
  }

  try {
    const bookExcerpt = text.trim().slice(0, 5000);
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are a TextQuest AI that analyzes educational texts and extracts structured learning content. Respond ONLY with valid JSON.',
          },
          {
            role: 'user',
            content: `Analyze this educational text about ${focus}. Extract concepts, vocabulary, topics, and learning structure.\n\nText:\n"""${bookExcerpt}"""\n\nReturn JSON with: {vocabulary: [{term, type, description}], levels: [{name, overview, quests: [{title, description, items, abilities, dependencies}]}], keyTopics: [string], complexity: number}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return createMockAnalysis(text, title, focus);
  } catch (error) {
    console.error('Groq API error:', error.message);
    return createMockAnalysis(text, title, focus);
  }
}

/**
 * Create mock analysis for testing/fallback
 */
function createMockAnalysis(text, title, focus) {
  const words = text.toLowerCase().split(/\s+/);
  const uniqueWords = [...new Set(words)].slice(0, 15);

  return {
    title,
    focus,
    vocabulary: uniqueWords.map((word, idx) => ({
      term: word.charAt(0).toUpperCase() + word.slice(1),
      type: idx % 3 === 0 ? 'concept' : idx % 3 === 1 ? 'skill' : 'item',
      description: `Key term from ${title}`,
    })),
    levels: [
      {
        name: `Introduction to ${focus}`,
        overview: `Learn the fundamentals of ${focus}`,
        quests: [
          {
            title: 'First Steps',
            description: 'Begin your journey',
            items: ['Basic Guide'],
            abilities: ['Observe'],
            dependencies: [],
          },
        ],
      },
      {
        name: `Advanced ${focus}`,
        overview: `Deepen your understanding`,
        quests: [
          {
            title: 'Master the Craft',
            description: 'Become proficient',
            items: ['Expert Manual'],
            abilities: ['Analyze'],
            dependencies: ['First Steps'],
          },
        ],
      },
    ],
    keyTopics: [focus, 'learning', 'concepts'],
    complexity: Math.min(5, Math.ceil(words.length / 100)),
  };
}

// ============ Server Start ============

app.listen(PORT, () => {
  console.log(`\n🚀 Enhanced TextQuest RPG Server running on http://localhost:${PORT}`);
  console.log(`📊 Topic Graph API: POST /api/graphs/generate`);
  console.log(`📈 Embeddings API: POST /api/embeddings/generate`);
  console.log(`💾 Graph List: GET /api/graphs/list`);
  console.log(`\n✨ Features enabled:`);
  console.log(`  - Groq AI text analysis`);
  console.log(`  - Embedding generation (${OPENAI_API_KEY ? 'OpenAI' : 'Mock'})`);
  console.log(`  - Topic clustering & graph generation`);
  console.log(`  - Persistent storage & export\n`);
});

module.exports = app;
