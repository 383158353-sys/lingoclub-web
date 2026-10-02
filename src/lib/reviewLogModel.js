export const REVIEW_MODES = new Set(["daily", "weak", "mistakes", "random", "manual"]);

export function createReviewLog({ vocabularyId, reviewedAt = new Date().toISOString(), sessionId, questionType, userAnswer, correctAnswer, isCorrect, rating, responseTimeMs, previousMastery, newMastery, previousNextReviewAt, newNextReviewAt, reviewMode = "daily" }) {
  return {
    id: globalThis.crypto?.randomUUID?.() || `review_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    vocabulary_id: String(vocabularyId), reviewed_at: new Date(reviewedAt).toISOString(), session_id: sessionId || null,
    question_type: questionType || null, user_answer: userAnswer == null ? null : String(userAnswer),
    correct_answer: correctAnswer == null ? null : String(correctAnswer), is_correct: Boolean(isCorrect),
    rating: Number(rating) || 0, response_time_ms: Math.max(0, Number(responseTimeMs) || 0),
    previous_mastery: previousMastery || null, new_mastery: newMastery || null,
    previous_next_review_at: previousNextReviewAt || null, new_next_review_at: newNextReviewAt || null,
    review_mode: REVIEW_MODES.has(reviewMode) ? reviewMode : "manual",
  };
}
