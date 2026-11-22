import { config } from '../config.js';
import { logger } from './logger.js';

const CANDIDATE_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

/**
 * Calls Gemini API to generate structured JSON output with multi-model fallback.
 * @param {Object} params
 * @param {string} params.prompt - Main user prompt
 * @param {string} [params.systemPrompt] - Optional system prompt instruction
 * @param {number} [params.temperature=0.7] - Creativity setting (0.0 to 1.0)
 * @param {number} [params.maxOutputTokens=1200]
 * @param {number} [params.timeoutMs=15000]
 * @returns {Promise<Object|null>} Parsed JSON object or null if unavailable
 */
export async function generateGeminiJson({
  prompt,
  systemPrompt = '',
  temperature = 0.7,
  maxOutputTokens = 1200,
  timeoutMs = 15000,
}) {
  const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.info('[Gemini Client] No GEMINI_API_KEY detected. Using dynamic algorithmic generator.');
    return null;
  }

  const contents = [];
  if (systemPrompt) {
    contents.push({ role: 'user', parts: [{ text: `SYSTEM INSTRUCTION:\n${systemPrompt}` }] });
    contents.push({ role: 'model', parts: [{ text: 'Understood. I will strictly follow these instructions and return only valid JSON.' }] });
  }
  contents.push({ role: 'user', parts: [{ text: prompt }] });

  for (const model of CANDIDATE_MODELS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature,
            maxOutputTokens,
            responseMimeType: 'application/json',
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        logger.warn(`[Gemini Client] Model [${model}] HTTP ${res.status}: ${errorText.slice(0, 200)}`);
        continue;
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!rawText) continue;

      const cleanJson = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const parsed = JSON.parse(cleanJson);
      logger.success(`[Gemini Client] Successfully generated structured output via [${model}]`);
      return parsed;
    } catch (err) {
      if (err.name === 'AbortError') {
        logger.warn(`[Gemini Client] Model [${model}] request timed out after ${timeoutMs}ms.`);
      } else {
        logger.warn(`[Gemini Client] Model [${model}] error: ${err.message}`);
      }
    }
  }

  logger.warn('[Gemini Client] All candidate Gemini models exhausted. Falling back to dynamic generator.');
  return null;
}
