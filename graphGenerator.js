/**
 * Topic Graph Generator
 * Builds a knowledge graph from concepts with edges, embeddings, and difficulty tiers
 */

const EmbeddingsManager = require('./embeddings');
const TopicClusterer = require('./clustering');

class TopicGraphGenerator {
  constructor(groqAnalysis, embeddingsManager = null) {
    this.groqAnalysis = groqAnalysis;
    this.embeddingsManager = embeddingsManager || new EmbeddingsManager();
    this.graph = null;
  }

  /**
   * Generate complete topic graph from Groq analysis
   */
  async generateGraph() {
    // Extract concepts from Groq analysis
    const concepts = this.extractConcepts(this.groqAnalysis);
    
    if (concepts.length === 0) {
      return this.createEmptyGraph();
    }

    // Generate embeddings for all concepts
    const conceptTexts = concepts.map(c => c.name);
    const { embeddings, matrix } = await this.embeddingsManager.getSimilarityMatrix(
      conceptTexts
    );

    // Perform topic clustering
    const numClusters = Math.max(2, Math.ceil(concepts.length / 3));
    const { clusters, assignments } = TopicClusterer.kmeans(embeddings, numClusters);

    // Calculate difficulty tiers based on concept relationships
    const difficultyTiers = this.calculateDifficultyTiers(concepts, matrix);

    // Build concept nodes
    const nodes = concepts.map((concept, idx) => ({
      id: `concept-${idx}`,
      name: concept.name,
      type: concept.type || 'concept',
      description: concept.description || '',
      embedding: embeddings[idx],
      topic: this.assignTopic(assignments[idx], clusters),
      difficulty: difficultyTiers[idx],
      metadata: {
        frequency: concept.frequency || 1,
        context: concept.context || [],
      },
    }));

    // Build edges based on similarity and dependencies
    const edges = this.generateEdges(nodes, matrix, concepts);

    this.graph = {
      timestamp: new Date().toISOString(),
      metadata: {
        totalConcepts: nodes.length,
        totalEdges: edges.length,
        topics: this.getTopicSummary(clusters, nodes),
        embeddingModel: this.embeddingsManager.method,
      },
      nodes,
      edges,
      clusters: this.formatClusters(clusters, nodes),
    };

    return this.graph;
  }

  /**
   * Extract concepts from Groq AI analysis
   */
  extractConcepts(analysis) {
    const concepts = [];

    // Extract from vocabulary
    if (analysis.vocabulary && Array.isArray(analysis.vocabulary)) {
      analysis.vocabulary.forEach(vocab => {
        concepts.push({
          name: vocab.term,
          type: vocab.type || 'vocabulary',
          description: vocab.description,
          frequency: 1,
        });
      });
    }

    // Extract from quests and levels
    if (analysis.levels && Array.isArray(analysis.levels)) {
      analysis.levels.forEach(level => {
        if (level.name) {
          concepts.push({
            name: level.name,
            type: 'chapter',
            description: level.overview || level.description,
            frequency: 2,
          });
        }

        if (level.quests && Array.isArray(level.quests)) {
          level.quests.forEach(quest => {
            if (quest.title) {
              concepts.push({
                name: quest.title,
                type: 'quest',
                description: quest.description,
                frequency: 1,
                context: quest.dependencies || [],
              });
            }

            // Extract items and abilities
            if (quest.items) {
              quest.items.forEach(item => {
                concepts.push({
                  name: item,
                  type: 'item',
                  description: `Item from ${quest.title}`,
                  frequency: 1,
                });
              });
            }

            if (quest.abilities) {
              quest.abilities.forEach(ability => {
                concepts.push({
                  name: ability,
                  type: 'ability',
                  description: `Ability from ${quest.title}`,
                  frequency: 1,
                });
              });
            }
          });
        }
      });
    }

    // Extract unique concepts
    const uniqueMap = new Map();
    concepts.forEach(concept => {
      if (!uniqueMap.has(concept.name)) {
        uniqueMap.set(concept.name, concept);
      }
    });

    return Array.from(uniqueMap.values());
  }

