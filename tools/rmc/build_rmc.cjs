/* RMC Workbook with ASSUMED illustrative data.
   PHE = real reproduction; Ibuprofen/Pregabalin/Complex = fabricated demo data.
   Pipeline: cell maps -> HyperFormula (verify zero errors + cached results) -> ExcelJS (styling). */
const { HyperFormula } = require('hyperformula');
const ExcelJS = require('exceljs');
const ci = { B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, J: 10, K: 11 };
const F = f => ({ f }), V = v => ({ v });

// ---------- PHE (literal real reproduction) ----------
function pheSheet() {
  const cells = {}, role = {};
  const set = (a, val, r) => { cells[a] = val; if (r) role[a] = r; };
  set('B1', V('Krebs Biochemicals & Industries Limited'), 'title');
  set('B2', V('Estimated cost of RM per kg output for the Month 1st July 19 to 30th Sep 19'), 'title');
  set('B3', V('Product: Phenylephrine'), 'title');
  const hdr = { B: 'Name of the RM', C: 'Uom', D: 'Qty/batch', E: '%rec', F: 'fresh', G: 'stage CC', H: 'Product CC', I: 'Price', J: 'Stage Cost', K: 'Product Cost' };
  for (const k in hdr) set(k + '5', V(hdr[k]), 'header');
  const rows = [
    [7, V('Stage-1 & stage-2 inputs'), null, null, null, null, null, null, null, null, null, 'section'],
    [8, V('3 Hydroxy Acetophenone (KSM)'), V('Kg'), V(500), null, null, F('D8/$D$23'), F('G8*$H$26'), V(1675.3), F('G8*I8'), F('H8*I8')],
    [9, V('PHE 01'), V('Kg'), V(747.845), null, null, F('D9/$D$23'), F('G9*$H$26'), V(51.5), F('G9*I9'), F('H9*I9')],
    [10, V('Methanol'), V('Kgs'), F('600*0.791'), null, null, F('D10/$D$23'), F('G10*$H$26'), V(27), F('G10*I10'), F('H10*I10')],
    [11, V('MDC'), V('Kgs'), F('3500*1.326'), V(0.78), null, F('D11/$D$23*(1-E11)'), F('G11*$H$26'), V(57.62), F('G11*I11'), F('H11*I11')],
    [12, V('2-Butanol'), V('Kgs'), F('3000*0.8063'), V(0.7), F('D12*E12'), F('D12/$D$23*(1-E12)'), F('G12*$H$26'), V(88), F('G12*I12'), F('H12*I12')],
    [13, V('Stage-1 output in-situ'), null, null, null, null, null, null, null, null, null, 'section'],
    [14, V('PHE 03'), V('Kg'), V(24.05), null, null, F('D14/$D$23'), F('G14*$H$26'), V(130.35), F('G14*I14'), F('H14*I14')],
    [15, V('PHE 04'), V('Kg'), V(20), null, null, F('D15/$D$23'), F('G15*$H$26'), V(7018.9), F('G15*I15'), F('H15*I15')],
    [16, V('PHE 05'), V('gms'), V(200), null, F('D16*(1-E16)'), F('D16/$D$23'), F('G16*$H$26'), V(170), F('G16*I16'), F('H16*I16')],
    [17, V('2 Butanol'), V('Kgs'), F('300*0.8063'), V(0.7), null, F('D17/$D$23*(1-E17)'), F('G17*$H$26'), V(88), F('G17*I17'), F('H17*I17')],
    [18, V('Ethyl Acetate'), V('Kgs'), F('125*0.895'), V(0.3), null, F('D18/$D$23'), F('G18*$H$26'), V(62.75), F('G18*I18'), F('H18*I18')],
    [19, V('MDC'), V('Kgs'), F('1005*1.326'), V(0.6), null, F('D19/$D$23*(1-E19)'), F('G19*$H$26'), V(57.62), F('G19*I19'), F('H19*I19')],
    [20, V('Hyflow'), V('Kg'), V(20), null, null, F('D20/$D$23'), F('G20*$H$26'), V(68.02), F('G20*I20'), F('H20*I20')],
    [21, V('Nitrogen Cylinders'), V('No.s'), V(2), null, null, F('D21/$D$23'), F('G21*$H$26'), V(520.5), F('G21*I21'), F('H21*I21')],
    [22, V('No .of batches - (PHE-I19017 to PHE-I19024)'), V('No.s'), V(8), null, null, null, null, null, null, null, 'section'],
    [23, V('Stage-2 output'), V('Kg'), V(525.365), null, null, null, null, null, F('SUM(J8:J22)'), null, 'total'],
    [25, V('Stage-3 '), null, null, null, null, null, null, null, null, null, 'section'],
    [26, V('Stage-2 Input'), V('Kg'), V(300), null, null, F('D26/$D$32'), F('G26*$H$35'), F('J23'), F('G26*I26'), null],
    [27, V('Nitrogen Cylinders'), V('No.s'), V(2), null, null, F('D27/$D$32'), F('G27*$H$35'), V(520.5), F('G27*I27'), F('H27*I27')],
    [28, V('MMA '), V('Kg'), V(766.62), V(0.55), null, F('D28/$D$32*(1-E28)'), F('G28*$H$35'), V(151.21), F('G28*I28'), F('H28*I28')],
    [29, V('PHE 06'), V('Kg'), V(1.4), null, null, F('D29/$D$32'), F('G29*$H$35'), V(2166.92), F('G29*I29'), F('H29*I29')],
    [30, V('THF'), V('Kg'), F('3900*0.8046'), V(0.7), F('D30*(1-E30)'), F('D30/$D$32*(1-E30)'), F('G30*$H$35'), V(150.95), F('G30*I30'), F('H30*I30')],
    [31, V('No .of batches - (#08/018 to #09/035)'), V('No.s'), V(18), null, null, null, null, null, null, null, 'section'],
    [32, V('Stage-3 output'), V('Kg'), V(210), null, null, null, null, null, F('SUM(J26:J30)'), null, 'total'],
    [34, V('Stage-4 '), null, null, null, null, null, null, null, null, null, 'section'],
    [35, V('Stage-3 Input'), V('Kg'), V(330), null, null, F('D35/$D$41'), F('G35'), F('J32'), F('G35*I35'), null],
    [36, V('IPA '), V('Kg'), F('3250*0.78'), V(0.7), null, F('D36/$D$41*(1-E36)'), F('G36'), V(80.23), F('G36*I36'), F('J36')],
    [37, V('HCL'), V('Kg'), F('223.54*1.08'), null, null, F('D37/$D$41'), F('G37'), V(16), F('G37*I37'), F('J37')],
    [38, V('Hyflow'), V('Kg'), V(10), null, null, F('D38/$D$41'), F('G38'), V(67.02), F('G38*I38'), F('J38')],
    [39, V('Activated Carbon'), V('Kg'), V(22), null, null, F('D39/$D$41'), F('G39'), V(197.89), F('G39*I39'), F('J39')],
    [40, V('No .of batches (PHE-IV19014 to PHE-IV19024)'), V('No.s'), V(11), null, null, null, null, null, null, null, 'section'],
    [41, V('Stage-4 '), V('Kg'), V(360), null, null, null, null, null, F('SUM(J35:J39)'), F('SUM(K8:K39)'), 'grand'],
  ];
  for (const row of rows) {
    const r = row[0], keys = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
    for (let i = 0; i < keys.length; i++) if (row[i + 1] != null) set(keys[i] + r, row[i + 1], row[11]);
  }
  return { name: 'PHE (real)', cells, role, merges: ['B1:K1', 'B2:K2', 'B3:K3'], title: 'Phenylephrine' };
}

