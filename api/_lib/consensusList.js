// The consensus panel, derived from the one registry (api/_lib/gurus.js):
// concentrated, actively-managed, discretionary books. Quant giants
// (Citadel, Millennium, RenTech…), market makers and index-like books are
// tracked but flagged `consensus: false`: thousands of algorithmic positions
// make "consensus" meaningless. A fund that stopped filing carries
// `activeTo` and is off the panel so a year-old book stops voting.
//
// Kept for the imports that used it; `ceased` mirrors `activeTo` for them.
import { GURUS } from './gurus.js';

export const CONSENSUS_MANAGERS = GURUS.filter((g) => g.consensus !== false).map((g) => ({
  cik: g.cik,
  name: g.name,
  ...(g.activeTo ? { ceased: g.activeTo } : {}),
  ...(g.successor ? { successor: g.successor } : {}),
}));
