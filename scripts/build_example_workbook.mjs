import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "outputs/examples";
const previewDir = ".artifact-work/previews";
const markdown = await fs.readFile("examples/transformer-paper.md", "utf8");
const normalizedMarkdown = markdown.replaceAll("\r\n", "\n");
const pages = normalizedMarkdown.split(/\n---\n/g).length;
const characters = [...normalizedMarkdown].length;
const workbook = Workbook.create();
const runs = workbook.worksheets.add("LLM Runs");
const pdf = workbook.worksheets.add("PDF Conversion");
const preview = workbook.worksheets.add("Markdown Preview");

const ink = "#17352E", accent = "#D57742", pale = "#E8EEEA", line = "#D4D9D3";
const title = range => { range.format = {fill: ink, font: {bold: true, color: "#FFFFFF", size: 18}}; range.format.rowHeight = 34; };
const header = range => { range.format = {fill: ink, font: {bold: true, color: "#FFFFFF"}, borders: {preset: "outside", style: "thin", color: ink}}; };
const label = range => { range.format = {fill: pale, font: {bold: true, color: ink}}; };

runs.showGridLines = false;
runs.getRange("A1:I1").merge();
runs.getRange("A1").values = [["LLM Experiment Results · Example"]];
title(runs.getRange("A1:I1"));
runs.getRange("A2:I2").merge();
runs.getRange("A2").values = [["DEMO DATA — 앱의 CSV/Excel 내보내기 구조를 보여주는 예시이며 실제 모델 측정값이 아닙니다."]];
runs.getRange("A2:I2").format = {fill: "#FFF3E8", font: {italic: true, color: "#7A472A"}};
runs.getRange("A3:E4").values = [
  ["Samples", null, null, "Success rate", null],
  ["Avg TTFT (ms)", null, null, "Avg output TPS", null],
];
runs.getRange("A3:A4").format = {fill: pale, font: {bold: true, color: ink}};
runs.getRange("D3:D4").format = {fill: pale, font: {bold: true, color: ink}};
runs.getRange("B3").formulas = [["=COUNTA(A8:A10)"]];
runs.getRange("E3").formulas = [["=COUNTIF(I8:I10,\"success\")/B3"]];
runs.getRange("B4").formulas = [["=AVERAGE(D8:D10)"]];
runs.getRange("E4").formulas = [["=AVERAGE(H8:H10)"]];
runs.getRange("B3:B4").format = {font: {bold: true, color: accent, size: 14}, numberFormat: "0.0"};
runs.getRange("E3").format.numberFormat = "0.0%";
runs.getRange("E4").format.numberFormat = "0.00";
runs.getRange("A7:I10").values = [
  ["Run", "Model", "Prompt", "TTFT ms", "Total ms", "Generation ms", "Output tokens", "Output TPS", "Status"],
  ["demo-001", "local-model", "Transformer 논문의 핵심 기여를 5줄로 요약해줘.", 184.2, 2230.5, 2046.3, 312, null, "success"],
  ["demo-002", "local-model", "Self-attention의 시간 복잡도를 설명해줘.", 201.7, 2488.9, 2287.2, 338, null, "success"],
  ["demo-003", "local-model", "논문의 BLEU 결과를 표로 정리해줘.", 176.4, 2114.8, 1938.4, 286, null, "success"],
];
runs.getRange("H8").formulas = [["=G8/(F8/1000)"]];
runs.getRange("H8:H10").fillDown();
header(runs.getRange("A7:I7"));
runs.getRange("D8:H10").format.numberFormat = "0.00";
runs.getRange("A7:I10").format.borders = {insideHorizontal: {style: "thin", color: line}, bottom: {style: "thin", color: line}};
runs.freezePanes.freezeRows(7);
runs.getRange("A:A").format.columnWidth = 14;
runs.getRange("B:B").format.columnWidth = 18;
runs.getRange("C:C").format.columnWidth = 42;
runs.getRange("D:I").format.columnWidth = 14;

