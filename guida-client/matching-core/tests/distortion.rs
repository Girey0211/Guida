//! M-pre #2: 합성 왜곡 자가 테스트.
//!
//! 레퍼런스 449개로 인덱스를 만들고, 각 아이콘에 캡처 열화(scale/crop/noise/badge/
//! brightness)를 합성 적용한 뒤 **원본으로 복원되는지** 검증한다.
//! 식별 코어(identify) + SSOT 해시(hash)가 함께 검증된다. (계획서 §3 M-pre)
//!
//! 완료 기준: 현실적 왜곡 복원 top-1 정확도 ≥ 99%.
//!
//! 실데이터(guida-server/data) 경로가 없으면 테스트를 건너뛴다(CI 환경 가드).

use matching_core as mc;
use mc::identify::{IndexEntry, PhashIndex};
use std::path::PathBuf;

fn data_dir() -> Option<PathBuf> {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../guida-server/data");
    if base.join("gifts.json").exists() {
        Some(base)
    } else {
        None
    }
}

fn build_index(data: &PathBuf, center_crop: f32) -> (PhashIndex, Vec<mc::GiftRecord>) {
    let gifts = mc::load_gifts(&data.join("gifts.json"));
    let images = data.join("images");
    let entries = gifts
        .iter()
        .map(|g| {
            let img = image::open(mc::image_path(&images, &g.image_key))
                .expect("decode")
                .to_rgba8();
            IndexEntry {
                gift_id: g.id.clone(),
                hash: mc::hash::phash_with_crop(&img, center_crop),
            }
        })
        .collect();
    let idx = PhashIndex {
        hash_version: mc::hash::HASH_VERSION.to_string(),
        center_crop,
        patch_version: String::new(),
        entries,
    };
    (idx, gifts)
}

#[test]
fn synthetic_distortion_restore_accuracy() {
    let Some(data) = data_dir() else {
        eprintln!("[skip] guida-server/data 없음 — 자가 테스트 건너뜀");
        return;
    };

    let cc = mc::DEFAULT_CENTER_CROP;
    let (idx, gifts) = build_index(&data, cc);
    assert_eq!(idx.entries.len(), 449, "449개 인덱스여야 함");

    let images = data.join("images");
    let mut real_ok = 0usize;
    let mut real_tot = 0usize;
    let mut stress_ok = 0usize;
    let mut stress_tot = 0usize;
    let mut failures: Vec<String> = Vec::new();

    for (i, g) in gifts.iter().enumerate() {
        let img = image::open(mc::image_path(&images, &g.image_key))
            .unwrap()
            .to_rgba8();
        let canon = mc::center_crop_canon(&img, cc);
        for d in mc::distortion_suite(&canon, 0x1234_0000 ^ i as u32) {
            let res = idx.identify_canonical(&d.img, 2, 0, u32::MAX);
            let top = &res.top[0].gift_id;
            let ok = top == &g.id;
            if d.realistic {
                real_tot += 1;
                if ok {
                    real_ok += 1;
                } else {
                    failures.push(format!("{} <{}> → {}", g.id, d.name, top));
                }
            } else {
                stress_tot += 1;
                if ok {
                    stress_ok += 1;
                }
            }
        }
    }

    let real_pct = real_ok as f64 / real_tot as f64 * 100.0;
    let stress_pct = stress_ok as f64 / stress_tot as f64 * 100.0;
    eprintln!(
        "[distortion] 현실 top1 = {real_pct:.2}% ({real_ok}/{real_tot}), 스트레스 = {stress_pct:.2}% ({stress_ok}/{stress_tot})"
    );
    if !failures.is_empty() {
        eprintln!("[distortion] 현실 실패 {}건 (최대 20건 표시):", failures.len());
        for f in failures.iter().take(20) {
            eprintln!("    {f}");
        }
    }

    assert!(
        real_pct >= 99.0,
        "현실 왜곡 복원 top-1 {real_pct:.2}% < 99% (완료 기준 미달)"
    );
}

#[test]
fn hash_is_544_bits() {
    // SSOT 해시 길이 고정 회귀 가드(파라미터 변경 감지).
    assert_eq!(mc::hash::hash_bits(), 544, "해시 비트 수 변동 — 파라미터 확인");
}

#[test]
fn index_roundtrip_serde() {
    let idx = PhashIndex {
        hash_version: mc::hash::HASH_VERSION.to_string(),
        center_crop: 1.0,
        patch_version: "test".into(),
        entries: vec![IndexEntry {
            gift_id: "gift_x".into(),
            hash: vec![0xde, 0xad, 0xbe, 0xef],
        }],
    };
    let json = serde_json::to_string(&idx).unwrap();
    assert!(json.contains("deadbeef"), "해시는 hex로 직렬화되어야 함");
    let back: PhashIndex = serde_json::from_str(&json).unwrap();
    assert_eq!(back.entries[0].hash, vec![0xde, 0xad, 0xbe, 0xef]);
}
