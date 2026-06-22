//! `matching_config.json` 로더/검증 통합 테스트 (계획서 §4, M1 체크리스트).

use matching_core::config::MatchingConfig;
use std::path::PathBuf;

fn sample_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("matching_config.sample.json")
}

#[test]
fn sample_config_loads_and_validates() {
    let cfg = MatchingConfig::load(&sample_path()).expect("샘플 config 로드+검증 통과");
    assert_eq!(cfg.schema_version, "1.0");
    // 계획서 M1 주요 화면 4종.
    for id in ["base_explore", "choice", "reward", "start_end"] {
        assert!(cfg.screen(id).is_some(), "화면 '{id}' 누락");
    }
    // reward 화면은 앵커/요소/교차검증을 갖춘 완전 정의.
    let reward = cfg.screen("reward").unwrap();
    assert_eq!(reward.anchors.len(), 2);
    assert!(reward.cross_check.is_some());
    assert_eq!(reward.elements.len(), 1);
    assert_eq!(reward.elements[0].element_type, "icon_grid");
}
