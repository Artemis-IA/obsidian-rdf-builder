import { RDFDataset, RDFQuad } from './parser';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS_SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const RDFS_SUBPROP = 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf';
const RDFS_CLASS = 'http://www.w3.org/2000/01/rdf-schema#Class';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment';
const RDFS_DOMAIN = 'http://www.w3.org/2000/01/rdf-schema#domain';
const RDFS_RANGE = 'http://www.w3.org/2000/01/rdf-schema#range';
const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class';
const OWL_OBJECT_PROP = 'http://www.w3.org/2002/07/owl#ObjectProperty';
const OWL_DATA_PROP = 'http://www.w3.org/2002/07/owl#DatatypeProperty';
const OWL_ANNOTATION_PROP = 'http://www.w3.org/2002/07/owl#AnnotationProperty';
const OWL_ONTOLOGY = 'http://www.w3.org/2002/07/owl#Ontology';
const RDF_PROPERTY = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property';
const SKOS_CONCEPT = 'http://www.w3.org/2004/02/skos/core#Concept';
const SKOS_BROADER = 'http://www.w3.org/2004/02/skos/core#broader';
const SKOS_NARROWER = 'http://www.w3.org/2004/02/skos/core#narrower';
const SKOS_PREFLABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';

export interface ClassNode {
  uri: string;
  label: string;
  comment?: string;
  children: ClassNode[];
  instanceCount: number;
}

export interface PropertyInfo {
  uri: string;
  label: string;
  type: 'object' | 'datatype' | 'annotation' | 'rdf';
  domain?: string;
  range?: string;
}

export interface OntologyStats {
  totalTriples: number;
  classCount: number;
  objectPropertyCount: number;
  datatypePropertyCount: number;
  annotationPropertyCount: number;
  individualCount: number;
  skosConceptCount: number;
  ontologyUri?: string;
  namespaces: number;
}

/**
 * Analyzes RDF datasets to extract ontology structure:
 * class hierarchies, property catalogs, and statistics.
 */
export class OntologyAnalyzer {
  private quads: RDFQuad[];
  private prefixes: Record<string, string>;
  private labelMap = new Map<string, string>();
  private commentMap = new Map<string, string>();
  private domainMap = new Map<string, string>();
  private rangeMap = new Map<string, string>();

  constructor(dataset: RDFDataset) {
    this.quads = dataset.quads;
    this.prefixes = dataset.prefixes;

    // Pre-index annotations once — O(n) instead of O(n²) lookups
    for (const q of this.quads) {
      switch (q.predicate) {
        case RDFS_LABEL:
        case SKOS_PREFLABEL:
          if (!this.labelMap.has(q.subject)) this.labelMap.set(q.subject, q.object);
          break;
        case RDFS_COMMENT:
          if (!this.commentMap.has(q.subject)) this.commentMap.set(q.subject, q.object);
          break;
        case RDFS_DOMAIN:
          if (!this.domainMap.has(q.subject)) this.domainMap.set(q.subject, q.object);
          break;
        case RDFS_RANGE:
          if (!this.rangeMap.has(q.subject)) this.rangeMap.set(q.subject, q.object);
          break;
      }
    }
  }

  /**
   * Compress a URI using known prefixes
   */
  compress(uri: string): string {
    for (const [prefix, ns] of Object.entries(this.prefixes)) {
      if (uri.startsWith(ns)) {
        return `${prefix}:${uri.slice(ns.length)}`;
      }
    }
    // Fall back to local name
    const hashIdx = uri.lastIndexOf('#');
    const slashIdx = uri.lastIndexOf('/');
    const idx = Math.max(hashIdx, slashIdx);
    return idx > 0 ? uri.slice(idx + 1) : uri;
  }

  /**
   * Get the rdfs:label (or skos:prefLabel) for a URI, fallback to compressed URI
   */
  getLabel(uri: string): string {
    return this.labelMap.get(uri) ?? this.compress(uri);
  }

  /**
   * Get rdfs:comment for a URI
   */
  getComment(uri: string): string | undefined {
    return this.commentMap.get(uri);
  }

  /**
   * Find all declared classes (owl:Class, rdfs:Class, or implied by subClassOf)
   */
  findClasses(): Set<string> {
    const classes = new Set<string>();

    for (const q of this.quads) {
      if (q.predicate === RDF_TYPE && (q.object === OWL_CLASS || q.object === RDFS_CLASS)) {
        classes.add(q.subject);
      }
      if (q.predicate === RDFS_SUBCLASS) {
        classes.add(q.subject);
        classes.add(q.object);
      }
      // Objects of rdf:type are classes too (implied)
      if (q.predicate === RDF_TYPE &&
          !q.object.startsWith('http://www.w3.org/2002/07/owl#') &&
          !q.object.startsWith('http://www.w3.org/2000/01/rdf-schema#') &&
          !q.object.startsWith('http://www.w3.org/1999/02/22-rdf-syntax-ns#')) {
        classes.add(q.object);
      }
    }

    return classes;
  }

