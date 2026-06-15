// Neon DB 에 스키마를 적용한다. (Workers 는 부팅 시점이 없으므로 기존의
// "서버 부팅 시 schema.sql 재실행" 패턴을 이 별도 스크립트로 대체한다.)
//
// 단일 소스: 기존 server/src/db/schema.sql 을 그대로 재사용한다.
// 실행: npm run db:migrate   (.dev.vars 의 DATABASE_URL 사용)
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const schemaPath = fileURLToPath(new URL('../../server/src/db/schema.sql', import.meta.url));

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL 이 설정되지 않았습니다. (.dev.vars 확인)');
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
