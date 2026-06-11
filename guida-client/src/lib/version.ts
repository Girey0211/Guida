/**
 * 버전 비교 유틸.
 *
 * 두 가지 "버전"을 다룬다:
 *  - 가이다 앱 버전: semver(major.minor.patch). Tauri 자동 업데이터가 실제
 *    최신 여부를 판정하지만, 서버의 `min_app_version` 비상 차단선과의 비교에도
 *    사용한다.
 *  - 림버스 패치 버전("2.7" 형태)은 `patchDiff`(utils)로 별도 처리한다.
 */

/**
 * semver 문자열을 비교한다. a < b 면 음수, a == b 면 0, a > b 면 양수.
 * "v" 접두사·프리릴리스 태그는 무시하고 숫자 3-튜플만 비교한다.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .trim()
      .replace(/^v/i, "")
      .split("-")[0] // 프리릴리스 태그 제거
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);

  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** current 가 min 보다 낮으면(= 강제 업데이트 대상) true. min 이 없으면 false. */
export function isBelowMinVersion(
  current: string,
  min: string | undefined | null,
): boolean {
  if (!min) return false;
  return compareSemver(current, min) < 0;
}
