/**
 * Builds a concept graph from structured TextQuest data.
 */

const EmbeddingsManager = require('./embeddings');
const TopicClusterer = require('./clustering');

class TopicGraphGenerator {
  constructor(groqAnalysis, embeddingsManager = null) {
    this.groqAnalysis = groqAnalysis || {};
    this.embeddingsManager = embeddingsManager || new EmbeddingsManager();
    this.graph = null;
  }

  async generateGraph() {
    const concepts = this.extractConcepts(this.groqAnalysis);

    if (concepts.length === 0) {
      this.graph = this.createEmptyGraph();
      return this.graph;
    }

    const conceptTexts = concepts.map((c) => c.name);
    const { embeddings, matrix } = await this.embeddingsManager.getSimilarityMatrix(conceptTexts);

    const numClusters = Math.max(2, Math.ceil(concepts.length / 3));
    const { clusters, assignments } = TopicClusterer.kmeans(embeddings, numClusters);

    const difficultyTiers = this.calculateDifficultyTiers(concepts);

    const nodes = concepts.map((concept, idx) => ({
      id: `concept-${idx}`,
      name: concept.name,
      type: concept.type || 'concept',
      description: concept.description || '',
      embedding: embeddings[idx],
      topic: this.assignTopic(assignments[idx], clusters.length),
      difficulty: difficultyTiers[idx],
      metadata: {
        frequency: concept.frequency || 1,
        context: concept.context || [],
      },
    }));

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

  extractConcepts(analysis) {
    const concepts = [];

    if (analysis.vocabulary && Array.isArray(analysis.vocabulary)) {
      analysis.vocabulary.forEach((vocab) => {
        concepts.push({
          name: vocab.term,
          type: vocab.type || 'vocabulary',
          description: vocab.description,
          frequency: 1,
        });
      });
    }

    if (analysis.levels && Array.isArray(analysis.levels)) {
      analysis.levels.forEach((level) => {
        if (level.name) {
          concepts.push({
            name: level.name,
            type: 'chapter',
            description: level.overview || level.description,
            frequency: 2,
          });
        }

        if (level.quests && Array.isArray(level.quests)) {
          level.quests.forEach((quest) => {
            if (quest.title) {
              concepts.push({
                name: quest.title,
                type: 'quest',
                description: quest.description,
                frequency: 1,
                context: quest.dependencies || [],
              });
            }

            if (quest.items) {
              quest.items.forEach((item) => {
                concepts.push({
                  name: item,
                  type: 'item',
                  description: `Item from ${quest.title}`,
                  frequency: 1,
                });
              });
            }

            if (quest.abilities) {
              quest.abilities.forEach((ability) => {
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

    const uniqueMap = new Map();
    concepts.forEach((concept) => {
      if (!uniqueMap.has(concept.name)) {
        uniqueMap.set(concept.name, concept);
      }
    });

    return Array.from(uniqueMap.values());
  }

  calculateDifficultyTiers(concepts) {
    return concepts.map((concept) => {
      const typeBaseDifficulty = {
        chapter: 1,
        vocabulary: 1,
        quest: 2,
        ability: 2,
        item: 1,
        concept: 2,
      };

      let baseDifficulty = typeBaseDifficulty[concept.type] || 1;

      if (concept.context && concept.context.length > 0) {
        baseDifficulty += concept.context.length * 0.5;
      }

      baseDifficulty = baseDifficulty / Math.log(concept.frequency + 2);
      return Math.ceil(Math.max(1, Math.min(5, baseDifficulty)));
    });
  }

  generateEdges(nodes, similarityMatrix, concepts) {
    const edges = [];
    const threshold = 0.4;

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

    nodes.forEach((node, idx) => {
      const concept = concepts[idx];
      if (concept.context && Array.isArray(concept.context)) {
        concept.context.forEach((dep) => {
          const depNode = nodes.find((n) => n.name.toLowerCase() === dep.toLowerCase());
          if (depNode && depNode.id !== node.id) {
            const existingEdge = edges.find(
              (e) =>
                (e.source === node.id && e.target === depNode.id) ||
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

  assignTopic(clusterIdx, clusterCount) {
    const topicNames = ['Foundations', 'Core Concepts', 'Advanced Topics', 'Applications', 'Extensions'];
    if (clusterCount === 0) return topicNames[0];
    return topicNames[clusterIdx % topicNames.length];
  }

  getTopicSummary(clusters, nodes) {
    const topics = {};

    clusters.forEach((cluster, idx) => {
      const topicName = this.assignTopic(idx, clusters.length);
      const topicNodes = cluster.map((nodeIdx) => nodes[nodeIdx]);

      topics[topicName] = {
        nodeCount: topicNodes.length,
        avgDifficulty: topicNodes.reduce((sum, n) => sum + n.difficulty, 0) / topicNodes.length,
        types: [...new Set(topicNodes.map((n) => n.type))],
      };
    });

    return topics;
  }

  formatClusters(clusters, nodes) {
    return clusters.map((cluster, idx) => ({
      id: `cluster-${idx}`,
      name: this.assignTopic(idx, clusters.length),
      nodes: cluster.map((nodeIdx) => nodes[nodeIdx].id),
      size: cluster.length,
    }));
  }

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

  getGraph() {
    return this.graph;
  }
}

module.exports = TopicGraphGenerator;
