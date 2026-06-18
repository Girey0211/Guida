//! M-pre #1: 크레이트·해시 파라미터 벤치.
//!
//! `img_hash`와 `image_hasher`를 둘 다 깔아 449개 실데이터로 벤치한다.
//! 선택 기준은 유지보수 활발함이 아니라 **변별력 + 왜곡 강건성**. (계획서 §3 M-pre)
//!
//! 측정 축:
//!   1. 변별력  — 449 pairwise 최소 해밍 거리 + near-collision 쌍 수
//!   2. 강건성  — 합성 왜곡 복원 top-1 (현실/스트레스 분리)
//!
//! 스윕 차원: 정규화 방식(full / center-crop) × 해시 크기 × 알고리즘 × DCT.
//! 두 크레이트가 사실상 동일함을 한 config로 확인한 뒤, 변형 스윕은 image_hasher로 수행.
//!
//! 사용: cargo run --release --bin bench_crates -- <gifts.json> <images_dir>

use matching_core as mc;
use std::collections::HashMap;
use std::path::Path;

struct Report {
    label: String,
    bits: u32,
    min_inter: u32,
    near_lt: [usize; 3], // < (margin) for margins [8,12,16] 비율 참고
    median_inter: u32,
    real_top1: f64,
    stress_top1: f64,
    p99_real_intra: u32,
    max_real_intra: u32,
    worst: String,
}

macro_rules! gen_compute {
    ($fname:ident, $cr:path, $buffn:path) => {
        fn $fname(raw: &[u8], w: u32, h: u32, alg: &str, size: u32, dct: bool) -> Vec<u8> {
            use $cr as hc;
            let buf = $buffn(raw, w, h);
            let a = match alg {
                "mean" => hc::HashAlg::Mean,
                "gradient" => hc::HashAlg::Gradient,
                "dblgrad" => hc::HashAlg::DoubleGradient,
                "blockhash" => hc::HashAlg::Blockhash,
                _ => unreachable!(),
            };
            let mut cfg = hc::HasherConfig::new().hash_alg(a).hash_size(size, size);
            if dct {
                cfg = cfg.preproc_dct();
            }
            cfg.to_hasher().hash_image(&buf).as_bytes().to_vec()
        }
    };
}

gen_compute!(compute_imghash, img_hash, mc::to_imghash_buf);
gen_compute!(compute_hasher, image_hasher, mc::to_hasher_buf);

type ComputeFn = fn(&[u8], u32, u32, &str, u32, bool) -> Vec<u8>;

fn percentile(sorted: &[u32], pct: f64) -> u32 {
    if sorted.is_empty() {
        return 0;
    }
    sorted[(((sorted.len() - 1) as f64) * pct).round() as usize]
}

