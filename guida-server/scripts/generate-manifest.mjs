/**
 * manifest.json 생성기 (phase2 dev plan §7 S0).
 *
 * 데이터/이미지 빌드 산출물의 파일별 sha256 콘텐츠 해시를 계산해
 * `data/manifest.json` 한 겹으로 묶는다. 클라이언트는 이 매니페스트만 받아
 * 항목별 해시를 비교하고 바뀐 것만 다운로드한다(content-addressed 동기화).
 *
 * 산출물:
 *  - data/manifest.json
 *      schema_version / patch_version(표시용) / generated_at
 *      data[file]   = { hash, size }   ← JSON 파일별 해시
 *      images[gift] = { hash, size }   ← gift_id(파일명 stem)별 아이콘 해시
 *
 * 이미지는 별도 content-addressed 디렉토리로 복제하지 않는다(449장 중복 방지).
 * 대신 매니페스트의 gift_id↔hash 매핑을 권위로 두고, 서버가 런타임에
 * hash→원본 파일명을 역으로 해석해 서빙한다(gameData 라우트 참조).
 *
 * 사용:
 *   node scripts/generate-manifest.mjs            # data/ 기준 생성
 *   DATA_DIR=/app/data node scripts/generate-manifest.mjs
 *
 * 결정성: 파일 내용이 바뀌지 않으면 해시도 불변. data/images 정렬 키 고정.
 */

import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
  existsSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = "1.0";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : resolve(__dirname, "..", "data");
const IMAGES_DIR = join(DATA_DIR, "images");

/** 동기화 대상 JSON 파일 목록. 매니페스트 자신은 제외한다. */
const DATA_FILES = [
  "gifts.json",
  "packs.json",
  "events.json",
  "dependencies.json",
  "dungeon_meta.json",
  "prisoners.json",
  // Phase 2 인식 인덱스. 산출물이 생기면 자동 포함, 없으면 건너뜀.
  "phash_index.json",
];

/** 바이트 버퍼의 sha256 해시를 `sha256:<hex>` 형태로 반환한다. */
function sha256(buf) {
  return "sha256:" + createHash("sha256").update(buf).digest("hex");
}

/** 표시용 patch_version 라벨을 patch_version.json 에서 읽는다(없으면 unknown). */
function readPatchVersion() {
  const p = join(DATA_DIR, "patch_version.json");
  if (!existsSync(p)) return "unknown";
  try {
    const j = JSON.parse(readFileSync(p, "utf-8"));
    return j.patch_version ?? j.current_patch ?? "unknown";
  } catch {
    return "unknown";
  }
}

function buildDataEntries() {
  const data = {};
  for (const file of DATA_FILES) {
    const full = join(DATA_DIR, file);
    if (!existsSync(full)) continue; // 미배포 파일(phash_index 등)은 건너뜀
    const buf = readFileSync(full);
    data[file] = { hash: sha256(buf), size: statSync(full).size };
  }
  return data;
}

function buildImageEntries() {
  const images = {};
  if (!existsSync(IMAGES_DIR)) return images;
  const files = readdirSync(IMAGES_DIR)
    .filter((f) => f.toLowerCase().endsWith(".webp"))
    .sort(); // 결정적 출력 순서
  for (const file of files) {
    // 이미지 키 = gift_id = 파일명에서 확장자 제거 (gifts.json 의 id 와 동일)
    const giftId = file.replace(/\.webp$/i, "");
    const full = join(IMAGES_DIR, file);
    const buf = readFileSync(full);
    images[giftId] = { hash: sha256(buf), size: statSync(full).size };
  }
  return images;
}

function main() {
  if (!existsSync(DATA_DIR)) {
    console.error(`[manifest] 데이터 디렉토리를 찾을 수 없습니다: ${DATA_DIR}`);
    process.exit(1);
  }

  const data = buildDataEntries();
  const images = buildImageEntries();

  const manifest = {
    schema_version: SCHEMA_VERSION,
    patch_version: readPatchVersion(),
    generated_at: new Date().toISOString(),
    data,
    images,
  };

  const out = join(DATA_DIR, "manifest.json");
  // 키 정렬 없이 안정적 직렬화(객체 삽입 순서 = DATA_FILES 순서 + 이미지 정렬 순서)
  writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  const dataCount = Object.keys(data).length;
  const imageCount = Object.keys(images).length;
  console.log(
    `[manifest] 생성 완료: ${out}\n` +
      `  data  : ${dataCount}개 파일\n` +
      `  images: ${imageCount}개 아이콘\n` +
      `  patch : ${manifest.patch_version}`,
  );
}

main();
