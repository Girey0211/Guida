//! UUID 생성 유틸리티.
//!
//! 디바이스 고유 식별자는 v4(랜덤) UUID를 사용한다. 개인정보를 포함하지
//! 않으며, 루트 추천/플레이 중복 방지의 익명 키로만 쓰인다.

/// 새로운 v4 UUID 문자열을 생성한다.
#[allow(dead_code)]
pub fn generate() -> String {
    uuid::Uuid::new_v4().to_string()
}
