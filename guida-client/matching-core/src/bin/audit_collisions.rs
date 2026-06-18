//! M-pre #3: 449 pairwise 변별력 감사 + near-collision 리포트 + ambiguity_margin 도출.
//!
//! 확정된 SSOT 해시([`matching_core::hash`])로 449개 전체의 pairwise 최소 해밍 거리
//! 분포를 뽑고, 충돌 위험 쌍을 리포트한다. ("조각" 시리즈·색만 다른 등급 변형 등)
//! 또한 현실적 왜곡에서 top1-top2 마진 분포를 측정해 `ambiguity_margin` 권장값을
//! **데이터 근거와 함께** 도출한다. (계획서 §3 M-pre, §4)
//!
//! 사용: cargo run --release --bin audit_collisions -- [gifts.json] [images_dir] [out.json]

use matching_core as mc;
use mc::identify::{IndexEntry, PhashIndex};
use std::collections::HashMap;
use std::path::Path;

fn pct(sorted: &[u32], p: f64) -> u32 {
    if sorted.is_empty() {
        return 0;
    }
    sorted[(((sorted.len() - 1) as f64) * p).round() as usize]
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
        .unwrap_or_else(|| "near_collisions.json".into());

    let cc = mc::DEFAULT_CENTER_CROP;
    eprintln!(
        "[load] gifts.json + 449 해시 (config: {}, center_crop={cc})",
        mc::hash::HASH_VERSION
    );
    let gifts = mc::load_gifts(Path::new(&gifts_path));
    let images = Path::new(&images_dir);

    // gift_id → 메타(이름/등급/키워드) 룩업
    let meta: HashMap<String, &mc::GiftRecord> =
        gifts.iter().map(|g| (g.id.clone(), g)).collect();

    // 449 해시 (인덱스 구성)
    let entries: Vec<IndexEntry> = gifts
        .iter()
        .map(|g| {
            let img = image::open(mc::image_path(images, &g.image_key))
                .expect("decode")
                .to_rgba8();
            IndexEntry {
                gift_id: g.id.clone(),
                hash: mc::hash::phash_with_crop(&img, cc),
            }
        })
        .collect();
    let bits = entries[0].hash.len() * 8;
    let n = entries.len();

    // ---- 1) pairwise inter-class 분포 + near pair 수집 ----
    let mut all: Vec<u32> = Vec::with_capacity(n * (n - 1) / 2);
    let mut min_per_i = vec![(u32::MAX, 0usize); n];
    let mut near_pairs: Vec<(u32, usize, usize)> = Vec::new();
    const NEAR_LIST_THRESH: u32 = 40; // 리포트에 올릴 쌍 거리 상한
    for i in 0..n {
        for j in (i + 1)..n {
            let d = mc::hamming(&entries[i].hash, &entries[j].hash);
            all.push(d);
            if d < min_per_i[i].0 {
                min_per_i[i] = (d, j);
            }
            if d < min_per_i[j].0 {
                min_per_i[j] = (d, i);
            }
            if d < NEAR_LIST_THRESH {
                near_pairs.push((d, i, j));
            }
        }
    }
    all.sort_unstable();
    near_pairs.sort_by_key(|p| p.0);

    println!("\n======== M-pre #3: 449 PAIRWISE 변별력 감사 ========\n");
    println!("config      : {}", mc::hash::HASH_VERSION);
    println!("center_crop : {cc}");
    println!("아이콘 수   : {n}, 해시 비트: {bits}, 총 쌍: {}", all.len());
    println!("\n-- inter-class 해밍 거리 분포 (서로 다른 두 아이콘) --");
    println!(
        "  min={}  p0.1%={}  p1%={}  p5%={}  p25%={}  median={}",
        all[0],
        pct(&all, 0.001),
        pct(&all, 0.01),
        pct(&all, 0.05),
        pct(&all, 0.25),
        pct(&all, 0.5)
    );
    let near = |t: u32| all.iter().take_while(|&&d| d < t).count();
    println!(
        "  near<8={}  near<12={}  near<16={}  near<20={}  near<24={}  near<{}={}",
        near(8),
        near(12),
        near(16),
        near(20),
        near(24),
        NEAR_LIST_THRESH,
        near(NEAR_LIST_THRESH)
    );

    // ---- 2) near-collision 쌍 리포트 ----
    println!(
        "\n-- near-collision 쌍 (거리 < {NEAR_LIST_THRESH}, {}쌍) --",
        near_pairs.len()
    );
    println!(
        "{:>5}  {:<22} {:<22}  {}",
        "dist", "gift_a", "gift_b", "grade/keyword (a | b)"
    );
    let name = |id: &str| -> String { meta.get(id).map(|g| g.name.clone()).unwrap_or_else(|| id.to_string()) };
    let gk = |id: &str| {
        meta.get(id)
            .map(|g| format!("{}/{}", g.grade, g.keyword_type))
            .unwrap_or_default()
    };
    for (d, i, j) in near_pairs.iter().take(40) {
        let a = &entries[*i].gift_id;
        let b = &entries[*j].gift_id;
        println!(
            "{d:>5}  {:<22} {:<22}  {} | {}",
            name(a),
            name(b),
            gk(a),
            gk(b)
        );
    }

    // ---- 3) 현실 왜곡 top1-top2 마진 분포 → ambiguity_margin 도출 ----
    let idx = PhashIndex {
        hash_version: mc::hash::HASH_VERSION.to_string(),
        center_crop: cc,
        patch_version: String::new(),
        entries: entries.clone(),
    };
    let mut correct_gap: Vec<u32> = Vec::new();
    let mut wrong: Vec<(String, &'static str, String, u32, u32)> = Vec::new(); // (true, distort, got, d_true, d_got)
    for (i, g) in gifts.iter().enumerate() {
        let img = image::open(mc::image_path(images, &g.image_key))
            .unwrap()
            .to_rgba8();
        let canon = mc::center_crop_canon(&img, cc);
        for dd in mc::distortion_suite(&canon, 0x1234_0000 ^ i as u32) {
            if !dd.realistic {
                continue;
            }
            let res = idx.identify_canonical(&dd.img, 2, 0, u32::MAX);
            let d1 = res.top[0].dist;
            let d2 = res.top[1].dist;
            if res.top[0].gift_id == g.id {
                correct_gap.push(d2 - d1);
            } else {
                // true gift의 거리 찾기
                let qd = mc::hash::phash_canonical(&dd.img);
                let dt = entries
                    .iter()
                    .find(|e| e.gift_id == g.id)
                    .map(|e| mc::hamming(&qd, &e.hash))
                    .unwrap_or(0);
                wrong.push((g.id.clone(), dd.name, res.top[0].gift_id.clone(), dt, d1));
            }
        }
    }
    correct_gap.sort_unstable();

    println!("\n-- 현실 왜곡 정답 매칭의 top1-top2 마진 분포 ({}건) --", correct_gap.len());
    println!(
        "  min={}  p0.5%={}  p1%={}  p5%={}  p25%={}  median={}",
        correct_gap[0],
        pct(&correct_gap, 0.005),
        pct(&correct_gap, 0.01),
        pct(&correct_gap, 0.05),
        pct(&correct_gap, 0.25),
        pct(&correct_gap, 0.5)
    );
    println!("\n-- 현실 왜곡 오식별 ({}건) --", wrong.len());
    for (t, dn, got, dt, dg) in &wrong {
        println!(
            "  {} <{}> → {} (d_true={dt}, d_got={dg})",
            name(t),
            dn,
            name(got)
        );
    }

    // ---- 4) ambiguity_margin 권장값 도출 ----
    // 정답 매칭 마진의 1퍼센타일을 기준으로, 그 이하 마진을 "모호"로 보고 2차 판별.
    // 너무 낮으면 오식별을 놓치고, 너무 높으면 정상 매칭을 과도하게 모호 처리.
    let p1 = pct(&correct_gap, 0.01);
    let p05 = pct(&correct_gap, 0.005);
    // 권장: p1 근방을 올림. 정답의 99%는 이보다 큰 마진으로 이김 → 정상은 거의 안 걸림,
    // 색/등급 변형 같은 진짜 모호쌍만 2차로 보냄.
    let recommend = p1.max(p05);
    println!("\n======== 권장 ambiguity_margin ========");
    println!("  정답 마진 p1% = {p1}, p0.5% = {p05}");
    println!("  >>> ambiguity_margin = {recommend}");
    println!("  근거: 정답 매칭의 99%가 마진 > {recommend} 로 이김. 이 이하(top2-top1 ≤ {recommend})는");
    println!("        2차 판별(템플릿/컬러)로 보낸다. near-collision 쌍(잔영/색·등급 변형)이 주 대상.");

    // ---- JSON 리포트 저장 ----
    #[derive(serde::Serialize)]
    struct NearPair<'a> {
        dist: u32,
        gift_a: &'a str,
        gift_b: &'a str,
        grade_a: &'a str,
        grade_b: &'a str,
    }
    #[derive(serde::Serialize)]
    struct AuditReport<'a> {
        hash_version: &'a str,
        center_crop: f32,
        icon_count: usize,
        hash_bits: usize,
        min_inter: u32,
        near_lt12: usize,
        near_lt16: usize,
        recommended_ambiguity_margin: u32,
        correct_margin_p1: u32,
        near_pairs: Vec<NearPair<'a>>,
        wrong_count: usize,
    }
    let np: Vec<NearPair> = near_pairs
        .iter()
        .map(|(d, i, j)| NearPair {
            dist: *d,
            gift_a: &entries[*i].gift_id,
            gift_b: &entries[*j].gift_id,
            grade_a: meta.get(&entries[*i].gift_id).map(|g| g.grade.as_str()).unwrap_or(""),
            grade_b: meta.get(&entries[*j].gift_id).map(|g| g.grade.as_str()).unwrap_or(""),
        })
        .collect();
    let report = AuditReport {
        hash_version: mc::hash::HASH_VERSION,
        center_crop: cc,
        icon_count: n,
        hash_bits: bits,
        min_inter: all[0],
        near_lt12: near(12),
        near_lt16: near(16),
        recommended_ambiguity_margin: recommend,
        correct_margin_p1: p1,
        near_pairs: np,
        wrong_count: wrong.len(),
    };
    std::fs::write(&out_path, serde_json::to_string_pretty(&report).unwrap())
        .expect("리포트 저장 실패");
    println!("\n[saved] {out_path}");
}
