// Neon DB 에 스키마를 적용한다. (Workers 는 부팅 시점이 없으므로 기존의
// "서버 부팅 시 schema.sql 재실행" 패턴을 이 별도 스크립트로 대체한다.)
//
// 단일 소스: 기존 server/src/db/schema.sql 을 그대로 재사용한다.
// 실행: npm run db:migrate
//   - 로컬: .dev.vars 의 DATABASE_URL 을 자동으로 읽는다.
//   - CI(Workers Builds): 빌드 환경변수 DATABASE_URL 을 읽는다.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const schemaPath = fileURLToPath(new URL('../../server/src/db/schema.sql', import.meta.url));

/** .dev.vars 가 있으면 읽어 process.env 에 주입(이미 설정된 값은 보존). 의존성 없는 미니 dotenv. */
async function loadDevVars() {
  try {
    const text = await readFile(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    // .dev.vars 없음 → process.env 사용 (CI 등)
  }
}

async function main() {
  await loadDevVars();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL 이 설정되지 않았습니다. (로컬: .dev.vars / CI: 빌드 환경변수)');
    process.exit(1);
  }

  const schemaSql = await readFile(schemaPath, 'utf8');
  const client = new pg.Client({ connectionString });

  await client.connect();
  try {
    await client.query(schemaSql);
    console.log('✅ 스키마 적용 완료');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ 마이그레이션 실패:', err);
  process.exit(1);
});
