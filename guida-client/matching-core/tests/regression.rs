//! 회귀 하니스 자가 검증 (계획서 §6).
//!
//! 실프레임 수집 전, 합성 프레임(5개 해상도 프로파일)으로 전체 파이프라인
//! (Layer 0 game rect + Layer 2 식별)을 돌려 하니스가 작동하고 목표 지표를
//! 만족함을 확인한다. 실데이터 없으면 skip(CI 가드).

use matching_core as mc;
use mc::geometry::GameRect;
use mc::identify::{IndexEntry, PhashIndex};
use mc::regression::{run_frame, synth_frame, Metrics, RunOpts};
use std::path::PathBuf;

fn data_dir() -> Option<PathBuf> {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../guida-server/data");
    base.join("gifts.json").exists().then_some(base)
}

#[test]
fn synthetic_pipeline_meets_targets() {
    let Some(data) = data_dir() else {
        eprintln!("[skip] guida-server/data 없음");
        return;
    };
    let gifts = mc::load_gifts(&data.join("gifts.json"));
    let images = data.join("images");

    // 전체 449 인덱스(현실적 식별 난이도).
    let entries: Vec<IndexEntry> = gifts
        .iter()
        .map(|g| IndexEntry {
            gift_id: g.id.clone(),
            hash: mc::hash::phash_with_crop(
                &image::open(mc::image_path(&images, &g.image_key))
                    .unwrap()
                    .to_rgba8(),
                mc::DEFAULT_CENTER_CROP,
            ),
        })
        .collect();
    let index = PhashIndex {
        hash_version: mc::hash::HASH_VERSION.to_string(),
        center_crop: mc::DEFAULT_CENTER_CROP,
        patch_version: String::new(),
        entries,
    };

    // 10개 아이콘을 5개 해상도 프로파일에 배치.
    let icons: Vec<(String, image::RgbaImage)> = gifts
        .iter()
        .take(10)
        .map(|g| {
            (
                g.id.clone(),
                image::open(mc::image_path(&images, &g.image_key))
                    .unwrap()
                    .to_rgba8(),
            )
        })
        .collect();

    let profiles = [
        ("1080p", 1920, 1080, GameRect::new(0, 0, 1920, 1080)),
        ("1440p", 2560, 1440, GameRect::new(0, 0, 2560, 1440)),
        ("4k", 3840, 2160, GameRect::new(0, 0, 3840, 2160)),
        ("ultrawide", 3440, 1440, GameRect::new(440, 0, 2560, 1440)),
        ("windowed", 1600, 1000, GameRect::new(0, 50, 1600, 900)),
    ];

    let opts = RunOpts::default();
    let mut m = Metrics::default();
    for (tag, fw, fh, gr) in profiles {
        let (label, img) = synth_frame(tag, fw, fh, gr, &icons);
        run_frame(&label, &img, &index, &opts, &mut m);
    }

    eprintln!(
        "[regression] game rect {:.1}% ({}/{}), 식별 {:.1}% ({}/{}), 오탐 {}",
        m.gamerect_pct(),
        m.gamerect_within_tol,
        m.gamerect_total,
        m.identify_pct(),
        m.identify_correct,
        m.identify_total,
        m.false_positives
    );
    for f in m.failures.iter().take(20) {
        eprintln!("  fail: {f}");
    }

    assert_eq!(m.gamerect_total, 5, "5개 프로파일");
    assert!(m.gamerect_pct() >= 99.0, "game rect {:.1}% < 99%", m.gamerect_pct());
    assert!(m.identify_pct() >= 99.0, "식별 {:.1}% < 99%", m.identify_pct());
    assert_eq!(m.false_positives, 0, "자동 반영 오탐 0이어야 함");
}
