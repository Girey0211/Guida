//! Layer 1 화면 인식 게이트 — region-pHash 지문 + 히스테리시스 + 상태 머신.
//! (계획서 M1, §5 신뢰도 게이트)
//!
//! 매 프레임 비싼 인식(Layer 2)을 돌리기 전, **싼 게이트**로 "지금 어느 화면인가"를
//! 확정한다. 3단계:
//!   1. [`classify`]    : game rect 기준 지문 영역을 region-pHash 해 후보 화면 산출
//!   2. 히스테리시스      : 연속 N프레임 동일 판정 시에만 전환 커밋 (깜빡임 흡수)
//!   3. 상태 머신         : `transitions_allowed` 합법 전이만 허용, 불가능 점프 기각
//!
//! 순수 코어(게임/캡처 비의존): [`classify`]는 raw RGBA 프레임만, [`StateMachine`]은
//! 프레임별 분류 결과(문자열)만 받는다 → 합성/시퀀스로 오프라인 검증 가능.

use crate::config::MatchingConfig;
use crate::geometry::{GameRect, NormRect};
use crate::hash;
use image::RgbaImage;

/// 지문 영역 1개의 region-pHash. **생성기(matching_config 작성)와 런타임이 반드시
/// 이 함수를 공유**해야 한다(SSOT). game rect 기준 정규화 영역을 크롭 → 128² 정규화
/// → SSOT 해시. 영역이 프레임 밖이라 0 크기면 `None`.
pub fn region_phash(frame: &RgbaImage, rect: &GameRect, region: &NormRect) -> Option<Vec<u8>> {
    let (x, y, w, h) = rect.norm_rect_to_px_clamped(region, frame.width(), frame.height());
    if w == 0 || h == 0 {
        return None;
    }
    let crop = image::imageops::crop_imm(frame, x, y, w, h).to_image();
    Some(hash::phash_canonical(&crate::canonicalize(&crop)))
}

/// 한 화면 후보의 지문 매칭 결과(디버그/회귀 분석용).
#[derive(Debug, Clone)]
pub struct ScreenScore {
    pub screen_id: String,
    /// 지문별 해밍 거리 합(작을수록 잘 맞음). 지문이 프레임 밖이면 `u32::MAX`.
    pub total_dist: u32,
    /// 모든 지문이 각자의 tolerance 이내인지(이 경우만 분류 후보).
    pub all_within_tol: bool,
}

/// [`classify`] 결과.
#[derive(Debug, Clone)]
pub struct ClassifyResult {
    /// 확정 후보 screen_id. 어느 화면도 지문 통과 못 하면 `None`(미상 화면).
    pub screen_id: Option<String>,
    /// 화면별 점수(내림 정렬되지 않음, config 순서). 회귀/튜닝용.
    pub scores: Vec<ScreenScore>,
}

/// 한 프레임을 지문 매칭으로 raw 분류한다(히스테리시스 적용 *전*).
///
/// 각 화면의 **모든** 지문이 tolerance 이내여야 그 화면의 후보가 된다(AND).
/// 후보가 여럿이면 지문 거리 합이 가장 작은 화면을 택한다. 후보가 없으면 `None`.
pub fn classify(frame: &RgbaImage, rect: &GameRect, config: &MatchingConfig) -> ClassifyResult {
    let mut scores = Vec::with_capacity(config.screens.len());

    for s in &config.screens {
        let mut total = 0u32;
        let mut all_ok = !s.fingerprints.is_empty();
        for f in &s.fingerprints {
            match region_phash(frame, rect, &f.region_rect()) {
                Some(q) => {
                    let d = crate::hamming(&q, &f.phash);
                    total = total.saturating_add(d);
                    if d > f.tolerance {
                        all_ok = false;
                    }
                }
                None => {
                    all_ok = false;
                    total = u32::MAX;
                }
            }
        }
        scores.push(ScreenScore {
            screen_id: s.screen_id.clone(),
            total_dist: total,
            all_within_tol: all_ok,
        });
    }

    // 후보(all_within_tol) 중 거리 합 최소.
    let screen_id = scores
        .iter()
        .filter(|s| s.all_within_tol)
        .min_by_key(|s| s.total_dist)
        .map(|s| s.screen_id.clone());

    ClassifyResult { screen_id, scores }
}

