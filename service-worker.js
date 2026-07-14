const CACHE_NAME = 'teacherschedule-v2';
const ASSETS = [
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// 서비스 워커 설치 및 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] 필수 자산 캐시 저장 중...');
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// 서비스 워커 활성화 및 구버전 캐시 삭제
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] 구버전 캐시 삭제:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 네트워크 요청 가로채기 (Stale-While-Revalidate 전략)
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // 나이스 Open API 및 Firebase 통신, 로컬 개발용 API 등 실시간 데이터 요청은 캐싱 방지
  if (url.includes('open.neis.go.kr') || 
      url.includes('firestore.googleapis.com') || 
      url.includes('firebase') || 
      url.startsWith('chrome-extension://') ||
      event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        // 1. 캐시가 있든 없든 백그라운드에서 항상 최신 파일을 다운로드하여 캐시를 무선으로 갱신
        const fetchedResponse = fetch(event.request)
          .then((networkResponse) => {
            // 정상적인 GET 응답에 대해서만 캐시 갱신
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => {
            // 오프라인 상태에서 네트워크 통신 실패 시 폴백
            if (event.request.mode === 'navigate') {
              return caches.match('index.html');
            }
          });

        // 2. 이미 로컬 캐시에 저장된 옛날 버전이 있다면 0.01초 만에 즉시 반환 (체감 속도 극대화)
        //    없다면 방금 백그라운드로 가져온 최신 네트워크 응답을 반환
        return cachedResponse || fetchedResponse;
      });
    })
  );
});

// 새로운 서비스 워커의 즉각적인 활성화를 위한 강제 수신 통로
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    console.log('[Service Worker] skipWaiting 신호 수신. 즉시 활성화 단계를 진행합니다.');
    self.skipWaiting();
  }
});
