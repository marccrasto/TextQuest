/**
 * Embeddings Manager
 * Provides similarity helpers with optional OpenAI-backed embeddings.
 */

const fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

class EmbeddingsManager {
  constructor(apiKey = null, method = 'openai') {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY;
    this.method = this.apiKey ? method : 'mock';
    this.embeddingsCache = new Map();
  }

  async getOpenAIEmbedding(text) {
    if (this.embeddingsCache.has(text)) {
      return this.embeddingsCache.get(text);
    }

    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          input: text,
          model: 'text-embedding-3-small',
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();
      const embedding = data?.data?.[0]?.embedding;
      if (!embedding) {
        throw new Error('OpenAI returned no embedding');
      }
      this.embeddingsCache.set(text, embedding);
      return embedding;
    } catch (error) {
      console.warn('Falling back to mock embedding:', error.message);
      return this.generateMockEmbedding(text);
    }
  }

  generateMockEmbedding(text) {
    const hash = this.simpleHash(text);
    const dim = 96;
    const embedding = [];

    let seed = hash;
    for (let i = 0; i < dim; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      embedding.push((seed / 233280) * 2 - 1);
    }

    return embedding;
  }

  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash &= hash;
    }
    return Math.abs(hash);
  }

  async getEmbeddings(texts) {
    if (this.method === 'openai') {
      return Promise.all(texts.map((text) => this.getOpenAIEmbedding(text)));
    }
    return texts.map((text) => this.generateMockEmbedding(text));
  }

  cosineSimilarity(embA, embB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < embA.length; i++) {
      dotProduct += embA[i] * embB[i];
      normA += embA[i] * embA[i];
      normB += embB[i] * embB[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async getSimilarityMatrix(texts) {
    const embeddings = await this.getEmbeddings(texts);
    const matrix = [];

    for (let i = 0; i < embeddings.length; i++) {
      const row = [];
      for (let j = 0; j < embeddings.length; j++) {
        row.push(this.cosineSimilarity(embeddings[i], embeddings[j]));
      }
      matrix.push(row);
    }

    return { embeddings, matrix };
  }
}

module.exports = EmbeddingsManager;
