//! `matching_config.json` 스키마 + 로더 + 검증 (계획서 §4).
//!
//! 화면별 매칭 규칙을 **코드 밖 데이터**로 분리한다. 패치로 UI가 바뀌면 이 파일만
//! PR 한다(코드 수정 아님, 계획서 핵심원칙 #2). 모든 좌표는 game rect 기준
//! **정규화(0~1)** 다(절대 픽셀 금지, 핵심원칙 #1).
//!
//! 이 모듈은 tauri 비의존 순수 코어다 — 로드/검증을 오프라인에서 단위 테스트한다.
//! 런타임(`src-tauri/src/matching/config.rs`)은 이 크레이트를 의존해 동일 구조를
//! 재사용한다.

use crate::geometry::NormRect;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// 매칭 설정 전체 (`matching_config.json` 루트).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchingConfig {
    pub schema_version: String,
    /// 게임 렌더 종횡비("16:9"). 정규화 좌표가 가정하는 비율.
    pub game_aspect_ratio: String,
    /// 이 설정이 대응하는 게임 패치 버전(추적용).
    #[serde(default)]
    pub patch_version: String,
    pub screens: Vec<ScreenConfig>,
}

/// 한 화면(scene)의 매칭 규칙.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenConfig {
    /// 코드/상태머신에서 쓰는 안정 식별자("reward", "base_explore" 등).
    pub screen_id: String,
    /// 사람이 읽는 이름.
    #[serde(default)]
    pub name: String,
    /// Layer 1 화면 판정용 region-pHash 지문(들). 모두 통과해야 이 화면으로 분류.
    pub fingerprints: Vec<Fingerprint>,
    /// Layer 2 앵커(들). M2에서 사용.
    #[serde(default)]
    pub anchors: Vec<Anchor>,
    /// 다중 앵커 교차검증 규칙. M2에서 사용.
    #[serde(default)]
    pub cross_check: Option<CrossCheck>,
    /// 요소(아이콘 그리드 등). M2에서 사용.
    #[serde(default)]
    pub elements: Vec<Element>,
    /// 상태 머신 합법 전이 화이트리스트(이 화면 → 나열된 screen_id 로만 전환 허용).
    #[serde(default)]
    pub transitions_allowed: Vec<String>,
}

/// region-pHash 지문 한 건. UI 크롬처럼 그 화면에서 변하지 않는 영역.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fingerprint {
    /// `[x, y, w, h]` 정규화(game rect 기준).
    pub region: [f32; 4],
    /// 이 영역을 [`crate::screen::region_phash`]로 해시한 값(hex). 생성기·런타임 동일 구현.
    #[serde(with = "crate::identify::hex_bytes")]
    pub phash: Vec<u8>,
    /// region-pHash 해밍 거리 허용치(이하면 일치).
    pub tolerance: u32,
}

impl Fingerprint {
    pub fn region_rect(&self) -> NormRect {
        NormRect::from_array(self.region)
    }
}

/// Layer 2 앵커 정의. (M2)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Anchor {
    pub anchor_id: String,
    pub template_key: String,
    /// 앵커를 찾을 좁은 윈도우 `[x, y, w, h]` 정규화.
    pub search_region: [f32; 4],
    /// 템플릿 정규화 상관계수 임계값.
    pub match_threshold: f32,
}

/// 한 앵커로 다른 앵커 위치를 예측·검증. (M2)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossCheck {
    pub predict_from: String,
    pub verify: String,
    /// 예측 위치 대비 실제 검출 위치 허용 오차(정규화). 초과 시 프레임 기각.
    pub max_error: f32,
}

/// 요소(아이콘 그리드 등). (M2)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Element {
    pub element_id: String,
    /// "icon_grid" / "single_icon" 등.
    #[serde(rename = "type")]
    pub element_type: String,
    #[serde(default)]
    pub origin: Option<[f32; 2]>,
    #[serde(default)]
    pub cell: Option<[f32; 2]>,
    #[serde(default)]
    pub cols: Option<u32>,
    #[serde(default)]
    pub rows: Option<u32>,
    /// 아이콘 중앙 비율만 사용(배지/프레임 회피).
    #[serde(default)]
    pub center_crop: Option<f32>,
    /// "phash" 등.
    #[serde(default)]
    pub r#match: Option<String>,
    /// top-1/top-2 거리 차가 이 값 이하면 모호 → 템플릿 2차. (M-pre 감사 도출)
    #[serde(default)]
    pub ambiguity_margin: Option<u32>,
}

