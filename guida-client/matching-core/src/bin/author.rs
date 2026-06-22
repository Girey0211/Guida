//! 매칭 데이터 저작 CLI (계획서 M1/M2 라이브 데이터 작성 도구).
//!
//! 합성으로 검증된 코어를 실게임에 물리려면 캡처에서 만들어야 하는 데이터가 있다.
//! 이 도구가 그 수작업을 스크립트화한다. 좌표 지정만 사람이 하고(미리보기로 확인),
//! 해시/크롭은 런타임과 **동일 구현**으로 자동 생성한다.
//!
//! ## 워크플로
//! 1. 각 화면을 캡처(borderless 권장, 클라이언트 영역). `captures/reward_1080p.png` 등.
//! 2. `captures.json` 작성: 화면별 캡처 + 앵커 템플릿 스펙(정규화 좌표).
//! 3. draft `matching_config.json` 작성: 화면/지문 region 좌표 채우고 `"phash": ""` 로 둠.
//! 4. 좌표 확인:  author preview <config> <screen_id> <frame.png> <out.png>
//! 5. 지문 생성:  author fingerprints <draft_config> <captures.json> <out_config>
//! 6. 템플릿 생성: author templates <captures.json> <out_dir>
//!
//! 모든 경로는 호출 위치 기준. captures.json 내부 frame 경로는 captures.json 위치 기준.
//!
//! ```text
//! captures.json:
//! {
//!   "captures": [ { "screen_id": "reward", "frame": "captures/reward_1080p.png" } ],
//!   "templates": [
//!     { "template_key": "anchor_reward_header", "from_screen": "reward",
//!       "region": [0.42, 0.05, 0.10, 0.06] }
//!   ]
//! }
//! ```

use matching_core as mc;
use mc::authoring::{author_templates, draw_regions, fill_fingerprints, CapturesManifest};
use mc::config::MatchingConfig;
use mc::geometry::NormRect;
use image::RgbaImage;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::exit;

/// 템플릿 PNG 최대 변(px). 런타임이 다시 리사이즈하므로 경량화 목적.
const TEMPLATE_MAX_DIM: u32 = 128;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(String::as_str).unwrap_or("");
    let rest = &args[2.min(args.len())..];
    let result = match cmd {
        "fingerprints" => cmd_fingerprints(rest),
        "templates" => cmd_templates(rest),
        "preview" => cmd_preview(rest),
        _ => Err(usage()),
    };
    if let Err(e) = result {
        eprintln!("{e}");
        exit(1);
    }
}

fn usage() -> String {
    "\
사용법:
  author fingerprints <draft_config.json> <captures.json> <out_config.json>
      캡처에서 region-pHash 지문을 떠 config 의 phash 를 채운다.
  author templates <captures.json> <out_dir>
      앵커 템플릿을 크롭해 PNG + templates.json 을 out_dir 에 쓴다.
  author preview <config.json> <screen_id> <frame.png> <out.png>
      프레임에 지문(초록)·앵커 search_region(주황) 박스를 그려 좌표를 검증한다."
        .into()
}

fn load_image(path: &Path) -> Result<RgbaImage, String> {
    Ok(image::open(path)
        .map_err(|e| format!("이미지 로드 실패 {}: {e}", path.display()))?
        .to_rgba8())
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let txt = std::fs::read_to_string(path).map_err(|e| format!("읽기 실패 {}: {e}", path.display()))?;
    serde_json::from_str(&txt).map_err(|e| format!("파싱 실패 {}: {e}", path.display()))
}

/// captures 매니페스트의 frame 경로(매니페스트 위치 기준)들을 로드.
fn load_capture_frames(
    manifest: &CapturesManifest,
    manifest_dir: &Path,
) -> Result<HashMap<String, RgbaImage>, String> {
    let mut frames = HashMap::new();
    for c in &manifest.captures {
        let img = load_image(&manifest_dir.join(&c.frame))?;
        frames.insert(c.screen_id.clone(), img);
    }
    Ok(frames)
}

