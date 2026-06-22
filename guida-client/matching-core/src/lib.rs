//! Guida Phase 2 매칭 코어 (M-pre).
//!
//! tauri 비의존 순수 이미지 해싱 코어. 런타임 `identify.rs`와 빌드 도구가
//! 동일 해시 구현을 공유하기 위한 단일 진실 공급원. (계획서 §7.1)
//!
//! 이 lib은 해시 크레이트에 의존하지 않는 부분만 담는다:
//! - webp 디코드 → raw RGBA8
//! - 정규화 리사이즈(128×128) — 인덱스/런타임 공통 규약
//! - 합성 왜곡(scale/crop/noise/badge) — M-pre 자가 테스트용
//! - gifts.json 라벨 로딩
//!
//! 실제 해시 계산은 (벤치 단계에서는) 각 바이너리가 img_hash/image_hasher를
//! 직접 호출한다. 크레이트·파라미터 확정 후 `hash.rs`로 승격한다.

use image::imageops::FilterType;
use image::RgbaImage;
use serde::Deserialize;
use std::path::Path;

pub mod anchor;
pub mod authoring;
pub mod config;
pub mod geometry;
pub mod hash;
pub mod identify;
pub mod normalize;
pub mod regression;
pub mod screen;

/// 정규화 캔버스 크기. 레퍼런스·phash_index·런타임 크롭이 모두 이 크기로 통일된다.
/// (계획서 §7.1 "128×128 일관성")
pub const CANON: u32 = 128;

/// 정규화 리사이즈 필터. 인덱스 생성기와 런타임이 **반드시 동일**해야 한다.
/// Lanczos3: 다운스케일 시 디테일 보존이 좋아 변별력에 유리.
pub const CANON_FILTER: FilterType = FilterType::Lanczos3;

/// 인덱스 빌드 기본 center_crop. 전체 사용(1.0). full/cc85/cc75가 변별력·강건성에서
/// 통계적으로 동률이라 정보 손실 없는 전체를 기본값으로 둔다. center_crop은
/// 런타임 캡처 슬롯의 인게임 장식(테두리/배지) 회피 필요에 따라 M2에서 최종 확정하며,
/// 값 변경 시 phash_index를 동일 값으로 재생성해야 한다. (계획서 elements[].center_crop)
pub const DEFAULT_CENTER_CROP: f32 = 1.0;

/// gifts.json 한 항목(필요 필드만).
#[derive(Debug, Clone, Deserialize)]
pub struct GiftRecord {
    pub id: String,
    pub name: String,
    pub image_key: String,
    #[serde(default)]
    pub grade: String,
    #[serde(default)]
    pub keyword_type: String,
}

/// gifts.json 로드.
pub fn load_gifts(path: &Path) -> Vec<GiftRecord> {
    let txt = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("gifts.json 읽기 실패 {}: {e}", path.display()));
    serde_json::from_str(&txt).expect("gifts.json 파싱 실패")
}

/// webp(또는 임의 이미지)를 디코드해 128×128 RGBA 캔버스로 정규화한다.
/// 원본 종횡비가 1:1이 아니어도 정사각으로 리사이즈(squash)한다.
/// 런타임 또한 슬롯 크롭을 동일하게 정사각 리사이즈하므로 규약이 일치한다.
pub fn load_canonical(path: &Path) -> RgbaImage {
    let img = image::open(path)
        .unwrap_or_else(|e| panic!("이미지 디코드 실패 {}: {e}", path.display()));
    canonicalize(&img.to_rgba8())
}

/// 임의 RGBA를 128×128 정규화.
pub fn canonicalize(src: &RgbaImage) -> RgbaImage {
    let mut out = if src.width() == CANON && src.height() == CANON {
        src.clone()
    } else {
        image::imageops::resize(src, CANON, CANON, CANON_FILTER)
    };
    flatten_on_black(&mut out);
    out
}