// ---------- Generic N-stage RMC generator ----------
function buildProduct(product, sheetName) {
  const cells = {}, role = {}, inputBlue = [];
  const set = (a, v, r) => { cells[a] = v; if (r) role[a] = r; };
  set('B1', V('Krebs Biochemicals & Industries Limited'), 'title');
  set('B2', V(product.period), 'title');
  set('B3', V('Product: ' + product.name + (product.assumed ? '   (ASSUMED ILLUSTRATIVE DATA)' : '')), 'title');
  const hdr = { B: 'Name of the RM', C: 'Uom', D: 'Qty/batch', E: '%rec', F: 'fresh', G: 'stage CC', H: 'Product CC', I: 'Price', J: 'Stage Cost', K: 'Product Cost' };
  for (const k in hdr) set(k + '5', V(hdr[k]), 'header');

  const n = product.stages.length;
  let r = 7; const layout = [];
  for (let s = 0; s < n; s++) {
    const st = product.stages[s], L = { header: r++ };
    L.prior = st.prior ? r++ : null;
    L.firstItem = r; L.items = st.items.map(() => r++); L.lastItem = r - 1;
    L.batches = r++; L.output = r++; r++;
    layout.push(L);
  }
  const firstItemAll = layout[0].firstItem, lastItemAll = layout[n - 1].lastItem;

  for (let s = 0; s < n; s++) {
    const st = product.stages[s], L = layout[s], outRow = L.output, isFinal = s === n - 1;
    const hdownRow = isFinal ? null : layout[s + 1].prior;
    set('B' + L.header, V(st.label || ('Stage-' + (s + 1))), 'section');
    const writeItem = (rr, name, uom, qty, recVal, price, isPrior) => {
      set('B' + rr, V(name), isPrior ? 'sectionlite' : null);
      set('C' + rr, V(uom));
      set('D' + rr, V(qty)); inputBlue.push('D' + rr);
      if (recVal != null) { set('E' + rr, V(recVal)); inputBlue.push('E' + rr); set('F' + rr, F(`D${rr}*(1-E${rr})`)); }
      const recMul = recVal != null ? `*(1-E${rr})` : '';
      set('G' + rr, F(`D${rr}/$D$${outRow}${recMul}`));
      set('H' + rr, isFinal ? F(`G${rr}`) : F(`G${rr}*$H$${hdownRow}`));
      if (isPrior) set('I' + rr, F(`J${layout[s - 1].output}`));
      else { set('I' + rr, V(price)); inputBlue.push('I' + rr); }
      set('J' + rr, F(`G${rr}*I${rr}`));
      if (!isPrior) set('K' + rr, F(`H${rr}*I${rr}`));
    };
    if (st.prior) writeItem(L.prior, st.prior.name, st.prior.uom || 'Kg', st.prior.qty, null, null, true);
    st.items.forEach((it, i) => writeItem(L.items[i], it.name, it.uom || 'Kg', it.qty, it.rec ?? null, it.price));
    set('B' + L.batches, V('No. of batches'), 'section'); set('C' + L.batches, V('No.s'));
    set('D' + L.batches, V(st.batchesQty ?? 1)); inputBlue.push('D' + L.batches);
    set('B' + outRow, V(st.outName || ('Stage-' + (s + 1) + ' output')), isFinal ? 'grand' : 'total');
    set('C' + outRow, V(st.outUom || 'Kg')); set('D' + outRow, V(st.outQty)); inputBlue.push('D' + outRow);
    const sumStart = st.prior ? L.prior : L.firstItem;
    set('J' + outRow, F(`SUM(J${sumStart}:J${L.lastItem})`));
    if (isFinal) set('K' + outRow, F(`SUM(K${firstItemAll}:K${lastItemAll})`), 'grand');
  }
  const totalRow = layout[n - 1].output + 2;
  set('B' + totalRow, V('RM Cost per kg of ' + product.name), 'grand');
  set('K' + totalRow, F(`K${layout[n - 1].output}`), 'grand');
  return { name: sheetName, cells, role, merges: ['B1:K1', 'B2:K2', 'B3:K3'], title: product.name, inputBlue, lastRow: totalRow };
}

