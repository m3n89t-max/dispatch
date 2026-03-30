# upload.md

## 목적
엑셀 업로드 후 설치대수 자동 산정 및 비교

---

## 처리 흐름

1. 엑셀 업로드
2. 행 정규화
3. 모델 판정
4. 설치대수 계산
5. 기사별 합산
6. 전일 vs 익일 비교

---

## 설치대수 규칙

### 제외
- AUGRU = ZL4 → 0
- MATNR startswith AC → 0

### 벽걸이
- MATNR startswith AR → 1

### 홈멀티
- MATNR startswith AF + suffix 영문3자리 → 2

### 스탠드
- MATNR startswith AF → 1

---

## 출력 지표

- 전일 배차 대수
- 익일 확정 대수
- 증감
- 납기유지율

---

## 납기 유지율

납기유지율 = 익일 / 전일 * 100

---

## 예외 처리

- 모델 미인식 → UNKNOWN
- 수동 보정 가능