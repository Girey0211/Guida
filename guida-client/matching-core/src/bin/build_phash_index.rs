//! M-pre #4: `phash_index.json` 생성기.
//!
//! 확정된 SSOT 해시([`matching_core::hash`])로 449개 레퍼런스의 지각 해시를 계산해
//! `phash_index.json` 으로 저장한다. ⚠️ 이 생성기와 런타임 `identify`는 **반드시
//! 동일 크레이트·파라미터**를 공유한다(둘 다 `matching_core::hash` 경유). 불일치 시
//! 449개 매칭이 통째로 붕괴하므로, 헤더에 [`hash::HASH_VERSION`]을 기록해 런타임이
//! 로드 시점에 정합을 검증한다. (계획서 §1.3, §7.1)
//!
//! 사용:
//!   cargo run --release --bin build_phash_index -- \
//!     [gifts.json] [images_dir] [out=phash_index.json] [patch_version.json]
//!
//! center_crop 은 현재 [`matching_core::DEFAULT_CENTER_CROP`]. M2에서 최종 확정 시
//! 동일 값으로 재생성해야 한다.

use matching_core as mc;
use mc::identify::{IndexEntry, PhashIndex};
use std::path::Path;

fn read_patch_version(path: &Path) -> String {
    let Ok(txt) = std::fs::read_to_string(path) else {
        return "unknown".into();
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) else {
        return "unknown".into();
    };
    v.get("current_patch")
        .and_then(|x| x.as_str())
        .unwrap_or("unknown")
        .to_string()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let gifts_path = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "../../guida-server/data/gifts.json".into());
    let images_dir = args
        .get(2)
        .cloned()
        .unwrap_or_else(|| "../../guida-server/data/images".into());
    let out_path = args
        .get(3)
        .cloned()
        .unwrap_or_else(|| "phash_index.json".into());
    let patch_path = args
        .get(4)
        .cloned()
        .unwrap_or_else(|| "../../guida-server/data/patch_version.json".into());

    let cc = mc::DEFAULT_CENTER_CROP;
    let patch_version = read_patch_version(Path::new(&patch_path));
    eprintln!(
        "[build] config={} center_crop={cc} patch={patch_version}",
        mc::hash::HASH_VERSION
    );

    let gifts = mc::load_gifts(Path::new(&gifts_path));
    let images = Path::new(&images_dir);

    let mut entries: Vec<IndexEntry> = Vec::with_capacity(gifts.len());
    let mut seen = std::collections::HashSet::new();
    for g in &gifts {
        if !seen.insert(g.id.clone()) {
            panic!("중복 gift_id: {}", g.id);
        }
        let path = mc::image_path(images, &g.image_key);
        let img = image::open(&path)
            .unwrap_or_else(|e| panic!("디코드 실패 {}: {e}", path.display()))
            .to_rgba8();
        entries.push(IndexEntry {
            gift_id: g.id.clone(),
            hash: mc::hash::phash_with_crop(&img, cc),
        });
    }

    let bits = entries[0].hash.len() * 8;
    let index = PhashIndex {
        hash_version: mc::hash::HASH_VERSION.to_string(),
        center_crop: cc,
        patch_version,
        entries,
    };

    // 자기검증: 로드 정합 + 모든 레퍼런스가 자기 자신을 거리 0으로 식별하는가.
    let json = serde_json::to_string_pretty(&index).expect("직렬화 실패");
    std::fs::write(&out_path, &json).expect("저장 실패");
    let reloaded = PhashIndex::load(Path::new(&out_path)).expect("재로드/버전검증 실패");
    assert_eq!(reloaded.entries.len(), index.entries.len());
    for e in &reloaded.entries {
        let res = reloaded.identify_hash(&e.hash, 1, 0, u32::MAX);
        assert_eq!(res.top[0].gift_id, e.gift_id, "자기 식별 실패: {}", e.gift_id);
        assert_eq!(res.top[0].dist, 0, "자기 거리 0 아님: {}", e.gift_id);
    }

    let size_kb = json.len() as f64 / 1024.0;
    println!(
        "[ok] {out_path} 생성: {}개 아이콘, {bits}bit/해시, {size_kb:.1} KB",
        index.entries.len()
    );
    println!("     hash_version={}", index.hash_version);
    println!("     자기검증 통과(모든 레퍼런스 self-dist=0).");
}
