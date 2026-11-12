// 오류 가능성이 있는 패턴만 잡는 recommended를 쓴다.
// standard는 표기 방식만 바꾸는 수정을 대량으로 요구해 실제 결함을 가린다.
//
// package.json의 lint:css는 --cache를 켜고 캐시를 node_modules/.cache에 둔다.
// 캐시를 끄면 Stylelint가 실행마다 캐시 파일을 fs.rmSync(force)로 지우는데,
// Windows의 Node 24.13은 경로에 한글이 있으면 이 호출에서 프로세스가 비정상 종료된다(0xC0000409).
/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-recommended'],
  rules: {
    // 처음 켰을 때 7건이 나왔고 모두 실제 충돌이 아니었다.
    // 5건은 끝 선택자만 같은 서로 다른 컴포넌트(.crumbs button과 .results button 등)였고,
    // 2건(.btn:disabled, .pager .btn)은 .btn:hover:not(:disabled)와 겹치지 않거나 서로 다른 속성을 정한다.
    // 소스 순서를 억지로 바꾸면 읽기 흐름만 나빠진다. levis·TAKE THE OFFER 저장소와 같은 판단이다.
    'no-descending-specificity': null,
  },
};