fn cmd_fingerprints(args: &[String]) -> Result<(), String> {
    let [cfg_path, cap_path, out_path] = three(args, "fingerprints")?;
    let mut config: MatchingConfig = read_json(&cfg_path)?;
    let manifest: CapturesManifest = read_json(&cap_path)?;
    let dir = cap_path.parent().unwrap_or(Path::new("."));
    let frames = load_capture_frames(&manifest, dir)?;

    let log = fill_fingerprints(&mut config, &frames);
    for l in &log {
        println!("{l}");
    }
    config
        .validate()
        .map_err(|errs| format!("결과 config 검증 실패:\n  - {}", errs.join("\n  - ")))?;

    let txt = serde_json::to_string_pretty(&config).map_err(|e| format!("직렬화 실패: {e}"))?;
    std::fs::write(&out_path, txt).map_err(|e| format!("쓰기 실패 {}: {e}", out_path.display()))?;
    println!("\n[done] {} 작성. 검증 통과.", out_path.display());
    Ok(())
}

fn cmd_templates(args: &[String]) -> Result<(), String> {
    let [cap_path, out_dir] = two(args, "templates")?;
    let manifest: CapturesManifest = read_json(&cap_path)?;
    let dir = cap_path.parent().unwrap_or(Path::new("."));
    let frames = load_capture_frames(&manifest, dir)?;

    let (index, images) = author_templates(&manifest.templates, &frames, TEMPLATE_MAX_DIM)?;
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("디렉토리 생성 실패: {e}"))?;
    for (file, img) in &images {
        let p = out_dir.join(file);
        img.save(&p).map_err(|e| format!("템플릿 저장 실패 {}: {e}", p.display()))?;
        println!("[ok] {} ({}x{})", p.display(), img.width(), img.height());
    }
    let idx_path = out_dir.join("templates.json");
    let txt = serde_json::to_string_pretty(&index).map_err(|e| format!("직렬화 실패: {e}"))?;
    std::fs::write(&idx_path, txt).map_err(|e| format!("쓰기 실패: {e}"))?;
    println!("\n[done] {} ({}개 템플릿).", idx_path.display(), images.len());
    Ok(())
}

fn cmd_preview(args: &[String]) -> Result<(), String> {
    let [cfg_path, screen_id, frame_path, out_path] = four(args, "preview")?;
    let config: MatchingConfig = read_json(&cfg_path)?;
    let screen = config
        .screen(&screen_id.to_string_lossy())
        .ok_or_else(|| format!("화면 '{}' 가 config 에 없음", screen_id.display()))?;
    let frame = load_image(&frame_path)?;
    let gr = mc::authoring::detect_or_full(&frame);
    println!(
        "game_rect = ({}, {}, {}, {})  [frame {}x{}]",
        gr.x, gr.y, gr.w, gr.h, frame.width(), frame.height()
    );

    let mut regions: Vec<(NormRect, [u8; 3])> = Vec::new();
    for f in &screen.fingerprints {
        regions.push((NormRect::from_array(f.region), [0, 220, 0])); // 지문: 초록
    }
    for a in &screen.anchors {
        regions.push((NormRect::from_array(a.search_region), [255, 140, 0])); // 앵커: 주황
    }
    let out = draw_regions(&frame, &gr, &regions);
    out.save(&out_path).map_err(|e| format!("저장 실패 {}: {e}", out_path.display()))?;
    println!(
        "[done] {} (지문 {}개=초록, 앵커 search {}개=주황)",
        out_path.display(),
        screen.fingerprints.len(),
        screen.anchors.len()
    );
    Ok(())
}

// --- 인자 개수 헬퍼 ---
fn two(a: &[String], cmd: &str) -> Result<[PathBuf; 2], String> {
    if a.len() != 2 {
        return Err(format!("'{cmd}' 는 인자 2개 필요\n\n{}", usage()));
    }
    Ok([PathBuf::from(&a[0]), PathBuf::from(&a[1])])
}
fn three(a: &[String], cmd: &str) -> Result<[PathBuf; 3], String> {
    if a.len() != 3 {
        return Err(format!("'{cmd}' 는 인자 3개 필요\n\n{}", usage()));
    }
    Ok([PathBuf::from(&a[0]), PathBuf::from(&a[1]), PathBuf::from(&a[2])])
}
fn four(a: &[String], cmd: &str) -> Result<[PathBuf; 4], String> {
    if a.len() != 4 {
        return Err(format!("'{cmd}' 는 인자 4개 필요\n\n{}", usage()));
    }
    Ok([
        PathBuf::from(&a[0]),
        PathBuf::from(&a[1]),
        PathBuf::from(&a[2]),
        PathBuf::from(&a[3]),
    ])
}
