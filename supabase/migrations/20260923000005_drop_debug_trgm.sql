-- cleanup: debug_trgm_sim was only added to inspect similarity() vs
-- word_similarity() scores while tuning search_tasks_fuzzy; not used by the app
DROP FUNCTION IF EXISTS debug_trgm_sim(text, text);