pdf.showGridLines = false;
pdf.getRange("A1:D1").merge();
pdf.getRange("A1").values = [["PDF → Markdown · Transformer Paper"]];
title(pdf.getRange("A1:D1"));
pdf.getRange("A3:B10").values = [
  ["Conversion metric", "Value"],
  ["Library", "PyMuPDF4LLM 1.28.0"],
  ["Input", "Attention Is All You Need (arXiv:1706.03762)"],
  ["Pages", pages],
  ["Markdown characters", characters],
  ["Conversion time (ms)", 3738.6],
  ["Generated file", "examples/transformer-paper.md"],
  ["Conversion status", "success"],
];
header(pdf.getRange("A3:B3"));
label(pdf.getRange("A4:A10"));
pdf.getRange("B6:B8").format.numberFormat = "#,##0.0";
pdf.getRange("A12:D16").values = [
  ["Paper-reported result", "English→German BLEU", "English→French BLEU", "Training setup"],
  ["Transformer (big)", 28.4, 41.8, "3.5 days · 8 × P100 GPUs"],
  ["Transformer (base)", 27.3, 38.1, "12 hours · 8 × P100 GPUs"],
  [null, null, null, null],
  ["Note", "논문에 보고된 수치이며 이 앱에서 재현한 벤치마크가 아닙니다.", null, null],
];
header(pdf.getRange("A12:D12"));
pdf.getRange("B16:D16").merge();
pdf.getRange("A16:D16").format = {fill: "#FFF3E8", font: {italic: true, color: "#7A472A"}};
pdf.getRange("A18:B20").values = [
  ["Source", "URL"],
  ["Paper", "https://arxiv.org/abs/1706.03762"],
  ["Library docs", "https://pymupdf.readthedocs.io/en/latest/pymupdf4llm/index.html"],
];
header(pdf.getRange("A18:B18"));
pdf.getRange("A:D").format.autofitColumns();
pdf.getRange("B:B").format.columnWidth = 55;
pdf.getRange("C:C").format.columnWidth = 25;
pdf.getRange("D:D").format.columnWidth = 30;

preview.showGridLines = false;
preview.getRange("A1:B1").merge();
preview.getRange("A1").values = [["Markdown Preview"]];
title(preview.getRange("A1:B1"));
preview.getRange("A2:B2").merge();
preview.getRange("A2").values = [["전체 결과: examples/transformer-paper.md · 아래는 제목/초록 중심 미리보기입니다."]];
preview.getRange("A2:B2").format = {fill: pale, font: {italic: true, color: ink}};
const lines = normalizedMarkdown.split("\n").filter(Boolean).slice(0, 14).map((text, index) => [index + 1, text.slice(0, 900)]);
const previewLastRow = 4 + lines.length;
preview.getRange(`A4:B${previewLastRow}`).values = [["Line", "Markdown"], ...lines];
header(preview.getRange("A4:B4"));
preview.getRange(`B5:B${previewLastRow}`).format.wrapText = true;
preview.getRange(`A5:A${previewLastRow}`).format = {fill: pale, font: {color: ink}, horizontalAlignment: "center"};
preview.getRange("A:A").format.columnWidth = 9;
preview.getRange("B:B").format.columnWidth = 100;
preview.getRange(`A5:B${previewLastRow}`).format.autofitRows();
preview.freezePanes.freezeRows(4);

const check = await workbook.inspect({kind: "table", range: "LLM Runs!A1:I10", include: "values,formulas", tableMaxRows: 12, tableMaxCols: 10});
console.log(check.ndjson);
const errors = await workbook.inspect({kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: {useRegex: true, maxResults: 100}, summary: "formula error scan"});
console.log(errors.ndjson);

await fs.mkdir(outputDir, {recursive: true});
await fs.mkdir(previewDir, {recursive: true});
for (const sheetName of ["LLM Runs", "PDF Conversion", "Markdown Preview"]) {
  const image = await workbook.render({sheetName, autoCrop: "all", scale: 1, format: "png"});
  await fs.writeFile(`${previewDir}/${sheetName.replaceAll(" ", "-")}.png`, new Uint8Array(await image.arrayBuffer()));
}
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/transformer-paper-results.xlsx`);
await fs.rm(`${outputDir}/transformer-paper-results.xlsx.inspect.ndjson`, {force: true});
