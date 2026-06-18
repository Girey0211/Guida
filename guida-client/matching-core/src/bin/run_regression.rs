//! 회귀 검증 러너 (계획서 §6). CI 게이트.
//!
//! 라벨 매니페스트(regression/manifest.json)의 프레임에 파이프라인을 돌려
//! 화면/식별 정확도·오탐을 산출하고, 목표 미달 시 비정상 종료(코드 1)한다.
//! 매니페스트가 없으면 합성 시드로 스모크 검증을 수행한다(실프레임 수집 전 가동).
//!
//! 사용:
//!   cargo run --release --bin run_regression -- \
//!     [phash_index.json] [gifts.json] [images_dir] [regression_dir]

use matching_core as mc;
use mc::geometry::GameRect;
use mc::identify::PhashIndex;
use mc::regression::{run_frame, synth_frame, Metrics, RegressionManifest, RunOpts};
use std::path::{Path, PathBuf};

const TARGET_GAMERECT: f64 = 99.0;
const TARGET_IDENTIFY: f64 = 99.0;

fn load_index(index_path: &Path, gifts_path: &Path, images_dir: &Path) -> PhashIndex {
    if index_path.exists() {
        return PhashIndex::load(index_path).expect("phash_index 로드 실패");
    }
    // 인덱스 파일이 없으면 즉석 빌드.
    eprintln!("[info] {index_path:?} 없음 → 메모리에서 인덱스 빌드");
    let gifts = mc::load_gifts(gifts_path);
    let entries = gifts
        .iter()
        .map(|g| mc::identify::IndexEntry {
            gift_id: g.id.clone(),
            hash: mc::hash::phash_with_crop(
                &image::open(mc::image_path(images_dir, &g.image_key))
                    .expect("decode")
                    .to_rgba8(),
                mc::DEFAULT_CENTER_CROP,
            ),
        })
        .collect();
    PhashIndex {
        hash_version: mc::hash::HASH_VERSION.to_string(),
        center_crop: mc::DEFAULT_CENTER_CROP,
        patch_version: String::new(),
        entries,
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let index_path = PathBuf::from(args.get(1).cloned().unwrap_or_else(|| "phash_index.json".into()));
    let gifts_path = PathBuf::from(
        args.get(2)
            .cloned()
            .unwrap_or_else(|| "../../guida-server/data/gifts.json".into()),
    );
    let images_dir = PathBuf::from(
        args.get(3)
            .cloned()
            .unwrap_or_else(|| "../../guida-server/data/images".into()),
    );
    let reg_dir = PathBuf::from(args.get(4).cloned().unwrap_or_else(|| "regression".into()));

    let index = load_index(&index_path, &gifts_path, &images_dir);
    let opts = RunOpts::default();
    let mut m = Metrics::default();

    let manifest_path = reg_dir.join("manifest.json");
    if manifest_path.exists() {
        eprintln!("[run] 실프레임 매니페스트: {manifest_path:?}");
        let manifest: RegressionManifest =
            serde_json::from_str(&std::fs::read_to_string(&manifest_path).unwrap())
                .expect("manifest 파싱 실패");
        for fl in &manifest.frames {
            let img = image::open(reg_dir.join(&fl.path))
                .unwrap_or_else(|e| panic!("프레임 {} 디코드: {e}", fl.path))
                .to_rgba8();
            run_frame(fl, &img, &index, &opts, &mut m);
        }
    } else {
        eprintln!("[run] 매니페스트 없음 → 합성 시드 스모크 검증");
        run_synthetic(&index, &opts, &gifts_path, &images_dir, &mut m);
    }

    println!("\n=== 회귀 검증 결과 ===");
    println!(
        "game rect : {}/{} = {:.2}% (목표 ≥{TARGET_GAMERECT}%)",
        m.gamerect_within_tol, m.gamerect_total, m.gamerect_pct()
    );
    println!(
        "식별      : {}/{} = {:.2}% (목표 ≥{TARGET_IDENTIFY}%)",
        m.identify_correct, m.identify_total, m.identify_pct()
    );
    println!("오탐      : {} (목표 = 0)", m.false_positives);
    if !m.failures.is_empty() {
        println!("\n실패 {}건(최대 20):", m.failures.len());
        for f in m.failures.iter().take(20) {
            println!("  {f}");
        }
    }

    let pass = m.gamerect_pct() >= TARGET_GAMERECT
        && m.identify_pct() >= TARGET_IDENTIFY
        && m.false_positives == 0;
    if pass {
        println!("\n[PASS]");
    } else {
        println!("\n[FAIL] 목표 미달");
        std::process::exit(1);
    }
}

/// 합성 프레임을 여러 해상도로 만들어 검증.
fn run_synthetic(
    index: &PhashIndex,
    opts: &RunOpts,
    gifts_path: &Path,
    images_dir: &Path,
    m: &mut Metrics,
) {
    let gifts = mc::load_gifts(gifts_path);
    // 처음 10개 기프트 아이콘 로드.
    let icons: Vec<(String, image::RgbaImage)> = gifts
        .iter()
        .take(10)
        .map(|g| {
            (
                g.id.clone(),
                image::open(mc::image_path(images_dir, &g.image_key))
                    .expect("decode")
                    .to_rgba8(),
            )
        })
        .collect();

    // (tag, frame_w, frame_h, game_rect) — 5개 해상도 프로파일.
    let profiles = [
        ("1080p", 1920, 1080, GameRect::new(0, 0, 1920, 1080)),
        ("1440p", 2560, 1440, GameRect::new(0, 0, 2560, 1440)),
        ("4k", 3840, 2160, GameRect::new(0, 0, 3840, 2160)),
        ("ultrawide", 3440, 1440, GameRect::new(440, 0, 2560, 1440)),
        ("windowed", 1600, 1000, GameRect::new(0, 50, 1600, 900)),
    ];
    for (tag, fw, fh, gr) in profiles {
        let (label, img) = synth_frame(tag, fw, fh, gr, &icons);
        run_frame(&label, &img, index, opts, m);
    }
}
