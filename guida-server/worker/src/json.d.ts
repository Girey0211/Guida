// 게임 데이터 JSON 을 번들에 직접 import 한다. esbuild(wrangler) 가 번들링하며,
// 타입은 any 로 충분하다(파일은 worker 디렉터리 밖 ../../data 에 있음).
declare module '*.json' {
  const value: any;
  export default value;
}
