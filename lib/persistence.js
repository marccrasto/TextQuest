/**
 * File-based persistence for generated graphs.
 */

const fs = require('fs').promises;
const path = require('path');

class GraphPersistence {
  constructor(dataDir = path.join(__dirname, '..', 'data', 'graphs')) {
    this.dataDir = dataDir;
  }

  async initializeDirectory() {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  generateFilename(title, timestamp = null) {
    const sanitized = (title || 'untitled')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);

    let ts = timestamp || Date.now();
    // Force string conversion and sanitization
    ts = new Date(ts).toISOString().replace(/:/g, '-').replace(/\./g, '-');

    return `graph-${sanitized}-${ts}.json`;
  }

  async saveGraph(graph, title, metadata = {}) {
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

    try {
      await fs.writeFile(filepath, JSON.stringify(fullData, null, 2));
    } catch (error) {
      console.error('Failed to save graph with original filename, trying fallback...', error);
      // Fallback: use simple timestamp
      const fallbackFilename = `graph-${Date.now()}.json`;
      const fallbackPath = path.join(this.dataDir, fallbackFilename);
      await fs.writeFile(fallbackPath, JSON.stringify(fullData, null, 2));
      return {
        success: true,
        filepath: fallbackPath,
        filename: fallbackFilename,
        note: 'Saved with fallback filename due to error',
      };
    }

    return {
      success: true,
      filepath,
      filename,
    };
  }

  async loadGraph(filename) {
    const filepath = path.join(this.dataDir, filename);
    const data = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(data);
  }

  async listGraphs() {
    await this.initializeDirectory();
    const files = await fs.readdir(this.dataDir);

    const graphs = await Promise.all(
      files
        .filter((f) => f.startsWith('graph-') && f.endsWith('.json'))
        .map(async (filename) => {
          try {
            const data = await this.loadGraph(filename);
            return {
              filename,
              title: data.persistenceMetadata?.title || 'Unknown',
              timestamp: data.timestamp,
              concepts: data.metadata?.totalConcepts || 0,
              edges: data.metadata?.totalEdges || 0,
            };
          } catch (_error) {
            return null;
          }
        })
    );

    return graphs.filter(Boolean).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  async deleteGraph(filename) {
    const filepath = path.join(this.dataDir, filename);
    await fs.unlink(filepath);
    return { success: true, message: `Deleted ${filename}` };
  }

  async exportGraph(filename, format = 'json') {
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
  }

  toCytoscapeFormat(graph) {
    const elements = [];

    graph.nodes.forEach((node) => {
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

    graph.edges.forEach((edge) => {
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

  toGEXFFormat(graph) {
    let gexf = '<?xml version="1.0" encoding="UTF-8"?>\n';
    gexf += '<gexf xmlns="http://www.gexf.net/1.2draft" version="1.2">\n';
    gexf += '  <graph mode="static" defaultedgetype="undirected">\n';
    gexf += '    <attributes class="node">\n';
    gexf += '      <attribute id="difficulty" title="Difficulty" type="integer"/>\n';
    gexf += '      <attribute id="topic" title="Topic" type="string"/>\n';
    gexf += '      <attribute id="type" title="Type" type="string"/>\n';
    gexf += '    </attributes>\n';
    gexf += '    <nodes>\n';
    graph.nodes.forEach((node) => {
      gexf += `      <node id="${node.id}" label="${this.escapeXML(node.name)}">\n`;
      gexf += '        <attvalues>\n';
      gexf += `          <attvalue for="difficulty" value="${node.difficulty}"/>\n`;
      gexf += `          <attvalue for="topic" value="${node.topic}"/>\n`;
      gexf += `          <attvalue for="type" value="${node.type}"/>\n`;
      gexf += '        </attvalues>\n';
      gexf += '      </node>\n';
    });
    gexf += '    </nodes>\n';
    gexf += '    <edges>\n';
    graph.edges.forEach((edge, idx) => {
      gexf += `      <edge id="${idx}" source="${edge.source}" target="${edge.target}" weight="${edge.weight}"/>\n`;
    });
    gexf += '    </edges>\n';
    gexf += '  </graph>\n';
    gexf += '</gexf>\n';

    return gexf;
  }

  toCSVFormat(graph) {
    let csv = 'Nodes\nId,Name,Type,Difficulty,Topic,Description\n';
    graph.nodes.forEach((node) => {
      const description = (node.description || '').replace(/"/g, '""');
      csv += `"${node.id}","${node.name}","${node.type}",${node.difficulty},"${node.topic}","${description}"\n`;
    });

    csv += '\nEdges\nId,Source,Target,Weight,Type\n';
    graph.edges.forEach((edge) => {
      csv += `"${edge.id}","${edge.source}","${edge.target}",${edge.weight},"${edge.type}"\n`;
    });

    return csv;
  }

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
