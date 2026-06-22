//! 매칭 데이터 **저작 헬퍼** — 캡처 프레임에서 라이브 데이터를 만든다.
//! (계획서 §1.3 데이터 측, M1/M2 "라이브 ~ 작성 필요" 항목의 도구)
//!
//! 코어 로직(M-pre~M2)은 합성으로 검증됐지만, 실제로 돌려면 알고리즘이 합성할 수
//! 없는 데이터가 필요하다:
//!   - `matching_config.json` 의 region-pHash 지문값 (화면 캡처 → [`fill_fingerprints`])
//!   - 앵커 템플릿 이미지 + 정규화 footprint (화면 캡처 크롭 → [`author_templates`])
//!
//! GUI 없이 스크립트로 만들기 위한 순수 함수다. `bin/author.rs` 가 파일 입출력만
//! 얹은 얇은 CLI 래퍼. 좌표는 사람이 [`draw_regions`] 미리보기로 눈으로 확인한다.
//!
//! 핵심: 지문 생성에 런타임과 **동일한** [`crate::screen::region_phash`] 를 쓴다
//! (SSOT). 도구가 다른 해시를 쓰면 런타임 분류가 통째로 어긋난다.

use crate::anchor::{TemplateIndex, TemplateMeta};
use crate::config::MatchingConfig;
use crate::geometry::{GameRect, NormRect};
use crate::normalize::{detect_game_rect, DetectOpts};
use crate::screen::region_phash;
use image::{Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 화면 1개의 캡처(screen_id → 프레임 경로).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureEntry {
    pub screen_id: String,
    /// 매니페스트 파일 위치 기준 상대 경로.
    pub frame: String,
}

/// 앵커 템플릿 저작 스펙.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateSpec {
    pub template_key: String,
    /// 어느 화면 캡처에서 크롭할지(= CaptureEntry.screen_id).
    pub from_screen: String,
    /// 크롭할 앵커의 **정확한** 정규화 경계 `[x,y,w,h]`(search_region 보다 타이트).
    pub region: [f32; 4],
}

/// 저작 매니페스트(`captures.json`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CapturesManifest {
    #[serde(default)]
    pub captures: Vec<CaptureEntry>,
    #[serde(default)]
    pub templates: Vec<TemplateSpec>,
}

/// 캡처 프레임에서 game rect 검출(실패 시 전체 프레임). 런타임 분류와 동일 경로.
pub fn detect_or_full(frame: &RgbaImage) -> GameRect {
    detect_game_rect(
        frame.as_raw(),
        frame.width(),
        frame.height(),
        &DetectOpts::default(),
    )
    .unwrap_or_else(|| GameRect::new(0, 0, frame.width(), frame.height()))
}

/// 각 화면의 지문 region 을 해당 캡처에서 해시해 config 의 `phash` 를 채운다(in-place).
/// 캡처가 없는 화면은 건너뛴다. 반환: 사람이 읽는 처리 로그.
pub fn fill_fingerprints(
    config: &mut MatchingConfig,
    frames: &HashMap<String, RgbaImage>,
) -> Vec<String> {
    let mut log = Vec::new();
    for s in &mut config.screens {
        let Some(frame) = frames.get(&s.screen_id) else {
            log.push(format!("[skip] '{}' 캡처 없음 — phash 미갱신", s.screen_id));
            continue;
        };
        let gr = detect_or_full(frame);
        log.push(format!(
            "[frame] '{}' {}x{} game_rect=({},{},{},{})",
            s.screen_id, frame.width(), frame.height(), gr.x, gr.y, gr.w, gr.h
        ));
        for (i, f) in s.fingerprints.iter_mut().enumerate() {
            match region_phash(frame, &gr, &NormRect::from_array(f.region)) {
                Some(h) => {
                    f.phash = h;
                    log.push(format!("  [ok] fingerprint[{i}] region={:?} 해시 갱신", f.region));
                }
                None => log.push(format!(
                    "  [warn] fingerprint[{i}] region={:?} 크롭 0 — 좌표 확인 필요",
                    f.region
                )),
            }
        }
    }
    log
}

