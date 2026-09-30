import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// 为单个表达(单词/短语/句子)生成结构化"单词画像":
// 词义 / 词性 / 美英音标 / 词根词缀 / 小新助记 / 例句 / 同义替换 / 同根词。
// 用于 Flashcard 两轮复习后的"点开单词看详情"。
// 鉴权:必须登录;Core.InvokeLLM 走 service role。无额外密钥。
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const expression = (body.expression_en || '').toString().trim();
    const meaning = (body.meaning_zh || '').toString().trim();
    const context = (body.context || '').toString().trim();

    if (!expression) return Response.json({ error: 'expression_en is required' }, { status: 400 });
    if (expression.length > 120) return Response.json({ error: 'expression too long' }, { status: 400 });

    // 缓存优先：查 Vocabulary 表中是否已有该单词的 profile（由之前查询生成并缓存）。
    // 命中则直接返回，跳过 LLM 调用，实现"秒查"。
    try {
      const cached = await base44.asServiceRole.entities.Vocabulary.filter({
        expression_en: expression,
        created_by_id: user.id,
      }, '-created_date', 1);
      const hit = cached?.find((v) => v.profile && typeof v.profile === 'object');
      if (hit && hit.profile) {
        return Response.json({ profile: hit.profile, cached: true });
      }
    } catch { /* 缓存查询失败时静默降级到 LLM */ }

    // 快速模式：查词气泡仅需 meaning/pos/phonetic，3 个字段无需数组，2-3 秒返回。
    // 完整模式（quick=false）：收藏时生成 roots/synonyms/distractors 等完整画像，供复习使用。
    const quick = body.quick === true;

    if (quick) {
      const quickPrompt = `You are a dictionary for Chinese learners of English.
Look up: "${expression}"
Context: ${context || 'film & TV'}

Return strict JSON only:
- meaning: concise Chinese definition (1 short phrase)
- pos: part of speech in Chinese (动词/名词/形容词/副词/短语/整句 etc.)
- phonetic_us: US IPA notation

No extra fields, no commentary.`;

      const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: quickPrompt,
        model: 'gpt_5_mini',
        response_json_schema: {
          type: 'object',
          properties: {
            meaning: { type: 'string' },
            pos: { type: 'string' },
            phonetic_us: { type: 'string' }
          }
        }
      });

      // 快速模式也写入缓存，后续收藏时如需完整画像再调 full 模式
      return Response.json({ profile: result, cached: false, quick: true });
    }

    const prompt = `You are a film-and-language mentor for Chinese learners of English.
Build a concise "word profile" for the expression: "${expression}"
Known meaning (if any): ${meaning || '—'}
Source context: ${context || 'film & TV'}

Return strict JSON only with exactly these fields:
- meaning: concise Chinese definition (词义)
- pos: part of speech tag in Chinese (e.g. 动词/名词/形容词/短语/整句)
- phonetic_us: US IPA
- phonetic_uk: UK IPA
- roots: up to 3 parts [{part, meaning, type}] where type ∈ 前缀/词根/后缀; "part" is the English fragment, "meaning" in Chinese
- synthesis: one vivid Chinese mnemonic sentence tying parts/meaning together (小新助记)
- example_en: one natural English example sentence using the expression, wrap the expression in ** (e.g. **optimal**)
- example_zh: Chinese translation of the example
- synonyms: up to 3 词义相近替代 [{expression, meaning}] (expression in English, meaning in Chinese)
- same_root: up to 4 同根词 [{word, meaning}] (word in English, meaning in Chinese)
- distractors: an object for复习四选一的干扰项(NOT from any user favorites—freshly generate plausible confusable options, all distinct from the correct answer and from each other, no exact duplicates):
  - confusable_meanings: up to 4 Chinese 释义 that a learner could easily confuse with the correct meaning_zh (related / category-overlapping / near-synonymous Chinese meanings)
  - confusable_words: up to 4 English words/expressions that look sparsity-similar to the correct English OR have an easily-confused meaning (for 中译英 picking)
  - soundalikes: up to 4 English words that sound similar to or look similar to the correct English (for 听音选拼写)

Keep every Chinese field concise and vivid. If the expression is a long phrase or sentence, still derive roots from the key head word and provide reasonable synonyms. No extra commentary, only the JSON object.`;

    // 完整画像使用默认 automatic 模型——复杂 JSON 结构 mini 模型生成不稳定且慢。
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          meaning: { type: 'string' },
          pos: { type: 'string' },
          phonetic_us: { type: 'string' },
          phonetic_uk: { type: 'string' },
          roots: {
            type: 'array',
            items: {
              type: 'object',
              properties: { part: { type: 'string' }, meaning: { type: 'string' }, type: { type: 'string' } }
            }
          },
          synthesis: { type: 'string' },
          example_en: { type: 'string' },
          example_zh: { type: 'string' },
          synonyms: {
            type: 'array',
            items: {
              type: 'object',
              properties: { expression: { type: 'string' }, meaning: { type: 'string' } }
            }
          },
          same_root: {
            type: 'array',
            items: {
              type: 'object',
              properties: { word: { type: 'string' }, meaning: { type: 'string' } }
            }
          },
          distractors: {
            type: 'object',
            properties: {
              confusable_meanings: { type: 'array', items: { type: 'string' } },
              confusable_words: { type: 'array', items: { type: 'string' } },
              soundalikes: { type: 'array', items: { type: 'string' } }
            }
          }
        }
      }
    });

    return Response.json({ profile: result });
  } catch (error) {
    console.error('vocab-profile error', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}