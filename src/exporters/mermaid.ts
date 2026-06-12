import { RDFDataset } from '../rdf/parser';

export class MermaidExporter {
  /**
   * Convert RDF dataset to Mermaid graph definition
   */
  exportToMermaid(dataset: RDFDataset, options: {
    includeTBox?: boolean;
    includeABox?: boolean;
    includeLiterals?: boolean;
  } = {}): string {
    const { includeTBox = true, includeABox = true, includeLiterals = true } = options;
    
    let mermaid = 'graph TD\n';
    
    // Track nodes to avoid duplicates
    const nodes = new Set<string>();
    const edges = new Set<string>();
    
    // Process quads
    for (const quad of dataset.quads) {
      const subject = this.escapeId(quad.subject);
      const predicate = this.escapeId(quad.predicate);
      const object = this.escapeId(quad.object);
      
      // Skip literals if not included
      if (!includeLiterals && this.isLiteral(quad.object)) {
        continue;
      }
      
      // Determine if this is TBox or ABox
      const isTBox = this.isTBoxQuad(quad);
      
      if (includeTBox && isTBox || includeABox && !isTBox) {
        // Add nodes
        if (!nodes.has(subject)) {
          nodes.add(subject);
          mermaid += `  ${subject}["${this.getLabel(quad.subject, dataset.prefixes)}"]\n`;
        }
        
        if (!nodes.has(object) && !this.isLiteral(quad.object)) {
          nodes.add(object);
          mermaid += `  ${object}["${this.getLabel(quad.object, dataset.prefixes)}"]\n`;
        }
        
        // Add edge
        const edgeKey = `${subject}-->${object}`;
        if (!edges.has(edgeKey)) {
          edges.add(edgeKey);
          const label = this.getLabel(quad.predicate, dataset.prefixes);
          mermaid += `  ${subject}-->|${label}|${object}\n`;
        }
      }
    }
    
    return mermaid;
  }

  /**
   * Escape Mermaid IDs
   */
  private escapeId(uri: string): string {
    // Replace special characters with underscores
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
    // Return last part of URI if no prefix match
    const parts = uri.split(/[/#]/);
    return parts[parts.length - 1] || uri;
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