/// 히스테리시스 + 상태 머신 설정.
#[derive(Debug, Clone, Copy)]
pub struct StateMachineConfig {
    /// 전환 커밋에 필요한 연속 동일 판정 프레임 수 N (계획서: 3~5).
    pub commit_frames: u32,
}

impl Default for StateMachineConfig {
    fn default() -> Self {
        Self { commit_frames: 4 }
    }
}

/// 한 프레임 입력에 대한 상태 머신 반응.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Commit {
    /// 확정 화면 변화 없음(후보 누적 중이거나 동일 판정).
    Unchanged,
    /// 전환 커밋됨.
    Committed {
        from: Option<String>,
        to: Option<String>,
    },
    /// N프레임 안정됐으나 합법 전이가 아니라 기각(불가능 점프). 확정 화면 유지.
    Rejected {
        from: String,
        illegal_to: String,
    },
}

/// 히스테리시스 + 합법 전이 상태 머신. (계획서 M1)
///
/// 매 프레임 [`classify`]의 `screen_id`(Option)를 [`Self::on_frame`]에 넣는다.
/// - 같은 판정이 `commit_frames` 회 연속돼야 후보로 인정(전환 애니메이션/팝업 깜빡임 흡수).
/// - 안정된 후보가 현재 확정과 다르고 **합법 전이**일 때만 커밋.
/// - 미상(`None`)으로의 전환(화면 상실)과 미상에서의 복귀(부트스트랩)는 항상 허용.
pub struct StateMachine<'a> {
    config: &'a MatchingConfig,
    sm: StateMachineConfig,
    committed: Option<String>,
    candidate: Option<String>,
    streak: u32,
}

impl<'a> StateMachine<'a> {
    pub fn new(config: &'a MatchingConfig, sm: StateMachineConfig) -> Self {
        Self {
            config,
            sm,
            committed: None,
            candidate: None,
            streak: 0,
        }
    }

    /// 현재 확정된 화면(미확정이면 `None`).
    pub fn current(&self) -> Option<&str> {
        self.committed.as_deref()
    }

    /// 한 프레임의 raw 분류 결과를 반영한다.
    pub fn on_frame(&mut self, raw: Option<String>) -> Commit {
        // 1) 히스테리시스 누적.
        if raw == self.candidate {
            self.streak = self.streak.saturating_add(1);
        } else {
            self.candidate = raw;
            self.streak = 1;
        }

        // 2) 아직 안정 미달 → 유지.
        if self.streak < self.sm.commit_frames {
            return Commit::Unchanged;
        }
        // 3) 안정 후보가 현재 확정과 같음 → 변화 없음.
        if self.candidate == self.committed {
            return Commit::Unchanged;
        }

        // 4) 합법 전이 검사 (둘 다 known 일 때만; None 관여 전이는 항상 허용).
        if let (Some(prev), Some(next)) = (self.committed.as_deref(), self.candidate.as_deref()) {
            if !self.is_legal(prev, next) {
                return Commit::Rejected {
                    from: prev.to_string(),
                    illegal_to: next.to_string(),
                };
            }
        }

        // 5) 커밋.
        let from = self.committed.clone();
        self.committed = self.candidate.clone();
        Commit::Committed {
            from,
            to: self.committed.clone(),
        }
    }

