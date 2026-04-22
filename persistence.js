/**
 * Graph Persistence Module
 * Handles saving and loading topic graphs from filesystem
 */

const fs = require('fs').promises;
const path = require('path');

class GraphPersistence {
  constructor(dataDir = './data/graphs') {
    this.dataDir = dataDir;
    this.initializeDirectory();
  }

  /**
   * Initialize data directory if it doesn't exist
   */
  async initializeDirectory() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      console.error('Error initializing graph data directory:', error);
    }
  }

  /**
   * Generate a unique filename for the graph
   */
  generateFilename(title, timestamp = null) {
    const sanitized = (title || 'untitled')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50);

    const ts = timestamp || Date.now();
    return `graph-${sanitized}-${ts}.json`;
  }

  /**
   * Save graph to filesystem
   */
  async saveGraph(graph, title, metadata = {}) {
    try {
      await this.initializeDirectory();

      const filename = this.generateFilename(title, graph.timestamp);
      const filepath = path.join(this.dataDir, filename);

      const fullData = {
        ...graph,
        persistenceMetadata: {
          savedAt: new Date().toISOString(),
          title,
          version: '1.0',
          ...metadata,
        },
      };

      await fs.writeFile(filepath, JSON.stringify(fullData, null, 2));

      console.log(`Graph saved to ${filepath}`);
      return {
        success: true,
        filepath,
        filename,
      };
    } catch (error) {
      console.error('Error saving graph:', error);
      throw error;
    }
  }

  /**
   * Load graph from filesystem by filename
   */
  async loadGraph(filename) {
    try {
      const filepath = path.join(this.dataDir, filename);
      const data = await fs.readFile(filepath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error loading graph ${filename}:`, error);
      throw error;
    }
  }

  /**
   * List all saved graphs
   */
  async listGraphs() {
    try {
      await this.initializeDirectory();
      const files = await fs.readdir(this.dataDir);

      const graphs = await Promise.all(
        files
          .filter(f => f.startsWith('graph-') && f.endsWith('.json'))
          .map(async filename => {
            try {
              const data = await this.loadGraph(filename);
              return {
                filename,
                title: data.persistenceMetadata?.title || 'Unknown',
                timestamp: data.timestamp,
                concepts: data.metadata?.totalConcepts || 0,
                edges: data.metadata?.totalEdges || 0,
              };
            } catch (error) {
              console.warn(`Failed to load graph info for ${filename}`);
              return null;
            }
          })
      );

      return graphs.filter(g => g !== null).sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
      );
    } catch (error) {
      console.error('Error listing graphs:', error);
      return [];
    }
  }

  /**
   * Delete a saved graph
   */
  async deleteGraph(filename) {
    try {
      const filepath = path.join(this.dataDir, filename);
      await fs.unlink(filepath);
      return { success: true, message: `Deleted ${filename}` };
    } catch (error) {
      console.error(`Error deleting graph ${filename}:`, error);
      throw error;
    }
  }

  /**
   * Export graph to alternative formats
   */
  async exportGraph(filename, format = 'json') {
    try {
      const graph = await this.loadGraph(filename);

      switch (format.toLowerCase()) {
        case 'cytoscape':
          return this.toCytoscapeFormat(graph);
        case 'gexf':
          return this.toGEXFFormat(graph);
        case 'csv':
          return this.toCSVFormat(graph);
        default:
          return graph;
      }
    } catch (error) {
      console.error(`Error exporting graph to ${format}:`, error);
      throw error;
    }
  }

  /**
   * Convert graph to Cytoscape.js format
   */
  toCytoscapeFormat(graph) {
    const elements = [];

    // Add nodes
    graph.nodes.forEach(node => {
      elements.push({
        data: {
          id: node.id,
          label: node.name,
          difficulty: node.difficulty,
          topic: node.topic,
          type: node.type,
          description: node.description,
        },
      });
    });

    // Add edges
    graph.edges.forEach(edge => {
      elements.push({
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          weight: edge.weight,
          type: edge.type,
        },
      });
    });

    return {
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#0074D9',
            label: 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 'mapData(weight, 0, 1, 1, 8)',
            'line-color': '#ccc',
          },
        },
      ],
      elements,
    };
  }

  /**
   * Convert graph to GEXF XML format (Graph Exchange XML Format)
   */
  toGEXFFormat(graph) {
    let gexf = '<?xml version="1.0" encoding="UTF-8"?>\n';
    gexf += '<gexf xmlns="http://www.gexf.net/1.2draft" version="1.2">\n';
    gexf += '  <graph mode="static" defaultedgetype="undirected">\n';

    // Attributes
    gexf += '    <attributes class="node">\n';
    gexf += '      <attribute id="difficulty" title="Difficulty" type="integer"/>\n';
    gexf += '      <attribute id="topic" title="Topic" type="string"/>\n';
    gexf += '      <attribute id="type" title="Type" type="string"/>\n';
    gexf += '    </attributes>\n';

    // Nodes
    gexf += '    <nodes>\n';
    graph.nodes.forEach(node => {
      gexf += `      <node id="${node.id}" label="${this.escapeXML(node.name)}">\n`;
      gexf += '        <attvalues>\n';
      gexf += `          <attvalue for="difficulty" value="${node.difficulty}"/>\n`;
      gexf += `          <attvalue for="topic" value="${node.topic}"/>\n`;
      gexf += `          <attvalue for="type" value="${node.type}"/>\n`;
      gexf += '        </attvalues>\n';
      gexf += '      </node>\n';
    });
    gexf += '    </nodes>\n';

    // Edges
    gexf += '    <edges>\n';
    graph.edges.forEach((edge, idx) => {
      gexf += `      <edge id="${idx}" source="${edge.source}" target="${edge.target}" weight="${edge.weight}"/>\n`;
    });
    gexf += '    </edges>\n';

    gexf += '  </graph>\n';
    gexf += '</gexf>\n';

    return gexf;
  }

  /**
   * Convert graph to CSV format
   */
  toCSVFormat(graph) {
    let csv = '';

    // Nodes CSV
    csv += 'Nodes\nId,Name,Type,Difficulty,Topic,Description\n';
    graph.nodes.forEach(node => {
      const description = (node.description || '').replace(/"/g, '""');
      csv += `"${node.id}","${node.name}","${node.type}",${node.difficulty},"${node.topic}","${description}"\n`;
    });

    csv += '\nEdges\nId,Source,Target,Weight,Type\n';
    graph.edges.forEach(edge => {
      csv += `"${edge.id}","${edge.source}","${edge.target}",${edge.weight},"${edge.type}"\n`;
    });

    return csv;
  }

  /**
   * Escape XML special characters
   */
  escapeXML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

module.exports = GraphPersistence;
