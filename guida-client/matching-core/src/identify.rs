//! Layer 2 요소 식별의 **순수 매칭 코어** (게임/캡처 비의존).
//!
//! 입력: 정규화된 128×128 슬롯 이미지(또는 그 해시) → 출력: top-k gift_id + 해밍 거리
//! + 모호 여부. 이 코어는 M-pre에서 449개 webp만으로 선검증된다. (계획서 §3, §2)
//!
//! 런타임(`src-tauri/src/matching/identify.rs`)은 이 크레이트를 의존해 동일 코어를
//! 재사용한다. 해시는 반드시 [`crate::hash`]를 통해 생성한다.

use crate::{hash, RgbaImage};
use serde::{Deserialize, Serialize};

/// phash_index.json 한 항목.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexEntry {
    pub gift_id: String,
    /// 해시 바이트 (hex 문자열로 직렬화).
    #[serde(with = "hex_bytes")]
    pub hash: Vec<u8>,
}

/// phash_index.json 전체.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhashIndex {
    /// 해시 파라미터 식별자. 런타임이 [`hash::HASH_VERSION`]과 비교해 불일치를 검출.
    pub hash_version: String,
    /// 인덱스 생성에 사용한 center_crop. 런타임도 동일 값으로 슬롯을 크롭해야 함.
    pub center_crop: f32,
    /// 인덱스 생성기 패치 버전(추적용).
    #[serde(default)]
    pub patch_version: String,
    pub entries: Vec<IndexEntry>,
}

/// 식별 결과 한 후보.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub gift_id: String,
    pub dist: u32,
}

/// 식별 결과.
#[derive(Debug, Clone)]
pub struct Identification {
    /// 해밍 거리 오름차순 top-k.
    pub top: Vec<Candidate>,
    /// top-1 과 top-2 의 거리 차가 ambiguity_margin 이하 → 모호(2차 판별 필요).
    pub ambiguous: bool,
    /// top-1 거리가 이 캡(max_dist)을 초과 → 미식별로 간주(반영 금지).
    pub rejected: bool,
}

impl PhashIndex {
    /// 인덱스 로드 + 해시 버전 정합 검증.
    pub fn load(path: &std::path::Path) -> Result<Self, String> {
        let txt = std::fs::read_to_string(path).map_err(|e| format!("읽기 실패: {e}"))?;
        let idx: PhashIndex = serde_json::from_str(&txt).map_err(|e| format!("파싱 실패: {e}"))?;
        if idx.hash_version != hash::HASH_VERSION {
            return Err(format!(
                "해시 버전 불일치: index='{}' runtime='{}'. 인덱스를 재생성하라.",
                idx.hash_version,
                hash::HASH_VERSION
            ));
        }
        Ok(idx)
    }

    /// 정규화된 128×128 슬롯을 식별. 내부에서 SSOT 해시를 계산한다.
    pub fn identify_canonical(
        &self,
        canon: &RgbaImage,
        k: usize,
        ambiguity_margin: u32,
        max_dist: u32,
    ) -> Identification {
        let q = hash::phash_canonical(canon);
        self.identify_hash(&q, k, ambiguity_margin, max_dist)
    }

    /// 미리 계산된 해시로 식별.
    pub fn identify_hash(
        &self,
        query: &[u8],
        k: usize,
        ambiguity_margin: u32,
        max_dist: u32,
    ) -> Identification {
        let mut cands: Vec<Candidate> = self
            .entries
            .iter()
            .map(|e| Candidate {
                gift_id: e.gift_id.clone(),
                dist: crate::hamming(query, &e.hash),
            })
            .collect();
        // top-k 만 필요하므로 부분 정렬.
        let k = k.max(1).min(cands.len());
        cands.select_nth_unstable_by(k - 1, |a, b| a.dist.cmp(&b.dist));
        cands.truncate(k);
        cands.sort_by(|a, b| a.dist.cmp(&b.dist));

        let d1 = cands.first().map(|c| c.dist).unwrap_or(u32::MAX);
        let d2 = cands.get(1).map(|c| c.dist).unwrap_or(u32::MAX);
        let ambiguous = d2.saturating_sub(d1) <= ambiguity_margin;
        let rejected = d1 > max_dist;

        Identification {
            top: cands,
            ambiguous,
            rejected,
        }
    }
}

/// 해시 바이트 ↔ hex 문자열 직렬화 헬퍼.
/// `phash_index.json`(IndexEntry)과 `matching_config.json`(Fingerprint)이 공유한다.
pub mod hex_bytes {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &[u8], s: S) -> Result<S::Ok, S::Error> {
        let mut out = String::with_capacity(bytes.len() * 2);
        for b in bytes {
            out.push_str(&format!("{b:02x}"));
        }
        s.serialize_str(&out)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        if s.len() % 2 != 0 {
            return Err(serde::de::Error::custom("hex 길이 홀수"));
        }
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(serde::de::Error::custom))
            .collect()
    }
}