// ---------- Assumed product definitions ----------
const PERIOD = 'Estimated cost of RM per kg output — assumed period';

const ibuprofen = {
  name: 'Ibuprofen', period: PERIOD, assumed: true,
  stages: [
    { label: 'Stage-1  (Friedel-Crafts acylation)', outName: 'Stage-1 output  (4-Isobutylacetophenone)', outQty: 520, batchesQty: 6,
      items: [
        { name: 'Isobutylbenzene (KSM)', qty: 600, price: 180 },
        { name: 'Acetic anhydride', qty: 450, price: 95 },
        { name: 'Hydrogen fluoride (catalyst)', qty: 30, price: 210 },
        { name: 'Toluene', qty: 800, rec: 0.75, price: 72 },
      ] },
    { label: 'Stage-2  (carbonylation / final)', outName: 'Stage-2 output  (Ibuprofen API)', outQty: 360, batchesQty: 9,
      prior: { name: 'Stage-1 Input (4-IBAP)', qty: 300 },
      items: [
        { name: 'Sodium cyanide', qty: 180, price: 140 },
        { name: 'Sulfuric acid', qty: 250, price: 18 },
        { name: 'MDC', qty: 900, rec: 0.7, price: 58 },
        { name: 'Activated carbon', qty: 15, price: 198 },
      ] },
  ],
};

