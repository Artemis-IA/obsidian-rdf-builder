import { RDFDataset, RDFQuad } from './parser';
import { PrefixManager, RDFNode, RDFEdge, NodeType } from './prefix';
import { RDFClassifier, QuadIndex } from './classifier';

export interface CytoscapeElements {
  nodes: any[];
  edges: any[];
}

export class RDFToCytoscapeConverter {
  private prefixManager: PrefixManager;
  private classifier: RDFClassifier;

  constructor(prefixes: Record<string, string> = {}) {
    this.prefixManager = new PrefixManager(prefixes);
    this.classifier = new RDFClassifier(prefixes);
  }

  /**
   * Convert RDF Dataset to Cytoscape elements
   */
  convert(dataset: RDFDataset, options: {
    includeTBox?: boolean;
    includeABox?: boolean;
    includeLiterals?: boolean;
    includeBlanks?: boolean;
  } = {}): CytoscapeElements {
    const {
      includeTBox = true,
      includeABox = true,
      includeLiterals = true,
      includeBlanks = false
    } = options;

    const nodes: any[] = [];
    const edges: any[] = [];
    const nodeSet = new Set<string>();
    const edgeIds = new Set<string>();
    const degrees = new Map<string, number>();

    // Update prefix manager with dataset prefixes
    Object.entries(dataset.prefixes).forEach(([prefix, uri]) => {
      this.prefixManager.addPrefix(prefix, uri);
    });

    // Build index ONCE — O(n). All classification becomes O(1).
    const index = new QuadIndex(dataset.quads);
    const typeCache = new Map<string, NodeType>();
    const classify = (uri: string): NodeType => {
      let t = typeCache.get(uri);
      if (t === undefined) {
        t = this.classifier.classifyNode(uri, index);
        typeCache.set(uri, t);
      }
      return t;
    };

    // Process quads
    for (const quad of dataset.quads) {
      const edgeType = this.classifier.classifyEdge(quad.predicate);

      // Skip based on filters
      if (edgeType === 'tbox' && !includeTBox) continue;
      if (edgeType === 'abox' && !includeABox) continue;

      // Add subject node
      const subjectType = classify(quad.subject);
      if (this.shouldIncludeNode(subjectType, includeLiterals, includeBlanks)) {
        if (!nodeSet.has(quad.subject)) {
          nodes.push(this.createNode(quad.subject, subjectType, index));
          nodeSet.add(quad.subject);
        }
      }

      // Add object node
      const objectType = classify(quad.object);
      if (this.shouldIncludeNode(objectType, includeLiterals, includeBlanks)) {
        if (!nodeSet.has(quad.object)) {
          nodes.push(this.createNode(quad.object, objectType, index));
          nodeSet.add(quad.object);
        }
      }

      // Add edge ONLY if both endpoints exist as nodes
      // (otherwise Cytoscape rejects the entire batch)
      if (nodeSet.has(quad.subject) && nodeSet.has(quad.object)) {
        const edge = this.createEdge(quad, edgeType);
        if (!edgeIds.has(edge.data.id)) {
          edges.push(edge);
          edgeIds.add(edge.data.id);
          degrees.set(quad.subject, (degrees.get(quad.subject) || 0) + 1);
          degrees.set(quad.object, (degrees.get(quad.object) || 0) + 1);
        }
      }
    }

    // Attach degree to nodes (drives visual node size)
    for (const n of nodes) {
      n.data.degree = degrees.get(n.data.id) || 0;
    }

    return { nodes, edges };
  }

  private shouldIncludeNode(nodeType: NodeType, includeLiterals: boolean, includeBlanks: boolean): boolean {
    if (nodeType === 'literal' && !includeLiterals) return false;
    if (nodeType === 'blank' && !includeBlanks) return false;
    return true;
  }

  private createNode(uri: string, nodeType: NodeType, index: QuadIndex): any {
    const label = this.prefixManager.compress(uri);
    const properties = this.classifier.extractNodeProperties(uri, index);

    // Extract rdfs:label if available
    const labelProp = properties['rdfs:label'] || properties['label'];
    let displayLabel = labelProp && labelProp.length > 0 ? labelProp[0] : label;

    // Truncate long literals for readability
    if (displayLabel.length > 40) {
      displayLabel = displayLabel.slice(0, 37) + '…';
    }

    return {
      data: {
        id: uri,
        label: displayLabel,
        fullUri: uri,
        nodeType: nodeType,
        properties: properties
      }
    };
  }

  private createEdge(quad: RDFQuad, edgeType: 'tbox' | 'abox'): any {
    const label = this.prefixManager.compress(quad.predicate);

    return {
      data: {
        id: `${quad.subject}-${quad.predicate}-${quad.object}`,
        source: quad.subject,
        target: quad.object,
        label: label,
        fullUri: quad.predicate,
        edgeType: edgeType
      }
    };
  }
}
