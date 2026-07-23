import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const SHEETS = {
  official: "\u6b63\u5f0f\u9898\u5e93",
  sources: "\u6765\u6e90\u7d22\u5f15",
  pending: "\u5f85\u590d\u6838\u9898",
  retired: "\u505c\u7528\u9898",
  statistics: "\u9898\u91cf\u7edf\u8ba1",
};

const QUESTION_HEADERS = [
  "ID",
  "\u804c\u4e1a\u4ee3\u7801",
  "\u804c\u4e1a\u540d\u79f0",
  "\u65b9\u5411",
  "\u7b49\u7ea7",
  "\u6a21\u5757",
  "\u4e3b\u9898",
  "\u9898\u578b",
  "\u9898\u5e72",
  "\u9009\u9879",
  "\u7b54\u6848",
  "\u89e3\u6790",
  "\u96be\u5ea6",
  "\u5173\u952e\u8bcd",
  "\u6765\u6e90 ID",
  "\u6807\u51c6\u4f9d\u636e",
  "\u5ba1\u6838\u72b6\u6001",
  "\u7248\u672c",
  "\u751f\u6548\u65e5\u671f",
  "\u5931\u6548\u65e5\u671f",
  "\u91cd\u590d\u7ec4",
];

const SOURCE_HEADERS = [
  "\u6765\u6e90 ID",
  "\u6807\u9898",
  "URL",
  "\u53d1\u5e03\u65b9",
  "\u53d1\u5e03\u65e5\u671f",
  "\u8bbf\u95ee\u65e5\u671f",
  "\u7c7b\u578b",
  "\u7528\u9014",
  "\u662f\u5426\u542f\u7528",
  "\u5907\u6ce8",
];

const STAT_HEADERS = ["\u6570\u636e\u7c7b\u578b", "\u7ef4\u5ea6", "\u952e", "\u6570\u91cf", "\u8bf4\u660e"];

function columnName(columnCount) {
  let index = columnCount;
  let name = "";
  while (index > 0) {
    index -= 1;
    name = String.fromCharCode(65 + (index % 26)) + name;
    index = Math.floor(index / 26);
  }
  return name;
}

function compactJson(value) {
  return JSON.stringify(value ?? [], null, 0);
}

function questionRow(question) {
  return [
    question.id,
    question.occupation_code,
    question.occupation_name,
    question.direction,
    question.level,
    question.module,
    question.topic,
    question.type,
    question.stem,
    compactJson(question.options),
    compactJson(question.answer),
    question.explanation,
    question.difficulty,
    compactJson(question.keywords),
    compactJson(question.source_ids),
    question.standard_reference,
    question.review_status,
    question.content_version,
    question.valid_from,
    question.valid_until ?? "",
    question.duplicate_group ?? "",
  ];
}

function sourceRow(source) {
  return [
    source.id,
    source.title,
    source.url,
    source.publisher,
    source.published_at ?? "",
    source.accessed_at,
    source.kind,
    source.usage,
    source.is_active ? "\u662f" : "\u5426",
    source.notes,
  ];
}

function statisticRows(payload) {
  const rows = [];
  for (const [dimension, counts] of Object.entries(payload.stats)) {
    for (const [key, count] of Object.entries(counts)) {
      rows.push(["\u9898\u5e93\u7edf\u8ba1", dimension, key, count, ""]);
    }
  }
  for (const issue of payload.report.errors) {
    rows.push([
      "\u6821\u9a8c\u9519\u8bef",
      issue.code,
      issue.question_id ?? "",
      "",
      issue.message,
    ]);
  }
  for (const issue of payload.report.warnings) {
    rows.push([
      "\u6821\u9a8c\u8b66\u544a",
      issue.code,
      issue.question_id ?? "",
      "",
      issue.message,
    ]);
  }
  return rows;
}

