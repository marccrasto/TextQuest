/**
 * Topic Clustering Module
 * Performs K-means clustering on embeddings to discover topic groups
 */

class TopicClusterer {
  /**
   * K-means clustering algorithm
   */
  static kmeans(embeddings, k = 5, maxIterations = 10) {
    if (embeddings.length === 0) return { clusters: [], centroids: [] };
    if (k > embeddings.length) k = embeddings.length;

    const dim = embeddings[0].length;
    let centroids = this.initializeCentroids(embeddings, k, dim);
    let clusters = [];
    let assignments = new Array(embeddings.length).fill(0);

    for (let iter = 0; iter < maxIterations; iter++) {
      // Assign points to nearest centroid
      const newAssignments = embeddings.map((emb, idx) => {
        let minDist = Infinity;
        let bestCluster = 0;

        for (let c = 0; c < k; c++) {
          const dist = this.euclideanDistance(emb, centroids[c]);
          if (dist < minDist) {
            minDist = dist;
            bestCluster = c;
          }
        }

        return bestCluster;
      });

      // Check for convergence
      if (this.assignmentsEqual(assignments, newAssignments)) {
        assignments = newAssignments;
        break;
      }

      assignments = newAssignments;

      // Recompute centroids
      const newCentroids = Array(k)
        .fill(null)
        .map(() => Array(dim).fill(0));
      const counts = Array(k).fill(0);

      embeddings.forEach((emb, idx) => {
        const cluster = assignments[idx];
        counts[cluster]++;
        emb.forEach((val, d) => {
          newCentroids[cluster][d] += val;
        });
      });

      centroids = newCentroids.map((centroid, c) => {
        if (counts[c] === 0) return centroid;
        return centroid.map(val => val / counts[c]);
      });
    }

    // Build cluster groups
    clusters = Array(k)
      .fill(null)
      .map(() => []);
    assignments.forEach((cluster, idx) => {
      clusters[cluster].push(idx);
    });

    return {
      clusters: clusters.filter(c => c.length > 0),
      assignments,
      centroids,
    };
  }

  /**
   * Initialize centroids using k-means++
   */
  static initializeCentroids(embeddings, k, dim) {
    const centroids = [];
    
    // Pick first centroid randomly
    centroids.push(embeddings[Math.floor(Math.random() * embeddings.length)]);

    // Pick remaining k-1 centroids with probability proportional to distance squared
    for (let i = 1; i < k; i++) {
      const distances = embeddings.map(emb => {
        let minDist = Infinity;
        centroids.forEach(centroid => {
          const dist = this.euclideanDistance(emb, centroid);
          minDist = Math.min(minDist, dist);
        });
        return minDist * minDist;
      });

      const totalDist = distances.reduce((a, b) => a + b, 0);
      let random = Math.random() * totalDist;

      for (let j = 0; j < embeddings.length; j++) {
        random -= distances[j];
        if (random <= 0) {
          centroids.push(embeddings[j]);
          break;
        }
      }
    }

    return centroids;
  }

  /**
   * Euclidean distance between two vectors
   */
  static euclideanDistance(vecA, vecB) {
    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
      const diff = vecA[i] - vecB[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * Check if two assignment arrays are equal
   */
  static assignmentsEqual(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
      if (arr1[i] !== arr2[i]) return false;
    }
    return true;
  }

  /**
   * Calculate topic coherence using similarity within clusters
   */
  static calculateClusterCoherence(embeddings, clusters, embeddingsManager) {
    return clusters.map(cluster => {
      if (cluster.length <= 1) return 1.0;

      let totalSimilarity = 0;
      let count = 0;

      for (let i = 0; i < cluster.length; i++) {
        for (let j = i + 1; j < cluster.length; j++) {
          const sim = embeddingsManager.cosineSimilarity(
            embeddings[cluster[i]],
            embeddings[cluster[j]]
          );
          totalSimilarity += sim;
          count++;
        }
      }

      return count > 0 ? totalSimilarity / count : 0;
    });
  }
}

module.exports = TopicClusterer;