/// 앵커 템플릿 스펙들을 크롭·정규화해 (인덱스, [(파일명, 이미지)]) 산출.
/// `max_dim`: 템플릿 이미지 최대 변(파일 경량화용). 런타임이 expected px 로 다시
/// 리사이즈하므로 다운스케일 손실은 무관하다.
pub fn author_templates(
    specs: &[TemplateSpec],
    frames: &HashMap<String, RgbaImage>,
    max_dim: u32,
) -> Result<(TemplateIndex, Vec<(String, RgbaImage)>), String> {
    let mut index = TemplateIndex::new();
    let mut images = Vec::new();
    for sp in specs {
        let frame = frames.get(&sp.from_screen).ok_or_else(|| {
            format!("템플릿 '{}': from_screen '{}' 캡처 없음", sp.template_key, sp.from_screen)
        })?;
        let gr = detect_or_full(frame);
        let (x, y, w, h) =
            gr.norm_rect_to_px_clamped(&NormRect::from_array(sp.region), frame.width(), frame.height());
        if w == 0 || h == 0 {
            return Err(format!("템플릿 '{}': region 크롭 0 — 좌표 확인", sp.template_key));
        }
        let crop = image::imageops::crop_imm(frame, x, y, w, h).to_image();
        let scale = (max_dim as f32 / w.max(h) as f32).min(1.0);
        let tw = ((w as f32 * scale).round() as u32).max(1);
        let th = ((h as f32 * scale).round() as u32).max(1);
        let tmpl = image::imageops::resize(&crop, tw, th, crate::CANON_FILTER);
        let file = format!("{}.png", sp.template_key);
        index.insert(
            sp.template_key.clone(),
            TemplateMeta {
                file: file.clone(),
                norm_w: sp.region[2],
                norm_h: sp.region[3],
            },
        );
        images.push((file, tmpl));
    }
    Ok((index, images))
}

/// 프레임에 정규화 영역들을 색 외곽선으로 그려 좌표 검증 미리보기를 만든다.
/// `(영역, RGB색)` 목록을 받는다.
pub fn draw_regions(
    frame: &RgbaImage,
    gr: &GameRect,
    regions: &[(NormRect, [u8; 3])],
) -> RgbaImage {
    let mut out = frame.clone();
    for (r, color) in regions {
        let (x, y, w, h) = gr.norm_rect_to_px_clamped(r, frame.width(), frame.height());
        draw_rect_outline(&mut out, x, y, w, h, *color);
    }
    out
}

