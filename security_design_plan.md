# 암호화 및 API 보안 강화 설계 계획서 (Security Design Plan)

본 문서는 다른 세션에서 작업을 연속해서 진행할 수 있도록 작성된 보안 강화 설계 요약서입니다.

---

## 1. 개요 및 위협 모델 (Threat Model)
* **목표 1 (로컬 보안)**: 로컬 저장 파일(`my_routes.json`)을 사용자가 임의로 조작하여 치트를 하거나 강제로 규칙을 우회하는 행위를 차단합니다.
* **목표 2 (서버/API 보안)**: 공격자가 다른 유저의 식별키(UUID)를 알아내거나 위조하여, 서버에 등록된 타인의 루트를 무단으로 수정/삭제하는 API 위반 행위를 방지합니다.
* **제약 조건**: 추가 프로그램/하드웨어 사용 없음, 오프라인 모드 동작 지원(최초 1회 오프라인 가동 가능), 개인정보 수집 금지, 앱 용량 및 속도 최적화 유지.

---

## 2. 보안 아키텍처 설계

### A. 로컬 데이터 암호화 (AES-256-GCM)
1. **대칭 키 유도 (Key Derivation)**:
   * Windows 자격 증명 관리자(DPAPI로 사용자 계정 비밀번호에 종속되어 암호화됨)에 안전하게 저장된 `device_uuid`를 사용합니다.
   * `Key = SHA-256(device_uuid + "guida.v1.storage.salt")`
2. **파일 저장**:
   * 로컬의 `my_routes.json`을 위 유도 키로 **AES-256-GCM** 암호화하여 저장합니다.
3. **변조 대응 및 자가 치유 (Self-Healing)**:
   * 유저가 파일을 직접 열어 내용을 1바이트라도 변경하면 복호화 과정(인증 태그 검증)에서 실패합니다.
   * 복호화 실패 시 에러 크래시 대신, 데이터를 **깨끗한 빈 배열(초기값)로 초기화**하여 정상 동작을 유지합니다.
4. **기존 파일 마이그레이션**:
   * 최초 가동 시 기존 평문 JSON 파일이 존재한다면 자동으로 읽어 들여 암호화하여 다시 씁니다.

### B. API 위조 방지 (Ed25519 비대칭키 서명)
1. **키 쌍 생성 (Key Generation)**:
   * 클라이언트는 `device_uuid`의 바이트 데이터를 시드(Seed)로 사용하여 **Ed25519 개인키(Private Key)와 공개키(Public Key)**를 결정적으로 생성합니다. (기존 사용자도 자연스럽게 매핑됨)
   * **개인키**는 클라이언트 내부에만 보관되며 절대 네트워크로 나가지 않습니다.
   * **공개키**는 유저의 익명 ID 역할을 수행합니다.
2. **API 요청 전자 서명**:
   * 루트 업로드(`POST /api/routes/upload`) 및 수정(`PUT /api/routes/:code`) 요청 시, 클라이언트는 다음 정보를 조합하여 개인키로 서명합니다.
     `Message = Action + ":" + Timestamp + ":" + SHA-256(Request_Body)`
   * API 요청 시 아래 HTTP 헤더를 포함하여 전송합니다:
     * `X-Guida-PubKey`: hex로 인코딩된 공개키
     * `X-Guida-Timestamp`: 요청 시간 (밀리초 단위 타임스탬프)
     * `X-Guida-Signature`: hex로 인코딩된 Ed25519 서명
3. **서버 검증 (Server-side Verification)**:
   * 서버는 타임스탬프가 현재 서버 시간 기준 5분 이내인지 검증(재전송 공격 방지 - Replay Attack Protection)합니다.
   * `X-Guida-PubKey`와 요청 본문을 활용해 서명을 검증합니다.
   * 서명이 유효하면 공개키를 해싱하여 **UUID v5 형태로 결정적 변환**을 수행합니다.
     `uploader_uuid = UUIDv5(Namespace_DNS, pub_key)`
   * 이 변환된 UUID를 DB의 `uploader_uuid` 컬럼과 비교하여 작성자 본인 여부를 판단합니다. (DB 테이블 스키마를 전혀 바꾸지 않고 구현 가능)

### C. 계정 백업 및 복구 (Zero-Knowledge Backup)
로컬에 암호화 키를 두는 방식의 단점인 "포맷 시 데이터 유실" 문제를 해결하기 위한 보완 설계입니다.
1. **백업 실행**:
   * 클라이언트가 임의의 12자리 영숫자 **복구 코드(Recovery Code)**를 생성합니다.
   * 이 복구 코드로 로컬 암호화 키 시드, 설정 데이터, 로컬 루트를 암호화하여 서버로 업로드합니다.
   * 서버는 암호화된 바이너리 덩어리(Blob)와 복구 코드의 해시값을 저장합니다.
2. **복구 실행**:
   * 포맷 후 재설치한 신규 앱에서 사용자가 복구 코드를 입력합니다.
   * 클라이언트가 서버에 복구 코드를 조회하여 암호화된 데이터를 다운로드받고, 입력한 복구 코드로 해독하여 키와 데이터를 원래대로 완벽하게 복원합니다.
   * 서버는 어떠한 평문 데이터나 개인 키 정보도 저장하지 않는 **영지식(Zero-Knowledge)** 구조를 유지합니다.

---

## 3. 세션 이전 시 구현 대상 목록 (TODO for Next Session)

### [guida-client] Rust 백엔드 구현
* `Cargo.toml`에 `aes-gcm`, `sha2`, `ed25519-dalek`, `uuid` 의존성 추가.
* `src/commands/fs.rs` 수정: `my_routes.json` 파일 입출력 시 AES-256-GCM 암/복호화 적용 및 해독 실패 시 자가 치유(초기화) 로직 적용.
* `src/commands/crypto.rs` 신설: `device_uuid` 기반 Ed25519 키 쌍 생성 및 요청 서명 커맨드 구현.

### [guida-client] TypeScript 프론트엔드 구현
* `src/api/httpServer.ts` 수정: API 요청 시 Rust의 서명 커맨드를 호출하여 서명 헤더 탑재.
* 백업/복구 화면 디자인 및 구현.

### [guida-server] 백엔드 구현
* Node.js 내장 `crypto` 모듈을 이용하여 Ed25519 서명 검증 로직 구현.
* `routes.ts` 수정: 업로드/수정 라우트 진입 시 헤더 검증 미들웨어 탑재. `pubkey` -> `UUIDv5` 변환 로직 적용.
* 백업 및 복구를 위한 신규 엔드포인트(`POST /api/backup`, `POST /api/backup/restore`) 구현.