  /**
   * Calculate difficulty tiers for each concept
   * Based on dependencies and semantic complexity
   */
  calculateDifficultyTiers(concepts, similarityMatrix) {
    return concepts.map((concept, idx) => {
      // Base difficulty from concept type
      const typeBaseDifficulty = {
        chapter: 1,
        vocabulary: 1,
        quest: 2,
        ability: 2,
        item: 1,
        concept: 2,
      };

      let baseDifficulty = typeBaseDifficulty[concept.type] || 1;

      // Increase difficulty based on dependencies
      if (concept.context && concept.context.length > 0) {
        baseDifficulty += concept.context.length * 0.5;
      }

      // Decrease difficulty for high-frequency concepts
      baseDifficulty = baseDifficulty / Math.log(concept.frequency + 2);

      // Normalize to 1-5 scale
      const difficulty = Math.ceil(Math.max(1, Math.min(5, baseDifficulty)));

      return difficulty;
    });
  }

  /**
   * Generate edges based on similarity and explicit dependencies
   */
  generateEdges(nodes, similarityMatrix, concepts) {
    const edges = [];
    const threshold = 0.4; // Similarity threshold for creating edges

    // Add edges from similarity matrix
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const similarity = similarityMatrix[i][j];

        if (similarity > threshold) {
          edges.push({
            id: `edge-${i}-${j}`,
            source: nodes[i].id,
            target: nodes[j].id,
            weight: parseFloat(similarity.toFixed(3)),
            type: 'similarity',
          });
        }
      }
    }

    // Add edges from explicit dependencies
    nodes.forEach((node, idx) => {
      const concept = concepts[idx];
      if (concept.context && Array.isArray(concept.context)) {
        concept.context.forEach(dep => {
          const depNode = nodes.find(n => n.name.toLowerCase() === dep.toLowerCase());
          if (depNode && depNode.id !== node.id) {
            const existingEdge = edges.find(
              e => (e.source === node.id && e.target === depNode.id) ||
                   (e.source === depNode.id && e.target === node.id)
            );

            if (!existingEdge) {
              edges.push({
                id: `edge-${idx}-${nodes.indexOf(depNode)}`,
                source: node.id,
                target: depNode.id,
                weight: 1.0,
                type: 'dependency',
              });
            }
          }
        });
      }
    });

    return edges;
  }

  /**
   * Assign topic names to clusters
   */
  assignTopic(clusterIdx, clusters) {
    const topicNames = [
      'Foundations',
      'Core Concepts',
      'Advanced Topics',
      'Applications',
      'Extensions',
    ];

    return topicNames[clusterIdx % topicNames.length];
  }

  /**
   * Generate summary of topics
   */
  getTopicSummary(clusters, nodes) {
    const topics = {};

    clusters.forEach((cluster, idx) => {
      const topicName = this.assignTopic(idx, clusters);
      const topicNodes = cluster.map(nodeIdx => nodes[nodeIdx]);

      topics[topicName] = {
        nodeCount: topicNodes.length,
        avgDifficulty:
          topicNodes.reduce((sum, n) => sum + n.difficulty, 0) / topicNodes.length,
        types: [...new Set(topicNodes.map(n => n.type))],
      };
    });

    return topics;
  }

  /**
   * Format clusters for output
   */
  formatClusters(clusters, nodes) {
    return clusters.map((cluster, idx) => ({
      id: `cluster-${idx}`,
      name: this.assignTopic(idx, clusters),
      nodes: cluster.map(nodeIdx => nodes[nodeIdx].id),
      size: cluster.length,
    }));
  }

  /**
   * Create empty graph structure
   */
  createEmptyGraph() {
    return {
      timestamp: new Date().toISOString(),
      metadata: {
        totalConcepts: 0,
        totalEdges: 0,
        topics: {},
        embeddingModel: this.embeddingsManager.method,
      },
      nodes: [],
      edges: [],
      clusters: [],
    };
  }

  /**
   * Get the generated graph
   */
  getGraph() {
    return this.graph;
  }
}

module.exports = TopicGraphGenerator;