    /// `prev` 화면에서 `next` 로의 전이가 `transitions_allowed` 에 있는지.
    fn is_legal(&self, prev: &str, next: &str) -> bool {
        match self.config.screen(prev) {
            Some(s) => s.transitions_allowed.iter().any(|t| t == next),
            // 확정 화면이 config 에 없으면(이상) 보수적으로 전이 허용.
            None => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Fingerprint, ScreenConfig};

    fn phash_len() -> usize {
        (hash::hash_bits() / 8) as usize
    }

    /// 지문 없이 전이 그래프만 있는 config (상태 머신 단위 테스트용).
    fn graph_config() -> MatchingConfig {
        let mk = |id: &str, allowed: &[&str]| ScreenConfig {
            screen_id: id.into(),
            name: id.into(),
            fingerprints: vec![Fingerprint {
                region: [0.0, 0.0, 0.1, 0.1],
                phash: vec![0u8; phash_len()],
                tolerance: 10,
            }],
            anchors: vec![],
            cross_check: None,
            elements: vec![],
            transitions_allowed: allowed.iter().map(|s| s.to_string()).collect(),
        };
        MatchingConfig {
            schema_version: "1.0".into(),
            game_aspect_ratio: "16:9".into(),
            patch_version: "test".into(),
            // base_explore ⇄ choice → reward → base_explore. (reward→choice 불가)
            screens: vec![
                mk("base_explore", &["choice"]),
                mk("choice", &["base_explore", "reward"]),
                mk("reward", &["base_explore"]),
            ],
        }
    }

    fn feed(sm: &mut StateMachine, id: Option<&str>, n: u32) -> Commit {
        let mut last = Commit::Unchanged;
        for _ in 0..n {
            last = sm.on_frame(id.map(|s| s.to_string()));
        }
        last
    }

    #[test]
    fn hysteresis_requires_n_frames() {
        let cfg = graph_config();
        let sm_cfg = StateMachineConfig { commit_frames: 4 };
        let mut sm = StateMachine::new(&cfg, sm_cfg);

        // 3프레임만으론 커밋 안 됨.
        assert_eq!(feed(&mut sm, Some("base_explore"), 3), Commit::Unchanged);
        assert_eq!(sm.current(), None);
        // 4번째에 커밋.
        let c = sm.on_frame(Some("base_explore".into()));
        assert_eq!(
            c,
            Commit::Committed {
                from: None,
                to: Some("base_explore".into())
            }
        );
        assert_eq!(sm.current(), Some("base_explore"));
    }

    #[test]
    fn flicker_does_not_commit() {
        let cfg = graph_config();
        let mut sm = StateMachine::new(&cfg, StateMachineConfig { commit_frames: 4 });
        feed(&mut sm, Some("base_explore"), 4); // 확정

        // 깜빡임: choice 가 2프레임만 나타났다 사라짐 → 커밋 안 됨.
        feed(&mut sm, Some("choice"), 2);
        assert_eq!(sm.current(), Some("base_explore"));
        // 다시 base_explore 로 안정 → 변화 없음.
        feed(&mut sm, Some("base_explore"), 4);
        assert_eq!(sm.current(), Some("base_explore"));
    }

    #[test]
    fn legal_transition_commits() {
        let cfg = graph_config();
        let mut sm = StateMachine::new(&cfg, StateMachineConfig { commit_frames: 3 });
        feed(&mut sm, Some("base_explore"), 3);
        // base_explore → choice 합법.
        let c = feed(&mut sm, Some("choice"), 3);
        assert!(matches!(c, Commit::Committed { .. }));
        assert_eq!(sm.current(), Some("choice"));
        // choice → reward 합법.
        feed(&mut sm, Some("reward"), 3);
        assert_eq!(sm.current(), Some("reward"));
    }

    #[test]
    fn illegal_jump_rejected() {
        let cfg = graph_config();
        let mut sm = StateMachine::new(&cfg, StateMachineConfig { commit_frames: 3 });
        feed(&mut sm, Some("reward"), 3); // 부트스트랩(초기엔 어떤 화면이든 허용)
        assert_eq!(sm.current(), Some("reward"));
        // reward → choice 는 불법(transitions_allowed=[base_explore]) → 기각.
        let c = feed(&mut sm, Some("choice"), 5);
        assert_eq!(
            c,
            Commit::Rejected {
                from: "reward".into(),
                illegal_to: "choice".into()
            }
        );
        assert_eq!(sm.current(), Some("reward"), "불법 점프는 확정 화면을 바꾸지 않음");
    }

    #[test]
    fn unknown_screen_then_recover() {
        let cfg = graph_config();
        let mut sm = StateMachine::new(&cfg, StateMachineConfig { commit_frames: 3 });
        feed(&mut sm, Some("choice"), 3);
        // 화면 상실(미상)으로 안정 전이 → 허용(None 으로 커밋).
        let c = feed(&mut sm, None, 3);
        assert_eq!(
            c,
            Commit::Committed {
                from: Some("choice".into()),
                to: None
            }
        );
        assert_eq!(sm.current(), None);
        // 미상에서 복귀는 부트스트랩처럼 항상 허용.
        feed(&mut sm, Some("reward"), 3);
        assert_eq!(sm.current(), Some("reward"));
    }

    #[test]
    fn brief_unknown_blip_keeps_screen() {
        let cfg = graph_config();
        let mut sm = StateMachine::new(&cfg, StateMachineConfig { commit_frames: 4 });
        feed(&mut sm, Some("choice"), 4);
        // 팝업으로 1~2프레임 미상 → 화면 유지.
        feed(&mut sm, None, 2);
        assert_eq!(sm.current(), Some("choice"));
    }
}
