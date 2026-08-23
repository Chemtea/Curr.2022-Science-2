// ============================================================
// 중2 과학 디지털 탐구 플랫폼 - 정식 운영 서버 중앙 설정
// 모든 HTML은 이 파일에서만 Supabase 주소를 가져옵니다.
// ============================================================
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
    ACADEMIC_YEAR_API: `${BASE_URL}/functions/v1/academic-year-api`
  });
})();
