import type { AdvisoryCheck } from "@/engine/types";

export interface SimilarityOptions {
  /** Minimum Jaccard similarity of character shingles for two answers to be linked. */
  threshold: number;
  /** Answers shorter than this (after normalization) are never clustered. */
  minChars: number;
  /** Smallest cluster that triggers a review. */
  minClusterSize: number;
  shingleSize: number;
}

export const DEFAULT_SIMILARITY: SimilarityOptions = { threshold: 0.8, minChars: 25, minClusterSize: 3, shingleSize: 5 };

export interface SimilarityAnswer {
  ref: string;
  text: string;
}

export interface SimilarityCluster {
  refs: string[];
  /** Highest similarity each member has to another member. */
  bestMatch: Map<string, { ref: string; similarity: number }>;
}

const HASHES = 128;
const BANDS = 32;
const ROWS = HASHES / BANDS;

export function normalizeForSimilarity(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mix(value: number, seed: number): number {
  let hash = (value ^ seed) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

const SEEDS = Array.from({ length: HASHES }, (_, index) => mix(index + 1, 0x9e3779b9));

function shingles(text: string, size: number): Set<number> {
  const result = new Set<number>();
  if (text.length <= size) {
    result.add(fnv1a(text));
    return result;
  }
  for (let index = 0; index + size <= text.length; index += 1) {
    result.add(fnv1a(text.slice(index, index + size)));
  }
  return result;
}

function signature(set: Set<number>): Uint32Array {
  const result = new Uint32Array(HASHES).fill(0xffffffff);
  for (const value of set) {
    for (let index = 0; index < HASHES; index += 1) {
      const hashed = mix(value, SEEDS[index]!);
      if (hashed < result[index]!) {
        result[index] = hashed;
      }
    }
  }
  return result;
}

export function jaccard(a: Set<number>, b: Set<number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const value of small) {
    if (large.has(value)) {
      shared += 1;
    }
  }
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Finds groups of near-identical answers. MinHash with banded LSH proposes candidate pairs;
 * every pair is then confirmed with exact Jaccard similarity, so results are exact for confirmed pairs
 * and deterministic (fixed seeds).
 */
export function findClusters(answers: readonly SimilarityAnswer[], options: SimilarityOptions = DEFAULT_SIMILARITY): SimilarityCluster[] {
  const items = answers
    .map((answer) => ({ ref: answer.ref, text: normalizeForSimilarity(answer.text) }))
    .filter((answer) => answer.text.length >= options.minChars)
    .map((answer) => {
      const set = shingles(answer.text, options.shingleSize);
      return { ref: answer.ref, set, signature: signature(set) };
    });

  const buckets = new Map<string, number[]>();
  items.forEach((item, index) => {
    for (let band = 0; band < BANDS; band += 1) {
      const key = `${band}:${Array.from(item.signature.subarray(band * ROWS, band * ROWS + ROWS)).join(",")}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(index);
      } else {
        buckets.set(key, [index]);
      }
    }
  });

  const parent = items.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) {
      root = parent[root]!;
    }
    let current = index;
    while (parent[current] !== root) {
      const next = parent[current]!;
      parent[current] = root;
      current = next;
    }
    return root;
  };

  const best = new Map<number, { other: number; similarity: number }>();
  const recordBest = (index: number, other: number, similarity: number) => {
    const existing = best.get(index);
    if (!existing || similarity > existing.similarity) {
      best.set(index, { other, similarity });
    }
  };

  const compared = new Set<string>();
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (compared.has(key)) {
          continue;
        }
        compared.add(key);
        const similarity = jaccard(items[a]!.set, items[b]!.set);
        if (similarity >= options.threshold) {
          parent[find(a)] = find(b);
          recordBest(a, b, similarity);
          recordBest(b, a, similarity);
        }
      }
    }
  }

  const groups = new Map<number, number[]>();
  items.forEach((_, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) {
      group.push(index);
    } else {
      groups.set(root, [index]);
    }
  });

  return [...groups.values()]
    .filter((group) => group.length >= options.minClusterSize)
    .map((group) => {
      const bestMatch = new Map<string, { ref: string; similarity: number }>();
      for (const index of group) {
        const match = best.get(index);
        if (match) {
          bestMatch.set(items[index]!.ref, { ref: items[match.other]!.ref, similarity: Math.round(match.similarity * 100) / 100 });
        }
      }
      return { refs: group.map((index) => items[index]!.ref).sort(), bestMatch };
    })
    .sort((a, b) => b.refs.length - a.refs.length || a.refs[0]!.localeCompare(b.refs[0]!));
}

/** One review check per clustered respondent. Similarity never excludes. */
export function similarityChecks(column: string, clusters: readonly SimilarityCluster[]): Map<string, AdvisoryCheck> {
  const result = new Map<string, AdvisoryCheck>();
  for (const cluster of clusters) {
    for (const ref of cluster.refs) {
      const others = cluster.refs.filter((other) => other !== ref);
      const shown = others.slice(0, 2).join(", ");
      const match = cluster.bestMatch.get(ref);
      result.set(ref, {
        layer: "similarity",
        source: "advisory",
        ruleId: `similarity:${column}`,
        outcome: "review",
        evidence: {
          summary: others.length > 2 ? `${column}: near-identical to ${shown} and ${others.length - 2} others` : `${column}: near-identical to ${shown}`,
          linkedRefs: others,
          values: { column, cluster_size: cluster.refs.length, closest: match?.ref ?? null, similarity: match?.similarity ?? null },
        },
      });
    }
  }
  return result;
}
