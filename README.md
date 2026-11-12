# 랜선 투데이 투다리: Railway 배포판

모바일과 PC 브라우저에서 같은 주소와 방 코드로 최대 6명이 접속하는 Socket.IO 웹 프로젝트입니다.

## 로컬 실행

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000`으로 접속합니다. 여러 창에서 같은 방 코드 `MP`를 입력하면 동기화를 확인할 수 있습니다.

## Railway 배포

1. 이 폴더의 파일을 GitHub 저장소 최상위에 업로드합니다.
2. Railway에서 New Project > Deploy from GitHub Repo를 선택합니다.
3. 저장소를 연결합니다. Railway는 루트의 `Dockerfile`과 `railway.json`을 사용합니다.
4. 배포 후 서비스 Settings > Networking에서 Public Domain을 생성합니다.
5. 발급된 주소를 모바일 또는 PC에서 엽니다.
6. 같은 방으로 초대하려면 `https://발급주소/?room=MP` 형태로 공유합니다.

Railway가 `PORT` 환경변수를 주입하므로 별도로 포트를 등록할 필요가 없습니다. 서버는 `0.0.0.0`과 `process.env.PORT`를 사용하며 `/health` 엔드포인트를 제공합니다.

## 조작

- PC: WASD 또는 방향키
- 모바일: 왼쪽 아래 가상 조이스틱
- 좌석: 상단 좌석 버튼
- 채팅: 오른쪽 또는 하단의 휴대폰 UI

## 주요 이벤트

`joinRoom`, `move`, `sit`, `stand`, `chat`, `selectDrink`, `pourDrink`, `raiseGlass`, `drinkSip`, `cheers`, `disconnect`

## 배포 전 참고

- 현재 방 상태는 서버 메모리에 저장됩니다. 서버가 재시작되면 초기화됩니다.
- Railway에서 인스턴스를 여러 개로 확장하려면 Redis Adapter 같은 공용 상태 계층이 필요합니다.
- 공개 서비스 전에는 이용약관, 개인정보 안내, 신고 및 차단 기능을 추가하세요.
