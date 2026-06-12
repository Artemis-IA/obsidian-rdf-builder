export type NodeType = 'class' | 'property' | 'instance' | 'literal' | 'blank';

export interface PrefixMap {
  [prefix: string]: string;
}

export interface RDFNode {
  id: string;
  label: string;
  fullUri: string;
  nodeType: NodeType;
  prefixes: PrefixMap;
  properties?: Record<string, string[]>;
}

export interface RDFEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  fullUri: string;
  edgeType: 'tbox' | 'abox';
}

export class PrefixManager {
  private prefixes: PrefixMap = {};
  private reversePrefixes: Map<string, string> = new Map();

  constructor(prefixes: PrefixMap = {}) {
    this.prefixes = { ...prefixes };
    this.buildReverseMap();
  }

  private buildReverseMap() {
    this.reversePrefixes.clear();
    for (const [prefix, uri] of Object.entries(this.prefixes)) {
      this.reversePrefixes.set(uri, prefix);
    }
  }

  /**
   * Compress full URI to prefixed form
   * e.g., http://www.w3.org/2000/01/rdf-schema#Class → rdfs:Class
   */
  compress(uri: string): string {
    // Try to find matching prefix
    for (const [prefix, baseUri] of Object.entries(this.prefixes)) {
      if (uri.startsWith(baseUri)) {
        const localName = uri.substring(baseUri.length);
        return `${prefix}:${localName}`;
      }
    }
    
    // Return original if no prefix matches
    return uri;
  }

  /**
   * Expand prefixed form to full URI
   * e.g., rdfs:Class → http://www.w3.org/2000/01/rdf-schema#Class
   */
  expand(prefixed: string): string {
    const match = prefixed.match(/^([^:]+):(.+)$/);
    if (!match) return prefixed;

    const [, prefix, localName] = match;
    const baseUri = this.prefixes[prefix];
    
    if (baseUri) {
      return baseUri + localName;
    }
    
    return prefixed;
  }

  /**
   * Add a new prefix
   */
  addPrefix(prefix: string, uri: string) {
    this.prefixes[prefix] = uri;
    this.buildReverseMap();
  }

  /**
   * Get all prefixes
   */
  getPrefixes(): PrefixMap {
    return { ...this.prefixes };
  }
}
