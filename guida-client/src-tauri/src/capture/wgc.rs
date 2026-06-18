//! Windows Graphics Capture(WGC) 세션 — 게임 창 프레임 획득. (계획서 §2 capture/wgc.rs)
//!
//! borderless 권장. exclusive fullscreen 은 WGC 가 캡처하지 못할 수 있어 상위에서
//! 안내한다(계획서 §9.2). D3D11 → 스테이징 텍스처 → CPU 매핑으로 BGRA 를 읽어
//! RGBA [`Frame`] 으로 변환한다.
//!
//! ⚠️ 이 모듈은 실제 GPU·게임 창이 있어야 동작을 검증할 수 있다(헤드리스 CI 불가).
//! 오프라인 파이프라인 검증은 [`super::frame::SyntheticFrameSource`] 로 한다.

#![cfg(windows)]

use super::frame::{Frame, FrameSource};
use windows::core::Interface;
use windows::Graphics::SizeInt32;
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{HMODULE, HWND};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

/// 버퍼 개수(프레임 풀). 2면 최신 프레임을 받기 충분.
const NUM_BUFFERS: i32 = 2;

pub struct WgcCapture {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    _item: GraphicsCaptureItem,
    frame_pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    // 스테이징 텍스처(크기 변동 시 재생성).
    staging: Option<ID3D11Texture2D>,
    staging_dims: (u32, u32),
}

impl WgcCapture {
    /// 주어진 게임 창에 대한 WGC 캡처 세션을 시작한다.
    pub fn new(hwnd: HWND) -> Result<Self, String> {
        unsafe {
            // 1) D3D11 디바이스 (BGRA 지원 필수).
            let (device, context) = create_d3d_device()?;

            // 2) D3D11 → WinRT IDirect3DDevice.
            let dxgi: IDXGIDevice = device.cast().map_err(|e| format!("IDXGIDevice cast: {e}"))?;
            let inspectable = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)
                .map_err(|e| format!("CreateDirect3D11DeviceFromDXGIDevice: {e}"))?;
            let rt_device: windows::Graphics::DirectX::Direct3D11::IDirect3DDevice =
                inspectable.cast().map_err(|e| format!("IDirect3DDevice cast: {e}"))?;

            // 3) HWND → GraphicsCaptureItem (interop).
            let interop: IGraphicsCaptureItemInterop =
                windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
                    .map_err(|e| format!("capture interop factory: {e}"))?;
            let item: GraphicsCaptureItem = interop
                .CreateForWindow(hwnd)
                .map_err(|e| format!("CreateForWindow: {e}"))?;

            let size: SizeInt32 = item.Size().map_err(|e| format!("item.Size: {e}"))?;

            // 4) 프레임 풀 + 세션.
            let frame_pool = Direct3D11CaptureFramePool::Create(
                &rt_device,
                DirectXPixelFormat::B8G8R8A8UIntNormalized,
                NUM_BUFFERS,
                size,
            )
            .map_err(|e| format!("FramePool::Create: {e}"))?;

            let session = frame_pool
                .CreateCaptureSession(&item)
                .map_err(|e| format!("CreateCaptureSession: {e}"))?;

            // Win11: 캡처 테두리(노란 박스) 비활성 시도(권한 없으면 무시).
            let _ = session.SetIsBorderRequired(false);
            let _ = session.SetIsCursorCaptureEnabled(false);

            session.StartCapture().map_err(|e| format!("StartCapture: {e}"))?;

            Ok(Self {
                device,
                context,
                _item: item,
                frame_pool,
                session,
                staging: None,
                staging_dims: (0, 0),
            })
        }
    }

    /// 크기에 맞는 스테이징 텍스처를 확보(없거나 크기 변동 시 재생성).
    unsafe fn ensure_staging(&mut self, desc: &D3D11_TEXTURE2D_DESC) -> Result<(), String> {
        if self.staging.is_some() && self.staging_dims == (desc.Width, desc.Height) {
            return Ok(());
        }
        let sdesc = D3D11_TEXTURE2D_DESC {
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
            ..*desc
        };
        let mut tex: Option<ID3D11Texture2D> = None;
        self.device
            .CreateTexture2D(&sdesc, None, Some(&mut tex))
            .map_err(|e| format!("CreateTexture2D(staging): {e}"))?;
        self.staging = tex;
        self.staging_dims = (desc.Width, desc.Height);
        Ok(())
    }
}

impl FrameSource for WgcCapture {
    fn next_frame(&mut self) -> Result<Option<Frame>, String> {
        unsafe {
            // 풀에 쌓인 프레임을 모두 비우고 가장 최신 것만 사용.
            let mut latest = None;
            while let Ok(f) = self.frame_pool.TryGetNextFrame() {
                latest = Some(f);
            }
            let Some(frame) = latest else {
                return Ok(None); // 아직 새 프레임 없음
            };

            let surface = frame.Surface().map_err(|e| format!("frame.Surface: {e}"))?;
            let access: IDirect3DDxgiInterfaceAccess =
                surface.cast().map_err(|e| format!("DxgiInterfaceAccess cast: {e}"))?;
            let texture: ID3D11Texture2D = access
                .GetInterface()
                .map_err(|e| format!("GetInterface(texture): {e}"))?;

            let mut desc = D3D11_TEXTURE2D_DESC::default();
            texture.GetDesc(&mut desc);

            self.ensure_staging(&desc)?;
            let staging = self.staging.as_ref().unwrap();

            self.context.CopyResource(staging, &texture);

            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            self.context
                .Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                .map_err(|e| format!("Map: {e}"))?;

            let row_pitch = mapped.RowPitch as usize;
            let h = desc.Height as usize;
            let slice =
                std::slice::from_raw_parts(mapped.pData as *const u8, row_pitch * h);
            let out = Frame::from_bgra_with_pitch(desc.Width, desc.Height, slice, row_pitch);

            self.context.Unmap(staging, 0);
            Ok(Some(out))
        }
    }

    fn stop(&mut self) {
        let _ = self.session.Close();
        let _ = self.frame_pool.Close();
        self.staging = None;
    }
}

/// 하드웨어 D3D11 디바이스 생성, 실패 시 WARP(소프트웨어) 폴백.
unsafe fn create_d3d_device() -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
    for driver in [D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP] {
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        let hr = D3D11CreateDevice(
            None,
            driver,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        );
        if hr.is_ok() {
            if let (Some(d), Some(c)) = (device, context) {
                return Ok((d, c));
            }
        }
    }
    Err("D3D11CreateDevice 실패(HW/WARP 모두)".into())
}
