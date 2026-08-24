(() => {
  const BASE_URL = "https://jypvtvvozxmsposxllri.supabase.co";
  window.PLATFORM_CONFIG = Object.freeze({
    environment: "production",
    baseUrl: BASE_URL,
    PLATFORM_API: `${BASE_URL}/functions/v1/platform-api`,
    POINT_API: `${BASE_URL}/functions/v1/point-api`,
    QUESTION_API: `${BASE_URL}/functions/v1/question-api`,
    ANNOUNCEMENT_API: `${BASE_URL}/functions/v1/announcement-api`,
    ACCOUNT_API: `${BASE_URL}/functions/v1/account-api`,
    SUBMISSION_API: `${BASE_URL}/functions/v1/submission-api`,
    ACADEMIC_YEAR_API: `${BASE_URL}/functions/v1/academic-year-api`,
    LOCK_API: `${BASE_URL}/functions/v1/lock-realtime-api`,
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_DqjWMHu-J7hsb8rHfBiBiQ_GS7ZXz33",
    REALTIME_LOCK_TOPIC: "science-platform-locks"
  });
})();