const pregabalin = {
  name: 'Pregabalin', period: PERIOD, assumed: true,
  stages: [
    { label: 'Stage-1  (Knoevenagel)', outName: 'Stage-1 output  (PG-01)', outQty: 560, batchesQty: 6,
      items: [
        { name: 'Isovaleraldehyde (KSM)', qty: 500, price: 160 },
        { name: 'Diethyl malonate', qty: 640, price: 120 },
        { name: 'Piperidine (catalyst)', qty: 20, price: 280 },
        { name: 'Methanol', qty: 700, rec: 0.7, price: 27 },
      ] },
    { label: 'Stage-2  (cyanation)', outName: 'Stage-2 output  (PG-02)', outQty: 430, batchesQty: 8,
      prior: { name: 'Stage-1 Input (PG-01)', qty: 320 },
      items: [
        { name: 'Potassium cyanide', qty: 180, price: 150 },
        { name: 'Ethanol', qty: 600, rec: 0.72, price: 55 },
      ] },
    { label: 'Stage-3  (hydrogenation)', outName: 'Stage-3 output  (PG-03)', outQty: 380, batchesQty: 10,
      prior: { name: 'Stage-2 Input (PG-02)', qty: 300 },
      items: [
        { name: 'Raney Nickel', qty: 25, price: 520 },
        { name: 'Hydrogen', qty: 18, price: 320 },
        { name: 'IPA', qty: 650, rec: 0.7, price: 80 },
      ] },
    { label: 'Stage-4  (hydrolysis)', outName: 'Stage-4 output  (PG-04)', outQty: 360, batchesQty: 9,
      prior: { name: 'Stage-3 Input (PG-03)', qty: 320 },
      items: [
        { name: 'Sodium hydroxide', qty: 140, price: 35 },
        { name: 'Hydrochloric acid', qty: 200, price: 12 },
        { name: 'Toluene', qty: 700, rec: 0.75, price: 72 },
      ] },
    { label: 'Stage-5  (chiral resolution / final)', outName: 'Stage-5 output  (Pregabalin API)', outQty: 300, batchesQty: 11,
      prior: { name: 'Stage-4 Input (PG-04)', qty: 330 },
      items: [
        { name: '(S)-Mandelic acid', qty: 95, price: 1450 },
        { name: 'Activated carbon', qty: 14, price: 198 },
        { name: 'Acetone', qty: 500, rec: 0.7, price: 60 },
      ] },
  ],
};

// 10-stage fabricated complex API
function complexApi() {
  const stages = [];
  for (let s = 1; s <= 10; s++) {
    const isFinal = s === 10;
    stages.push({
      label: `Stage-${s}`,
      outName: isFinal ? 'Stage-10 output  (Complex API)' : `Stage-${s} output  (INT-${String(s).padStart(2, '0')})`,
      outQty: 600 - s * 25, batchesQty: 4 + (s % 5),
      prior: s === 1 ? null : { name: `Stage-${s - 1} Input (INT-${String(s - 1).padStart(2, '0')})`, qty: 320 - s * 5 },
      items: [
        { name: `Reagent ${s}A`, qty: 300 + s * 10, price: 90 + s * 12 },
        { name: `Reagent ${s}B`, qty: 150 + s * 6, price: 60 + s * 8 },
        { name: `Solvent ${s}C`, qty: 650 - s * 15, rec: 0.7, price: 45 + s * 3 },
      ],
    });
  }
  return { name: 'Complex API (10-stage)', period: PERIOD, assumed: true, stages };
}

