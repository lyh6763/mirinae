import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages 하위 경로에서도 동작하도록 상대 경로로 빌드한다.
  base: './',
  plugins: [react()],
  build: {
    assetsInlineLimit: 0,
    // three.js 본체(렌더러·셰이더 조각 포함)가 한 파일로 약 580KB여서 기본값 500KB로는 늘 경고가 난다.
    // 더 쪼개도 첫 화면에 모두 필요해 얻는 것이 없다. 앱 코드가 지나치게 커지는 것은 계속 알아채도록 600KB에 둔다.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        // three.js와 React는 앱 코드보다 드물게 바뀐다. 따로 떼어 두면 앱만 고쳐 배포했을 때
        // 다시 찾은 사람은 바뀐 앱 파일만 새로 받는다(파일 이름의 해시가 그대로라 캐시가 맞음).
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
  },
});
