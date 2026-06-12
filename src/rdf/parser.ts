import { Parser, Store } from 'n3';

export interface RDFQuad {
  subject: string;
  predicate: string;
  object: string;
  graph?: string;
}

export type PrefixMap = Record<string, string>;

export interface RDFDataset {
  quads: RDFQuad[];
  prefixes: PrefixMap;
}

export class RDFParser {
  private parser: Parser;
  private store: Store;

  constructor() {
    this.store = new Store();
    this.parser = new Parser({ format: 'text/turtle' });
  }

  /**
   * Parse Turtle content string into RDF Dataset
   */
  async parseTurtle(turtleContent: string): Promise<RDFDataset> {
    this.store = new Store();
    
    return new Promise((resolve, reject) => {
      this.parser = new Parser({ format: 'text/turtle' });
      
      this.parser.parse(turtleContent, (error, quad, prefixes) => {
        if (error) {
          reject(error);
          return;
        }
        
        if (quad) {
          this.store.addQuad(quad);
        } else {
          // Parsing complete
          const quads: RDFQuad[] = [];
          const quadsArray = this.store.getQuads(null, null, null, null);
          for (const quad of quadsArray) {
            quads.push({
              subject: quad.subject.value,
              predicate: quad.predicate.value,
              object: quad.object.value,
              graph: quad.graph?.value
            });
          }
          
          // Convert prefixes to simple string map
          const prefixMap: PrefixMap = {};
          if (prefixes) {
            for (const [key, value] of Object.entries(prefixes)) {
              prefixMap[key] = value.value;
            }
          }
          
          resolve({
            quads,
            prefixes: prefixMap
          });
        }
      });
    });
  }

  /**
   * Parse N-Triples content string
   */
  async parseNTriples(ntContent: string): Promise<RDFDataset> {
    this.store = new Store();
    
    return new Promise((resolve, reject) => {
      this.parser = new Parser({ format: 'application/n-triples' });
      
      this.parser.parse(ntContent, (error, quad, prefixes) => {
        if (error) {
          reject(error);
          return;
        }
        
        if (quad) {
          this.store.addQuad(quad);
        } else {
          const quads: RDFQuad[] = [];
          const quadsArray = this.store.getQuads(null, null, null, null);
          for (const quad of quadsArray) {
            quads.push({
              subject: quad.subject.value,
              predicate: quad.predicate.value,
              object: quad.object.value,
              graph: quad.graph?.value
            });
          }
          
          // Convert prefixes to simple string map
          const prefixMap: PrefixMap = {};
          if (prefixes) {
            for (const [key, value] of Object.entries(prefixes)) {
              prefixMap[key] = value.value;
            }
          }
          
          resolve({
            quads,
            prefixes: prefixMap
          });
        }
      });
    });
  }

  /**
   * Parse JSON-LD content: expand to N-Quads via jsonld lib, then parse with N3
   */
  async parseJSONLD(jsonldContent: string): Promise<RDFDataset> {
    const jsonld = await import('jsonld');
    const doc = JSON.parse(jsonldContent);
    const nquads = await (jsonld as any).toRDF(doc, { format: 'application/n-quads' });

    this.store = new Store();
    return new Promise((resolve, reject) => {
      this.parser = new Parser({ format: 'application/n-quads' });

      this.parser.parse(nquads as string, (error, quad, prefixes) => {
        if (error) {
          reject(error);
          return;
        }

        if (quad) {
          this.store.addQuad(quad);
        } else {
          const quads: RDFQuad[] = [];
          const quadsArray = this.store.getQuads(null, null, null, null);
          for (const quad of quadsArray) {
            quads.push({
              subject: quad.subject.value,
              predicate: quad.predicate.value,
              object: quad.object.value,
              graph: quad.graph?.value
            });
          }

          // Extract @context prefixes from the original document
          const prefixMap: PrefixMap = {};
          const ctx = doc['@context'];
          if (ctx && typeof ctx === 'object' && !Array.isArray(ctx)) {
            for (const [key, value] of Object.entries(ctx)) {
              if (typeof value === 'string' && !key.startsWith('@')) {
                prefixMap[key] = value;
              }
            }
          }

          resolve({
            quads,
            prefixes: prefixMap
          });
        }
      });
    });
  }

  /**
   * Auto-detect format and parse
   */
  async parse(content: string): Promise<RDFDataset> {
    const trimmed = content.trim();

    // RDF/XML not supported by N3.js — fail fast with a clear message
    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<rdf:RDF')) {
      throw new Error(
        'RDF/XML format is not supported yet. Please use Turtle (.ttl), N-Triples (.nt) or JSON-LD (.jsonld).'
      );
    }

    // HTML page received instead of RDF (bad content negotiation)
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
      throw new Error(
        'Received an HTML page instead of RDF data. Try the direct raw file URL (e.g. raw.githubusercontent.com).'
      );
    }

    // JSON-LD: starts with { or [
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return this.parseJSONLD(content);
    }

    // Turtle: has @prefix/@base or PREFIX directive
    if (
      content.includes('@prefix') ||
      content.includes('@base') ||
      /^\s*PREFIX\s/im.test(content)
    ) {
      return this.parseTurtle(content);
    }

    // Try Turtle first (superset of N-Triples), fall back to N-Triples
    try {
      return await this.parseTurtle(content);
    } catch {
      return this.parseNTriples(content);
    }
  }
}