impl MatchingConfig {
    /// 파일에서 로드 후 검증. 검증 실패 시 에러 목록을 하나의 문자열로 반환.
    pub fn load(path: &Path) -> Result<Self, String> {
        let txt = std::fs::read_to_string(path).map_err(|e| format!("읽기 실패: {e}"))?;
        let cfg: MatchingConfig =
            serde_json::from_str(&txt).map_err(|e| format!("파싱 실패: {e}"))?;
        cfg.validate().map_err(|errs| {
            format!("matching_config 검증 실패 ({}건):\n  - {}", errs.len(), errs.join("\n  - "))
        })?;
        Ok(cfg)
    }

    /// screen_id 로 화면 설정 조회.
    pub fn screen(&self, screen_id: &str) -> Option<&ScreenConfig> {
        self.screens.iter().find(|s| s.screen_id == screen_id)
    }

    /// 정합성 검증. 모든 위반을 모아 반환(첫 실패에서 멈추지 않음).
    ///
    /// 검사:
    /// - schema_version 존재, screen_id 비어있지 않고 유일
    /// - fingerprint region 이 [0,1] 안이고 w/h > 0
    /// - fingerprint phash 바이트 길이가 런타임 해시 길이와 일치 (SSOT 불일치 조기 검출)
    /// - transitions_allowed 가 존재하는 screen_id 만 참조
    /// - anchor search_region 범위, match_threshold ∈ (0,1]
    /// - cross_check 가 그 화면의 anchor_id 만 참조
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errs = Vec::new();

        if self.schema_version.trim().is_empty() {
            errs.push("schema_version 가 비어 있음".into());
        }

        let hash_bytes = (crate::hash::hash_bits() / 8) as usize;

        // screen_id 유일성.
        let mut seen = std::collections::HashSet::new();
        for s in &self.screens {
            if s.screen_id.trim().is_empty() {
                errs.push("screen_id 가 비어 있는 화면이 있음".into());
            } else if !seen.insert(s.screen_id.as_str()) {
                errs.push(format!("screen_id 중복: '{}'", s.screen_id));
            }
        }
        let ids: std::collections::HashSet<&str> =
            self.screens.iter().map(|s| s.screen_id.as_str()).collect();

        for s in &self.screens {
            let ctx = &s.screen_id;
            if s.fingerprints.is_empty() {
                errs.push(format!("[{ctx}] fingerprints 가 비어 있음(화면 판정 불가)"));
            }
            for (i, f) in s.fingerprints.iter().enumerate() {
                check_region(&mut errs, ctx, &format!("fingerprint[{i}]"), f.region);
                if f.phash.len() != hash_bytes {
                    errs.push(format!(
                        "[{ctx}] fingerprint[{i}].phash 길이 {}B ≠ 런타임 해시 {}B (해시 파라미터 불일치 — 재생성 필요)",
                        f.phash.len(),
                        hash_bytes
                    ));
                }
            }

            // transitions_allowed 참조 무결성.
            for t in &s.transitions_allowed {
                if !ids.contains(t.as_str()) {
                    errs.push(format!("[{ctx}] transitions_allowed 가 미정의 screen_id '{t}' 참조"));
                }
                if t == &s.screen_id {
                    errs.push(format!("[{ctx}] transitions_allowed 에 자기 자신 '{t}' 포함(불필요)"));
                }
            }

            // anchors.
            let mut anchor_ids = std::collections::HashSet::new();
            for a in &s.anchors {
                if !anchor_ids.insert(a.anchor_id.as_str()) {
                    errs.push(format!("[{ctx}] anchor_id 중복: '{}'", a.anchor_id));
                }
                check_region(&mut errs, ctx, &format!("anchor '{}'", a.anchor_id), a.search_region);
                if !(a.match_threshold > 0.0 && a.match_threshold <= 1.0) {
                    errs.push(format!(
                        "[{ctx}] anchor '{}' match_threshold {} ∉ (0,1]",
                        a.anchor_id, a.match_threshold
                    ));
                }
            }

            // cross_check 가 실재 앵커를 참조하는지.
            if let Some(cc) = &s.cross_check {
                if !anchor_ids.contains(cc.predict_from.as_str()) {
                    errs.push(format!(
                        "[{ctx}] cross_check.predict_from '{}' 가 정의된 anchor 아님",
                        cc.predict_from
                    ));
                }
                if !anchor_ids.contains(cc.verify.as_str()) {
                    errs.push(format!(
                        "[{ctx}] cross_check.verify '{}' 가 정의된 anchor 아님",
                        cc.verify
                    ));
                }
                if !(cc.max_error >= 0.0 && cc.max_error <= 1.0) {
                    errs.push(format!("[{ctx}] cross_check.max_error {} ∉ [0,1]", cc.max_error));
                }
            }
        }

