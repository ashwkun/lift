/**
 * CSV reading, to the extent RFC 4180 and real exports agree.
 *
 * Hand-rolled rather than pulled from npm because this package carries one
 * dependency and the mobile bundle is the reason. The parts that actually
 * matter for workout exports are the quoting rules: an exercise called
 * `Seated Row - "V" Grip` and a workout note containing a newline both appear
 * in real files, and the delimiter, which is not always a comma.
 */

/** A parsed file: the header row, and every data row padded to match it. */
export interface CsvTable {
  header: string[];
  rows: string[][];
  /** Which separator was detected. Reported so a misdetection is diagnosable. */
  delimiter: string;
}

/**
 * Candidates, in the order a tie is broken.
 *
 * Semicolons come from spreadsheets saved in locales where the comma is the
 * decimal separator, which is also why `parseNumber` has to handle `52,5`.
 */
const DELIMITERS = [',', ';', '\t', '|'] as const;

export function parseCsv(text: string): CsvTable {
  const body = stripBom(text);
  const delimiter = sniffDelimiter(body);
  const rows = tokenize(body, delimiter);

  const header = rows.shift() ?? [];
  const width = header.length;

  return {
    header: header.map((cell) => cell.trim()),
    // Ragged rows are real: a trailing empty column gets dropped by some
    // exporters. Padding here means every downstream read is positional and
    // safe rather than guarded at each call site.
    rows: rows.map((row) => (row.length === width ? row : resize(row, width))),
    delimiter,
  };
}

/**
 * Picks the separator by counting candidates in the header line only.
 *
 * The header is the one line guaranteed to be free of user-authored text, so
 * counting there can't be thrown off by a workout note full of commas.
 */
function sniffDelimiter(text: string): string {
  const firstLine = tokenizeFirstLine(text);

  let best: string = DELIMITERS[0];
  let bestCount = 0;

  for (const candidate of DELIMITERS) {
    let count = 0;
    for (const char of firstLine) if (char === candidate) count += 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

/**
 * The header line with quoted sections removed.
 *
 * A header of `"Weight, kg","Reps"` has a comma inside a field, and counting it
 * would score the comma one higher than it deserves. Rare in a header, free to
 * rule out.
 */
function tokenizeFirstLine(text: string): string {
  let out = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (char === '\n' || char === '\r')) break;
    if (!quoted) out += char;
  }

  return out;
}

/**
 * Splits the whole file into rows of fields.
 *
 * A single state machine over the characters, because the alternative.
 * Splitting on newlines first. Breaks on any field containing one, and workout
 * descriptions contain them.
 */
function tokenize(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = '';
  };

  const endRow = () => {
    endField();
    // A blank line is one empty field, and exports end with one. Keeping them
    // would turn every trailing newline into a row of nulls downstream.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (quoted) {
      if (char !== '"') {
        field += char;
        continue;
      }
      // `""` inside a quoted field is one literal quote; anything else closes it.
      if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === delimiter) {
      endField();
      continue;
    }

    if (char === '\n') {
      endRow();
      continue;
    }

    // CRLF: the \n that follows does the work, and a lone \r (classic Mac
    // line endings, still emitted by some spreadsheet exports) ends the row
    // itself.
    if (char === '\r') {
      if (text[i + 1] === '\n') continue;
      endRow();
      continue;
    }

    field += char;
  }

  // Whatever is left when the file ends with no trailing newline.
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

function resize(row: string[], width: number): string[] {
  const out = row.slice(0, width);
  while (out.length < width) out.push('');
  return out;
}

/**
 * Strips the UTF-8 byte-order mark.
 *
 * Excel writes one on every CSV it saves. Left in place it becomes part of the
 * first header cell, so `title` arrives as `﻿title` and matches nothing,
 * which reads to the user as "your file has no workout column".
 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