function addDataSheet(workbook, name, headers, rows, tableName, widths, bodyHeight) {
  const sheet = workbook.worksheets.add(name);
  const matrix = [headers, ...rows];
  const usedRange = sheet.getRangeByIndexes(0, 0, matrix.length, headers.length);
  usedRange.values = matrix;
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);

  const headerRange = sheet.getRangeByIndexes(0, 0, 1, headers.length);
  headerRange.format = {
    fill: "#0F766E",
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#B7D8D2" },
  };
  headerRange.format.rowHeight = 28;
  usedRange.format.borders = { preset: "all", style: "thin", color: "#D7E3E0" };
  if (rows.length > 0) {
    const bodyRange = sheet.getRangeByIndexes(1, 0, rows.length, headers.length);
    bodyRange.format.wrapText = true;
    bodyRange.format.verticalAlignment = "top";
    bodyRange.format.rowHeight = bodyHeight;
    sheet.tables.add(`A1:${columnName(headers.length)}${matrix.length}`, true, tableName);
  }
  for (let index = 0; index < headers.length; index += 1) {
    sheet.getRangeByIndexes(0, index, matrix.length, 1).format.columnWidth =
      widths[index] ?? 16;
  }
  return sheet;
}

async function build(inputPath, outputPath) {
  const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const questions = payload.questions;
  const workbook = Workbook.create();
  const wideQuestionColumns = [16, 16, 16, 16, 8, 18, 18, 12, 36, 38, 18, 36, 12, 20, 22, 24, 14, 10, 14, 14, 16];

  addDataSheet(
    workbook,
    SHEETS.official,
    QUESTION_HEADERS,
    questions.filter((question) => question.review_status === "verified").map(questionRow),
    "OfficialQuestions",
    wideQuestionColumns,
    96,
  );
  addDataSheet(
    workbook,
    SHEETS.sources,
    SOURCE_HEADERS,
    payload.sources.map(sourceRow),
    "SourceIndex",
    [16, 30, 42, 22, 14, 14, 18, 18, 12, 34],
    72,
  );
  addDataSheet(
    workbook,
    SHEETS.pending,
    QUESTION_HEADERS,
    questions.filter((question) => question.review_status === "pending").map(questionRow),
    "PendingQuestions",
    wideQuestionColumns,
    96,
  );
  addDataSheet(
    workbook,
    SHEETS.retired,
    QUESTION_HEADERS,
    questions.filter((question) => question.review_status === "retired").map(questionRow),
    "RetiredQuestions",
    wideQuestionColumns,
    96,
  );
  addDataSheet(
    workbook,
    SHEETS.statistics,
    STAT_HEADERS,
    statisticRows(payload),
    "QuestionStatistics",
    [18, 22, 24, 12, 52],
    28,
  );

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  await xlsx.save(outputPath);
}

async function inspect(inputPath, renderDirectory) {
  const file = await FileBlob.load(inputPath);
  const workbook = await SpreadsheetFile.importXlsx(file);
  await workbook.inspect({ kind: "workbook,sheet,table", maxChars: 4000 });
  const sheets = workbook.worksheets.items.map((sheet) => sheet.name);
  const values = {};
  const tableCounts = {};
  for (const sheet of workbook.worksheets.items) {
    values[sheet.name] = sheet.getUsedRange().values;
    tableCounts[sheet.name] = sheet.tables.items.length;
  }
  if (renderDirectory) {
    await fs.mkdir(renderDirectory, { recursive: true });
    for (const [index, sheetName] of sheets.entries()) {
      const preview = await workbook.render({
        sheetName,
        autoCrop: "all",
        scale: 1,
        format: "png",
      });
      await fs.writeFile(
        path.join(renderDirectory, `sheet-${index + 1}.png`),
        new Uint8Array(await preview.arrayBuffer()),
      );
    }
  }
  process.stdout.write(JSON.stringify({ sheets, table_counts: tableCounts, values }));
}

const [command, inputPath, outputPath, renderDirectory] = process.argv.slice(2);
if (command === "build" && inputPath && outputPath) {
  await build(inputPath, outputPath);
} else if (command === "inspect" && inputPath) {
  await inspect(inputPath, outputPath);
} else {
  throw new Error("usage: review_workbook.mjs build <input.json> <output.xlsx> | inspect <input.xlsx> [render-dir]");
}
