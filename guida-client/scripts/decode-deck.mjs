#!/usr/bin/env node
// 덱 공유 코드를 사람이 읽기 쉬운 편성표로 풀어주는 CLI 도구.
//
// 사용법:
//   node scripts/decode-deck.mjs <덱코드>
//   node scripts/decode-deck.mjs            # 인자가 없으면 stdin 으로 받음
//   echo "<덱코드>" | node scripts/decode-deck.mjs
//
// 디코드 규칙은 src/lib/deckCode.ts 의 decodeDeckCode 와 동일하다.
//  - 덱코드 = base64( gzip( base64( 비트열 ) ) )
//  - 수감자 12명을 SINNER_IDS_ORDER 순서로 각 46비트 블록에 담는다.
//  - 인격은 code_index(1-based) 를 그대로, 에고는 "출시순 정렬 리스트의 1-based 인덱스" 를 담는다.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// prisoners.json 은 서버 data 디렉터리에 있다 (이름/에고 매핑 원본).
const PRISONERS_PATH = path.resolve(__dirname, "../../guida-server/data/prisoners.json");

// 덱 코드에 담기는 수감자 순서 (src/lib/deckCode.ts 와 반드시 동일해야 함)
const SINNER_IDS_ORDER = [
  "yi_sang",
  "faust",
  "don_quixote",
  "ryoshu",
  "meursault",
  "hong_lu",
  "heathcliff",
  "ishmael",
  "rodion",
  "sinclair",
  "outis",
  "gregor",
];

const GRADE_LABEL = {
  ZAYIN: "ZAYIN",
  TETH: "TETH",
  HE: "HE",
  WAW: "WAW",
};

function bytesToBitString(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(2).padStart(8, "0"))
    .join("");
}

// 출시순 정렬: release_date(문자열) → page_order. encode/decode 양쪽과 동일 기준.
function sortByRelease(list) {
  return [...list].sort(
    (a, b) => a.release_date.localeCompare(b.release_date) || a.page_order - b.page_order,
  );
}

function decodeDeck(deckCode, prisoners) {
  // 1) base64 → gzip 해제 → 내부 base64 → 비트열
  const compressed = Buffer.from(deckCode.trim(), "base64");
  const innerB64 = zlib.gunzipSync(compressed).toString("utf-8");
  const bytes = Buffer.from(innerB64, "base64");

  let bitStr = bytesToBitString(bytes);
  if (bitStr.length < 560) bitStr = bitStr.padStart(560, "0");

  const rows = [];
  for (let i = 0; i < 12; i++) {
    const sinnerId = SINNER_IDS_ORDER[i];
    const base = i * 46;

    const identityCodeIndex = parseInt(bitStr.substring(base + 4, base + 8), 2);
    const order = parseInt(bitStr.substring(base + 8, base + 12), 2);
    const zayinIdx = parseInt(bitStr.substring(base + 15, base + 19), 2);
    const tethIdx = parseInt(bitStr.substring(base + 22, base + 26), 2);
    const heIdx = parseInt(bitStr.substring(base + 29, base + 33), 2);
    const wawIdx = parseInt(bitStr.substring(base + 36, base + 40), 2);

    const meta = prisoners.find((p) => p.sinner_id === sinnerId);
    const sortedEgos = meta ? sortByRelease(meta.egos) : [];

    const identity =
      meta?.identities.find((id) => id.code_index === (identityCodeIndex || 1)) ?? null;

    const egoAt = (idx) => (idx > 0 ? sortedEgos[idx - 1] ?? null : null);

    rows.push({
      sinnerId,
      sinnerName: meta?.name ?? sinnerId,
      order,
      identityCodeIndex,
      identityName: identity?.name ?? `(code_index ${identityCodeIndex} - 미상)`,
      identityRarity: identity?.rarity ?? "?",
      // 디코드한 원시 인덱스 값 (밀림/오프셋 디버깅용)
      raw: { identityCodeIndex, order, zayinIdx, tethIdx, heIdx, wawIdx },
      egos: {
        ZAYIN: egoAt(zayinIdx),
        TETH: egoAt(tethIdx),
        HE: egoAt(heIdx),
        WAW: egoAt(wawIdx),
      },
    });
  }
  return rows;
}

function formatRows(rows) {
  const lines = [];

  // 편성된(order>0) 수감자를 파티 순서대로, 미편성은 뒤에.
  const equipped = rows.filter((r) => r.order > 0).sort((a, b) => a.order - b.order);
  const benched = rows.filter((r) => r.order === 0);

  lines.push("═".repeat(60));
  lines.push(" 편성 파티");
  lines.push("═".repeat(60));
  if (equipped.length === 0) {
    lines.push("  (편성된 수감자 없음)");
  }
  for (const r of equipped) {
    lines.push(formatSinner(r, `${String(r.order).padStart(2, " ")}.`));
  }

  lines.push("");
  lines.push("─".repeat(60));
  lines.push(" 미편성");
  lines.push("─".repeat(60));
  if (benched.length === 0) {
    lines.push("  (없음)");
  }
  for (const r of benched) {
    lines.push(formatSinner(r, "  ·"));
  }

  return lines.join("\n");
}

function formatSinner(r, prefix) {
  const egoParts = [];
  for (const grade of ["ZAYIN", "TETH", "HE", "WAW"]) {
    const ego = r.egos[grade];
    if (ego) egoParts.push(`${GRADE_LABEL[grade]}=${ego.name}`);
  }
  const egoText = egoParts.length ? `  [에고] ${egoParts.join(", ")}` : "  [에고] 없음";

  // 디코드한 원시 숫자 값 — 이름과 어긋나면(밀림) 여기서 바로 확인 가능
  const { identityCodeIndex, order, zayinIdx, tethIdx, heIdx, wawIdx } = r.raw;
  const rawText =
    `  [raw] 인격=${identityCodeIndex} 순서=${order} ` +
    `ZAYIN=${zayinIdx} TETH=${tethIdx} HE=${heIdx} WAW=${wawIdx}`;

  return `${prefix} ${r.sinnerName} — ${r.identityName} (${r.identityRarity})\n      ${egoText}\n      ${rawText}`;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

async function main() {
  if (!fs.existsSync(PRISONERS_PATH)) {
    console.error(`prisoners.json 을 찾을 수 없습니다: ${PRISONERS_PATH}`);
    process.exit(1);
  }
  const prisoners = JSON.parse(fs.readFileSync(PRISONERS_PATH, "utf-8"));

  let deckCode = process.argv[2];
  if (!deckCode) {
    if (process.stdin.isTTY) {
      console.error("덱 코드를 인자로 주거나 stdin 으로 넣어주세요.");
      console.error("예: node scripts/decode-deck.mjs <덱코드>");
      process.exit(1);
    }
    deckCode = await readStdin();
  }

  if (!deckCode) {
    console.error("덱 코드가 비어 있습니다.");
    process.exit(1);
  }

  let rows;
  try {
    rows = decodeDeck(deckCode, prisoners);
  } catch (e) {
    console.error("덱 코드 복호화에 실패했습니다. 코드가 올바른지 확인하세요.");
    console.error(`  원인: ${e.message}`);
    process.exit(1);
  }

  console.log(formatRows(rows));
}

main();
