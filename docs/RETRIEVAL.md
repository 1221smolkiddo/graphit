# Evidence retrieval and context

Exact symbol/name/path matches and FTS5/BM25 supply candidates. RRF combines ranks; bounded Personalized PageRank follows evidenced code and memory relationships. Impact mode traverses the appropriate directions but is not exhaustive static dataflow analysis.

Context selects exact source spans, memory, graph paths and results with provenance. Deterministic MMR controls redundancy; utility/cost packing accounts for the complete canonical JSON packet, not just snippets. Superseded evidence is not silently treated as current. `budget_insufficient` and `mandatory_missing` expose lost requirements at small budgets.

The P3 estimator is `ceil(UTF-8 bytes / 4)`, with convergence accounting for packet metadata. It is provider-neutral, not an exact vendor token count. MCP returns the same canonical packet, without duplicating it in structured content. MCP transport/host framing is outside the P3 packet budget.

P5 refresh-work regression: about **27,652 → 1,960 estimated tokens**, **92.91% reduction**, **6/6 required evidence retained** at 2,000 tokens. The five representative query quality gates pass. At 1,000/500 tokens, insufficient-evidence flags are expected. Reproduce with `node examples/context-demo.mjs` after building; fixture identities and tie-breaks can shift totals slightly.

No embeddings, vector ranking, model calls or generated summaries. FTS corpus statistics are per database; extracting one project from a multi-project database may alter BM25 scores while retaining all selected-project evidence. Synchronous event replay is not optimized for very large histories.