/// 알파를 검은 배경에 평탄화한다(투명 영역을 결정적으로 만든다).
/// 레퍼런스 아이콘은 투명도를 가지므로, 인덱스·런타임·합성이 **동일하게** 평탄화해야
/// 해시가 일치한다. 검정 합성을 규약으로 고정. (런타임 슬롯은 어두운 배경 가정 — M2에서 검증)
pub fn flatten_on_black(img: &mut RgbaImage) {
    for px in img.pixels_mut() {
        let a = px[3] as u32;
        px[0] = (px[0] as u32 * a / 255) as u8;
        px[1] = (px[1] as u32 * a / 255) as u8;
        px[2] = (px[2] as u32 * a / 255) as u8;
        px[3] = 255;
    }
}

/// 중앙 `keep` 비율만 남기고 잘라낸 뒤 128×128 정규화.
/// 배지/프레임/체크마크는 보통 모서리에 붙으므로 중앙만 쓰면 흔들림이 준다.
/// (계획서 elements[].center_crop) keep=1.0 이면 전체 사용.
pub fn center_crop_canon(src: &RgbaImage, keep: f32) -> RgbaImage {
    let keep = keep.clamp(0.1, 1.0);
    if keep >= 0.999 {
        return canonicalize(src);
    }
    let w = src.width() as f32;
    let h = src.height() as f32;
    let cw = (w * keep).round() as u32;
    let ch = (h * keep).round() as u32;
    let x = ((w - cw as f32) / 2.0).round() as u32;
    let y = ((h - ch as f32) / 2.0).round() as u32;
    let cropped = image::imageops::crop_imm(src, x, y, cw.max(1), ch.max(1)).to_image();
    let mut out = image::imageops::resize(&cropped, CANON, CANON, CANON_FILTER);
    flatten_on_black(&mut out);
    out
}

/// 정규화된 RGBA를 (raw RGBA8 bytes, w, h)로. 해시 크레이트 버퍼 재구성용.
pub fn as_raw(img: &RgbaImage) -> (Vec<u8>, u32, u32) {
    (img.as_raw().clone(), img.width(), img.height())
}

// ---------------------------------------------------------------------------
// 합성 왜곡 (M-pre 자가 테스트). 결정적(시드 기반) — 재현 가능.
// 게임 캡처에서 실제로 발생하는 열화를 모사한다.
// ---------------------------------------------------------------------------

/// 결정적 경량 PRNG (xorshift32). rand 의존 회피.
pub struct Rng(u32);
impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng(seed | 1)
    }
    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }
    /// [-1.0, 1.0)
    #[inline]
    pub fn next_signed(&mut self) -> f32 {
        (self.next_u32() as f32 / u32::MAX as f32) * 2.0 - 1.0
    }
}

/// 캡처 다운/업스케일 모사: 128 → small → 128.
pub fn distort_scale(img: &RgbaImage, small: u32) -> RgbaImage {
    let down = image::imageops::resize(img, small, small, FilterType::Triangle);
    image::imageops::resize(&down, CANON, CANON, FilterType::Triangle)
}

/// 슬롯 미스크롭 모사: 가장자리 frac 비율을 잘라낸 뒤 다시 128로.
pub fn distort_crop(img: &RgbaImage, frac: f32) -> RgbaImage {
    let m = (CANON as f32 * frac) as u32;
    let m = m.max(1).min(CANON / 4);
    let cropped = image::imageops::crop_imm(img, m, m, CANON - 2 * m, CANON - 2 * m).to_image();
    image::imageops::resize(&cropped, CANON, CANON, CANON_FILTER)
}

/// 캡처 노이즈 모사: ±amp 균일 노이즈를 RGB에 가산.
pub fn distort_noise(img: &RgbaImage, amp: f32, seed: u32) -> RgbaImage {
    let mut rng = Rng::new(seed);
    let mut out = img.clone();
    for px in out.pixels_mut() {
        for c in 0..3 {
            let n = rng.next_signed() * amp;
            px[c] = (px[c] as f32 + n).clamp(0.0, 255.0) as u8;
        }
    }
    out
}

