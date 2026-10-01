; electron-builder NSIS 훅 — 설치/업데이트가 끝나면 Windows 아이콘 캐시를 갱신한다.
; 실행 파일 경로가 그대로라(Program Files\SoundLib\SoundLib.exe) 아이콘만 바뀐 경우, 탐색기가
; 캐시해 둔 옛 아이콘을 바탕화면·시작 메뉴 바로가기에 계속 보여주기 때문이다.
!macro customInstall
  ; SHCNE_ASSOCCHANGED — 셸에 아이콘/연결이 바뀌었다고 알려 캐시를 다시 읽게 한다
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; Windows 10/11의 사용자 아이콘 캐시 새로 고침
  nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'
!macroend
