export function retrievalMetrics(rankedIds: readonly string[], requiredIds: readonly string[], k: number) {
  const required = [...new Set(requiredIds)]; const hits = new Set(rankedIds.slice(0,k));
  const first = rankedIds.findIndex((id) => required.includes(id));
  return { recall_at_k: required.length ? required.filter((id) => hits.has(id)).length/required.length : 1,
    mrr: first < 0 ? 0 : 1/(first+1) };
}
export function evidenceQuality(selectedIds: readonly string[], requiredIds: readonly string[]) {
  const missing = [...new Set(requiredIds)].filter((id) => !selectedIds.includes(id)).sort();
  return { passed: missing.length === 0, required_evidence_recall: requiredIds.length ? 1-missing.length/new Set(requiredIds).size : 1, missing };
}