  /**
   * Build the class hierarchy tree (rdfs:subClassOf)
   * Also supports SKOS broader/narrower hierarchies.
   */
  buildClassHierarchy(): ClassNode[] {
    const classes = this.findClasses();
    const childrenMap = new Map<string, Set<string>>();
    const hasParent = new Set<string>();

    // subClassOf relations
    for (const q of this.quads) {
      if (q.predicate === RDFS_SUBCLASS && classes.has(q.subject) && classes.has(q.object)) {
        if (q.subject === q.object) continue;
        if (!childrenMap.has(q.object)) childrenMap.set(q.object, new Set());
        childrenMap.get(q.object)!.add(q.subject);
        hasParent.add(q.subject);
      }
      // SKOS hierarchy
      if (q.predicate === SKOS_BROADER) {
        if (!childrenMap.has(q.object)) childrenMap.set(q.object, new Set());
        childrenMap.get(q.object)!.add(q.subject);
        hasParent.add(q.subject);
        classes.add(q.subject);
        classes.add(q.object);
      }
      if (q.predicate === SKOS_NARROWER) {
        if (!childrenMap.has(q.subject)) childrenMap.set(q.subject, new Set());
        childrenMap.get(q.subject)!.add(q.object);
        hasParent.add(q.object);
        classes.add(q.subject);
        classes.add(q.object);
      }
    }

    // Count instances per class
    const instanceCounts = new Map<string, number>();
    for (const q of this.quads) {
      if (q.predicate === RDF_TYPE && classes.has(q.object)) {
        instanceCounts.set(q.object, (instanceCounts.get(q.object) || 0) + 1);
      }
    }

    // Build tree from roots (classes without parent)
    const visited = new Set<string>();
    const buildNode = (uri: string): ClassNode => {
      visited.add(uri);
      const childUris = Array.from(childrenMap.get(uri) || []);
      return {
        uri,
        label: this.getLabel(uri),
        comment: this.getComment(uri),
        instanceCount: instanceCounts.get(uri) || 0,
        children: childUris
          .filter(c => !visited.has(c))
          .map(c => buildNode(c))
          .sort((a, b) => a.label.localeCompare(b.label))
      };
    };

    const roots = Array.from(classes)
      .filter(c => !hasParent.has(c))
      .sort((a, b) => this.getLabel(a).localeCompare(this.getLabel(b)));

    return roots.map(r => buildNode(r));
  }

  /**
   * Catalog all properties with domain/range
   */
  findProperties(): PropertyInfo[] {
    const props: PropertyInfo[] = [];
    const seen = new Set<string>();

    const typeMap: Record<string, PropertyInfo['type']> = {
      [OWL_OBJECT_PROP]: 'object',
      [OWL_DATA_PROP]: 'datatype',
      [OWL_ANNOTATION_PROP]: 'annotation',
      [RDF_PROPERTY]: 'rdf'
    };

    for (const q of this.quads) {
      if (q.predicate === RDF_TYPE && typeMap[q.object] && !seen.has(q.subject)) {
        seen.add(q.subject);
        const domain = this.domainMap.get(q.subject);
        const range = this.rangeMap.get(q.subject);
        props.push({
          uri: q.subject,
          label: this.getLabel(q.subject),
          type: typeMap[q.object],
          domain: domain ? this.compress(domain) : undefined,
          range: range ? this.compress(range) : undefined
        });
      }
    }

    return props.sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Compute ontology statistics
   */
  computeStats(): OntologyStats {
    let classCount = 0;
    let objectPropertyCount = 0;
    let datatypePropertyCount = 0;
    let annotationPropertyCount = 0;
    let skosConceptCount = 0;
    let ontologyUri: string | undefined;
    const individuals = new Set<string>();
    const declaredClasses = new Set<string>();

    for (const q of this.quads) {
      if (q.predicate === RDF_TYPE) {
        switch (q.object) {
          case OWL_CLASS:
          case RDFS_CLASS:
            classCount++;
            declaredClasses.add(q.subject);
            break;
          case OWL_OBJECT_PROP:
            objectPropertyCount++;
            break;
          case OWL_DATA_PROP:
            datatypePropertyCount++;
            break;
          case OWL_ANNOTATION_PROP:
            annotationPropertyCount++;
            break;
          case OWL_ONTOLOGY:
            ontologyUri = q.subject;
            break;
          case SKOS_CONCEPT:
            skosConceptCount++;
            break;
        }
      }
    }

    // Individuals: subjects with rdf:type pointing to a declared class
    for (const q of this.quads) {
      if (q.predicate === RDF_TYPE && declaredClasses.has(q.object)) {
        individuals.add(q.subject);
      }
    }

    return {
      totalTriples: this.quads.length,
      classCount,
      objectPropertyCount,
      datatypePropertyCount,
      annotationPropertyCount,
      individualCount: individuals.size,
      skosConceptCount,
      ontologyUri,
      namespaces: Object.keys(this.prefixes).length
    };
  }
}
