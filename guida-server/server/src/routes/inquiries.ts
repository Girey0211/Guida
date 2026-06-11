import type { FastifyInstance } from 'fastify';

interface InquiryBody {
  category: 'bug' | 'suggestion' | 'other';
  title: string;
  content: string;
  contact?: string;
}

/**
 * /api/inquiries — 문의사항 등록 (버그 제보 및 건의)
 */
export default async function inquiriesRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: InquiryBody }>('/api/inquiries', async (req, reply) => {
    const { category, title, content, contact } = req.body;

    // 필수 필드 유효성 검증
    if (!category || !title || !content) {
      return reply.code(400).send({ error: 'category, title, content는 필수 입력 항목입니다.' });
    }

    // 카테고리 값 유효성 검증
    if (!['bug', 'suggestion', 'other'].includes(category)) {
      return reply.code(400).send({ error: '올바르지 않은 카테고리입니다. (bug, suggestion, other만 허용)' });
    }

    // 글자 수 제한 (보안 및 DB 오버플로우 방지)
    if (title.length > 200) {
      return reply.code(400).send({ error: '제목은 최대 200자까지 작성할 수 있습니다.' });
    }

    if (content.length > 10000) {
      return reply.code(400).send({ error: '내용은 최대 10,000자까지 작성할 수 있습니다.' });
    }

    if (contact && contact.length > 100) {
      return reply.code(400).send({ error: '연락처는 최대 100자까지 작성할 수 있습니다.' });
    }

    try {
      const query = `
        INSERT INTO inquiries (category, title, content, contact)
        VALUES ($1, $2, $3, $4)
        RETURNING id, created_at
      `;
      const values = [category, title, content, contact || null];
      const { rows } = await fastify.pg.query(query, values);

      return {
        success: true,
        message: '문의사항이 성공적으로 등록되었습니다.',
        id: rows[0].id,
        created_at: rows[0].created_at,
      };
    } catch (err) {
      fastify.log.error({ err }, '문의사항 데이터베이스 저장 실패');
      return reply.code(500).send({ error: '문의사항을 저장하는 데 실패했습니다.' });
    }
  });
}
