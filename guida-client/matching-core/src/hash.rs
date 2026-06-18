//! 확정된 지각 해시(perceptual hash) 구현 — **단일 진실 공급원(SSOT)**.
//!
//! M-pre #1 벤치 결과로 확정한 파라미터를 여기 한 곳에만 둔다.
//! `build_phash_index`(인덱스 생성)와 런타임 `identify`(요소 식별)는 반드시 이
//! 함수만 통해 해시를 만든다. 불일치 시 449개 매칭이 통째로 붕괴하므로
//! 파라미터를 분산시키지 않는다. (계획서 §7.1 "단일 해시 구현")
//!
//! ## 확정 파라미터 (449 실데이터 벤치 근거, src/bin/bench_crates.rs)
//! - crate     : `image_hasher` (img_hash와 변별력 동등 + image 0.25 공유 + 유지보수)
//! - algorithm : DoubleGradient
//! - hash_size : 32×32  → 544-bit (68 byte)
//! - DCT       : off  (DCT는 변별력↑이나 crop/translation 강건성을 해침)
//! - resize    : Lanczos3 (= [`crate::CANON_FILTER`])
//!
//! 측정 근거: 현실 왜곡 복원 top-1 = 99.90%, near-collision(<12bit) = 0,
//! pairwise 최소 해밍 = 21.

use crate::{center_crop_canon, RgbaImage};
use image_hasher::{HashAlg, HasherConfig};

/// 해시 알고리즘 (확정).
pub const HASH_ALG: HashAlg = HashAlg::DoubleGradient;
/// 해시 격자 크기 (확정).
pub const HASH_SIZE: u32 = 32;
/// DCT 전처리 사용 여부 (확정: off).
pub const USE_DCT: bool = false;

/// 이 해시 구현의 파라미터를 식별하는 버전 문자열.
/// `phash_index.json` 헤더에 기록해 생성기↔런타임 불일치를 런타임에 검출한다.
pub const HASH_VERSION: &str = "image_hasher/DoubleGradient/sz32/dct=off/lanczos3/v1";

/// 정규화된 128×128 RGBA → 지각 해시 바이트.
/// 입력은 이미 [`crate::canonicalize`] 또는 [`crate::center_crop_canon`]로
/// 128×128 정규화된 이미지여야 한다.
pub fn phash_canonical(canon: &RgbaImage) -> Vec<u8> {
    let cfg = HasherConfig::new()
        .hash_alg(HASH_ALG)
        .hash_size(HASH_SIZE, HASH_SIZE);
    // USE_DCT == false 이므로 preproc_dct 미적용. (true가 되면 여기서 분기)
    debug_assert!(!USE_DCT, "USE_DCT 변경 시 분기 추가 필요");
    cfg.to_hasher().hash_image(canon).as_bytes().to_vec()
}

/// 레퍼런스/슬롯 RGBA(임의 크기) → 정규화(center_crop) 후 해시.
/// `center_crop` 값은 인덱스 생성기와 런타임이 **동일**해야 한다.
pub fn phash_with_crop(img: &RgbaImage, center_crop: f32) -> Vec<u8> {
    phash_canonical(&center_crop_canon(img, center_crop))
}

/// 해시 비트 길이.
pub fn hash_bits() -> u32 {
    // 빈 이미지로 1회 계산해 길이 확인 (테스트/검증용).
    let blank = RgbaImage::new(crate::CANON, crate::CANON);
    (phash_canonical(&blank).len() * 8) as u32
}
