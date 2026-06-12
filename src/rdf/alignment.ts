import { RDFDataset } from './parser';
import { OntologyAnalyzer } from './ontology';

const ALIGNMENT_PREDICATES = new Set([
  'http://www.w3.org/2002/07/owl#equivalentClass',
  'http://www.w3.org/2002/07/owl#equivalentProperty',
  'http://www.w3.org/2002/07/owl#sameAs',
  'http://www.w3.org/2004/02/skos/core#exactMatch',
  'http://www.w3.org/2004/02/skos/core#closeMatch',
  'http://www.w3.org/2004/02/skos/core#broadMatch',
  'http://www.w3.org/2004/02/skos/core#narrowMatch',
  'http://www.w3.org/2000/01/rdf-schema#seeAlso'
]);

const STRUCTURE_PREDICATES = new Set([
  'http://www.w3.org/2000/01/rdf-schema#subClassOf',
  'http://www.w3.org/2000/01/rdf-schema#subPropertyOf',
  'http://www.w3.org/2004/02/skos/core#broader'
]);

export interface AlignmentStats {
  termsA: number;
  termsB: number;
  shared: number;
  explicit: number;
  suggested: number;
}

export interface AlignmentResult {
  nodes: any[];
  edges: any[];
  stats: AlignmentStats;
  /** Merged dataset (for the hierarchy/properties/stats views) */
  merged: RDFDataset;
}

/**
 * Compute an alignment view between two ontologies:
 * - TBox terms of each ontology as nodes, tagged A / B / both
 * - structural edges (subClassOf) for context
 * - explicit mapping edges (owl:equivalentClass, skos:exactMatch, ...)
 * - suggested matches by exact label equality (case/diacritic-insensitive)
 */
export function computeAlignment(
  dsA: RDFDataset,
  dsB: RDFDataset,
  nameA = 'A',
  nameB = 'B'
): AlignmentResult {
  const analyzerA = new OntologyAnalyzer(dsA);
  const analyzerB = new OntologyAnalyzer(dsB);

  // Collect TBox terms (classes + declared properties)
  const termsA = collectTerms(analyzerA);
  const termsB = collectTerms(analyzerB);

  const nodes: any[] = [];
  const edges: any[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  let shared = 0;

  const addNode = (uri: string, src: 'A' | 'B' | 'both', analyzer: OntologyAnalyzer, kind: string) => {
    if (nodeIds.has(uri)) return;
    nodeIds.add(uri);
    nodes.push({
      data: {
        id: uri,
        label: analyzer.getLabel(uri),
        fullUri: uri,
        nodeType: kind,
        graphSrc: src,
        degree: 2
      }
    });
  };

  // A-side nodes (and shared)
  for (const [uri, kind] of termsA) {
    if (termsB.has(uri)) {
      shared++;
      addNode(uri, 'both', analyzerA, kind);
    } else {
      addNode(uri, 'A', analyzerA, kind);
    }
  }
  // B-only nodes
  for (const [uri, kind] of termsB) {
    if (!termsA.has(uri)) {
      addNode(uri, 'B', analyzerB, kind);
    }
  }

  const addEdge = (id: string, source: string, target: string, label: string, cls: string) => {
    if (edgeIds.has(id)) return;
    if (!nodeIds.has(source) || !nodeIds.has(target)) return;
    edgeIds.add(id);
    edges.push({ data: { id, source, target, label, edgeType: cls } });
  };

  // Structural context edges (within each ontology)
  for (const [ds, tag] of [[dsA, 'A'], [dsB, 'B']] as const) {
    for (const q of ds.quads) {
      if (STRUCTURE_PREDICATES.has(q.predicate)) {
        addEdge(`${tag}|${q.subject}|${q.predicate}|${q.object}`, q.subject, q.object, 'subClassOf', 'structure');
      }
    }
  }

  // Explicit alignment edges (declared in either dataset)
  let explicit = 0;
  for (const ds of [dsA, dsB]) {
    for (const q of ds.quads) {
      if (ALIGNMENT_PREDICATES.has(q.predicate)) {
        const before = edgeIds.size;
        addEdge(
          `align|${q.subject}|${q.predicate}|${q.object}`,
          q.subject, q.object,
          shortPredicate(q.predicate),
          'align-explicit'
        );
        if (edgeIds.size > before) explicit++;
      }
    }
  }

  // Suggested matches: exact label equality between A-only and B-only terms
  let suggested = 0;
  const labelIndexB = new Map<string, string[]>();
  for (const [uri] of termsB) {
    if (termsA.has(uri)) continue;
    const norm = normalizeLabel(analyzerB.getLabel(uri));
    if (!norm) continue;
    const list = labelIndexB.get(norm) || [];
    list.push(uri);
    labelIndexB.set(norm, list);
  }

  for (const [uriA] of termsA) {
    if (termsB.has(uriA)) continue;
    const norm = normalizeLabel(analyzerA.getLabel(uriA));
    const matches = labelIndexB.get(norm);
    if (matches) {
      for (const uriB of matches) {
        const before = edgeIds.size;
        addEdge(`suggest|${uriA}|${uriB}`, uriA, uriB, '≈ label match', 'align-suggested');
        if (edgeIds.size > before) suggested++;
      }
    }
  }

  // Merged dataset for the other view modes
  const merged: RDFDataset = {
    quads: [...dsA.quads, ...dsB.quads],
    prefixes: { ...dsA.prefixes, ...dsB.prefixes }
  };

  return {
    nodes,
    edges,
    merged,
    stats: {
      termsA: termsA.size,
      termsB: termsB.size,
      shared,
      explicit,
      suggested
    }
  };
}

/** Collect TBox terms (classes and properties) with their kind */
function collectTerms(analyzer: OntologyAnalyzer): Map<string, string> {
  const terms = new Map<string, string>();
  for (const cls of analyzer.findClasses()) {
    terms.set(cls, 'class');
  }
  for (const prop of analyzer.findProperties()) {
    terms.set(prop.uri, 'property');
  }
  return terms;
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function shortPredicate(uri: string): string {
  const idx = Math.max(uri.lastIndexOf('#'), uri.lastIndexOf('/'));
  return idx > 0 ? uri.slice(idx + 1) : uri;
}