/// 한 정규화 방식(keep)에 대한 raw 캐시: (refs, distortions).
struct DataSet {
    refs: Vec<(Vec<u8>, u32, u32)>,
    dists: Vec<Vec<(&'static str, bool, (Vec<u8>, u32, u32))>>,
}

fn build_dataset(gifts: &[mc::GiftRecord], images_dir: &Path, keep: f32) -> DataSet {
    let mut refs = Vec::with_capacity(gifts.len());
    let mut dists = Vec::with_capacity(gifts.len());
    for (idx, g) in gifts.iter().enumerate() {
        let p = mc::image_path(images_dir, &g.image_key);
        let img = image::open(&p)
            .unwrap_or_else(|e| panic!("decode {} : {e}", p.display()))
            .to_rgba8();
        let canon = mc::center_crop_canon(&img, keep);
        let mut dset = Vec::new();
        for dd in mc::distortion_suite(&canon, 0x1234_0000 ^ idx as u32) {
            dset.push((dd.name, dd.realistic, mc::as_raw(&dd.img)));
        }
        refs.push(mc::as_raw(&canon));
        dists.push(dset);
    }
    DataSet { refs, dists }
}

fn eval(label: &str, compute: ComputeFn, alg: &str, size: u32, dct: bool, ds: &DataSet) -> Report {
    let ref_hashes: Vec<Vec<u8>> = ds
        .refs
        .iter()
        .map(|(r, w, h)| compute(r, *w, *h, alg, size, dct))
        .collect();
    let bits = (ref_hashes[0].len() * 8) as u32;

    // 변별력
    let n = ref_hashes.len();
    let mut inter = Vec::with_capacity(n * (n - 1) / 2);
    for i in 0..n {
        for j in (i + 1)..n {
            inter.push(mc::hamming(&ref_hashes[i], &ref_hashes[j]));
        }
    }
    inter.sort_unstable();
    let min_inter = inter[0];
    let median_inter = percentile(&inter, 0.5);
    let near_lt = [
        inter.iter().take_while(|&&d| d < 8).count(),
        inter.iter().take_while(|&&d| d < 12).count(),
        inter.iter().take_while(|&&d| d < 16).count(),
    ];

    // 강건성 (현실/스트레스 분리)
    let mut real_intra = Vec::new();
    let (mut real_ok, mut real_tot, mut stress_ok, mut stress_tot) = (0usize, 0, 0usize, 0);
    let mut worst: HashMap<&'static str, usize> = HashMap::new();
    for (i, dset) in ds.dists.iter().enumerate() {
        for (dname, realistic, (r, w, h)) in dset {
            let dh = compute(r, *w, *h, alg, size, dct);
            let mut best = u32::MAX;
            let mut best_idx = 0usize;
            let mut true_d = u32::MAX;
            for (k, rh) in ref_hashes.iter().enumerate() {
                let d = mc::hamming(&dh, rh);
                if k == i {
                    true_d = d;
                }
                if d < best {
                    best = d;
                    best_idx = k;
                }
            }
            let ok = best_idx == i;
            if *realistic {
                real_tot += 1;
                real_intra.push(true_d);
                if ok {
                    real_ok += 1;
                } else {
                    *worst.entry(dname).or_insert(0) += 1;
                }
            } else {
                stress_tot += 1;
                if ok {
                    stress_ok += 1;
                } else {
                    *worst.entry(dname).or_insert(0) += 1;
                }
            }
        }
    }
    real_intra.sort_unstable();
    Report {
        label: label.to_string(),
        bits,
        min_inter,
        near_lt,
        median_inter,
        real_top1: real_ok as f64 / real_tot as f64 * 100.0,
        stress_top1: stress_ok as f64 / stress_tot as f64 * 100.0,
        p99_real_intra: percentile(&real_intra, 0.99),
        max_real_intra: *real_intra.last().unwrap(),
        worst: worst
            .iter()
            .max_by_key(|(_, c)| **c)
            .map(|(k, c)| format!("{k}({c})"))
            .unwrap_or_else(|| "none".into()),
    }
}

fn print_table(title: &str, reports: &[Report]) {
    println!("\n=== {title} ===\n");
    println!(
        "{:<30} {:>4} {:>9} {:>9} {:>9} {:>9} {:>10} {:>9} {:>9}  {}",
        "config",
        "bits",
        "minInter",
        "medInter",
        "real%",
        "stress%",
        "p99intra",
        "maxIntra",
        "near<12",
        "worst"
    );
    println!("{}", "-".repeat(130));
    for r in reports {
        println!(
            "{:<30} {:>4} {:>9} {:>9} {:>9.2} {:>9.2} {:>10} {:>9} {:>9}  {}",
            r.label,
            r.bits,
            r.min_inter,
            r.median_inter,
            r.real_top1,
            r.stress_top1,
            r.p99_real_intra,
            r.max_real_intra,
            r.near_lt[1],
            r.worst
        );
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let gifts_path = args
        .get(1)
        .map(String::as_str)
        .unwrap_or("../../guida-server/data/gifts.json");
    let images_dir = Path::new(
        args.get(2)
            .map(String::as_str)
            .unwrap_or("../../guida-server/data/images"),
    );

    eprintln!("[load] gifts.json ...");
    let gifts = mc::load_gifts(Path::new(gifts_path));
    eprintln!("    gifts: {}", gifts.len());

    // (A) 크레이트 동등성 확인: 같은 config를 두 크레이트로
    eprintln!("[A] 크레이트 동등성 확인 (full, gradient sz16 dct=n)...");
    let ds_full = build_dataset(&gifts, images_dir, 1.0);
    let eq = vec![
        eval(
            "img_hash  grad sz16",
            compute_imghash,
            "gradient",
            16,
            false,
            &ds_full,
        ),
        eval(
            "image_hasher grad sz16",
            compute_hasher,
            "gradient",
            16,
            false,
            &ds_full,
        ),
    ];
    print_table("A. 크레이트 동등성 (두 행이 사실상 같으면 변별력 동일)", &eq);

    // (B) image_hasher 로 정규화방식 × 크기 × alg × dct 스윕
    eprintln!("[B] 파라미터 스윕 (image_hasher)...");
    let keeps = [(1.0f32, "full"), (0.85, "cc85"), (0.75, "cc75")];
    let algs = ["mean", "gradient", "dblgrad"];
    let sizes = [16u32, 32u32];
    let mut reports = Vec::new();
    for (keep, kname) in keeps {
        let ds = if keep == 1.0 {
            None // reuse ds_full
        } else {
            Some(build_dataset(&gifts, images_dir, keep))
        };
        let dsr = ds.as_ref().unwrap_or(&ds_full);
        for alg in algs {
            for &size in &sizes {
                for &dct in &[false, true] {
                    let label = format!("{kname} {alg:<8} sz{size} dct={}", if dct { "Y" } else { "n" });
                    let rep = eval(&label, compute_hasher, alg, size, dct, dsr);
                    eprintln!("    done: {label}");
                    reports.push(rep);
                }
            }
        }
    }

    // 정렬: 현실 top1 desc → min_inter desc
    reports.sort_by(|a, b| {
        b.real_top1
            .partial_cmp(&a.real_top1)
            .unwrap()
            .then(b.min_inter.cmp(&a.min_inter))
    });
    print_table("B. 파라미터 스윕 (현실 top1 내림차순)", &reports);

    println!("\n해설:");
    println!("  minInter = 가장 가까운 서로 다른 두 아이콘 해밍 (변별력 하한, 클수록 좋음)");
    println!("  real%    = 현실적 왜곡 복원 top-1 (완료 기준 ≥ 99%)");
    println!("  stress%  = 가혹 왜곡 복원 top-1 (헤드룸)");
    println!("  near<12  = inter 거리 < 12 인 쌍 수 (2차 판별이 필요한 모호쌍 규모)");

    if let Some(b) = reports.first() {
        println!(
            "\n>>> 현실 top1 최상위: [{}] real={:.2}% stress={:.2}% minInter={} bits={}",
            b.label.trim(),
            b.real_top1,
            b.stress_top1,
            b.min_inter,
            b.bits
        );
    }
}
