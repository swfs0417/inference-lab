# Inference Lab

OpenAI 호환 API(vLLM, Ollama 프록시 등)의 스트리밍 응답 시간과, 앱이 GPU 서버에서 실행될 때 NVIDIA GPU 지표를 함께 기록하는 교육용 벤치마크 웹 앱입니다. Python 3.10+에서 실행됩니다.

## 실행

```powershell
cd inference-lab
python -m pip install -r requirements.txt
python server.py
```

브라우저에서 `http://127.0.0.1:8080`을 엽니다.

다른 컴퓨터에서도 접속할 웹서버로 띄울 때:

```powershell
$env:ALLOWED_TARGET_HOSTS="127.0.0.1,localhost,10.0.0.25"
python server.py --host 0.0.0.0 --port 8080
```

`ALLOWED_TARGET_HOSTS`는 벤치마크 대상 추론 서버의 호스트 목록입니다. 임의 URL 호출을 막기 위해 기본값은 로컬 주소만 허용합니다. 테스트 전용 폐쇄망이 아니라면 `*`는 사용하지 마세요.

## 지원하는 측정값

- TTFT: HTTP 요청 직전부터 첫 콘텐츠 스트리밍 청크까지
- 총 지연시간: 요청 직전부터 스트림 완료까지
- 생성 구간: 첫 콘텐츠 청크부터 완료까지
- 출력 TPS: API가 usage를 제공하면 completion token 기준. 없으면 글자 수 기반 추정
- 평균, p50, p95, 성공/오류 수
- 스트리밍 청크 간격(ITL) 평균, p50, p95, p99, 최대 정지시간
- Cold/Warm 실험 조건, 사전 워밍업 횟수, 첫 측정/steady-state 구분
- `nvidia-smi`가 있는 서버에서는 0.5초 간격 GPU 사용률, VRAM, 온도, 전력
- GPU 평균/최대, 추정 소비 에너지(Wh), 출력 토큰당 에너지
- OS, Python, CPU, GPU 이름과 VRAM 등 실행 환경 스냅샷
- 각 스트리밍 청크의 상대 도착시각
- 사용자가 직접 입력한 프롬프트를 포함한 CSV/Excel 결과 내보내기
- PyMuPDF4LLM 기반 PDF → Markdown 변환과 Transformer 논문 예시

## 결과 내보내기와 PDF 변환

최근 결과 영역에서 모델 응답 원문을 확인하고 `CSV` 또는 `Excel` 버튼으로 저장된 실험을 내려받습니다. Excel 파일은 실행 요약(`Runs`)과 응답 원문을 포함한 요청별 측정값(`Samples`) 시트로 구성됩니다.

PDF → Markdown 영역에서는 20MB 이하 PDF를 업로드하고 변환 결과를 미리 본 뒤 `.md`로 저장할 수 있습니다. PyMuPDF4LLM/PyMuPDF는 AGPL 또는 별도 상용 라이선스로 제공되므로, 비공개 상용 배포 전에는 라이선스 조건을 확인하세요.

## 측정 해석

API 지표는 네트워크, 서버 큐, 모델 추론을 포함한 E2E 값입니다. `nvidia-smi` 값은 GPU 서버 내부에서 이 앱을 실행할 때만 의미가 있습니다. 엄밀한 prefill/decode 분리는 vLLM 등 추론 엔진이 노출하는 Prometheus 메트릭 연동이 추가로 필요합니다.

GPT Edu는 외부 서비스에서 호출 가능한 Edu 전용 API가 없으므로 이 앱이 직접 호출하지 않습니다. 향후 브라우저 확장이 측정한 샘플을 다음 엔드포인트로 저장할 수 있습니다.

실제 Chrome 확장 프로그램은 `chatgpt-edu-extension/`에 포함되어 있습니다. 확장 폴더의 README에 따라 압축해제된 확장 프로그램으로 로드하면 ChatGPT Edu 화면의 Browser E2E를 자동 저장합니다.

```http
POST /api/browser-measurement
Content-Type: application/json

{
  "model": "GPT Edu / selected model",
  "settings": {"prompt_name": "prefill-test"},
  "samples": [
    {"sequence": 1, "ttft_ms": 1530, "total_ms": 8120, "output_tokens_per_sec": 28.2, "error": null}
  ]
}
```

이 값은 브라우저 렌더링과 네트워크가 포함된 `Browser E2E`이며 API E2E나 GPU 내부 추론시간과 같은 지표로 해석하면 안 됩니다.

## 운영 전 보완 사항

- TLS와 로그인/역할 권한 추가
- API 키를 브라우저에서 받는 대신 서버의 비밀 저장소 사용
- PostgreSQL로 교체하고 실험 작업을 비동기 큐로 분리
- 외부 공개 시 요청 속도 제한 및 감사 로그 추가
- vLLM/DCGM Prometheus 연동으로 queue, prefill, decode 지표 추가
- 여러 벤치마크 작업이 동시에 실행될 때 GPU 지표의 실험별 귀속 처리