        if errs.is_empty() {
            Ok(())
        } else {
            Err(errs)
        }
    }
}

/// `[x,y,w,h]` 정규화 사각형이 [0,1] 안에 있고 폭/높이가 양수인지.
fn check_region(errs: &mut Vec<String>, ctx: &str, what: &str, r: [f32; 4]) {
    let [x, y, w, h] = r;
    if !(w > 0.0 && h > 0.0) {
        errs.push(format!("[{ctx}] {what} 폭/높이가 0 이하: w={w}, h={h}"));
    }
    if x < 0.0 || y < 0.0 || x + w > 1.0001 || y + h > 1.0001 {
        errs.push(format!(
            "[{ctx}] {what} 가 정규화 범위 [0,1] 밖: [{x}, {y}, {w}, {h}]"
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_phash() -> Vec<u8> {
        vec![0u8; (crate::hash::hash_bits() / 8) as usize]
    }

    fn minimal() -> MatchingConfig {
        MatchingConfig {
            schema_version: "1.0".into(),
            game_aspect_ratio: "16:9".into(),
            patch_version: "2.7".into(),
            screens: vec![
                ScreenConfig {
                    screen_id: "reward".into(),
                    name: "보상 결과창".into(),
                    fingerprints: vec![Fingerprint {
                        region: [0.40, 0.04, 0.20, 0.06],
                        phash: dummy_phash(),
                        tolerance: 10,
                    }],
                    anchors: vec![],
                    cross_check: None,
                    elements: vec![],
                    transitions_allowed: vec!["base_explore".into()],
                },
                ScreenConfig {
                    screen_id: "base_explore".into(),
                    name: "기본 탐사".into(),
                    fingerprints: vec![Fingerprint {
                        region: [0.0, 0.0, 0.3, 0.1],
                        phash: dummy_phash(),
                        tolerance: 10,
                    }],
                    anchors: vec![],
                    cross_check: None,
                    elements: vec![],
                    transitions_allowed: vec!["reward".into()],
                },
            ],
        }
    }

    #[test]
    fn minimal_config_validates() {
        minimal().validate().expect("정상 설정은 통과해야 함");
    }

    #[test]
    fn detects_duplicate_screen_id() {
        let mut c = minimal();
        c.screens[1].screen_id = "reward".into();
        let errs = c.validate().unwrap_err();
        assert!(errs.iter().any(|e| e.contains("중복")), "{errs:?}");
    }

    #[test]
    fn detects_dangling_transition() {
        let mut c = minimal();
        c.screens[0].transitions_allowed = vec!["does_not_exist".into()];
        let errs = c.validate().unwrap_err();
        assert!(errs.iter().any(|e| e.contains("미정의 screen_id")), "{errs:?}");
    }

    #[test]
    fn detects_wrong_hash_length() {
        let mut c = minimal();
        c.screens[0].fingerprints[0].phash = vec![1, 2, 3];
        let errs = c.validate().unwrap_err();
        assert!(errs.iter().any(|e| e.contains("해시")), "{errs:?}");
    }

    #[test]
    fn detects_out_of_range_region() {
        let mut c = minimal();
        c.screens[0].fingerprints[0].region = [0.9, 0.0, 0.5, 0.1]; // x+w=1.4 > 1
        let errs = c.validate().unwrap_err();
        assert!(errs.iter().any(|e| e.contains("정규화 범위")), "{errs:?}");
    }

    #[test]
    fn detects_dangling_cross_check() {
        let mut c = minimal();
        c.screens[0].cross_check = Some(CrossCheck {
            predict_from: "ghost".into(),
            verify: "phantom".into(),
            max_error: 0.01,
        });
        let errs = c.validate().unwrap_err();
        assert!(errs.iter().any(|e| e.contains("anchor 아님")), "{errs:?}");
    }

    #[test]
    fn json_roundtrip() {
        let c = minimal();
        let txt = serde_json::to_string_pretty(&c).unwrap();
        let back: MatchingConfig = serde_json::from_str(&txt).unwrap();
        back.validate().unwrap();
        assert_eq!(back.screens.len(), 2);
    }
}
