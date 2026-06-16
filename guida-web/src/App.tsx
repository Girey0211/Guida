import { useState, useEffect } from 'react';
import { 
  Compass, 
  Download, 
  Shield, 
  Cpu, 
  CheckCircle2, 
  AlertTriangle, 
  Sparkles,
  ExternalLink
} from 'lucide-react';

interface ReleaseInfo {
  version: string;
  publishedAt: string;
  msiUrl: string;
  zipUrl: string;
  notes: string;
  hasAssets: boolean;
}


export default function App() {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [view, setView] = useState<'landing' | 'inquiry'>('landing');

  useEffect(() => {
    // Girey0211/Guida 레포지토리의 최신 Releases 정보를 가져옵니다.
    fetch('https://api.github.com/repos/Girey0211/Guida/releases/latest')
      .then((res) => {
        if (!res.ok) throw new Error('Release not found');
        return res.json();
      })
      .then((data) => {
        const version = data.tag_name || 'v0.1.0';
        const publishedAt = data.published_at 
          ? new Date(data.published_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
          : '';
        const notes = data.body || '';
        
        let msiUrl = '';
        let exeUrl = '';
        let zipUrl = '';
        
        if (data.assets && Array.isArray(data.assets)) {
          data.assets.forEach((asset: any) => {
            if (asset.name.endsWith('.msi')) {
              msiUrl = asset.browser_download_url;
            } else if (asset.name.endsWith('.exe') && !asset.name.endsWith('.sig')) {
              exeUrl = asset.browser_download_url;
            } else if (asset.name.endsWith('.zip')) {
              zipUrl = asset.browser_download_url;
            }
          });
        }
        
        // 에셋이 없을 경우 Fallback으로 릴리즈 전체 탭 주소를 지정
        const fallbackUrl = data.html_url || 'https://github.com/Girey0211/Guida/releases';
        const winUrl = msiUrl || exeUrl || fallbackUrl;

        setRelease({
          version,
          publishedAt,
          msiUrl: winUrl,
          zipUrl: zipUrl || fallbackUrl,
          notes,
          hasAssets: !!(msiUrl || exeUrl || zipUrl)
        });
        setLoading(false);
      })
      .catch((err) => {
        console.error('GitHub API 호출 실패:', err);
        // API 한도 초과 혹은 리포지토리 릴리즈가 없을 때의 기본값 폴백
        setRelease({
          version: 'v0.1.0',
          publishedAt: '최신 버전',
          msiUrl: 'https://github.com/Girey0211/Guida/releases',
          zipUrl: 'https://github.com/Girey0211/Guida/releases',
          notes: '정식 버전을 출시했습니다.',
          hasAssets: false
        });
        setLoading(false);
      });
  }, []);

  return (
    <div className="app-container">
      {/* 백그라운드 앰비언트 글로우 데코 */}
      <div className="ambient-glow-1"></div>
      <div className="ambient-glow-2"></div>
      <div className="ambient-glow-3"></div>

      {/* SVG 그라데이션 선언 (Lucide 아이콘 적용용) */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="dawn-grad-svg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f39c12" />
            <stop offset="100%" stopColor="#ff4b2b" />
          </linearGradient>
        </defs>
      </svg>

      {/* Header */}
      <header className="header">
        <div className="header-content">
          <a href="#hero" className="logo-group" onClick={() => setView('landing')}>
            <Compass className="logo-icon" />
            <span>Guida</span>
          </a>
          
          <nav className="nav-links">
            <a href="#features" className="nav-link" onClick={() => setView('landing')}>주요 기능</a>
            <a href="#guide" className="nav-link" onClick={() => setView('landing')}>설치 가이드</a>
            <button onClick={() => setView('inquiry')} className="inquiry-header-btn">
              <AlertTriangle size={14} />
              버그 제보 및 건의
            </button>
            <a 
              href="https://github.com/Girey0211/Guida" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="github-btn"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }}><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg>
              GitHub
            </a>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {view === 'landing' ? (
          <>
            {/* Hero Section */}
        <section id="hero" className="hero">
          <div className="hero-tag">
            <Sparkles size={14} style={{ marginRight: '4px' }} />
            PC 전용 데스크톱 편의성 앱
          </div>
          
          <h1 className="hero-title">
            거울 던전 편의성 개선 앱<br />
            <span>Guida</span>
          </h1>
          
          <div className="hero-actions">
            {loading ? (
              <div className="btn-primary" style={{ opacity: 0.8, cursor: 'default' }}>
                버전 정보 확인 중...
              </div>
            ) : (
              <>
                <a href={release?.msiUrl} className="btn-primary">
                  <Download size={20} />
                  윈도우 전용 설치파일 다운로드 ({release?.version})
                </a>
              </>
            )}
            <a href="#guide" className="btn-secondary">
              설치 방법 보기
            </a>
          </div>

          {!loading && release && (
            <div className="release-info">
              <span>최신 배포일: <strong className="release-tag">{release.publishedAt}</strong></span>
              <span>•</span>
              <a 
                href="https://github.com/Girey0211/Guida/releases" 
                target="_blank" 
                rel="noopener noreferrer" 
                style={{ textDecoration: 'underline', color: 'var(--text-secondary)' }}
              >
                릴리즈 노트 확인
              </a>
            </div>
          )}
        </section>

        {/* 핵심 기조 (Philosophies) */}
        <section style={{ marginBottom: '6rem' }}>
          <h2 className="section-title">Guida의 개발 기조</h2>
          <p className="section-subtitle">
            클라이언트와 서버를 분리하여 투명하고 안전한 구조로 설계되었습니다.
          </p>
          
          <div className="philosophies">
            <div className="phil-card">
              <div className="phil-icon-wrapper">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg>
              </div>
              <h3 className="phil-title">Transparency (투명성)</h3>
              <p className="phil-desc">
                모든 소스 코드가 100% 공개된 오픈소스 프로젝트입니다. 불필요한 트래킹이나 악성 패키지가 포함되지 않음을 직접 확인하고 검증하실 수 있습니다.
              </p>
            </div>

            <div className="phil-card">
              <div className="phil-icon-wrapper">
                <Shield size={24} />
              </div>
              <h3 className="phil-title">Read-Only (안전성)</h3>
              <p className="phil-desc">
                게임 실행 프로세스를 변조하거나 메모리에 직접 인젝션하지 않는 비인젝션(Non-Injection) 방식을 고수합니다. 게임 규칙이나 계정에 위협이 되지 않는 안전한 도구입니다.
              </p>
            </div>

            <div className="phil-card">
              <div className="phil-icon-wrapper">
                <Cpu size={24} />
              </div>
              <h3 className="phil-title">Offline-First (독립성)</h3>
              <p className="phil-desc">
                외부 네트워크 통신이 두절되거나 서버의 상태가 불안정하더라도, 이미 받아둔 에고기프트 DB와 로컬 작성 경로를 활용해 모든 핵심 기능을 오프라인에서 온전히 제공합니다.
              </p>
            </div>
          </div>
        </section>

        {/* 주요 기능 설명 (Features) */}
        <section id="features" style={{ marginBottom: '6rem' }}>
          <h2 className="section-title">핵심 기능 둘러보기</h2>
          <p className="section-subtitle">
            거울 던전 탐사를 쾌적하게 만들기 위한 유용한 도구들을 제공합니다.
          </p>

          <div className="features-showcase">
            {/* Feature 1 */}
            <div className="feature-row">
              <div className="feature-info">
                <span className="feature-tag">Overlay Guide</span>
                <h3 className="feature-row-title">실시간 거울 던전 선택지 가이드</h3>
                <p className="feature-row-desc">
                  거울 던전 조우 이벤트 발생 시, 게임 위에 가볍게 띄워지는 오버레이 화면을 통해 보상과 성공 확률을 직관적으로 확인하세요.
                </p>
                <div className="feature-bullet-list">
                  <div className="feature-bullet">
                    <CheckCircle2 size={16} className="bullet-icon" />
                    <span>최신 거울 던전의 에고기프트 400여 종 전체 수록</span>
                  </div>
                  <div className="feature-bullet">
                    <CheckCircle2 size={16} className="bullet-icon" />
                    <span>선택지별 성공 시 획득 기프트와 실패 시 패널티를 사전 체크</span>
                  </div>
                  <div className="feature-bullet">
                    <CheckCircle2 size={16} className="bullet-icon" />
                    <span>나만의 파밍 목표 재화에 맞는 최적의 선택지 스마트 하이라이트</span>
                  </div>
                </div>
              </div>
              
              <div className="feature-media">
                <div className="mock-window">
                  <div className="mock-header">
                    <span className="dot red"></span>
                    <span className="dot yellow"></span>
                    <span className="dot green"></span>
                    <span className="mock-title">Guida Overlay Guide</span>
                  </div>
                  <div className="mock-body">
                    <div className="mock-overlay-guide">
                      <span className="mock-overlay-badge">추천</span>
                      <strong style={{ fontSize: '0.95rem' }}>선택지 1. 맞서 싸운다</strong>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>판정 성공 시 테마팩 전용 기프트 획득 가능</p>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <span className="mock-badge badge-warning">분노/색욕 판정</span>
                        <span className="mock-badge badge-success">성공: 묘각 (3등급)</span>
                      </div>
                    </div>
                    
                    <div className="mock-guide-item" style={{ opacity: 0.6 }}>
                      <span>선택지 2. 우회하여 지나간다</span>
                      <span className="mock-badge badge-info">성공: 코스트 획득</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="feature-row reverse">
              <div className="feature-media">
                <div className="mock-window">
                  <div className="mock-header">
                    <span className="dot red"></span>
                    <span className="dot yellow"></span>
                    <span className="dot green"></span>
                    <span className="mock-title">Share Hub</span>
                  </div>
                  <div className="mock-body" style={{ justifyContent: 'center', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ textAlign: 'center' }}>
                      <span className="mock-badge badge-success" style={{ marginBottom: '0.5rem', display: 'inline-block' }}>공유 코드 발급 완료</span>
                      <div className="mock-route-code">X7R2B9</div>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                        이 코드를 클라이언트 입력창에 넣으면<br />
                        해당 루트가 즉시 로드됩니다.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="feature-info">
                <span className="feature-tag">Share Hub</span>
                <h3 className="feature-row-title">6자리 코드로 익명 루트 공유</h3>
                <p className="feature-row-desc">
                  로그인이나 가입 필요 없이, 자신이 설계한 거던 빌드 경로를 6자리 임의 코드로 허브에 실시간 공유할 수 있습니다.
                </p>
                <div className="feature-bullet-list">
                  <div className="feature-bullet">
                    <CheckCircle2 size={16} className="bullet-icon" />
                    <span>추천/조회순 인기 필터를 통해 고성능 파밍 빌드 탐색</span>
                  </div>
                  <div className="feature-bullet">
                    <CheckCircle2 size={16} className="bullet-icon" />
                    <span>난이도(노말/하드/익스트림) 및 타겟 키워드 필터링 지원</span>
                  </div>
                  <div className="feature-bullet">
                    <CheckCircle2 size={16} className="bullet-icon" />
                    <span>네뷸라이저-물부리 등 최적 효율 기프트 순서 자동 검증 엔진 내장</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="feature-row">
              <div className="feature-info">
                <span className="feature-tag" style={{ background: 'rgba(59, 82, 246, 0.08)', color: 'var(--accent-blue)' }}>Phase 2 Preview</span>
                <h3 className="feature-row-title">OCR 기반 실시간 보상 분석 및 추적</h3>
                <p className="feature-row-desc">
                  차기 업데이트 예정 기능인 OCR 엔진을 통해, 거실 던전 최종 클리어 화면을 자동으로 감지하고 보상을 데이터화하여 보상 대시보드에 누적 추적합니다.
                </p>
                <div className="feature-bullet-list">
                  <div className="feature-bullet">
                    <CheckCircle2 size={16} className="bullet-icon" style={{ color: 'var(--accent-blue)' }} />
                    <span>클리어 화면의 아이템 종류 및 개수 자동 판독</span>
                  </div>
                  <div className="feature-bullet">
                    <CheckCircle2 size={16} className="bullet-icon" style={{ color: 'var(--accent-blue)' }} />
                    <span>플레이 세션 분석을 통해 공유 루트 신뢰도 검증 마크 부여</span>
                  </div>
                  <div className="feature-bullet">
                    <CheckCircle2 size={16} className="bullet-icon" style={{ color: 'var(--accent-blue)' }} />
                    <span>목표 수집 재화 해금률 실시간 그래프 모니터링</span>
                  </div>
                </div>
              </div>
              
              <div className="feature-media">
                <div className="mock-window">
                  <div className="mock-header">
                    <span className="dot red"></span>
                    <span className="dot yellow"></span>
                    <span className="dot green"></span>
                    <span className="mock-title">OCR Reward Tracker</span>
                  </div>
                  <div className="mock-body" style={{ gap: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                      <span style={{ fontWeight: 600 }}>진행 세션 결과 분석</span>
                      <span className="mock-badge badge-info">OCR 감지 활성</span>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>획득한 별빛</span>
                        <span>별빛 x 312</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>소요된 시간</span>
                        <span>24분 12초</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>루트 검증 상태</span>
                        <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>검증 완료 (Verified)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 설치 가이드 (Install Guide) */}
        <section id="guide" className="install-section">
          <h2 className="section-title">쉽고 빠른 설치 방법</h2>
          <p className="section-subtitle" style={{ marginBottom: '2.5rem' }}>
            Guida는 간단한 설치 단계를 거쳐 데스크톱 환경에 완벽히 통합됩니다.
          </p>

          <div className="install-grid">
            <div className="step-card">
              <div className="step-num">1</div>
              <div className="step-content">
                <h3 className="step-title">설치 프로그램 다운로드</h3>
                <p className="step-desc">
                  상단의 다운로드 버튼을 눌러 가장 최신 설치 파일을 다운로드합니다.
                </p>
              </div>
            </div>

            <div className="step-card">
              <div className="step-num">2</div>
              <div className="step-content">
                <h3 className="step-title">셋업 실행 및 설치</h3>
                <p className="step-desc">
                  다운로드한 파일을 실행해 셋업 마법사를 실행합니다. 지정한 경로로 설치가 진행됩니다.
                </p>
              </div>
            </div>

            <div className="step-card">
              <div className="step-num">3</div>
              <div className="step-content">
                <h3 className="step-title">가이다 실행</h3>
                <p className="step-desc">
                  바탕화면 혹은 시작 메뉴에 생성된 가이다 아이콘을 실행하여 가이드를 시작합니다.
                </p>
              </div>
            </div>
          </div>

          <div className="warning-box">
            <AlertTriangle className="warning-icon" size={24} />
            <div>
              <h4 className="warning-title">Windows SmartScreen 경고가 표시되는 경우</h4>
              <p className="warning-desc">
                윈도우 개발자 라이선스 서명 인증 절차를 거치지 않은 순수 오픈소스 파일이므로, 실행 시 파란색 경고 창이 뜰 수 있습니다. 
                이 경우 <strong>'추가 정보'</strong> 버튼을 클릭한 후 활성화되는 <strong>'실행'</strong> 버튼을 누르면 정상적으로 설치 및 이용이 가능합니다.
              </p>
            </div>
          </div>
        </section>
        </>
      ) : (
        <InquiryForm setView={setView} />
      )}
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div className="footer-links">
            <a href="https://github.com/Girey0211/Guida" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              레포지토리 <ExternalLink size={12} />
            </a>
            <a href="https://github.com/Girey0211/Guida/issues" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              버그 제보 및 건의 <ExternalLink size={12} />
            </a>
            <a href="https://github.com/Girey0211/Guida/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              MIT License <ExternalLink size={12} />
            </a>
          </div>

          <p className="footer-disclaimer">
            가이다(Guida)는 림버스 컴퍼니 플레이어를 위한 오픈소스 헬퍼 도구이며, 게임 개발사인 Project Moon(프로젝트 문)과 어떠한 상업적/공식적 연관성도 지니지 않은 유저 자체 제작 프로젝트입니다.
          </p>

          <p className="footer-copyright">
            © {new Date().getFullYear()} Guida Team. Licensed under MIT.
          </p>
        </div>
      </footer>
    </div>
  );
}

function InquiryForm({ setView }: { setView: (v: 'landing' | 'inquiry') => void }) {
  const [category, setCategory] = useState<'bug' | 'suggestion' | 'other'>('bug');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim() || !content.trim()) {
      setError('제목과 내용은 필수 입력 항목입니다.');
      return;
    }

    setSubmitting(true);

    try {
      const apiBase = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:3000';
      const res = await fetch(`${apiBase}/api/inquiries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category,
          title,
          content,
          contact: contact || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '문의사항 등록 중 오류가 발생했습니다.');
      }

      setSuccess(true);
    } catch (err: any) {
      console.error(err);
      setError(err.message || '서버와의 통신이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="inquiry-container">
        <div className="inquiry-card success-container">
          <div className="success-icon-wrapper">
            <CheckCircle2 size={36} />
          </div>
          <h2 className="success-title">소중한 의견 감사합니다!</h2>
          <p className="success-desc">
            제출해주신 건의 및 제보 내용은 개발팀에 소중하게 기록되었습니다.<br />
            더 좋은 안내자가 되도록 최선을 다하겠습니다.
          </p>
          <button onClick={() => setView('landing')} className="btn-primary" style={{ marginTop: '1rem' }}>
            홈으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="inquiry-container">
      <div className="inquiry-card">
        <h2 className="inquiry-title">버그 제보 및 건의</h2>
        <p className="inquiry-subtitle">
          가이다(Guida) 사용 중 발견하신 문제점이나 개선이 필요한 점을 남겨주시면 성심껏 반영하겠습니다.
        </p>

        {error && (
          <div className="error-message">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="category">문의 구분</label>
            <select 
              id="category"
              className="form-select"
              value={category}
              onChange={(e) => setCategory(e.target.value as any)}
            >
              <option value="bug">버그 제보</option>
              <option value="suggestion">기능 건의</option>
              <option value="other">기타 문의</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="title">
              <span>제목</span>
              <span className="character-count">{title.length}/200</span>
            </label>
            <input 
              type="text" 
              id="title"
              className="form-input"
              placeholder="요약된 제목을 입력해주세요"
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="content">
              <span>상세 내용</span>
              <span className="character-count">{content.length}/10000</span>
            </label>
            <textarea 
              id="content"
              className="form-textarea"
              placeholder="버그의 경우 발생 조건, 재현 단계, 사용 환경(Windows 빌드 등)을 상세히 기재해주시면 큰 도움이 됩니다."
              maxLength={10000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="contact">
              <span>연락처 (선택)</span>
              <span className="character-count">{contact.length}/100</span>
            </label>
            <input 
              type="text" 
              id="contact"
              className="form-input"
              placeholder="이메일 주소, 디스코드 ID 등 피드백을 수신받으실 수 있는 연락처"
              maxLength={100}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </div>

          <div className="form-actions">
            <button 
              type="button" 
              className="btn-secondary" 
              onClick={() => setView('landing')}
              disabled={submitting}
            >
              취소
            </button>
            <button 
              type="submit" 
              className="btn-primary" 
              disabled={submitting}
            >
              {submitting ? '제출 중...' : '제출하기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