fn draw_rect_outline(img: &mut RgbaImage, x: u32, y: u32, w: u32, h: u32, c: [u8; 3]) {
    if w == 0 || h == 0 {
        return;
    }
    let col = Rgba([c[0], c[1], c[2], 255]);
    let (iw, ih) = (img.width(), img.height());
    let thick = (w.min(h) / 40).clamp(1, 4);
    for t in 0..thick {
        for xx in x..(x + w).min(iw) {
            if y + t < ih {
                img.put_pixel(xx, y + t, col);
            }
            if y + h > t && y + h - 1 - t < ih {
                img.put_pixel(xx, y + h - 1 - t, col);
            }
        }
        for yy in y..(y + h).min(ih) {
            if x + t < iw {
                img.put_pixel(x + t, yy, col);
            }
            if x + w > t && x + w - 1 - t < iw {
                img.put_pixel(x + w - 1 - t, yy, col);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Fingerprint, ScreenConfig};
    use crate::screen::classify;

    /// 지문 영역에 구조적 패턴을 칠한 합성 프레임(균일색은 그라디언트 해시가 0이라 변별 불가).
    fn synth(fw: u32, fh: u32, gr: GameRect, region: [f32; 4], pattern: u16) -> RgbaImage {
        let mut c = RgbaImage::from_pixel(fw, fh, Rgba([0, 0, 0, 255]));
        for yy in 0..gr.h {
            for xx in 0..gr.w {
                c.put_pixel(gr.x as u32 + xx, gr.y as u32 + yy, Rgba([60, 62, 64, 255]));
            }
        }
        let (rx, ry, rw, rh) =
            gr.norm_rect_to_px_clamped(&NormRect::from_array(region), fw, fh);
        let (cols, rows) = (4u32, 4u32);
        let (cw, ch) = ((rw / cols).max(1), (rh / rows).max(1));
        for bit in 0..16u32 {
            if (pattern >> bit) & 1 == 1 {
                let (cc, rr) = (bit % cols, bit / cols);
                for yy in ry + rr * ch..(ry + (rr + 1) * ch).min(ry + rh) {
                    for xx in rx + cc * cw..(rx + (cc + 1) * cw).min(rx + rw) {
                        c.put_pixel(xx, yy, Rgba([220, 200, 40, 255]));
                    }
                }
            }
        }
        c
    }

    fn screen(id: &str, region: [f32; 4]) -> ScreenConfig {
        ScreenConfig {
            screen_id: id.into(),
            name: id.into(),
            fingerprints: vec![Fingerprint {
                region,
                phash: Vec::new(), // 빈 placeholder — 저작 도구가 채운다
                tolerance: 60,
            }],
            anchors: vec![],
            cross_check: None,
            elements: vec![],
            transitions_allowed: vec![],
        }
    }

    #[test]
    fn fill_fingerprints_then_classify() {
        let region = [0.38, 0.04, 0.24, 0.14];
        let gr = GameRect::new(0, 0, 1920, 1080);
        let mut cfg = MatchingConfig {
            schema_version: "1.0".into(),
            game_aspect_ratio: "16:9".into(),
            patch_version: "authoring-test".into(),
            screens: vec![screen("reward", region), screen("base_explore", region)],
        };

        // 두 화면을 서로 다른 패턴으로 캡처했다고 가정.
        let mut frames = HashMap::new();
        frames.insert("reward".into(), synth(1920, 1080, gr, region, 0b1010_0101_1010_0101));
        frames.insert("base_explore".into(), synth(1920, 1080, gr, region, 0b1100_0011_1100_0011));

        let log = fill_fingerprints(&mut cfg, &frames);
        assert!(log.iter().any(|l| l.contains("[ok]")), "{log:?}");
        // 채워진 뒤 검증 통과(phash 길이 = 런타임 해시 길이).
        cfg.validate().expect("채운 config 검증 통과");
        assert!(!cfg.screens[0].fingerprints[0].phash.is_empty());

        // 자기 자신 프레임은 자기 화면으로 분류돼야 함(해시 일치 → 거리 0).
        let res = classify(&frames["reward"], &gr, &cfg);
        assert_eq!(res.screen_id.as_deref(), Some("reward"));
    }

    #[test]
    fn author_templates_crops_and_indexes() {
        let region = [0.42, 0.05, 0.10, 0.06];
        let gr = GameRect::new(0, 0, 1920, 1080);
        let frame = synth(1920, 1080, gr, region, 0b1010_0101_1010_0101);
        let mut frames = HashMap::new();
        frames.insert("reward".into(), frame);

        let specs = vec![TemplateSpec {
            template_key: "anchor_reward_header".into(),
            from_screen: "reward".into(),
            region,
        }];
        let (index, images) = author_templates(&specs, &frames, 128).unwrap();
        let meta = index.get("anchor_reward_header").unwrap();
        assert_eq!(meta.norm_w, 0.10);
        assert_eq!(meta.norm_h, 0.06);
        assert_eq!(images.len(), 1);
        // region px = 0.10*1920 × 0.06*1080 = 192×64.8 → max변 192 ≤ 128? scale 캡 적용.
        let (_, img) = &images[0];
        assert!(img.width() <= 128 && img.height() <= 128);
    }

    #[test]
    fn draw_regions_keeps_size() {
        let gr = GameRect::new(0, 0, 1920, 1080);
        let frame = RgbaImage::from_pixel(1920, 1080, Rgba([30, 30, 30, 255]));
        let out = draw_regions(
            &frame,
            &gr,
            &[(NormRect::new(0.4, 0.04, 0.2, 0.06), [0, 255, 0])],
        );
        assert_eq!((out.width(), out.height()), (1920, 1080));
    }
}
