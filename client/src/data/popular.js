// The curated superinvestors, for the browser. The list itself lives in
// api/_lib/gurus.js (one registry for every page, endpoint and build); this
// module only keeps the names the client code imports.
//
// `history: false` marks a filer whose info table is too wide to backfill
// forty quarters of; `activeTo` marks a fund that stopped filing (kept, with
// its history, but no longer counted as tracked); `consensus: false` marks a
// wide or systematic book that is tracked but not a vote in the consensus.
export { GURUS as POPULAR_MANAGERS, managerStyle, wantsHistory, isActive, activeGurus, guruByCik } from '../../../api/_lib/gurus.js';