// ---------- HyperFormula compute + verify ----------
function compute(sheets) {
  const hf = HyperFormula.buildEmpty({ licenseKey: 'gpl-v3' });
  const idOf = {};
  for (const sh of sheets) {
    let maxR = 1, maxC = 1;
    for (const a in sh.cells) { const m = a.match(/^([A-Z]+)(\d+)$/); maxR = Math.max(maxR, +m[2]); maxC = Math.max(maxC, ci[m[1]]); }
    const data = Array.from({ length: maxR }, () => Array(maxC).fill(null));
    for (const a in sh.cells) { const m = a.match(/^([A-Z]+)(\d+)$/), c = ci[m[1]] - 1, rr = +m[2] - 1; const cell = sh.cells[a]; data[rr][c] = cell.f != null ? '=' + cell.f : cell.v; }
    const sid = hf.addSheet(sh.name); const sheetId = hf.getSheetId(sid); hf.setSheetContent(sheetId, data); idOf[sh.name] = sheetId;
  }
  const results = {}, errors = [];
  for (const sh of sheets) {
    const sid = idOf[sh.name]; results[sh.name] = {};
    for (const a in sh.cells) {
      if (sh.cells[a].f == null) continue;
      const m = a.match(/^([A-Z]+)(\d+)$/), c = ci[m[1]] - 1, rr = +m[2] - 1;
      const val = hf.getCellValue({ sheet: sid, row: rr, col: c });
      results[sh.name][a] = val;
      if (val && typeof val === 'object' && val.type) errors.push(`${sh.name}!${a} -> ${val.type}`);
      if (typeof val === 'number' && !isFinite(val)) errors.push(`${sh.name}!${a} -> NON_FINITE`);
    }
  }
  hf.destroy();
  return { results, errors };
}

// ---------- Styling ----------
const THIN = { style: 'thin', color: { argb: 'FF000000' } };
function styleFor(addr, role, col, inputBlue) {
  const f = { name: 'Calibri', size: 11 };
  const s = { font: f, alignment: {}, border: {} };
  if (role === 'title') { f.bold = true; s.alignment = { horizontal: 'center', vertical: 'middle' }; s.border = { top: THIN, bottom: THIN, left: THIN, right: THIN }; }
  else if (role === 'header') { f.bold = true; f.size = 10; s.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; s.border = { top: THIN, bottom: THIN, left: THIN, right: THIN }; }
  else if (role === 'section') { f.bold = true; s.border = { left: THIN, right: THIN }; }
  else if (role === 'sectionlite') { f.italic = true; s.border = { left: THIN, right: THIN }; }
  else if (role === 'total') { f.bold = true; s.border = { left: THIN, right: THIN, bottom: THIN }; }
  else if (role === 'grand') { f.bold = true; s.border = { left: THIN, right: THIN, top: THIN, bottom: THIN }; }
  else s.border = { left: THIN, right: THIN };
  if (['D', 'F', 'G', 'H', 'I', 'J', 'K'].includes(col)) { s.numFmt = '0.00'; if (!s.alignment.horizontal) s.alignment.horizontal = 'right'; }
  if (col === 'E') { s.numFmt = '0.00%'; if (!s.alignment.horizontal) s.alignment.horizontal = 'right'; }
  if (inputBlue && inputBlue.includes(addr)) f.color = { argb: 'FF0000FF' };
  return s;
}

