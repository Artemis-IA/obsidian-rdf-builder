import { RDFDataset } from '../rdf/parser';

export interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'link';
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  url?: string;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  color?: string;
  label?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export class CanvasExporter {
  /**
   * Convert RDF dataset to Obsidian Canvas format
   */
  exportToCanvas(dataset: RDFDataset, options: {
    includeTBox?: boolean;
    includeABox?: boolean;
    includeLiterals?: boolean;
    nodeWidth?: number;
    nodeHeight?: number;
  } = {}): CanvasData {
    const { 
      includeTBox = true, 
      includeABox = true, 
      includeLiterals = true,
      nodeWidth = 200,
      nodeHeight = 100
    } = options;
    
    const nodes: CanvasNode[] = [];
    const edges: CanvasEdge[] = [];
    const nodeMap = new Map<string, { x: number; y: number }>();
    
    // Simple layout algorithm - circular
    const totalNodes = this.countNodes(dataset, { includeTBox, includeABox, includeLiterals });
    const radius = Math.max(300, totalNodes * 30);
    let angle = 0;
    const angleStep = (2 * Math.PI) / totalNodes;
    
    // Process quads
    for (const quad of dataset.quads) {
      const subject = quad.subject;
      const predicate = quad.predicate;
      const object = quad.object;
      
      // Skip literals if not included
      if (!includeLiterals && this.isLiteral(object)) {
        continue;
      }
      
      // Determine if this is TBox or ABox
      const isTBox = this.isTBoxQuad(quad);
      
      if (includeTBox && isTBox || includeABox && !isTBox) {
        // Add subject node
        if (!nodeMap.has(subject)) {
          const x = Math.cos(angle) * radius + 400;
          const y = Math.sin(angle) * radius + 300;
          nodeMap.set(subject, { x, y });
          angle += angleStep;
          
          nodes.push({
            id: this.escapeId(subject),
            type: 'text',
            x,
            y,
            width: nodeWidth,
            height: nodeHeight,
            color: this.getNodeColor(subject, isTBox),
            text: this.getLabel(subject, dataset.prefixes)
          });
        }
        
        // Add object node (if not literal)
        if (!this.isLiteral(object) && !nodeMap.has(object)) {
          const x = Math.cos(angle) * radius + 400;
          const y = Math.sin(angle) * radius + 300;
          nodeMap.set(object, { x, y });
          angle += angleStep;
          
          nodes.push({
            id: this.escapeId(object),
            type: 'text',
            x,
            y,
            width: nodeWidth,
            height: nodeHeight,
            color: this.getNodeColor(object, isTBox),
            text: this.getLabel(object, dataset.prefixes)
          });
        }
        
        // Add edge
        const edgeId = `${this.escapeId(subject)}-${this.escapeId(object)}`;
        edges.push({
          id: edgeId,
          fromNode: this.escapeId(subject),
          toNode: this.escapeId(object),
          color: isTBox ? '#4a90e2' : '#ffa500',
          label: this.getLabel(predicate, dataset.prefixes)
        });
      }
    }
    
    return { nodes, edges };
  }

  /**
   * Export to Obsidian Canvas file format
   */
  exportToCanvasFile(dataset: RDFDataset, options: any = {}): string {
    const canvasData = this.exportToCanvas(dataset, options);
    
    const canvasFile = {
      nodes: canvasData.nodes.map(node => ({
        id: node.id,
        type: node.type,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        color: node.color,
        text: node.text
      })),
      edges: canvasData.edges.map(edge => ({
        id: edge.id,
        fromNode: edge.fromNode,
        toNode: edge.toNode,
        color: edge.color,
        label: edge.label
      }))
    };
    
    return JSON.stringify(canvasFile, null, 2);
  }

  /**
   * Count nodes to be included
   */
  private countNodes(dataset: RDFDataset, options: any): number {
    const { includeTBox = true, includeABox = true, includeLiterals = true } = options;
    const nodes = new Set<string>();
    
    for (const quad of dataset.quads) {
      const isTBox = this.isTBoxQuad(quad);
      
      if (includeTBox && isTBox || includeABox && !isTBox) {
        nodes.add(quad.subject);
        if (!this.isLiteral(quad.object)) {
          nodes.add(quad.object);
        }
      }
    }
    
    return nodes.size;
  }

  /**
   * Escape Canvas IDs
   */
  private escapeId(uri: string): string {
    return uri.replace(/[^a-zA-Z0-9]/g, '_');
  }

  /**
   * Get label for URI using prefixes
   */
  private getLabel(uri: string, prefixes: Record<string, string>): string {
    for (const [prefix, base] of Object.entries(prefixes)) {
      if (uri.startsWith(base)) {
        return `${prefix}:${uri.substring(base.length)}`;
      }
    }
    const parts = uri.split(/[/#]/);
    return parts[parts.length - 1] || uri;
  }

  /**
   * Get node color based on type
   */
  private getNodeColor(uri: string, isTBox: boolean): string {
    if (isTBox) {
      if (uri.includes('Class') || uri.includes('class')) {
        return '#4a90e2'; // Blue for classes
      }
      return '#50c878'; // Green for properties
    }
    return '#ffa500'; // Orange for instances
  }

  /**
   * Check if a value is a literal
   */
  private isLiteral(value: string): boolean {
    return value.startsWith('"') || value.startsWith("'") || !!value.match(/^[a-z]+:/);
  }

  /**
   * Check if a quad is TBox (terminology)
   */
  private isTBoxQuad(quad: any): boolean {
    const tboxPredicates = [
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
      'http://www.w3.org/2000/01/rdf-schema#subClassOf',
      'http://www.w3.org/2000/01/rdf-schema#subPropertyOf',
      'http://www.w3.org/2000/01/rdf-schema#domain',
      'http://www.w3.org/2000/01/rdf-schema#range',
      'http://www.w3.org/2002/07/owl#equivalentClass',
      'http://www.w3.org/2002/07/owl#equivalentProperty',
      'http://www.w3.org/2002/07/owl#disjointWith'
    ];
    
    return tboxPredicates.includes(quad.predicate);
  }
}
