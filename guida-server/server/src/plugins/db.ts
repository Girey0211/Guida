import fp from 'fastify-plugin';
import fastifyPostgres from '@fastify/postgres';
import type { FastifyInstance } from 'fastify';

/**
 * @fastify/postgres 연결 설정.
 * 환경변수로부터 connection string을 조립한다.
 * 연결 후 fastify.pg 로 풀에 접근할 수 있다.
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
});
