import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { getSql } from '../db.js';
import { rateLimit } from '../ratelimit.js';

interface InquiryBody {
  category: 'bug' | 'suggestion' | 'other';
  title: string;
  content: string;
  contact?: string;
}

/** /api/inquiries — 문의사항 등록 (버그 제보 및 건의) */
const inquiries = new Hono<AppEnv>();

inquiries.post(
  '/api/inquiries',
  rateLimit((e) => e.RL_INQUIRY, '문의사항은 1분에 최대 5회만 제출할 수 있습니다.'),
  async (c) => {
    const { category, title, content, contact } = await c.req.json<InquiryBody>().catch(
      () => ({}) as InquiryBody,
    );

    // 필수 필드 유효성 검증
    if (!category || !title || !content) {
      return c.json({ error: 'category, title, content는 필수 입력 항목입니다.' }, 400);
    }
    if (!['bug', 'suggestion', 'other'].includes(category)) {
      return c.json({ error: '올바르지 않은 카테고리입니다. (bug, suggestion, other만 허용)' }, 400);
    }
    if (title.length > 200) {
      return c.json({ error: '제목은 최대 200자까지 작성할 수 있습니다.' }, 400);
    }
    if (content.length > 10000) {
      return c.json({ error: '내용은 최대 10,000자까지 작성할 수 있습니다.' }, 400);
    }
    if (contact && contact.length > 100) {
      return c.json({ error: '연락처는 최대 100자까지 작성할 수 있습니다.' }, 400);
    }

    try {
      const sql = getSql(c.env);
      const rows = (await sql(
        `INSERT INTO inquiries (category, title, content, contact)
         VALUES ($1, $2, $3, $4)
         RETURNING id, created_at`,
        [category, title, content, contact || null],
      )) as { id: number; created_at: string }[];

      return c.json({
        success: true,
        message: '문의사항이 성공적으로 등록되었습니다.',
        id: rows[0].id,
        created_at: rows[0].created_at,
      });
    } catch {
      return c.json({ error: '문의사항을 저장하는 데 실패했습니다.' }, 500);
    }
  },
);

export default inquiries;
