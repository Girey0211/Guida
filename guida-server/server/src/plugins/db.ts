import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import fp from 'fastify-plugin';
import fastifyPostgres from '@fastify/postgres';
import type { FastifyInstance } from 'fastify';

/**
 * @fastify/postgres 연결 설정.
 * 환경변수로부터 connection string을 조립한다.
 * 연결 후 fastify.pg 로 풀에 접근할 수 있다.
 *
 * 연결 직후 db/schema.sql 을 실행해 테이블/인덱스를 자동 반영한다.
 * 모든 구문이 멱등하므로 매 부팅마다 안전하게 재실행된다.
 */
export default fp(async function dbPlugin(fastify: FastifyInstance) {
  const {
    POSTGRES_USER = 'guida',
    POSTGRES_PASSWORD = '',
    POSTGRES_DB = 'guida_db',
    POSTGRES_HOST = 'db',
    POSTGRES_PORT = '5432',
  } = process.env;

  const connectionString = `postgres://${POSTGRES_USER}:${encodeURIComponent(
    POSTGRES_PASSWORD,
  )}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`;

  await fastify.register(fastifyPostgres, { connectionString });

  fastify.log.info(`PostgreSQL 연결 설정 완료 → ${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`);

  // 스키마 자동 반영. src(dev)/dist(prod) 어디서 실행되든 동일 경로로 해석된다.
  const schemaPath = fileURLToPath(new URL('../db/schema.sql', import.meta.url));
  const schemaSql = await readFile(schemaPath, 'utf8');
  await fastify.pg.pool.query(schemaSql);

  fastify.log.info('DB 스키마 동기화 완료 (테이블 자동 반영)');
});