function addReadme(wb) {
  const ws = wb.addWorksheet('README', { views: [{ showGridLines: false }] });
  ws.getColumn('A').width = 3; ws.getColumn('B').width = 22; ws.getColumn('C').width = 92;
  const lines = [
    ['title', 'RMC Workbook — how to use'],
    ['', ''],
    ['note', 'DATA STATUS: PHE (real) reproduces your PHE RMC.xlsx. Ibuprofen, Pregabalin and Complex API use ASSUMED illustrative numbers (no SAP dump yet) to demonstrate the format. Replace blue cells with real SAP values.'],
    ['', ''],
    ['h', 'What this is'],
    ['p', 'Cascading raw-material cost (RMC) build-up. Each stage rolls its materials up to cost per kg of final API.'],
    ['', ''],
    ['h', 'Tabs'],
    ['kv', 'PHE (real)|Verified reproduction of Phenylephrine (4 stages). Total RM = Rs 4140.05/kg.'],
    ['kv', 'Ibuprofen|2-stage worked example (assumed).'],
    ['kv', 'Pregabalin|5-stage worked example (assumed).'],
    ['kv', 'Complex API (10-stage)|10-stage worked example (assumed).'],
    ['', ''],
    ['h', 'Columns'],
    ['kv', 'Qty/batch (D)|Input quantity charged per batch.'],
    ['kv', '%rec (E)|Solvent recovery fraction; fresh make-up F = D*(1-%rec).'],
    ['kv', 'stage CC (G)|Per kg of THIS stage output = D / stage output (x (1-%rec) if recovered).'],
    ['kv', 'Product CC (H)|Per kg of FINAL API. Final stage =G; earlier stages =G x downstream stage-input H (chains backward).'],
    ['kv', 'Price (I)|Rate per UoM. "Stage-n Input" rows link to prior stage cost (=J of prior output).'],
    ['kv', 'Stage Cost (J)|=G*I, summed at each stage output row.'],
    ['kv', 'Product Cost (K)|=H*I; final stage output K = SUM of all item K = RM cost per kg API.'],
    ['', ''],
    ['h', 'SAP dump -> columns'],
    ['kv', 'Material text -> B|Base UoM -> C|'],
    ['kv', 'Component qty/order -> D|Stage GR (output) qty -> output row D|'],
    ['kv', 'Recovery % -> E|Moving avg / std price -> I|'],
    ['p', 'One stage block per intermediate; prior intermediate enters next stage as a "Stage-n Input" row (no Product Cost, to avoid double counting).'],
    ['', ''],
    ['h', 'Colour key'],
    ['kv', 'Blue|Hardcoded inputs you edit.|'],
    ['kv', 'Black|Formulas — do not overwrite.|'],
  ];
  let r = 2;
  for (const [kind, txt] of lines) {
    if (kind === 'title') { const c = ws.getCell('B' + r); c.value = txt; c.font = { name: 'Calibri', size: 14, bold: true }; }
    else if (kind === 'h') { const c = ws.getCell('B' + r); c.value = txt; c.font = { name: 'Calibri', size: 11, bold: true }; }
    else if (kind === 'p') { const c = ws.getCell('B' + r); ws.mergeCells('B' + r + ':C' + r); c.value = txt; c.font = { name: 'Calibri', size: 10 }; c.alignment = { wrapText: true, vertical: 'top' }; ws.getRow(r).height = 28; }
    else if (kind === 'note') { const c = ws.getCell('B' + r); ws.mergeCells('B' + r + ':C' + r); c.value = txt; c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFC00000' } }; c.alignment = { wrapText: true, vertical: 'top' }; ws.getRow(r).height = 42; }
    else if (kind === 'kv') { const p = txt.split('|'); const a = ws.getCell('B' + r), b = ws.getCell('C' + r); a.value = p[0]; a.font = { name: 'Calibri', size: 10, bold: true }; a.alignment = { vertical: 'top' }; b.value = p[1]; b.font = { name: 'Calibri', size: 10 }; b.alignment = { wrapText: true, vertical: 'top' }; }
    r++;
  }
}

async function writeWorkbook(sheets, results, outPath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RMC Builder'; wb.calcProperties = { fullCalcOnLoad: true };
  addReadme(wb);
  const widths = { A: 3, B: 41.29, C: 5.29, D: 9.43, E: 9.29, F: 7.86, G: 7.86, H: 7.86, I: 9.29, J: 10.43, K: 10.71 };
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name, { views: [{ showGridLines: false }] });
    for (const c in widths) ws.getColumn(c).width = widths[c];
    for (const a in sh.cells) {
      const m = a.match(/^([A-Z]+)(\d+)$/), col = m[1], cell = sh.cells[a], xc = ws.getCell(a);
      if (cell.f != null) { let res = results[sh.name][a]; if (res && typeof res === 'object') res = 0; xc.value = { formula: cell.f, result: res }; }
      else xc.value = cell.v;
      xc.style = styleFor(a, sh.role[a], col, sh.inputBlue);
    }
    (sh.merges || []).forEach(mg => ws.mergeCells(mg));
    ws.getRow(5).height = 28;
  }
  await wb.xlsx.writeFile(outPath);
}

(async () => {
  const sheets = [
    pheSheet(),
    buildProduct(ibuprofen, 'Ibuprofen'),
    buildProduct(pregabalin, 'Pregabalin'),
    buildProduct(complexApi(), 'Complex API (10-stage)'),
  ];
  const { results, errors } = compute(sheets);
  if (errors.length) { console.error('FORMULA ERRORS:\n' + errors.join('\n')); process.exit(1); }
  const tot = sh => results[sh.name]['K' + (sh.lastRow || 41)];
  console.log('No formula errors. RM cost per kg of API:');
  console.log('  PHE       :', results['PHE (real)']['K41'].toFixed(2));
  console.log('  Ibuprofen :', tot(sheets[1]).toFixed(2));
  console.log('  Pregabalin:', tot(sheets[2]).toFixed(2));
  console.log('  Complex   :', tot(sheets[3]).toFixed(2));
  const out = process.argv[2] || 'RMC Workbook.xlsx';
  await writeWorkbook(sheets, results, out);
  console.log('WROTE', out);
})();
