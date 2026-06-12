import { RDFQuad, PrefixMap } from './parser';
import { PrefixManager, NodeType, RDFNode, RDFEdge } from './prefix';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

/**
 * Pre-computed indexes over a quad list for O(1) classification.
 * Build once, query many times — avoids O(n²) full scans.
 */
export class QuadIndex {
  readonly predicates = new Set<string>();
  readonly typeObjects = new Set<string>();   // objects of rdf:type → classes
  readonly typedSubjects = new Set<string>(); // subjects having rdf:type → instances
  readonly subjects = new Set<string>();
  readonly objects = new Set<string>();
  readonly bySubject = new Map<string, RDFQuad[]>();

  constructor(quads: RDFQuad[]) {
    for (const q of quads) {
      this.predicates.add(q.predicate);
      this.subjects.add(q.subject);
      this.objects.add(q.object);
      if (q.predicate === RDF_TYPE) {
        this.typeObjects.add(q.object);
        this.typedSubjects.add(q.subject);
      }
      let list = this.bySubject.get(q.subject);
      if (!list) {
        list = [];
        this.bySubject.set(q.subject, list);
      }
      list.push(q);
    }
  }
}

export class RDFClassifier {
  private prefixManager: PrefixManager;

  constructor(prefixes: PrefixMap = {}) {
    this.prefixManager = new PrefixManager(prefixes);
  }

  /**
   * Determine if a URI represents a TBox element (class/property)
   */
  isTBox(uri: string): boolean {
    const compressed = this.prefixManager.compress(uri);
    
    // Check for common TBox patterns
    const tboxPatterns = [
      /:Class$/,
      /:Property$/,
      /:Datatype$/,
      /:domain$/,
      /:range$/,
      /:subClassOf$/,
      /:subPropertyOf$/,
      /:ObjectProperty$/,
      /:DatatypeProperty$/,
      /:AnnotationProperty$/,
      /rdf:type$/,
      /rdfs:Class$/,
      /owl:Class$/,
      /owl:ObjectProperty$/,
      /owl:DatatypeProperty$/,
      /owl:AnnotationProperty$/,
    ];

    return tboxPatterns.some(pattern => pattern.test(compressed));
  }

  /**
   * Determine node type based on RDF patterns.
   * Accepts a QuadIndex for O(1) lookups (REQUIRED for large graphs).
   */
  classifyNode(uri: string, index: QuadIndex): NodeType {
    // Check if it's a blank node
    if (uri.startsWith('_:')) {
      return 'blank';
    }

    // Check if it's a literal (not an absolute IRI / blank node)
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uri) || uri.startsWith('"')) {
      return 'literal';
    }

    // Check if it's used as a predicate (property)
    if (index.predicates.has(uri)) {
      return 'property';
    }

    // Check if it's used as a class (rdf:type object)
    if (index.typeObjects.has(uri)) {
      return 'class';
    }

    // Check if it has rdf:type (instance)
    if (index.typedSubjects.has(uri)) {
      return 'instance';
    }

    // Default to instance if it appears as a subject
    if (index.subjects.has(uri)) {
      return 'instance';
    }

    // Default to class if it appears as an object (but not a literal)
    if (index.objects.has(uri)) {
      return 'class';
    }

    return 'instance';
  }

  /**
   * Classify edge as TBox or ABox
   */
  classifyEdge(predicate: string): 'tbox' | 'abox' {
    return this.isTBox(predicate) ? 'tbox' : 'abox';
  }

  /**
   * Extract properties for a node (O(1) via QuadIndex.bySubject)
   */
  extractNodeProperties(uri: string, index: QuadIndex): Record<string, string[]> {
    const properties: Record<string, string[]> = {};

    const quads = index.bySubject.get(uri) || [];
    for (const q of quads) {
      const pred = this.prefixManager.compress(q.predicate);
      if (!properties[pred]) {
        properties[pred] = [];
      }
      properties[pred].push(q.object);
    }

    return properties;
  }
}