/// 보상창 배지/체크마크 오버레이 모사: 모서리에 불투명 사각형.
/// (계획서: 아이콘 위 배지/프레임/체크마크로 pHash 흔들림 리스크)
pub fn distort_badge(img: &RgbaImage, frac: f32, color: [u8; 3]) -> RgbaImage {
    let mut out = img.clone();
    let s = (CANON as f32 * frac) as u32;
    let s = s.max(8);
    // 우상단 모서리
    let x0 = CANON - s;
    for y in 0..s {
        for x in x0..CANON {
            let p = out.get_pixel_mut(x, y);
            p[0] = color[0];
            p[1] = color[1];
            p[2] = color[2];
            p[3] = 255;
        }
    }
    out
}

/// 밝기 시프트 모사 (HDR/감마/배경 블렌딩 등).
pub fn distort_brightness(img: &RgbaImage, delta: i32) -> RgbaImage {
    let mut out = img.clone();
    for px in out.pixels_mut() {
        for c in 0..3 {
            px[c] = (px[c] as i32 + delta).clamp(0, 255) as u8;
        }
    }
    out
}

/// 왜곡 한 건: (라벨, 현실성, 왜곡 이미지).
/// `realistic=true` 는 캡처+크롭에서 실제로 흔히 생기는 수준,
/// `false` 는 의도적으로 가혹한 스트레스 케이스(헤드룸 측정용).
pub struct Distortion {
    pub name: &'static str,
    pub realistic: bool,
    pub img: RgbaImage,
}

/// 자가 테스트에 사용할 표준 왜곡 묶음.
pub fn distortion_suite(img: &RgbaImage, seed: u32) -> Vec<Distortion> {
    let d = |name, realistic, img| Distortion {
        name,
        realistic,
        img,
    };
    vec![
        d("scale_64", true, distort_scale(img, 64)),
        d("scale_48", true, distort_scale(img, 48)),
        d("scale_32", false, distort_scale(img, 32)),
        d("crop_4pct", true, distort_crop(img, 0.04)),
        d("crop_8pct", false, distort_crop(img, 0.08)),
        d("noise_12", true, distort_noise(img, 12.0, seed)),
        d("noise_24", false, distort_noise(img, 24.0, seed ^ 0x55)),
        d("badge_22pct", true, distort_badge(img, 0.22, [255, 80, 80])),
        d("bright_+20", true, distort_brightness(img, 20)),
        d("bright_-20", true, distort_brightness(img, -20)),
        d(
            "combo",
            false,
            distort_brightness(&distort_noise(&distort_scale(img, 56), 10.0, seed ^ 0xAA), -15),
        ),
    ]
}

/// 두 바이트 슬라이스의 해밍 거리(비트 단위).
pub fn hamming(a: &[u8], b: &[u8]) -> u32 {
    debug_assert_eq!(a.len(), b.len());
    a.iter().zip(b).map(|(x, y)| (x ^ y).count_ones()).sum()
}

/// raw RGBA8 → img_hash(image 0.23) 버퍼. (벤치 전용)
#[cfg(feature = "bench")]
pub fn to_imghash_buf(raw: &[u8], w: u32, h: u32) -> img_hash::image::RgbaImage {
    img_hash::image::RgbaImage::from_raw(w, h, raw.to_vec()).expect("img_hash 버퍼 재구성 실패")
}

/// raw RGBA8 → image_hasher(image 0.25) 버퍼.
pub fn to_hasher_buf(raw: &[u8], w: u32, h: u32) -> image::RgbaImage {
    image::RgbaImage::from_raw(w, h, raw.to_vec()).expect("image_hasher 버퍼 재구성 실패")
}

/// image_key → 이미지 경로.
pub fn image_path(images_dir: &Path, image_key: &str) -> std::path::PathBuf {
    images_dir.join(image_key)
}
