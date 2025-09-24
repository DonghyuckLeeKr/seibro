const LABELS: Record<string, string> = {
  ISSU_DT: "발행일자",
  ISSUCO_CUSTNO: "발행회사고객번호",
  ISSUCO_CUST_NM: "발행회사 명칭",
  ISIN: "종목코드",
  KOR_SECN_NM: "한글종목명",
  SECN_KACD: "종목종류코드",
  XPIR_DT: "만기일자",
  ISSU_CUR_CD: "발행통화코드",
  FIRST_ISSU_AMT: "최초발행금액",
  ISSU_REMA: "발행잔액",
  PAYIN_AMT: "납입금액",
  COUPON_RATE: "표면이자율",
  XPIRED_RATE: "만기상환율",
  RECU_WHCD: "모집방법코드",
  ISSU_WHCD: "발행방법코드",
  PARTICUL_BOND_KIND_TPCD: "특이채권종류",
  OPTION_TPCD: "옵션구분코드",
  FORC_ERLY_RED_YN: "강제조기상환",
  MR_CHG_TPCD: "금리변동구분",
  REGI_ORG_TPCD: "등록기관",
  GRTY_TPCD: "보증구분",
  SIGNA_TPCD: "기명구분",
  RANK_TPCD: "순위구분",
  INT_PAY_WAY_TPCD: "이자지급방법",
  SINT_CINT_TPCD: "단리복리구분",
  IRATE_CHG_TPCD: "이자율변동구분",
  XPIR_GUAR_PRATE: "만기보장수익율",
  XPIR_GUAR_PRATE_TPCD: "만기보장수익율구분",
  PRCP_RED_WHCD: "원금상환방법",
  APLI_DT: "상장일",
  DLIST_DT: "상장폐지일",
  KIS_VALAT_GRD_CD: "KIS평가등급",
  NICE_VALAT_GRD_CD: "NICE평가등급",
  SCI_VALAT_GRD_CD: "서울신용평가등급",
  KR_VALAT_GRD_CD: "한국기업평가등급",
  ELTSC_YN: "전자증권여부",
  EXER_MBODY_TPCD: "권리행사주체",
  INT_ESTM_MANN_TPCD: "이자산정방식",
  ERLY_RED_DT: "조기상환일",
  APLI_IRATE: "적용이자율",
  ERLY_REDAMT_VAL: "조기상환금액",
  INT_PAY_AMT: "이자지급금액",
  XRC_RATIO: "행사비율",

  // 이자지급 정보
  INT_PAY_CYCLE_TERMS: "이자지급주기기간수",
  INT_PAY_CYCLE_TPCD: "이자지급주기구분코드",
  RVLT_SEVER_TPCD: "절상절사구분코드",
  ACRINT_PAY_YN: "경과이자지급여부",
  BANK_HOLIDAY_INT_PAYDD_TPCD: "은행휴무일이자지급일구분",
  INT_PAY_TIMS_TPCD: "이자지급시기구분코드",
  BEFORE_DATE: "직전이표일",
  AFTER_DATE: "차기이표일",

  // 단기금융(CD/CP/ESTB) 공통/개별
  ISSU_AMT: "발행금액",
  INT_PAY_MANN_TPCD: "이자지급방식구분코드",
  DISCN_RATE: "할인율",
  FACE_AMT: "액면금액",
  SALE_AMT: "매출금액",
  SALE_DT: "매출일자",

  // CP 전용
  BILL_CACD: "어음분류코드",
  DISCN_ORG_CUSTNO: "할인기관고객번호",
  DISCN_ORD_NM: "할인기관명",
  PAY_BANK_BRONO: "지급은행지점번호",
  BANK_NM: "지급은행명",
  WHOLD_TPCD: "원천징수구분코드",

  // ESTB 전용
  ESTB_KACD: "전자단기사채종류코드",
  DAYOBJ: "일물",
  WHOLD_YN: "원천징수여부",
  GRORG_YN: "보증여부",
};

export function labelForKey(key: string): string {
  return LABELS[key] || key;
}


