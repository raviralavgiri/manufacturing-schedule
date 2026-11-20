/**
 * Column positions (1-based) of the "API" sheet in the Excel template.
 * Shared by the exporter and the importer so the two can never drift.
 *
 * Current layout follows the APIs tab, left to right:
 *   API Name · Seq · Block · Camp/yr · Q split · Plan window (start, end)
 *   · Stages · Target (kg) · Stage flow
 * then the Stage-flow detail columns and the per-quarter campaign sequence.
 * `API_COLS_LEGACY` is the previous layout (Target kg in column F), still
 * accepted on import.
 */
export interface ApiSheetCols {
  slNo: number;
  name: number;
  seq: number;
  block: number;
  camp: number;
  split: number;
  start: number;
  end: number;
  totalStages: number;
  target: number;
  flow: number;
  mainStages: number;
  /** Side chain i (0..2): merge = sc[i], factor = sc[i]+1, length = sc[i]+2. */
  sc: [number, number, number];
  /** Parallel sub-chain lengths A, B, C. */
  par: [number, number, number];
  /** Parallel branch factors f1 (B) and f2 (C). */
  parFactor: [number, number];
  forkShared: number;
  forkBranches: number;
  forkPerBranch: number;
  qSequence: number;
}

export const API_COLS: ApiSheetCols = {
  slNo: 2, // B
  name: 3, // C  API Name
  seq: 4, // D  Seq
  block: 5, // E  Block
  camp: 6, // F  Camp/yr
  split: 7, // G  Q split
  start: 8, // H  Plan window start
  end: 9, // I  Plan window end
  totalStages: 10, // J  Stages
  target: 11, // K  Target (kg)
  flow: 12, // L  Stage flow
  mainStages: 13, // M
  sc: [14, 17, 20], // N–P · Q–S · T–V
  par: [23, 24, 25], // W X Y
  parFactor: [26, 27], // Z AA
  forkShared: 28, // AB
  forkBranches: 29, // AC
  forkPerBranch: 30, // AD
  qSequence: 31, // AE
};

export const API_COLS_LEGACY: ApiSheetCols = {
  slNo: 2,
  name: 3,
  seq: 4,
  block: 5,
  target: 6,
  start: 7,
  end: 8,
  flow: 9,
  totalStages: 10,
  mainStages: 11,
  sc: [12, 15, 18],
  par: [21, 22, 23],
  parFactor: [24, 25],
  forkShared: 26,
  forkBranches: 27,
  forkPerBranch: 28,
  camp: 29,
  split: 30,
  qSequence: 31,
};

/** Row-5 header labels of the current API sheet, by column. */
export const API_SHEET_LABELS: [number, string][] = [
  [API_COLS.slNo, "Sl.No"],
  [API_COLS.name, "API Name"],
  [API_COLS.seq, "Seq"],
  [API_COLS.block, "Block"],
  [API_COLS.camp, "Camp/yr"],
  [API_COLS.split, "Q split (Q1,Q2,Q3,Q4)"],
  [API_COLS.start, "Plan window start"],
  [API_COLS.end, "Plan window end"],
  [API_COLS.totalStages, "Stages"],
  [API_COLS.target, "Target (kg)"],
  [API_COLS.flow, "Stage flow"],
  [API_COLS.mainStages, "Main stages"],
  ...API_COLS.sc.flatMap((c, i): [number, string][] => [
    [c, `SC${i + 1} merge`],
    [c + 1, `SC${i + 1} factor`],
    [c + 2, `SC${i + 1} len`],
  ]),
  [API_COLS.par[0], "Par subA"],
  [API_COLS.par[1], "Par subB"],
  [API_COLS.par[2], "Par subC"],
  [API_COLS.parFactor[0], "f1"],
  [API_COLS.parFactor[1], "f2"],
  [API_COLS.forkShared, "Shared preamble"],
  [API_COLS.forkBranches, "Branches"],
  [API_COLS.forkPerBranch, "Stages/branch"],
  [API_COLS.qSequence, "Q sequence (Q1,Q2,Q3,Q4)"],
];

/** The current layout is recognised by its column-F header "Camp/yr". */
export function isCurrentApiLayout(headerF: string | null): boolean {
  return /camp/i.test(headerF ?? "");
}
